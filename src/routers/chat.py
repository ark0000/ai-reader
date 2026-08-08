import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from src.dependencies import resolve_user
from src.llm_adapter import ProviderFactory
from src.rag_indexer import search_document

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["chat"])

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequestWithConnection(BaseModel):
    connection_id: int
    messages: List[dict]
    temperature: float = 0.7
    rag_enabled: bool = False
    file_id: Optional[str] = None

@router.post("/chat")
async def api_chat(req: ChatRequestWithConnection, request: Request, user_data: dict = Depends(resolve_user)):
    try:
        messages = req.messages.copy()
        
        if req.rag_enabled and req.file_id:
            user_msg = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
            if user_msg:
                context = search_document(req.file_id, user_msg)
                if context:
                    context_str = "\n\n".join(context)
                    context_msg = f"Context from document:\n{context_str}\n\nUse this context to answer the user's question. Cite the context if used."
                    
                    # Consolidate all system messages into a single system message
                    system_msgs = [m["content"] for m in messages if m["role"] == "system"]
                    other_msgs = [m for m in messages if m["role"] != "system"]
                    
                    combined_system_content = "\n\n".join(system_msgs + [context_msg])
                    messages = [{"role": "system", "content": combined_system_content}] + other_msgs
                    
                    logger.info(f"Injected RAG context for {req.file_id}")

        adapter = ProviderFactory.get_provider_by_connection(
            user_data["user_id"], 
            req.connection_id, 
            request.app.state.http_client
        )
        response = await adapter.generate_completion(messages, temperature=req.temperature)
        return response
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Chat completion error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))
