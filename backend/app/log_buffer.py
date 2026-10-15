"""Small in-process log buffer exposed to administrators for fast debugging."""
from collections import deque
from datetime import datetime, timezone
import logging
import threading


class LogBufferHandler(logging.Handler):
    def __init__(self, max_records=500):
        super().__init__()
        self.records = deque(maxlen=max_records)
        self._lock = threading.Lock()

    def emit(self, record):
        try:
            item = {
                "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
                "level": record.levelname,
                "logger": record.name,
                "message": self.format(record),
            }
            with self._lock:
                self.records.append(item)
        except Exception:
            self.handleError(record)

    def snapshot(self, limit=200):
        with self._lock:
            return list(self.records)[-limit:]

    def clear(self):
        with self._lock:
            self.records.clear()


log_buffer = LogBufferHandler()
log_buffer.setFormatter(logging.Formatter("%(message)s"))


def install_log_buffer():
    root = logging.getLogger()
    if log_buffer not in root.handlers:
        root.addHandler(log_buffer)
    root.setLevel(logging.INFO)
