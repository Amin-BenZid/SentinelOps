import crypto from 'node:crypto';
import db from '../db.js';
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from './passwords.js';

const HOUR = 3_600_000;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * HOUR;
const SESSION_IDLE_MS = Number(process.env.SESSION_IDLE_MINUTES || 120) * 60_000;

// Sessions are stored by SHA-256 of the token: a leaked database does not
// leak usable bearer tokens.
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const authService = {
  login(username, password) {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    // run the hash even for unknown users so timing does not reveal valid usernames
    const ok = user
      ? verifyPassword(password, user.salt, user.password_hash)
      : (hashPassword(password, 'timing-equalizer'), false);
    if (!ok) return null;

    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
                VALUES (?, ?, ?, ?, ?)`).run(sha256(token), user.id, now, now, now + SESSION_TTL_MS);
    return {
      token,
      expires_at: now + SESSION_TTL_MS,
      user: { id: user.id, username: user.username, must_change_password: Boolean(user.must_change_password) },
    };
  },

  validateToken(token) {
    if (!token || typeof token !== 'string') return null;
    const now = Date.now();
    const row = db.prepare(`
      SELECT s.token_hash, s.last_seen_at, u.id, u.username, u.must_change_password
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND s.last_seen_at > ?
    `).get(sha256(token), now, now - SESSION_IDLE_MS);
    if (!row) return null;
    if (now - row.last_seen_at > 60_000) {   // sliding idle timeout, throttled writes
      db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, row.token_hash);
    }
    return { id: row.id, username: row.username, must_change_password: Boolean(row.must_change_password) };
  },

  changeCredentials(user, { newUsername, newPassword, currentPassword }, currentToken) {
    const record = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!record) throw new AuthError(401, 'Unauthorized');
    // A forced first-login change is already proven by the fresh login; any
    // later change must re-confirm the current password.
    if (!record.must_change_password) {
      if (!currentPassword || !verifyPassword(currentPassword, record.salt, record.password_hash)) {
        throw new AuthError(403, 'Current password is incorrect');
      }
    }
    const username = String(newUsername || record.username).trim();
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
      throw new AuthError(400, 'Username must be 3-32 characters: letters, digits, . _ -');
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    }
    if (verifyPassword(newPassword, record.salt, record.password_hash)) {
      throw new AuthError(400, 'New password must be different from the current one');
    }
    const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, user.id);
    if (taken) throw new AuthError(409, 'Username already taken');

    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare(`UPDATE users SET username = ?, password_hash = ?, salt = ?, must_change_password = 0 WHERE id = ?`)
      .run(username, hashPassword(newPassword, salt), salt, user.id);
    // revoke every other session of this user
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, sha256(currentToken));
    return { username };
  },

  logout(token) {
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  },

  purgeExpired() {
    const now = Date.now();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at <= ?').run(now, now - SESSION_IDLE_MS);
  },
};

// ── brute-force protection for /auth/login ──
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES || 5);
const failures = new Map(); // ip -> [timestamps]

export const loginLimiter = {
  retryAfterSeconds(ip) {
    const now = Date.now();
    const list = (failures.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    failures.set(ip, list);
    if (list.length < MAX_FAILURES) return 0;
    return Math.ceil((list[0] + WINDOW_MS - now) / 1000);
  },
  fail(ip) {
    const list = failures.get(ip) || [];
    list.push(Date.now());
    failures.set(ip, list);
  },
  reset(ip) { failures.delete(ip); },
  _clear() { failures.clear(); },
};
