import json
import re

from openai import OpenAI

from .config import settings


def _client() -> OpenAI:
    return OpenAI(api_key=settings.llm_api_key, base_url=settings.llm_base_url)


def _extract_json(text: str) -> dict:
    """Достаёт JSON-объект из ответа модели, даже если он обёрнут в ```-блок."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


def chat_json(system: str, user: str) -> dict:
    """Запрос к LLM с ожиданием JSON-ответа.

    Сначала пробуем response_format=json_object; не все OpenAI-совместимые
    провайдеры его поддерживают, поэтому при ошибке повторяем без него.
    """
    client = _client()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    try:
        resp = client.chat.completions.create(
            model=settings.llm_model,
            temperature=settings.llm_temperature,
            messages=messages,
            response_format={"type": "json_object"},
        )
    except Exception:
        resp = client.chat.completions.create(
            model=settings.llm_model,
            temperature=settings.llm_temperature,
            messages=messages,
        )
    return _extract_json(resp.choices[0].message.content or "{}")
