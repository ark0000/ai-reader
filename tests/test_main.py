import base64
import json
import os
import pytest
from fastapi.testclient import TestClient

# Mock environment variables before importing app
os.environ["BYPASS_BIGQUERY_ERRORS"] = "true"
os.environ["GCP_PROJECT"] = "mock-project-id"

from src.main import app, simulate_ocr

client = TestClient(app)


def test_health_endpoint():
    """Test the healthy root endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "document-processor"


def test_simulate_ocr():
    """Test the OCR simulation logic."""
    # Test file with keyword
    tags, word_count = simulate_ocr("invoice_document_2026.pdf")
    assert "invoice" in tags
    assert "billing" in tags
    assert "pdf" in tags
    assert 50 <= word_count <= 1500

    # Test file with another keyword
    tags, word_count = simulate_ocr("my_receipt.png")
    assert "receipt" in tags
    assert "finance" in tags
    assert "png" in tags

    # Test file without keywords
    tags, word_count = simulate_ocr("some_unknown_file.xyz")
    assert "xyz" in tags
    assert "ocr-processed" in tags
    assert len(tags) >= 2


def test_pubsub_endpoint_success():
    """Test the Pub/Sub endpoint with a valid GCS event."""
    gcs_payload = {
        "name": "invoices/company_xyz_invoice.pdf",
        "bucket": "my-mock-bucket",
        "updated": "2026-07-05T22:10:24.123Z",
        "size": "54321"
    }
    
    # Base64 encode the payload
    base64_data = base64.b64encode(json.dumps(gcs_payload).encode("utf-8")).decode("utf-8")
    
    pubsub_envelope = {
        "message": {
            "data": base64_data,
            "message_id": "987654321",
            "publish_time": "2026-07-05T22:11:00Z"
        },
        "subscription": "projects/mock-project-id/subscriptions/gcs-upload-subscription"
    }
    
    response = client.post("/pubsub", json=pubsub_envelope)
    assert response.status_code == 200
    
    data = response.json()
    assert data["status"] in ["success", "mocked_success", "mocked_success_after_failure"]
    
    inserted_data = data["inserted_data"]
    assert inserted_data["filename"] == "invoices/company_xyz_invoice.pdf"
    assert "invoice" in inserted_data["tags"]
    assert "billing" in inserted_data["tags"]
    assert "pdf" in inserted_data["tags"]
    assert 50 <= inserted_data["word_count"] <= 1500
    assert "processed_at" in inserted_data


def test_pubsub_endpoint_missing_filename():
    """Test Pub/Sub endpoint handles notifications without filenames (e.g. folder creations)."""
    # GCS directory placeholders or bucket configurations might not have filenames
    gcs_payload = {
        "bucket": "my-mock-bucket",
        "updated": "2026-07-05T22:10:24.123Z"
    }
    
    base64_data = base64.b64encode(json.dumps(gcs_payload).encode("utf-8")).decode("utf-8")
    
    pubsub_envelope = {
        "message": {
            "data": base64_data,
            "message_id": "987654322",
            "publish_time": "2026-07-05T22:11:00Z"
        },
        "subscription": "projects/mock-project-id/subscriptions/gcs-upload-subscription"
    }
    
    response = client.post("/pubsub", json=pubsub_envelope)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "skipped"
    assert data["reason"] == "no_filename"


def test_pubsub_endpoint_invalid_payload():
    """Test Pub/Sub endpoint handles corrupted / invalid base64 data."""
    pubsub_envelope = {
        "message": {
            "data": "this-is-not-base64-json-!!!",
            "message_id": "987654323",
            "publish_time": "2026-07-05T22:11:00Z"
        },
        "subscription": "projects/mock-project-id/subscriptions/gcs-upload-subscription"
    }
    
    response = client.post("/pubsub", json=pubsub_envelope)
    assert response.status_code == 400

from unittest.mock import patch, MagicMock, AsyncMock

@pytest.mark.asyncio
async def test_api_local_chat_success():
    payload = {
        "local_endpoint": "http://mock-local-llm/v1/chat/completions",
        "prompt": "Hello world",
        "rag_enabled": False,
        "task_id": "test_task"
    }
    
    mock_response = MagicMock()
    mock_response.is_success = True
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "Mocked response!"}}]
    }
    
    with patch("src.main._http_client") as mock_client:
        mock_client.post = AsyncMock(return_value=mock_response)
        response = client.post("/api/local_chat", json=payload)
        
        assert response.status_code == 200
        assert response.json() == {"response": "Mocked response!"}
        
        mock_client.post.assert_called_once()
        args, kwargs = mock_client.post.call_args
        assert args[0] == "http://mock-local-llm/v1/chat/completions"
        assert kwargs["json"]["messages"][1]["content"] == "Hello world"

@pytest.mark.asyncio
async def test_api_local_chat_rag_enabled():
    payload = {
        "local_endpoint": "http://mock-local-llm/v1/chat/completions",
        "prompt": "What is the document about?",
        "rag_enabled": True,
        "task_id": "test_task"
    }
    
    mock_response = MagicMock()
    mock_response.is_success = True
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "Mocked RAG response!"}}]
    }
    
    with patch("src.main._http_client") as mock_client, \
         patch("src.main.search_document", return_value=["This document is about testing."]) as mock_search:
        
        mock_client.post = AsyncMock(return_value=mock_response)
        response = client.post("/api/local_chat", json=payload)
        
        assert response.status_code == 200
        assert response.json() == {"response": "Mocked RAG response!"}
        
        mock_search.assert_called_once_with("test_task", "What is the document about?")
        
        mock_client.post.assert_called_once()
        args, kwargs = mock_client.post.call_args
        
        messages = kwargs["json"]["messages"]
        assert len(messages) == 3
        assert "This document is about testing." in messages[0]["content"]

@pytest.mark.asyncio
async def test_api_local_chat_failure():
    payload = {
        "local_endpoint": "http://mock-local-llm/v1/chat/completions",
        "prompt": "Hello",
        "rag_enabled": False,
        "task_id": "test_task"
    }
    
    mock_response = MagicMock()
    mock_response.is_success = False
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"
    
    with patch("src.main._http_client") as mock_client:
        mock_client.post = AsyncMock(return_value=mock_response)
        response = client.post("/api/local_chat", json=payload)
        
        assert response.status_code == 502
        assert "500 - Internal Server Error" in response.json()["detail"]
