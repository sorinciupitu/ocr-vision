"""End-to-end tests for bulk actions, auto-tag rules and analytics.

Run: cd backend && DATABASE_URL=postgresql://user:password@localhost:5433/ocr_db ./venv/bin/python ../test_bulk_rules_analytics.py
"""
import io
import os
import sys
import uuid
from datetime import datetime, timedelta

os.environ.setdefault("DATABASE_URL", "postgresql://user:password@localhost:5433/ocr_db")
os.environ.setdefault("UPLOAD_FOLDER", "/tmp/ocr-test-uploads")

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models import Document

client = TestClient(app)
failures = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


suffix = uuid.uuid4().hex[:6]


def register(name):
    r = client.post("/api/auth/register", json={
        "username": name, "email": f"{name}@example.com", "password": "secret123"
    })
    assert r.status_code in (200, 201), r.text
    r = client.post("/api/auth/login", data={"username": name, "password": "secret123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def upload(H, filename, text=None):
    files = {"file": (filename, io.BytesIO(b"%PDF-1.4 test"), "application/pdf")}
    r = client.post("/api/documents/upload", files=files, headers=H)
    assert r.status_code == 200, r.text
    doc = r.json()
    if text is not None:
        db = SessionLocal()
        try:
            d = db.query(Document).filter(Document.id == doc["id"]).first()
            d.ocr_text = text
            db.commit()
        finally:
            db.close()
    return doc


alice = register(f"alice_{suffix}")
bob = register(f"bob_{suffix}")

# ============================== BULK ENDPOINTS ==============================

r = client.post("/api/folders", json={"name": "BulkFolder"}, headers=alice)
assert r.status_code == 201, r.text
bulk_folder = r.json()
r = client.post("/api/tags", json={"name": "bulktag"}, headers=alice)
assert r.status_code == 201, r.text
bulk_tag = r.json()

doc_a = upload(alice, f"a-{suffix}.pdf", "alpha text")
doc_b = upload(alice, f"b-{suffix}.pdf", "beta text")
doc_own = upload(bob, f"own-{suffix}.pdf", "bob doc")

# --- bulk-folder ---
r = client.post("/api/documents/bulk-folder",
                json={"document_ids": [doc_a["id"], doc_b["id"]],
                      "folder_id": bulk_folder["id"]},
                headers=alice)
check("bulk-folder moves multiple docs", r.status_code == 200 and r.json().get("updated") == 2, r.text)
r = client.get("/api/documents", params={"folder_id": bulk_folder["id"]}, headers=alice)
check("bulk-folder result visible in filter",
      sorted(d["id"] for d in r.json()) == sorted([doc_a["id"], doc_b["id"]]), r.text)

r = client.post("/api/documents/bulk-folder",
                json={"document_ids": [doc_a["id"]], "folder_id": None}, headers=alice)
check("bulk-folder unfiles with null", r.status_code == 200 and r.json().get("updated") == 1, r.text)
r = client.get(f"/api/documents/{doc_a['id']}", headers=alice)
check("doc_a unfiled", r.json()["folder"] is None, r.text)
r = client.get(f"/api/documents/{doc_b['id']}", headers=alice)
check("doc_b untouched by sibling unfile", r.json()["folder"] is not None, r.text)

r = client.post("/api/documents/bulk-folder",
                json={"document_ids": [doc_own["id"]], "folder_id": bulk_folder["id"]},
                headers=alice)
check("bulk-folder rejects foreign doc", r.status_code == 404, r.text)
r = client.get(f"/api/documents/{doc_own['id']}", headers=bob)
check("foreign doc not moved", r.json()["folder"] is None, r.text)

r = client.post("/api/documents/bulk-folder",
                json={"document_ids": [doc_a["id"]], "folder_id": str(uuid.uuid4())},
                headers=alice)
check("bulk-folder rejects unknown folder", r.status_code == 404, r.text)

r = client.post("/api/documents/bulk-folder",
                json={"document_ids": [doc_a["id"]], "folder_id": bulk_folder["id"]},
                headers=bob)
check("bulk-folder requires owning every doc", r.status_code == 404, r.text)
r = client.get(f"/api/documents/{doc_a['id']}", headers=alice)
check("alice doc unchanged after bob's attempt", r.json()["folder"] is None, r.text)

r = client.post("/api/documents/bulk-folder",
                json={"document_ids": [], "folder_id": bulk_folder["id"]}, headers=alice)
check("bulk-folder rejects empty id list", r.status_code == 422, r.text)
r = client.post("/api/documents/bulk-folder",
                json={"document_ids": [doc_a["id"]], "folder_id": bulk_folder["id"]})
check("bulk-folder requires auth", r.status_code in (401, 403), r.text)

# --- bulk-tags ---
r = client.post("/api/documents/bulk-tags",
                json={"document_ids": [doc_a["id"], doc_b["id"]],
                      "tag_ids": [bulk_tag["id"]]},
                headers=alice)
check("bulk-tags adds tag to multiple docs", r.status_code == 200 and r.json().get("updated") == 2, r.text)
r = client.get(f"/api/documents/{doc_a['id']}", headers=alice)
check("bulk-tags visible on doc", [t["name"] for t in r.json()["tags"]] == ["bulktag"], r.text)

r = client.post("/api/documents/bulk-tags",
                json={"document_ids": [doc_a["id"]], "tag_ids": [bulk_tag["id"]]},
                headers=alice)
check("bulk-tags idempotent (no duplicate)",
      r.status_code == 200 and r.json().get("updated") == 1, r.text)
r = client.get(f"/api/documents/{doc_a['id']}", headers=alice)
check("still exactly one tag", len(r.json()["tags"]) == 1, r.text)

r = client.post("/api/documents/bulk-tags",
                json={"document_ids": [doc_own["id"]], "tag_ids": [bulk_tag["id"]]},
                headers=alice)
check("bulk-tags rejects foreign doc", r.status_code == 404, r.text)
r = client.post("/api/documents/bulk-tags",
                json={"document_ids": [doc_a["id"]], "tag_ids": [str(uuid.uuid4())]},
                headers=alice)
check("bulk-tags rejects unknown tag", r.status_code == 404, r.text)

# --- bulk-delete ---
r = client.post("/api/documents/bulk-delete",
                json={"document_ids": [doc_own["id"]]}, headers=alice)
check("bulk-delete rejects foreign doc", r.status_code == 404, r.text)
r = client.get(f"/api/documents/{doc_own['id']}", headers=bob)
check("foreign doc survives", r.status_code == 200, r.text)

r = client.post("/api/documents/bulk-delete",
                json={"document_ids": [doc_a["id"], doc_b["id"]]}, headers=alice)
check("bulk-delete removes owned docs", r.status_code == 200 and r.json().get("deleted") == 2, r.text)
r = client.get(f"/api/documents/{doc_a['id']}", headers=alice)
check("deleted doc gone", r.status_code == 404, r.text)
r = client.post("/api/documents/bulk-delete",
                json={"document_ids": []}, headers=alice)
check("bulk-delete rejects empty id list", r.status_code == 422, r.text)

# ============================== TAG RULES ==============================

r = client.post("/api/tags", json={"name": "Contracte"}, headers=alice)
assert r.status_code == 201, r.text
contracte = r.json()

doc_txt = upload(alice, f"raport-{suffix}.pdf", "This agreement mentions CONTRACT terms")
doc_fname = upload(alice, f"Contract_vechi-{suffix}.pdf", "nothing relevant here")
doc_none = upload(alice, f"plain-{suffix}.pdf", "no match at all")
doc_pct = upload(alice, f"pct-{suffix}.pdf", "progress 100% done")

r = client.post("/api/tag-rules",
                json={"pattern": "  contract ", "tag_id": contracte["id"]},
                headers=alice)
check("create rule backfills matching docs",
      r.status_code == 201 and r.json().get("matched_count") == 2, r.text)
rule1 = r.json()
check("rule response carries tag", r.json().get("tag", {}).get("name") == "Contracte", r.text)

r = client.get(f"/api/documents/{doc_txt['id']}", headers=alice)
check("text-matched doc tagged", [t["name"] for t in r.json()["tags"]] == ["Contracte"], r.text)
r = client.get(f"/api/documents/{doc_fname['id']}", headers=alice)
check("filename-matched doc tagged", [t["name"] for t in r.json()["tags"]] == ["Contracte"], r.text)
r = client.get(f"/api/documents/{doc_none['id']}", headers=alice)
check("non-matching doc untouched", r.json()["tags"] == [], r.text)

r = client.post("/api/tag-rules",
                json={"pattern": "CONTRACT", "tag_id": contracte["id"]}, headers=alice)
check("duplicate rule rejected (case-insensitive)", r.status_code == 409, r.text)
r = client.post("/api/tag-rules",
                json={"pattern": "contract", "tag_id": str(uuid.uuid4())}, headers=alice)
check("rule with unknown tag rejected", r.status_code == 404, r.text)
r = client.post("/api/tag-rules",
                json={"pattern": "   ", "tag_id": contracte["id"]}, headers=alice)
check("blank pattern rejected", r.status_code == 422, r.text)
r = client.post("/api/tag-rules",
                json={"pattern": "contract", "tag_id": contracte["id"]}, headers=bob)
check("rule cannot use someone else's tag", r.status_code == 404, r.text)

r = client.post("/api/tag-rules",
                json={"pattern": "%", "tag_id": contracte["id"]}, headers=alice)
check("wildcard chars match literally",
      r.status_code == 201 and r.json().get("matched_count") == 1, r.text)

r = client.get("/api/tag-rules", headers=alice)
check("list rules", r.status_code == 200 and len(r.json()) == 2, r.text)
r = client.get("/api/tag-rules", headers=bob)
check("rules are per-user", r.json() == [], r.text)

# Simulates the OCR-completion call site: same helper the background task runs.
from app.auto_tagging import apply_rules_to_document
doc_new = upload(alice, f"fresh-{suffix}.pdf")
db = SessionLocal()
try:
    d = db.query(Document).filter(Document.id == doc_new["id"]).first()
    d.ocr_text = "Brand new CONTRACT inside"
    db.commit()
    added = apply_rules_to_document(db, d)
finally:
    db.close()
check("apply_rules_to_document tags fresh doc", added == 1, f"added={added}")
r = client.get(f"/api/documents/{doc_new['id']}", headers=alice)
check("fresh doc carries rule tag", [t["name"] for t in r.json()["tags"]] == ["Contracte"], r.text)

r = client.delete(f"/api/tag-rules/{rule1['id']}", headers=alice)
check("delete rule", r.status_code == 200, r.text)
r = client.get(f"/api/documents/{doc_txt['id']}", headers=alice)
check("deleting rule keeps existing tags",
      [t["name"] for t in r.json()["tags"]] == ["Contracte"], r.text)
r = client.get("/api/tag-rules", headers=alice)
check("rule removed from list", len(r.json()) == 1, r.text)

# ============================== ANALYTICS ==============================

dave = register(f"dave_{suffix}")
eve = register(f"eve_{suffix}")

r = client.post("/api/folders", json={"name": "StatFolder"}, headers=dave)
assert r.status_code == 201, r.text
r = client.post("/api/tags", json={"name": "stattag"}, headers=dave)
assert r.status_code == 201, r.text

db = SessionLocal()
try:
    now = datetime.utcnow()
    old = now - timedelta(days=400)
    seeds = [
        # title, filename, pages, ocr_text, created_at
        ("d1", "d1.pdf", 3, "one two three", now),
        ("d2", "d2.pdf", 2, "  four \n five  ", now),
        ("d3", "d3.pdf", 1, "", old),
        ("d4", "d4.pdf", 1, None, now),
    ]
    dave_user_id = None
    from app.models import User
    dave_user = db.query(User).filter(User.username == f"dave_{suffix}").first()
    dave_user_id = dave_user.id
    for title, fname, pages, text, created in seeds:
        db.add(Document(
            title=title, original_filename=fname,
            file_path=f"/tmp/{title}-{suffix}.pdf", file_type="pdf",
            file_size=1, page_count=pages, ocr_text=text,
            ocr_status="completed", owner_id=dave_user_id, created_at=created,
        ))
    db.commit()
finally:
    db.close()

r = client.get("/api/analytics/summary", headers=dave)
check("summary responds", r.status_code == 200, r.text)
s = r.json()
check("summary document count", s.get("documents") == 4, str(s))
check("summary page count", s.get("pages") == 7, str(s))
check("summary word count (trimmed, whitespace-normalized, NULL=0)", s.get("words") == 5, str(s))
check("summary tag/folder counts", s.get("tags") == 1 and s.get("folders") == 1, str(s))
by_month = s.get("by_month") or []
check("by_month spans 12 months", len(by_month) == 12, str(by_month))
check("by_month chronological, last is current month",
      len(by_month) == 12 and by_month[-1]["month"] == now.strftime("%Y-%m"), str(by_month))
check("by_month counts docs created this month",
      len(by_month) == 12 and by_month[-1]["count"] == 3, str(by_month))
check("400-day-old doc outside 12-month window but in totals",
      len(by_month) == 12 and by_month[-1]["count"] == 3 and s.get("documents") == 4, str(by_month))

r = client.get("/api/analytics/summary", headers=eve)
check("analytics isolated per user",
      r.status_code == 200 and r.json().get("documents") == 0
      and all(m["count"] == 0 for m in r.json().get("by_month", [])), r.text)
r = client.get("/api/analytics/summary")
check("summary requires auth", r.status_code in (401, 403), r.text)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    sys.exit(1)
print("ALL TESTS PASSED")
