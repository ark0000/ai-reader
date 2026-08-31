from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from src.database import GlobalNotesRepository, DocumentStorageRepository, verify_jwt

router = APIRouter()

def get_current_user(request: Request) -> int:
    token = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
    else:
        token = request.cookies.get("auth_token")
        
    if token:
        payload = verify_jwt(token)
        if payload and "user_id" in payload:
            # Verify user still exists in database
            from src.database import get_db_connection
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT id FROM users WHERE id = ?", (payload["user_id"],))
                if cursor.fetchone():
                    return payload["user_id"]
            
    # Fallback to guest (user_id 1)
    return 1

# Models
class GlobalNote(BaseModel):
    id: Optional[int] = None
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
    try:
        notes = GlobalNotesRepository.get_all(user_id)
        # Map snake_case to camelCase for frontend safely
        return [{
            "id": n["id"],
            "title": n.get("title") or "Untitled Note",
            "content": n.get("content") or "",
            "rawText": n.get("raw_text") or "",
            "createdAt": n.get("created_at"),
            "updatedAt": n.get("updated_at")
        } for n in notes]
    except Exception as e:
        return []

@router.get("/api/notes/global/{note_id}", response_model=dict)
async def get_global_note(note_id: int, user_id: int = Depends(get_current_user)):
    note = GlobalNotesRepository.get(user_id, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return {
        "id": note["id"],
        "title": note.get("title") or "Untitled Note",
        "content": note.get("content") or "",
        "rawText": note.get("raw_text") or "",
        "createdAt": note.get("created_at"),
        "updatedAt": note.get("updated_at")
    }

@router.post("/api/notes/global", response_model=dict)
async def save_global_note(note: GlobalNote, user_id: int = Depends(get_current_user)):
    import time
    note_id = note.id if note.id is not None else int(time.time() * 1000)
    created_at = note.createdAt or (time.time() * 1000)
    updated_at = note.updatedAt or (time.time() * 1000)
    
    success = GlobalNotesRepository.save(
        user_id=user_id,
        note_id=note_id,
        title=note.title or "Untitled Note",
        content=note.content or "",
        raw_text=note.rawText or "",
        created_at=created_at,
        updated_at=updated_at
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save note")
    res = note.model_dump() if hasattr(note, 'model_dump') else note.dict()
    res["id"] = note_id
    res["createdAt"] = created_at
    res["updatedAt"] = updated_at
    return res

@router.delete("/api/notes/global/{note_id}")
async def delete_global_note(note_id: int, user_id: int = Depends(get_current_user)):
    success = GlobalNotesRepository.delete(user_id, note_id)
    if not success:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"status": "success"}


# Document Storage Endpoints
@router.get("/api/storage/document/{key:path}")
async def get_document_storage(key: str, user_id: int = Depends(get_current_user)):
    try:
        data = DocumentStorageRepository.get(user_id, key)
        if not data:
            # Return empty state if not found (200 OK)
            return {"data": {}}
        return {"data": data}
    except Exception as e:
        return {"data": {}}

@router.post("/api/storage/document/{key:path}")
async def save_document_storage(key: str, payload: DocumentStorageData, user_id: int = Depends(get_current_user)):
    try:
        success = DocumentStorageRepository.save(user_id, key, payload.data)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save document storage")
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save document storage: {str(e)}")

@router.get("/api/admin/raw_notes_dump")
async def raw_notes_dump(user_id: int = Depends(get_current_user)):
    from src.database import get_db_connection
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM global_notes WHERE user_id = ?", (user_id,))
            import re
            global_notes = []
            for r in cursor.fetchall():
                d = dict(r)
                if d.get('title'):
                    # Strip book and chapter prefixes for clean admin dump
                    d['title'] = re.sub(r'^\[book:[^\]]+\](?:\[ch:\d+\]\s*)?', '', d['title'])
                global_notes.append(d)
            
            cursor.execute("SELECT * FROM document_storage WHERE user_id = ?", (user_id,))
            doc_storage = []
            import json
            for r in cursor.fetchall():
                d = dict(r)
                if d.get('data_json'):
                    try:
                        d['data_json'] = json.loads(d['data_json'])
                    except:
                        pass
                doc_storage.append(d)
                
            return {
                "user_id": user_id,
                "global_notes_count": len(global_notes),
                "document_storage_count": len(doc_storage),
                "global_notes": global_notes,
                "document_storage": doc_storage
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
