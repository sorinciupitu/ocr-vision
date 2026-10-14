"""Admin-only archive backup: split export jobs and replace-all import.

Export creates a job made of independent ZIP parts of at most
settings.backup_part_size_mb (1GB by default) each, so huge archives stay
easy to download and restore:

    <prefix>.part0001.zip  part.json ({"index": 1}) + document files + manifest.json
    <prefix>.partNNNN.zip  part.json ({"index": N}) + remaining files

manifest.json is appended to part 1 once the whole set exists, so even a
single uploaded part can tell the import exactly how many parts to expect.

manifest.json describes every table and carries "kind" ("full" or
"database") plus "parts_total", so the import can verify the whole set
arrived before touching anything.

Two export kinds:
 - full:     files/<document_id>/... holds each document's original (wherever
             it lives, including sync folders) and thumbnail.
 - database: rows only (users, OCR text, metadata). The originals are
             expected to already sit in the configured upload folder (flat or
             <document_id>/ layout); the import refuses to wipe anything
             while a file that existed at export time is missing.

Import accepts one or more parts in any order, stages everything first and
runs the replace-all in ONE transaction: a corrupt, incomplete or
file-starved archive changes nothing. File paths are rewritten into the
configured upload folder and the full-text search vectors are rebuilt.
"""
import json
import os
import re
import shutil
import tempfile
import time
import traceback
import zipfile
from datetime import datetime
from typing import List, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user_media
from app.models import (
    AppSetting, Document, DocumentPage, Folder, SyncFolder, Tag, TagRule, User,
    document_tags,
)
from app.routers.admin import require_admin

router = APIRouter(prefix="/admin/backup", tags=["backup"])
settings = get_settings()

MANIFEST_VERSION = 1
JOBS_ROOT = os.path.join(tempfile.gettempdir(), "doc-archive-jobs")
JOB_MAX_AGE = 24 * 3600  # downloaded-now artifacts; keep them for a day
_CHUNK = 1024 * 1024


