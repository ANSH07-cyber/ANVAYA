from __future__ import annotations

from io import BytesIO
from typing import Annotated, Literal
import warnings

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.education.skin_lesion_content import get_education_content
from app.ml.skin_lesion_model import (
    CLASS_DISPLAY_NAMES,
    EXPECTED_CLASS_NAMES,
    get_skin_lesion_model,
)

router = APIRouter(prefix="/api/v1/ai/skin-lesion", tags=["AI - Skin Lesion"])
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
MIN_IMAGE_SIDE = 64
MAX_IMAGE_SIDE = 8192
ALLOWED_FORMATS = {"JPEG", "PNG"}


@router.get("/classes")
def get_supported_classes() -> dict:
    """List the seven output classes and available education languages."""
    return {
        "model_version": "anvaya-skin-lesion-v1",
        "classes": [
            {"class_code": code, "class_name": CLASS_DISPLAY_NAMES[code]}
            for code in EXPECTED_CLASS_NAMES
        ],
        "input_scope": (
            "Dermoscopic images only; ordinary phone photos are outside "
            "the evaluated domain."
        ),
        "education_languages": ["en", "hi"],
        "education_available": True,
        "requires_doctor_review": True,
        "clinical_note": (
            "The seven labels are HAM10000 dataset categories. Some labels "
            "represent groups of lesions rather than one exact diagnosis."
        ),
    }


@router.post("/predict")
def predict_skin_lesion(
    file: Annotated[
        UploadFile,
        File(description="Upload a JPEG or PNG dermoscopic image."),
    ],
    language: Annotated[
        Literal["en", "hi"],
        Query(description="Patient education language: en (English) or hi (Hindi)."),
    ] = "en",
) -> dict:
    """Classify one dermoscopic image and attach matching patient education.

    IMPORTANT: Before production deployment, attach the existing Anvaya
    JWT/RBAC and consent dependencies here. Do not expose this route publicly
    without authentication and authorization.
    """
    try:
        content = file.file.read(MAX_UPLOAD_BYTES + 1)
        if not content:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Image is too large. Maximum size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            )

        # Verify the image container before decoding it.
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(content)) as probe:
                    if probe.format not in ALLOWED_FORMATS:
                        raise HTTPException(
                            status_code=415,
                            detail="Unsupported image format. Upload a JPEG or PNG image.",
                        )
                    width, height = probe.size
                    if (
                        width < MIN_IMAGE_SIDE
                        or height < MIN_IMAGE_SIDE
                        or width > MAX_IMAGE_SIDE
                        or height > MAX_IMAGE_SIDE
                        or width * height > MAX_IMAGE_PIXELS
                    ):
                        raise HTTPException(
                            status_code=400,
                            detail="Image dimensions are outside the accepted range.",
                        )
                    probe.verify()

            with Image.open(BytesIO(content)) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.load()
        except HTTPException:
            raise
        except (
            UnidentifiedImageError,
            OSError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
            ValueError,
        ):
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is not a valid supported image.",
            ) from None

        # Run the existing trained EfficientNet-B0 model.
        result = get_skin_lesion_model().predict(image)

        # Attach education matched to the model's predicted dataset class.
        predicted_code = result.get("predicted_class_code")
        if predicted_code not in EXPECTED_CLASS_NAMES:
            raise HTTPException(
                status_code=500,
                detail="The model returned an unsupported class code.",
            )

        result["education_language"] = language
        result["education"] = get_education_content(predicted_code, language)
        result["education_notice"] = (
            "Educational information describes the predicted dataset category. "
            "It does not establish the cause of this person's lesion or confirm "
            "a diagnosis. A qualified dermatologist must review the result."
        )
        return result

    finally:
        file.file.close()
