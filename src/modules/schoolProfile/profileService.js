import { nowIso } from '../../config/env.js';
import { AppError, cleanText } from '../../utils/http.js';
import { logAudit } from '../audit/auditService.js';

export function getPublicSchoolData(db) {
  const profiles = db.prepare('SELECT field_key, field_label, field_value FROM school_profiles ORDER BY id ASC').all();
  const profileMap = Object.fromEntries(profiles.map((p) => [p.field_key, p.field_value]));
  const settings = db.prepare('SELECT key, value FROM site_settings').all();
  const settingMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const pages = db.prepare(`
    SELECT id, title, slug, section, summary, body, updated_at
    FROM pages
    WHERE status = 'published'
    ORDER BY id ASC
  `).all();

  return { profiles, profileMap, settings: settingMap, pages };
}

export function getPublicPageBySlug(db, slug) {
  const page = db.prepare(`
    SELECT id, title, slug, section, summary, body, updated_at
    FROM pages
    WHERE slug = ? AND status = 'published'
  `).get(slug);
  if (!page) throw new AppError(404, 'NOT_FOUND', 'Halaman tidak ditemukan.');
  return page;
}

export function listAdminPages(db) {
  return db.prepare(`
    SELECT p.*, u.name AS updated_by_name
    FROM pages p LEFT JOIN users u ON u.id = p.updated_by
    ORDER BY p.id ASC
  `).all();
}

export function updatePage(db, actor, id, payload, ip) {
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(Number(id));
  if (!page) throw new AppError(404, 'NOT_FOUND', 'Halaman tidak ditemukan.');

  const title = payload.title !== undefined ? cleanText(payload.title, 200) : page.title;
  const summary = payload.summary !== undefined ? cleanText(payload.summary, 500) : page.summary;
  const body = payload.body !== undefined ? cleanText(payload.body, 40000) : page.body;
  const status = ['draft', 'published', 'archived'].includes(payload.status) ? payload.status : page.status;

  db.prepare(`
    UPDATE pages SET title = ?, summary = ?, body = ?, status = ?, updated_by = ?, updated_at = ?
    WHERE id = ?
  `).run(title, summary, body, status, actor.id, nowIso(), page.id);

  logAudit(db, {
    user: actor,
    action: 'PAGE_UPDATED',
    entityType: 'page',
    entityId: page.id,
    metadata: { slug: page.slug, status },
    ip
  });
  return db.prepare('SELECT * FROM pages WHERE id = ?').get(page.id);
}

export function updateProfiles(db, actor, items, ip) {
  if (!Array.isArray(items)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Daftar profil harus berupa array.');
  }
  const stmt = db.prepare(`
    UPDATE school_profiles SET field_value = ?, updated_by = ?, updated_at = ?
    WHERE field_key = ?
  `);
  const now = nowIso();
  for (const item of items) {
    if (!item.field_key) continue;
    stmt.run(cleanText(item.field_value, 1000), actor.id, now, cleanText(item.field_key, 80));
  }
  logAudit(db, {
    user: actor,
    action: 'SCHOOL_PROFILE_UPDATED',
    entityType: 'school_profile',
    metadata: { updated_keys: items.map((i) => i.field_key) },
    ip
  });
  return db.prepare('SELECT * FROM school_profiles ORDER BY id ASC').all();
}

export function listSiteSettings(db) {
  return db.prepare('SELECT * FROM site_settings ORDER BY key ASC').all();
}

export function updateSiteSettings(db, actor, updates, ip) {
  const stmt = db.prepare(`
    UPDATE site_settings SET value = ?, updated_by = ?, updated_at = ?
    WHERE key = ?
  `);
  const now = nowIso();
  for (const [k, v] of Object.entries(updates || {})) {
    stmt.run(cleanText(v, 1000), actor.id, now, cleanText(k, 100));
  }
  logAudit(db, {
    user: actor,
    action: 'SITE_SETTINGS_UPDATED',
    entityType: 'site_settings',
    metadata: { keys: Object.keys(updates || {}) },
    ip
  });
  return listSiteSettings(db);
}
