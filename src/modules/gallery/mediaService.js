import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, nowIso } from '../../config/env.js';
import { AppError, cleanText } from '../../utils/http.js';
import { logAudit } from '../audit/auditService.js';

function detectMagicMime(buf) {
  if (!buf || buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // WEBP: RIFF....WEBP
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  // PDF: %PDF-
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

export function listMedia(db, { category = '' } = {}) {
  if (category) {
    return db.prepare(`
      SELECT m.*, u.name AS uploader_name
      FROM media m LEFT JOIN users u ON u.id = m.uploader_id
      WHERE m.category = ?
      ORDER BY m.id DESC
    `).all(category);
  }
  return db.prepare(`
    SELECT m.*, u.name AS uploader_name
    FROM media m LEFT JOIN users u ON u.id = m.uploader_id
    ORDER BY m.id DESC
  `).all();
}

export function uploadMedia(db, actor, { file, fields, uploadDir = config.uploadDir }, ip) {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'File wajib dipilih untuk diunggah.');
  }
  if (file.buffer.length > config.maxUploadBytes) {
    throw new AppError(400, 'FILE_TOO_LARGE', 'Ukuran file melebihi batas maksimum 5 MB.');
  }

  const ext = path.extname(file.originalName || '').toLowerCase();
  const detectedMime = detectMagicMime(file.buffer);
  const allowedExts = detectedMime ? config.allowedMimeTypes[detectedMime] : null;

  if (!detectedMime || !allowedExts || !allowedExts.includes(ext)) {
    throw new AppError(
      400,
      'INVALID_FILE_TYPE',
      'Tipe file tidak diizinkan atau isi file tidak sesuai ekstensi. Hanya PNG, JPG/JPEG, WEBP, dan PDF yang diperbolehkan.'
    );
  }

  const title = cleanText(fields.title || path.basename(file.originalName, ext), 160);
  const altText = cleanText(fields.alt_text || title, 300);
  const category = cleanText(fields.category || 'Dokumentasi', 60);

  if (detectedMime.startsWith('image/') && !altText) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Alt text wajib diisi untuk aksesibilitas gambar.');
  }

  fs.mkdirSync(uploadDir, { recursive: true });
  const storageKey = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(uploadDir, storageKey), file.buffer);

  const info = db.prepare(`
    INSERT INTO media (uploader_id, title, original_name, storage_key, mime_type, size, alt_text, category, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(actor.id, title, cleanText(file.originalName, 180), storageKey, detectedMime, file.buffer.length, altText, category, nowIso());

  const created = db.prepare('SELECT * FROM media WHERE id = ?').get(Number(info.lastInsertRowid));
  logAudit(db, {
    user: actor,
    action: 'MEDIA_UPLOADED',
    entityType: 'media',
    entityId: created.id,
    metadata: { title: created.title, mime_type: created.mime_type, size: created.size },
    ip
  });
  return created;
}

export function deleteMedia(db, actor, mediaId, { uploadDir = config.uploadDir } = {}, ip) {
  const id = Number(mediaId);
  const item = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!item) throw new AppError(404, 'NOT_FOUND', 'Media tidak ditemukan.');

  db.prepare('DELETE FROM media WHERE id = ?').run(id);
  const fullPath = path.join(uploadDir, path.basename(item.storage_key));
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }

  logAudit(db, {
    user: actor,
    action: 'MEDIA_DELETED',
    entityType: 'media',
    entityId: id,
    metadata: { title: item.title, storage_key: item.storage_key },
    ip
  });
  return { deleted: true };
}
