import time
import logging
from sqlalchemy.exc import OperationalError
from app.database import engine, Base

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def init_db():
    retries = 5
    while retries > 0:
        try:
            logger.info("Attempting to connect to the database and create tables...")
            Base.metadata.create_all(bind=engine)
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
