from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import torch
import torch.nn as nn
from PIL import Image
from torchvision.models import EfficientNet_B0_Weights, efficientnet_b0

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_PATH = (
    PROJECT_ROOT / "models" / "anvaya_skin_lesion_efficientnet_b0_v1.pth"
)
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "models" / "anvaya_model_config_v1.json"

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


class SkinLesionModel:
    """Loads the saved seven-class EfficientNet-B0 and runs one-image inference."""

    def __init__(self, model_path: Path | str | None = None) -> None:
        self.model_path = Path(
            os.getenv("ANVAYA_SKIN_MODEL_PATH", str(model_path or DEFAULT_MODEL_PATH))
        ).expanduser().resolve()
        self.config_path = Path(
            os.getenv("ANVAYA_SKIN_CONFIG_PATH", str(DEFAULT_CONFIG_PATH))
        ).expanduser().resolve()

        if not self.model_path.is_file():
            raise FileNotFoundError(
                f"Skin-lesion model checkpoint not found: {self.model_path}. "
                "Place the .pth file in the project's models/ folder or set "
                "ANVAYA_SKIN_MODEL_PATH."
            )
        if not self.config_path.is_file():
            raise FileNotFoundError(
                f"Model config not found: {self.config_path}. "
                "Place the JSON config in the project's models/ folder or set "
                "ANVAYA_SKIN_CONFIG_PATH."
            )

        with self.config_path.open("r", encoding="utf-8") as f:
            self.config: dict[str, Any] = json.load(f)

        class_names = self.config.get("class_names")
        if class_names != EXPECTED_CLASS_NAMES:
            raise ValueError(
                "Unexpected class order in model config. The API expects: "
                f"{EXPECTED_CLASS_NAMES}; found: {class_names}"
            )

        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        # weights=None avoids downloading ImageNet weights. We load Anvaya's
        # complete, trained seven-class state_dict immediately afterwards.
        self.model = efficientnet_b0(weights=None)
        self.model.classifier[1] = nn.Linear(
            self.model.classifier[1].in_features,
            len(EXPECTED_CLASS_NAMES),
        )

        # The supplied artifact contains tensors and primitive metadata only.
        checkpoint = torch.load(
            self.model_path,
            map_location="cpu",
            weights_only=True,
        )
        state_dict = checkpoint.get("model_state_dict")
        if not isinstance(state_dict, dict):
            raise ValueError("Checkpoint does not contain model_state_dict.")

        self.model.load_state_dict(state_dict, strict=True)
        self.model.to(self.device)
        self.model.eval()

        # This is the same TorchVision evaluation transform used by the
        # validation/test pipeline: resize 256, center crop 224, normalize.
        self.transform = EfficientNet_B0_Weights.DEFAULT.transforms()
        self.class_names = EXPECTED_CLASS_NAMES
        self.model_version = self.config.get("model_version", "anvaya-skin-lesion-v1")

    @torch.inference_mode()
    def predict(self, image: Image.Image) -> dict[str, Any]:
        image = image.convert("RGB")
        tensor = self.transform(image).unsqueeze(0).to(self.device)
        logits = self.model(tensor)
        scores = torch.softmax(logits, dim=1).squeeze(0).detach().cpu()

        predicted_idx = int(torch.argmax(scores).item())
        predicted_code = self.class_names[predicted_idx]
        score_map = {
            code: float(scores[index].item())
            for index, code in enumerate(self.class_names)
        }

        return {
            "model_version": self.model_version,
            "predicted_class_code": predicted_code,
            "predicted_class_name": CLASS_DISPLAY_NAMES[predicted_code],
            "model_score": score_map[predicted_code],
            "class_scores": [
                {
                    "class_code": code,
                    "class_name": CLASS_DISPLAY_NAMES[code],
                    "score": score_map[code],
                }
                for code in self.class_names
            ],
            "score_type": "uncalibrated_softmax_score",
            "device": str(self.device),
            "requires_doctor_review": True,
            "clinical_disclaimer": (
                "Research prototype only. This output is not a diagnosis, "
                "does not recommend treatment, and must not be used to make "
                "care decisions. A qualified dermatologist must review the image."
            ),
            "input_scope": (
                "This model was trained on HAM10000 dermoscopic images. "
                "Ordinary smartphone photographs and other image types are "
                "outside the evaluated data domain."
            ),
        }


@lru_cache(maxsize=1)
def get_skin_lesion_model() -> SkinLesionModel:
    """Load the model once per Python process and reuse it for requests."""
    return SkinLesionModel()
