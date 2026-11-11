from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.skin_lesion import router as skin_lesion_router
from app.ml.skin_lesion_model import get_skin_lesion_model

app = FastAPI(
    title="Anvaya Skin Lesion AI API",
    version="1.0.0",
    description=(
        "Research-prototype inference API for seven HAM10000 dermoscopic "
        "lesion classes. Outputs require qualified dermatologist review."
    ),
)

# Local development origins only. Add your actual frontend URL via the
# ANVAYA_CORS_ORIGINS environment variable when integrating the frontend.
import os
origins = [
    origin.strip()
    for origin in os.getenv(
        "ANVAYA_CORS_ORIGINS",
        "http://localhost:5173,http://localhost:3000",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(skin_lesion_router)


@app.get("/")
def root() -> dict:
    return {
        "service": "Anvaya Skin Lesion AI API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health() -> dict:
    """Load/check the model and report service readiness."""
    try:
        model = get_skin_lesion_model()
        return {
            "status": "ok",
            "model_loaded": True,
            "model_version": model.model_version,
            "device": str(model.device),
        }
    except Exception as exc:
        # Do not expose local paths or stack traces to API clients.
        return {
            "status": "not_ready",
            "model_loaded": False,
            "error_type": type(exc).__name__,
        }
