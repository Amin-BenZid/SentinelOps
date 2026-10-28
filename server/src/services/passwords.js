import crypto from 'node:crypto';

const ITERATIONS = 100_000;
const KEYLEN = 64;

export function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, 'sha512').toString('hex');
}

export function verifyPassword(password, salt, expectedHex) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export const MIN_PASSWORD_LENGTH = 8;
