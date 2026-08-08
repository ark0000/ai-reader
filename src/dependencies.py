from typing import Optional
from fastapi import Header, HTTPException
from src.database import verify_jwt

_GUEST = {"user_id": 1, "username": "guest"}

def resolve_user(
    user: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None)
) -> dict:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
        data = verify_jwt(token)
        if data:
            return data

    if user:
        data = verify_jwt(user)
        if data:
            return data
            
    return _GUEST
