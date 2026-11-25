import { nowIso } from '../../config/env.js';

export function logAudit(db, { user = null, actorEmail = null, action, entityType, entityId = null, metadata = {}, ip = '' }) {
  const safeMeta = { ...metadata };
  delete safeMeta.password;
  delete safeMeta.password_hash;
  delete safeMeta.csrf_token;

  db.prepare(`
    INSERT INTO audit_logs (user_id, actor_email, action, entity_type, entity_id, metadata, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user ? user.id : null,
    user ? user.email : (actorEmail || 'system'),
    action,
    entityType,
    entityId !== null && entityId !== undefined ? String(entityId) : null,
    JSON.stringify(safeMeta),
    ip || '',
    nowIso()
  );
}

export function listAuditLogs(db, { limit = 50, offset = 0, action = '', entityType = '' } = {}) {
  const conditions = [];
  const params = [];
  if (action) {
    conditions.push('a.action = ?');
    params.push(action);
  }
  if (entityType) {
    conditions.push('a.entity_type = ?');
    params.push(entityType);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT a.*, u.name AS actor_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    ${where}
    ORDER BY a.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, Math.min(Number(limit) || 50, 200), Number(offset) || 0);

  const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_logs a ${where}`).get(...params).count;
  return {
    items: rows.map((r) => ({
      ...r,
      metadata: (() => {
        try { return JSON.parse(r.metadata || '{}'); } catch { return {}; }
      })()
    })),
    total
  };
}

export function getSummaryReport(db) {
  const postStats = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM posts
    GROUP BY status
  `).all();

  const postsByUser = db.prepare(`
    SELECT u.id, u.name, u.email, r.display_name AS role_display_name, COUNT(p.id) AS post_count
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN posts p ON p.author_id = u.id
    GROUP BY u.id
    ORDER BY post_count DESC, u.id ASC
  `).all();

  const userStats = db.prepare(`
    SELECT r.name AS role_name, r.display_name, COUNT(u.id) AS count
    FROM roles r
    LEFT JOIN users u ON u.role_id = r.id
    GROUP BY r.id
    ORDER BY r.id
  `).all();

  const announcementsActive = db.prepare(`
    SELECT COUNT(*) AS count FROM announcements WHERE status = 'published'
  `).get().count;

  const eventsUpcoming = db.prepare(`
    SELECT COUNT(*) AS count FROM events WHERE status = 'published' AND start_at >= ?
  `).get(nowIso()).count;

  const mediaCount = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS total_bytes FROM media').get();
  const contactStats = db.prepare('SELECT status, COUNT(*) AS count FROM contact_messages GROUP BY status').all();

  return {
    postsByStatus: Object.fromEntries(postStats.map((r) => [r.status, r.count])),
    postsByUser,
    usersByRole: userStats,
    announcementsActive,
    eventsUpcoming,
    mediaCount: mediaCount.count,
    mediaTotalBytes: mediaCount.total_bytes,
    contactByStatus: Object.fromEntries(contactStats.map((r) => [r.status, r.count]))
  };
}
