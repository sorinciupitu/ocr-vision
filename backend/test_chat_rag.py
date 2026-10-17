from datetime import datetime
from types import SimpleNamespace

from app.routers.chat import (
    MAX_CONTEXT_CHARS,
    RAG_TOP_K,
    _context,
    _retrieve_chunks,
)


def _document(text, title="document.txt"):
    now = datetime(2026, 1, 1)
    return SimpleNamespace(
        title=title,
        ocr_text=text,
        updated_at=now,
        created_at=now,
    )


def test_retrieves_relevant_chunks_instead_of_whole_documents():
    document = _document("zile fără legătură. " * 300 + "termenul factură și scadență")

    chunks = _retrieve_chunks([document], "când este scadența facturii?")

    assert len(chunks) <= RAG_TOP_K
    assert any("scadență" in chunk for _, chunk, _ in chunks)


def test_context_has_unique_sources_and_stays_bounded():
    first = _document("contract chirie scadență " * 1000, "contract.txt")
    second = _document("factură scadență " * 1000, "factura.txt")

    context, sources = _context([first, second], "scadență")

    assert len(context) <= MAX_CONTEXT_CHARS + 2_000
    assert len(sources) == len(set(sources))
