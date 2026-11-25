import { nowIso } from '../../config/env.js';
import { AppError, cleanText } from '../../utils/http.js';
import { logAudit } from '../audit/auditService.js';

export function listPublicEvents(db) {
  return db.prepare(`
    SELECT e.id, e.title, e.description, e.start_at, e.end_at, e.location, e.organizer, e.created_at
    FROM events e
    WHERE e.status = 'published'
    ORDER BY e.start_at ASC
  `).all();
}

export function listAdminEvents(db) {
  return db.prepare(`
    SELECT e.*, u.name AS author_name
    FROM events e
    JOIN users u ON u.id = e.author_id
    ORDER BY e.start_at DESC
  `).all();
}

export function createEvent(db, actor, payload, ip) {
  const title = cleanText(payload.title, 200);
  const description = cleanText(payload.description, 4000);
  const location = cleanText(payload.location, 200);
  const organizer = cleanText(payload.organizer || 'WebSekolah', 150);
  const status = ['draft', 'published', 'archived'].includes(payload.status) ? payload.status : 'published';

  if (!title || !description || !location || !payload.start_at) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Judul, deskripsi, lokasi, dan waktu mulai agenda wajib diisi.');
  }

  const startAt = new Date(payload.start_at).toISOString();
  const endAt = payload.end_at ? new Date(payload.end_at).toISOString() : null;
  const now = nowIso();

  const info = db.prepare(`
    INSERT INTO events (author_id, title, description, start_at, end_at, location, organizer, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(actor.id, title, description, startAt, endAt, location, organizer, status, now, now);

  const created = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(info.lastInsertRowid));
  logAudit(db, {
    user: actor,
    action: 'EVENT_CREATED',
    entityType: 'event',
    entityId: created.id,
    metadata: { title: created.title },
    ip
  });
  return created;
}

export function updateEvent(db, actor, id, payload, ip) {
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(id));
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Agenda tidak ditemukan.');

  const title = payload.title !== undefined ? cleanText(payload.title, 200) : existing.title;
  const description = payload.description !== undefined ? cleanText(payload.description, 4000) : existing.description;
  const location = payload.location !== undefined ? cleanText(payload.location, 200) : existing.location;
  const organizer = payload.organizer !== undefined ? cleanText(payload.organizer, 150) : existing.organizer;
  const status = ['draft', 'published', 'archived'].includes(payload.status) ? payload.status : existing.status;
  const startAt = payload.start_at ? new Date(payload.start_at).toISOString() : existing.start_at;
  const endAt = payload.end_at === '' ? null : (payload.end_at ? new Date(payload.end_at).toISOString() : existing.end_at);

  db.prepare(`
    UPDATE events
    SET title = ?, description = ?, start_at = ?, end_at = ?, location = ?, organizer = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(title, description, startAt, endAt, location, organizer, status, nowIso(), existing.id);

  logAudit(db, {
    user: actor,
    action: 'EVENT_UPDATED',
    entityType: 'event',
    entityId: existing.id,
    metadata: { title, status },
    ip
  });
  return db.prepare('SELECT * FROM events WHERE id = ?').get(existing.id);
}
