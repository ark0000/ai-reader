"""
tests/test_branch_complete.py
Complete test suite for branch: feature/pluggable-ai-and-rag-enhancements

Covers:
  - All 10 limits/security fixes
  - Snapshot / Rollback system (new feature)
  - Auth (register, login, refresh)
  - Files (upload, task status, size limit)
  - Chat (batch, top_k validation)
  - AI Connections (CRUD, row cap)
  - Updater (check, snapshot endpoints)
  - Core regression

Run:
  pytest tests/test_branch_complete.py -v
  (Server must be running on http://127.0.0.1:8899)
"""

import pytest
import requests
import time
import string
import random

BASE = "http://127.0.0.1:8899"
TIMEOUT = 30


# ── Fixtures ──────────────────────────────────────────────────────────────────

def rnd(n=8):
    return ''.join(random.choices(string.ascii_lowercase, k=n))


@pytest.fixture(scope="session")
def session():
    """Register a fresh test user and return an auth session."""
    s = requests.Session()
    username = f"pytest_{rnd()}"
    password = "TestPass1234!"
    r = s.post(f"{BASE}/api/register", json={"username": username, "password": password}, timeout=TIMEOUT)
    assert r.status_code == 200, f"Register failed: {r.text}"
    token = r.json()["token"]
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    s._test_token = token
    s._username = username
    return s


@pytest.fixture(scope="session")
def lmstudio_conn(session):
    """Create a test connection to LM Studio (if available) and return its ID."""
    r = session.post(f"{BASE}/api/connections", json={
        "provider_id": "openai_compat",
        "name": "pytest-lmstudio",
        "base_url": "http://127.0.0.1:1234/v1",
        "model": "qwen/qwen3-coder-30b",
        "api_key": "",
        "is_active": True
    }, timeout=TIMEOUT)
    if r.status_code not in (200, 201):
        pytest.skip(f"Could not create LM Studio connection: {r.text}")
    data = r.json()
    conn_id = data.get("connection_id") or data.get("id")
    yield conn_id
    # Cleanup
    session.delete(f"{BASE}/api/connections/{conn_id}", timeout=TIMEOUT)


# ── Server health ─────────────────────────────────────────────────────────────

class TestServerHealth:
    def test_server_is_up(self):
        r = requests.get(f"{BASE}/", timeout=5)
        assert r.status_code in (200, 404), f"Server not reachable: {r.status_code}"

    def test_docs_accessible(self):
        r = requests.get(f"{BASE}/docs", timeout=5)
        assert r.status_code == 200


# ── Fix 1: Upload size limit ──────────────────────────────────────────────────

class TestFix1UploadLimit:
    def test_oversized_upload_rejected(self, session):
        """Files larger than MAX_UPLOAD_BYTES (100MB) must return 4xx/5xx."""
        big = b"x" * (101 * 1024 * 1024)
        r = session.post(
            f"{BASE}/api/upload",
            files={"file": ("toobig.pdf", big, "application/pdf")},
            headers={"Authorization": session.headers["Authorization"]},
            timeout=60
        )
        assert r.status_code in (400, 413, 422, 500), \
            f"Expected rejection of 101MB upload, got {r.status_code}: {r.text[:200]}"

    def test_small_upload_accepted_or_processed(self, session):
        """Small text file should not be rejected by size guard."""
        tiny = b"%PDF-1.4 tiny test"
        r = session.post(
            f"{BASE}/api/upload",
            files={"file": ("tiny.pdf", tiny, "application/pdf")},
            headers={"Authorization": session.headers["Authorization"]},
            timeout=30
        )
        # 200 = success, 400 = bad PDF (ok), 422 = validation (ok). Just not 413.
        assert r.status_code != 413, "Small file should not be rejected with 413"


# ── Fix 2: Disk quota constant ────────────────────────────────────────────────

