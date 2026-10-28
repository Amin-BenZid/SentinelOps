import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate, resolveMigrationsDir } from './migrate.js';
import { hashPassword } from './services/passwords.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../data/sentinelops.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 30000;');
db.exec('PRAGMA foreign_keys = ON;');

migrate(db, resolveMigrationsDir(__dirname));
db.exec('PRAGMA busy_timeout = 5000;');

// First-run admin account. Never a fixed default password:
//  - ADMIN_PASSWORD set  -> use it (the operator chose it, no forced change)
//  - otherwise           -> random password printed ONCE in the logs, forced change on first login
const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
if (count === 0) {
  const username = (process.env.ADMIN_USERNAME || 'admin').trim();
  const provided = process.env.ADMIN_PASSWORD;
  const password = provided || crypto.randomBytes(12).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO users (username, password_hash, salt, must_change_password, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run(username, hashPassword(password, salt), salt, provided ? 0 : 1, Date.now());
  if (provided) {
    console.log(`[*] Admin user "${username}" created from ADMIN_PASSWORD.`);
  } else {
    console.log('==================================================================');
    console.log(`[*] Initial admin account created`);
    console.log(`    username: ${username}`);
    console.log(`    password: ${password}`);
    console.log('    You will be asked to change it on first login.');
    console.log('==================================================================');
  }
}

console.log(`[*] SQLite ready at ${DB_PATH}`);

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export { DB_PATH };
export default db;
