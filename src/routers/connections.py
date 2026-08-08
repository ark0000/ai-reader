from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from src.database import ConnectionRepository
from src.dependencies import resolve_user

router = APIRouter(prefix="/api", tags=["connections"])

class ConnectionCreate(BaseModel):
    provider_id: str
    name: str
    base_url: str = ""
    model: str = ""
    api_key: str = ""
    is_active: bool = False

class ConnectionUpdate(BaseModel):
    provider_id: str
    name: str
    base_url: str = ""
    model: str = ""
    api_key: Optional[str] = None
    is_active: bool = False

@router.get("/providers")
async def api_get_providers():
    return ConnectionRepository.get_providers()

import urllib.parse
import ipaddress
import socket
from src.config import settings

def is_safe_url(url: str) -> bool:
    if settings.debug_console == "1":
        return True
    try:
        parsed = urllib.parse.urlparse(url)
        if not parsed.hostname:
            return False
        ip_addr = socket.gethostbyname(parsed.hostname)
        ip = ipaddress.ip_address(ip_addr)
        if ip.is_loopback or ip.is_private or ip.is_multicast or ip.is_link_local:
            return False
        return True
    except Exception:
        return False

@router.post("/connections/test")
async def api_test_connection(req: ConnectionUpdate, request: Request, user_data: dict = Depends(resolve_user)):
    base_url = req.base_url
    if not base_url:
        providers = ConnectionRepository.get_providers()
        p = next((x for x in providers if x["id"] == req.provider_id), None)
        if not p:
            raise HTTPException(status_code=400, detail="Invalid provider")
        base_url = p["base_url_template"]
        
    if not is_safe_url(base_url):
        return {"status": "error", "message": "Connection to this address is blocked for security reasons."}
        
    test_url = base_url.rstrip("/") + "/models"
    
    headers = {}
    if req.api_key:
        if req.provider_id == "anthropic":
            headers["x-api-key"] = req.api_key
        else:
            headers["Authorization"] = f"Bearer {req.api_key}"
            
    try:
        r = await request.app.state.http_client.get(test_url, headers=headers, timeout=5.0)
        if r.status_code == 200:
            return {"status": "success", "message": "Connection successful"}
        else:
            return {"status": "error", "message": f"HTTP {r.status_code} - {r.text[:100]}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.get("/connections")
async def api_get_connections(user_data: dict = Depends(resolve_user)):
    return ConnectionRepository.get_all(user_data["user_id"])

@router.post("/connections")
async def api_create_connection(req: ConnectionCreate, user_data: dict = Depends(resolve_user)):
    conn_id = ConnectionRepository.create(
        user_data["user_id"], req.provider_id, req.name,
        req.base_url, req.model, req.api_key, req.is_active
    )
    return {"status": "success", "connection_id": conn_id}

@router.put("/connections/{connection_id}")
async def api_update_connection(connection_id: int, req: ConnectionUpdate, user_data: dict = Depends(resolve_user)):
    ConnectionRepository.update(
        user_data["user_id"], connection_id, req.provider_id, req.name,
        req.base_url, req.model, req.api_key, req.is_active
    )
    return {"status": "success"}

@router.delete("/connections/{connection_id}")
async def api_delete_connection(connection_id: int, user_data: dict = Depends(resolve_user)):
    ConnectionRepository.delete(user_data["user_id"], connection_id)
    return {"status": "success"}

@router.post("/connections/{connection_id}/active")
async def api_set_active_connection(connection_id: int, user_data: dict = Depends(resolve_user)):
    ConnectionRepository.set_active(user_data["user_id"], connection_id)
    return {"status": "success"}
