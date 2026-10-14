"""End-to-end test of archive backup: split export + multipart import round-trip.

The export now creates a job made of independent ZIP parts (~1GB each in
production, 1MB here to force a split) and the import accepts all parts at
once, rejecting incomplete sets.

Uses its own database (ocr_backup_test) so the replace-all import is
deterministic. Drop/create happens before app import.

Run: cd backend && DATABASE_URL=postgresql://user:password@localhost:5433/ocr_backup_test ./venv/bin/python ../test_backup_restore.py
"""
import io
import json
import os
import sys
import uuid
import zipfile

DB_URL = "postgresql://user:password@localhost:5433/ocr_backup_test"

# Recreate a pristine database BEFORE importing the app (import runs init_db).
import psycopg2

conn = psycopg2.connect("postgresql://user:password@localhost:5433/postgres")
conn.autocommit = True
cur = conn.cursor()
cur.execute("DROP DATABASE IF EXISTS ocr_backup_test")
cur.execute("CREATE DATABASE ocr_backup_test")
cur.close()
conn.close()

os.environ["DATABASE_URL"] = DB_URL
UPLOAD_DIR = "/tmp/ocr-test-uploads-backup"
os.environ["UPLOAD_FOLDER"] = UPLOAD_DIR
# Tiny part size so the seeded 1.5MB file forces the archive to split.
os.environ["BACKUP_PART_SIZE_MB"] = "1"

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

from datetime import datetime

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

# --- seed real data: folder, tag, rule, sync folder, document with file+thumb+pages ---
db = SessionLocal()
admin = db.query(User).filter(User.username == admin_name).first()
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

os.makedirs(UPLOAD_DIR, exist_ok=True)
doc_id = uuid.uuid4()
file_path = os.path.join(UPLOAD_DIR, f"{doc_id}_factura.txt")
# Text header (checked on download) + incompressible payload so the ZIP entry
# alone exceeds the 1MB part size and forces a split.
with open(file_path, "wb") as f:
    f.write(f"Factura electrica {suffix} - total 123 lei\n".encode())
    f.write(os.urandom(1_500_000))
thumb_path = os.path.join(UPLOAD_DIR, "thumbnails", f"{doc_id}.png")
os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
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
doc.tags.append(tag)  # the M2M link must exist so the archive carries it
db.add(DocumentPage(document_id=doc_id, page_number=1, ocr_text=ocr_text))
db.add(DocumentPage(document_id=doc_id, page_number=2, ocr_text=f"pagina doi {suffix}"))
db.add(AppSetting(key=f"demo_{suffix}", value="kept"))
db.commit()

# Search needs the vector; the app maintains it in ocr_runner, set it here too.
from sqlalchemy import func

db.query(Document).filter(Document.id == doc_id).update(
    {"search_vector": func.to_tsvector("english", ocr_text)}
)
db.commit()
db.close()

# --- regular users are locked out of every backup endpoint ---
r = client.post("/api/admin/backup/export", json={"kind": "full"}, headers=HU)
check("regular user cannot export", r.status_code == 403, r.text)
r = client.post(
    "/api/admin/backup/import", headers=HU,
    files=[("files", ("b.zip", b"x", "application/zip"))],
)
check("regular user cannot import", r.status_code == 403, r.text)
r = client.get("/api/admin/backup/info", headers=HU)
check("regular user cannot read backup info", r.status_code == 403, r.text)

# --- backup info tells the UI the part size and the files folder ---
r = client.get("/api/admin/backup/info", headers=HA)
check(
    "admin reads backup info",
    r.status_code == 200 and r.json().get("upload_folder") == UPLOAD_DIR
    and r.json().get("part_size_mb") == 1,
    f"{r.status_code} {r.text}",
)

# --- admin exports the archive as a split job ---
r = client.post("/api/admin/backup/export", json={"kind": "full"}, headers=HA)
check("admin export creates a job", r.status_code == 200, r.text)
job = r.json()
job_id = job.get("job_id", "")
parts = job.get("parts", [])
check("archive is split into multiple parts", len(parts) >= 2, str(parts))
check("parts report nonzero sizes", all(p.get("size", 0) > 0 for p in parts), str(parts))

# --- download every part; each must be a valid ZIP carrying its index ---
downloaded = []
for i, p in enumerate(sorted(parts, key=lambda p: p["name"]), start=1):
    r = client.get(f"/api/admin/backup/export/{job_id}/{p['name']}", headers=HA)
    ok = r.status_code == 200 and r.content[:2] == b"PK"
    check(f"download part {i}", ok, f"{r.status_code} {r.headers.get('content-type')}")
    if not ok:
        continue
    check(
        f"part {i} content-length matches job",
        r.headers.get("content-length") == str(p["size"]),
        f"{r.headers.get('content-length')} != {p['size']}",
    )
    downloaded.append((p["name"], r.content))

manifest_bytes = None
all_names = []
file_contents = None
thumb_contents = None
for i, (name, content) in enumerate(downloaded, start=1):
    zf = zipfile.ZipFile(io.BytesIO(content))
    names = zf.namelist()
    all_names.extend(names)
    check(f"part {i} carries its index", json.loads(zf.read("part.json"))["index"] == i, name)
    if "manifest.json" in names:
        check("manifest appears in exactly one part", manifest_bytes is None, name)
        manifest_bytes = zf.read("manifest.json")
    if f"files/{doc_id}/{doc_id}_factura.txt" in names:
        file_contents = zf.read(f"files/{doc_id}/{doc_id}_factura.txt")
    if f"files/{doc_id}/thumb.png" in names:
        thumb_contents = zf.read(f"files/{doc_id}/thumb.png")