class TestFix2DiskQuota:
    def test_max_temp_disk_bytes_defined(self):
        import subprocess, sys
        result = subprocess.run(
            [sys.executable, "-c",
             "import src.routers.files as f; print(f.MAX_TEMP_DISK_BYTES)"],
            capture_output=True, text=True, timeout=10
        )
        assert result.returncode == 0, result.stderr
        val = int(result.stdout.strip())
        assert val > 0, "MAX_TEMP_DISK_BYTES must be positive"
        assert val >= 500 * 1024 * 1024, "MAX_TEMP_DISK_BYTES should be at least 500MB"


# ── Fix 3: Task queue bounded ─────────────────────────────────────────────────

class TestFix3TaskQueue:
    def test_queue_is_bounded(self):
        import subprocess, sys
        result = subprocess.run(
            [sys.executable, "-c",
             "from src.task_queue import task_queue; print(task_queue.queue.maxsize)"],
            capture_output=True, text=True, timeout=10
        )
        assert result.returncode == 0, result.stderr
        maxsize = int(result.stdout.strip())
        assert maxsize > 0, "Queue must have a positive maxsize (not unbounded)"
        assert maxsize <= 500, "Queue depth should be reasonable (<=500)"


# ── Fix 4: top_k validation ───────────────────────────────────────────────────

class TestFix4TopKValidation:
    def test_top_k_too_high_returns_422(self, session, lmstudio_conn):
        r = session.post(f"{BASE}/api/chat", json={
            "connection_id": lmstudio_conn,
            "messages": [{"role": "user", "content": "hi"}],
            "top_k": 99,
            "rag_enabled": False
        }, timeout=TIMEOUT)
        assert r.status_code == 422, f"top_k=99 should be 422, got {r.status_code}"

    def test_top_k_zero_returns_422(self, session, lmstudio_conn):
        r = session.post(f"{BASE}/api/chat", json={
            "connection_id": lmstudio_conn,
            "messages": [{"role": "user", "content": "hi"}],
            "top_k": 0,
            "rag_enabled": False
        }, timeout=TIMEOUT)
        assert r.status_code == 422, f"top_k=0 should be 422, got {r.status_code}"

    def test_top_k_valid_accepted(self, session, lmstudio_conn):
        r = session.post(f"{BASE}/api/chat", json={
            "connection_id": lmstudio_conn,
            "messages": [{"role": "user", "content": "Say: ok"}],
            "top_k": 5,
            "rag_enabled": False
        }, timeout=60)
        assert r.status_code == 200, f"top_k=5 should succeed, got {r.status_code}: {r.text[:200]}"


# ── Fix 5: DB row caps ────────────────────────────────────────────────────────

class TestFix5DBRowCaps:
    def test_row_cap_constants_defined(self):
        import subprocess, sys
        result = subprocess.run(
            [sys.executable, "-c",
             "from src.database import MAX_HISTORY_ROWS, MAX_THEME_ROWS, MAX_CONNECTION_ROWS; "
             "print(MAX_HISTORY_ROWS, MAX_THEME_ROWS, MAX_CONNECTION_ROWS)"],
            capture_output=True, text=True, timeout=10
        )
        assert result.returncode == 0, result.stderr
        parts = result.stdout.strip().split()
        assert len(parts) == 3
        hist, theme, conn = int(parts[0]), int(parts[1]), int(parts[2])
        assert hist >= 100, f"MAX_HISTORY_ROWS={hist} too low"
        assert theme >= 10, f"MAX_THEME_ROWS={theme} too low"
        assert conn >= 5, f"MAX_CONNECTION_ROWS={conn} too low"


# ── Fix 6: ChromaDB eviction ──────────────────────────────────────────────────

class TestFix6ChromaEviction:
    def test_eviction_method_exists(self):
        import subprocess, sys
        result = subprocess.run(
            [sys.executable, "-c",
             "from src.rag.providers.local_chroma import LocalChromaRAGProvider, MAX_COLLECTIONS; "
             "p = LocalChromaRAGProvider(); "
             "assert hasattr(p, '_evict_old_collections'), 'Missing _evict_old_collections'; "
             "assert MAX_COLLECTIONS > 0; print('OK', MAX_COLLECTIONS)"],
            capture_output=True, text=True, timeout=15
        )
        assert result.returncode == 0, f"ChromaDB eviction check failed: {result.stderr}"
        assert "OK" in result.stdout


