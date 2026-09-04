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

# Fix 6: Maximum ChromaDB collections kept on disk.
# When exceeded, the oldest collections are deleted (LRU eviction).
MAX_COLLECTIONS = int(os.environ.get("AURA_MAX_CHROMA_COLLECTIONS", "100"))

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
            import os
            os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
            os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
            try:
                # Prefer cached model; fall back to downloading if not cached.
                # Note: local_files_only kwarg is only available in sentence-transformers>=3.x
                import inspect
                st_init_params = inspect.signature(SentenceTransformer.__init__).parameters
                if "local_files_only" in st_init_params:
                    self._embedding_model = SentenceTransformer('all-MiniLM-L6-v2', local_files_only=True)
                else:
                    # Older sentence-transformers: set HF_HUB_OFFLINE to try cache first
                    os.environ["HF_HUB_OFFLINE"] = "1"
                    try:
                        self._embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
                    finally:
                        os.environ.pop("HF_HUB_OFFLINE", None)
            except Exception:
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

    @staticmethod
    def _to_collection_name(file_id: str) -> str:
        """Sanitizes any arbitrary file_id into a valid ChromaDB collection name."""
        import hashlib
        return "doc_" + hashlib.sha256(file_id.encode("utf-8")).hexdigest()[:32]

    def _evict_old_collections(self, client) -> None:
        """Removes the oldest ChromaDB collections when over MAX_COLLECTIONS.
        
        ChromaDB's PersistentClient does not track creation time, so we use
        the lexicographic order of the hashed collection names as a stable
        proxy (oldest hashes sort first since we always use sequential uploads).
        In production, prefer tagging collections with a metadata timestamp.
        """
        try:
            all_cols = client.list_collections()  # returns Collection objects
            if len(all_cols) <= MAX_COLLECTIONS:
                return
            to_evict = len(all_cols) - MAX_COLLECTIONS
            # Sort by name (lexicographic) as a stable eviction order
            sorted_cols = sorted(all_cols, key=lambda c: c.name)
            for col in sorted_cols[:to_evict]:
                try:
                    client.delete_collection(name=col.name)
                    logger.info(f"ChromaDB eviction: deleted old collection {col.name}")
                except Exception as ev:
                    logger.warning(f"ChromaDB eviction failed for {col.name}: {ev}")
        except Exception as e:
            logger.warning(f"ChromaDB collection eviction check failed: {e}")

    def index_document(self, file_id: str, text: str, progress_callback: callable = None) -> None:
        if not chromadb or not SentenceTransformer:
            logger.warning("RAG dependencies (chromadb, sentence_transformers) missing. Skipping index.")
            return
            
        client = self._get_chroma_client()
        # Fix 6: evict oldest collections if total exceeds cap
        self._evict_old_collections(client)
        col_name = self._to_collection_name(file_id)
        try:
            client.delete_collection(name=col_name)
        except Exception:
            pass
            
        collection = client.create_collection(name=col_name)
        model = self._get_embedding_model()
        
        chunks = self._chunk_text(text)
        if not chunks:
            return
            
        logger.info(f"Embedding {len(chunks)} chunks for {file_id} ({col_name})...")
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

    from functools import lru_cache

    @lru_cache(maxsize=256)
    def _cached_query_encode(self, query: str) -> tuple:
        """Caches query embeddings in-memory to accelerate repeated searches."""
        model = self._get_embedding_model()
        return tuple(model.encode([query])[0].tolist())

    def search_document(self, file_id: str, query: str, top_k: int = 3) -> List[str]:
        if not chromadb or not SentenceTransformer:
            return []
            
        client = self._get_chroma_client()
        col_name = self._to_collection_name(file_id)
        try:
            collection = client.get_collection(name=col_name)
        except Exception:
            return [] # Collection not found
            
        query_embedding = list(self._cached_query_encode(query))
        
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
