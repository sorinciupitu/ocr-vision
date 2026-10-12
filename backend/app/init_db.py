import time
import logging
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from app.database import engine, Base

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# create_all() never alters existing tables, so upgrades for databases created
# before the folders/tags feature must be applied by hand.
MIGRATIONS = [
    """
    ALTER TABLE documents
        ADD COLUMN IF NOT EXISTS folder_id UUID
        REFERENCES folders(id) ON DELETE SET NULL
    """,
    """
    ALTER TABLE documents
        ADD COLUMN IF NOT EXISTS ocr_attempts INTEGER DEFAULT 0
    """,
    """
    ALTER TABLE documents
        ADD COLUMN IF NOT EXISTS ocr_error VARCHAR(1000)
    """,
]

def init_db():
    retries = 5
    while retries > 0:
        try:
            logger.info("Attempting to connect to the database and create tables...")
            Base.metadata.create_all(bind=engine)
            with engine.begin() as conn:
                for migration in MIGRATIONS:
                    conn.execute(text(migration))
            logger.info("Database tables created successfully.")
            return
        except OperationalError as e:
            logger.warning(f"Database not ready yet, retrying in 3 seconds... ({retries} retries left)")
            retries -= 1
            time.sleep(3)
    logger.error("Failed to connect to the database after multiple retries.")
    # We don't exit here so we can see the exact error if it crashes later, but typically you'd raise.

if __name__ == "__main__":
    init_db()
