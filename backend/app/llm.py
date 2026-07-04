import json
import re

from openai import APIConnectionError, APIStatusError, APITimeoutError, OpenAI

from .config import settings

# статусы, при которых имеет смысл попробовать другую модель:
# rate limit, перегрузка провайдера, таймауты шлюза
_RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


def _client() -> OpenAI:
    # явный таймаут: зависшая модель быстрее уступает место запасной
    return OpenAI(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        timeout=180.0,
        max_retries=1,
    )


def _models_chain() -> list[str]:
    """Основная модель + запасные из LLM_FALLBACK_MODELS (через запятую)."""
    chain = [settings.llm_model]
    for m in settings.llm_fallback_models.split(","):
        m = m.strip()
        if m and m not in chain:
            chain.append(m)
    return chain


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


def _complete(client: OpenAI, model: str, messages: list[dict]):
    """Один запрос к модели.

    Сначала с response_format=json_object; если провайдер его не
    поддерживает (обычно 400) — повторяем без него. Ретрайабельные
    статусы пробрасываются наверх — их обрабатывает цепочка фолбэка.
    """
    try:
        return client.chat.completions.create(
            model=model,
            temperature=settings.llm_temperature,
            messages=messages,
            response_format={"type": "json_object"},
        )
    except APIStatusError as e:
        if e.status_code in _RETRYABLE_STATUS:
            raise
        return client.chat.completions.create(
            model=model,
            temperature=settings.llm_temperature,
            messages=messages,
        )


def chat_json(system: str, user: str) -> dict:
    """Запрос к LLM с ожиданием JSON-ответа и автофолбэком на запасные модели.

    Причины перехода к следующей модели: 429/5xx/таймаут провайдера
    или невалидный JSON в ответе (пустой/мусорный ответ).
    """
    client = _client()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    last_err: Exception | None = None
    for model in _models_chain():
        try:
            resp = _complete(client, model, messages)
            data = _extract_json(resp.choices[0].message.content or "")
            if model != settings.llm_model:
                print(f"[llm] основная модель недоступна, ответила запасная: {model}")
            return data
        except (APIStatusError, APITimeoutError, APIConnectionError) as e:
            status = getattr(e, "status_code", None)
            if status is not None and status not in _RETRYABLE_STATUS:
                raise  # 401/403/404 и т.п. — фолбэк не поможет
            last_err = e
            print(f"[llm] {model}: {status or type(e).__name__} — пробую следующую модель")
        except (json.JSONDecodeError, IndexError) as e:
            last_err = e
            print(f"[llm] {model}: невалидный ответ — пробую следующую модель")
    raise RuntimeError(
        f"Все модели из цепочки недоступны ({', '.join(_models_chain())}): {last_err}"
    )
