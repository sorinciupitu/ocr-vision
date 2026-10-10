import subprocess
import time
import sys

def test_uvicorn_starts():
    print("Testing if Uvicorn can load the app...")
    process = subprocess.Popen(["./backend/venv/bin/uvicorn", "app.main:app", "--app-dir", "backend", "--port", "8099"])
    time.sleep(3)
    
    ret = process.poll()
    if ret is not None:
        print(f"Server crashed with return code {ret}")
        sys.exit(1)

    print("Server is running.")
    process.terminate()

test_uvicorn_starts()
