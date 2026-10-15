"""Tests for PUT /api/tags/{id} (rename + color) and PUT /api/tag-rules/{id}.

Uses its own database (ocr_tagedit_test). Drop/create happens before app
import.

Run: cd backend && DATABASE_URL=postgresql://user:password@localhost:5433/ocr_tagedit_test ./venv/bin/python ../test_tag_edit.py
"""
import os
import sys
import uuid

DB_URL = "postgresql://user:password@localhost:5433/ocr_tagedit_test"

# Recreate a pristine database BEFORE importing the app (import runs init_db).
import psycopg2

conn = psycopg2.connect("postgresql://user:password@localhost:5433/postgres")
conn.autocommit = True
cur = conn.cursor()
cur.execute("DROP DATABASE IF EXISTS ocr_tagedit_test")
cur.execute("CREATE DATABASE ocr_tagedit_test")
cur.close()
conn.close()

os.environ["DATABASE_URL"] = DB_URL
UPLOAD_DIR = f"/tmp/ocr-test-uploads-tagedit-{uuid.uuid4().hex[:6]}"
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
user1 = f"tagedit1_{suffix}"
user2 = f"tagedit2_{suffix}"

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


def create_tag(headers, name):
    return client.post("/api/tags", headers=headers, json={"name": name})


# ---------- tag rename + color ----------

r = create_tag(H1, "facturi")
check("create tag facturi", r.status_code == 201, r.text)
tag1 = r.json()

r = create_tag(H1, "chirie")
check("create tag chirie", r.status_code == 201, r.text)
tag2 = r.json()

r = client.get("/api/tags", headers=H1)
check("list tags ok", r.status_code == 200, r.text)
check("old tag exposes color field", all("color" in t for t in r.json()), r.text)
check("old tag color is null", all(t.get("color") is None for t in r.json()), r.text)

r = client.put(f"/api/tags/{tag1['id']}", headers=H1, json={"name": "facturi 2026"})
check("rename tag", r.status_code == 200, r.text)
check("rename returns new name", r.json().get("name") == "facturi 2026", r.text)
check("rename keeps document_count", "document_count" in r.json(), r.text)

r = client.put(f"/api/tags/{tag1['id']}", headers=H1, json={"color": "rose"})
check("set color", r.status_code == 200, r.text)
check("color persisted", r.json().get("color") == "rose", r.text)

r = client.put(f"/api/tags/{tag1['id']}", headers=H1, json={"name": "chirie"})
check("rename to existing tag is 409", r.status_code == 409, r.text)

r = client.put(f"/api/tags/{tag1['id']}", headers=H1, json={"name": "CHIRIE"})
check("case-insensitive rename conflict is 409", r.status_code == 409, r.text)

r = client.put(f"/api/tags/{tag1['id']}", headers=H1, json={"name": "   "})
check("blank name is 422", r.status_code == 422, r.text)

r = client.put(f"/api/tags/{tag1['id']}", headers=H1, json={"color": "chartreuse"})
check("invalid color is 422", r.status_code == 422, r.text)

r = client.put(f"/api/tags/{tag1['id']}", headers=H1, json={})
check("empty patch is no-op 200", r.status_code == 200, r.text)

r = client.put(f"/api/tags/{tag1['id']}", headers=H1, json={"name": "facturi 2026"})
check("rename to self is 200", r.status_code == 200, r.text)

r = client.put(f"/api/tags/{tag1['id']}", headers=H2, json={"name": "hijack"})
check("other user's tag is 404", r.status_code == 404, r.text)

r = client.put(f"/api/tags/{tag1['id']}", json={"name": "anon"})
check("tag update requires auth", r.status_code == 401, r.text)

r = client.get("/api/tags", headers=H1)
by_name = {t["name"]: t for t in r.json()}
check("list shows new name", "facturi 2026" in by_name, r.text)
check("list shows color", by_name.get("facturi 2026", {}).get("color") == "rose", r.text)

# ---------- rule edit ----------

r = client.post(
    "/api/documents/upload",
    headers=H1,
    files={"file": ("contract chiriasi.pdf", b"%PDF-fake", "application/pdf")},
)
check("upload doc for rule", r.status_code == 200, r.text)
doc = r.json()

r = client.post(
    "/api/tag-rules",
    headers=H1,
    json={"pattern": "alphapattern", "tag_id": tag1["id"]},
)
check("create rule", r.status_code == 201, r.text)
rule = r.json()

r = client.put(
    f"/api/tag-rules/{rule['id']}",
    headers=H1,
    json={"pattern": "chiriasi"},
)
check("edit rule pattern", r.status_code == 200, r.text)
check("pattern updated", r.json().get("pattern") == "chiriasi", r.text)
check("edit reports backfilled matches", r.json().get("matched_count", 0) >= 1, r.text)

r = client.get("/api/documents", headers=H1)
mine = [d for d in r.json() if d["id"] == doc["id"]]
check("doc exists in list", len(mine) == 1, r.text)
check("backfill after edit tagged the doc",
      any(t["id"] == tag1["id"] for t in mine[0].get("tags", [])), r.text)

r = client.put(f"/api/tag-rules/{rule['id']}", headers=H1, json={"is_active": False})
check("toggle rule off", r.status_code == 200, r.text)
check("is_active false", r.json().get("is_active") is False, r.text)
check("toggle keeps pattern", r.json().get("pattern") == "chiriasi", r.text)

r = client.put(f"/api/tag-rules/{rule['id']}", headers=H1, json={"is_active": True})
check("toggle rule on", r.status_code == 200 and r.json().get("is_active") is True, r.text)

r = client.post(
    "/api/tag-rules",
    headers=H1,
    json={"pattern": "secondpattern", "tag_id": tag1["id"]},
)
check("create second rule", r.status_code == 201, r.text)
rule2 = r.json()

r = client.put(
    f"/api/tag-rules/{rule2['id']}",
    headers=H1,
    json={"pattern": "chiriasi"},
)
check("duplicate pattern edit is 409", r.status_code == 409, r.text)

r = client.put(f"/api/tag-rules/{rule['id']}", headers=H1, json={"pattern": "   "})
check("blank pattern is 422", r.status_code == 422, r.text)

r = client.put(f"/api/tag-rules/{rule['id']}", headers=H1, json={})
check("empty rule patch is no-op 200", r.status_code == 200, r.text)

r = client.put(f"/api/tag-rules/{rule['id']}", headers=H2, json={"pattern": "x"})
check("other user's rule is 404", r.status_code == 404, r.text)

r = client.put(f"/api/tag-rules/{rule['id']}", json={"pattern": "x"})
check("rule update requires auth", r.status_code == 401, r.text)

print()
if failures:
    print(f"FAILURES: {len(failures)}")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("ALL TESTS PASSED")
