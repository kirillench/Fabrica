import json
import re
import uuid

from .config import FEEDBACK_FILE, settings
from . import domains as domains_mod
from . import graph, llm
from .schemas import GenerateRequest


class NoKnowledgeError(Exception):
    """База знаний пуста или не содержит релевантных фрагментов."""


SYSTEM_PROMPT = """Ты — «Фабрика гипотез», научный ассистент НИИ и промышленных лабораторий.
Твоя задача — генерировать КОНКРЕТНЫЕ, ПРОВЕРЯЕМЫЕ в лабораторных условиях научные гипотезы.

ЖЁСТКОЕ ПРАВИЛО ОБОСНОВАННОСТИ:
- Обоснование каждой гипотезы строится ИСКЛЮЧИТЕЛЬНО на предоставленных фрагментах базы знаний [S1..Sn].
- Каждая гипотеза ОБЯЗАНА ссылаться минимум на один фрагмент; каждое фактическое утверждение в rationale — на конкретный [S#].
- Если фрагменты не подтверждают идею — НЕ включай её в ответ. Лучше меньше гипотез, но обоснованных.
- Не используй знания вне предоставленных фрагментов для обоснования (только для формулировки механизма).

Требования к каждой гипотезе:
- Конкретика: составы, концентрации, режимы, параметры
- Проверяемость: понятно, каким экспериментом подтвердить или опровергнуть
- Дорожная карта — структурированные шаги с длительностью (дни), стоимостью (руб) и ресурсами

Ответь СТРОГО в формате JSON:
{
  "hypotheses": [
    {
      "title": "краткое название",
      "statement": "полная проверяемая формулировка гипотезы",
      "mechanism": "ожидаемый физико-химический механизм влияния",
      "rationale": "обоснование, каждое утверждение со ссылкой [S1]...",
      "novelty": 0-10,
      "feasibility": 0-10,
      "impact": 0-10,
      "risk": 0-10,
      "risks_text": "основные технические и экономические риски",
      "sources": ["S1", "S3"],
      "roadmap": [
        {"name": "шаг проверки", "duration_days": 7, "cost": 200000, "resources": "оборудование, люди"}
      ],
      "success_criteria": "критерий успеха/провала эксперимента",
      "entities": [{"id": "e1", "label": "Nb", "type": "material"}],
      "relations": [{"source": "e1", "target": "e2", "label": "повышает"}]
    }
  ]
}

Типы сущностей: material, process, parameter, property, reagent, equipment.
Все тексты — на русском языке."""


def _weighted_score(h: dict, weights: dict[str, float]) -> float:
    wn = weights.get("novelty", 0.25)
    wf = weights.get("feasibility", 0.25)
    wi = weights.get("impact", 0.3)
    wr = weights.get("risk", 0.2)
    total = (wn + wf + wi + wr) or 1.0
    raw = (
        wn * h["novelty"]
        + wf * h["feasibility"]
        + wi * h["impact"]
        + wr * (10 - h["risk"])  # меньший риск = выше балл
    )
    return round(raw / total * 10, 1)  # шкала 0..100


def _load_feedback_notes(limit: int = 10) -> str:
    """Последние вердикты экспертов — «обучение на фидбэке» через промпт."""
    if not FEEDBACK_FILE.exists():
        return ""
    entries = json.loads(FEEDBACK_FILE.read_text(encoding="utf-8"))[-limit:]
    if not entries:
        return ""
    lines = []
    for e in entries:
        verdict = "подтверждена" if e["verdict"] == "confirmed" else "опровергнута"
        note = f" ({e['comment']})" if e.get("comment") else ""
        lines.append(f"- «{e['title']}» — {verdict}{note}")
    return "Обратная связь экспертов по прошлым гипотезам (учитывай её):\n" + "\n".join(lines)


def _clamp(v, lo=0.0, hi=10.0) -> float:
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return 5.0


