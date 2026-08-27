from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from src.database import GlobalNotesRepository, DocumentStorageRepository, verify_jwt

router = APIRouter()

def get_current_user(request: Request) -> int:
    # First check Authorization header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        payload = verify_jwt(token)
        if payload and "user_id" in payload:
            return payload["user_id"]
            
    # Then check cookies
    token = request.cookies.get("auth_token")
    if token:
        payload = verify_jwt(token)
        if payload and "user_id" in payload:
            return payload["user_id"]
            
    # Fallback to guest (user_id 1)
    return 1

# Models
class GlobalNote(BaseModel):
    id: int
    title: Optional[str] = "Untitled Note"
    content: Optional[str] = ""
    rawText: Optional[str] = ""
    createdAt: Optional[float] = None
    updatedAt: Optional[float] = None

class DocumentStorageData(BaseModel):
    data: Dict[str, Any]

# Global Notes Endpoints
@router.get("/api/notes/global", response_model=List[dict])
async def get_global_notes(user_id: int = Depends(get_current_user)):
    notes = GlobalNotesRepository.get_all(user_id)
    # Map snake_case to camelCase for frontend
    return [{
        "id": n["id"],
        "title": n["title"],
        "content": n["content"],
        "rawText": n["raw_text"],
        "createdAt": n["created_at"],
        "updatedAt": n["updated_at"]
    } for n in notes]

@router.get("/api/notes/global/{note_id}", response_model=dict)
async def get_global_note(note_id: int, user_id: int = Depends(get_current_user)):
    note = GlobalNotesRepository.get(user_id, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return {
        "id": note["id"],
        "title": note["title"],
        "content": note["content"],
        "rawText": note["raw_text"],
        "createdAt": note["created_at"],
        "updatedAt": note["updated_at"]
    }

@router.post("/api/notes/global", response_model=dict)
async def save_global_note(note: GlobalNote, user_id: int = Depends(get_current_user)):
    import time
    created_at = note.createdAt or (time.time() * 1000)
    updated_at = note.updatedAt or (time.time() * 1000)
    
    success = GlobalNotesRepository.save(
        user_id=user_id,
        note_id=note.id,
        title=note.title,
        content=note.content,
        raw_text=note.rawText,
        created_at=created_at,
        updated_at=updated_at
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save note")
    return note.dict()

@router.delete("/api/notes/global/{note_id}")
async def delete_global_note(note_id: int, user_id: int = Depends(get_current_user)):
    success = GlobalNotesRepository.delete(user_id, note_id)
    if not success:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"status": "success"}


# Document Storage Endpoints
@router.get("/api/storage/document/{key}")
async def get_document_storage(key: str, user_id: int = Depends(get_current_user)):
    data = DocumentStorageRepository.get(user_id, key)
    if not data:
        # Return empty state if not found
        return {"data": {}}
    return {"data": data}

@router.post("/api/storage/document/{key}")
async def save_document_storage(key: str, payload: DocumentStorageData, user_id: int = Depends(get_current_user)):
    success = DocumentStorageRepository.save(user_id, key, payload.data)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save document storage")
    return {"status": "success"}
