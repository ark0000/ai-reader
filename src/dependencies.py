from typing import Optional
from fastapi import Header, HTTPException
from src.database import verify_jwt

_GUEST = {"user_id": 1, "username": "guest"}

def resolve_user(
    user: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None)
) -> dict:
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
    elif user:
        token = user

    if token:
        data = verify_jwt(token)
        if data and "user_id" in data:
            # Prevent stale JWT tokens from violating foreign keys if the user was deleted/missing
            from src.database import get_db_connection
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT id FROM users WHERE id = ?", (data["user_id"],))
                if cursor.fetchone():
                    return data
            
    return _GUEST
