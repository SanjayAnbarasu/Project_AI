from sqlmodel import create_engine, SQLModel, Session
import os

DATABASE_FILE = "system_logs.db"
DATABASE_URL = f"sqlite:///{DATABASE_FILE}"

# echo=True allows you to see the SQL queries in your terminal for debugging
engine = create_engine(DATABASE_URL, echo=True, connect_args={"check_same_thread": False})

def init_db():
    """Creates the database and tables if they don't exist."""
    SQLModel.metadata.create_all(engine)

def get_session():
    """Dependency provider for database sessions."""
    with Session(engine) as session:
        yield session