def _normalize_roadmap(roadmap) -> list[dict]:
    """Приводит шаги к структуре конструктора (name/duration_days/cost/resources)."""
    steps = []
    for s in roadmap or []:
        if isinstance(s, str):
            steps.append({"name": s, "duration_days": 7, "cost": 0, "resources": ""})
        elif isinstance(s, dict) and s.get("name"):
            steps.append(
                {
                    "name": str(s["name"]),
                    "duration_days": int(s.get("duration_days") or 7),
                    "cost": int(s.get("cost") or 0),
                    "resources": str(s.get("resources") or ""),
                }
            )
    return steps


def _graph_context(goal: str, constraints: str, domain: dict) -> list[str]:
    """Сущности из запроса → их окрестность в графе знаний → триплеты для промпта."""
    matcher = domains_mod.get_matcher(domain["id"])
    names = [n for n, _ in matcher(f"{goal} {constraints}")]
    if not names:
        return []
    return graph.store.neighborhood(names, depth=1)


_WORD_RE = re.compile(r"[а-яёa-z]{5,}")


def _relevance_checker(query: str, matcher):
    """Интерпретируемый фильтр релевантности поверх векторного поиска.

    Мультиязычные эмбеддинги по умолчанию слабо разделяют русские тексты,
    поэтому числовой порог косинусной близости ненадёжен. Вместо него —
    прозрачное правило: чанк релевантен, если делит с запросом хотя бы одну
    доменную сущность ИЛИ не меньше двух лексических основ (первые 5 букв
    слов длиной 5+).

    Анализ запроса выполняется один раз, возвращается функция для чанков.
    """
    q_entities = {n for n, _ in matcher(query)}
    q_stems = {w[:5] for w in _WORD_RE.findall(query.lower())}

    def check(chunk_text: str) -> bool:
        if q_entities and q_entities & {n for n, _ in matcher(chunk_text)}:
            return True
        c_stems = {w[:5] for w in _WORD_RE.findall(chunk_text.lower())}
        return len(q_stems & c_stems) >= 2

    return check


def generate(
    req: GenerateRequest,
    retrieved: list[dict],
    context_query: str = "",
    prior_goals: list[str] | None = None,
) -> list[dict]:
    domain = domains_mod.get(req.domain)

    # Строгий режим: без релевантных фрагментов базы гипотезы не генерируются.
    # Векторную выдачу дополнительно фильтруем интерпретируемым правилом;
    # context_query включает предыдущие ходы сессии для уточняющих запросов.
    matcher = domains_mod.get_matcher(domain["id"])
    query = context_query or f"{req.goal} {req.constraints}"
    is_relevant = _relevance_checker(query, matcher)
    retrieved = [r for r in retrieved if is_relevant(r["text"])]
    if not retrieved:
        raise NoKnowledgeError(
            "В базе знаний нет фрагментов, релевантных этой задаче. Загрузите "
            "документы (статьи, отчёты, данные экспериментов) по вашей проблеме "
            "или переформулируйте задачу в терминах предметной области."
        )
    triples = _graph_context(query, "", domain)

    if settings.is_demo:
        raw = _demo_hypotheses(req, retrieved, domain)
    else:
        raw = _llm_hypotheses(req, retrieved, domain, triples, prior_goals or [])

    result = []
    for h in raw:
        for key in ("novelty", "feasibility", "impact", "risk"):
            h[key] = _clamp(h.get(key))
        # резолвим ссылки S1..Sn в реальные фрагменты источников
        resolved = []
        for sid in h.get("sources", []):
            try:
                idx = int(str(sid).lstrip("Ss")) - 1
                r = retrieved[idx]
                resolved.append(
                    {
                        "id": f"S{idx + 1}",
                        "doc_id": r["doc_id"],
                        "filename": r["filename"],
                        "chunk": r["chunk"],
                        "snippet": r["text"][:280],
                        "relevance": r["relevance"],
                    }
                )
            except (ValueError, IndexError):
                continue
        # строгий фильтр: гипотеза без подтверждённых источников отбрасывается
        if not resolved:
            continue
        h["sources"] = resolved
        h["roadmap"] = _normalize_roadmap(h.get("roadmap"))
        h["id"] = uuid.uuid4().hex[:12]
        h["score"] = _weighted_score(h, req.weights)
        result.append(h)

    if not result:
        raise NoKnowledgeError(
            "Ни одна гипотеза не прошла проверку обоснованности: база знаний "
            "не содержит фрагментов, подтверждающих идеи по этой задаче."
        )

    result.sort(key=lambda x: x["score"], reverse=True)
    return result


