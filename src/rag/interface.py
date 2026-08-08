from abc import ABC, abstractmethod
from typing import List

class IRAGProvider(ABC):
    """
    Abstract base class defining the contract for all RAG (Retrieval-Augmented Generation) providers.
    This acts as a complete pipeline black-box: the application passes text to index and queries it for context, 
    while the provider internally handles chunking strategies, embedding models, vector stores, and re-ranking.
    """

    @abstractmethod
    def index_document(self, file_id: str, text: str, progress_callback: callable = None) -> None:
        """
        Executes the complete ingestion pipeline (chunking, embedding, storage).
        
        Args:
            file_id (str): A unique identifier for the document.
            text (str): The raw text content of the document.
            progress_callback (callable, optional): A function(progress, total) to report progress.
        """
        pass
        
    @abstractmethod
    def search_document(self, file_id: str, query: str, top_k: int = 3) -> List[str]:
        """
        Executes the complete retrieval pipeline (query embedding, search, ranking).
        
        Args:
            file_id (str): The unique identifier for the document to search within.
            query (str): The user's search query.
            top_k (int, optional): The maximum number of context chunks to return. Defaults to 3.
            
        Returns:
            List[str]: A list of text chunks containing the most relevant context.
        """
        pass
