from __future__ import annotations

import hashlib
import io
import math
import json
import logging
import warnings
from functools import lru_cache
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from app.core.config import settings

logger = logging.getLogger("anvaya.ai.skin_lesion")

EXPECTED_CLASS_NAMES = ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]

CLASS_DISPLAY_NAMES = {
    "akiec": "Actinic keratoses / intraepithelial carcinoma",
    "bcc": "Basal cell carcinoma",
    "bkl": "Benign keratosis-like lesions",
    "df": "Dermatofibroma",
    "mel": "Melanoma",
    "nv": "Melanocytic nevi",
    "vasc": "Vascular lesions",
}

TRAINED_INFERENCE_MODE = "pytorch_efficientnet_b0"
CLASS_TO_INDEX = {name: index for index, name in enumerate(EXPECTED_CLASS_NAMES)}
NORMALIZATION = {"mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]}
CHECKPOINT_CONTRACT = {
    "architecture": "efficientnet_b0",
    "num_classes": len(EXPECTED_CLASS_NAMES),
    "class_names": EXPECTED_CLASS_NAMES,
    "class_to_idx": CLASS_TO_INDEX,
    "input_size": [224, 224],
    "normalization": NORMALIZATION,
}

MANDATORY_DISCLAIMER = (
    "This is not a diagnosis. Research screening for dermoscopic images. The model can miss malignancies "
    "and can flag benign lesions. A low score does not rule out cancer. "
    "A qualified clinician must assess the lesion. Do not change treatment based on this result."
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_IMAGE_PIXELS = 25_000_000
MIN_IMAGE_SIDE = 64
MAX_IMAGE_SIDE = 8192
ALLOWED_FORMATS = {"JPEG", "PNG"}


class ModelUnavailableError(RuntimeError):
    """No verified model prediction can be returned."""


class InvalidImageError(ValueError):
    """The submitted image could not be safely decoded."""


class UnsupportedImageError(InvalidImageError):
    """The declared or decoded format is unsupported."""


class SkinLesionService:
    def __init__(self) -> None:
        self.model = None
        self.model_version: str | None = None
        self.checkpoint_sha256: str | None = None
        self._initialize_model()

    def _initialize_model(self) -> None:
        root = Path(__file__).resolve().parents[2]
        model_path = root / settings.skin_lesion_model_path
        config_path = root / settings.skin_lesion_config_path
        if not model_path.is_file():
            logger.warning("Skin-lesion checkpoint unavailable.")
            return

        try:
            import torch
            from torch import nn
            from torchvision.models import EfficientNet_B0_Weights, efficientnet_b0
            from torchvision.transforms import InterpolationMode

            # Hash the same bytes that are deserialized. Never load unrestricted pickle.
            weights = model_path.read_bytes()
            digest = hashlib.sha256(weights).hexdigest()
            checkpoint = torch.load(io.BytesIO(weights), map_location="cpu", weights_only=True)
            if not isinstance(checkpoint, dict):
                raise ValueError("Expected a metadata-bearing checkpoint")
            if any(checkpoint.get(key) != expected for key, expected in CHECKPOINT_CONTRACT.items()):
                raise ValueError("Checkpoint contract mismatch")
            version = checkpoint.get("model_version")
            if not isinstance(version, str) or not version.strip() or len(version) > 100:
                raise ValueError("Checkpoint version missing")
            if config_path.is_file():
                with config_path.open(encoding="utf-8") as config_file:
                    config = json.load(config_file)
                if any(config.get(key) != expected for key, expected in CHECKPOINT_CONTRACT.items()):
                    raise ValueError("Config contract mismatch")
                if config.get("model_version") != version:
                    raise ValueError("Config version mismatch")
                if "checkpoint_sha256" in config and config["checkpoint_sha256"] != digest:
                    raise ValueError("Config checkpoint digest mismatch")

            model = efficientnet_b0(weights=None)
            model.classifier[1] = nn.Linear(model.classifier[1].in_features, len(EXPECTED_CLASS_NAMES))
            model.load_state_dict(checkpoint["model_state_dict"], strict=True)
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            model.to(device).eval()
            transform = EfficientNet_B0_Weights.IMAGENET1K_V1.transforms(
                crop_size=224, resize_size=256, interpolation=InterpolationMode.BICUBIC,
                mean=NORMALIZATION["mean"], std=NORMALIZATION["std"], antialias=True,
            )
        except Exception as error:
            logger.error("Skin-lesion checkpoint initialization failed (%s).", type(error).__name__)
            return

        self.device = device
        self.transform = transform
        self.model_version = version
        self.checkpoint_sha256 = digest
        self.model = model

    def validate_image_bytes(self, raw_bytes: bytes, content_type: str) -> Image.Image:
        if not raw_bytes or len(raw_bytes) > MAX_UPLOAD_BYTES:
            raise InvalidImageError("Image size is outside supported limits.")
        expected_format = {"image/jpeg": "JPEG", "image/png": "PNG"}.get(content_type.lower())
        if not expected_format:
            raise UnsupportedImageError("Upload a JPEG or PNG dermoscopic image.")

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(raw_bytes), formats=sorted(ALLOWED_FORMATS)) as probe:
                    if probe.format != expected_format:
                        raise UnsupportedImageError("The image content does not match its declared format.")
                    width, height = probe.size
                    if not (MIN_IMAGE_SIDE <= width <= MAX_IMAGE_SIDE and MIN_IMAGE_SIDE <= height <= MAX_IMAGE_SIDE) or width * height > MAX_IMAGE_PIXELS:
                        raise InvalidImageError("Image dimensions are outside supported limits.")
                    if getattr(probe, "n_frames", 1) != 1:
                        raise InvalidImageError("Upload a single-frame dermoscopic image.")
                    # Preserve the recorded orientation while stripping EXIF and other metadata.
                    image = ImageOps.exif_transpose(probe).convert("RGB")
                    image.info.clear()
                    return image
        except (Image.DecompressionBombWarning, Image.DecompressionBombError):
            raise InvalidImageError("Image dimensions are outside supported limits.") from None
        except InvalidImageError:
            raise
        except (OSError, ValueError, SyntaxError):
            raise InvalidImageError("The image could not be decoded safely.") from None

    def predict(self, image: Image.Image, language: str = "en") -> dict[str, Any]:
        if self.model is None or not self.model_version or not self.checkpoint_sha256:
            raise ModelUnavailableError()

        try:
            import torch

            with torch.inference_mode():
                inputs = self.transform(image).unsqueeze(0).to(self.device)
                logits = self.model(inputs)
                if tuple(logits.shape) != (1, len(EXPECTED_CLASS_NAMES)) or not torch.isfinite(logits).all():
                    raise ValueError("Invalid model logits")
                probs = torch.softmax(logits.float(), dim=1)[0].cpu().tolist()
            if not all(math.isfinite(p) and 0.0 <= p <= 1.0 for p in probs) or not math.isclose(sum(probs), 1.0, abs_tol=1e-6):
                raise ValueError("Invalid model probabilities")
        except Exception as error:
            logger.error("Skin-lesion inference failed (%s).", type(error).__name__)
            raise ModelUnavailableError() from None

        prob_dict = dict(zip(EXPECTED_CLASS_NAMES, probs, strict=True))
        best_class = EXPECTED_CLASS_NAMES[probs.index(max(probs))]
        education = self.get_education_content(best_class, language)
        return {
            "predicted_class": best_class,
            "predicted_label": CLASS_DISPLAY_NAMES[best_class],
            "confidence": prob_dict[best_class],
            "probabilities": prob_dict,
            "disclaimer": MANDATORY_DISCLAIMER,
            "education_title": education.get("title") if education else None,
            "education_summary": education.get("what_it_means") if education else None,
            "education_content": education,
            "inference_mode": TRAINED_INFERENCE_MODE,
            "model_version": self.model_version,
            "checkpoint_sha256": self.checkpoint_sha256,
        }

    def get_education_content(self, class_code: str, language: str = "en") -> dict[str, Any] | None:
        try:
            from app.education.skin_lesion_content import get_education_content
            return get_education_content(class_code, language)
        except Exception:
            return None


@lru_cache
def get_skin_lesion_service() -> SkinLesionService:
    return SkinLesionService()
