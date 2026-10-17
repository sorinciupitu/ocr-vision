"""Document-grounded chat through an Ollama/OpenAI-compatible endpoint."""
import logging
import re
from typing import List, Tuple

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import Document, User
from app.schemas import ChatRequest, ChatResponse
from app.settings_service import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_PROVIDER, get_setting

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)
app_settings = get_settings()

# Retrieve only small, relevant OCR chunks instead of sending whole documents.
RAG_CHUNK_CHARS = 1_800
RAG_CHUNK_OVERLAP = 200
RAG_TOP_K = 8
MAX_CONTEXT_CHARS = 14_000
MAX_HISTORY_CHARS = 6_000
MAX_OUTPUT_TOKENS = 1_200


def _retrieve_chunks(documents: List[Document], question: str) -> List[Tuple[Document, str, int]]:
    terms = {word.lower() for word in re.findall(r"\w+", question) if len(word) > 2}
    ranked = []
    for doc in documents:
        text = (doc.ocr_text or "").strip()
        if not text:
            continue
        step = RAG_CHUNK_CHARS - RAG_CHUNK_OVERLAP
        for start in range(0, len(text), step):
            chunk = text[start:start + RAG_CHUNK_CHARS]
            haystack = f"{doc.title}\n{chunk}".lower()
            score = sum(haystack.count(term) for term in terms)
            ranked.append((doc, chunk, score))
            if start + RAG_CHUNK_CHARS >= len(text):
                break
    return sorted(
        ranked,
        key=lambda item: (item[2], item[0].updated_at or item[0].created_at),
        reverse=True,
    )[:RAG_TOP_K]


def _context(documents: List[Document], question: str) -> Tuple[str, List[str]]:
    # Keep the request bounded even when the archive contains many long scans.
    chunks = []
    sources = []
    used = 0
    for doc, text, _ in _retrieve_chunks(documents, question):
        remaining = MAX_CONTEXT_CHARS - used
        if remaining <= 0:
            break
        excerpt = text[:remaining]
        chunks.append(f"DOCUMENT: {doc.title}\n{excerpt}")
        if doc.title not in sources:
            sources.append(doc.title)
        used += len(excerpt)
    return "\n\n---\n\n".join(chunks), sources


def _history(messages: List[dict]) -> List[dict]:
    """Keep recent history bounded so it cannot consume the model context."""
    selected = []
    used = 0
    for item in reversed(messages):
        if item.get("role") not in {"user", "assistant"} or not isinstance(item.get("content"), str):
            continue
        remaining = MAX_HISTORY_CHARS - used
        if remaining <= 0:
            break
        content = item["content"][-remaining:]
        selected.append({"role": item["role"], "content": content})
        used += len(content)
    return list(reversed(selected))


async def _ask_llm(base_url: str, model: str, api_key: str, messages: list, provider: str) -> str:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    async with httpx.AsyncClient(timeout=180.0) as client:
        if provider.lower() == "ollama" and "/api/chat" in base_url:
            response = await client.post(
                base_url, headers=headers,
                json={
                    "model": model,
                    "messages": messages,
                    "stream": False,
                    "options": {"num_predict": MAX_OUTPUT_TOKENS},
                },
            )
            response.raise_for_status()
            return response.json()["message"]["content"]
        response = await client.post(
            base_url, headers=headers,
            json={
                "model": model,
                "messages": messages,
                "temperature": 0.2,
                "max_tokens": MAX_OUTPUT_TOKENS,
                "stream": False,
            },
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    provider = get_setting(db, LLM_PROVIDER, "ollama")
    base_url = get_setting(db, LLM_BASE_URL, "")
    model = get_setting(db, LLM_MODEL, "")
    api_key = get_setting(db, LLM_API_KEY, "")
    if not base_url:
        if provider.lower() == "vllm":
            base_url, model = app_settings.vllm_url, model or app_settings.vllm_model
        else:
            base_url, model = "http://host.docker.internal:11434/v1/chat/completions", model or "llama3.2"
    if not model:
        raise HTTPException(status_code=400, detail="Configure an LLM model in Settings first")

    documents = db.query(Document).filter(
        Document.owner_id == user.id, Document.ocr_status == "completed"
    ).all()
    context, sources = _context(documents, request.message)
    if not context:
        raise HTTPException(status_code=400, detail="There are no completed OCR documents to search")
    system = (
        "You answer questions using only the document context below. "
        "If the answer is not present, say clearly that it is not found. "
        "Cite the document name in your answer when useful. Answer in the user's language.\n\n"
        f"DOCUMENT CONTEXT:\n{context}"
    )
    history = _history(request.history)
    try:
        answer = await _ask_llm(
            base_url, model, api_key,
            [{"role": "system", "content": system}, *history, {"role": "user", "content": request.message}],
            provider,
        )
        return {"answer": answer, "sources": sources}
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        try:
            provider_error = exc.response.json().get("error", {})
            provider_message = provider_error.get("message") or provider_error.get("code")
        except (ValueError, TypeError):
            provider_message = None
        if status == 429:
            detail = (
                "OpenRouter a limitat temporar cererea (429). Modelul gratuit are limite de rată; "
                "alege un model plătit, așteaptă resetarea limitei sau verifică usage/credits în OpenRouter."
            )
            if provider_message:
                detail += f" Detaliu OpenRouter: {provider_message}"
        else:
            detail = f"LLM request failed ({status})"
            if provider_message:
                detail += f": {provider_message}"
        logger.exception("LLM chat request failed (status=%s, provider=%s, endpoint=%s, model=%s)", status, provider, base_url, model)
        headers = {}
        if exc.response.headers.get("retry-after"):
            headers["Retry-After"] = exc.response.headers["retry-after"]
        raise HTTPException(status_code=429 if status == 429 else 502, detail=detail, headers=headers) from exc
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.exception("LLM chat request failed (provider=%s, endpoint=%s, model=%s)", provider, base_url, model)
        raise HTTPException(status_code=502, detail=f"LLM request failed: {exc}") from exc
