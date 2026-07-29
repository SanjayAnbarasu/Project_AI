from sqlmodel import create_engine, SQLModel, Session
import os

# 1. Try to get the Cloud Database URL from Render environment variables.
# If it doesn't exist (e.g., you are running locally), fall back to SQLite.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///system_logs.db")

# 2. Safety Fix: SQLAlchemy requires the URL to start with "postgresql://",
# but some cloud providers generate URLs starting with "postgres://".
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# 3. Configure the engine dynamically
# SQLite requires the 'check_same_thread' argument for FastAPI, but PostgreSQL will crash if you pass it.
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    # echo=True allows you to see the SQL queries in your terminal for debugging
    engine = create_engine(DATABASE_URL, echo=True, connect_args=connect_args)
else:
    # Cloud PostgreSQL Engine (Neon)
    engine = create_engine(DATABASE_URL, echo=True)

def init_db():
    """Creates the database and tables if they don't exist."""
    SQLModel.metadata.create_all(engine)

def get_session():
    """Dependency provider for database sessions."""
    with Session(engine) as session:
        yield session