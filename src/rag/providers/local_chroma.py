import os
import logging
from typing import List
from src.rag.interface import IRAGProvider

try:
    import chromadb
    from sentence_transformers import SentenceTransformer
except ImportError:
    chromadb = None
    SentenceTransformer = None

logger = logging.getLogger(__name__)

class LocalChromaRAGProvider(IRAGProvider):
    """
    The default RAG provider that uses local ChromaDB for vector storage
    and sentence-transformers for local text embeddings.
    """
    
    def __init__(self):
        self._chroma_client = None
        self._embedding_model = None
        
    def _get_chroma_client(self):
        if self._chroma_client is None and chromadb is not None:
            # We locate the chroma_db folder relative to the root src/
            db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "chroma_db")
            os.makedirs(db_path, exist_ok=True)
            self._chroma_client = chromadb.PersistentClient(path=db_path)
        return self._chroma_client

    def _get_embedding_model(self):
        if self._embedding_model is None and SentenceTransformer is not None:
            logger.info("Loading sentence-transformers model...")
            self._embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
        return self._embedding_model

    def _chunk_text(self, text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
        """Splits text into overlapping chunks of approx `chunk_size` words."""
        words = text.split()
        chunks = []
        i = 0
        while i < len(words):
            chunk_words = words[i:i + chunk_size]
            chunks.append(" ".join(chunk_words))
            i += chunk_size - overlap
        return chunks

    def index_document(self, file_id: str, text: str, progress_callback: callable = None) -> None:
        if not chromadb or not SentenceTransformer:
            logger.warning("RAG dependencies (chromadb, sentence_transformers) missing. Skipping index.")
            return
            
        client = self._get_chroma_client()
        try:
            client.delete_collection(name=file_id)
        except Exception:
            pass
            
        collection = client.create_collection(name=file_id)
        model = self._get_embedding_model()
        
        chunks = self._chunk_text(text)
        if not chunks:
            return
            
        logger.info(f"Embedding {len(chunks)} chunks for {file_id}...")
        total_chunks = len(chunks)
        batch_size = 32
        all_embeddings = []
        
        for i in range(0, total_chunks, batch_size):
            batch = chunks[i:i + batch_size]
            batch_embeddings = model.encode(batch, show_progress_bar=False)
            all_embeddings.extend(batch_embeddings.tolist())
            if progress_callback:
                progress_callback(min(i + batch_size, total_chunks), total_chunks)
        
        ids = [f"chunk_{i}" for i in range(len(chunks))]
        metadatas = [{"source": file_id, "chunk_idx": i} for i in range(len(chunks))]
        
        collection.add(
            documents=chunks,
            embeddings=all_embeddings,
            metadatas=metadatas,
            ids=ids
        )
        logger.info(f"Finished indexing {file_id}")

    def search_document(self, file_id: str, query: str, top_k: int = 3) -> List[str]:
        if not chromadb or not SentenceTransformer:
            return []
            
        client = self._get_chroma_client()
        try:
            collection = client.get_collection(name=file_id)
        except Exception:
            return [] # Collection not found
            
        model = self._get_embedding_model()
        query_embedding = model.encode([query])[0].tolist()
        
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k
        )
        
        if results['documents'] and len(results['documents']) > 0:
            return results['documents'][0]
        return []

# Initialize and register the provider globally when this module is loaded
from src.rag.manager import RAGManager
RAGManager.register_provider("default", LocalChromaRAGProvider())
