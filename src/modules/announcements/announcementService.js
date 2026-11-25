import { nowIso } from '../../config/env.js';
import { AppError, cleanText } from '../../utils/http.js';
import { logAudit } from '../audit/auditService.js';

export function listPublicAnnouncements(db) {
  const now = nowIso();
  return db.prepare(`
    SELECT a.id, a.title, a.body, a.priority, a.start_at, a.end_at, a.created_at,
           u.name AS author_name
    FROM announcements a
    JOIN users u ON u.id = a.author_id
    WHERE a.status = 'published'
      AND a.start_at <= ?
      AND (a.end_at IS NULL OR a.end_at = '' OR a.end_at >= ?)
    ORDER BY
      CASE a.priority WHEN 'mendesak' THEN 1 WHEN 'penting' THEN 2 ELSE 3 END,
      a.start_at DESC
  `).all(now, now);
}

export function listAdminAnnouncements(db) {
  return db.prepare(`
    SELECT a.*, u.name AS author_name
    FROM announcements a
    JOIN users u ON u.id = a.author_id
    ORDER BY a.created_at DESC
  `).all();
}

export function createAnnouncement(db, actor, payload, ip) {
  const title = cleanText(payload.title, 200);
  const body = cleanText(payload.body, 5000);
  const priority = ['normal', 'penting', 'mendesak'].includes(payload.priority) ? payload.priority : 'normal';
  const status = ['draft', 'published', 'archived'].includes(payload.status) ? payload.status : 'published';
  const startAt = payload.start_at ? new Date(payload.start_at).toISOString() : nowIso();
  const endAt = payload.end_at ? new Date(payload.end_at).toISOString() : null;

  if (!title || title.length < 4 || !body) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Judul dan isi pengumuman wajib diisi.');
  }
  if (endAt && endAt < startAt) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Tanggal berakhir harus setelah tanggal mulai.');
  }

  const now = nowIso();
  const info = db.prepare(`
    INSERT INTO announcements (author_id, title, body, priority, start_at, end_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(actor.id, title, body, priority, startAt, endAt, status, now, now);

  const created = db.prepare('SELECT * FROM announcements WHERE id = ?').get(Number(info.lastInsertRowid));
  logAudit(db, {
    user: actor,
    action: 'ANNOUNCEMENT_CREATED',
    entityType: 'announcement',
    entityId: created.id,
    metadata: { title: created.title, status: created.status },
    ip
  });
  return created;
}

export function updateAnnouncement(db, actor, id, payload, ip) {
  const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(Number(id));
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Pengumuman tidak ditemukan.');

  const title = payload.title !== undefined ? cleanText(payload.title, 200) : existing.title;
  const body = payload.body !== undefined ? cleanText(payload.body, 5000) : existing.body;
  const priority = ['normal', 'penting', 'mendesak'].includes(payload.priority) ? payload.priority : existing.priority;
  const status = ['draft', 'published', 'archived'].includes(payload.status) ? payload.status : existing.status;
  const startAt = payload.start_at ? new Date(payload.start_at).toISOString() : existing.start_at;
  const endAt = payload.end_at === '' ? null : (payload.end_at ? new Date(payload.end_at).toISOString() : existing.end_at);

  db.prepare(`
    UPDATE announcements
    SET title = ?, body = ?, priority = ?, start_at = ?, end_at = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(title, body, priority, startAt, endAt, status, nowIso(), existing.id);

  logAudit(db, {
    user: actor,
    action: 'ANNOUNCEMENT_UPDATED',
    entityType: 'announcement',
    entityId: existing.id,
    metadata: { title, status },
    ip
  });
  return db.prepare('SELECT * FROM announcements WHERE id = ?').get(existing.id);
}
