# RAG Integration Guide

This guide explains how to easily integrate your own custom Retrieval-Augmented Generation (RAG) pipeline into this application.

Because the application uses a strict **Plugin Architecture**, you can swap out the default embedding models, vector databases, and chunking logic without modifying any core UI or API routing code.

## Future Scope: Complete RAG Pipelines

Currently, the application uses a simple, local ChromaDB and SentenceTransformer implementation. However, the system is designed to support a **complete RAG pipeline** in the future. By adhering to the `IRAGProvider` interface, you can seamlessly integrate complex orchestrators like **LangChain** or **LlamaIndex**. This will allow for advanced routing, multi-document cross-referencing, re-ranking, and hybrid search capabilities to be added as self-contained plugins.

## The `IRAGProvider` Interface

All RAG integrations must implement the `IRAGProvider` interface located in `src/rag/interface.py`. This interface acts as a "black box" that completely handles the RAG lifecycle.

```python
from abc import ABC, abstractmethod
from typing import List

class IRAGProvider(ABC):
    @abstractmethod
    def index_document(self, file_id: str, text: str, progress_callback: callable = None) -> None:
        """Executes the complete ingestion pipeline (chunking, embedding, storage).
        
        Args:
            file_id (str): The unique identifier for the document.
            text (str): The raw text extracted from the document.
            progress_callback (callable, optional): A function taking (current_chunks, total_chunks) 
                                                    to report real-time indexing progress to the UI.
        """
        pass
        
    @abstractmethod
    def search_document(self, file_id: str, query: str, top_k: int = 3) -> List[str]:
        """Executes the complete retrieval pipeline (query embedding, search, ranking)."""
        pass
```

## Step-by-Step Integration

### 1. Create your custom provider file
Create a new file in the `src/rag/providers/` directory. For example, `my_custom_rag.py`.

### 2. Implement the interface
In your new file, import the interface and build your class. This is where you will add your custom logic (e.g., connecting to Pinecone, using OpenAI embeddings, or applying custom LangChain chunking).

```python
# src/rag/providers/my_custom_rag.py
from typing import List
from src.rag.interface import IRAGProvider

class MyCustomRAGProvider(IRAGProvider):
    
    def __init__(self):
        # Initialize your custom vector database or embedding models here
        pass

    def index_document(self, file_id: str, text: str, progress_callback: callable = None) -> None:
        # 1. Chunk the text
        # 2. Embed the chunks in batches
        # 3. Store the embeddings in your custom database under the 'file_id' namespace
        # 4. If progress_callback is provided, call it with (current_chunks, total_chunks) to update the UI
        print(f"Indexing {file_id}...")
        if progress_callback:
            progress_callback(100, 100) # Example: instantly 100% complete

    def search_document(self, file_id: str, query: str, top_k: int = 3) -> List[str]:
        # 1. Embed the user's query
        # 2. Search your database for the top_k chunks matching 'file_id'
        # 3. Return the text chunks as a list of strings
        return ["Custom context chunk 1", "Custom context chunk 2"]
```

### 3. Register your provider in `main.py`
Instead of modifying `chat.py` or `files.py`, you simply register your custom provider as the `"default"` provider during the application startup. 

Open `src/main.py`, import your provider, and update the `lifespan` function:

```python
# src/main.py
from src.rag.manager import RAGManager
from src.rag.providers.my_custom_rag import MyCustomRAGProvider  # Import your custom provider

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    
    # Initialize RAG Provider
    try:
        provider = MyCustomRAGProvider() # <-- Instantiate your provider
        RAGManager.register_provider("default", provider) # <-- Register as "default"
    except Exception as e:
        logger.error(f"Failed to initialize RAG Provider: {e}")
```

## That's it!
The application will now automatically pass all document text and user queries to your custom pipeline. The frontend UI, error handling, and background task queuing will continue to work seamlessly.
