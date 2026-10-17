from datetime import datetime
from types import SimpleNamespace

from app.routers.chat import (
    MAX_CONTEXT_CHARS,
    RAG_TOP_K,
    _context,
    _history,
    _restrict_to_active_sources,
    _retrieval_query,
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


def test_irrelevant_documents_are_not_sent_to_the_model():
    document = _document("informații despre asigurare și călătorie", "calatorie.txt")

    context, sources = _context([document], "care este numărul talonului?")

    assert context == ""
    assert sources == []


def test_expiry_in_another_document_does_not_match_an_itp_question():
    document = _document(
        "Avizul de amplasament expiră la data de 17.07.2014.",
        "dosar teren locuinta.pdf",
    )

    context, sources = _context([document], "Când expiră ITP-ul mașinii?")

    assert context == ""
    assert sources == []


def test_follow_up_retrieval_keeps_the_previous_subject():
    query = _retrieval_query(
        [{"role": "user", "content": "Când expiră ITP-ul mașinii?"}],
        "Și când expiră?",
    )

    assert "ITP" in query
    assert "expiră" in query


def test_follow_up_stays_with_sources_from_the_previous_answer():
    active = _document("ITP autoturism", "masina.pdf")
    unrelated = _document("contract imobil", "imobil.pdf")
    history = _history([
        {"role": "assistant", "content": "Am găsit informația.", "sources": ["masina.pdf"]},
    ])

    scoped = _restrict_to_active_sources([active, unrelated], history, "și când expiră?")

    assert [document.title for document in scoped] == ["masina.pdf"]
