// Versioned schema migrations (Node runner). Mirrors agent/db/migrate.py and
// reads the same shared/migrations/*.sql files, so the schema has one
// definition. BEGIN IMMEDIATE takes the write lock first, so concurrent
// startup of agent and server is safe: the second runner finds nothing to do.
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_RE = /^(\d+)_.+\.sql$/;

export function listMigrations(dir) {
  const files = fs.readdirSync(dir)
    .map((name) => ({ name, m: MIGRATION_RE.exec(name) }))
    .filter((f) => f.m)
    .map((f) => ({ version: Number(f.m[1]), name: f.name, file: path.join(dir, f.name) }))
    .sort((a, b) => a.version - b.version);
  const versions = new Set(files.map((f) => f.version));
  if (versions.size !== files.length) throw new Error(`Duplicate migration versions in ${dir}`);
  return files;
}

export function migrate(db, dir, log = console.log) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
    let current = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get().v;
    for (const m of listMigrations(dir)) {
      if (m.version <= current) continue;
      db.exec(fs.readFileSync(m.file, 'utf-8'));
      db.prepare('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, Date.now());
      log(`[migrate] applied ${m.name}`);
      current = m.version;
    }
    db.exec('COMMIT');
    return current;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function resolveMigrationsDir(baseDir) {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(baseDir, '../shared/migrations'),     // Docker image: /app/src -> /app/shared
    path.resolve(baseDir, '../../shared/migrations'),  // repo: server/src -> shared
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`Migrations directory not found (tried ${candidates.join(', ')})`);
  return found;
}
