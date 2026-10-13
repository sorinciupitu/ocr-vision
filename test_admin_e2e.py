"""End-to-end test of registration toggle + admin user management.

Uses its own database (ocr_admin_test) so the "first user becomes admin"
bootstrap is deterministic. Drop/create happens before app import.

Run: cd backend && DATABASE_URL=postgresql://user:password@localhost:5433/ocr_admin_test ./venv/bin/python ../test_admin_e2e.py
"""
import os
import sys
import uuid

DB_URL = "postgresql://user:password@localhost:5433/ocr_admin_test"

# Recreate a pristine database BEFORE importing the app (import runs init_db).
import psycopg2

conn = psycopg2.connect("postgresql://user:password@localhost:5433/postgres")
conn.autocommit = True
cur = conn.cursor()
cur.execute("DROP DATABASE IF EXISTS ocr_admin_test")
cur.execute("CREATE DATABASE ocr_admin_test")
cur.close()
conn.close()

os.environ["DATABASE_URL"] = DB_URL
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
admin_name = f"root_{suffix}"
user_name = f"plain_{suffix}"
third_name = f"third_{suffix}"

# --- registration status is public and open by default ---
r = client.get("/api/auth/registration-status")
check("public registration status", r.status_code == 200 and r.json() == {"open": True}, r.text)

# --- first user is bootstrapped as admin ---
r = client.post("/api/auth/register", json={
    "username": admin_name, "email": f"{admin_name}@example.com", "password": "secret123"
})
check("register first user", r.status_code in (200, 201), r.text)
r = client.post("/api/auth/login", data={"username": admin_name, "password": "secret123"})
check("first user login", r.status_code == 200, r.text)
admin_token = r.json()["access_token"]
HA = {"Authorization": f"Bearer {admin_token}"}
r = client.get("/api/auth/me", headers=HA)
check("first user is admin", r.status_code == 200 and r.json().get("is_admin") is True, r.text)

# --- second user is a regular user ---
r = client.post("/api/auth/register", json={
    "username": user_name, "email": f"{user_name}@example.com", "password": "secret123"
})
check("register second user", r.status_code in (200, 201), r.text)
r = client.post("/api/auth/login", data={"username": user_name, "password": "secret123"})
user_token = r.json()["access_token"]
HU = {"Authorization": f"Bearer {user_token}"}
r = client.get("/api/auth/me", headers=HU)
check("second user is not admin", r.status_code == 200 and r.json().get("is_admin") is False, r.text)

# --- regular users are locked out of admin endpoints ---
r = client.get("/api/admin/users", headers=HU)
check("regular user cannot list users", r.status_code == 403, r.text)
r = client.get("/api/admin/settings", headers=HU)
check("regular user cannot read admin settings", r.status_code == 403, r.text)
r = client.put("/api/admin/settings/registration", json={"open": False}, headers=HU)
check("regular user cannot toggle registration", r.status_code == 403, r.text)

# --- admin toggles registration off ---
r = client.get("/api/admin/settings", headers=HA)
check("admin reads settings", r.status_code == 200 and r.json() == {"open": True}, r.text)
r = client.put("/api/admin/settings/registration", json={"open": False}, headers=HA)
check("admin closes registration", r.status_code == 200 and r.json()["open"] is False, r.text)
r = client.get("/api/auth/registration-status")
check("public status reflects closed", r.json() == {"open": False}, r.text)
r = client.post("/api/auth/register", json={
    "username": third_name, "email": f"{third_name}@example.com", "password": "secret123"
})
check("register blocked while closed", r.status_code == 403 and "disabled" in r.json()["detail"].lower(), r.text)

# --- re-open and register the third user ---
r = client.put("/api/admin/settings/registration", json={"open": True}, headers=HA)
check("admin reopens registration", r.status_code == 200 and r.json()["open"] is True, r.text)
r = client.post("/api/auth/register", json={
    "username": third_name, "email": f"{third_name}@example.com", "password": "secret123"
})
check("register allowed after reopen", r.status_code in (200, 201), r.text)

# --- admin lists users ---
r = client.get("/api/admin/users", headers=HA)
check("admin lists users", r.status_code == 200, r.text)
users = r.json()
check("user list has 3 entries", len(users) == 3, r.text)
by_name = {u["username"]: u for u in users}
check("admin flagged in list", by_name.get(admin_name, {}).get("is_admin") is True, r.text)
check("regular flagged in list", by_name.get(user_name, {}).get("is_admin") is False, r.text)
user_id = by_name[user_name]["id"]
third_id = by_name[third_name]["id"]

