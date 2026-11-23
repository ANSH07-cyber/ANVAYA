from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Callable

from fastapi import HTTPException, Request, Response, status

from app.core.config import settings
from app.core.redis_client import get_redis_client
from app.schemas.auth import LoginRequest

logger = logging.getLogger("anvaya.core.ratelimit")


def normalize_email_for_rate_limit(email: str) -> str:
    """Safely normalizes an email and produces a non-reversible SHA-256 token

    to prevent account enumeration and Redis key injection.
    """
    if not email or not isinstance(email, str):
        return "anonymous"
    clean_email = email.strip().lower()
    return hashlib.sha256(clean_email.encode("utf-8")).hexdigest()[:16]


class RateLimiter:
    """Sliding-window rate limiter with Redis backend and in-memory fallback."""

    def __init__(
        self,
        times: int = 20,
        seconds: int = 60,
        prefix: str = "generic",
    ) -> None:
        self.times = times
        self.seconds = seconds
        self.prefix = prefix

    async def __call__(self, request: Request, response: Response) -> None:
        # Check global toggle (supports pytest override)
        if not getattr(settings, "rate_limit_enabled", True):
            return

        # Check app-state toggle (supports test client fixture bypass)
        if hasattr(request.app, "state") and getattr(request.app.state, "rate_limit_enabled", None) is False:
            return

        # Determine identifier: IP address or forwarded client
        client_ip = "unknown"
        if request.client and request.client.host:
            client_ip = request.client.host
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()

        key = f"ratelimit:{self.prefix}:{client_ip}"
        redis_client = get_redis_client()
        allowed, current_count, retry_after = redis_client.record_hit(
            key=key,
            window_seconds=self.seconds,
            max_hits=self.times,
        )

        response.headers["X-RateLimit-Limit"] = str(self.times)
        response.headers["X-RateLimit-Remaining"] = str(max(0, self.times - current_count))

        if not allowed:
            logger.warning(
                "Rate limit exceeded for %s on prefix %s (hits: %s/%s). Retry after %ss.",
                client_ip,
                self.prefix,
                current_count,
                self.times,
                retry_after,
            )
            response.headers["Retry-After"] = str(retry_after)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many requests. Limit is {self.times} per {self.seconds}s. Please retry in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )


class LoginRateLimiter:
    """Multi-tiered login rate limiter defending against brute-force and credential stuffing

    while isolating developer/testing accounts on shared IPs.

    Tiers:
    1. Global IP Limit: Prevents volumetric flooding from a single source IP.
       Default: 60 attempts / 60 seconds.
    2. Per-Account Limit: Prevents distributed dictionary attacks targeting one account across many IPs.
       Default: 15 attempts / 60 seconds.
    3. Per IP+Account Pair Limit: Prevents rapid credential guessing for a single account from a single IP.
       Default: 10 attempts / 60 seconds.
    """

    def __init__(
        self,
        ip_limit: int = 60,
        account_limit: int = 15,
        pair_limit: int = 10,
        window_seconds: int = 60,
    ) -> None:
        self.ip_limit = ip_limit
        self.account_limit = account_limit
        self.pair_limit = pair_limit
        self.window_seconds = window_seconds

    def check(
        self,
        request: Request,
        response: Response,
        email: str,
    ) -> None:
        if not getattr(settings, "rate_limit_enabled", True):
            return

        if hasattr(request.app, "state") and getattr(request.app.state, "rate_limit_enabled", None) is False:
            return

        client_ip = "127.0.0.1"
        if request.client and request.client.host:
            client_ip = request.client.host
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()

        email_token = normalize_email_for_rate_limit(email)

        redis_client = get_redis_client()

        # Tier 1: Global IP key
        ip_key = f"ratelimit:auth_login:ip:{client_ip}"
        ip_allowed, ip_hits, ip_retry = redis_client.record_hit(
            key=ip_key,
            window_seconds=self.window_seconds,
            max_hits=self.ip_limit,
        )

        # Tier 2: Account key
        acc_key = f"ratelimit:auth_login:acc:{email_token}"
        acc_allowed, acc_hits, acc_retry = redis_client.record_hit(
            key=acc_key,
            window_seconds=self.window_seconds,
            max_hits=self.account_limit,
        )

        # Tier 3: IP + Account Pair key
        pair_key = f"ratelimit:auth_login:pair:{client_ip}:{email_token}"
        pair_allowed, pair_hits, pair_retry = redis_client.record_hit(
            key=pair_key,
            window_seconds=self.window_seconds,
            max_hits=self.pair_limit,
        )

        # Remaining attempts: minimum headroom across tiers
        remaining = max(
            0,
            min(
                self.ip_limit - ip_hits,
                self.account_limit - acc_hits,
                self.pair_limit - pair_hits,
            ),
        )
        response.headers["X-RateLimit-Limit"] = str(self.pair_limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)

        if not (ip_allowed and acc_allowed and pair_allowed):
            retry_after = max(ip_retry, acc_retry, pair_retry, 1)
            response.headers["Retry-After"] = str(retry_after)
            logger.warning(
                "Login rate limit exceeded for client %s (ip_allowed=%s, acc_allowed=%s, pair_allowed=%s). Retry after %ss.",
                client_ip,
                ip_allowed,
                acc_allowed,
                pair_allowed,
                retry_after,
            )
            # Safe generic error message preventing account enumeration
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many login attempts. Please retry in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )

    # Callable support for dependency injection if used directly
    def __call__(
        self,
        request: Request,
        response: Response,
    ) -> None:
        self.check(request, response, "anonymous")


def reset_rate_limits() -> None:
    """Convenience helper to clear all rate limiting records."""
    get_redis_client().reset_all()
