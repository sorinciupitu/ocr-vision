# DOC-ARCHIVE

A modern, Dockerized web application for archiving physical documents and searching through them easily. It leverages the highly performant `lightonai/LightOnOCR-3-4B` Vision-Language Model via vLLM for state-of-the-art OCR and document understanding.

## Features

- 🔐 **Authentication**: User login and registration system.
- 📤 **Document Scanning/Upload**: Drag-and-drop interface for uploading PDF, DOCX, and image files.
- 🤖 **Document AI chat**: Ask questions across your OCR documents using Ollama, vLLM, or any OpenAI-compatible endpoint.
- 📁 **Folders & Tags**: Create your own folders and tags, file processed documents into them, and filter the dashboard by folder or tag. New uploads land straight in the folder you are viewing.
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

   Administrators can configure the AI provider and inspect the server runtime console from **Settings**. The floating brain button opens **AI Chat**. For Ollama running on the Linux host while the app runs in Docker, the default endpoint is `http://host.docker.internal:11434/v1/chat/completions`; `docker-compose.yml` maps that hostname to the host gateway.
3. **Sync Folders**:
   Add a local folder tracking path (`/app/local_sync` is mapped to `./sample_documents` by default in docker-compose). Click **Scan** to ingest everything the folder holds.
4. **Organize**:
   Create folders from the sidebar (or the *Organize* dialog on any document), assign documents to a folder, and toggle or create tags. Click a folder in the sidebar or a tag chip to filter the dashboard; uploads made while filtered are filed automatically.
5. **Search**:
   Use the search functionality to find exact phrases or keywords pulled natively from your OCR-processed documents.
