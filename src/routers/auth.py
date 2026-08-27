from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from src.database import UserRepository, HistoryRepository, create_jwt, verify_jwt, get_db_connection, hash_password
from src.dependencies import resolve_user

router = APIRouter(prefix="/api", tags=["auth"])

class AuthRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8, max_length=128)

@router.post("/register")
@router.post("/auth/register")
async def api_register(req: AuthRequest):
    user_id = UserRepository.register(req.username, req.password)
    if user_id is None:
        raise HTTPException(status_code=400, detail="Username is already taken.")
    token = create_jwt({"user_id": user_id, "username": req.username})
    return {"token": token, "username": req.username}

@router.post("/login")
@router.post("/auth/login")
async def api_login(req: AuthRequest):
    user = UserRepository.authenticate(req.username, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token = create_jwt({"user_id": user["id"], "username": user["username"]})
    return {"token": token, "username": user["username"]}

class MockLoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)

@router.post("/mock-login")
async def api_mock_login(req: MockLoginRequest):
    import sqlite3
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE username = ?", (req.username,))
        row = cursor.fetchone()
        if not row:
            from src.database import hash_password
            hashed = hash_password("!mockpassword")
            try:
                cursor.execute("INSERT INTO users (username, hashed_password) VALUES (?, ?)", (req.username, hashed))
                conn.commit()
                user_id = cursor.lastrowid
            except sqlite3.IntegrityError:
                # Race condition: someone else inserted it between our SELECT and INSERT
                cursor.execute("SELECT id FROM users WHERE username = ?", (req.username,))
                user_id = cursor.fetchone()["id"]
        else:
            user_id = row["id"]
            
    token = create_jwt({"user_id": user_id, "username": req.username})
    return {"token": token, "username": req.username}

# Fix 8: Token refresh endpoint — allows the client to silently renew a JWT
# before it expires, preventing the user from being logged out unexpectedly.
@router.post("/refresh")
async def api_refresh_token(user_data: dict = Depends(resolve_user)):
    """Issues a fresh 24-hour JWT for the currently authenticated user."""
    token = create_jwt({"user_id": user_data["user_id"], "username": user_data["username"]})
    return {"token": token, "username": user_data["username"]}

@router.get("/history")
async def api_get_history(user_data: dict = Depends(resolve_user)):
    return HistoryRepository.get_user_history(user_data["user_id"])