# --- admin edits a user's profile ---
r = client.patch(f"/api/admin/users/{user_id}", json={
    "username": f"{user_name}_renamed", "email": f"renamed_{suffix}@example.com"
}, headers=HA)
check("admin renames user", r.status_code == 200 and r.json()["username"] == f"{user_name}_renamed", r.text)
r = client.post("/api/auth/login", data={"username": f"{user_name}_renamed", "password": "secret123"})
check("renamed user logs in", r.status_code == 200, r.text)
# JWTs carry the username as subject, so a rename ends old sessions: pick up
# a fresh token and use it for the deactivation checks below.
HU = {"Authorization": f"Bearer {r.json()['access_token']}"}
r = client.post("/api/auth/login", data={"username": user_name, "password": "secret123"})
check("old username no longer works", r.status_code == 401, r.text)

# --- admin resets password ---
r = client.patch(f"/api/admin/users/{user_id}", json={"password": "newpass456"}, headers=HA)
check("admin resets password", r.status_code == 200, r.text)
r = client.post("/api/auth/login", data={"username": f"{user_name}_renamed", "password": "newpass456"})
check("new password works", r.status_code == 200, r.text)

# --- admin deactivates: login and token are revoked ---
r = client.patch(f"/api/admin/users/{user_id}", json={"is_active": False}, headers=HA)
check("admin deactivates user", r.status_code == 200 and r.json()["is_active"] is False, r.text)
r = client.post("/api/auth/login", data={"username": f"{user_name}_renamed", "password": "newpass456"})
check("deactivated user cannot log in", r.status_code == 403, r.text)
r = client.get("/api/auth/me", headers=HU)
check("deactivated user's token is rejected", r.status_code == 401, r.text)
r = client.patch(f"/api/admin/users/{user_id}", json={"is_active": True}, headers=HA)
check("admin reactivates user", r.status_code == 200 and r.json()["is_active"] is True, r.text)
r = client.get("/api/auth/me", headers=HU)
check("reactivated token works again", r.status_code == 200, r.text)

# --- self-protection guards ---
me = client.get("/api/auth/me", headers=HA).json()
r = client.patch(f"/api/admin/users/{me['id']}", json={"is_admin": False}, headers=HA)
check("cannot demote self", r.status_code == 400, r.text)
r = client.patch(f"/api/admin/users/{me['id']}", json={"is_active": False}, headers=HA)
check("cannot deactivate self", r.status_code == 400, r.text)

# --- last-admin guard via another admin being demoted by... a second admin ---
# Promote third user to admin, then demote root from a *different* admin is
# impossible through self-guard only; verify promoting/demoting others works.
r = client.patch(f"/api/admin/users/{third_id}", json={"is_admin": True}, headers=HA)
check("admin promotes another user", r.status_code == 200 and r.json()["is_admin"] is True, r.text)
r = client.get("/api/admin/users", headers=HA)
admins = [u["username"] for u in r.json() if u["is_admin"]]
check("two admins exist", len(admins) == 2, r.text)

# --- conflict and missing-target errors ---
r = client.patch(f"/api/admin/users/{third_id}", json={"username": admin_name}, headers=HA)
check("duplicate username rejected", r.status_code == 409, r.text)
r = client.patch(f"/api/admin/users/{third_id}", json={"email": f"{admin_name}@example.com"}, headers=HA)
check("duplicate email rejected", r.status_code == 409, r.text)
r = client.patch("/api/admin/users/00000000-0000-0000-0000-000000000000", json={"username": "ghost"}, headers=HA)
check("missing user is 404", r.status_code == 404, r.text)
r = client.patch(f"/api/admin/users/{third_id}", json={}, headers=HA)
check("empty patch is a no-op 200", r.status_code == 200, r.text)

# --- unauthenticated access ---
r = client.get("/api/admin/users")
check("admin list requires auth", r.status_code == 401, r.text)
r = client.get("/api/auth/me")
check("me requires auth", r.status_code == 401, r.text)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    sys.exit(1)
print("ALL TESTS PASSED")
