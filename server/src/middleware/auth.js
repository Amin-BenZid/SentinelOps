import { authService } from '../services/auth.js';

// Routes reachable without a session. Everything else under /api is denied
// by default.
const PUBLIC = new Set(['POST /auth/login', 'GET /health']);

// Routes a user who still has to change the initial password may call.
const ONBOARDING = new Set(['GET /auth/me', 'POST /auth/change-credentials', 'POST /auth/logout']);

export function bearerToken(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(h);
  return m ? m[1] : null;
}

export function requireAuth(req, res, next) {
  const key = `${req.method} ${req.path}`;
  if (PUBLIC.has(key)) return next();

  const token = bearerToken(req);
  const user = authService.validateToken(token);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  if (user.must_change_password && !ONBOARDING.has(key)) {
    return res.status(403).json({ error: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  req.user = user;
  req.token = token;
  next();
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; " +
    "font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
  next();
}
