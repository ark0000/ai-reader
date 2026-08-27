import sqlite3
import os
import json
import time
import hmac
import hashlib
import base64
import logging
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from typing import Optional, List, Dict, Any

from src.config import settings

logger = logging.getLogger(__name__)

# ── Per-user row caps (configurable via env) ─────────────────────────────
MAX_HISTORY_ROWS = int(os.environ.get("AURA_MAX_HISTORY_ROWS", "1000"))
MAX_THEME_ROWS = int(os.environ.get("AURA_MAX_THEME_ROWS", "100"))
MAX_CONNECTION_ROWS = int(os.environ.get("AURA_MAX_CONNECTION_ROWS", "50"))


DB_PATH = os.path.join(os.path.dirname(__file__), "database.db")
SECRET_KEY = settings.jwt_secret_key
_ENCRYPTION_KEY = hashlib.sha256(SECRET_KEY.encode()).digest()

def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 30000;")
    return conn

def init_db():
    """Initializes database schemas for users, custom themes, and upload history."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Create Users Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            hashed_password TEXT NOT NULL
        )
    """)
    
    # 2. Create Saved Themes Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS themes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            bg_color TEXT NOT NULL,
            text_color TEXT NOT NULL,
            sat_factor REAL DEFAULT 0.8,
            brightness_factor REAL DEFAULT 1.3,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    """)
    
    # 3. Create Conversion History Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            pages_count INTEGER NOT NULL,
            created_at REAL NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    """)
    
    # 4. Create Providers Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS providers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            base_url_template TEXT,
            auth_type TEXT NOT NULL
        )
    """)
    
    # 5. Create Connections Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            provider_id TEXT NOT NULL,
            name TEXT NOT NULL,
            base_url TEXT,
            model TEXT,
            is_active INTEGER DEFAULT 0,
            created_at REAL NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (provider_id) REFERENCES providers (id)
        )
    """)
    
    # 6. Create Credentials Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS credentials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id INTEGER NOT NULL,
            encrypted_key TEXT NOT NULL,
            FOREIGN KEY (connection_id) REFERENCES connections (id) ON DELETE CASCADE
        )
    """)
    
    # 7. Create Global Notes Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS global_notes (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL,
            title TEXT,
            content TEXT,
            raw_text TEXT,
            created_at REAL,
            updated_at REAL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    """)
    
    # 8. Create Document Storage Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS document_storage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            document_key TEXT NOT NULL,
            data_json TEXT,
            updated_at REAL,
            UNIQUE(user_id, document_key),
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    """)
    
    # Seed providers if empty
    cursor.execute("SELECT COUNT(*) FROM providers")
    if cursor.fetchone()[0] == 0:
        providers = [
            ("openai", "OpenAI", "cloud", "https://api.openai.com/v1", "bearer"),
            ("anthropic", "Anthropic (Claude)", "cloud", "https://api.anthropic.com/v1", "header-x-api-key"),
            ("gemini", "Google Gemini", "cloud", "https://generativelanguage.googleapis.com/v1beta", "query-key"),
            ("lmstudio", "LM Studio (Local)", "local", "http://127.0.0.1:1234/v1", "bearer-optional"),
            ("ollama", "Ollama (Local)", "local", "http://127.0.0.1:11434/v1", "none"),
        ]
        cursor.executemany("INSERT INTO providers (id, name, type, base_url_template, auth_type) VALUES (?, ?, ?, ?, ?)", providers)

    # Ensure guest user (id=1) always exists for unauthenticated/offline access
    cursor.execute("INSERT OR IGNORE INTO users (id, username, hashed_password) VALUES (1, 'guest', '!locked')")

    conn.commit()
    conn.close()
    logger.info("SQLite database initialized successfully.")

# ----------------- Cryptography & Hashing Helpers -----------------

def hash_password(password: str) -> str:
    salt = os.urandom(16).hex()
    hashed = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}:{hashed}"

def verify_password(password: str, hashed_password: str) -> bool:
    try:
        salt, hashed = hashed_password.split(":")
        test_hashed = hashlib.sha256((salt + password).encode()).hexdigest()
        return hmac.compare_digest(test_hashed, hashed)
    except Exception:
        return False

def encrypt_key(plain_key: str) -> str:
    if not plain_key: return ""
    aesgcm = AESGCM(_ENCRYPTION_KEY)
    nonce = os.urandom(12)
    encrypted = aesgcm.encrypt(nonce, plain_key.encode(), None)
    return base64.b64encode(nonce + encrypted).decode('utf-8')

def decrypt_key(encrypted_payload: str) -> str:
    if not encrypted_payload: return ""
    try:
        data = base64.b64decode(encrypted_payload.encode('utf-8'))
        nonce = data[:12]
        encrypted = data[12:]
        aesgcm = AESGCM(_ENCRYPTION_KEY)
        return aesgcm.decrypt(nonce, encrypted, None).decode('utf-8')
    except Exception as e:
        logger.error(f"Failed to decrypt API key: {e}")
        return ""

# ----------------- Pure Python JWT Implementation -----------------

def create_jwt(payload: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    header_json = json.dumps(header).encode()
    header_b64 = base64.urlsafe_b64encode(header_json).decode().rstrip("=")
    
    payload_dict = dict(payload)
    payload_dict["exp"] = int(time.time()) + 86400
    payload_json = json.dumps(payload_dict).encode()
    payload_b64 = base64.urlsafe_b64encode(payload_json).decode().rstrip("=")
    
    signing_input = f"{header_b64}.{payload_b64}".encode()
    signature = hmac.new(SECRET_KEY.encode(), signing_input, hashlib.sha256).digest()
    signature_b64 = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    
    return f"{header_b64}.{payload_b64}.{signature_b64}"

def verify_jwt(token: str) -> Optional[dict]:
    try:
        parts = token.split(".")
        if len(parts) != 3: return None
        header_b64, payload_b64, signature_b64 = parts
        
        signing_input = f"{header_b64}.{payload_b64}".encode()
        test_signature = hmac.new(SECRET_KEY.encode(), signing_input, hashlib.sha256).digest()
        test_signature_b64 = base64.urlsafe_b64encode(test_signature).decode().rstrip("=")
        
        if not hmac.compare_digest(signature_b64, test_signature_b64): return None
        
        padding = "=" * (4 - len(payload_b64) % 4)
        payload_bytes = base64.urlsafe_b64decode(payload_b64 + padding)
        payload = json.loads(payload_bytes.decode())
        
        if payload.get("exp", 0) < time.time(): return None
        return payload
    except Exception as e:
        logger.error(f"JWT verification error: {e}")
        return None

# ----------------- Repositories -----------------

class UserRepository:
    @staticmethod
    def register(username: str, password: str) -> Optional[int]:
        hashed = hash_password(password)
        with get_db_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute("INSERT INTO users (username, hashed_password) VALUES (?, ?)", (username, hashed))
                return cursor.lastrowid
            except sqlite3.IntegrityError:
                return None

    @staticmethod
    def authenticate(username: str, password: str) -> Optional[dict]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, username, hashed_password FROM users WHERE username = ?", (username,))
            row = cursor.fetchone()
            if row and verify_password(password, row["hashed_password"]):
                return {"id": row["id"], "username": row["username"]}
            return None

class HistoryRepository:
    @staticmethod
    def add_entry(user_id: int, filename: str, pages_count: int):
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # Fix 5a: prune oldest entries when cap is reached
            cursor.execute("SELECT COUNT(*) FROM history WHERE user_id = ?", (user_id,))
            if cursor.fetchone()[0] >= MAX_HISTORY_ROWS:
                cursor.execute(
                    "DELETE FROM history WHERE user_id = ? AND id IN "
                    "(SELECT id FROM history WHERE user_id = ? ORDER BY created_at ASC LIMIT ?)",
                    (user_id, user_id, max(1, cursor.execute(
                        "SELECT COUNT(*) FROM history WHERE user_id = ?", (user_id,)
                    ).fetchone()[0] - MAX_HISTORY_ROWS + 1))
                )
            cursor.execute(
                "INSERT INTO history (user_id, filename, pages_count, created_at) VALUES (?, ?, ?, ?)",
                (user_id, filename, pages_count, time.time())
            )

    @staticmethod
    def get_user_history(user_id: int) -> List[dict]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT filename, pages_count, created_at FROM history WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
            return [dict(r) for r in cursor.fetchall()]

class ThemeRepository:
    @staticmethod
    def add_theme(user_id: int, name: str, bg_color: str, text_color: str, sat_factor: float, brightness_factor: float):
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # Fix 5b: enforce theme cap per user
            cursor.execute("SELECT COUNT(*) FROM themes WHERE user_id = ?", (user_id,))
            if cursor.fetchone()[0] >= MAX_THEME_ROWS:
                raise ValueError(f"Theme limit reached ({MAX_THEME_ROWS} max). Please delete an existing theme first.")
            cursor.execute(
                "INSERT INTO themes (user_id, name, bg_color, text_color, sat_factor, brightness_factor) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, name, bg_color, text_color, sat_factor, brightness_factor)
            )

    @staticmethod
    def get_user_themes(user_id: int) -> List[dict]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name, bg_color, text_color, sat_factor, brightness_factor FROM themes WHERE user_id = ?", (user_id,))
            return [dict(r) for r in cursor.fetchall()]

class ConnectionRepository:
    @staticmethod
    def get_providers() -> list:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM providers")
            return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def create(user_id: int, provider_id: str, name: str, base_url: str, model: str, api_key: str, is_active: bool) -> int:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # Fix 5c: enforce connection cap per user
            cursor.execute("SELECT COUNT(*) FROM connections WHERE user_id = ?", (user_id,))
            if cursor.fetchone()[0] >= MAX_CONNECTION_ROWS:
                raise ValueError(f"Connection limit reached ({MAX_CONNECTION_ROWS} max). Please delete an existing connection first.")
            if is_active:
                cursor.execute("UPDATE connections SET is_active = 0 WHERE user_id = ?", (user_id,))
            cursor.execute(
                "INSERT INTO connections (user_id, provider_id, name, base_url, model, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (user_id, provider_id, name, base_url, model, 1 if is_active else 0, time.time())
            )
            conn_id = cursor.lastrowid
            if api_key:
                encrypted = encrypt_key(api_key)
                cursor.execute("INSERT INTO credentials (connection_id, encrypted_key) VALUES (?, ?)", (conn_id, encrypted))
            return conn_id

    @staticmethod
    def update(user_id: int, connection_id: int, provider_id: str, name: str, base_url: str, model: str, api_key: str, is_active: bool) -> bool:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            if is_active:
                cursor.execute("UPDATE connections SET is_active = 0 WHERE user_id = ?", (user_id,))
            cursor.execute(
                "UPDATE connections SET provider_id=?, name=?, base_url=?, model=?, is_active=? WHERE id=? AND user_id=?",
                (provider_id, name, base_url, model, 1 if is_active else 0, connection_id, user_id)
            )
            if api_key is not None:
                if api_key:
                    encrypted = encrypt_key(api_key)
                    cursor.execute("DELETE FROM credentials WHERE connection_id=?", (connection_id,))
                    cursor.execute("INSERT INTO credentials (connection_id, encrypted_key) VALUES (?, ?)", (connection_id, encrypted))
                else:
                    cursor.execute("DELETE FROM credentials WHERE connection_id=?", (connection_id,))
            return True

    @staticmethod
    def get_all(user_id: int) -> list:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT c.*, p.name as provider_name, p.type as provider_type 
                FROM connections c 
                JOIN providers p ON c.provider_id = p.id 
                WHERE c.user_id = ?
                ORDER BY c.created_at DESC
            """, (user_id,))
            rows = cursor.fetchall()
            
            conns = []
            for r in rows:
                d = dict(r)
                cursor.execute("SELECT 1 FROM credentials WHERE connection_id = ?", (d['id'],))
                d['has_key'] = bool(cursor.fetchone())
                conns.append(d)
            return conns

    @staticmethod
    def set_active(user_id: int, connection_id: int) -> bool:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE connections SET is_active = 0 WHERE user_id = ?", (user_id,))
            cursor.execute("UPDATE connections SET is_active = 1 WHERE user_id = ? AND id = ?", (user_id, connection_id))
            return cursor.rowcount > 0

    @staticmethod
    def delete(user_id: int, connection_id: int) -> bool:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM connections WHERE user_id = ? AND id = ?", (user_id, connection_id))
            return cursor.rowcount > 0

    @staticmethod
    def get_with_key(user_id: int, connection_id: int) -> Optional[dict]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT c.*, p.auth_type, p.base_url_template, cr.encrypted_key
                FROM connections c
                JOIN providers p ON c.provider_id = p.id
                LEFT JOIN credentials cr ON cr.connection_id = c.id
                WHERE c.user_id = ? AND c.id = ?
            """, (user_id, connection_id))
            row = cursor.fetchone()
            if not row: return None
            d = dict(row)
            if d.get('encrypted_key'):
                d['api_key'] = decrypt_key(d['encrypted_key'])
                del d['encrypted_key']
            else:
                d['api_key'] = None
            return d

    @staticmethod
    def get_active_with_key(user_id: int) -> Optional[dict]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT c.*, p.auth_type, p.base_url_template, cr.encrypted_key
                FROM connections c
                JOIN providers p ON c.provider_id = p.id
                LEFT JOIN credentials cr ON cr.connection_id = c.id
                WHERE c.user_id = ? AND c.is_active = 1
                LIMIT 1
            """, (user_id,))
            row = cursor.fetchone()
            if not row: return None
            d = dict(row)
            if d.get('encrypted_key'):
                d['api_key'] = decrypt_key(d['encrypted_key'])
                del d['encrypted_key']
            else:
                d['api_key'] = None
            return d

