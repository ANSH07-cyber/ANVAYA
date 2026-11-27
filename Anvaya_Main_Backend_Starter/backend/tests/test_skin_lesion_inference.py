"""Skin-lesion safety tests. Real checkpoint smoke testing is opt-in."""
import io
import os
from pathlib import Path

import pytest
from PIL import Image, PngImagePlugin

from app.core.config import settings
from app.services.skin_lesion_service import (
    EXPECTED_CLASS_NAMES,
    InvalidImageError,
    ModelUnavailableError,
    SkinLesionService,
    TRAINED_INFERENCE_MODE,
    UnsupportedImageError,
)


@pytest.fixture
def deterministic_model():
    import torch

    class FixtureModel(torch.nn.Module):
        def forward(self, inputs):
            assert torch.is_inference_mode_enabled()
            assert not self.training
            assert tuple(inputs.shape) == (1, 3, 224, 224)
            return torch.arange(7, dtype=torch.float32).reshape(1, 7)

    service = SkinLesionService.__new__(SkinLesionService)
    service.device = torch.device("cpu")
    service.model = FixtureModel().eval()
    service.transform = lambda _: torch.zeros(3, 224, 224)
    service.model_version = "fixture-model"
    service.checkpoint_sha256 = "a" * 64
    return service


def test_mocked_inference_returns_seven_normalized_scores(deterministic_model):
    result = deterministic_model.predict(Image.new("RGB", (128, 128)))
    assert result["inference_mode"] == TRAINED_INFERENCE_MODE
    assert result["model_version"] == "fixture-model"
    assert list(result["probabilities"]) == EXPECTED_CLASS_NAMES
    assert result["predicted_class"] == "vasc"
    assert sum(result["probabilities"].values()) == pytest.approx(1)
    assert all(0 <= p <= 1 for p in result["probabilities"].values())


def test_absent_or_malformed_checkpoint_fails_closed(tmp_path, monkeypatch, caplog):
    path = tmp_path / "private-checkpoint-marker.pth"
    monkeypatch.setattr(settings, "skin_lesion_model_path", str(path))
    for present in (False, True):
        if present:
            path.write_bytes(b"not a checkpoint")
        service = SkinLesionService()
        assert service.model_version is None
        assert service.checkpoint_sha256 is None
        with pytest.raises(ModelUnavailableError):
            service.predict(Image.new("RGB", (128, 128)))
    assert path.name not in caplog.text


def test_swapped_label_metadata_rejected(tmp_path, monkeypatch):
    import torch
    from app.services.skin_lesion_service import CHECKPOINT_CONTRACT

    path = tmp_path / "wrong-labels.pth"
    torch.save({**CHECKPOINT_CONTRACT, "class_names": EXPECTED_CLASS_NAMES[::-1]}, path)
    monkeypatch.setattr(settings, "skin_lesion_model_path", str(path))
    assert SkinLesionService().model is None


@pytest.mark.parametrize("kind", ["exception", "wrong_shape", "nan", "infinity"])
def test_inference_failure_never_yields_scores(kind, deterministic_model, caplog):
    import torch

    def invalid(_inputs):
        if kind == "exception":
            raise RuntimeError("private inference debug marker")
        if kind == "wrong_shape":
            return torch.zeros(1, 6)
        return torch.full((1, 7), float("nan" if kind == "nan" else "inf"))

    deterministic_model.model = invalid
    with pytest.raises(ModelUnavailableError):
        deterministic_model.predict(Image.new("RGB", (128, 128)))
    assert "private inference debug marker" not in caplog.text


def test_validation_rejects_mismatch_and_small_images_and_removes_metadata(deterministic_model):
    png = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    info.add_text("private", "fixture metadata")
    Image.new("RGBA", (128, 96)).save(png, format="PNG", pnginfo=info)
    with pytest.raises(UnsupportedImageError):
        deterministic_model.validate_image_bytes(png.getvalue(), "image/jpeg")
    with pytest.raises(InvalidImageError):
        deterministic_model.validate_image_bytes(png.getvalue()[:20], "image/png")
    rgb = deterministic_model.validate_image_bytes(png.getvalue(), "image/png")
    assert rgb.mode == "RGB"
    assert rgb.size == (128, 96)
    assert not rgb.info

    tiny = io.BytesIO()
    Image.new("RGB", (32, 32)).save(tiny, format="PNG")
    with pytest.raises(InvalidImageError, match="dimensions"):
        deterministic_model.validate_image_bytes(tiny.getvalue(), "image/png")


def test_real_checkpoint_cpu_smoke(monkeypatch):
    checkpoint = os.environ.get("ANVAYA_ML1_TEST_CHECKPOINT")
    if not checkpoint:
        pytest.skip("Set ANVAYA_ML1_TEST_CHECKPOINT to run the supplied trained artifact")
    import torch
    from torchvision.models import EfficientNet_B0_Weights

    model_path = Path(checkpoint)
    assert model_path.is_file()
    monkeypatch.setattr(settings, "skin_lesion_model_path", str(model_path))
    monkeypatch.setattr(settings, "skin_lesion_config_path", str(model_path.with_name("anvaya_model_config_v1.json")))
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    threads = torch.get_num_threads()
    torch.set_num_threads(1)
    try:
        service = SkinLesionService()
        assert service.model is not None
        assert service.device.type == "cpu"
        assert not service.model.training
        assert tuple(service.model.classifier[1].weight.shape) == (7, 1280)
        assert service.checkpoint_sha256 == "eb6795596459e9436c59ef4c5628f07f1a9418688a4389024a801a5c7266babb"
        image = Image.new("RGB", (192, 128), (120, 70, 50))
        evaluated = service.transform(image)
        assert tuple(evaluated.shape) == (3, 224, 224)
        assert torch.allclose(evaluated, EfficientNet_B0_Weights.IMAGENET1K_V1.transforms()(image))
        first = service.predict(image)
        second = service.predict(image)
        assert list(first["probabilities"]) == EXPECTED_CLASS_NAMES
        assert first["probabilities"] == pytest.approx(second["probabilities"])
        assert sum(first["probabilities"].values()) == pytest.approx(1)
        assert first["inference_mode"] == TRAINED_INFERENCE_MODE
        assert 0 <= first["confidence"] <= 1
    finally:
        torch.set_num_threads(threads)
