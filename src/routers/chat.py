import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from src.dependencies import resolve_user
from src.llm_adapter import ProviderFactory
from src.task_queue import task_queue
from src.rag.manager import RAGManager
# Import default provider so it registers itself
import src.rag.providers.local_chroma

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["chat"])

import json
import httpx
from fastapi.responses import StreamingResponse

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequestWithConnection(BaseModel):
    connection_id: int
    messages: List[dict]
    temperature: float = 0.7
    rag_enabled: bool = False
    file_id: Optional[str] = None
    top_k: int = 3

async def _prepare_messages_with_rag(req: ChatRequestWithConnection) -> List[dict]:
    messages = req.messages.copy()
    if req.rag_enabled:
        logger.info(f"RAG requested for file_id: {req.file_id}, top_k: {req.top_k}")
        if req.file_id:
            user_msg_idx = -1
            user_msg = ""
            for i in range(len(messages) - 1, -1, -1):
                if messages[i]["role"] == "user":
                    user_msg_idx = i
                    user_msg = messages[i]["content"]
                    break
                    
            if user_msg:
                rag_task_id = f"rag_{req.file_id}"
                task_status = task_queue.get_status(rag_task_id)
                if task_status and task_status["status"] in ["pending", "processing"]:
                    logger.warning(f"RAG indexing still in progress for {req.file_id}")
                    progress = task_status.get("progress", 0)
                    total = task_status.get("total", 0)
                    
                    if total > 0:
                        percent = int((progress / total) * 100)
                        detail_msg = f"Document indexing is still in progress ({percent}% completed). Please wait a moment and try again."
                    else:
                        detail_msg = "Document indexing is still in progress (0% completed). Please wait a moment and try again."
                        
                    raise HTTPException(status_code=409, detail=detail_msg)
                    
                logger.info(f"Searching ChromaDB for file: {req.file_id} with query: '{user_msg}'")
                rag_provider = RAGManager.get_provider("default")
                context = rag_provider.search_document(req.file_id, user_msg, top_k=req.top_k) if rag_provider else []
                
                if context:
                    logger.info(f"Found {len(context)} context chunks. Injecting into user prompt.")
                    context_str = "\n\n".join(context)
                    enhanced_user_msg = (
                        f"Context from document:\n{context_str}\n\n"
                        f"Question: {user_msg}\n\n"
                        f"Please answer the question based on the document context above. "
                        f"When referencing specific pages or sections from the context, include page citations in the format [Page X]."
                    )
                    messages[user_msg_idx]["content"] = enhanced_user_msg
                else:
                    logger.warning(f"No context found in ChromaDB for file_id {req.file_id}.")
                    pdf_task_status = task_queue.get_status(req.file_id)
                    if pdf_task_status and pdf_task_status["status"] in ["pending", "processing"]:
                        progress = pdf_task_status.get("progress", 0)
                        total = pdf_task_status.get("total", 0)
                        if total > 0:
                            percent = int((progress / total) * 100)
                            detail_msg = f"Reading text from PDF... ({percent}% completed). RAG will begin indexing shortly."
                        else:
                            detail_msg = "Reading text from PDF... RAG will begin indexing shortly."
                        raise HTTPException(status_code=409, detail=detail_msg)
                        
                    raise HTTPException(status_code=404, detail="No readable text found for this document, or it has not been indexed yet. Please try again in a few seconds.")
        else:
            logger.warning("RAG is enabled but no file_id was provided!")
    return messages

@router.post("/chat")
async def api_chat(req: ChatRequestWithConnection, request: Request, user_data: dict = Depends(resolve_user)):
    try:
        messages = await _prepare_messages_with_rag(req)
        http_client = getattr(request.app.state, "http_client", None) or httpx.AsyncClient(timeout=60.0)
        adapter = ProviderFactory.get_provider_by_connection(
            user_data["user_id"], 
            req.connection_id, 
            http_client
        )
        response = await adapter.generate_completion(messages, temperature=req.temperature)
        return response
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat completion error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))

@router.post("/chat/stream")
async def api_chat_stream(req: ChatRequestWithConnection, request: Request, user_data: dict = Depends(resolve_user)):
    try:
        messages = await _prepare_messages_with_rag(req)
        http_client = getattr(request.app.state, "http_client", None) or httpx.AsyncClient(timeout=60.0)
        adapter = ProviderFactory.get_provider_by_connection(
            user_data["user_id"], 
            req.connection_id, 
            http_client
        )
        
        async def event_generator():
            try:
                async for token in adapter.generate_stream(messages, temperature=req.temperature):
                    yield f"data: {json.dumps({'token': token})}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as e:
                logger.error(f"Streaming generator error: {e}", exc_info=True)
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat streaming error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=str(e))
