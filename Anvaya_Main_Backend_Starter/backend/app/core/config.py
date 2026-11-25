from functools import lru_cache
from typing import Literal
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing_extensions import Self


ClinicalEncryptionMode = Literal[
    "disabled",
    "mixed_read",
    "read_write",
    "strict",
]


class Settings(BaseSettings):
    app_name: str = "Anvaya API"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./anvaya_dev.db"
    jwt_secret_key: str = "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_BEFORE_USE"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
    )
    firebase_service_account_path: str = "secrets/firebase-service-account.json"

    # Auth & Cookies
    environment: str = "development"
    cookie_secure: bool | None = None
    cookie_samesite: str = "lax"
    access_cookie_name: str = "anvaya_access_token"
    refresh_cookie_name: str = "anvaya_refresh_token"
    csrf_cookie_name: str = "anvaya_csrf_token"
    csrf_header_name: str = "X-CSRF-Token"
    refresh_token_expire_days: int = 7
    csrf_secret_key: str = "CHANGE_THIS_TO_A_LONG_RANDOM_CSRF_SECRET_BEFORE_USE"

    # AI & Skin Lesion Inference
    skin_lesion_model_path: str = "models/anvaya_skin_lesion_efficientnet_b0_v1.pth"
    skin_lesion_config_path: str = "models/anvaya_model_config_v1.json"
    skin_lesion_upload_dir: str = "uploads/skin_lesion"

    # Redis & Rate Limiting
    redis_url: str = "redis://127.0.0.1:6379/0"
    rate_limit_enabled: bool = True
    rate_limit_login: str = "10/minute"
    rate_limit_ai_inference: str = "20/minute"

    # Clinical Data Encryption (Gate 2B Phase 3) - Default Disabled
    clinical_encryption_enabled: bool = False
    clinical_encryption_mode: ClinicalEncryptionMode = "disabled"
    clinical_encryption_active_key_id: str | None = None
    clinical_encryption_keys_json: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @model_validator(mode="after")
    def validate_clinical_encryption_mode(self) -> Self:
        if self.clinical_encryption_enabled:
            raise ValueError(
                "Invalid configuration: legacy clinical_encryption_enabled=True is rejected. "
                "Explicit clinical_encryption_mode must be configured with clinical_encryption_enabled=False."
            )
        return self

    @property
    def effective_encryption_mode(self) -> ClinicalEncryptionMode:
        if self.clinical_encryption_enabled:
            raise ValueError(
                "Invalid configuration: legacy clinical_encryption_enabled=True is forbidden."
            )
        return self.clinical_encryption_mode

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_cookie_secure(self) -> bool:
        if self.cookie_secure is not None:
            return self.cookie_secure
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
