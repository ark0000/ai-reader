import os
import logging
from typing import List

try:
    import chromadb
    from sentence_transformers import SentenceTransformer
except ImportError:
    chromadb = None
    SentenceTransformer = None

logger = logging.getLogger(__name__)

# Singleton instances
_chroma_client = None
_embedding_model = None

def get_chroma_client():
    global _chroma_client
    if _chroma_client is None and chromadb is not None:
        db_path = os.path.join(os.path.dirname(__file__), "chroma_db")
        os.makedirs(db_path, exist_ok=True)
        _chroma_client = chromadb.PersistentClient(path=db_path)
    return _chroma_client

def get_embedding_model():
    global _embedding_model
    if _embedding_model is None and SentenceTransformer is not None:
        logger.info("Loading sentence-transformers model...")
        _embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
    return _embedding_model

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """Splits text into overlapping chunks of approx `chunk_size` words."""
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk_words = words[i:i + chunk_size]
        chunks.append(" ".join(chunk_words))
        i += chunk_size - overlap
    return chunks

def index_document(file_id: str, text: str):
    """Chunks text, embeds it, and stores it in ChromaDB collection named after file_id."""
    if not chromadb or not SentenceTransformer:
        logger.warning("RAG dependencies (chromadb, sentence_transformers) missing. Skipping index.")
        return
        
    client = get_chroma_client()
    try:
        client.delete_collection(name=file_id)
    except Exception:
        pass
        
    collection = client.create_collection(name=file_id)
    model = get_embedding_model()
    
    chunks = chunk_text(text)
    if not chunks:
        return
        
    logger.info(f"Embedding {len(chunks)} chunks for {file_id}...")
    
    embeddings = model.encode(chunks, show_progress_bar=False)
    
    ids = [f"chunk_{i}" for i in range(len(chunks))]
    metadatas = [{"source": file_id, "chunk_idx": i} for i in range(len(chunks))]
    
    collection.add(
        documents=chunks,
        embeddings=embeddings.tolist(),
        metadatas=metadatas,
        ids=ids
    )
    logger.info(f"Finished indexing {file_id}")

def search_document(file_id: str, query: str, top_k: int = 3) -> List[str]:
    """Retrieves top_k most relevant chunks for a given query."""
    if not chromadb or not SentenceTransformer:
        return []
        
    client = get_chroma_client()
    try:
        collection = client.get_collection(name=file_id)
    except Exception:
        return [] # Collection not found
        
    model = get_embedding_model()
    query_embedding = model.encode([query])[0].tolist()
    
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k
    )
    
    if results['documents'] and len(results['documents']) > 0:
        return results['documents'][0]
    return []
