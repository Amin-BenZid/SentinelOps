import crypto from 'node:crypto';
import db from '../db.js';

export const authService = {
  hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  },

  login(username, password) {
    if (!db) throw new Error('Database unavailable');
    
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return null;

    const computedHash = this.hashPassword(password, user.salt);
    if (computedHash !== user.password_hash) return null;

    // Generate cryptographic session token
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        must_change_password: Boolean(user.must_change_password)
      }
    };
  },

  updateCredentials(userId, newUsername, newPassword) {
    if (!db) throw new Error('Database unavailable');

    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = this.hashPassword(newPassword, newSalt);

    db.prepare(`
      UPDATE users 
      SET username = ?, password_hash = ?, salt = ?, must_change_password = 0 
      WHERE id = ?
    `).run(newUsername.trim(), newHash, newSalt, userId);

    return { success: true };
  },

  validateToken(token) {
    if (!db || !token) return null;

    const session = db.prepare(`
      SELECT s.token, u.id, u.username, u.must_change_password 
      FROM sessions s 
      JOIN users u ON s.user_id = u.id 
      WHERE s.token = ?
    `).get(token);

    if (!session) return null;

    return {
      id: session.id,
      username: session.username,
      must_change_password: Boolean(session.must_change_password)
    };
  },

  logout(token) {
    if (!db || !token) return;
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
};