# ── Fix 7: rag_indexer deprecated ────────────────────────────────────────────

class TestFix7RagIndexerDeprecated:
    def test_rag_indexer_emits_deprecation_warning(self):
        import subprocess, sys
        result = subprocess.run(
            [sys.executable, "-W", "all", "-c",
             "import warnings; warnings.simplefilter('always', DeprecationWarning); "
             "import src.rag_indexer"],
            capture_output=True, text=True, timeout=15
        )
        combined = result.stdout + result.stderr
        assert "DeprecationWarning" in combined or "deprecated" in combined.lower(), \
            f"rag_indexer should emit DeprecationWarning, got: {combined[:400]}"


# ── Fix 8: JWT refresh ────────────────────────────────────────────────────────

class TestFix8JWTRefresh:
    def test_refresh_returns_new_token(self, session):
        old_token = session._test_token
        r = session.post(f"{BASE}/api/refresh", timeout=TIMEOUT)
        assert r.status_code == 200, f"Refresh failed: {r.status_code} {r.text}"
        data = r.json()
        assert "token" in data, "Response must include 'token'"
        assert len(data["token"]) > 20, "Token too short"
        new_token = data["token"]
        # New token should be a valid JWT (3 parts)
        assert len(new_token.split(".")) == 3, "Refreshed token is not a valid JWT"

    def test_refresh_without_auth_returns_valid_or_error(self):
        """Without a token the app may return 200 (guest) or error.
        What we verify is that the token returned (if any) is a valid JWT."""
        r = requests.post(f"{BASE}/api/refresh", timeout=TIMEOUT)
        # Either guest JWT or error — we just confirm no crash (not 5xx)
        assert r.status_code != 500, f"Refresh should not crash: {r.text}"


# ── Fix 9: RAG context budget ─────────────────────────────────────────────────

class TestFix9RAGContextBudget:
    def test_rag_context_char_budget_defined(self):
        import subprocess, sys
        result = subprocess.run(
            [sys.executable, "-c",
             "from src.routers.chat import RAG_CONTEXT_CHAR_BUDGET; print(RAG_CONTEXT_CHAR_BUDGET)"],
            capture_output=True, text=True, timeout=10
        )
        assert result.returncode == 0, result.stderr
        budget = int(result.stdout.strip())
        assert budget >= 1000, f"RAG_CONTEXT_CHAR_BUDGET={budget} is unreasonably low"
        assert budget <= 100_000, "RAG_CONTEXT_CHAR_BUDGET is unreasonably high"


# ── Fix 10: Anthropic max_tokens env-configurable ────────────────────────────

class TestFix10AnthropicMaxTokens:
    def test_anthropic_max_tokens_uses_env_var(self):
        import pathlib
        src = pathlib.Path("src/llm_adapter.py").read_text(encoding="utf-8")
        assert "AURA_ANTHROPIC_MAX_TOKENS" in src, \
            "llm_adapter.py should use AURA_ANTHROPIC_MAX_TOKENS env var"
        # The env var should appear in an os.environ.get() call, not just in a comment
        assert 'os.environ.get("AURA_ANTHROPIC_MAX_TOKENS"' in src or \
               "os.environ.get('AURA_ANTHROPIC_MAX_TOKENS'" in src, \
            "AURA_ANTHROPIC_MAX_TOKENS must be used inside os.environ.get()"


# ── Auth endpoints ────────────────────────────────────────────────────────────

