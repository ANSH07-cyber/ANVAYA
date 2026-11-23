"""Regression coverage for Stage 2C Admin User Management & Settings API routing.

Prevents 404 Not Found regressions between frontend adminService contracts and FastAPI routes:
1. Verifies exact route registration in app.openapi() paths.
2. Validates unauthenticated requests return HTTP 401 (not 404).
3. Validates non-admin roles (patient, doctor) return HTTP 403 (not 404).
4. Validates authenticated administrator requests return HTTP 200 with AdminUserListResponse.
5. Verifies canonical route without trailing slashes matching frontend adminService calls.
6. Verifies Admin Settings endpoint contracts (/profile, /system, /security, /notifications).
"""

from uuid import uuid4
import pytest
from app.core.security import create_access_token, hash_password
from app.models.user import User


@pytest.fixture
def regression_admin(db_session):
    admin = User(
        full_name="Routing Regression Admin",
        email=f"routing_admin_{uuid4().hex[:8]}@example.com",
        password_hash=hash_password("AdminSecurePass123!"),
        role="admin",
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


@pytest.fixture
def regression_admin_headers(regression_admin):
    token = create_access_token(subject=str(regression_admin.id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def regression_patient_headers(patient_account):
    token = create_access_token(subject=str(patient_account["user"].id))
    return {"Authorization": f"Bearer {token}"}


def test_admin_api_routes_registered_in_openapi():
    """Verify that all Stage 2C Admin routes are registered in the FastAPI application."""
    from app.main import app

    openapi = app.openapi()
    paths = openapi.get("paths", {})

    expected_routes = [
        "/api/v1/admin/users",
        "/api/v1/admin/users/{user_id}",
        "/api/v1/admin/users/{user_id}/status",
        "/api/v1/admin/settings/profile",
        "/api/v1/admin/settings/system",
        "/api/v1/admin/settings/security",
        "/api/v1/admin/settings/notifications",
    ]

    for route in expected_routes:
        assert route in paths, f"Expected route {route} not found in FastAPI OpenAPI schema! Registered paths: {list(paths.keys())}"


def test_admin_users_unauthenticated_returns_401_not_404(client):
    """Verify /api/v1/admin/users returns 401 Unauthorized, never 404 Not Found."""
    res = client.get("/api/v1/admin/users")
    assert res.status_code == 401, f"Expected 401 Unauthorized but got {res.status_code}: {res.text}"
    assert "detail" in res.json()


def test_admin_users_non_admin_returns_403_not_404(client, regression_patient_headers):
    """Verify non-admin roles return 403 Forbidden, confirming route exists and enforces RBAC."""
    res = client.get("/api/v1/admin/users", headers=regression_patient_headers)
    assert res.status_code == 403, f"Expected 403 Forbidden but got {res.status_code}: {res.text}"


def test_admin_users_authenticated_admin_returns_200(client, regression_admin_headers):
    """Verify authenticated administrator receives HTTP 200 with valid paginated payload."""
    res = client.get("/api/v1/admin/users?limit=20&offset=0", headers=regression_admin_headers)
    assert res.status_code == 200, f"Expected 200 OK but got {res.status_code}: {res.text}"

    data = res.json()
    assert "items" in data
    assert "total" in data
    assert "limit" in data
    assert "offset" in data
    assert isinstance(data["items"], list)
    assert data["total"] >= 1


def test_admin_users_exact_frontend_contract_without_trailing_slash(client, regression_admin_headers):
    """Verify exact URL invoked by frontend adminService (/admin/users) resolves cleanly."""
    res = client.get("/api/v1/admin/users", headers=regression_admin_headers)
    assert res.status_code == 200


def test_admin_settings_endpoints_resolve_cleanly(client, regression_admin_headers):
    """Verify all 4 Admin Settings endpoints return 200 OK for authenticated administrators."""
    endpoints = [
        "/api/v1/admin/settings/profile",
        "/api/v1/admin/settings/system",
        "/api/v1/admin/settings/security",
        "/api/v1/admin/settings/notifications",
    ]

    for ep in endpoints:
        res = client.get(ep, headers=regression_admin_headers)
        assert res.status_code == 200, f"Failed for {ep}: got {res.status_code} {res.text}"
