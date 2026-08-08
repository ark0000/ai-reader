# RAG Integration Guide

This guide explains how to easily integrate your own custom Retrieval-Augmented Generation (RAG) pipeline into this application.

Because the application uses a strict **Plugin Architecture**, you can swap out the default embedding models, vector databases, and chunking logic without modifying any core UI or API routing code.

## The `IRAGProvider` Interface

All RAG integrations must implement the `IRAGProvider` interface located in `src/rag/interface.py`. This interface acts as a "black box" that completely handles the RAG lifecycle.

```python
from abc import ABC, abstractmethod
from typing import List

class IRAGProvider(ABC):
    @abstractmethod
    def index_document(self, file_id: str, text: str, progress_callback: callable = None) -> None:
        """Executes the complete ingestion pipeline (chunking, embedding, storage)."""
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

### 3. Register your provider
At the very bottom of your new file, register your class with the `RAGManager`. You must give it a unique string identifier.

```python
from src.rag.manager import RAGManager

# Register your custom provider
RAGManager.register_provider("my_custom", MyCustomRAGProvider())
```

### 4. Ensure your provider is loaded
Open `src/rag/providers/__init__.py` and import your new file so it runs when the application starts:

```python
# src/rag/providers/__init__.py
import src.rag.providers.local_chroma
import src.rag.providers.my_custom_rag  # Add this line!
```

### 5. Switch the active provider
Finally, tell the application to use your custom provider instead of the default one. 

Open `src/routers/chat.py` and `src/routers/files.py`, and look for where the provider is fetched. Change `"default"` to `"my_custom"`:

```python
# In chat.py and files.py:
rag_provider = RAGManager.get_provider("my_custom")
```

## That's it!
The application will now automatically pass all document text and user queries to your custom pipeline. The frontend UI, error handling, and background task queuing will continue to work seamlessly.
