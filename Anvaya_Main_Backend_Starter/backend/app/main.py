
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401 - registers SQLAlchemy models
from app.api.router import api_router
from app.core.config import settings
from app.core.rate_limit import reset_rate_limits


@asynccontextmanager
async def lifespan(app: FastAPI):
    reset_rate_limits()

    try:
        mode = settings.effective_encryption_mode
    except ValueError as e:
        raise RuntimeError(f"Clinical encryption configuration error: {e}") from None

    if mode != "disabled":
        from app.models.health_record import HealthRecord
        if not hasattr(HealthRecord, "encryption_version"):
            raise RuntimeError(
                f"Clinical encryption mode '{mode}' cannot activate: "
                "HealthRecord model lacks encryption_version column mapping."
            )

        if not settings.clinical_encryption_active_key_id or not settings.clinical_encryption_keys_json:
            raise RuntimeError(
                f"Clinical encryption mode '{mode}' is active, but active key ID or key configuration is missing."
            )
        import base64
        import json
        from app.core.crypto import KeyRegistry

        active_key_id = settings.clinical_encryption_active_key_id
        registry = KeyRegistry()
        try:
            keys_dict = json.loads(settings.clinical_encryption_keys_json)
        except Exception:
            raise RuntimeError(
                "Clinical encryption keys configuration is not valid JSON."
            ) from None

        if not isinstance(keys_dict, dict) or not keys_dict:
            raise RuntimeError(
                "Clinical encryption keys configuration must be a non-empty JSON object."
            )

        for k_id, k_b64 in keys_dict.items():
            if not isinstance(k_id, str) or not k_id.strip():
                raise RuntimeError(
                    "Clinical encryption key identifier must be a non-empty string."
                )
            if not isinstance(k_b64, str):
                raise RuntimeError(
                    f"Clinical encryption key material for ID '{k_id}' must be a string."
                )
            if any(c.isspace() for c in k_b64):
                raise RuntimeError(
                    f"Clinical encryption key '{k_id}' contains invalid whitespace characters."
                )
            try:
                k_bytes = base64.b64decode(k_b64, validate=True)
            except Exception:
                raise RuntimeError(
                    f"Clinical encryption key '{k_id}' contains invalid Base64 encoding."
                ) from None

            if base64.b64encode(k_bytes).decode("ascii") != k_b64:
                raise RuntimeError(
                    f"Clinical encryption key '{k_id}' is not canonically Base64-encoded."
                )

            if len(k_bytes) != 32:
                raise RuntimeError(
                    f"Clinical encryption key '{k_id}' must decode to exactly 32 bytes (256 bits)."
                )

            try:
                registry.register_key(
                    k_id,
                    k_bytes,
                    set_active=(k_id == active_key_id),
                )
            except Exception:
                raise RuntimeError(
                    f"Failed to register clinical encryption key '{k_id}' in KeyRegistry."
                ) from None

        if not registry.has_key(active_key_id):
            raise RuntimeError(
                f"Configured active key ID '{active_key_id}' was not found in registered keys."
            )

        app.state.clinical_key_registry = registry

    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Starter backend for the Anvaya healthcare application.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/", tags=["Root"])
def root() -> dict[str, str]:
    return {"message": "Anvaya API is running", "docs": "/docs"}
