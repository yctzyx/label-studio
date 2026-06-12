import json
import logging
import re

BASE64_LOG_PREFIX_LEN = 10
LONG_STRING_THRESHOLD = 100


def _truncate_str(value: str, prefix_len: int = BASE64_LOG_PREFIX_LEN) -> str:
    if len(value) <= prefix_len:
        return value
    return f"{value[:prefix_len]}...<len={len(value)}>"


def _looks_like_base64(value: str) -> bool:
    if len(value) < LONG_STRING_THRESHOLD:
        return False
    sample = re.sub(r"\s+", "", value[:512])
    return bool(re.fullmatch(r"[A-Za-z0-9+/=_-]+", sample))


def _sanitize_str(value: str, prefix_len: int = BASE64_LOG_PREFIX_LEN) -> str:
    if ";base64," in value:
        head, _, payload = value.partition(";base64,")
        return f"{head};base64,{_truncate_str(payload, prefix_len)}"
    if value.startswith("data:") and len(value) > prefix_len + 20:
        return f"{value[:prefix_len]}...<data-uri len={len(value)}>"
    if _looks_like_base64(value):
        return f"{value[:prefix_len]}...<base64 len={len(value)}>"
    if len(value) > 500:
        return f"{value[:prefix_len]}...<long-string len={len(value)}>"
    return value


def safe_log_value(value, prefix_len: int = BASE64_LOG_PREFIX_LEN):
    if isinstance(value, bytes):
        try:
            text = value.decode("utf-8")
        except UnicodeDecodeError:
            return f"<bytes len={len(value)}>"
        try:
            return safe_log_value(json.loads(text), prefix_len)
        except json.JSONDecodeError:
            return _sanitize_str(text, prefix_len)

    if isinstance(value, str):
        stripped = value.lstrip()
        if stripped.startswith(("{", "[")):
            try:
                return safe_log_value(json.loads(value), prefix_len)
            except json.JSONDecodeError:
                pass
        return _sanitize_str(value, prefix_len)

    if isinstance(value, (list, tuple)):
        return [safe_log_value(item, prefix_len) for item in value]

    if isinstance(value, dict):
        return {key: safe_log_value(item, prefix_len) for key, item in value.items()}

    if isinstance(value, Exception):
        return _sanitize_str(str(value), prefix_len)

    return value


class TruncateBase64LogFilter(logging.Filter):
    def filter(self, record):
        if record.args:
            if isinstance(record.args, tuple):
                record.args = tuple(safe_log_value(item) for item in record.args)
            elif isinstance(record.args, dict):
                record.args = {key: safe_log_value(item) for key, item in record.args.items()}
            else:
                record.args = safe_log_value(record.args)

        if isinstance(record.msg, str) and len(record.msg) > LONG_STRING_THRESHOLD:
            record.msg = safe_log_value(record.msg)

        return True


def install_safe_logging():
    root_logger = logging.getLogger()
    for existing in root_logger.filters:
        if isinstance(existing, TruncateBase64LogFilter):
            return

    root_logger.addFilter(TruncateBase64LogFilter())

    try:
        import label_studio_ml.api as api

        def log_request_info():
            api.logger.debug("Request headers: %s", safe_log_value(dict(request.headers)))
            api.logger.debug("Request body: %s", safe_log_value(request.get_data()))

        def log_response_info(response):
            api.logger.debug("Response status: %s", response.status)
            api.logger.debug("Response headers: %s", safe_log_value(dict(response.headers)))
            api.logger.debug("Response body: %s", safe_log_value(response.get_data()))
            return response

        from flask import request

        api._server.before_request_funcs[None].remove(api.log_request_info)
        api._server.after_request_funcs[None].remove(api.log_response_info)
        api._server.before_request(log_request_info)
        api._server.after_request(log_response_info)
    except Exception:
        logging.getLogger(__name__).debug("Skip patching label_studio_ml.api request logging", exc_info=True)
