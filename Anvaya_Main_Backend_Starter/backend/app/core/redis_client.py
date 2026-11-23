from __future__ import annotations

import logging
import threading
import time
from typing import Any

from app.core.config import settings

logger = logging.getLogger("anvaya.core.redis")


class InMemoryFallbackStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sliding_windows: dict[str, list[float]] = {}
        self._ephemeral: dict[str, tuple[str, float]] = {}

    def record_hit(self, key: str, window_seconds: int, max_hits: int) -> tuple[bool, int, int]:
        now = time.time()
        cutoff = now - window_seconds
        with self._lock:
            timestamps = self._sliding_windows.get(key, [])
            # Filter expired timestamps
            timestamps = [t for t in timestamps if t > cutoff]
            current_hits = len(timestamps)

            if current_hits >= max_hits:
                retry_after = max(1, int(timestamps[0] + window_seconds - now))
                self._sliding_windows[key] = timestamps
                return False, current_hits, retry_after

            timestamps.append(now)
            self._sliding_windows[key] = timestamps
            return True, current_hits + 1, 0

    def set_ephemeral(self, key: str, value: str, ttl_seconds: int) -> None:
        expiry = time.time() + ttl_seconds
        with self._lock:
            self._ephemeral[key] = (value, expiry)

    def get_ephemeral(self, key: str, delete: bool = False) -> str | None:
        now = time.time()
        with self._lock:
            if key not in self._ephemeral:
                return None
            val, expiry = self._ephemeral[key]
            if now > expiry:
                del self._ephemeral[key]
                return None
            if delete:
                del self._ephemeral[key]
            return val

    def clear(self) -> None:
        with self._lock:
            self._sliding_windows.clear()
            self._ephemeral.clear()


class RedisClient:
    def __init__(self) -> None:
        self.fallback = InMemoryFallbackStore()
        self.client = None
        self.is_connected = False
        self._connect()

    def _connect(self) -> None:
        try:
            import redis

            client = redis.from_url(
                settings.redis_url,
                socket_timeout=0.5,
                socket_connect_timeout=0.5,
                decode_responses=True,
            )
            client.ping()
            self.client = client
            self.is_connected = True
            logger.info("Connected to Redis at %s", settings.redis_url)
        except Exception as e:
            logger.info("Redis offline or unreachable (%s). Using in-memory fallback store.", e)
            self.client = None
            self.is_connected = False

    def record_hit(self, key: str, window_seconds: int, max_hits: int) -> tuple[bool, int, int]:
        if self.is_connected and self.client is not None:
            try:
                now = time.time()
                cutoff = now - window_seconds
                pipeline = self.client.pipeline()
                pipeline.zremrangebyscore(key, 0, cutoff)
                pipeline.zcard(key)
                pipeline.zrange(key, 0, 0, withscores=True)
                _, current_hits, oldest_entry = pipeline.execute()

                if current_hits >= max_hits:
                    oldest_ts = oldest_entry[0][1] if oldest_entry else now
                    retry_after = max(1, int(oldest_ts + window_seconds - now))
                    return False, current_hits, retry_after

                pipeline = self.client.pipeline()
                pipeline.zadd(key, {str(now): now})
                pipeline.expire(key, window_seconds + 5)
                pipeline.execute()
                return True, current_hits + 1, 0
            except Exception as ex:
                logger.warning("Redis operation failed (%s), switching to in-memory fallback.", ex)
                self.is_connected = False

        return self.fallback.record_hit(key, window_seconds, max_hits)

    def set_ephemeral(self, key: str, value: str, ttl_seconds: int) -> None:
        if self.is_connected and self.client is not None:
            try:
                self.client.setex(key, ttl_seconds, value)
                return
            except Exception as ex:
                logger.warning("Redis setex failed (%s), using in-memory fallback.", ex)
                self.is_connected = False

        self.fallback.set_ephemeral(key, value, ttl_seconds)

    def get_ephemeral(self, key: str, delete: bool = False) -> str | None:
        if self.is_connected and self.client is not None:
            try:
                if delete:
                    pipeline = self.client.pipeline()
                    pipeline.get(key)
                    pipeline.delete(key)
                    val, _ = pipeline.execute()
                    return val
                return self.client.get(key)
            except Exception as ex:
                logger.warning("Redis get failed (%s), using in-memory fallback.", ex)
                self.is_connected = False

        return self.fallback.get_ephemeral(key, delete=delete)

    def reset_all(self) -> None:
        self.fallback.clear()
        if self.is_connected and self.client is not None:
            try:
                self.client.flushdb()
            except Exception:
                pass


_redis_singleton = RedisClient()


def get_redis_client() -> RedisClient:
    return _redis_singleton
