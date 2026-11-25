import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

export const config = {
  port: Number(process.env.PORT || 4100),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || path.join(ROOT_DIR, 'storage', 'websekolah.sqlite'),
  uploadDir: process.env.UPLOAD_DIR || path.join(ROOT_DIR, 'storage', 'uploads'),
  sessionSecret: process.env.SESSION_SECRET || crypto.createHash('sha256').update(ROOT_DIR + '-websekolah-secret-dev').digest('hex'),
  sessionCookieName: 'websekolah_session',
  sessionTtlMs: 8 * 60 * 60 * 1000, // 8 jam
  maxUploadBytes: 5 * 1024 * 1024, // 5 MB
  allowedMimeTypes: {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/webp': ['.webp'],
    'application/pdf': ['.pdf']
  },
  loginMaxAttempts: 5,
  loginWindowMs: 10 * 60 * 1000, // 10 menit
  contactRateLimitMax: 5,
  contactRateLimitWindowMs: 10 * 60 * 1000
};

export function nowIso() {
  return new Date().toISOString();
}

export function formatWib(isoString) {
  if (!isoString) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Asia/Jakarta'
    }).format(new Date(isoString)) + ' WIB';
  } catch {
    return isoString;
  }
}