class GlobalNotesRepository:
    @staticmethod
    def get_all(user_id: int) -> List[dict]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM global_notes WHERE user_id = ? ORDER BY updated_at DESC", (user_id,))
            return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def get(user_id: int, note_id: int) -> Optional[dict]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM global_notes WHERE user_id = ? AND id = ?", (user_id, note_id))
            row = cursor.fetchone()
            return dict(row) if row else None

    @staticmethod
    def save(user_id: int, note_id: int, title: str, content: str, raw_text: str, created_at: float, updated_at: float):
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO global_notes (id, user_id, title, content, raw_text, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,
                    content=excluded.content,
                    raw_text=excluded.raw_text,
                    updated_at=excluded.updated_at
            """, (note_id, user_id, title, content, raw_text, created_at, updated_at))
            return True

    @staticmethod
    def delete(user_id: int, note_id: int) -> bool:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM global_notes WHERE user_id = ? AND id = ?", (user_id, note_id))
            return cursor.rowcount > 0

class DocumentStorageRepository:
    @staticmethod
    def get(user_id: int, document_key: str) -> Optional[dict]:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT data_json FROM document_storage WHERE user_id = ? AND document_key = ?", (user_id, document_key))
            row = cursor.fetchone()
            if row and row['data_json']:
                return json.loads(row['data_json'])
            return None

    @staticmethod
    def save(user_id: int, document_key: str, data: dict):
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Fetch existing to merge
            cursor.execute("SELECT data_json FROM document_storage WHERE user_id = ? AND document_key = ?", (user_id, document_key))
            row = cursor.fetchone()
            existing_data = {}
            if row and row['data_json']:
                try:
                    existing_data = json.loads(row['data_json'])
                except Exception:
                    pass
            
            # Deep-ish merge (top level keys)
            existing_data.update(data)
            
            cursor.execute("""
                INSERT INTO document_storage (user_id, document_key, data_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, document_key) DO UPDATE SET
                    data_json=excluded.data_json,
                    updated_at=excluded.updated_at
            """, (user_id, document_key, json.dumps(existing_data), time.time()))
            return True

# ----------------- Backward-Compatible Helper Wrappers -----------------

def register_user(username: str, password: str) -> Optional[int]:
    return UserRepository.register(username, password)

def authenticate_user(username: str, password: str) -> Optional[dict]:
    return UserRepository.authenticate(username, password)

def get_user_history(user_id: int) -> List[dict]:
    return HistoryRepository.get_user_history(user_id)

def add_history_entry(user_id: int, filename: str, pages_count: int):
    return HistoryRepository.add_entry(user_id, filename, pages_count)

