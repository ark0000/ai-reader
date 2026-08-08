# Serverless Event-Driven Document Processing Pipeline

This repository contains the complete implementation and infrastructure-as-code for a serverless, event-driven document processing pipeline on Google Cloud Platform (GCP).

## Architecture

1. **Ingestion**: A user uploads a document (PDF, PNG, etc.) to a Google Cloud Storage (GCS) bucket.
2. **Trigger**: GCS sends an `OBJECT_FINALIZE` event notification to a Google Cloud Pub/Sub topic.
3. **Processor**: A Pub/Sub Push Subscription securely triggers an HTTP `POST /pubsub` request to a Python-based FastAPI service running on Google Cloud Run.
4. **Storage**: The Cloud Run service simulates OCR extraction (extracting metadata like filename, timestamps, tags, and word count) and streams the metadata directly into a Google BigQuery table using the standard streaming insert API.

---

## Repository Structure

```text
├── src/
│   ├── main.py            # FastAPI web server containing the message processor
│   ├── requirements.txt   # Python dependencies
│   └── Dockerfile         # Docker container configuration for Cloud Run
├── terraform/
│   ├── main.tf            # Terraform configuration for all GCP resources
│   ├── variables.tf       # Terraform input variables
│   ├── outputs.tf         # Terraform output values
│   └── terraform.tfvars   # Local deployment configurations
├── tests/
│   └── test_main.py       # Python unit tests using Pytest
└── README.md              # Setup and deployment instructions
```

---

## Setup & Deployment Guide

Follow these steps to set up, test, and deploy the pipeline.

### Prerequisites

You will need the following tools installed on your system:
1. **Python 3.11+** ([Download here](https://www.python.org/downloads/) or install via Microsoft Store)
2. **Terraform 1.3+** ([Download here](https://developer.hashicorp.com/terraform/downloads))
3. **Google Cloud SDK (gcloud)** ([Download here](https://cloud.google.com/sdk/docs/install))
4. **Docker** (Required to build and push the Cloud Run container image; [Download here](https://www.docker.com/products/docker-desktop/))

---

### Step 1: Google Cloud SDK Initialization

1. Open PowerShell and run the login commands:
   ```powershell
   # Login to your Google Cloud Account
   gcloud auth login

   # Set Application Default Credentials (needed by Terraform)
   gcloud auth application-default login
   ```
2. Configure your project ID:
   ```powershell
   gcloud config set project YOUR_GCP_PROJECT_ID
   ```

---

### Step 2: Build & Push the Container Image

Before applying Terraform, you need to build the Docker image of the FastAPI application and push it to Google Artifact Registry (or Google Container Registry) so Cloud Run can deploy it.

1. **Create an Artifact Registry repository** (replace `us-central1` and `YOUR_GCP_PROJECT_ID` with your values):
   ```powershell
   gcloud artifacts repositories create doc-pipeline-repo `
       --repository-format=docker `
       --location=us-central1 `
       --description="Docker repository for document processing pipeline"
   ```
2. **Configure Docker to authenticate with Artifact Registry**:
   ```powershell
   gcloud auth configure-docker us-central1-docker.pkg.dev
   ```
3. **Build the container image**:
   ```powershell
   cd src
   docker build -t us-central1-docker.pkg.dev/YOUR_GCP_PROJECT_ID/doc-pipeline-repo/document-processor:latest .
   ```
4. **Push the image to Artifact Registry**:
   ```powershell
   docker push us-central1-docker.pkg.dev/YOUR_GCP_PROJECT_ID/doc-pipeline-repo/document-processor:latest
   ```
5. Navigate back to the root directory:
   ```powershell
   cd ..
   ```

---

### Step 3: Deploy with Terraform

1. Open the [terraform.tfvars](file:///c:/Users/arunk/Downloads/projects/day%201%20first%20project%20serverless/terraform/terraform.tfvars) file and update:
   - `project_id` to your actual Google Cloud Project ID.
   - `container_image_url` to the URL of the pushed image (e.g., `us-central1-docker.pkg.dev/YOUR_GCP_PROJECT_ID/doc-pipeline-repo/document-processor:latest`).
2. Navigate to the `terraform` directory:
   ```powershell
   cd terraform
   ```
3. Initialize Terraform:
   ```powershell
   terraform init
   ```
4. Preview the changes:
   ```powershell
   terraform plan
   ```
5. Apply the configuration (type `yes` to confirm):
   ```powershell
   terraform apply
   ```
   *Note: On deployment, Terraform will output your GCS Bucket Name, Cloud Run URL, and BigQuery Table ID.*

---

### Step 4: Verification & Testing

Once deployed, you can verify that the pipeline is working.

1. **Upload a document** to your GCS bucket:
   ```powershell
   # Use the bucket name output by Terraform
   gcloud storage cp ..\tests\test_main.py gs://gcs-ocr-ingestion-YOUR_GCP_PROJECT_ID/invoice_2026_test.pdf
   ```
2. **Check Cloud Run Logs**:
   - Go to the Google Cloud Console.
   - Navigate to **Cloud Run** -> **document-processor**.
   - Click on **Logs** to view the Pub/Sub request payload and verify the simulated OCR processing.
3. **Query BigQuery**:
   - Go to the GCP Console and open **BigQuery**.
   - Query the `processed_metadata` table to view the written row:
     ```sql
     SELECT * FROM `YOUR_GCP_PROJECT_ID.document_pipeline.processed_metadata` LIMIT 10;
     ```

---

### Local Development and Testing (Optional)

If you have Python installed and want to run tests locally:

1. Create a virtual environment and install dependencies:
   ```powershell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   pip install -r src/requirements.txt pytest httpx
   ```
2. Run unit tests:
   ```powershell
   pytest tests/test_main.py
   ```
3. Start the FastAPI server locally:
   ```powershell
   cd src
   uvicorn main:app --reload --port 8080
   ```