def require_admin_media(user: User = Depends(get_current_user_media)) -> User:
    """Admin gate for endpoints reached from a plain <a> link (the part
    download), which cannot set an Authorization header."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def _dt(value):
    return value.isoformat() if value else None


def _uid(value):
    return str(value) if value else None


class ExportRequest(BaseModel):
    kind: Literal["full", "database"] = "full"


class _PartWriter:
    """Writes a ZIP split into independent parts of at most `max_bytes`.

    Every part is a complete ZIP of its own (part.json first) so any subset
    of the byte stream can never be corrupt; rotation happens between file
    entries, so a single document larger than the limit stays whole inside
    one part instead of being cut.
    """

    def __init__(self, job_dir: str, prefix: str, max_bytes: int):
        self.job_dir = job_dir
        self.prefix = prefix
        self.max_bytes = max_bytes
        self.index = 0
        self.path = None
        self.zf = None
        self._open_next()

    def _open_next(self):
        if self.zf is not None:
            self.zf.close()
        self.index += 1
        self.path = os.path.join(self.job_dir, f"{self.prefix}.part{self.index:04d}.zip")
        self.zf = zipfile.ZipFile(self.path, "w", zipfile.ZIP_DEFLATED)
        self.zf.writestr("part.json", json.dumps({"index": self.index}))

    def add_path(self, src: str, arcname: str):
        if os.path.getsize(self.path) >= self.max_bytes:
            self._open_next()
        self.zf.write(src, arcname)

    def finish(self, manifest: dict) -> List[dict]:
        """Close the last part and append manifest.json to part 1.

        The manifest goes into part 1 (in append mode) because only at this
        point is the total part count known; keeping it in the first part
        means an incomplete selection is always detected with the exact list
        of missing parts.
        """
        if self.zf is not None:
            self.zf.close()
            self.zf = None
        payload = json.dumps(manifest)
        part1 = os.path.join(self.job_dir, f"{self.prefix}.part0001.zip")
        with zipfile.ZipFile(part1, "a") as zf:
            with zf.open("manifest.json", "w") as out:
                for i in range(0, len(payload), _CHUNK):
                    out.write(payload[i:i + _CHUNK].encode("utf-8"))
        return [
            {"name": name, "size": os.path.getsize(os.path.join(self.job_dir, name))}
            for name in sorted(os.listdir(self.job_dir))
        ]


def _prune_jobs():
    """Drop export jobs nobody downloaded within JOB_MAX_AGE."""
    if not os.path.isdir(JOBS_ROOT):
        return
    cutoff = time.time() - JOB_MAX_AGE
    for name in os.listdir(JOBS_ROOT):
        path = os.path.join(JOBS_ROOT, name)
        try:
            if os.path.getmtime(path) < cutoff:
                shutil.rmtree(path, ignore_errors=True)
        except OSError:
            pass


@router.get("/info")
def backup_info(admin: User = Depends(require_admin)):
    """What the UI needs: where files live and how big archive parts get."""
    return {"upload_folder": settings.upload_folder, "part_size_mb": settings.backup_part_size_mb}


@router.post("/export")
def create_export(
    payload: ExportRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Build a split archive job and list its downloadable parts."""
    _prune_jobs()
    job_id = uuid4().hex
    job_dir = os.path.join(JOBS_ROOT, job_id)
    try:
        os.makedirs(job_dir, exist_ok=True)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not create backup job: {e}")

    users = db.query(User).order_by(User.created_at).all()
    folders = db.query(Folder).all()
    tags = db.query(Tag).all()
    rules = db.query(TagRule).all()
    syncs = db.query(SyncFolder).all()
    settings_rows = db.query(AppSetting).all()
    docs = db.query(Document).all()
    pages = db.query(DocumentPage).all()
    doc_tags = db.execute(select(document_tags.c.document_id, document_tags.c.tag_id)).fetchall()

    manifest = {
        "version": MANIFEST_VERSION,
        "app": "doc-archive",
        "kind": payload.kind,
        "exported_at": datetime.utcnow().isoformat(),
        "users": [
            {
                "id": _uid(u.id), "username": u.username, "email": u.email,
                "hashed_password": u.hashed_password, "is_active": u.is_active,
                "is_admin": u.is_admin, "created_at": _dt(u.created_at),
            }
            for u in users
        ],
        "folders": [
            {"id": _uid(f.id), "name": f.name, "owner_id": _uid(f.owner_id), "created_at": _dt(f.created_at)}
            for f in folders
        ],
        "tags": [
            {"id": _uid(t.id), "name": t.name, "owner_id": _uid(t.owner_id), "created_at": _dt(t.created_at)}
            for t in tags
        ],
        "tag_rules": [
            {
                "id": _uid(r.id), "pattern": r.pattern, "is_active": r.is_active,
                "owner_id": _uid(r.owner_id), "tag_id": _uid(r.tag_id), "created_at": _dt(r.created_at),
            }
            for r in rules
        ],
        "sync_folders": [
            {
                "id": _uid(s.id), "path": s.path, "label": s.label, "is_active": s.is_active,
                "last_synced_at": _dt(s.last_synced_at), "owner_id": _uid(s.owner_id),
                "created_at": _dt(s.created_at),
            }
            for s in syncs
        ],
        "app_settings": [
            {"key": s.key, "value": s.value, "updated_at": _dt(s.updated_at)}
            for s in settings_rows
        ],
        "documents": [],
        "document_pages": [
            {"document_id": _uid(p.document_id), "page_number": p.page_number, "ocr_text": p.ocr_text}
            for p in pages
        ],
        "document_tags": [
            {"document_id": _uid(row.document_id), "tag_id": _uid(row.tag_id)}
            for row in doc_tags
        ],
    }

    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    max_bytes = settings.backup_part_size_mb * 1024 * 1024
    writer = _PartWriter(job_dir, f"doc-archive-backup-{stamp}", max_bytes)
    try:
        for doc in docs:
            file_ref = f"files/{doc.id}/{os.path.basename(doc.file_path)}" if doc.file_path else None
            had_file = bool(doc.file_path and os.path.exists(doc.file_path))
            thumb_ref = f"files/{doc.id}/thumb.png" if doc.thumbnail_path else None
            had_thumb = bool(doc.thumbnail_path and os.path.exists(doc.thumbnail_path))
            if payload.kind == "full":
                # Only what really exists on disk lands in the archive; the
                # manifest records availability either way.
                if had_file:
                    writer.add_path(doc.file_path, file_ref)
                if had_thumb:
                    writer.add_path(doc.thumbnail_path, thumb_ref)
            manifest["documents"].append({
                "id": _uid(doc.id), "title": doc.title, "original_filename": doc.original_filename,
                "file_type": doc.file_type, "file_size": doc.file_size, "page_count": doc.page_count,
                "ocr_text": doc.ocr_text, "ocr_status": doc.ocr_status,
                "ocr_attempts": doc.ocr_attempts, "ocr_error": doc.ocr_error,
                "folder_id": _uid(doc.folder_id), "owner_id": _uid(doc.owner_id),
                "created_at": _dt(doc.created_at), "updated_at": _dt(doc.updated_at),
                "file_ref": file_ref, "had_file": had_file,
                "thumbnail_ref": thumb_ref, "had_thumb": had_thumb,
            })
        manifest["parts_total"] = writer.index
        parts = writer.finish(manifest)
    except Exception as e:
        traceback.print_exc()
        if writer.zf is not None:
            writer.zf.close()
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Backup export failed: {e}")

    return {
        "job_id": job_id, "kind": payload.kind, "parts": parts,
        "part_size_mb": settings.backup_part_size_mb,
    }


