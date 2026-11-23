from pathlib import Path
from typing import Any

import firebase_admin
from firebase_admin import auth, credentials

from app.core.config import settings


def get_firebase_app() -> firebase_admin.App:
    try:
        return firebase_admin.get_app()
    except ValueError:
        pass

    credential_path = Path(settings.firebase_service_account_path)

    if not credential_path.is_absolute():
        backend_root = Path(__file__).resolve().parents[2]
        credential_path = backend_root / credential_path

    if not credential_path.is_file():
        raise FileNotFoundError(
            "Firebase service account credentials were not found."
        )

    try:
        return firebase_admin.initialize_app(
            credentials.Certificate(str(credential_path))
        )
    except ValueError:
        return firebase_admin.get_app()


def verify_firebase_id_token(id_token: str) -> dict[str, Any]:
    firebase_app = get_firebase_app()

    return auth.verify_id_token(
        id_token,
        check_revoked=True,
        app=firebase_app,
    )
