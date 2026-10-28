"""Versioned schema migrations (Python runner).

Reads shared/migrations/NNN_name.sql and applies every version greater than the
one recorded in `schema_version`, inside a single BEGIN IMMEDIATE transaction.
BEGIN IMMEDIATE takes SQLite's write lock up front, so if the server's runner
(server/src/migrate.js) starts at the same moment, one waits for the other and
then sees the migrations already applied. Both runners share the same files,
so the schema has exactly one definition.
"""
from __future__ import annotations

import os
import re
import sqlite3
import time

_MIGRATION_RE = re.compile(r"^(\d+)_.+\.sql$")


def list_migrations(migrations_dir: str) -> list[tuple[int, str, str]]:
    found = []
    for name in sorted(os.listdir(migrations_dir)):
        m = _MIGRATION_RE.match(name)
        if m:
            found.append((int(m.group(1)), name, os.path.join(migrations_dir, name)))
    versions = [v for v, _, _ in found]
    if len(versions) != len(set(versions)):
        raise RuntimeError(f"Duplicate migration versions in {migrations_dir}")
    return sorted(found)


def _split_statements(sql: str) -> list[str]:
    """Split a script into statements without using executescript (which would
    COMMIT our open transaction)."""
    statements, buf = [], ""
    for line in sql.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            stmt = buf.strip()
            if stmt and not all(l.strip().startswith("--") or not l.strip() for l in stmt.splitlines()):
                statements.append(stmt)
            buf = ""
    if buf.strip() and not all(l.strip().startswith("--") or not l.strip() for l in buf.splitlines()):
        raise ValueError(f"Incomplete SQL statement at end of migration: {buf[:80]!r}")
    return statements


def migrate(db_path: str, migrations_dir: str, log=print) -> int:
    """Apply pending migrations. Returns the resulting schema version."""
    if os.path.dirname(db_path):
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30, isolation_level=None)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_version ("
                " version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)"
            )
            current = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version").fetchone()[0]
            for version, name, path in list_migrations(migrations_dir):
                if version <= current:
                    continue
                with open(path, encoding="utf-8") as f:
                    for stmt in _split_statements(f.read()):
                        conn.execute(stmt)
                conn.execute(
                    "INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)",
                    (version, name, int(time.time() * 1000)),
                )
                log(f"[migrate] applied {name}")
                current = version
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        return current
    finally:
        conn.close()


def latest_version(migrations_dir: str) -> int:
    migrations = list_migrations(migrations_dir)
    return migrations[-1][0] if migrations else 0
