"""End-to-end test of the folders/tags feature against a live Postgres.

Run: cd backend && DATABASE_URL=postgresql://user:password@localhost:5433/ocr_db ./venv/bin/python ../test_organize_e2e.py
"""
import io
import os
import sys
import uuid

os.environ.setdefault("DATABASE_URL", "postgresql://user:password@localhost:5433/ocr_db")
os.environ.setdefault("UPLOAD_FOLDER", "/tmp/ocr-test-uploads")

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
failures = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


suffix = uuid.uuid4().hex[:6]
uname = f"tester_{suffix}"

# --- auth ---
r = client.post("/api/auth/register", json={
    "username": uname, "email": f"{uname}@example.com", "password": "secret123"
})
check("register user", r.status_code in (200, 201), r.text)
r = client.post("/api/auth/login", data={"username": uname, "password": "secret123"})
check("login user", r.status_code == 200, r.text)
token = r.json()["access_token"]
H = {"Authorization": f"Bearer {token}"}

# --- folders CRUD ---
r = client.post("/api/folders", json={"name": "  Invoices   2024 "}, headers=H)
check("create folder (normalizes whitespace)", r.status_code == 201, r.text)
folder = r.json()
check("folder name normalized", folder["name"] == "Invoices 2024", r.text)

r = client.post("/api/folders", json={"name": "invoices 2024"}, headers=H)
check("duplicate folder rejected (case-insensitive)", r.status_code == 409, r.text)

r = client.post("/api/folders", json={"name": "   "}, headers=H)
check("blank folder name rejected", r.status_code == 422, r.text)

# --- tags CRUD ---
r = client.post("/api/tags", json={"name": " receipt "}, headers=H)
check("create tag (trims)", r.status_code == 201, r.text)
tag_receipt = r.json()
r = client.post("/api/tags", json={"name": "tax"}, headers=H)
check("create second tag", r.status_code == 201, r.text)
tag_tax = r.json()
r = client.post("/api/tags", json={"name": "RECEIPT"}, headers=H)
check("duplicate tag rejected (case-insensitive)", r.status_code == 409, r.text)

# --- upload a document ---
files = {"file": (f"inv-{suffix}.pdf", io.BytesIO(b"%PDF-1.4 test"), "application/pdf")}
r = client.post("/api/documents/upload", files=files, headers=H)
check("upload document", r.status_code == 200, r.text)
doc = r.json()
check("new document has no folder", doc["folder"] is None, r.text)
check("new document has no tags", doc["tags"] == [], r.text)

# --- move document into folder ---
r = client.put(f"/api/documents/{doc['id']}/folder", json={"folder_id": folder["id"]}, headers=H)
check("move document to folder", r.status_code == 200, r.text)
check("document reports folder", r.json().get("folder", {}).get("name") == "Invoices 2024", r.text)

# --- set tags ---
r = client.put(f"/api/documents/{doc['id']}/tags",
               json={"tag_ids": [tag_receipt["id"], tag_tax["id"]]}, headers=H)
check("set document tags", r.status_code == 200, r.text)
check("document reports 2 tags", len(r.json()["tags"]) == 2, r.text)

# --- counts ---
r = client.get("/api/folders", headers=H)
check("folder list with count", any(f["id"] == folder["id"] and f["document_count"] == 1
                                    for f in r.json()), r.text)
r = client.get("/api/tags", headers=H)
check("tag counts", {t["name"]: t["document_count"] for t in r.json()} == {"receipt": 1, "tax": 1}, r.text)

# --- filtering ---
r = client.get("/api/documents", params={"folder_id": folder["id"]}, headers=H)
check("filter by folder", [d["id"] for d in r.json()] == [doc["id"]], r.text)
r = client.get("/api/documents", params={"tag_id": tag_receipt["id"]}, headers=H)
check("filter by tag", [d["id"] for d in r.json()] == [doc["id"]], r.text)
r = client.get("/api/documents", params={"unfiled": "true"}, headers=H)
check("filter unfiled excludes moved doc", doc["id"] not in [d["id"] for d in r.json()], r.text)

# --- unfile (folder_id null) ---
r = client.put(f"/api/documents/{doc['id']}/folder", json={"folder_id": None}, headers=H)
check("unfile document", r.status_code == 200 and r.json()["folder"] is None, r.text)
r = client.get("/api/documents", params={"unfiled": "true"}, headers=H)
check("unfiled filter includes it now", doc["id"] in [d["id"] for d in r.json()], r.text)

# --- moving to a foreign folder is rejected ---
r2 = client.post("/api/auth/register", json={
    "username": f"other_{suffix}", "email": f"other_{suffix}@example.com", "password": "secret123"
})
r2 = client.post("/api/auth/login", data={"username": f"other_{suffix}", "password": "secret123"})
H2 = {"Authorization": f"Bearer {r2.json()['access_token']}"}
r = client.put(f"/api/documents/{doc['id']}/folder", json={"folder_id": folder["id"]}, headers=H2)
check("foreign doc move rejected", r.status_code == 404, r.text)
r = client.get("/api/folders", headers=H2)
check("other user sees no folders", r.json() == [], r.text)
r = client.get("/api/documents", headers=H2)
check("other user sees no documents", r.json() == [], r.text)

# --- moving to own folder re-check, then delete folder unlinks docs ---
client.put(f"/api/documents/{doc['id']}/folder", json={"folder_id": folder["id"]}, headers=H)
r = client.delete(f"/api/folders/{folder['id']}", headers=H)
check("delete folder", r.status_code == 200, r.text)
r = client.get(f"/api/documents/{doc['id']}", headers=H)
check("doc unlinked after folder delete", r.json()["folder"] is None, r.text)

# --- tag delete removes assignments but keeps document ---
r = client.delete(f"/api/tags/{tag_receipt['id']}", headers=H)
check("delete tag", r.status_code == 200, r.text)
r = client.get(f"/api/documents/{doc['id']}", headers=H)
check("doc keeps remaining tag", [t["name"] for t in r.json()["tags"]] == ["tax"], r.text)

# --- delete document still works ---
r = client.delete(f"/api/documents/{doc['id']}", headers=H)
check("delete document", r.status_code == 200, r.text)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    sys.exit(1)
print("ALL TESTS PASSED")
