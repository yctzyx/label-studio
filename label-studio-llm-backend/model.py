import logging
import json
import difflib
import re
import os
import requests
import pytesseract

from PIL import Image, ImageOps
from io import BytesIO
from typing import Union, List, Dict, Optional, Any, Tuple
from tenacity import retry, stop_after_attempt, wait_random
from openai import OpenAI, AzureOpenAI

from label_studio_ml.model import LabelStudioMLBase
from label_studio_ml.response import ModelResponse
from label_studio_sdk.label_interface.objects import PredictionValue
from label_studio_sdk.label_interface.object_tags import ImageTag, ParagraphsTag
from label_studio_sdk.label_interface.control_tags import ControlTag, ObjectTag

logger = logging.getLogger(__name__)


class _SafeDict(dict):
    """dict that leaves unknown {placeholders} untouched during str.format_map,
    so a user prompt referencing a missing task field won't raise KeyError."""

    def __missing__(self, key):
        return '{' + key + '}'


_DEFAULT_CHOICES_JSON_PROMPT = """请判断输入内容中是否清晰出现以下候选标签。

候选标签：
{labels}

判定规则：
1. 只能从候选标签中选择，不能输出候选列表之外的标签。
2. 只有存在清晰、可见、可确认的证据时才选择标签。
3. 模糊、疑似、遮挡严重、画面太小、无法确认时不要选择。
4. 可以选择多个标签。
5. 如果没有任何候选标签命中，输出空 JSON：{{"tags": []}}。

输出要求：
只输出 JSON，不要解释，不要 Markdown，不要代码块。

JSON 格式必须为：
{{"tags": ["标签1", "标签2"]}}"""


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    obj = json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    return None
                return obj if isinstance(obj, dict) else None
    return None


def _parse_json_tags(content: str, allowed_tags: List[str]) -> List[str]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)

    parsed = None
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            parsed = obj
    except json.JSONDecodeError:
        parsed = _extract_json_object(text)

    if not isinstance(parsed, dict):
        logger.warning("Unable to parse model response as JSON object: %s", content[:300])
        return []

    tags_raw = parsed.get("tags")
    if not isinstance(tags_raw, list):
        logger.warning("Model JSON misses list field 'tags': %s", content[:300])
        return []

    allowed = set(allowed_tags)
    result = []
    for item in tags_raw:
        if not isinstance(item, str):
            continue
        tag = item.strip()
        if tag in allowed and tag not in result:
            result.append(tag)
    return result


def _parse_json_object(content: str) -> Optional[Dict[str, Any]]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)

    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return _extract_json_object(text)


def _nested_get(data: Dict[str, Any], path: str) -> Any:
    current = data
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _stringify_text_value(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, (int, float, bool)):
        return [str(value)]
    if isinstance(value, list):
        lines = []
        for item in value:
            lines.extend(_stringify_text_value(item))
        return lines
    if isinstance(value, dict):
        lines = []
        for key, item in value.items():
            child = _stringify_text_value(item)
            if child:
                lines.append(f"{key}：" + "；".join(child))
        return lines
    return [str(value)]


def _filter_allowed_labels(value: Any, allowed_labels: List[str]) -> List[str]:
    raw_labels = value if isinstance(value, list) else [value]
    allowed = set(allowed_labels)
    result = []
    for item in raw_labels:
        if not isinstance(item, str):
            continue
        label = item.strip()
        if label in allowed and label not in result:
            result.append(label)
    return result


_ANTI_FRAUD_TEXT_FIELDS = {
    "key_fraud_phrases": "core_illegal_info.key_fraud_phrases",
    "enticement_phrases": "core_illegal_info.enticement_phrases",
    "payment_accounts": "financial_info.payment_accounts",
    "recharge_buttons": "financial_info.recharge_buttons",
    "customer_contacts": "contact_tracking_info.customer_contacts",
    "app_download": "contact_tracking_info.app_download",
    "website_domain": "contact_tracking_info.website_domain",
    "anti_detection_hints": "critical_notes.anti_detection_hints",
    "salient_anomalies": "critical_notes.salient_anomalies",
}


