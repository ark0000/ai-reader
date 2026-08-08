import logging
from typing import Dict, Optional
from src.rag.interface import IRAGProvider

logger = logging.getLogger(__name__)

class RAGManager:
    """
    A factory and registry for managing RAG providers.
    Uses the Plugin Architecture to allow dynamic registration of new RAG implementations.
    """
    _providers: Dict[str, IRAGProvider] = {}
    
    @classmethod
    def register_provider(cls, name: str, provider: IRAGProvider) -> None:
        """Registers a new RAG provider implementation."""
        if not isinstance(provider, IRAGProvider):
            raise TypeError("Provider must implement IRAGProvider")
        cls._providers[name] = provider
        logger.info(f"Registered RAG provider: {name}")
        
    @classmethod
    def get_provider(cls, name: str = "default") -> Optional[IRAGProvider]:
        """Retrieves a registered RAG provider by name."""
        provider = cls._providers.get(name)
        if not provider:
            logger.warning(f"RAG provider '{name}' not found. Available providers: {list(cls._providers.keys())}")
        return provider
