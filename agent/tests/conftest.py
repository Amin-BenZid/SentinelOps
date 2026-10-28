import os
import sys

import pytest
import pytest_asyncio

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)
MIGRATIONS = os.path.join(ROOT, "shared", "migrations")

from agent.db.sqlite_client import DatabaseManager  # noqa: E402


@pytest.fixture
def migrations_dir():
    return MIGRATIONS


@pytest_asyncio.fixture
async def db(tmp_path):
    d = DatabaseManager(str(tmp_path / "test.db"))
    await d.init_db(MIGRATIONS)
    yield d
    await d.close()