@retry(wait=wait_random(min=5, max=10), stop=stop_after_attempt(6))
def chat_completion_call(messages, params, *args, **kwargs):
    """
    Request to OpenAI API (OpenAI, Azure)

    Args:
        messages: list of messages
        params: dict with parameters
           Example:
               ```json
              {
                "api_key": "YOUR_API_KEY",
                "provider": "openai",
                "model": "gpt-4",
                "num_responses": 1,
                "temperature": 0.7
                }```
    """
    provider = params.get("provider", OpenAIInteractive.OPENAI_PROVIDER)
    model = params.get("model", OpenAIInteractive.OPENAI_MODEL)
    base_url = params.get("base_url") or None
    api_key = params.get("api_key", OpenAIInteractive.OPENAI_KEY)

    if provider == "azure":
        client = AzureOpenAI(
            api_key=api_key,
            api_version=params.get("api_version", OpenAIInteractive.AZURE_API_VERSION),
            azure_endpoint=params.get('resource_endpoint', OpenAIInteractive.AZURE_RESOURCE_ENDPOINT).rstrip('/'),
            azure_deployment=params.get('deployment_name', OpenAIInteractive.AZURE_DEPLOYMENT_NAME)
        )
        if not model:
            model = 'gpt-35-turbo'
    elif provider == "openai" and not base_url:
        client = OpenAI(api_key=api_key)
        if not model:
            model = 'gpt-3.5-turbo'
    else:
        # Generic OpenAI-compatible providers: ollama / dashscope (Qwen) / deepseek / zhipu / custom,
        # or OpenAI behind a custom gateway. They all share the OpenAI Chat Completions protocol.
        if not base_url and provider == "ollama":
            base_url = OpenAIInteractive.OLLAMA_ENDPOINT
        client = OpenAI(
            base_url=base_url,
            # some local/self-hosted gateways ignore the key but the SDK requires a non-empty value
            api_key=api_key or 'EMPTY',
        )

    # Optional global system prompt shared across the session
    system_prompt = params.get("system_prompt")
    if system_prompt:
        messages = [{"role": "system", "content": system_prompt}] + list(messages)

    request_params = {
        "messages": messages,
        "model": model,
        "n": params.get("num_responses", OpenAIInteractive.NUM_RESPONSES),
        "temperature": params.get("temperature", OpenAIInteractive.TEMPERATURE)
    }

    completion = client.chat.completions.create(**request_params)

    return completion


def gpt(messages: Union[List[Dict], str], params, *args, **kwargs):
    """
    """
    if isinstance(messages, str):
        messages = [{"role": "user", "content": messages}]

    logger.debug(f"OpenAI request: {messages}, params={params}")
    completion = chat_completion_call(messages, params)
    logger.debug(f"OpenAI response: {completion}")
    response = [choice.message.content for choice in completion.choices]

    return response


