import { config, nowIso } from '../../config/env.js';
import { AppError, cleanText, validateEmail } from '../../utils/http.js';
import { logAudit } from '../audit/auditService.js';

const contactHits = new Map();

export function resetContactLimiter() {
  contactHits.clear();
}

function checkContactRateLimit(ip) {
  const now = Date.now();
  const entry = contactHits.get(ip);
  if (!entry || now - entry.start > config.contactRateLimitWindowMs) {
    contactHits.set(ip, { count: 1, start: now });
    return;
  }
  entry.count += 1;
  if (entry.count > config.contactRateLimitMax) {
    throw new AppError(429, 'RATE_LIMITED', 'Terlalu banyak pengiriman pesan dalam waktu singkat. Silakan coba lagi nanti.');
  }
}

export function submitPublicContact(db, payload, ip) {
  // Honeypot anti-spam field
  if (payload.website && String(payload.website).trim() !== '') {
    throw new AppError(400, 'SPAM_DETECTED', 'Permintaan ditolak oleh sistem perlindungan spam.');
  }

  checkContactRateLimit(ip);

  const name = cleanText(payload.name, 120);
  const email = validateEmail(payload.email);
  const phone = cleanText(payload.phone || '', 40);
  const subject = cleanText(payload.subject, 180);
  const message = cleanText(payload.message, 4000);

  if (!name || name.length < 2) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Nama pengirim wajib diisi.');
  }
  if (!email) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Alamat email tidak valid.');
  }
  if (!subject || subject.length < 4) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Subjek pesan minimal 4 karakter.');
  }
  if (!message || message.length < 10) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Isi pesan minimal 10 karakter.');
  }

  const now = nowIso();
  const info = db.prepare(`
    INSERT INTO contact_messages (name, email, phone, subject, message, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'new', ?, ?)
  `).run(name, email, phone, subject, message, now, now);

  const ticketId = Number(info.lastInsertRowid);
  const ackRow = db.prepare("SELECT value FROM site_settings WHERE key = 'contact_auto_ack_message'").get();

  logAudit(db, {
    actorEmail: email,
    action: 'CONTACT_SUBMITTED',
    entityType: 'contact_message',
    entityId: ticketId,
    metadata: { subject },
    ip
  });

  return {
    id: ticketId,
    confirmation: ackRow?.value || 'Permintaan informasi Anda telah berhasil dikirim.'
  };
}

export function listAdminContacts(db, { status = '' } = {}) {
  const where = status ? 'WHERE c.status = ?' : '';
  const params = status ? [status] : [];
  return db.prepare(`
    SELECT c.*, u.name AS assigned_name
    FROM contact_messages c
    LEFT JOIN users u ON u.id = c.assigned_to
    ${where}
    ORDER BY
      CASE c.status WHEN 'new' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
      c.id DESC
  `).all(...params);
}

export function updateContactStatus(db, actor, id, payload, ip) {
  const msg = db.prepare('SELECT * FROM contact_messages WHERE id = ?').get(Number(id));
  if (!msg) throw new AppError(404, 'NOT_FOUND', 'Pesan tidak ditemukan.');

  const status = ['new', 'in_progress', 'resolved'].includes(payload.status) ? payload.status : msg.status;
  const assignedTo = payload.assigned_to !== undefined
    ? (payload.assigned_to ? Number(payload.assigned_to) : null)
    : msg.assigned_to;
  const responseNotes = payload.response_notes !== undefined
    ? cleanText(payload.response_notes, 2000)
    : msg.response_notes;

  db.prepare(`
    UPDATE contact_messages
    SET status = ?, assigned_to = ?, response_notes = ?, updated_at = ?
    WHERE id = ?
  `).run(status, assignedTo, responseNotes, nowIso(), msg.id);

  logAudit(db, {
    user: actor,
    action: 'CONTACT_UPDATED',
    entityType: 'contact_message',
    entityId: msg.id,
    metadata: { status, assigned_to: assignedTo },
    ip
  });

  return db.prepare('SELECT * FROM contact_messages WHERE id = ?').get(msg.id);
}