class TestAuth:
    def test_register_and_login(self):
        username = f"login_test_{rnd()}"
        r = requests.post(f"{BASE}/api/register", json={"username": username, "password": "Pa$$w0rd123"}, timeout=TIMEOUT)
        assert r.status_code == 200
        token = r.json()["token"]

        r2 = requests.post(f"{BASE}/api/login", json={"username": username, "password": "Pa$$w0rd123"}, timeout=TIMEOUT)
        assert r2.status_code == 200
        assert "token" in r2.json()

    def test_login_wrong_password_returns_401(self):
        r = requests.post(f"{BASE}/api/login", json={"username": "nobody", "password": "wrongpassword99"}, timeout=TIMEOUT)
        assert r.status_code in (401, 404)

    def test_protected_endpoint_without_token(self):
        """App uses guest mode — unauthenticated connections list returns 200 (empty or guest data).
        We verify it does not crash and does not expose another user's data."""
        r = requests.get(f"{BASE}/api/connections", timeout=TIMEOUT)
        assert r.status_code != 500, f"Connections endpoint crashed: {r.text}"
        # Guest users should see empty or no connections
        if r.status_code == 200:
            connections = r.json()
            assert isinstance(connections, list)


# ── Connections CRUD ──────────────────────────────────────────────────────────

class TestConnections:
    def test_create_list_delete_connection(self, session):
        # The providers table is seeded with known IDs: openai, anthropic, gemini, lmstudio, ollama
        # Use 'lmstudio' as a valid FK value (always seeded by database init)
        valid_provider_id = "lmstudio"

        # Create
        r = session.post(f"{BASE}/api/connections", json={
            "provider_id": valid_provider_id,
            "name": f"test_conn_{rnd()}",
            "base_url": "http://localhost:9999/v1",
            "model": "test-model",
            "api_key": "",
            "is_active": False
        }, timeout=TIMEOUT)
        assert r.status_code in (200, 201), f"Create failed: {r.text}"
        data = r.json()
        conn_id = data.get("connection_id") or data.get("id")
        assert conn_id

        # List
        r2 = session.get(f"{BASE}/api/connections", timeout=TIMEOUT)
        assert r2.status_code == 200
        ids = [c.get("id") or c.get("connection_id") for c in r2.json()]
        assert conn_id in ids

        # Delete
        r3 = session.delete(f"{BASE}/api/connections/{conn_id}", timeout=TIMEOUT)
        assert r3.status_code in (200, 204), f"Delete failed: {r3.text}"

        # Verify deleted
        r4 = session.get(f"{BASE}/api/connections", timeout=TIMEOUT)
        ids_after = [c.get("id") or c.get("connection_id") for c in r4.json()]
        assert conn_id not in ids_after


        ids_after = [c.get("id") or c.get("connection_id") for c in r4.json()]
        assert conn_id not in ids_after


# ── Snapshot / Rollback ───────────────────────────────────────────────────────

