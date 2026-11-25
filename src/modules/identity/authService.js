import crypto from 'node:crypto';
import { config, nowIso } from '../../config/env.js';
import { AppError, parseCookies, validateEmail } from '../../utils/http.js';
import { verifyPassword } from './password.js';
import { logAudit } from '../audit/auditService.js';

const loginAttempts = new Map();

function signSessionId(sessionId) {
  const sig = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(sessionId)
    .digest('hex');
  return `${sessionId}.${sig}`;
}

function verifySignedSessionId(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const idx = cookieValue.lastIndexOf('.');
  if (idx === -1) return null;
  const sessionId = cookieValue.slice(0, idx);
  const sig = cookieValue.slice(idx + 1);
  const expected = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(sessionId)
    .digest('hex');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  return sessionId;
}

export function checkLoginRateLimit(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry) return;
  if (now - entry.firstAttemptAt > config.loginWindowMs) {
    loginAttempts.delete(key);
    return;
  }
  if (entry.count >= config.loginMaxAttempts) {
    throw new AppError(
      429,
      'TOO_MANY_LOGIN_ATTEMPTS',
      'Terlalu banyak percobaan login gagal. Silakan tunggu beberapa menit sebelum mencoba lagi.'
    );
  }
}

function recordFailedLogin(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAttemptAt > config.loginWindowMs) {
    loginAttempts.set(key, { count: 1, firstAttemptAt: now });
  } else {
    entry.count += 1;
  }
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

export function resetRateLimiters() {
  loginAttempts.clear();
}

export function getUserWithPermissions(db, userId) {
  const user = db.prepare(`
    SELECT u.id, u.name, u.email, u.unit, u.status, u.last_login_at, u.created_at,
           r.id AS role_id, r.name AS role_name, r.display_name AS role_display_name
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(userId);
  if (!user) return null;

  const perms = db.prepare(`
    SELECT p.code
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ?
  `).all(user.role_id);

  user.permissions = perms.map((p) => p.code);
  return user;
}

export function login(db, { email, password, ip, userAgent }) {
  const normalizedEmail = validateEmail(email);
  if (!normalizedEmail || !password) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Email dan password wajib diisi.');
  }

  const throttleKey = `${ip}:${normalizedEmail}`;
  checkLoginRateLimit(throttleKey);

  const row = db.prepare(`
    SELECT u.*, r.name AS role_name, r.display_name AS role_display_name
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.email = ?
  `).get(normalizedEmail);

  if (!row || !verifyPassword(String(password), row.password_hash)) {
    recordFailedLogin(throttleKey);
    logAudit(db, {
      actorEmail: normalizedEmail,
      action: 'LOGIN_FAILED',
      entityType: 'auth',
      metadata: { reason: 'invalid_credentials' },
      ip
    });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email atau password tidak sesuai.');
  }

  if (row.status !== 'active') {
    logAudit(db, {
      user: { id: row.id, email: row.email },
      action: 'LOGIN_BLOCKED_INACTIVE',
      entityType: 'auth',
      entityId: row.id,
      ip
    });
    throw new AppError(403, 'ACCOUNT_INACTIVE', 'Akun Anda sedang dinonaktifkan. Hubungi Super Admin sekolah.');
  }

  clearLoginAttempts(throttleKey);

  // Session rotation: generate fresh session ID and CSRF token
  const sessionId = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const now = nowIso();
  const expiresAt = new Date(Date.now() + config.sessionTtlMs).toISOString();

  db.prepare(`
    INSERT INTO sessions (id, user_id, csrf_token, expires_at, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, row.id, csrfToken, expiresAt, ip || '', String(userAgent || '').slice(0, 250), now);

  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, row.id);

  const user = getUserWithPermissions(db, row.id);

  logAudit(db, {
    user,
    action: 'LOGIN_SUCCESS',
    entityType: 'auth',
    entityId: user.id,
    metadata: { role: user.role_name },
    ip
  });

  const cookieParts = [
    `${config.sessionCookieName}=${encodeURIComponent(signSessionId(sessionId))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(config.sessionTtlMs / 1000)}`
  ];
  if (config.nodeEnv === 'production') {
    cookieParts.push('Secure');
  }

  return {
    user,
    csrfToken,
    setCookieHeader: cookieParts.join('; ')
  };
}

export function authenticateRequest(req, db) {
  const cookies = parseCookies(req);
  const rawCookie = cookies[config.sessionCookieName];
  const sessionId = verifySignedSessionId(rawCookie);
  if (!sessionId) return null;

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return null;

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }

  const user = getUserWithPermissions(db, session.user_id);
  if (!user || user.status !== 'active') {
    // Immediate revocation when deactivated (UAT-08)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(session.user_id);
    return null;
  }

  return {
    sessionId: session.id,
    csrfToken: session.csrf_token,
    user
  };
}

export function logout(db, authContext, ip) {
  if (authContext?.sessionId) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(authContext.sessionId);
    logAudit(db, {
      user: authContext.user,
      action: 'LOGOUT',
      entityType: 'auth',
      entityId: authContext.user.id,
      ip
    });
  }
  return `${config.sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function requireAuth(authContext) {
  if (!authContext || !authContext.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Autentikasi diperlukan untuk mengakses fitur ini.');
  }
  return authContext;
}

export function requireCsrf(req, authContext) {
  const headerToken = req.headers['x-csrf-token'];
  if (!headerToken || !authContext?.csrfToken) {
    throw new AppError(403, 'CSRF_INVALID', 'Token CSRF tidak valid atau hilang.');
  }
  const a = Buffer.from(String(headerToken));
  const b = Buffer.from(String(authContext.csrfToken));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError(403, 'CSRF_INVALID', 'Token CSRF tidak sesuai.');
  }
}

export function requirePermission(authContext, permissionCode) {
  requireAuth(authContext);
  if (!authContext.user.permissions.includes(permissionCode)) {
    throw new AppError(
      403,
      'FORBIDDEN',
      `Akses ditolak. Peran "${authContext.user.role_display_name}" tidak memiliki izin "${permissionCode}".`
    );
  }
}

export function requireAnyPermission(authContext, permissionCodes) {
  requireAuth(authContext);
  const ok = permissionCodes.some((code) => authContext.user.permissions.includes(code));
  if (!ok) {
    throw new AppError(
      403,
      'FORBIDDEN',
      `Akses ditolak. Anda tidak memiliki kewenangan pada modul ini.`
    );
  }
}
