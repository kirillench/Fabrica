import re
from functools import lru_cache
from pathlib import Path

import yaml

DOMAINS_DIR = Path(__file__).resolve().parents[1] / "domains"

_cache: dict[str, dict] = {}


def load_all() -> dict[str, dict]:
    global _cache
    if not _cache:
        for f in sorted(DOMAINS_DIR.glob("*.yaml")):
            d = yaml.safe_load(f.read_text(encoding="utf-8"))
            _cache[d["id"]] = d
    return _cache


def get(domain_id: str) -> dict:
    domains = load_all()
    if domain_id not in domains:
        # первый домен — дефолтный
        return next(iter(domains.values()))
    return domains[domain_id]


def list_domains() -> list[dict]:
    return [
        {"id": d["id"], "name": d["name"], "description": d.get("description", "")}
        for d in load_all().values()
    ]


def build_matcher(domain: dict):
    """Компилирует словари домена в матчер за один проход по тексту.

    Все варианты написания собираются в ОДИН регекс-альтернатив
    (длинные варианты раньше, чтобы «плотность пульпы» побеждала «пульпа»),
    а принадлежность к канонической сущности определяется словарём —
    вместо N отдельных регекс-проходов по тексту получается один.

    Возвращает функцию text -> list[(canonical_name, entity_type)].
    """
    lookup: dict[str, tuple[str, str]] = {}
    for etype, terms in domain.get("dictionaries", {}).items():
        for canonical, variants in terms.items():
            for v in variants:
                lookup[str(v).lower()] = (canonical, etype)

    if not lookup:
        return lambda text: []

    # границы слова через (?<!\w): \b ненадёжен с кириллицей
    alternation = "|".join(
        re.escape(v) for v in sorted(lookup, key=len, reverse=True)
    )
    pattern = re.compile(r"(?<!\w)(" + alternation + r")\w*", re.IGNORECASE)

    def match(text: str) -> list[tuple[str, str]]:
        found: dict[str, str] = {}
        for m in pattern.finditer(text.lower()):
            canonical, etype = lookup[m.group(1)]
            found[canonical] = etype
        return list(found.items())

    return match


@lru_cache(maxsize=16)
def get_matcher(domain_id: str):
    """Кешированный матчер: не пересобирается на каждый запрос."""
    return build_matcher(get(domain_id))
