"""End-to-end test of the database-only archive: export without files, import
with the originals pre-placed in the upload folder, and the safety block when
files are missing (nothing is wiped in that case).

Uses its own database (ocr_backup_dbonly_test) so the replace-all import is
deterministic. Drop/create happens before app import.

Run: cd backend && DATABASE_URL=postgresql://user:password@localhost:5433/ocr_backup_dbonly_test ./venv/bin/python ../test_backup_dbonly.py
"""
import io
import json
import os
import shutil
import sys
import uuid
import zipfile

DB_URL = "postgresql://user:password@localhost:5433/ocr_backup_dbonly_test"

# Recreate a pristine database BEFORE importing the app (import runs init_db).
import psycopg2

conn = psycopg2.connect("postgresql://user:password@localhost:5433/postgres")
conn.autocommit = True
cur = conn.cursor()
cur.execute("DROP DATABASE IF EXISTS ocr_backup_dbonly_test")
cur.execute("CREATE DATABASE ocr_backup_dbonly_test")
cur.close()
conn.close()

os.environ["DATABASE_URL"] = DB_URL
UPLOAD_DIR = "/tmp/ocr-test-uploads-dbonly"
# Start from a clean files folder so stale files cannot mask a missing one.
shutil.rmtree(UPLOAD_DIR, ignore_errors=True)
os.environ["UPLOAD_FOLDER"] = UPLOAD_DIR
os.environ["BACKUP_PART_SIZE_MB"] = "1"

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models import Document, DocumentPage, Folder, Tag, TagRule, SyncFolder, User, AppSetting

client = TestClient(app)
failures = []


def check(name, cond, detail="") -> None:
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


suffix = uuid.uuid4().hex[:6]
admin_name = f"root_{suffix}"
user_name = f"plain_{suffix}"

# --- register admin (first user) and a regular user ---
r = client.post("/api/auth/register", json={
    "username": admin_name, "email": f"{admin_name}@example.com", "password": "secret123"
})
check("register admin", r.status_code in (200, 201), r.text)
r = client.post("/api/auth/register", json={
    "username": user_name, "email": f"{user_name}@example.com", "password": "secret123"
})
check("register user", r.status_code in (200, 201), r.text)
r = client.post("/api/auth/login", data={"username": admin_name, "password": "secret123"})
admin_token = r.json()["access_token"]
HA = {"Authorization": f"Bearer {admin_token}"}
r = client.post("/api/auth/login", data={"username": user_name, "password": "secret123"})
user_token = r.json()["access_token"]
HU = {"Authorization": f"Bearer {user_token}"}

# --- seed data: folder, tag, rule, sync folder, a normal flat upload and a
# sync-folder document whose source file does not exist anywhere ---
db = SessionLocal()
plain = db.query(User).filter(User.username == user_name).first()

folder = Folder(name=f"Invoices {suffix}", owner_id=plain.id)
tag = Tag(name=f"factura-{suffix}", owner_id=plain.id)
db.add_all([folder, tag])
db.commit()
db.refresh(folder)
db.refresh(tag)

rule = TagRule(pattern=f"electric{suffix}", is_active=True, owner_id=plain.id, tag_id=tag.id)
sync = SyncFolder(path=f"/mnt/scan-{suffix}", label="scan", owner_id=plain.id)
db.add_all([rule, sync])

os.makedirs(os.path.join(UPLOAD_DIR, "thumbnails"), exist_ok=True)
doc_id = uuid.uuid4()
# Normal app layout: uploads are stored flat in the upload folder.
file_path = os.path.join(UPLOAD_DIR, f"factura-{suffix}.txt")
with open(file_path, "w") as f:
    f.write(f"Factura electrica {suffix} - total 123 lei")
thumb_path = os.path.join(UPLOAD_DIR, "thumbnails", f"{doc_id}.png")
with open(thumb_path, "wb") as f:
    f.write(b"\x89PNG-fake-thumbnail")