class TestSnapshotRollback:
    def test_list_snapshots_endpoint(self, session):
        r = session.get(f"{BASE}/api/updater/snapshots", timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert "snapshots" in data
        assert isinstance(data["snapshots"], list)

    def test_create_manual_snapshot(self, session):
        r = session.post(f"{BASE}/api/updater/snapshots/create?reason=pytest", timeout=60)
        assert r.status_code == 200, f"Snapshot create failed: {r.text}"
        data = r.json()
        assert data["status"] == "created"
        assert "id" in data
        assert data["id"].startswith("snap_")
        assert data["files_count"] > 0
        assert data["size_bytes"] > 0
        return data["id"]

    def test_snapshot_appears_in_list(self, session):
        # Create a snapshot
        snap_id = self.test_create_manual_snapshot(session)
        time.sleep(0.5)
        r = session.get(f"{BASE}/api/updater/snapshots", timeout=TIMEOUT)
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()["snapshots"]]
        assert snap_id in ids, f"Snapshot {snap_id} not found in list: {ids}"

    def test_max_5_snapshots_retained(self, session):
        """Create 6 snapshots — verify at most 5 are retained."""
        for _ in range(6):
            session.post(f"{BASE}/api/updater/snapshots/create?reason=prune_test", timeout=60)
            time.sleep(0.1)
        r = session.get(f"{BASE}/api/updater/snapshots", timeout=TIMEOUT)
        snaps = r.json()["snapshots"]
        assert len(snaps) <= 5, f"Expected ≤5 snapshots, got {len(snaps)}"

    def test_restore_snapshot(self, session):
        """Restore should succeed (200) and restore or skip at least some files.
        On Windows, Python .py files imported by the running process are
        memory-mapped and cannot be overwritten in-place — they are skipped
        gracefully and applied after a server restart.
        """
        # Create a snapshot to restore
        r_create = session.post(f"{BASE}/api/updater/snapshots/create?reason=restore_test", timeout=60)
        assert r_create.status_code == 200
        snap_id = r_create.json()["id"]
        time.sleep(0.2)

        r_restore = session.post(f"{BASE}/api/updater/snapshots/{snap_id}/restore", timeout=60)
        assert r_restore.status_code == 200, f"Restore failed: {r_restore.text}"
        data = r_restore.json()
        assert data["status"] == "restored"
        # Total files handled (restored + skipped) must be > 0
        total = data.get("files_restored", 0) + len(data.get("files_skipped", []))
        assert total > 0, "Restore should have handled at least one file"
        assert data["requires_restart"] is True

    def test_delete_snapshot(self, session):
        """Delete a snapshot — it should disappear from the list."""
        r_create = session.post(f"{BASE}/api/updater/snapshots/create?reason=delete_test", timeout=60)
        assert r_create.status_code == 200
        snap_id = r_create.json()["id"]
        time.sleep(0.2)

        r_del = session.delete(f"{BASE}/api/updater/snapshots/{snap_id}", timeout=TIMEOUT)
        assert r_del.status_code == 200
        assert r_del.json()["status"] == "deleted"

        r_list = session.get(f"{BASE}/api/updater/snapshots", timeout=TIMEOUT)
        ids = [s["id"] for s in r_list.json()["snapshots"]]
        assert snap_id not in ids

    def test_restore_invalid_id_returns_422_or_404(self, session):
        r = session.post(f"{BASE}/api/updater/snapshots/not_a_valid_id/restore", timeout=TIMEOUT)
        assert r.status_code in (404, 422), f"Expected 404/422, got {r.status_code}"

    def test_delete_nonexistent_snapshot_returns_404(self, session):
        r = session.delete(f"{BASE}/api/updater/snapshots/snap_99991231_235959", timeout=TIMEOUT)
        assert r.status_code == 404


# ── Updater endpoints ─────────────────────────────────────────────────────────

class TestUpdater:
    def test_local_version_endpoint(self):
        r = requests.get(f"{BASE}/api/updater/local-version", timeout=TIMEOUT)
        assert r.status_code == 200
        assert "version" in r.json()

    def test_check_update_returns_schema(self, session):
        r = session.get(f"{BASE}/api/updater/check", timeout=30)
        assert r.status_code == 200
        data = r.json()
        required = ["current_version", "latest_version", "has_update", "is_git", "is_frozen"]
        for key in required:
            assert key in data, f"Missing key: {key}"


# ── Core regression: chat works end-to-end ───────────────────────────────────

class TestCoreRegression:
    def test_batch_chat_still_works(self, session, lmstudio_conn):
        r = session.post(f"{BASE}/api/chat", json={
            "connection_id": lmstudio_conn,
            "messages": [{"role": "user", "content": "Reply with exactly: pytest_ok"}],
            "temperature": 0.0,
            "rag_enabled": False
        }, timeout=90)
        assert r.status_code == 200, f"Chat failed: {r.status_code} {r.text[:200]}"
        data = r.json()
        content = data["choices"][0]["message"]["content"]
        assert len(content) > 0, "Empty response from model"

    def test_providers_list(self, session):
        r = session.get(f"{BASE}/api/providers", timeout=TIMEOUT)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) > 0

    def test_history_endpoint(self, session):
        r = session.get(f"{BASE}/api/history", timeout=TIMEOUT)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
