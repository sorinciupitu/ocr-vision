import asyncio
import time
from unittest.mock import AsyncMock

import pytest

from app.vllm_lifecycle import VLLMIdleManager


@pytest.mark.asyncio
async def test_idle_manager_sleeps_after_timeout_and_wakes_on_request():
    manager = VLLMIdleManager("http://vllm:8000", idle_timeout_seconds=600)
    manager._post_control = AsyncMock()
    manager._last_activity = time.monotonic() - 601

    await manager._sleep_if_idle()

    manager._post_control.assert_awaited_once_with("/sleep", params={"level": 2})
    assert manager._sleeping is True

    manager._post_control.reset_mock()
    async with manager.request():
        assert manager._active_requests == 1

    manager._post_control.assert_awaited_once_with("/wake_up")
    assert manager._active_requests == 0
    assert manager._sleeping is False


@pytest.mark.asyncio
async def test_idle_manager_does_not_sleep_while_request_is_active():
    manager = VLLMIdleManager("http://vllm:8000", idle_timeout_seconds=600)
    manager._post_control = AsyncMock()
    manager._last_activity = time.monotonic() - 601

    async with manager.request():
        await manager._sleep_if_idle()

    manager._post_control.assert_not_awaited()


def test_idle_manager_can_be_disabled():
    manager = VLLMIdleManager("http://vllm:8000", idle_timeout_seconds=0)

    assert manager.enabled is False
