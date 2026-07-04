import hashlib
from pathlib import Path

from pydantic_settings import BaseSettings

# Корень проекта: HAC/ (config.py лежит в HAC/backend/app/)
ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "backend" / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
CHROMA_DIR = DATA_DIR / "chroma"
FEEDBACK_FILE = DATA_DIR / "feedback.json"
DOCUMENTS_FILE = DATA_DIR / "documents.json"


class Settings(BaseSettings):
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    llm_fallback_models: str = ""  # запасные модели через запятую (фолбэк при 429/5xx)
    llm_temperature: float = 0.4
    demo_mode: str = "auto"  # auto | on | off

    # Граф знаний: если Neo4j недоступен, автоматически используется
    # встроенное хранилище (networkx + JSON)
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "hypothesis-factory"

    # Аутентификация: «токен:Имя,токен2:Имя2»; пусто — выключена
    app_tokens: str = ""
    # Секрет подписи ссылок на документы; пусто — выводится из APP_TOKENS
    app_secret: str = ""

    @property
    def token_users(self) -> dict[str, str]:
        users: dict[str, str] = {}
        for pair in self.app_tokens.split(","):
            pair = pair.strip()
            if not pair:
                continue
            token, _, name = pair.partition(":")
            if token.strip():
                users[token.strip()] = name.strip() or f"user-{token.strip()[:6]}"
        return users

    @property
    def auth_enabled(self) -> bool:
        return bool(self.token_users)

    @property
    def signing_secret(self) -> str:
        if self.app_secret:
            return self.app_secret
        return hashlib.sha256(f"doc-links:{self.app_tokens}".encode()).hexdigest()

    model_config = {"env_file": str(ROOT / ".env"), "extra": "ignore"}

    @property
    def is_demo(self) -> bool:
        if self.demo_mode == "on":
            return True
        if self.demo_mode == "off":
            return False
        return not self.llm_api_key.strip()


settings = Settings()

for d in (DATA_DIR, UPLOADS_DIR, CHROMA_DIR):
    d.mkdir(parents=True, exist_ok=True)