class OpenAIInteractive(LabelStudioMLBase):
    """
    """
    OPENAI_PROVIDER = os.getenv("OPENAI_PROVIDER", "openai")
    OPENAI_KEY = os.getenv('OPENAI_API_KEY')
    PROMPT_PREFIX = os.getenv("PROMPT_PREFIX", "prompt")
    USE_INTERNAL_PROMPT_TEMPLATE = bool(int(os.getenv("USE_INTERNAL_PROMPT_TEMPLATE", 1)))
    # if set, this prompt will be used at the beginning of the session
    DEFAULT_PROMPT = os.getenv('DEFAULT_PROMPT')
    PROMPT_TEMPLATE = os.getenv("PROMPT_TEMPLATE", '**Source Text**:\n\n"{text}"\n\n**Task Directive**:\n\n"{prompt}"')
    PROMPT_TAG = "TextArea"
    SUPPORTED_INPUTS = ("Image", "Text", "HyperText", "Paragraphs")
    NUM_RESPONSES = int(os.getenv("NUM_RESPONSES", 1))
    TEMPERATURE = float(os.getenv("TEMPERATURE", 0.7))
    OPENAI_MODEL = os.getenv("OPENAI_MODEL")
    AZURE_RESOURCE_ENDPOINT = os.getenv("AZURE_RESOURCE_ENDPOINT", '')
    AZURE_DEPLOYMENT_NAME = os.getenv("AZURE_DEPLOYMENT_NAME")
    AZURE_API_VERSION = os.getenv("AZURE_API_VERSION", "2023-05-15")
    OLLAMA_ENDPOINT = os.getenv("OLLAMA_ENDPOINT")

    def setup(self):
        if self.DEFAULT_PROMPT and os.path.isfile(self.DEFAULT_PROMPT):
            logger.info(f"Reading default prompt from file: {self.DEFAULT_PROMPT}")
            with open(self.DEFAULT_PROMPT) as f:
                self.DEFAULT_PROMPT = f.read()

    def _ocr(self, image_url):
        # Open the image containing the text
        response = requests.get(image_url)
        image = Image.open(BytesIO(response.content))
        image = ImageOps.exif_transpose(image)

        # Run OCR on the image
        text = pytesseract.image_to_string(image)
        return text

    def _get_text(self, task_data, object_tag):
        """
        """
        data = task_data.get(object_tag.value_name)

        if data is None:
            return None

        if isinstance(object_tag, ImageTag):
            return self._ocr(data)
        elif isinstance(object_tag, ParagraphsTag):
            return json.dumps(data)
        else:
            return data

    def _get_prompts(self, context, prompt_tag) -> List[str]:
        """Getting prompt values
        """
        if context and prompt_tag:
            # Interactive mode - get prompt from context
            result = context.get('result') or []
            for item in result:
                if item.get('from_name') == prompt_tag.name:
                    return item['value']['text']
        # Initializing - get existing prompt from storage
        if prompt_tag and (prompt := self.get(prompt_tag.name)):
            return [prompt]
        # Prompt configured through the Label Studio UI (extra_params.prompt)
        if self.extra_params.get('prompt'):
            return [self.extra_params.get('prompt')]
        # Default prompt
        if self.DEFAULT_PROMPT:
            if self.USE_INTERNAL_PROMPT_TEMPLATE:
                logger.error('Using both `DEFAULT_PROMPT` and `USE_INTERNAL_PROMPT_TEMPLATE` is not supported. '
                             'Please either specify `USE_INTERNAL_PROMPT_TEMPLATE=0` or remove `DEFAULT_PROMPT`. '
                             'For now, no prompt will be used.')
                return []
            return [self.DEFAULT_PROMPT]

        return []

    def _get_prompt_or_default(self, context, prompt_tag, labels: Optional[List[str]] = None) -> str:
        prompts = self._get_prompts(context, prompt_tag)
        if prompts:
            return "\n".join(prompts)
        if self.extra_params.get("output_mode") == "choices_json":
            return _DEFAULT_CHOICES_JSON_PROMPT
        return ""

    def _match_choices(self, response: List[str], original_choices: List[str]) -> List[str]:
        # assuming classes are separated by newlines
        # TODO: support other guardrails
        matched_labels = []
        predicted_classes = response[0].splitlines()

        for pred in predicted_classes:
            scores = list(map(lambda l: difflib.SequenceMatcher(None, pred, l).ratio(), original_choices))
            matched_labels.append(original_choices[scores.index(max(scores))])

        return matched_labels

    def _find_choices_tag(self, object_tag):
        """Classification predictor
        """
        li = self.label_interface

        try:
            choices_from_name, _, _ = li.get_first_tag_occurence(
                'Choices',
                self.SUPPORTED_INPUTS,
                to_name_filter=lambda s: s == object_tag.name,
            )

            return li.get_control(choices_from_name)
        except:
            return None

    def _find_textarea_tag(self, prompt_tag, object_tag):
        """Free-form text predictor
        """
        li = self.label_interface

        try:
            textarea_from_name, _, _ = li.get_first_tag_occurence(
                'TextArea',
                self.SUPPORTED_INPUTS,
                name_filter=lambda s: s != prompt_tag.name,
                to_name_filter=lambda s: s == object_tag.name,
            )

            return li.get_control(textarea_from_name)
        except:
            return None

    def _find_prompt_tags(self) -> Tuple[ControlTag, ObjectTag]:
        """Find prompting tags in the config
        """
        li = self.label_interface
        prompt_name = self.extra_params.get("prompt_from_name")
        name_filter = (
            (lambda s: s == prompt_name)
            if prompt_name
            else (lambda s: s.startswith(self.PROMPT_PREFIX) or "prompt" in s.lower())
        )
        prompt_from_name, prompt_to_name, value = li.get_first_tag_occurence(
            # prompt tag
            self.PROMPT_TAG,
            # supported input types
            self.SUPPORTED_INPUTS,
            # if multiple <TextArea> are presented, use one with prefix specified in PROMPT_PREFIX
            name_filter=name_filter)

        return li.get_control(prompt_from_name), li.get_object(prompt_to_name)

    def _find_choices_tags(self) -> Tuple[ControlTag, ObjectTag]:
        li = self.label_interface
        choices_name = self.extra_params.get("choices_from_name")
        name_filter = (lambda s: s == choices_name) if choices_name else None
        choices_from_name, choices_to_name, value = li.get_first_tag_occurence(
            "Choices",
            self.SUPPORTED_INPUTS,
            name_filter=name_filter,
        )
        return li.get_control(choices_from_name), li.get_object(choices_to_name)

    def _find_optional_prompt_tag(self, object_tag) -> Optional[ControlTag]:
        try:
            return self._find_prompt_tags()[0]
        except Exception:
            return None

    def _validate_tags(self, choices_tag: str, textarea_tag: str) -> None:
        if not choices_tag and not textarea_tag:
            raise ValueError('No supported tags found: <Choices> or <TextArea>')

    def _has_inlined_media(self, value) -> bool:
        if isinstance(value, str) and value.startswith('data:'):
            return True
        if isinstance(value, dict):
            return any(self._has_inlined_media(item) for item in value.values())
        if isinstance(value, list):
            return any(self._has_inlined_media(item) for item in value)
        return False

    def _prepare_task_data(self, task: Dict) -> Dict:
        data = task.get('data', {})
        if self._has_inlined_media(data):
            return data
        return self.preload_task_data(task, data)

    def _generate_normalized_prompt(self, text: str, prompt: str, task_data: Dict, labels: Optional[List[str]]) -> str:
        """
        """
        # UI-configured options (extra_params) take precedence over env defaults
        use_internal_template = self.extra_params.get(
            'use_internal_prompt_template', self.USE_INTERNAL_PROMPT_TEMPLATE
        )
        prompt_template = self.extra_params.get('prompt_template', self.PROMPT_TEMPLATE)

        if use_internal_template:
            norm_prompt = prompt_template.format(text=text, prompt=prompt, labels=labels)
        else:
            # tolerate prompts that reference task fields which may be missing
            format_kwargs = _SafeDict({**task_data, 'labels': labels, 'text': text})
            norm_prompt = prompt.format_map(format_kwargs)

        return norm_prompt

    def _generate_response_regions(self, response: List[str], prompt_tag,
                                   choices_tag: ControlTag, textarea_tag: ControlTag, prompts: List[str]) -> List:
        """
        """
        regions = []

        if choices_tag and len(response) > 0:
            matched_labels = self._match_choices(response, choices_tag.labels)
            regions.append(choices_tag.label(matched_labels))

        if textarea_tag:
            regions.append(textarea_tag.label(text=response))

        # not sure why we need this but it was in the original code
        regions.append(prompt_tag.label(text=prompts))

        return regions

    def _predict_single_task(self, task_data: Dict, prompt_tag: Any, object_tag: Any, prompt: str,
                             choices_tag: ControlTag, textarea_tag: ControlTag, prompts: List[str]) -> Dict:
        """
        """
        # Add {labels} to the prompt if choices tag is present
        labels = choices_tag.labels if choices_tag else None

        model_type = self.extra_params.get('model_type', 'text')
        is_vision = model_type == 'vision' and isinstance(object_tag, ImageTag)

        if is_vision:
            # Multimodal: send the image directly to a vision model instead of OCR
            image_url = task_data.get(object_tag.value_name)
            norm_prompt = self._generate_normalized_prompt('', prompt, task_data, labels=labels)
            messages = [{
                'role': 'user',
                'content': [
                    {'type': 'text', 'text': norm_prompt},
                    {'type': 'image_url', 'image_url': {'url': image_url}},
                ],
            }]
            response = gpt(messages, self.extra_params)
        else:
            text = self._get_text(task_data, object_tag)
            norm_prompt = self._generate_normalized_prompt(text, prompt, task_data, labels=labels)
            # run inference; params are provided through the web interface (extra_params)
            response = gpt(norm_prompt, self.extra_params)

        regions = self._generate_response_regions(response, prompt_tag, choices_tag, textarea_tag, prompts)

        return PredictionValue(result=regions, score=0.1, model_version=str(self.model_version))

    def _predict_choices_json_single_task(
        self,
        task_data: Dict,
        object_tag: ObjectTag,
        choices_tag: ControlTag,
        prompt_tag: Optional[ControlTag],
        prompt: str,
    ) -> Dict:
        labels = choices_tag.labels
        norm_prompt = self._generate_normalized_prompt("", prompt, task_data, labels=labels)
        model_type = self.extra_params.get('model_type', 'text')
        is_vision = model_type == 'vision' and isinstance(object_tag, ImageTag)
        logger.info(
            "Choices JSON prediction: object=%s choices=%s model_type=%s vision=%s",
            object_tag.name,
            labels,
            model_type,
            is_vision,
        )

        if is_vision:
            image_url = task_data.get(object_tag.value_name)
            image_preview = image_url[:10] if isinstance(image_url, str) else image_url
            logger.info("Choices JSON image_url=%s", image_preview)
            messages = [{
                'role': 'user',
                'content': [
                    {'type': 'text', 'text': norm_prompt},
                    {'type': 'image_url', 'image_url': {'url': image_url}},
                ],
            }]
            response = gpt(messages, self.extra_params)
        else:
            text = self._get_text(task_data, object_tag)
            norm_prompt = self._generate_normalized_prompt(text, prompt, task_data, labels=labels)
            response = gpt(norm_prompt, self.extra_params)

        content = response[0] if response else ""
        matched_labels = _parse_json_tags(content, labels)
        logger.info("Choices JSON raw_response=%s", content[:1000])
        logger.info("Choices JSON matched_labels=%s", matched_labels)
        regions = []
        if matched_labels:
            regions.append(choices_tag.label(matched_labels))
        return PredictionValue(result=regions, score=0.1, model_version=str(self.model_version))

    def _predict_choices_json(self, tasks: List[Dict], context: Optional[Dict]) -> ModelResponse:
        choices_tag, object_tag = self._find_choices_tags()
        prompt_tag = self._find_optional_prompt_tag(object_tag)
        prompt = self._get_prompt_or_default(context, prompt_tag, choices_tag.labels)

        predictions = []
        for task in tasks:
            task_data = self._prepare_task_data(task)
            predictions.append(
                self._predict_choices_json_single_task(
                    task_data,
                    object_tag,
                    choices_tag,
                    prompt_tag,
                    prompt,
                )
            )
        return ModelResponse(predictions=predictions)

    def _get_control_by_name(self, name: str) -> Optional[ControlTag]:
        try:
            return self.label_interface.get_control(name)
        except Exception:
            return None

    def _get_object_by_name(self, name: str) -> Optional[ObjectTag]:
        try:
            return self.label_interface.get_object(name)
        except Exception:
            return None

    def _find_anti_fraud_tags(self) -> Tuple[ObjectTag, Dict[str, ControlTag], Dict[str, ControlTag]]:
        li = self.label_interface
        image_name = self.extra_params.get("image_object_name", "image")
        main_name = self.extra_params.get("main_illegal_types_from_name", "main_illegal_types")
        fraud_name = self.extra_params.get("fraud_types_from_name", "fraud_types")

        object_tag = self._get_object_by_name(image_name)
        if object_tag is None:
            _, to_name, _ = li.get_first_tag_occurence(
                "Choices",
                self.SUPPORTED_INPUTS,
                name_filter=lambda name: name in {main_name, fraud_name},
            )
            object_tag = li.get_object(to_name)

        choices_controls = {}
        main_control = self._get_control_by_name(main_name)
        if main_control:
            choices_controls["main_illegal_types"] = main_control
        fraud_control = self._get_control_by_name(fraud_name)
        if fraud_control:
            choices_controls["fraud_types"] = fraud_control

        if not choices_controls:
            raise ValueError("No anti-fraud Choices controls found: main_illegal_types / fraud_types")

        text_controls = {}
        for name in [*_ANTI_FRAUD_TEXT_FIELDS.keys(), self.extra_params.get("raw_json_to_name", "raw_json")]:
            if not name:
                continue
            control = self._get_control_by_name(name)
            if control:
                text_controls[name] = control

        return object_tag, choices_controls, text_controls

    def _build_anti_fraud_prompt(
        self,
        prompt: str,
        task_data: Dict,
        main_labels: List[str],
        fraud_labels: List[str],
    ) -> str:
        data = {
            **task_data,
            "main_illegal_types": main_labels,
            "fraud_types": fraud_labels,
            "labels": {
                "main_illegal_types": main_labels,
                "fraud_types": fraud_labels,
            },
        }
        return self._generate_normalized_prompt("", prompt, data, labels=data["labels"])

    def _predict_anti_fraud_json_single_task(
        self,
        task_data: Dict,
        object_tag: ObjectTag,
        choices_controls: Dict[str, ControlTag],
        text_controls: Dict[str, ControlTag],
        prompt: str,
    ) -> Dict:
        main_control = choices_controls.get("main_illegal_types")
        fraud_control = choices_controls.get("fraud_types")
        main_labels = main_control.labels if main_control else []
        fraud_labels = fraud_control.labels if fraud_control else []
        norm_prompt = self._build_anti_fraud_prompt(prompt, task_data, main_labels, fraud_labels)
        model_type = self.extra_params.get("model_type", "text")
        is_vision = model_type == "vision" and isinstance(object_tag, ImageTag)

        logger.info(
            "Anti-fraud JSON prediction: object=%s main_choices=%s fraud_choices=%s vision=%s",
            object_tag.name,
            main_labels,
            fraud_labels,
            is_vision,
        )

        if is_vision:
            image_url = task_data.get(object_tag.value_name)
            image_preview = image_url[:10] if isinstance(image_url, str) else image_url
            logger.info("Anti-fraud JSON image_url=%s", image_preview)
            messages = [{
                "role": "user",
                "content": [
                    {"type": "text", "text": norm_prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }]
            response = gpt(messages, self.extra_params)
        else:
            text = self._get_text(task_data, object_tag)
            data = {**task_data, "text": text}
            data.update({
                "main_illegal_types": main_labels,
                "fraud_types": fraud_labels,
                "labels": {
                    "main_illegal_types": main_labels,
                    "fraud_types": fraud_labels,
                },
            })
            norm_prompt = self._generate_normalized_prompt(text, prompt, data, labels=data["labels"])
            response = gpt(norm_prompt, self.extra_params)

        content = response[0] if response else ""
        parsed = _parse_json_object(content)
        logger.info("Anti-fraud JSON raw_response=%s", content[:1000])

        regions = []
        raw_json_control = text_controls.get(self.extra_params.get("raw_json_to_name", "raw_json"))
        if not isinstance(parsed, dict):
            logger.warning("Unable to parse anti-fraud response as JSON object: %s", content[:300])
            if raw_json_control and content:
                regions.append(raw_json_control.label(text=[content[:4000]]))
            return PredictionValue(result=regions, score=0.1, model_version=str(self.model_version))

        if parsed.get("is_suspicious") in (0, "0", False):
            return PredictionValue(result=[], score=0.1, model_version=str(self.model_version))

        if main_control:
            values = _nested_get(parsed, "core_illegal_info.main_illegal_types")
            matched = _filter_allowed_labels(values, main_labels)
            if matched:
                regions.append(main_control.label(matched))

        if fraud_control:
            values = _nested_get(parsed, "core_illegal_info.fraud_types")
            matched = _filter_allowed_labels(values, fraud_labels)
            if matched:
                regions.append(fraud_control.label(matched))

        for control_name, json_path in _ANTI_FRAUD_TEXT_FIELDS.items():
            control = text_controls.get(control_name)
            if not control:
                continue
            lines = _stringify_text_value(_nested_get(parsed, json_path))
            if lines:
                regions.append(control.label(text=lines))

        if raw_json_control:
            raw_json = json.dumps(parsed, ensure_ascii=False, indent=2)
            regions.append(raw_json_control.label(text=[raw_json[:4000]]))

        return PredictionValue(result=regions, score=0.1, model_version=str(self.model_version))

    def _predict_anti_fraud_json(self, tasks: List[Dict], context: Optional[Dict]) -> ModelResponse:
        object_tag, choices_controls, text_controls = self._find_anti_fraud_tags()
        prompt_tag = self._find_optional_prompt_tag(object_tag)
        prompt = self._get_prompt_or_default(context, prompt_tag)

        predictions = []
        for task in tasks:
            task_data = self._prepare_task_data(task)
            predictions.append(
                self._predict_anti_fraud_json_single_task(
                    task_data,
                    object_tag,
                    choices_controls,
                    text_controls,
                    prompt,
                )
            )
        return ModelResponse(predictions=predictions)

    def predict(self, tasks: List[Dict], context: Optional[Dict] = None, **kwargs) -> ModelResponse:
        """
        """
        if self.extra_params.get("output_mode") == "choices_json":
            return self._predict_choices_json(tasks, context)
        if self.extra_params.get("output_mode") == "anti_fraud_json":
            return self._predict_anti_fraud_json(tasks, context)

        predictions = []

        # prompt tag contains the prompt in the config
        # object tag contains what we plan to label
        prompt_tag, object_tag = self._find_prompt_tags()
        prompts = self._get_prompts(context, prompt_tag)

        if prompts:
            prompt = "\n".join(prompts)

            choices_tag = self._find_choices_tag(object_tag)
            textarea_tag = self._find_textarea_tag(prompt_tag, object_tag)
            self._validate_tags(choices_tag, textarea_tag)

            for task in tasks:
                # Label Studio may inline images as base64; skip remote fetch in that case
                task_data = self._prepare_task_data(task)
                pred = self._predict_single_task(task_data, prompt_tag, object_tag, prompt,
                                                 choices_tag, textarea_tag, prompts)
                predictions.append(pred)

        return ModelResponse(predictions=predictions)

    def _prompt_diff(self, old_prompt, new_prompt):
        """
        """
        old_lines = old_prompt.splitlines()
        new_lines = new_prompt.splitlines()
        diff = difflib.unified_diff(old_lines, new_lines, lineterm="")

        return "\n".join(
            line for line in diff if line.startswith(('+',)) and not line.startswith(('+++', '---')))

    def fit(self, event, data, **additional_params):
        """
        """
        logger.debug(f'Data received: {data}')
        if event not in ('ANNOTATION_CREATED', 'ANNOTATION_UPDATED'):
            return

        prompt_tag, object_tag = self._find_prompt_tags()
        prompts = self._get_prompts(data['annotation'], prompt_tag)

        if not prompts:
            logger.debug(f'No prompts recorded.')
            return

        prompt = '\n'.join(prompts)
        current_prompt = self.get(prompt_tag.name)

        # find substrings that differ between current and new prompt
        # if there are no differences, skip training
        if current_prompt:
            diff = self._prompt_diff(current_prompt, prompt)
            if not diff:
                logger.debug('No prompt diff found.')
                return

            logger.debug(f'Prompt diff: {diff}')
        self.set(prompt_tag.name, prompt)
        model_version = self.bump_model_version()

        logger.debug(f'Updated model version to {str(model_version)}')
