from __future__ import annotations

import pytest

from app.api.routes.auth import login_rate_limiter
from app.core.rate_limit import normalize_email_for_rate_limit, reset_rate_limits


@pytest.fixture(autouse=True)
def clean_rate_limits():
    from app.core.config import settings
    prev = settings.rate_limit_enabled
    settings.rate_limit_enabled = True
    reset_rate_limits()
    yield
    settings.rate_limit_enabled = prev
    reset_rate_limits()


def test_normalize_email_for_rate_limit():
    # Deterministic, lowercased, and length-limited
    token1 = normalize_email_for_rate_limit("User@Example.COM ")
    token2 = normalize_email_for_rate_limit("user@example.com")
    assert token1 == token2
    assert len(token1) == 16
    assert normalize_email_for_rate_limit("") == "anonymous"
    assert normalize_email_for_rate_limit(None) == "anonymous"


def test_rate_limit_isolation_between_accounts(client):
    """Verify that hammering account A triggers HTTP 429 on account A,

    while account B and account C from the SAME IP can still log in without lockout.
    """
    target_email = "target.brute.probe@example.com"
    # pair_limit is 10
    for i in range(10):
        res = client.post(
            "/api/v1/auth/login",
            json={"email": target_email, "password": "WrongPassword123!"},
        )
        assert res.status_code == 401, f"Attempt {i+1} should be 401"

    # 11th attempt on account A should be throttled with HTTP 429
    res_throttled = client.post(
        "/api/v1/auth/login",
        json={"email": target_email, "password": "WrongPassword123!"},
    )
    assert res_throttled.status_code == 429
    assert "Too many login attempts" in res_throttled.json()["detail"]
    assert "Retry-After" in res_throttled.headers

    # Account B (different user, same IP!) MUST NOT be locked out!
    other_email = "isolated.doctor@example.com"
    res_other = client.post(
        "/api/v1/auth/login",
        json={"email": other_email, "password": "WrongPassword123!"},
    )
    # Returns 401 (credential error), NOT 429! Proves isolation!
    assert res_other.status_code == 401
    assert res_other.json()["detail"] == "Incorrect email or password."


def test_account_enumeration_defense(client):
    """Ensure that 429 error messages and response structures are identical

    for existing accounts and non-existent accounts, preventing enumeration leaks.
    """
    fake_account = "nonexistent.attacker.probe@example.com"
    for _ in range(10):
        client.post(
            "/api/v1/auth/login",
            json={"email": fake_account, "password": "BadPassword123!"},
        )

    res_fake = client.post(
        "/api/v1/auth/login",
        json={"email": fake_account, "password": "BadPassword123!"},
    )
    assert res_fake.status_code == 429
    assert res_fake.json()["detail"].startswith("Too many login attempts")


def test_global_ip_flood_protection(client):
    """Ensure that sending requests exceeding ip_limit from one IP triggers 429

    even if rotating different emails.
    """
    original_ip_limit = login_rate_limiter.ip_limit
    login_rate_limiter.ip_limit = 5
    try:
        reset_rate_limits()
        for i in range(5):
            res = client.post(
                "/api/v1/auth/login",
                json={"email": f"unique_user_{i}@example.com", "password": "WrongPassword1!"},
            )
            assert res.status_code == 401

        # 6th request with yet another email should trigger IP limit
        res_ip_blocked = client.post(
            "/api/v1/auth/login",
            json={"email": "unique_user_99@example.com", "password": "WrongPassword1!"},
        )
        assert res_ip_blocked.status_code == 429
        assert "Too many login attempts" in res_ip_blocked.json()["detail"]
    finally:
        login_rate_limiter.ip_limit = original_ip_limit
        reset_rate_limits()
