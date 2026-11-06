"""Keep the vLLM model asleep while the application is idle."""

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class VLLMIdleManager:
    """Wake vLLM for requests and release its GPU allocations after idle time."""

    def __init__(
        self,
        control_url: str,
        idle_timeout_seconds: float,
        enabled: bool = True,
        control_timeout_seconds: float = 60.0,
    ):
        self.control_url = control_url.rstrip("/")
        self.idle_timeout_seconds = max(0.0, idle_timeout_seconds)
        self.enabled = enabled and bool(self.control_url) and self.idle_timeout_seconds > 0
        self.control_timeout_seconds = control_timeout_seconds
        self._lock = asyncio.Lock()
        self._active_requests = 0
        self._last_activity = time.monotonic()
        self._sleeping = False
        self._monitor_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        if not self.enabled or self._monitor_task is not None:
            return
        self._monitor_task = asyncio.create_task(self._monitor_idle_state())
        logger.info(
            "vLLM idle sleep enabled: model will sleep after %.0f seconds",
            self.idle_timeout_seconds,
        )

    async def stop(self) -> None:
        task = self._monitor_task
        self._monitor_task = None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    @asynccontextmanager
    async def request(self, active: bool = True) -> AsyncIterator[None]:
        """Keep the model awake for one in-flight vLLM request."""
        if not active or not self.enabled:
            yield
            return

        await self._begin_request()
        try:
            yield
        finally:
            await self._finish_request()

    async def _begin_request(self) -> None:
        async with self._lock:
            if self._active_requests == 0 and self._sleeping:
                await self._post_control("/wake_up")
                self._sleeping = False
                logger.info("vLLM woke up for a new request")
            self._active_requests += 1
            self._last_activity = time.monotonic()

    async def _finish_request(self) -> None:
        async with self._lock:
            self._active_requests = max(0, self._active_requests - 1)
            self._last_activity = time.monotonic()

    async def _monitor_idle_state(self) -> None:
        interval = min(30.0, max(1.0, self.idle_timeout_seconds / 4))
        while True:
            await asyncio.sleep(interval)
            await self._sleep_if_idle()

    async def _sleep_if_idle(self) -> None:
        async with self._lock:
            if self._sleeping or self._active_requests:
                return
            idle_for = time.monotonic() - self._last_activity
            if idle_for < self.idle_timeout_seconds:
                return

            try:
                # Level 2 discards model weights and KV cache from GPU memory.
                await self._post_control("/sleep", params={"level": 2})
            except (httpx.HTTPError, OSError) as exc:
                # Keep retrying on the next monitor tick if vLLM is still starting
                # or temporarily unavailable, without taking down the backend.
                self._last_activity = time.monotonic()
                logger.warning("Could not put vLLM to sleep: %s", exc)
                return

            self._sleeping = True
            logger.info("vLLM put to sleep after %.0f seconds of inactivity", idle_for)

    async def _post_control(self, path: str, params: Optional[dict] = None) -> None:
        async with httpx.AsyncClient(timeout=self.control_timeout_seconds) as client:
            response = await client.post(f"{self.control_url}{path}", params=params)
            response.raise_for_status()


settings = get_settings()
vllm_idle_manager = VLLMIdleManager(
    control_url=settings.vllm_control_url,
    idle_timeout_seconds=settings.vllm_idle_timeout_seconds,
    enabled=settings.vllm_idle_sleep_enabled,
    control_timeout_seconds=settings.vllm_control_timeout_seconds,
)
