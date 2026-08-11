import logging
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from src.dependencies import resolve_user
from src.database import ConnectionRepository
from typing import Optional

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["tts"])

class TTSRequest(BaseModel):
    connection_id: int
    text: str
    voice: str = "alloy"

@router.post("/tts")
async def generate_tts(req: TTSRequest, request: Request, user_data: dict = Depends(resolve_user)):
    user_id = user_data["id"]
    conn = ConnectionRepository.get_with_key(user_id, req.connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
        
    if conn["provider_id"] != "openai":
        raise HTTPException(status_code=400, detail="Cloud TTS currently only supports OpenAI connections.")
        
    api_key = conn["api_key"]
    if not api_key:
        raise HTTPException(status_code=400, detail="No API key provided for this connection.")

    openai_url = "https://api.openai.com/v1/audio/speech"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "tts-1",
        "input": req.text,
        "voice": req.voice
    }
    
    async def stream_audio():
        async with httpx.AsyncClient() as client:
            async with client.stream("POST", openai_url, headers=headers, json=payload, timeout=30.0) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    logger.error(f"OpenAI TTS error: {response.status_code} - {error_text}")
                    yield b""
                    return
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    yield chunk

    return StreamingResponse(stream_audio(), media_type="audio/mpeg")
