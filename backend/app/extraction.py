"""Извлечение сущностей и связей из текста для графа знаний.

Гибридная схема:
1. Словарный матчер доменного пакета — всегда (быстро, бесплатно, офлайн).
   Связи — по со-встречаемости сущностей в одном чанке.
2. LLM-обогащение — если подключён API-ключ: модель извлекает
   типизированные связи с подписями («повышает», «зависит от»...).
   Ограничено первыми чанками документа, чтобы индексация больших PDF
   оставалась быстрой и дешёвой.
"""

from . import domains as domains_mod
from . import llm
from .config import settings

LLM_EXTRACTION_CHUNK_LIMIT = 20

_EXTRACT_PROMPT = """Ты извлекаешь граф знаний из научно-технического текста.
Типы сущностей: {types}.
Верни СТРОГО JSON:
{{"entities": [{{"name": "...", "type": "..."}}],
  "relations": [{{"source": "...", "target": "...", "label": "глагол связи"}}]}}
Имена сущностей — канонические, в именительном падеже, на русском.
Только факты, явно присутствующие в тексте."""


def extract_from_chunks(chunks: list[str], domain: dict) -> tuple[list[dict], list[dict]]:
    """Возвращает (entities, relations) по всем чанкам документа."""
    matcher = domains_mod.get_matcher(domain["id"])

    entities: dict[str, dict] = {}
    relations: dict[tuple[str, str], dict] = {}

    # 1. Словарный проход + со-встречаемость
    for chunk in chunks:
        found = matcher(chunk)
        for name, etype in found:
            entities[name] = {"name": name, "type": etype}
        names = [n for n, _ in found]
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                key = tuple(sorted((names[i], names[j])))
                relations.setdefault(
                    key, {"source": key[0], "target": key[1], "label": ""}
                )

    # 2. LLM-обогащение (первые чанки, только при наличии ключа)
    if not settings.is_demo:
        types = ", ".join(domain.get("entity_types", {}).keys())
        for chunk in chunks[:LLM_EXTRACTION_CHUNK_LIMIT]:
            try:
                data = llm.chat_json(
                    _EXTRACT_PROMPT.format(types=types), chunk[:2000]
                )
            except Exception:
                break  # не валим индексацию из-за сбоя LLM
            for e in data.get("entities", []):
                if e.get("name") and e.get("type"):
                    entities.setdefault(
                        e["name"], {"name": e["name"], "type": e["type"]}
                    )
            for r in data.get("relations", []):
                s, t = r.get("source"), r.get("target")
                if s in entities and t in entities:
                    key = tuple(sorted((s, t)))
                    relations[key] = {
                        "source": s, "target": t, "label": r.get("label", "")
                    }

    return list(entities.values()), list(relations.values())
