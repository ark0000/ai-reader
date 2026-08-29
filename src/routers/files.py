import os
import io
import time
import uuid
import random
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, Form, status
from fastapi.responses import RedirectResponse, FileResponse
from pydantic import BaseModel
import fitz

from src.dependencies import resolve_user
from src.database import HistoryRepository
from src.storage import get_storage
from src.task_queue import task_queue
from src.pdf_converter import convert_pdf_to_dark_mode
from src.rag.manager import RAGManager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["files"])

# ── Storage limits ──────────────────────────────────────────────────────────
MAX_UPLOAD_BYTES = int(os.environ.get("AURA_MAX_UPLOAD_MB", "100")) * 1024 * 1024  # default 100 MB
MAX_TEMP_DISK_BYTES = int(os.environ.get("AURA_MAX_TEMP_DISK_MB", "2048")) * 1024 * 1024  # default 2 GB

storage_client = get_storage()
task_user_mapping = {}

class PubSubMessage(BaseModel):
    data: str
    messageId: Optional[str] = None
    message_id: Optional[str] = None
    publishTime: Optional[str] = None
    publish_time: Optional[str] = None

class PubSubEnvelope(BaseModel):
    message: PubSubMessage
    subscription: Optional[str] = None

@router.post("/pubsub", status_code=status.HTTP_200_OK)
async def process_pubsub_message(envelope: PubSubEnvelope):
    import base64
    import json
    if not envelope.message.data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Pub/Sub message: empty data field"
        )
    try:
        raw_json = base64.b64decode(envelope.message.data).decode("utf-8")
        payload = json.loads(raw_json)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Pub/Sub message: payload must be valid base64-encoded JSON"
        )

    filename = payload.get("name") or payload.get("filename")
    if not filename:
        return {"status": "skipped", "reason": "no_filename"}

    from src.main import simulate_ocr
    tags, word_count = simulate_ocr(filename)
    return {
        "status": "success",
        "inserted_data": {
            "filename": filename,
            "tags": tags,
            "word_count": word_count,
            "processed_at": time.time()
        }
    }

class IndexTextRequest(BaseModel):
    file_id: str
    text: str

@router.post("/api/rag/index_text")
async def api_index_text(req: IndexTextRequest, user_data: dict = Depends(resolve_user)):
    if not req.text.strip():
        return {"status": "skipped", "message": "No text provided"}
    
    rag_provider = RAGManager.get_provider("default")
    if rag_provider:
        def rag_index_wrapper(fid: str, txt: str):
            def progress_cb(progress, total):
                task_queue.update_progress(f"rag_{fid}", progress, total)
            rag_provider.index_document(fid, txt, progress_callback=progress_cb)
            
        task_queue.add_task(f"rag_{req.file_id}", user_data["user_id"], rag_index_wrapper, req.file_id, req.text)
    
    return {"status": "queued", "file_id": req.file_id}

