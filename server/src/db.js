import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../data/sentinelops.db');

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

let db = null;
try {
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');

  // 1. Core Schema Tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      metric_name TEXT NOT NULL,
      operator TEXT NOT NULL,
      threshold REAL NOT NULL,
      duration_seconds INTEGER DEFAULT 60,
      severity TEXT NOT NULL,
      summary_template TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Authentication Tables
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      must_change_password INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Safe Column Migrations
  try { db.exec('ALTER TABLE rules ADD COLUMN is_active INTEGER DEFAULT 1;'); } catch (e) {}
  try { db.exec('ALTER TABLE alerts ADD COLUMN process_snapshot TEXT;'); } catch (e) {}

  // 2. Grafana Seed: Create default 'admin' / 'admin' if no users exist
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count === 0) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync('admin', salt, 100000, 64, 'sha512').toString('hex');
    db.prepare(`
      INSERT INTO users (username, password_hash, salt, must_change_password)
      VALUES (?, ?, ?, 1)
    `).run('admin', hash, salt);
    console.log('[*] Default admin user initialized (admin / admin). Password change required on first login.');
  }

  console.log(`[*] Connected and migrated SQLite database at: ${DB_PATH}`);
} catch (error) {
  console.error(`[!] Failed to initialize SQLite database:`, error.message);
}

export default db;