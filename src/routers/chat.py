import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from src.dependencies import resolve_user
from src.llm_adapter import ProviderFactory
from src.rag_indexer import search_document
from src.task_queue import task_queue

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
        
        if req.rag_enabled:
            logger.info(f"RAG requested for file_id: {req.file_id}")
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
                    context = search_document(req.file_id, user_msg)
                    if context:
                        logger.info(f"Found {len(context)} context chunks. Injecting into user prompt.")
                        context_str = "\n\n".join(context)
                        enhanced_user_msg = f"Context from document:\n{context_str}\n\nQuestion: {user_msg}\n\nPlease answer the question based on the context above. Cite the document if used."
                        messages[user_msg_idx]["content"] = enhanced_user_msg
                    else:
                        logger.warning(f"No context found in ChromaDB for file_id {req.file_id}. Collection might be empty or missing.")
                        
                        # Fallback check if the main PDF conversion task is still extracting text
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
