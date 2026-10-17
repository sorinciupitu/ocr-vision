"""End-to-end tests for OCR retry + visible status against a live Postgres.

Runs an in-process stub vLLM server so OCR can be made to fail, succeed, or
flake (fail N times then succeed).

Run: cd backend && DATABASE_URL=postgresql://user:password@localhost:5433/ocr_db \\
       OCR_RETRY_BASE_DELAY=0.05 VLLM_URL=http://127.0.0.1:8091/v1/chat/completions \\
       ./venv/bin/python ../test_ocr_retry.py
"""
import io
import json
import os
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("DATABASE_URL", "postgresql://user:password@localhost:5433/ocr_db")
os.environ.setdefault("UPLOAD_FOLDER", "/tmp/ocr-test-uploads")
os.environ.setdefault("OCR_RETRY_BASE_DELAY", "0.05")
os.environ.setdefault("OCR_MAX_RETRIES", "3")
os.environ.setdefault("VLLM_URL", "http://127.0.0.1:8091/v1/chat/completions")

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

# ---- stub vLLM: controlled by STUB["mode"] / STUB["fail_first"] ----
STUB = {"mode": "ok", "fail_first": 0, "calls": 0, "text": "INV zebra invoice 42"}


class StubHandler(BaseHTTPRequestHandler):
    def _reply(self, code, body=b"", ctype="text/plain"):
        # Always drain the request body and declare Content-Length, otherwise
        # httpx sees truncated responses.
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length:
            self.rfile.read(length)
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_POST(self):
        STUB["calls"] += 1
        should_fail = STUB["mode"] == "fail" or (
            STUB["mode"] == "flaky" and STUB["calls"] <= STUB["fail_first"]
        )
        if should_fail:
            self._reply(500, b"stub vLLM down")
            return
        body = json.dumps({
            "choices": [{"message": {"content": STUB["text"]}}]
        }).encode()
        self._reply(200, body, "application/json")

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 8091), StubHandler)
threading.Thread(target=server.serve_forever, daemon=True).start()

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
failures = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def make_png_bytes():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buf, format="PNG")
    return buf.getvalue()


suffix = uuid.uuid4().hex[:6]
uname = f"retry_{suffix}"

r = client.post("/api/auth/register", json={
    "username": uname, "email": f"{uname}@example.com", "password": "secret123"
})
check("register user", r.status_code in (200, 201), r.text)
r = client.post("/api/auth/login", data={"username": uname, "password": "secret123"})
check("login user", r.status_code == 200, r.text)
H = {"Authorization": f"Bearer {r.json()['access_token']}"}


def upload(filename):
    files = {"file": (filename, io.BytesIO(make_png_bytes()), "image/png")}
    r = client.post("/api/documents/upload", files=files, headers=H)
    check(f"upload {filename}", r.status_code == 200, r.text)
    # The upload response is serialized before background OCR runs; read the
    # real state afterwards.
    detail = client.get(f"/api/documents/{r.json()['id']}", headers=H)
    return detail.json()


# --- 1. vLLM down: retries with backoff, then failed with visible error ---
STUB.update(mode="fail", fail_first=0, calls=0)
doc = upload(f"zz{suffix}-down.png")
check("vllm down -> failed status", doc["ocr_status"] == "failed", str(doc))
check("vllm down -> all retry attempts counted", doc["ocr_attempts"] == 3, str(doc))
check("vllm down -> error mentions attempt", "Attempt 3/3" in (doc["ocr_error"] or ""), str(doc))
check("vllm down -> error includes HTTP details", "HTTP 500" in (doc["ocr_error"] or "") and "stub vLLM down" in (doc["ocr_error"] or ""), str(doc))

r = client.get(f"/api/documents/{doc['id']}", headers=H)
check("detail exposes status fields", r.json().get("ocr_attempts") == 3 and bool(r.json().get("ocr_error")), r.text)