@router.post("/api/upload")
async def upload_pdf(file: UploadFile, user_data: dict = Depends(resolve_user)):
    ext = file.filename.lower().split('.')[-1]
    is_pdf = (ext == "pdf")
    if ext not in ["pdf", "epub", "md", "txt"]:
        raise HTTPException(status_code=400, detail="Only PDF, EPUB, MD, and TXT files are supported.")
        
    user_id = user_data.get("user_id", 1)
    task_id = uuid.uuid4().hex
    
    try:
        content_bytes = await file.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read upload: {str(e)}")

    # ── Fix 1: enforce upload size limit ──────────────────────────────────
    if len(content_bytes) > MAX_UPLOAD_BYTES:
        limit_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        actual_mb = len(content_bytes) / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({actual_mb:.1f} MB). Maximum allowed upload size is {limit_mb} MB."
        )

    # ── Fix 2: enforce temp disk quota ────────────────────────────────────
    from src.storage import LOCAL_TEMP_DIR
    try:
        current_disk = sum(
            os.path.getsize(os.path.join(LOCAL_TEMP_DIR, f))
            for f in os.listdir(LOCAL_TEMP_DIR)
            if os.path.isfile(os.path.join(LOCAL_TEMP_DIR, f))
        )
        if current_disk + len(content_bytes) > MAX_TEMP_DISK_BYTES:
            limit_gb = MAX_TEMP_DISK_BYTES / (1024 ** 3)
            raise HTTPException(
                status_code=507,
                detail=f"Server storage quota exceeded ({limit_gb:.0f} GB limit). Try again later or contact the administrator."
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Disk quota check failed (non-fatal): {e}")

    input_filename = f"{task_id}_input.{ext}"
    try:
        storage_client.save_file(content_bytes, input_filename)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write storage: {str(e)}")

        
    total_pages = 1
    if ext == "pdf":
        try:
            doc = fitz.open(stream=content_bytes, filetype="pdf")
            total_pages = len(doc)
            doc.close()
        except Exception as e:
            storage_client.delete_file(input_filename)
            raise HTTPException(status_code=400, detail=f"Invalid or corrupted PDF file: {str(e)}")
        
    doc_text = ""
    if is_pdf:
        try:
            doc = fitz.open(stream=content_bytes, filetype="pdf")
            for page in doc:
                doc_text += page.get_text("text") + "\n\n"
            doc.close()
        except Exception as e:
            logger.error(f"Failed to extract PDF text for RAG: {e}")
    elif ext == "md":
        doc_text = content_bytes.decode('utf-8', errors='ignore')
    elif ext == "epub":
        import zipfile
        import re
        try:
            with zipfile.ZipFile(io.BytesIO(content_bytes)) as z:
                for zname in z.namelist():
                    if zname.endswith(('.html', '.xhtml', '.htm')):
                        html = z.read(zname).decode('utf-8', errors='ignore')
                        text = re.sub('<[^<]+>', ' ', html)
                        doc_text += text + "\n\n"
        except Exception as e:
            logger.error(f"Failed to extract EPUB text for RAG: {e}")

    if doc_text.strip():
        def rag_index_wrapper(fid: str, txt: str):
            rag_provider = RAGManager.get_provider("default")
            if rag_provider:
                def progress_cb(progress, total):
                    task_queue.update_progress(f"rag_{fid}", progress, total)
                rag_provider.index_document(fid, txt, progress_callback=progress_cb)
                
        task_queue.add_task(f"rag_{task_id}", user_data["user_id"], rag_index_wrapper, task_id, doc_text)
            
    task_user_mapping[task_id] = {
        "user_id": user_id,
        "filename": file.filename,
        "total_pages": total_pages
    }
    
    task_queue.tasks[task_id] = {
        "status": "pending" if is_pdf else "completed",
        "user_id": user_id,
        "progress": 0 if is_pdf else 100,
        "total": total_pages,
        "error": None,
        "created_at": time.time(),
        "started_at": None if is_pdf else time.time(),
        "completed_at": None if is_pdf else time.time(),
        "file_url": None if is_pdf else storage_client.get_file_url_or_path(input_filename),
        "ext": ext
    }
    
    return {"task_id": task_id, "total_pages": total_pages, "ext": ext}

def run_full_conversion_job(
    task_id: str,
    dpi: int,
    quality: int,
    smart_invert: bool,
    brightness: float,
    color_mode: str,
    custom_bg_rgb: Optional[tuple],
    custom_text_rgb: Optional[tuple],
    custom_sat: Optional[float],
    max_workers: int,
    font_family_override: str,
    font_quality: str,
    concurrency_mode: str
):
    from src.storage import LOCAL_TEMP_DIR
    
    input_filename = f"{task_id}_input.pdf"
    output_filename = f"{task_id}_dark.pdf"
    
    local_input = os.path.join(LOCAL_TEMP_DIR, input_filename)
    local_output = os.path.join(LOCAL_TEMP_DIR, output_filename)
    
    try:
        input_bytes = storage_client.get_file_content_bytes(input_filename)
        with open(local_input, "wb") as f:
            f.write(input_bytes)
            
        def progress_callback(current, total):
            task_queue.update_progress(task_id, current, total)
            
        convert_pdf_to_dark_mode(
            input_path=local_input,
            output_path=local_output,
            dpi=dpi,
            jpeg_quality=quality,
            smart_invert=smart_invert,
            progress_callback=progress_callback,
            brightness_factor=brightness,
            color_mode=color_mode,
            custom_bg_rgb=custom_bg_rgb,
            custom_text_rgb=custom_text_rgb,
            custom_sat_factor=custom_sat,
            max_workers=max_workers,
            font_family_override=font_family_override,
            font_quality=font_quality,
            concurrency_mode=concurrency_mode
        )
        
        with open(local_output, "rb") as f:
            output_bytes = f.read()
            
        storage_client.save_file(output_bytes, output_filename)
        file_url = storage_client.get_file_url_or_path(output_filename)
        
        meta = task_user_mapping.get(task_id)
        if meta and meta["user_id"]:
            HistoryRepository.add_entry(meta["user_id"], meta["filename"], meta["total_pages"])
            
        task_queue.set_completed(task_id, file_url)
        
    except Exception as e:
        logger.error(f"Task {task_id} failed in Queue worker: {e}", exc_info=True)
        task_queue.set_failed(task_id, str(e))
    finally:
        task_user_mapping.pop(task_id, None)
        # B-08 FIX: clean up BOTH temp files to prevent disk leak
        for tmp_path in (local_input, local_output):
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass

@router.post("/api/convert/{task_id}")
async def start_conversion(
    task_id: str,
    user_data: dict = Depends(resolve_user),
    dpi: int = Form(150),
    quality: int = Form(80),
    smart_invert: bool = Form(True),
    brightness: float = Form(1.3),
    color_mode: str = Form("comfort"),
    threads: int = Form(4),
    custom_bg_r: Optional[int] = Form(None),
    custom_bg_g: Optional[int] = Form(None),
    custom_bg_b: Optional[int] = Form(None),
    custom_text_r: Optional[int] = Form(None),
    custom_text_g: Optional[int] = Form(None),
    custom_text_b: Optional[int] = Form(None),
    custom_sat: Optional[float] = Form(None),
    fontFamily: str = Form("original"),
    fontQuality: str = Form("8"),
    concurrencyMode: str = Form("auto")
):
    if task_id not in task_queue.tasks:
        raise HTTPException(status_code=404, detail="Task context not found. Please upload file first.")
        
    custom_bg_rgb = (custom_bg_r, custom_bg_g, custom_bg_b) if custom_bg_r is not None else None
    custom_text_rgb = (custom_text_r, custom_text_g, custom_text_b) if custom_text_r is not None else None
    
    task_queue.add_task(
        task_id,
        user_data["user_id"],
        run_full_conversion_job,
        task_id,
        dpi,
        quality,
        smart_invert,
        brightness,
        color_mode,
        custom_bg_rgb,
        custom_text_rgb,
        custom_sat,
        threads,
        fontFamily,
        fontQuality,
        concurrencyMode
    )
    
    return {"task_id": task_id}

@router.get("/api/status/{task_id}")
async def get_task_status(task_id: str, user_data: dict = Depends(resolve_user)):
    from src.storage import LOCAL_TEMP_DIR
    from src.database import get_db_connection
    import os
    import json
    
    status_data = task_queue.get_status(task_id)
    original_filename = None
    
    is_vault = False
    vault_ext = None
    for ext in ['pdf', 'md', 'epub', 'txt']:
        if os.path.exists(os.path.join(LOCAL_TEMP_DIR, f"{task_id}_input.{ext}")):
            is_vault = True
            vault_ext = ext
            break
            
    meta_path = os.path.join(LOCAL_TEMP_DIR, f"{task_id}_meta.json")
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as mf:
                meta = json.load(mf)
                original_filename = meta.get("original_filename")
        except Exception:
            pass

    is_shared = False
    if not original_filename:
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT filename FROM shared_files WHERE task_id = ?", (task_id,))
                row = cursor.fetchone()
                if row:
                    original_filename = row["filename"]
                    is_shared = True
        except Exception:
            pass

    if not status_data:
        if is_vault or is_shared:
            ext = vault_ext
            if not ext and original_filename:
                ext = original_filename.split('.')[-1] if '.' in original_filename else 'pdf'
            return {"status": "completed", "ext": ext, "original_filename": original_filename}
        raise HTTPException(status_code=404, detail="Task not found")
        
    if original_filename:
        status_data["original_filename"] = original_filename
        
    return status_data

@router.get("/api/preview/render")
async def render_preview(
    task_id: str,
    page_num: int = 1,
    color_mode: str = "comfort",
    brightness: float = 1.0,
    smart_invert: bool = True,
    preview_type: str = "dark",
    custom_bg_r: Optional[int] = None,
    custom_bg_g: Optional[int] = None,
    custom_bg_b: Optional[int] = None,
    custom_text_r: Optional[int] = None,
    custom_text_g: Optional[int] = None,
    custom_text_b: Optional[int] = None,
    custom_sat: Optional[float] = None,
    user_data: dict = Depends(resolve_user)
):
    from fastapi.responses import Response
    from src.pdf_converter import render_single_page_to_bytes
    from src.storage import LOCAL_TEMP_DIR

    input_filename = f"{task_id}_input.pdf"
    local_path = os.path.join(LOCAL_TEMP_DIR, input_filename)

    content_bytes = None
    if os.path.exists(local_path):
        try:
            with open(local_path, "rb") as f:
                content_bytes = f.read()
        except Exception:
            pass

    if not content_bytes:
        try:
            content_bytes = storage_client.get_file_content_bytes(input_filename)
        except Exception:
            raise HTTPException(status_code=404, detail="Input file not found for preview.")

    custom_bg_rgb = (custom_bg_r, custom_bg_g, custom_bg_b) if custom_bg_r is not None else None
    custom_text_rgb = (custom_text_r, custom_text_g, custom_text_b) if custom_text_r is not None else None

    try:
        jpeg_bytes = render_single_page_to_bytes(
            input_path=content_bytes,
            page_num=page_num,
            dpi=100,
            smart_invert=smart_invert,
            brightness_factor=brightness,
            color_mode=color_mode,
            custom_bg_rgb=custom_bg_rgb,
            custom_text_rgb=custom_text_rgb,
            custom_sat_factor=custom_sat,
            preview_type=preview_type
        )
        return Response(content=jpeg_bytes, media_type="image/jpeg")
    except Exception as e:
        logger.error(f"Error rendering preview: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/download/{task_id}")
async def download_file(task_id: str, user_data: dict = Depends(resolve_user)):
    from src.database import get_db_connection
    import os
    from src.storage import LOCAL_TEMP_DIR
    
    # Check if file is shared
    is_shared = False
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM shared_files WHERE task_id = ?", (task_id,))
        if cursor.fetchone():
            is_shared = True

    status_data = task_queue.get_status(task_id)
    
    # Bypass is_shared if it's a direct vault file
    is_vault_file = False
    vault_file_url = None
    if not status_data:
        for ext in [".pdf", ".epub", ".md", ".txt", ""]:
            out_path = os.path.join(LOCAL_TEMP_DIR, f"{task_id}_output{ext}")
            if os.path.exists(out_path):
                vault_file_url = out_path
                is_vault_file = True
                break
        if not is_vault_file:
            for ext in [".pdf", ".epub", ".md", ".txt", ""]:
                in_path = os.path.join(LOCAL_TEMP_DIR, f"{task_id}_input{ext}")
                if os.path.exists(in_path):
                    vault_file_url = in_path
                    is_vault_file = True
                    break

    if not status_data and not is_shared and not is_vault_file:
        raise HTTPException(status_code=404, detail="Task not found")
        
    if is_vault_file or is_shared:
        # Find the correct file in LOCAL_TEMP_DIR
        file_url = vault_file_url
        if not file_url and status_data and status_data.get("file_url"):
            file_url = status_data["file_url"]
            
        if not file_url:
            for suffix in ["_dark", "_light", "_output", "_input"]:
                for ext in [".pdf", ".epub", ".md", ".txt", ""]:
                    possible_url = storage_client.get_file_url_or_path(f"{task_id}{suffix}{ext}")
                    if possible_url.startswith("http") or os.path.exists(possible_url):
                        file_url = possible_url
                        break
                if file_url:
                    break
    else:
        # Check IDOR only if not shared and not vault file
        task_meta = task_queue.tasks.get(task_id)
        if not task_meta or task_meta.get("user_id") != user_data["user_id"]:
            raise HTTPException(status_code=403, detail="Forbidden: You don't own this file.")
            
        if status_data["status"] != "completed":
            raise HTTPException(status_code=400, detail="Document processing is not finished yet.")
            
        file_url = status_data["file_url"]
    
    if file_url and (file_url.startswith("http://") or file_url.startswith("https://")):
        return RedirectResponse(url=file_url)
        
    if not file_url or not os.path.exists(file_url):
        raise HTTPException(status_code=404, detail="Converted PDF not found locally.")

    ext = file_url.split('.')[-1] if '.' in file_url else 'pdf'
    import mimetypes
    media_type, _ = mimetypes.guess_type(file_url)
    if not media_type:
        media_type = "application/pdf" if ext == 'pdf' else "text/plain"

    from fastapi.responses import Response
    with open(file_url, "rb") as f:
        file_bytes = f.read()
    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={"Content-Disposition": "inline"}
    )

