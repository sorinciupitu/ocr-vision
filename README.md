# DOC-ARCHIVE

A modern, Dockerized web application for archiving physical documents and searching through them easily. It leverages the highly performant `lightonai/LightOnOCR-3-4B` Vision-Language Model via vLLM for state-of-the-art OCR and document understanding.

## Features

- 🔐 **Authentication**: User login and registration system.
- 📤 **Document Scanning/Upload**: Drag-and-drop interface for uploading PDF, DOCX, and image files.
- 📁 **Background Sync Folders**: Mount a local folder and scan existing files directly into the database.
- 🧠 **Advanced OCR**: Built-in support for `lightonai/LightOnOCR-3-4B` served via vLLM for fast, GPU-accelerated text extraction.
- 🔍 **Full-Text Search**: Powered by PostgreSQL full-text search (`tsvector`), allowing fast lookups across massive text archives.
- 🎨 **Modern UI**: Built with React, TailwindCSS, and Heroicons.

## Architecture

- **Frontend**: React 18, React Router v6, TailwindCSS v3 (served via Nginx).
- **Backend**: FastAPI, SQLAlchemy, PostgreSQL, Passlib (JWT Auth). Documents are processed via background tasks.
- **OCR Engine**: `vllm-openai` Docker container running `lightonai/LightOnOCR-3-4B`.
- **Database**: PostgreSQL 15.

## Prerequisites

- **Docker** and **Docker Compose** installed on your machine.
- An **NVIDIA GPU** setup with the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) to run the vLLM model efficiently.

## Installation & Running

1. **Clone the repository**:
   ```bash
   git clone https://github.com/sorinciupitu/ocr-vision.git
   cd ocr-vision
   ```
2. **Review `docker-compose.yml`**: Ensure the deployment settings suit your environment. By default, the `vllm` service expects 1 NVIDIA GPU.
3. **Start the application**:
   ```bash
   docker compose up --build -d
   ```
   This will spin up:
   - PostgreSQL Database on port `5432`
   - vLLM Server on port `8000`
   - FastAPI Backend on port `8080`
   - React Frontend on port `6543`

4. **Access the Application**:
   Open a browser and navigate to:
   [http://localhost:6543](http://localhost:6543)

## Usage guide

1. **Sign Up / Sign In**:
   Create a new account from the main login screen.
2. **Dashboard**:
   Drag and drop files to manually upload and begin the OCR process.
3. **Sync Folders**:
   Add a local folder tracking path (`/app/local_sync` is mapped to `./sample_documents` by default in docker-compose). Click **Scan** to ingest everything the folder holds.
4. **Search**:
   Use the search functionality to find exact phrases or keywords pulled natively from your OCR-processed documents.
