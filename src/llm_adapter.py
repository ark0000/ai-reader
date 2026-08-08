import uuid
import json
import logging
import httpx
from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod

from .database import ConnectionRepository

logger = logging.getLogger(__name__)

class ILLMAdapter(ABC):
    """
    Interface for LLM Service Adapters.
    """
    @abstractmethod
    async def generate_completion(self, messages: List[Dict[str, str]], temperature: float) -> Dict[str, Any]:
        pass

class OpenAIAdapter(ILLMAdapter):
    def __init__(self, base_url: str, api_key: Optional[str], model: str, client: httpx.AsyncClient):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.model = model
        self.client = client

    async def generate_completion(self, messages: List[Dict[str, str]], temperature: float = 0.7) -> Dict[str, Any]:
        url = self.base_url if self.base_url.endswith("/chat/completions") else f"{self.base_url}/chat/completions"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
            
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature
        }
        
        response = await self.client.post(url, headers=headers, json=payload, timeout=60.0)
        if not response.is_success:
            raise Exception(f"OpenAI API Error: {response.status_code} - {response.text}")
            
        return response.json()

class AnthropicAdapter(ILLMAdapter):
    def __init__(self, base_url: str, api_key: Optional[str], model: str, client: httpx.AsyncClient):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.model = model
        self.client = client

    async def generate_completion(self, messages: List[Dict[str, str]], temperature: float = 0.7) -> Dict[str, Any]:
        url = f"{self.base_url}/messages"
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key or "",
            "anthropic-version": "2023-06-01"
        }
        
        system_prompt = ""
        anthropic_msgs = []
        for msg in messages:
            if msg["role"] == "system":
                system_prompt += msg["content"] + "\n"
            else:
                anthropic_msgs.append({"role": msg["role"], "content": msg["content"]})
                
        payload = {
            "model": self.model,
            "messages": anthropic_msgs,
            "temperature": temperature,
            "max_tokens": 4096
        }
        if system_prompt.strip():
            payload["system"] = system_prompt.strip()
            
        response = await self.client.post(url, headers=headers, json=payload, timeout=60.0)
        if not response.is_success:
            raise Exception(f"Anthropic API Error: {response.status_code} - {response.text}")
            
        d = response.json()
        text = "".join([c["text"] for c in d.get("content", []) if c["type"] == "text"])
        
        return {
            "id": d.get("id", "chatcmpl-" + uuid.uuid4().hex),
            "object": "chat.completion",
            "model": self.model,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": text
                    },
                    "finish_reason": "stop"
                }
            ]
        }

class GeminiAdapter(ILLMAdapter):
    def __init__(self, base_url: str, api_key: Optional[str], model: str, client: httpx.AsyncClient):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.model = model
        self.client = client

    async def generate_completion(self, messages: List[Dict[str, str]], temperature: float = 0.7) -> Dict[str, Any]:
        url = f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key or ''}"
        headers = {"Content-Type": "application/json"}
        
        system_prompt = ""
        gemini_contents = []
        
        for msg in messages:
            if msg["role"] == "system":
                system_prompt += msg["content"] + "\n"
            else:
                role = "user" if msg["role"] == "user" else "model"
                gemini_contents.append({
                    "role": role,
                    "parts": [{"text": msg["content"]}]
                })
                
        if system_prompt and gemini_contents:
            gemini_contents[0]["parts"][0]["text"] = f"System: {system_prompt.strip()}\n\n---\n\n" + gemini_contents[0]["parts"][0]["text"]
            
        payload = {
            "contents": gemini_contents,
            "generationConfig": {
                "temperature": temperature
            }
        }
        
        response = await self.client.post(url, headers=headers, json=payload, timeout=60.0)
        if not response.is_success:
            raise Exception(f"Gemini API Error: {response.status_code} - {response.text}")
            
        d = response.json()
        try:
            text = d["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            text = ""
            
        return {
            "id": "chatcmpl-" + uuid.uuid4().hex,
            "object": "chat.completion",
            "model": self.model,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": text
                    },
                    "finish_reason": "stop"
                }
            ]
        }

class ProviderFactory:
    @staticmethod
    def get_provider_by_connection(user_id: int, connection_id: int, client: httpx.AsyncClient) -> ILLMAdapter:
        conn = ConnectionRepository.get_with_key(user_id, connection_id)
        if not conn:
            raise ValueError(f"Connection {connection_id} not found for user {user_id}")
            
        provider_id = conn["provider_id"]
        base_url = conn["base_url"] or conn["base_url_template"]
        model = conn["model"] or ""
        api_key = conn.get("api_key")
        
        if provider_id in ("openai", "lmstudio", "ollama"):
            return OpenAIAdapter(base_url, api_key, model, client)
        elif provider_id == "anthropic":
            return AnthropicAdapter(base_url, api_key, model, client)
        elif provider_id == "gemini":
            return GeminiAdapter(base_url, api_key, model, client)
        else:
            return OpenAIAdapter(base_url, api_key, model, client)
