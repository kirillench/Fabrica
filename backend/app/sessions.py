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


def list_sessions() -> list[dict]:
    """Сводки для панели: без тяжёлого содержимого тредов."""
    sessions = _load()
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


def get(session_id: str) -> dict | None:
    return next((s for s in _load() if s["id"] == session_id), None)


def create(title: str = "Новая сессия") -> dict:
    with _lock:
        sessions = _load()
        session = {
            "id": uuid.uuid4().hex[:10],
            "title": title,
            "created_at": _now(),
            "updated_at": _now(),
            "turns": [],
        }
        sessions.append(session)
        _save(sessions)
    return session


def rename(session_id: str, title: str) -> bool:
    with _lock:
        sessions = _load()
        for s in sessions:
            if s["id"] == session_id:
                s["title"] = title.strip() or s["title"]
                s["updated_at"] = _now()
                _save(sessions)
                return True
    return False


def delete(session_id: str) -> None:
    with _lock:
        _save([s for s in _load() if s["id"] != session_id])


def add_turn(
    session_id: str | None, request: dict, hypotheses: list[dict]
) -> tuple[dict, dict]:
    """Добавляет ход в сессию; без session_id создаёт новую.

    Возвращает (session, turn). Первый ход задаёт название сессии.
    """
    with _lock:
        sessions = _load()
        session = next((s for s in sessions if s["id"] == session_id), None)
        if session is None:
            session = {
                "id": uuid.uuid4().hex[:10],
                "title": "Новая сессия",
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


def patch_hypothesis(session_id: str, hypothesis_id: str, fields: dict) -> bool:
    """Персистит правки гипотезы (дорожная карта, вердикт эксперта)."""
    allowed = {"roadmap", "verdict"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return False
    with _lock:
        sessions = _load()
        for s in sessions:
            if s["id"] != session_id:
                continue
            for t in s["turns"]:
                for h in t["hypotheses"]:
                    if h["id"] == hypothesis_id:
                        h.update(updates)
                        s["updated_at"] = _now()
                        _save(sessions)
                        return True
    return False