ocr_text = f"Factura de energie electrica {suffix}, sold 123 lei"
doc = Document(
    id=doc_id,
    title=f"factura-{suffix}.txt",
    original_filename=f"factura-{suffix}.txt",
    file_path=file_path,
    file_type="txt",
    file_size=os.path.getsize(file_path),
    page_count=2,
    ocr_text=ocr_text,
    ocr_status="completed",
    thumbnail_path=thumb_path,
    folder_id=folder.id,
    owner_id=plain.id,
)
db.add(doc)
doc.tags.append(tag)
db.add(DocumentPage(document_id=doc_id, page_number=1, ocr_text=ocr_text))
db.add(DocumentPage(document_id=doc_id, page_number=2, ocr_text=f"pagina doi {suffix}"))
db.add(AppSetting(key=f"demo_{suffix}", value="kept"))

# Sync-folder document whose file was already gone before the export: it must
# never block a database-only import (nobody can provide that file).
sync_doc_id = uuid.uuid4()
db.add(Document(
    id=sync_doc_id,
    title=f"scan-{suffix}.pdf",
    original_filename=f"scan-{suffix}.pdf",
    file_path=f"/mnt/scan-{suffix}/scan.pdf",
    file_type="pdf",
    file_size=10,
    page_count=1,
    ocr_text="",
    ocr_status="completed",
    owner_id=plain.id,
))
db.commit()

from sqlalchemy import func

db.query(Document).filter(Document.id == doc_id).update(
    {"search_vector": func.to_tsvector("english", ocr_text)}
)
db.commit()
db.close()

# --- regular users are locked out ---
r = client.post("/api/admin/backup/export", json={"kind": "database"}, headers=HU)
check("regular user cannot export", r.status_code == 403, r.text)
r = client.post(
    "/api/admin/backup/import", headers=HU,
    files=[("files", ("b.zip", b"x", "application/zip"))],
)
check("regular user cannot import", r.status_code == 403, r.text)

# --- backup info exposes the folder the user must fill before importing ---
r = client.get("/api/admin/backup/info", headers=HA)
check(
    "admin reads backup info",
    r.status_code == 200 and r.json().get("upload_folder") == UPLOAD_DIR,
    f"{r.status_code} {r.text}",
)

# --- export the database-only archive ---
r = client.post("/api/admin/backup/export", json={"kind": "database"}, headers=HA)
check("admin export creates a job", r.status_code == 200, r.text)
job = r.json()
job_id = job.get("job_id", "")
parts = job.get("parts", [])
check("database archive has at least one part", len(parts) >= 1, str(parts))

downloaded = []
for i, p in enumerate(sorted(parts, key=lambda p: p["name"]), start=1):
    r = client.get(f"/api/admin/backup/export/{job_id}/{p['name']}", headers=HA)
    ok = r.status_code == 200 and r.content[:2] == b"PK"
    check(f"download part {i}", ok, f"{r.status_code}")
    if ok:
        downloaded.append((p["name"], r.content))

file_entries = []
manifest_bytes = None
for i, (name, content) in enumerate(downloaded, start=1):
    zf = zipfile.ZipFile(io.BytesIO(content))
    names = zf.namelist()
    file_entries.extend(n for n in names if n.startswith("files/"))
    check(f"part {i} carries its index", json.loads(zf.read("part.json"))["index"] == i, name)
    if "manifest.json" in names:
        check("manifest appears in exactly one part", manifest_bytes is None, name)
        manifest_bytes = zf.read("manifest.json")

check("manifest found", manifest_bytes is not None)
manifest = json.loads(manifest_bytes or b"{}")
check("manifest kind is database", manifest.get("kind") == "database", str(manifest.get("kind")))
check(
    "manifest knows the total part count",
    manifest.get("parts_total") == len(downloaded),
    f"{manifest.get('parts_total')} != {len(downloaded)}",
)
check("no files inside a database-only archive", file_entries == [], str(file_entries))
check("manifest has both users", {u["username"] for u in manifest["users"]} == {admin_name, user_name})
check("manifest has document ocr_text", any(d.get("ocr_text") == ocr_text for d in manifest["documents"]))
docs_by_id = {d["id"]: d for d in manifest["documents"]}
check("flat file ref recorded", docs_by_id.get(str(doc_id), {}).get("file_ref") == f"files/{doc_id}/factura-{suffix}.txt",
      str(docs_by_id.get(str(doc_id))))
