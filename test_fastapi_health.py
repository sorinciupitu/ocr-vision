import subprocess
import time
import urllib.request
import sys

def test_uvicorn_health():
    print("Testing if Uvicorn can serve /health...")
    process = subprocess.Popen(["./backend/venv/bin/uvicorn", "app.main:app", "--app-dir", "backend", "--port", "8099"])
    time.sleep(3) # allow startup
    
    try:
        response = urllib.request.urlopen("http://localhost:8099/health")
        data = response.read().decode('utf-8')
        print(f"Health check passed: {data}")
    except Exception as e:
        print(f"Health check failed: {e}")
        process.terminate()
        sys.exit(1)

    process.terminate()

test_uvicorn_health()