@router.get("/api/download-file/{task_id}")
async def download_file_attachment(task_id: str, user_data: dict = Depends(resolve_user)):
    from src.database import get_db_connection
    import os
    from src.storage import LOCAL_TEMP_DIR
    
    is_shared = False
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM shared_files WHERE task_id = ?", (task_id,))
        if cursor.fetchone():
            is_shared = True

    status_data = task_queue.get_status(task_id)
    
    # Bypass is_shared if it's a direct vault file
    is_vault_file = False
    vault_file_url = None
    if not status_data:
        for ext in [".pdf", ".epub", ".md", ".txt", ""]:
            out_path = os.path.join(LOCAL_TEMP_DIR, f"{task_id}_output{ext}")
            if os.path.exists(out_path):
                vault_file_url = out_path
                is_vault_file = True
                break
        if not is_vault_file:
            for ext in [".pdf", ".epub", ".md", ".txt", ""]:
                in_path = os.path.join(LOCAL_TEMP_DIR, f"{task_id}_input{ext}")
                if os.path.exists(in_path):
                    vault_file_url = in_path
                    is_vault_file = True
                    break

    if not status_data and not is_shared and not is_vault_file:
        raise HTTPException(status_code=404, detail="Task not found")
        
    if is_vault_file or is_shared:
        # Find the correct file in LOCAL_TEMP_DIR
        file_url = vault_file_url
        if not file_url and status_data and status_data.get("file_url"):
            file_url = status_data["file_url"]
            
        if not file_url:
            for suffix in ["_dark", "_light", "_output", "_input"]:
                for ext in [".pdf", ".epub", ".md", ".txt", ""]:
                    possible_url = storage_client.get_file_url_or_path(f"{task_id}{suffix}{ext}")
                    if possible_url.startswith("http") or os.path.exists(possible_url):
                        file_url = possible_url
                        break
                if file_url:
                    break
    else:
        task_meta = task_queue.tasks.get(task_id)
        if not task_meta or task_meta.get("user_id") != user_data["user_id"]:
            raise HTTPException(status_code=403, detail="Forbidden: You don't own this file.")
            
        if status_data["status"] != "completed":
            raise HTTPException(status_code=400, detail="Document processing is not finished yet.")
            
        file_url = status_data["file_url"]
            
    if file_url and (file_url.startswith("http://") or file_url.startswith("https://")):
        return RedirectResponse(url=file_url)
        
    if not file_url or not os.path.exists(file_url):
        raise HTTPException(status_code=404, detail="Converted PDF not found locally.")

    ext = file_url.split('.')[-1] if '.' in file_url else 'pdf'
    import mimetypes
    media_type, _ = mimetypes.guess_type(file_url)
    if not media_type:
        media_type = "application/octet-stream"

    return FileResponse(
        path=file_url,
        media_type=media_type,
        filename=f"shared_file.{ext}"
    )



@router.get("/api/public/shared")
async def get_public_shared_files(user_data: dict = Depends(resolve_user)):
    from src.database import get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT task_id, filename, shared_at FROM shared_files ORDER BY shared_at DESC")
        return [dict(r) for r in cursor.fetchall()]