check("existing file flagged available", docs_by_id.get(str(doc_id), {}).get("had_file") is True)
check("vanished sync file flagged unavailable", docs_by_id.get(str(sync_doc_id), {}).get("had_file") is False,
      str(docs_by_id.get(str(sync_doc_id))))

# --- seed junk, then import while every original is in place ---
db = SessionLocal()
junk = User(username=f"junk_{suffix}", email=f"junk_{suffix}@example.com", hashed_password="x")
db.add(junk)
db.commit()
db.close()

payload = [("files", (name, content, "application/zip")) for name, content in downloaded]
r = client.post("/api/admin/backup/import", headers=HA, files=payload)
check("database import succeeds with files in place", r.status_code == 200, r.text)
stats = r.json().get("imported", {})
check("import reports counts", stats.get("documents") == 2 and stats.get("users") == 2, str(stats))

db = SessionLocal()
check("junk user removed", db.query(User).filter(User.username == f"junk_{suffix}").first() is None)
restored = db.query(Document).filter(Document.id == doc_id).first()
check("document row restored", restored is not None)
check("file_path points at the pre-placed file", restored is not None and restored.file_path == file_path,
      str(restored.file_path if restored else None))
check("pre-placed file exists", restored is not None and os.path.exists(restored.file_path))
check("thumbnail restored from folder", restored is not None and restored.thumbnail_path == thumb_path
      and os.path.exists(thumb_path), str(restored.thumbnail_path if restored else None))
check("pages restored", db.query(DocumentPage).filter(DocumentPage.document_id == doc_id).count() == 2)
sync_restored = db.query(Document).filter(Document.id == sync_doc_id).first()
check("vanished-file document restored anyway", sync_restored is not None)
db.close()

# --- logins, search, download all work after a files-only restore ---
r = client.post("/api/auth/login", data={"username": user_name, "password": "secret123"})
check("user logs in after import", r.status_code == 200, r.text)
r = client.get("/api/documents/search", params={"query": f"energie {suffix}"}, headers=HU)
check("search works after import", r.status_code == 200 and len(r.json()) == 1, r.text)
r = client.get(f"/api/documents/{doc_id}/file", headers=HU)
check("file download works", r.status_code == 200 and r.content.startswith(b"Factura electrica"), r.text[:100])
r = client.get(f"/api/documents/{doc_id}/thumbnail", headers=HU)
check("thumbnail works", r.status_code == 200 and r.content.startswith(b"\x89PNG"), r.text[:100])

# --- missing original: import must be BLOCKED and data left untouched ---
os.rename(file_path, file_path + ".moved")
db = SessionLocal()
junk2 = User(username=f"junk2_{suffix}", email=f"junk2_{suffix}@example.com", hashed_password="x")
db.add(junk2)
db.commit()
db.close()

r = client.post("/api/admin/backup/import", headers=HA, files=payload)
check("missing file blocks import", r.status_code == 400, r.text)
detail = r.json().get("detail", "") if r.status_code == 400 else ""
check("block names the missing file", f"factura-{suffix}.txt" in detail, detail)
check("block names the folder", UPLOAD_DIR in detail, detail)

db = SessionLocal()
check("blocked import left data alone", db.query(User).filter(User.username == f"junk2_{suffix}").first() is not None)
still = db.query(Document).filter(Document.id == doc_id).first()
check("document untouched by blocked import", still is not None and still.file_path == file_path,
      str(still.file_path if still else None))
db.close()

# --- putting the file back makes the import succeed ---
os.rename(file_path + ".moved", file_path)
r = client.post("/api/admin/backup/import", headers=HA, files=payload)
check("import succeeds once the file is back", r.status_code == 200, r.text)
db = SessionLocal()
check("junk2 removed after successful import", db.query(User).filter(User.username == f"junk2_{suffix}").first() is None)
restored = db.query(Document).filter(Document.id == doc_id).first()
check("file_path correct after retry", restored is not None and restored.file_path == file_path)
db.close()

# --- unauthenticated access ---
r = client.post("/api/admin/backup/export", json={"kind": "database"})
check("export requires auth", r.status_code == 401, r.text)
r = client.get("/api/admin/backup/info")
check("info requires auth", r.status_code == 401, r.text)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    sys.exit(1)
print("ALL TESTS PASSED")
