"""Сессии: треды «запрос → гипотезы», как чаты в ChatGPT.

Сессия хранит полное состояние: параметры запросов, сгенерированные
гипотезы, правки дорожных карт и вердикты экспертов — возвращение
в старую сессию продолжает работу с того же места.
"""

import json
import threading
import uuid
from datetime import datetime, timezone

from .config import DATA_DIR

SESSIONS_FILE = DATA_DIR / "sessions.json"
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> list[dict]:
    if SESSIONS_FILE.exists():
        return json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
    return []


def _save(sessions: list[dict]) -> None:
    SESSIONS_FILE.write_text(
        json.dumps(sessions, ensure_ascii=False), encoding="utf-8"
    )


def _owned(session: dict, owner: str) -> bool:
    return session.get("owner", "default") == owner


def list_sessions(owner: str = "default") -> list[dict]:
    """Сводки для панели: только сессии владельца, без содержимого тредов."""
    sessions = [s for s in _load() if _owned(s, owner)]
    sessions.sort(key=lambda s: s["updated_at"], reverse=True)
    return [
        {
            "id": s["id"],
            "title": s["title"],
            "created_at": s["created_at"],
            "updated_at": s["updated_at"],
            "turns": len(s["turns"]),
            "hypotheses": sum(len(t["hypotheses"]) for t in s["turns"]),
        }
        for s in sessions
    ]


def get(session_id: str, owner: str = "default") -> dict | None:
    s = next((s for s in _load() if s["id"] == session_id), None)
    return s if s and _owned(s, owner) else None


def create(title: str = "Новая сессия", owner: str = "default") -> dict:
    with _lock:
        sessions = _load()
        session = {
            "id": uuid.uuid4().hex[:10],
            "title": title,
            "owner": owner,
            "created_at": _now(),
            "updated_at": _now(),
            "turns": [],
        }
        sessions.append(session)
        _save(sessions)
    return session


def rename(session_id: str, title: str, owner: str = "default") -> bool:
    with _lock:
        sessions = _load()
        for s in sessions:
            if s["id"] == session_id and _owned(s, owner):
                s["title"] = title.strip() or s["title"]
                s["updated_at"] = _now()
                _save(sessions)
                return True
    return False


def delete(session_id: str, owner: str = "default") -> None:
    with _lock:
        _save([
            s for s in _load()
            if s["id"] != session_id or not _owned(s, owner)
        ])


def add_turn(
    session_id: str | None,
    request: dict,
    hypotheses: list[dict],
    owner: str = "default",
) -> tuple[dict, dict]:
    """Добавляет ход в сессию владельца; без session_id (или при попытке
    писать в чужую сессию) создаёт новую.

    Возвращает (session, turn). Первый ход задаёт название сессии.
    """
    with _lock:
        sessions = _load()
        session = next(
            (s for s in sessions if s["id"] == session_id and _owned(s, owner)),
            None,
        )
        if session is None:
            session = {
                "id": uuid.uuid4().hex[:10],
                "title": "Новая сессия",
                "owner": owner,
                "created_at": _now(),
                "updated_at": _now(),
                "turns": [],
            }
            sessions.append(session)
        turn = {
            "id": uuid.uuid4().hex[:10],
            "created_at": _now(),
            "request": request,
            "hypotheses": hypotheses,
        }
        session["turns"].append(turn)
        if session["title"] == "Новая сессия" and request.get("goal"):
            session["title"] = request["goal"][:80]
        session["updated_at"] = _now()
        _save(sessions)
    return session, turn


def patch_hypothesis(
    session_id: str, hypothesis_id: str, fields: dict, owner: str = "default"
) -> bool:
    """Персистит правки гипотезы (дорожная карта, вердикт эксперта)."""
    allowed = {"roadmap", "verdict"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return False
    with _lock:
        sessions = _load()
        for s in sessions:
            if s["id"] != session_id or not _owned(s, owner):
                continue
            for t in s["turns"]:
                for h in t["hypotheses"]:
                    if h["id"] == hypothesis_id:
                        h.update(updates)
                        s["updated_at"] = _now()
                        _save(sessions)
                        return True
    return False
