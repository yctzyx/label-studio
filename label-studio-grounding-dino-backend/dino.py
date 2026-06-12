import base64
import logging
import os
import pathlib
import re
import tempfile
from typing import Dict, List, Optional
from uuid import uuid4

import torch
from groundingdino.util import box_ops
from groundingdino.util.inference import load_image, load_model, predict
from label_studio_ml.model import LabelStudioMLBase, ModelResponse

from log_utils import safe_log_value

logger = logging.getLogger(__name__)


GROUNDING_DINO_CONFIG = os.getenv("GROUNDING_DINO_CONFIG", "GroundingDINO_SwinT_OGC.py")
GROUNDING_DINO_WEIGHTS = os.getenv("GROUNDING_DINO_WEIGHTS", "groundingdino_swint_ogc.pth")
GROUNDINGDINO_REPO_PATH = pathlib.Path(os.getenv("GROUNDINGDINO_REPO_PATH", "./GroundingDINO"))
DEFAULT_PROMPT = os.getenv("DEFAULT_PROMPT", "")
DEFAULT_BOX_THRESHOLD = os.getenv("BOX_THRESHOLD", "0.30")
DEFAULT_TEXT_THRESHOLD = os.getenv("TEXT_THRESHOLD", "0.25")
AUTO_PROMPT_FROM_LABELS = os.getenv("AUTO_PROMPT_FROM_LABELS", "1").lower() not in ("0", "false", "no")
DEFAULT_MAX_BOXES_PER_IMAGE = int(os.getenv("MAX_BOXES_PER_IMAGE", "100"))

device = "cuda" if torch.cuda.is_available() else "cpu"
logger.info("Using device %s", device)

_groundingdino_model = None


def get_groundingdino_model():
    global _groundingdino_model
    if _groundingdino_model is None:
        config_path = GROUNDINGDINO_REPO_PATH / "groundingdino" / "config" / GROUNDING_DINO_CONFIG
        weights_path = GROUNDINGDINO_REPO_PATH / "weights" / GROUNDING_DINO_WEIGHTS
        logger.info("Loading Grounding DINO config=%s weights=%s", config_path, weights_path)
        _groundingdino_model = load_model(config_path, weights_path)
    return _groundingdino_model


