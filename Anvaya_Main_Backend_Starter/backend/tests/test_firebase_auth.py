
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.models.user import User


def google_claims(
    uid="google-test-uid-001",
    email="google.patient@example.com",
    name="Google Test Patient",
):
    return {
        "uid": uid,
        "sub": uid,
        "email": email,
        "email_verified": True,
        "name": name,
        "firebase": {
            "sign_in_provider": "google.com",
        },
    }


def seed_user(test_engine, **overrides):
    SessionLocal = sessionmaker(bind=test_engine)

    defaults = {
        "full_name": "Existing Patient",
        "email": "existing.patient@example.com",
        "password_hash": "existing-password-hash",
        "role": "patient",
        "is_active": True,
    }
    defaults.update(overrides)

    with SessionLocal() as db:
        user = User(**defaults)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user.id


def read_user(test_engine, user_id):
    SessionLocal = sessionmaker(bind=test_engine)

    with SessionLocal() as db:
        return db.get(User, user_id)


def test_new_google_user_can_sign_in(
    client, test_engine, monkeypatch
):
    from app.api.routes import auth

    monkeypatch.setattr(
        auth,
        "verify_firebase_id_token",
        lambda token: google_claims(),
    )

    response = client.post(
        "/api/v1/auth/firebase",
        json={"id_token": "mock-google-token"},
    )

    assert response.status_code == 200

    data = response.json()
    assert data["token_type"] == "bearer"
    assert data["access_token"]
    assert data["user"]["email"] == "google.patient@example.com"
    assert data["user"]["role"] == "patient"

    SessionLocal = sessionmaker(bind=test_engine)
    with SessionLocal() as db:
        user = db.scalar(
            select(User).where(
                User.firebase_uid == "google-test-uid-001"
            )
        )

        assert user is not None
        assert user.password_hash is None
        assert user.is_active is True


def test_existing_account_can_be_linked(
    client, test_engine, monkeypatch
):
    from app.api.routes import auth

    user_id = seed_user(
        test_engine,
        email="existing.patient@example.com",
    )
    original_user = read_user(test_engine, user_id)
    original_password = original_user.password_hash
    original_role = original_user.role

    monkeypatch.setattr(
        auth,
        "verify_firebase_id_token",
        lambda token: google_claims(
            uid="new-google-identity",
            email="existing.patient@example.com",
        ),
    )

    response = client.post(
        "/api/v1/auth/firebase",
        json={"id_token": "mock-google-token"},
    )

    assert response.status_code == 200

    updated_user = read_user(test_engine, user_id)

    assert updated_user.firebase_uid == "new-google-identity"
    assert updated_user.password_hash == original_password
    assert updated_user.role == original_role


def test_invalid_firebase_token_returns_401(
    client, monkeypatch
):
    from app.api.routes import auth

    def reject_token(token):
        raise ValueError("Invalid token")

    monkeypatch.setattr(
        auth, "verify_firebase_id_token", reject_token
    )

    response = client.post(
        "/api/v1/auth/firebase",
        json={"id_token": "invalid-token"},
    )

    assert response.status_code == 401


def test_unverified_google_email_returns_401(
    client, monkeypatch
):
    from app.api.routes import auth

    claims = google_claims()
    claims["email_verified"] = False

    monkeypatch.setattr(
        auth,
        "verify_firebase_id_token",
        lambda token: claims,
    )

    response = client.post(
        "/api/v1/auth/firebase",
        json={"id_token": "mock-token"},
    )

    assert response.status_code == 401


def test_non_google_provider_returns_401(
    client, monkeypatch
):
    from app.api.routes import auth

    claims = google_claims()
    claims["firebase"]["sign_in_provider"] = "password"

    monkeypatch.setattr(
        auth,
        "verify_firebase_id_token",
        lambda token: claims,
    )

    response = client.post(
        "/api/v1/auth/firebase",
        json={"id_token": "mock-token"},
    )

    assert response.status_code == 401


def test_inactive_account_cannot_use_google_login(
    client, test_engine, monkeypatch
):
    from app.api.routes import auth

    seed_user(
        test_engine,
        email="google.patient@example.com",
        is_active=False,
    )

    monkeypatch.setattr(
        auth,
        "verify_firebase_id_token",
        lambda token: google_claims(),
    )

    response = client.post(
        "/api/v1/auth/firebase",
        json={"id_token": "mock-token"},
    )

    assert response.status_code == 403


def test_google_uid_cannot_link_to_another_identity(
    client, test_engine, monkeypatch
):
    from app.api.routes import auth

    seed_user(
        test_engine,
        email="existing.patient@example.com",
        firebase_uid="another-google-identity",
    )

    monkeypatch.setattr(
        auth,
        "verify_firebase_id_token",
        lambda token: google_claims(
            uid="new-google-identity",
            email="existing.patient@example.com",
        ),
    )

    response = client.post(
        "/api/v1/auth/firebase",
        json={"id_token": "mock-token"},
    )

    assert response.status_code == 409


def test_firebase_service_unavailable_returns_503(
    client, monkeypatch
):
    from app.api.routes import auth

    def unavailable(token):
        raise RuntimeError("Firebase service unavailable")

    monkeypatch.setattr(
        auth, "verify_firebase_id_token", unavailable
    )

    response = client.post(
        "/api/v1/auth/firebase",
        json={"id_token": "mock-token"},
    )

    assert response.status_code == 503

def test_linked_google_uid_cannot_take_another_users_email(
    client, test_engine, monkeypatch
):
    from app.api.routes import auth

    original_user_id = seed_user(
        test_engine,
        email="original.patient@example.com",
        firebase_uid="google-uid-001",
    )

    seed_user(
        test_engine,
        email="another.patient@example.com",
    )

    monkeypatch.setattr(
        auth,
        "verify_firebase_id_token",
        lambda token: google_claims(
            uid="google-uid-001",
            email="another.patient@example.com",
        ),
    )

    response = client.post(
        "/api/v1/auth/firebase",
        json={"id_token": "mock-google-token"},
    )

    assert response.status_code == 409

    original_user = read_user(test_engine, original_user_id)

    assert original_user.email == "original.patient@example.com"
    assert original_user.firebase_uid == "google-uid-001"
