from collections.abc import Generator
from typing import Optional

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import Settings, get_settings


class Base(DeclarativeBase):
    """Base class for SQLAlchemy ORM models."""


class DatabaseNotConfiguredError(RuntimeError):
    """Raised when the database connection URL has not been configured."""


def create_db_engine(database_url: str, echo: bool = False) -> Engine:
    """Create a SQLAlchemy engine with dialect-appropriate defaults."""
    if database_url.startswith("sqlite"):
        return create_engine(
            database_url,
            echo=echo,
            connect_args={"check_same_thread": False},
        )
    return create_engine(
        database_url,
        echo=echo,
        pool_pre_ping=True,
    )


_initial_settings = get_settings()
_initial_database_url = _initial_settings.get_database_url()

engine: Optional[Engine] = (
    create_db_engine(_initial_database_url, echo=_initial_settings.SQL_ECHO)
    if _initial_database_url
    else None
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


def get_engine() -> Engine:
    """Return the configured SQLAlchemy engine or raise if DATABASE_URL is unset."""
    global engine
    if engine is not None:
        return engine

    current_settings = Settings()
    database_url = current_settings.get_database_url()
    if not database_url:
        raise DatabaseNotConfiguredError(
            "DATABASE_URL is not configured. "
            "Set DATABASE_URL or POSTGRES_* variables in the environment or backend/.env."
        )

    engine = create_db_engine(database_url, echo=current_settings.SQL_ECHO)
    SessionLocal.configure(bind=engine)
    return engine


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a database session and closes it afterward."""
    get_engine()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

