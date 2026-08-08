# Use an official lightweight Python runtime as a parent image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DEBUG_CONSOLE=0

# Create and set the working directory
WORKDIR /app

# Install system dependencies (required for some Python packages like PyMuPDF, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    libmupdf-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy the requirements file first to leverage Docker cache
COPY src/requirements.txt /app/

# Install Python dependencies
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy the entire src directory into the container
COPY src/ /app/src/

# Expose the port the app runs on
EXPOSE 8080

# Command to run the application
CMD uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8080}
