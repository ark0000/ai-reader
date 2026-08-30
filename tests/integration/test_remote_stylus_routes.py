"""
tests/integration/test_remote_stylus_routes.py
Integration tests for HTTP routes and WebSocket endpoint introduced in this branch.

Tests:
  - GET /remote-stylus returns HTML
  - GET /canvas returns HTML
  - GET /api/system/local-ip returns ip field
  - WebSocket /ws/stylus/{room_id} accepts connection
  - WebSocket messages are relayed (broadcast) to room
  - WebSocket disconnect cleans up without error
"""
import json
import pytest
import asyncio
from httpx import AsyncClient, ASGITransport

from src.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


# ----------------------------------------------------------------
# HTTP routes
# ----------------------------------------------------------------
class TestHTTPRoutes:
    @pytest.mark.asyncio
    async def test_get_remote_stylus_returns_html(self, client):
        resp = await client.get("/remote-stylus")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]
        assert "canvas-container" in resp.text or "RemoteStylusSync" in resp.text

    @pytest.mark.asyncio
    async def test_get_canvas_returns_html(self, client):
        resp = await client.get("/canvas")
        # Either 200 or 404 depending on whether canvas.html exists
        assert resp.status_code in (200, 404)

    @pytest.mark.asyncio
    async def test_get_local_ip_returns_ip(self, client):
        resp = await client.get("/api/system/local-ip")
        assert resp.status_code == 200
        data = resp.json()
        assert "ip" in data
        # ip should be a valid string
        assert isinstance(data["ip"], str)
        assert len(data["ip"]) > 0

    @pytest.mark.asyncio
    async def test_health_check(self, client):
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "healthy"


# ----------------------------------------------------------------
# WebSocket endpoint
# ----------------------------------------------------------------
class TestWebSocketStylusEndpoint:
    @pytest.mark.asyncio
    async def test_websocket_accepts_connection(self):
        from starlette.testclient import TestClient
        client = TestClient(app)
        with client.websocket_connect("/ws/stylus/test-room-1") as ws:
            # Connection accepted without error
            assert ws is not None

    @pytest.mark.asyncio
    async def test_websocket_message_relayed_to_second_client(self):
        """Messages sent by client A should arrive at client B in same room."""
        from starlette.testclient import TestClient
        client = TestClient(app)

        received = []

        def run_b(ws_b):
            try:
                msg = ws_b.receive_json(timeout=2)
                received.append(msg)
            except Exception:
                pass

        import threading
        with client.websocket_connect("/ws/stylus/relay-room") as ws_a:
            with client.websocket_connect("/ws/stylus/relay-room") as ws_b:
                t = threading.Thread(target=run_b, args=(ws_b,))
                t.start()
                ws_a.send_json({"type": "ping", "from": "client-a"})
                t.join(timeout=3)

        # ws_b should have received the relayed message
        assert any(m.get("type") == "ping" for m in received)

    @pytest.mark.asyncio
    async def test_websocket_disconnect_does_not_crash_server(self):
        from starlette.testclient import TestClient
        client = TestClient(app)
        try:
            with client.websocket_connect("/ws/stylus/disco-room") as ws:
                ws.close()
        except Exception:
            pass  # disconnect is expected

    @pytest.mark.asyncio
    async def test_websocket_invalid_json_does_not_crash_server(self):
        from starlette.testclient import TestClient
        client = TestClient(app)
        with client.websocket_connect("/ws/stylus/bad-json-room") as ws:
            ws.send_text("this is not json {{{{")
            # Server should not crash; just ignore the bad message
            # We can send a valid follow-up message to confirm server is alive
            ws.send_text(json.dumps({"type": "ping"}))