def _llm_hypotheses(
    req: GenerateRequest,
    retrieved: list[dict],
    domain: dict,
    triples: list[str],
    prior_goals: list[str],
) -> list[dict]:
    context = "\n\n".join(
        f"[S{i + 1}] (источник: {r['filename']})\n{r['text'][:900]}"
        for i, r in enumerate(retrieved)
    )

    parts = [
        f"Целевая проблема / KPI: {req.goal}",
        f"Ограничения: {req.constraints or 'не указаны'}",
    ]
    if prior_goals:
        parts.append(
            "Это уточнение в рамках сессии. Предыдущие запросы: "
            + "; ".join(prior_goals)
        )
    if domain.get("prompt_hints"):
        parts.append(f"Доменный контекст: {domain['prompt_hints']}")
    if req.excluded:
        parts.append(f"Исключённые направления (НЕ предлагать): {req.excluded}")
    if triples:
        parts.append(
            "Связи из графа знаний, построенного по базе документов "
            "(используй для поиска аналогий и пробелов):\n" + "\n".join(triples)
        )
    feedback = _load_feedback_notes()
    if feedback:
        parts.append(feedback)
    if domain.get("roadmap_templates"):
        tpl = json.dumps(domain["roadmap_templates"], ensure_ascii=False)
        parts.append(f"Типовые шаги проверки в этом домене (адаптируй): {tpl}")
    parts.append(f"Сгенерируй до {req.n_hypotheses} гипотез (только обоснованные фрагментами).")
    parts.append(f"Фрагменты базы знаний:\n\n{context}")

    data = llm.chat_json(SYSTEM_PROMPT, "\n\n".join(parts))
    return data.get("hypotheses", [])


# ---------------------------------------------------------------------------
# Демо-режим: мок-гипотезы под домен «обогащение руд», чтобы фронтенд
# и пайплайн работали до подключения реального LLM API-ключа.
# ---------------------------------------------------------------------------

