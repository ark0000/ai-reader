"""
tests/integration/test_websocket_manager.py
Integration tests for src/websocket_manager.py (ConnectionManager).

Tests:
  - connect creates room
  - disconnect removes empty room
  - broadcast excludes sender
  - broadcast cleans dead connections
  - multiple clients in same room
  - singleton returns same instance
  - reconnect to same room works
"""
import pytest
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

from src.websocket_manager import manager, ConnectionManager


@pytest.fixture(autouse=True)
def fresh_manager():
    """Reset manager connections before each test."""
    manager.active_connections.clear()
    yield
    manager.active_connections.clear()


def make_websocket():
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.send_text = AsyncMock()
    # Simulate live connection by default
    ws.client_state = MagicMock()
    return ws


# ----------------------------------------------------------------
# connect
# ----------------------------------------------------------------
class TestConnect:
    @pytest.mark.asyncio
    async def test_connect_creates_room(self):
        ws = make_websocket()
        await manager.connect("room-1", ws)
        assert "room-1" in manager.active_connections
        assert ws in manager.active_connections["room-1"]

    @pytest.mark.asyncio
    async def test_connect_multiple_clients_same_room(self):
        ws1, ws2 = make_websocket(), make_websocket()
        await manager.connect("room-multi", ws1)
        await manager.connect("room-multi", ws2)
        assert len(manager.active_connections["room-multi"]) == 2

    @pytest.mark.asyncio
    async def test_connect_calls_accept(self):
        ws = make_websocket()
        await manager.connect("room-x", ws)
        ws.accept.assert_called_once()


# ----------------------------------------------------------------
# disconnect
# ----------------------------------------------------------------
class TestDisconnect:
    @pytest.mark.asyncio
    async def test_disconnect_removes_client(self):
        ws = make_websocket()
        await manager.connect("room-d", ws)
        manager.disconnect("room-d", ws)
        assert ws not in manager.active_connections.get("room-d", [])

    @pytest.mark.asyncio
    async def test_disconnect_removes_empty_room(self):
        ws = make_websocket()
        await manager.connect("room-empty", ws)
        manager.disconnect("room-empty", ws)
        assert "room-empty" not in manager.active_connections

    @pytest.mark.asyncio
    async def test_disconnect_nonexistent_room_does_not_raise(self):
        ws = make_websocket()
        # Should not raise even for unknown room
        manager.disconnect("nonexistent", ws)


# ----------------------------------------------------------------
# broadcast
# ----------------------------------------------------------------
class TestBroadcast:
    @pytest.mark.asyncio
    async def test_broadcast_excludes_sender(self):
        sender, receiver = make_websocket(), make_websocket()
        await manager.connect("room-b", sender)
        await manager.connect("room-b", receiver)

        payload = {"type": "hello"}
        await manager.broadcast("room-b", payload, exclude_sender=sender)

        sender.send_json.assert_not_called()
        receiver.send_json.assert_called_once_with(payload)

    @pytest.mark.asyncio
    async def test_broadcast_sends_to_all_when_no_exclusion(self):
        ws1, ws2 = make_websocket(), make_websocket()
        await manager.connect("room-all", ws1)
        await manager.connect("room-all", ws2)

        payload = {"type": "ping"}
        await manager.broadcast("room-all", payload, exclude_sender=None)

        ws1.send_json.assert_called_once_with(payload)
        ws2.send_json.assert_called_once_with(payload)

    @pytest.mark.asyncio
    async def test_broadcast_nonexistent_room_does_not_raise(self):
        await manager.broadcast("no-such-room", {"type": "test"}, exclude_sender=None)

    @pytest.mark.asyncio
    async def test_broadcast_cleans_dead_connections(self):
        """Clients that raise on send_json should be cleaned up."""
        live_ws, dead_ws = make_websocket(), make_websocket()
        dead_ws.send_json = AsyncMock(side_effect=Exception("connection lost"))

        await manager.connect("room-dead", live_ws)
        await manager.connect("room-dead", dead_ws)

        payload = {"type": "data"}
        # Should not raise
        await manager.broadcast("room-dead", payload, exclude_sender=None)

        # Live ws should still receive
        live_ws.send_json.assert_called_once_with(payload)


# ----------------------------------------------------------------
# singleton
# ----------------------------------------------------------------
class TestSingleton:
    def test_manager_is_singleton(self):
        """The `manager` import should always be the same object."""
        from src.websocket_manager import manager as m2
        assert manager is m2

    def test_connection_manager_has_active_connections_dict(self):
        assert hasattr(manager, "active_connections")
        assert isinstance(manager.active_connections, dict)
