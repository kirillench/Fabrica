"""Уровень 1 безопасности: токены доступа и подписанные ссылки.

- APP_TOKENS в .env («токен:Имя,токен2:Имя2») включает аутентификацию:
  все API-запросы требуют Authorization: Bearer <токен>, а сессии
  разграничиваются по владельцу. Пустой APP_TOKENS = аутентификация
  выключена (удобно для разработки).
- Файлы базы знаний отдаются по короткоживущим HMAC-подписанным ссылкам:
  прямую ссылку нельзя переслать и открыть после истечения срока.
"""

import hashlib
import hmac
import time

from fastapi import HTTPException, Request

from .config import settings

DOC_LINK_TTL = 300  # секунд жизни подписанной ссылки


def current_user(request: Request) -> str:
    """FastAPI-dependency: имя пользователя из Bearer-токена."""
    if not settings.auth_enabled:
        return "default"
    auth = request.headers.get("authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    user = settings.token_users.get(token)
    if not user:
        raise HTTPException(401, "Требуется токен доступа")
    return user


def _sign(doc_id: str, expires: int) -> str:
    msg = f"{doc_id}.{expires}".encode()
    return hmac.new(
        settings.signing_secret.encode(), msg, hashlib.sha256
    ).hexdigest()[:32]


def make_document_link(doc_id: str, ttl: int = DOC_LINK_TTL) -> str:
    expires = int(time.time()) + ttl
    return f"/api/documents/{doc_id}/file?exp={expires}&sig={_sign(doc_id, expires)}"


def verify_document_link(doc_id: str, expires: int, sig: str) -> bool:
    if expires < time.time():
        return False
    return hmac.compare_digest(_sign(doc_id, expires), sig)