_DEMO_TEMPLATES = [
    {
        "title": "Контроль гранулометрии питания флотации",
        "statement": "Стабилизация класса крупности -71 мкм на уровне 62–65% в питании основной флотации повысит извлечение на 1.5–2.5% за счёт снижения потерь со шламами и крупными сростками.",
        "mechanism": "Оптимальная крупность обеспечивает раскрытие сростков при минимальном переизмельчении; шламы <10 мкм ухудшают селективность закрепления на пузырьке.",
        "novelty": 5.5, "feasibility": 8.5, "impact": 7.5, "risk": 3.0,
        "risks_text": "Требуется онлайн-гранулометр; рост энергозатрат на измельчение при ужесточении контроля.",
        "roadmap": [
            {"name": "Ситовой анализ текущего питания по сменам", "duration_days": 7, "cost": 150000, "resources": "Лаборант, ситовой комплект"},
            {"name": "Лабораторная флотация на 3 классах крупности", "duration_days": 14, "cost": 400000, "resources": "Флотомашина лаб., 2 исследователя"},
            {"name": "Корректировка режима работы гидроциклонов", "duration_days": 10, "cost": 250000, "resources": "Технолог, слесарь КИП"},
        ],
        "success_criteria": "Прирост извлечения ≥ 1.5% при стабильности качества концентрата",
        "entities": [
            {"id": "e1", "label": "Гранулометрия", "type": "parameter"},
            {"id": "e2", "label": "Флотация", "type": "process"},
            {"id": "e3", "label": "Извлечение", "type": "property"},
            {"id": "e4", "label": "Гидроциклон", "type": "equipment"},
        ],
        "relations": [
            {"source": "e1", "target": "e3", "label": "определяет"},
            {"source": "e4", "target": "e1", "label": "регулирует"},
            {"source": "e2", "target": "e3", "label": "формирует"},
        ],
    },
    {
        "title": "Повышение плотности пульпы основной флотации",
        "statement": "Повышение плотности пульпы на входе в основную флотацию с текущего уровня до 32–35% твёрдого увеличит время пребывания частиц и извлечение на 0.8–1.5%.",
        "mechanism": "Рост плотности увеличивает вероятность столкновения частица–пузырёк и эффективное время флотации при том же фронте.",
        "novelty": 4.5, "feasibility": 9.0, "impact": 6.0, "risk": 2.5,
        "risks_text": "Возможное ухудшение селективности и рост вязкости пульпы; проверить на реальном питании.",
        "roadmap": [
            {"name": "Замеры текущей плотности по секциям", "duration_days": 5, "cost": 80000, "resources": "Технолог, плотномер"},
            {"name": "Лабораторные опыты при 28/32/35% твёрдого", "duration_days": 10, "cost": 300000, "resources": "Флотомашина лаб."},
            {"name": "Промышленный эксперимент на одной секции", "duration_days": 21, "cost": 900000, "resources": "Секция ОФ, смена технологов"},
        ],
        "success_criteria": "Прирост извлечения ≥ 0.8% без падения качества концентрата",
        "entities": [
            {"id": "e1", "label": "Плотность пульпы", "type": "parameter"},
            {"id": "e2", "label": "Флотация", "type": "process"},
            {"id": "e3", "label": "Извлечение", "type": "property"},
        ],
        "relations": [
            {"source": "e1", "target": "e2", "label": "влияет на"},
            {"source": "e2", "target": "e3", "label": "формирует"},
        ],
    },
    {
        "title": "Промежуточные контактные чаны перед контрольной флотацией",
        "statement": "Установка контактных чанов перед контрольной флотацией (агитация 3–5 мин с дозагрузкой собирателя 10–15 г/т) снизит потери металла с хвостами на 0.5–1.0%.",
        "mechanism": "Дополнительное время агитации восстанавливает сорбционный слой собирателя на недофлотированных зёрнах.",
        "novelty": 6.5, "feasibility": 6.5, "impact": 7.0, "risk": 4.5,
        "risks_text": "Капитальные затраты на чаны и обвязку; риск переизбытка собирателя в цикле.",
        "roadmap": [
            {"name": "Кинетика флотации хвостовых продуктов", "duration_days": 10, "cost": 250000, "resources": "Лаборатория флотации"},
            {"name": "Подбор дозировки собирателя", "duration_days": 7, "cost": 180000, "resources": "Реагентщик, лаборант"},
            {"name": "ТЭО установки чанов", "duration_days": 14, "cost": 300000, "resources": "Проектный инженер"},
        ],
        "success_criteria": "Снижение содержания металла в отвальных хвостах ≥ 0.5%",
        "entities": [
            {"id": "e1", "label": "Контактный чан", "type": "equipment"},
            {"id": "e2", "label": "Агитация", "type": "process"},
            {"id": "e3", "label": "Собиратель", "type": "reagent"},
            {"id": "e4", "label": "Потери", "type": "property"},
        ],
        "relations": [
            {"source": "e1", "target": "e2", "label": "обеспечивает"},
            {"source": "e3", "target": "e2", "label": "усиливает"},
            {"source": "e2", "target": "e4", "label": "снижает"},
        ],
    },
    {
        "title": "Дофлотация из текущих хвостов с реагентом-модификатором",
        "statement": "Дофлотация хвостов основного цикла с добавкой модификатора (типа Finfix 300, 20–40 г/т) в контрольной операции извлечёт дополнительно 0.3–0.7% металла.",
        "mechanism": "Модификатор диспергирует шламовые покрытия на поверхности сульфидов, восстанавливая их флотируемость.",
        "novelty": 7.0, "feasibility": 7.0, "impact": 6.5, "risk": 5.0,
        "risks_text": "Стоимость реагента; влияние на водооборот и последующие операции требует проверки.",
        "roadmap": [
            {"name": "Скрининг 3–4 модификаторов на пробах хвостов", "duration_days": 14, "cost": 350000, "resources": "Лаборатория, реагенты"},
            {"name": "Оптимизация дозировки лучшего реагента", "duration_days": 7, "cost": 150000, "resources": "Лаборант"},
            {"name": "Опытно-промышленные испытания", "duration_days": 30, "cost": 1500000, "resources": "Участок ОПИ"},
        ],
        "success_criteria": "Дополнительное извлечение ≥ 0.3% при окупаемости реагента",
        "entities": [
            {"id": "e1", "label": "Finfix", "type": "reagent"},
            {"id": "e2", "label": "Хвосты", "type": "material"},
            {"id": "e3", "label": "Флотация", "type": "process"},
            {"id": "e4", "label": "Извлечение", "type": "property"},
        ],
        "relations": [
            {"source": "e1", "target": "e3", "label": "модифицирует"},
            {"source": "e2", "target": "e3", "label": "питание"},
            {"source": "e3", "target": "e4", "label": "повышает"},
        ],
    },
    {
        "title": "Доизмельчение промпродукта в отдельном цикле",
        "statement": "Выделение промпродукта в отдельный цикл доизмельчения до 85–90% класса -44 мкм повысит качество концентрата на 0.5–1.0% без потери извлечения.",
        "mechanism": "Селективное раскрытие тонких сростков в промпродукте без переизмельчения всей рудной массы.",
        "novelty": 6.0, "feasibility": 5.5, "impact": 7.5, "risk": 5.5,
        "risks_text": "Капзатраты на мельницу доизмельчения; рост циркуляционной нагрузки.",
        "roadmap": [
            {"name": "Минералогия сростков в промпродукте", "duration_days": 10, "cost": 300000, "resources": "Минералог, СЭМ"},
            {"name": "Лабораторное доизмельчение + флотация", "duration_days": 14, "cost": 400000, "resources": "Лаборатория"},
            {"name": "Балансовые расчёты схемы", "duration_days": 7, "cost": 120000, "resources": "Технолог-схемщик"},
        ],
        "success_criteria": "Прирост качества концентрата ≥ 0.5% при извлечении не ниже базового",
        "entities": [
            {"id": "e1", "label": "Промпродукт", "type": "material"},
            {"id": "e2", "label": "Измельчение", "type": "process"},
            {"id": "e3", "label": "Качество концентрата", "type": "property"},
        ],
        "relations": [
            {"source": "e1", "target": "e2", "label": "направляется на"},
            {"source": "e2", "target": "e3", "label": "повышает"},
        ],
    },
]


def _demo_hypotheses(
    req: GenerateRequest, retrieved: list[dict], domain: dict
) -> list[dict]:
    hypotheses = []
    n = min(req.n_hypotheses, len(_DEMO_TEMPLATES))
    for i, tpl in enumerate(_DEMO_TEMPLATES[:n]):
        h = json.loads(json.dumps(tpl, ensure_ascii=False))  # глубокая копия
        h["sources"] = [f"S{(i % len(retrieved)) + 1}"]
        h["rationale"] = (
            f"[ДЕМО-РЕЖИМ: LLM не подключена, это пример вывода] "
            f"Гипотеза сформирована для задачи «{req.goal[:120]}» с опорой на "
            f"фрагмент {h['sources'][0]} из загруженной базы знаний. После "
            "подключения API-ключа в .env обоснование будет строиться LLM "
            "строго по содержимому источников."
        )
        hypotheses.append(h)
    return hypotheses