check("manifest found", manifest_bytes is not None)
manifest = json.loads(manifest_bytes or b"{}")
check("manifest version is 1", manifest.get("version") == 1, str(manifest.get("version")))
check("manifest kind is full", manifest.get("kind") == "full", str(manifest.get("kind")))
check(
    "manifest knows the total part count",
    manifest.get("parts_total") == len(downloaded),
    f"{manifest.get('parts_total')} != {len(downloaded)}",
)
check("manifest has both users", {u["username"] for u in manifest["users"]} == {admin_name, user_name})
check("manifest has document ocr_text", any(d.get("ocr_text") == ocr_text for d in manifest["documents"]))
check("manifest keeps hashed password", any(u.get("hashed_password", "").startswith("$2") for u in manifest["users"]))
check("original file inside parts", file_contents is not None and file_contents.startswith(b"Factura electrica"), str(all_names))
check("thumbnail inside parts", thumb_contents is not None and thumb_contents.startswith(b"\x89PNG"), str(all_names))

# --- seed junk that the import must remove ---
db = SessionLocal()
junk = User(username=f"junk_{suffix}", email=f"junk_{suffix}@example.com", hashed_password="x")
db.add(junk)
db.commit()
db.close()

# --- importing a non-zip payload is rejected ---
r = client.post(
    "/api/admin/backup/import", headers=HA,
    files=[("files", ("bad.zip", b"not a zip", "application/zip"))],
)
check("invalid archive rejected", r.status_code == 400, r.text)

# --- an incomplete part set must be rejected WITHOUT touching data ---
if downloaded:
    first_name, first_content = downloaded[0]
    r = client.post(
        "/api/admin/backup/import", headers=HA,
        files=[("files", (first_name, first_content, "application/zip"))],
    )
    check(
        "incomplete archive rejected",
        r.status_code == 400 and "part" in r.json().get("detail", "").lower(),
        r.text,
    )
    db = SessionLocal()
    check(
        "failed import left data alone",
        db.query(User).filter(User.username == f"junk_{suffix}").first() is not None,
    )
    db.close()

# --- admin imports ALL parts (deliberately out of order) ---
payload = [("files", (name, content, "application/zip")) for name, content in reversed(downloaded)]
r = client.post("/api/admin/backup/import", headers=HA, files=payload)
check("import succeeds", r.status_code == 200, r.text)
stats = r.json().get("imported", {})
check("import reports counts", stats.get("documents") == 1 and stats.get("users") == 2, str(stats))

# --- junk is gone, original data survived ---
db = SessionLocal()
check("junk user removed", db.query(User).filter(User.username == f"junk_{suffix}").first() is None)
restored = db.query(Document).filter(Document.id == doc_id).first()
check("document row restored", restored is not None)
check("page count restored", restored is not None and restored.page_count == 2)
check("pages restored", db.query(DocumentPage).filter(DocumentPage.document_id == doc_id).count() == 2)
check("sync folder restored", db.query(SyncFolder).filter(SyncFolder.path == f"/mnt/scan-{suffix}").count() == 1)
check("app setting restored", db.query(AppSetting).filter(AppSetting.key == f"demo_{suffix}").count() == 1)
new_path = restored.file_path if restored else None
check("file_path rewritten under uploads", new_path is not None and new_path.startswith(UPLOAD_DIR), str(new_path))
check("file exists at new path", new_path is not None and os.path.exists(new_path))
db.close()

# --- logins still work, admin token still valid ---
r = client.post("/api/auth/login", data={"username": user_name, "password": "secret123"})
check("user logs in after import", r.status_code == 200, r.text)
r = client.get("/api/auth/me", headers=HA)
check("admin session survives import", r.status_code == 200 and r.json().get("is_admin") is True, r.text)

# --- documents, folder, tags, search, file and thumbnail all work ---
r = client.get("/api/documents", headers=HU)
docs = r.json()
check("user sees restored document", len(docs) == 1 and docs[0]["id"] == str(doc_id), r.text)
if docs:
    check("folder relation restored", docs[0].get("folder") is not None and suffix in (docs[0].get("folder") or {}).get("name", ""), str(docs[0].get("folder")))
    check("tag relation restored", any(suffix in t["name"] for t in docs[0].get("tags", [])), str(docs[0].get("tags")))

r = client.get("/api/documents/search", params={"query": f"energie {suffix}"}, headers=HU)
check("search works after import", r.status_code == 200 and len(r.json()) == 1, r.text)

r = client.get(f"/api/documents/{doc_id}/file", headers=HU)
check("file download works", r.status_code == 200 and r.content.startswith(b"Factura electrica"), r.text[:100])
r = client.get(f"/api/documents/{doc_id}/thumbnail", headers=HU)
check("thumbnail works", r.status_code == 200 and r.content.startswith(b"\x89PNG"), r.text[:100])

# --- unauthenticated access ---
r = client.post("/api/admin/backup/export", json={"kind": "full"})
check("export requires auth", r.status_code == 401, r.text)
r = client.post("/api/admin/backup/import", files=[("files", ("b.zip", b"x", "application/zip"))])
check("import requires auth", r.status_code == 401, r.text)
r = client.get("/api/admin/backup/info")
check("info requires auth", r.status_code == 401, r.text)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    sys.exit(1)
print("ALL TESTS PASSED")