# --- 2. retry endpoint recovers the same document ---
STUB.update(mode="ok", calls=0)
r = client.post(f"/api/documents/{doc['id']}/retry", headers=H)
check("retry endpoint accepted", r.status_code == 200, r.text)
# The upload/retry response is serialized before the background OCR runs;
# the real outcome is read back afterwards.
r = client.get(f"/api/documents/{doc['id']}", headers=H)
check("retry succeeded -> completed", r.json()["ocr_status"] == "completed", r.text)
check("retry succeeded -> attempts reset to 1", r.json()["ocr_attempts"] == 1, r.text)
check("retry succeeded -> error cleared", r.json()["ocr_error"] is None, r.text)
check("retry succeeded -> text extracted", "zebra" in r.json().get("ocr_text", ""), r.text)

# --- 3. retry rules ---
r = client.post(f"/api/documents/{doc['id']}/retry", headers=H)
check("retry on completed rejected (409)", r.status_code == 409, r.text)

# --- 4. flaky vLLM: second attempt succeeds ---
STUB.update(mode="flaky", fail_first=1, calls=0)
doc2 = upload(f"zz{suffix}-flaky.png")
check("flaky vllm -> completed after retry", doc2["ocr_status"] == "completed", str(doc2))
check("flaky vllm -> attempts = 2", doc2["ocr_attempts"] == 2, str(doc2))
check("flaky vllm -> error cleared", doc2["ocr_error"] is None, str(doc2))

# --- 5. reprocess resets attempts and error ---
STUB.update(mode="fail", calls=0)
r = client.post(f"/api/documents/{doc2['id']}/reprocess", headers=H)
check("reprocess accepted", r.status_code == 200, r.text)
r = client.get(f"/api/documents/{doc2['id']}", headers=H)
check("reprocess with vllm down -> failed", r.json()["ocr_status"] == "failed", r.text)
check("reprocess counts attempts", r.json()["ocr_attempts"] == 3, r.text)
STUB.update(mode="ok", calls=0)
r = client.post(f"/api/documents/{doc2['id']}/reprocess", headers=H)
check("reprocess accepted (again)", r.status_code == 200, r.text)
r = client.get(f"/api/documents/{doc2['id']}", headers=H)
check("reprocess with vllm up -> completed", r.json()["ocr_status"] == "completed", r.text)

# --- 6. retry of another user's document is rejected ---
r2 = client.post("/api/auth/register", json={
    "username": f"other_{suffix}", "email": f"other_{suffix}@example.com", "password": "secret123"
})
r2 = client.post("/api/auth/login", data={"username": f"other_{suffix}", "password": "secret123"})
H2 = {"Authorization": f"Bearer {r2.json()['access_token']}"}
r = client.post(f"/api/documents/{doc['id']}/retry", headers=H2)
check("foreign retry rejected (404)", r.status_code == 404, r.text)

# --- 7. search matches filename, not only OCR text ---
STUB.update(mode="ok", calls=0, text="quarterly report body")
doc3 = upload(f"zz{suffix}-named.png")
check("doc3 completed", doc3["ocr_status"] == "completed", str(doc3))
STUB.update(text="INV zebra invoice 42")
r = client.get("/api/documents/search", params={"query": f"zz{suffix}"}, headers=H)
ids = [x["document"]["id"] for x in r.json()]
check("search matches by filename", doc3["id"] in ids, r.text)
r = client.get("/api/documents/search", params={"query": f"zz{suffix} named"}, headers=H)
ids = [x["document"]["id"] for x in r.json()]
check("search matches partial filename tokens", doc3["id"] in ids, r.text)
r = client.get("/api/documents/search", params={"query": "zebra"}, headers=H)
ids = [x["document"]["id"] for x in r.json()]
check("search still matches ocr text", doc["id"] in ids, r.text)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    sys.exit(1)
print("ALL TESTS PASSED")
