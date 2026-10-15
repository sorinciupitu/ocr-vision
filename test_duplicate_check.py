"""Test for POST /api/documents/duplicates/check (upload duplicate warning).

Uses its own database (ocr_dupe_test) and its own upload folder so the
filename lookups are deterministic. Drop/create happens before app import.

Run: cd backend && DATABASE_URL=postgresql://user:password@localhost:5433/ocr_dupe_test ./venv/bin/python ../test_duplicate_check.py
"""
import io
import os
import sys
import uuid

DB_URL = "postgresql://user:password@localhost:5433/ocr_dupe_test"

# Recreate a pristine database BEFORE importing the app (import runs init_db).
import psycopg2

conn = psycopg2.connect("postgresql://user:password@localhost:5433/postgres")
conn.autocommit = True
cur = conn.cursor()
cur.execute("DROP DATABASE IF EXISTS ocr_dupe_test")
cur.execute("CREATE DATABASE ocr_dupe_test")
cur.close()
conn.close()

os.environ["DATABASE_URL"] = DB_URL
UPLOAD_DIR = f"/tmp/ocr-test-uploads-dupe-{uuid.uuid4().hex[:6]}"
os.environ["UPLOAD_FOLDER"] = UPLOAD_DIR

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
failures = []


def check(name, cond, detail="") -> None:
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


suffix = uuid.uuid4().hex[:6]
user1 = f"dupe1_{suffix}"
user2 = f"dupe2_{suffix}"

r = client.post("/api/auth/register", json={
    "username": user1, "email": f"{user1}@example.com", "password": "secret123"
})
check("register user1", r.status_code in (200, 201), r.text)
r = client.post("/api/auth/login", data={"username": user1, "password": "secret123"})
token1 = r.json()["access_token"]
H1 = {"Authorization": f"Bearer {token1}"}

r = client.post("/api/auth/register", json={
    "username": user2, "email": f"{user2}@example.com", "password": "secret123"
})
check("register user2", r.status_code in (200, 201), r.text)
r = client.post("/api/auth/login", data={"username": user2, "password": "secret123"})
token2 = r.json()["access_token"]
H2 = {"Authorization": f"Bearer {token2}"}


def upload(headers, name, content=b"%PDF-fake"):
    return client.post(
        "/api/documents/upload",
        headers=headers,
        files={"file": (name, content, "application/pdf")},
    )


r = upload(H1, "factura ianuarie.pdf")
check("user1 uploads doc 1", r.status_code == 200, r.text)
r = upload(H1, "factura februarie.pdf")
check("user1 uploads doc 2", r.status_code == 200, r.text)
r = upload(H2, "secret-user2.pdf")
check("user2 uploads own doc", r.status_code == 200, r.text)

# --- document list carries updated_at (needed for the queue ETA) ---
r = client.get("/api/documents", headers=H1)
check("documents list ok", r.status_code == 200, r.text)
docs = r.json()
check("user1 sees two documents", len(docs) == 2, r.text)
check("document exposes updated_at", all("updated_at" in d and d["updated_at"] for d in docs), str(docs[0].keys() if docs else None))

# --- duplicate check: exact, case-insensitive, other users invisible ---
r = client.post("/api/documents/duplicates/check", json={"names": ["factura ianuarie.pdf"]}, headers=H1)
check("exact duplicate detected", r.status_code == 200 and r.json() == {"existing": ["factura ianuarie.pdf"]}, f"{r.status_code} {r.text}")

r = client.post("/api/documents/duplicates/check", json={"names": ["Factura Ianuarie.PDF"]}, headers=H1)
check("duplicate match is case-insensitive", r.json() == {"existing": ["Factura Ianuarie.PDF"]}, r.text)

r = client.post(
    "/api/documents/duplicates/check",
    json={"names": ["factura februarie.pdf", "nu-exista.pdf", "alta.pdf"]},
    headers=H1,
)
check("only existing names returned", r.json() == {"existing": ["factura februarie.pdf"]}, r.text)

r = client.post("/api/documents/duplicates/check", json={"names": ["secret-user2.pdf"]}, headers=H1)
check("other user's file is not a duplicate", r.json() == {"existing": []}, r.text)

r = client.post("/api/documents/duplicates/check", json={"names": ["", "   "]}, headers=H1)
check("blank names ignored", r.json() == {"existing": []}, r.text)

# Deduplication is case-insensitive: the three spellings name one file, so
# the answer keeps a single entry (the first spelling the caller sent).
r = client.post(
    "/api/documents/duplicates/check",
    json={"names": ["factura ianuarie.pdf", "Factura Ianuarie.pdf", "factura ianuarie.PDF"]},
    headers=H1,
)
check("answer is deduplicated", r.json() == {"existing": ["factura ianuarie.pdf"]}, r.text)

r = client.post("/api/documents/duplicates/check", json={"names": []}, headers=H1)
check("empty list answered", r.status_code == 200 and r.json() == {"existing": []}, r.text)

# --- auth required ---
r = client.post("/api/documents/duplicates/check", json={"names": ["factura ianuarie.pdf"]})
check("check requires auth", r.status_code == 401, r.text)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    sys.exit(1)
print("ALL TESTS PASSED")