class GroundingDINO(LabelStudioMLBase):
    def setup(self):
        self.set("model_version", "GroundingDINO-v1")

    def _vision_config(self) -> Dict:
        params = self.extra_params or {}
        return params if params.get("_vision_preannotation") else {}

    def _get_first_tag_or_none(self, control_type: str, object_type: str, **kwargs):
        try:
            return self.get_first_tag_occurence(control_type, object_type, **kwargs)
        except Exception as exc:
            logger.debug("Control %s for %s not found: %s", control_type, object_type, exc)
            return None, None, None

    def _get_rectangle_label_aliases(self, from_name: str) -> Dict:
        config = self._vision_config()
        configured_labels = config.get("labels") or []
        if configured_labels:
            aliases = {}
            for item in configured_labels:
                if not item.get("enabled", True):
                    continue
                label = item.get("label")
                if not label:
                    continue
                values = {label, label.lower()}
                prompt = item.get("prompt")
                if prompt:
                    values.add(prompt)
                    values.add(prompt.lower())
                for alias in item.get("aliases") or []:
                    if alias:
                        values.add(alias)
                        values.add(alias.lower())
                aliases[label] = values
            if aliases:
                return aliases

        schema = self.parsed_label_config.get(from_name, {})
        labels = schema.get("labels", [])
        labels_attrs = schema.get("labels_attrs", {})
        aliases = {}

        for label in labels:
            values = {label, label.lower()}
            predicted_values = labels_attrs.get(label, {}).get("predicted_values", "")
            for predicted_value in predicted_values.split(","):
                predicted_value = predicted_value.strip()
                if predicted_value:
                    values.add(predicted_value)
                    values.add(predicted_value.lower())
            aliases[label] = values

        return aliases

    def _build_prompt_from_labels(self, from_name: str) -> str:
        if not AUTO_PROMPT_FROM_LABELS:
            return ""

        config = self._vision_config()
        prompt_config = config.get("prompt") or {}
        if prompt_config.get("mode") == "manual" and prompt_config.get("manual_prompt"):
            return prompt_config["manual_prompt"]

        configured_labels = config.get("labels") or []
        if configured_labels:
            prompt_terms = [
                item.get("prompt") or item.get("label")
                for item in configured_labels
                if item.get("enabled", True) and (item.get("prompt") or item.get("label"))
            ]
            prompt = (prompt_config.get("joiner") or ", ").join(dict.fromkeys(prompt_terms))
            logger.info("Auto prompt from vision config: %s", prompt)
            return prompt

        schema = self.parsed_label_config.get(from_name, {})
        labels = schema.get("labels", [])
        labels_attrs = schema.get("labels_attrs", {})
        prompt_terms = []

        for label in labels:
            predicted_values = labels_attrs.get(label, {}).get("predicted_values", "")
            aliases = [value.strip() for value in predicted_values.split(",") if value.strip()]
            prompt_terms.append(aliases[0] if aliases else label)

        prompt = ", ".join(dict.fromkeys(prompt_terms))
        logger.info("Auto prompt from RectangleLabels: %s", prompt)
        return prompt

    def _resolve_image_path(self, raw_img_path, task_id=None) -> str:
        if isinstance(raw_img_path, str) and raw_img_path.startswith("data:") and ";base64," in raw_img_path:
            header, _, encoded = raw_img_path.partition(";base64,")
            ext = ".png"
            if "image/jpeg" in header or "image/jpg" in header:
                ext = ".jpg"
            elif "image/webp" in header:
                ext = ".webp"
            elif "image/gif" in header:
                ext = ".gif"

            image_bytes = base64.b64decode(encoded)
            fd, path = tempfile.mkstemp(suffix=ext, prefix=f"task_{task_id or 'unknown'}_")
            os.close(fd)
            with open(path, "wb") as image_file:
                image_file.write(image_bytes)
            logger.info("Decoded inline base64 image to %s (%d bytes)", path, len(image_bytes))
            return path

        return self.get_local_path(raw_img_path, task_id=task_id)

    def _match_label(self, phrase: str, label_aliases: Dict) -> Optional[str]:
        normalized_phrase = phrase.lower().strip()
        phrase_tokens = set(re.split(r"[\s,.;:/|]+", normalized_phrase))

        for label, aliases in label_aliases.items():
            for alias in aliases:
                normalized_alias = alias.lower().strip()
                if not normalized_alias:
                    continue
                if normalized_alias == normalized_phrase:
                    return label
                if normalized_alias in phrase_tokens:
                    return label
                if normalized_alias in normalized_phrase:
                    return label
        return None

    def _get_prompt(self, rectangle_from_name: str, annotation: Optional[Dict] = None) -> Dict:
        from_name_prompt, _, _ = self._get_first_tag_or_none("TextArea", "Image")

        if from_name_prompt and annotation and "result" in annotation:
            prompt = next(
                (
                    r["value"]["text"][0]
                    for r in annotation["result"]
                    if r.get("from_name") == from_name_prompt and r.get("value", {}).get("text")
                ),
                "",
            )
            logger.debug("Prompt from annotation: %s", prompt)
            if prompt:
                return {"prompt": prompt, "from_name": from_name_prompt, "source": "annotation"}

        label_prompt = self._build_prompt_from_labels(rectangle_from_name)
        if label_prompt:
            return {"prompt": label_prompt, "from_name": from_name_prompt, "source": "label_config"}

        if DEFAULT_PROMPT:
            logger.debug("Prompt from env: %s", DEFAULT_PROMPT)
            return {"prompt": DEFAULT_PROMPT, "from_name": from_name_prompt, "source": "env"}

        prompt = self.get("prompt") or ""
        logger.debug("Prompt from cache: %s", prompt)
        return {"prompt": prompt, "from_name": from_name_prompt, "source": "cache"}

    def _read_number_control(self, control_prefix: str, annotation: Optional[Dict], fallback: str) -> Dict:
        try:
            from_name, _, _ = self.get_first_tag_occurence(
                "Number",
                "Image",
                name_filter=lambda name: name.startswith(control_prefix),
            )
        except Exception as exc:
            logger.info("Number control %s not found, using default %s: %s", control_prefix, fallback, exc)
            return {"value": fallback, "from_name": None}

        value = None
        if annotation and "result" in annotation:
            value = next(
                (
                    r["value"]["number"]
                    for r in annotation["result"]
                    if r.get("from_name") == from_name and "number" in r.get("value", {})
                ),
                None,
            )
        else:
            value = self.get(from_name)

        return {"value": value if value not in (None, "") else fallback, "from_name": from_name}

    def _get_thresholds(self, annotation: Optional[Dict] = None) -> Dict:
        config = self._vision_config()
        thresholds = config.get("thresholds") or {}
        box_default = thresholds.get("box_threshold", DEFAULT_BOX_THRESHOLD)
        text_default = thresholds.get("text_threshold", DEFAULT_TEXT_THRESHOLD)

        box = self._read_number_control("box_threshold", annotation, str(box_default))
        text = self._read_number_control("text_threshold", annotation, str(text_default))
        out = {
            "box_threshold": float(box["value"]),
            "text_threshold": float(text["value"]),
            "from_name_box": box["from_name"],
            "from_name_text": text["from_name"],
        }
        logger.info("Thresholds: %s", out)
        return out

    def get_results(self, all_points, all_scores, all_lengths, phrases, from_name_r, to_name_r):
        results = []
        total_score = 0
        label_aliases = self._get_rectangle_label_aliases(from_name_r)
        fallback_label = next(iter(label_aliases), None)
        policy = (self._vision_config().get("prediction_policy") or {})
        unmapped_policy = policy.get("unmapped_policy", "discard")
        max_boxes = int(policy.get("max_boxes_per_image") or DEFAULT_MAX_BOXES_PER_IMAGE)

        for points, scores, lengths, phrase in zip(all_points, all_scores, all_lengths, phrases):
            if len(results) >= max_boxes:
                break
            label_id = str(uuid4())[:9]
            height, width = lengths
            score = scores.item()
            label = self._match_label(phrase, label_aliases)
            if not label and unmapped_policy == "first_label":
                label = fallback_label
            if not label and unmapped_policy == "discard":
                continue
            total_score += score

            result = {
                "id": label_id,
                "from_name": from_name_r,
                "to_name": to_name_r,
                "original_width": width,
                "original_height": height,
                "image_rotation": 0,
                "value": {
                    "rotation": 0,
                    "width": (points[2] - points[0]) / width * 100,
                    "height": (points[3] - points[1]) / height * 100,
                    "x": points[0] / width * 100,
                    "y": points[1] / height * 100,
                },
                "score": score,
                "type": "rectanglelabels",
                "meta": {"text": [phrase]},
            }

            if label:
                result["value"]["rectanglelabels"] = [label]

            results.append(result)

        total_score /= max(len(results), 1)
        return {"result": results, "score": total_score}

    def predict(self, tasks: List[Dict], context: Optional[Dict] = None, **kwargs) -> ModelResponse:
        assert len(tasks) == 1, "Only one task is supported for now"
        task = tasks[0]

        from_name_r, to_name_r, value = self.get_first_tag_occurence("RectangleLabels", "Image")

        prompt_control = self._get_prompt(from_name_r, context)
        prompt = prompt_control["prompt"]
        if not prompt:
            logger.warning("Prompt not found")
            return ModelResponse(predictions=[])

        thresh_controls = self._get_thresholds(context)

        raw_img_path = task["data"][value]
        try:
            img_path = self._resolve_image_path(raw_img_path, task_id=task.get("id"))
        except Exception as exc:
            logger.error("Error getting image path: %s", safe_log_value(exc))
            return ModelResponse(predictions=[])

        src, img = load_image(img_path)
        boxes, logits, phrases = predict(
            model=get_groundingdino_model(),
            image=img,
            caption=prompt,
            box_threshold=thresh_controls["box_threshold"],
            text_threshold=thresh_controls["text_threshold"],
            device=device,
        )

        height, width, _ = src.shape
        boxes_xyxy = box_ops.box_cxcywh_to_xyxy(boxes) * torch.Tensor([width, height, width, height])
        points = boxes_xyxy.cpu().numpy()

        predictions = self.get_results(
            points,
            logits,
            [(height, width)] * len(points),
            phrases,
            from_name_r,
            to_name_r,
        )

        if not context:
            if prompt and prompt_control["from_name"]:
                predictions["result"].append({
                    "from_name": prompt_control["from_name"],
                    "to_name": to_name_r,
                    "type": "textarea",
                    "value": {"text": [prompt]},
                })
            if thresh_controls["from_name_box"]:
                predictions["result"].append({
                    "from_name": thresh_controls["from_name_box"],
                    "to_name": to_name_r,
                    "type": "number",
                    "value": {"number": thresh_controls["box_threshold"]},
                })
            if thresh_controls["from_name_text"]:
                predictions["result"].append({
                    "from_name": thresh_controls["from_name_text"],
                    "to_name": to_name_r,
                    "type": "number",
                    "value": {"number": thresh_controls["text_threshold"]},
                })

        return ModelResponse(predictions=[predictions])

    def fit(self, event, data, **additional_params):
        logger.debug("Data received: %s", safe_log_value(data))
        if event not in ("ANNOTATION_CREATED", "ANNOTATION_UPDATED"):
            return

        from_name_r, _, _ = self.get_first_tag_occurence("RectangleLabels", "Image")
        prompt = self._get_prompt(from_name_r, data["annotation"])
        if prompt and prompt["prompt"]:
            logger.info("Storing prompt: %s", prompt["prompt"])
            self.set("prompt", prompt["prompt"])
        else:
            logger.warning("Prompt not found")

        thresholds = self._get_thresholds(data["annotation"])
        if thresholds["from_name_box"]:
            self.set(thresholds["from_name_box"], str(thresholds["box_threshold"]))
        if thresholds["from_name_text"]:
            self.set(thresholds["from_name_text"], str(thresholds["text_threshold"]))