@router.get("/export/{job_id}/{filename}")
def download_part(
    job_id: str,
    filename: str,
    admin: User = Depends(require_admin_media),
):
    """Download one part of an export job (plain <a> link, ?token= auth)."""
    if not re.fullmatch(r"[0-9a-f]{32}", job_id) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,120}", filename):
        raise HTTPException(status_code=404, detail="Backup part not found")
    path = os.path.join(JOBS_ROOT, job_id, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Backup part not found")
    return FileResponse(path, media_type="application/zip", filename=filename)


def _safe_extract(zf: zipfile.ZipFile, dest: str) -> int:
    """Extract files/, rejecting path traversal; returns number of files."""
    count = 0
    for info in zf.infolist():
        name = info.filename
        if not name.startswith("files/") or name.endswith("/"):
            continue
        rel = name[len("files/"):]
        if rel.startswith("/") or ".." in rel.split("/"):
            raise HTTPException(status_code=400, detail=f"Unsafe path in archive: {name}")
        target = os.path.join(dest, name)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out)
        count += 1
    return count


@router.post("/import")
async def import_archive(
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Replace ALL instance data with the content of exported archive parts."""
    if not files:
        raise HTTPException(status_code=400, detail="No archive parts uploaded")
    uploads = sorted(files, key=lambda f: f.filename or "")

    staging = tempfile.mkdtemp(prefix="doc-archive-import-")
    zips = []
    try:
        # Spool every part to disk in chunks; a 1GB part never sits in RAM.
        part_paths = []
        for i, upload in enumerate(uploads):
            dest = os.path.join(staging, f"upload-{i:04d}")
            with open(dest, "wb") as out:
                while True:
                    chunk = await upload.read(_CHUNK)
                    if not chunk:
                        break
                    out.write(chunk)
            part_paths.append(dest)

        # Each part must be a valid, self-describing ZIP.
        manifest_zfs = []
        indexes = []
        for path in part_paths:
            try:
                zf = zipfile.ZipFile(path)
            except zipfile.BadZipFile:
                raise HTTPException(status_code=400, detail="Not a valid ZIP archive")
            zips.append(zf)
            names = zf.namelist()
            if "manifest.json" in names:
                manifest_zfs.append(zf)
            if "part.json" in names:
                try:
                    indexes.append(int(json.loads(zf.read("part.json"))["index"]))
                except (ValueError, KeyError, json.JSONDecodeError):
                    raise HTTPException(status_code=400, detail="Invalid part.json in archive")
            else:
                indexes.append(None)

        if not any(indexes):
            # Legacy single archive without part metadata.
            if len(zips) > 1:
                raise HTTPException(status_code=400, detail="Multiple files uploaded but they carry no part metadata")
            indexes = [1]
        elif any(idx is None for idx in indexes):
            raise HTTPException(status_code=400, detail="Mixed archive parts: some lack part.json")

        if not manifest_zfs:
            if any(idx is not None for idx in indexes):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "manifest.json not found — it is stored in the first part; "
                        "select ALL exported parts and upload them together"
                    ),
                )
            raise HTTPException(status_code=400, detail="Archive has no manifest.json")
        if len(manifest_zfs) > 1:
            raise HTTPException(status_code=400, detail="Archive must contain exactly one manifest.json")
        try:
            manifest = json.loads(manifest_zfs[0].read("manifest.json"))
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="manifest.json is not valid JSON")
        if manifest.get("version") != MANIFEST_VERSION:
            raise HTTPException(status_code=400, detail=f"Unsupported archive version: {manifest.get('version')}")
        kind = manifest.get("kind", "full")
        if kind not in ("full", "database"):
            raise HTTPException(status_code=400, detail=f"Unknown archive kind: {kind}")

        # Completeness: refuse partial sets before touching anything.
        total = manifest.get("parts_total", 1)
        expected = list(range(1, total + 1))
        if sorted(indexes) != expected:
            missing = sorted(set(expected) - set(indexes))
            extra = sorted(set(indexes) - set(expected))
            detail = f"Archive is incomplete: expected {total} part(s)"
            if missing:
                detail += f", missing part(s) {missing}"
            if extra:
                detail += f", unexpected part(s) {extra}"
            raise HTTPException(status_code=400, detail=detail)

        file_dest = {}   # document id -> pre-placed original (database kind)
        thumb_dest = {}   # document id -> pre-placed thumbnail (database kind)
        file_count = 0
        if kind == "database":
            upload = settings.upload_folder
            missing_files = set()
            for d in manifest.get("documents", []):
                doc_key = str(d["id"])
                if d.get("file_ref") and d.get("had_file"):
                    base = os.path.basename(d["file_ref"])
                    found = next(
                        (c for c in (os.path.join(upload, base), os.path.join(upload, doc_key, base))
                         if os.path.isfile(c)),
                        None,
                    )
                    if found:
                        file_dest[doc_key] = found
                    else:
                        missing_files.add(base)
                if d.get("thumbnail_ref"):
                    found = next(
                        (c for c in (os.path.join(upload, "thumbnails", f"{doc_key}.png"),
                                     os.path.join(upload, doc_key, "thumb.png"))
                         if os.path.isfile(c)),
                        None,
                    )
                    if found:
                        thumb_dest[doc_key] = found
            if missing_files:
                ordered = sorted(missing_files)
                shown = ", ".join(ordered[:20]) + (f" (+{len(ordered) - 20} more)" if len(ordered) > 20 else "")
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Import blocked: {len(ordered)} original file(s) missing from "
                        f"{upload}: {shown}. Copy them into that folder and retry — "
                        "no data was changed."
                    ),
                )
        else:
            # Full archives carry their own files: stage them before the wipe
            # so a corrupt archive changes nothing.
            for zf in zips:
                file_count += _safe_extract(zf, staging)

        def _parse_dt(value):
            return datetime.fromisoformat(value) if value else None

        def _parse_uid(value):
            return UUID(value) if value else None

        try:
            # Replace-all in ONE transaction: any failure rolls back and the
            # previous data stays untouched.
            db.query(DocumentPage).delete()
            db.query(Document).delete()
            db.query(TagRule).delete()
            db.query(Tag).delete()
            db.query(Folder).delete()
            db.query(SyncFolder).delete()
            db.query(User).delete()
            db.query(AppSetting).delete()
            db.flush()

            for u in manifest.get("users", []):
                db.add(User(
                    id=_parse_uid(u["id"]), username=u["username"], email=u["email"],
                    hashed_password=u["hashed_password"], is_active=u.get("is_active", True),
                    is_admin=u.get("is_admin", False), created_at=_parse_dt(u.get("created_at")),
                ))
            for f in manifest.get("folders", []):
                db.add(Folder(
                    id=_parse_uid(f["id"]), name=f["name"], owner_id=_parse_uid(f["owner_id"]),
                    created_at=_parse_dt(f.get("created_at")),
                ))
            for t in manifest.get("tags", []):
                db.add(Tag(
                    id=_parse_uid(t["id"]), name=t["name"], owner_id=_parse_uid(t["owner_id"]),
                    created_at=_parse_dt(t.get("created_at")),
                ))
            db.flush()

            for d in manifest.get("documents", []):
                doc_key = str(d["id"])
                if kind == "database":
                    # The originals were required to be in place above; the
                    # ref stays as a placeholder when the file never existed.
                    file_path = file_dest.get(doc_key) or d.get("file_ref") or d["original_filename"]
                    thumbnail_path = thumb_dest.get(doc_key)
                else:
                    dest_dir = os.path.join(settings.upload_folder, doc_key)
                    file_path = None
                    if d.get("file_ref"):
                        staged = os.path.join(staging, d["file_ref"])
                        if os.path.exists(staged):
                            os.makedirs(dest_dir, exist_ok=True)
                            file_path = os.path.join(dest_dir, os.path.basename(d["file_ref"]))
                            shutil.copy2(staged, file_path)
                    thumbnail_path = None
                    if d.get("thumbnail_ref"):
                        staged_thumb = os.path.join(staging, d["thumbnail_ref"])
                        if os.path.exists(staged_thumb):
                            os.makedirs(dest_dir, exist_ok=True)
                            thumbnail_path = os.path.join(dest_dir, "thumb.png")
                            shutil.copy2(staged_thumb, thumbnail_path)
                db.add(Document(
                    id=_parse_uid(d["id"]), title=d["title"], original_filename=d["original_filename"],
                    file_path=file_path, file_type=d["file_type"], file_size=d.get("file_size", 0),
                    page_count=d.get("page_count", 1), ocr_text=d.get("ocr_text", ""),
                    ocr_status=d.get("ocr_status", "completed"), ocr_attempts=d.get("ocr_attempts", 0),
                    ocr_error=d.get("ocr_error"), thumbnail_path=thumbnail_path,
                    folder_id=_parse_uid(d.get("folder_id")), owner_id=_parse_uid(d["owner_id"]),
                    created_at=_parse_dt(d.get("created_at")), updated_at=_parse_dt(d.get("updated_at")),
                ))
            # Links reference documents and tags, so both must hit the DB first.
            db.flush()
            for p in manifest.get("document_pages", []):
                db.add(DocumentPage(
                    document_id=_parse_uid(p["document_id"]), page_number=p["page_number"],
                    ocr_text=p.get("ocr_text", ""),
                ))
            for link in manifest.get("document_tags", []):
                db.execute(document_tags.insert().values(
                    document_id=_parse_uid(link["document_id"]), tag_id=_parse_uid(link["tag_id"]),
                ))
            for r in manifest.get("tag_rules", []):
                db.add(TagRule(
                    id=_parse_uid(r["id"]), pattern=r["pattern"], is_active=r.get("is_active", True),
                    owner_id=_parse_uid(r["owner_id"]), tag_id=_parse_uid(r["tag_id"]),
                    created_at=_parse_dt(r.get("created_at")),
                ))
            for s in manifest.get("sync_folders", []):
                db.add(SyncFolder(
                    id=_parse_uid(s["id"]), path=s["path"], label=s.get("label"),
                    is_active=s.get("is_active", True), last_synced_at=_parse_dt(s.get("last_synced_at")),
                    owner_id=_parse_uid(s["owner_id"]), created_at=_parse_dt(s.get("created_at")),
                ))
            for a in manifest.get("app_settings", []):
                db.add(AppSetting(key=a["key"], value=a["value"], updated_at=_parse_dt(a.get("updated_at"))))
            db.commit()

            # The tsvector columns are maintained by the OCR flow; rebuild them so
            # search works immediately after a restore.
            db.execute(text(
                "UPDATE documents SET search_vector = to_tsvector('english', coalesce(ocr_text, ''))"
            ))
            db.execute(text(
                "UPDATE document_pages SET search_vector = to_tsvector('english', coalesce(ocr_text, ''))"
            ))
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            traceback.print_exc()
            raise HTTPException(status_code=400, detail="Archive could not be imported; no data was changed")

        return {"kind": kind, "imported": {
            "users": len(manifest.get("users", [])),
            "documents": len(manifest.get("documents", [])),
            "pages": len(manifest.get("document_pages", [])),
            "folders": len(manifest.get("folders", [])),
            "tags": len(manifest.get("tags", [])),
            "tag_rules": len(manifest.get("tag_rules", [])),
            "sync_folders": len(manifest.get("sync_folders", [])),
            "app_settings": len(manifest.get("app_settings", [])),
            "files": len(file_dest) if kind == "database" else file_count,
        }}
    finally:
        for zf in zips:
            try:
                zf.close()
            except Exception:
                pass
        shutil.rmtree(staging, ignore_errors=True)
