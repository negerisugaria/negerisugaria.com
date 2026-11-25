import { nowIso } from '../../config/env.js';
import { AppError, cleanText, slugify } from '../../utils/http.js';
import { logAudit } from '../audit/auditService.js';

export const VALID_TRANSITIONS = {
  draft: ['submitted', 'archived'],
  submitted: ['in_review', 'revision_required', 'approved', 'published', 'scheduled'],
  in_review: ['revision_required', 'approved', 'published', 'scheduled'],
  revision_required: ['submitted', 'archived'],
  approved: ['scheduled', 'published', 'archived'],
  scheduled: ['published', 'archived', 'draft'],
  published: ['archived', 'draft'],
  archived: ['draft']
};

export function publishDueScheduledPosts(db) {
  const now = nowIso();
  const due = db.prepare(`
    SELECT id, title FROM posts
    WHERE status = 'scheduled' AND published_at IS NOT NULL AND published_at <= ?
  `).all(now);

  if (due.length === 0) return 0;
  const upd = db.prepare(`UPDATE posts SET status = 'published', updated_at = ? WHERE id = ?`);
  for (const row of due) {
    upd.run(now, row.id);
    logAudit(db, {
      actorEmail: 'scheduler',
      action: 'POST_AUTO_PUBLISHED',
      entityType: 'post',
      entityId: row.id,
      metadata: { title: row.title }
    });
  }
  return due.length;
}

export function listCategories(db) {
  return db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status = 'published') AS published_count
    FROM categories c
    ORDER BY c.name ASC
  `).all();
}

export function createCategory(db, actor, payload, ip) {
  const name = cleanText(payload.name, 80);
  if (!name || name.length < 2) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Nama kategori minimal 2 karakter.');
  }
  const slug = slugify(payload.slug || name);
  const exists = db.prepare('SELECT id FROM categories WHERE slug = ? OR name = ?').get(slug, name);
  if (exists) {
    throw new AppError(409, 'DUPLICATE', 'Kategori sudah ada.');
  }
  const info = db.prepare('INSERT INTO categories (name, slug, description, created_at) VALUES (?, ?, ?, ?)')
    .run(name, slug, cleanText(payload.description, 300), nowIso());
  const created = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(info.lastInsertRowid));
  logAudit(db, { user: actor, action: 'CATEGORY_CREATED', entityType: 'category', entityId: created.id, metadata: { name }, ip });
  return created;
}

export function listPublicPosts(db, { search = '', category = '', featured = '', limit = 12, offset = 0 } = {}) {
  publishDueScheduledPosts(db);
  const conditions = [`p.status = 'published'`];
  const params = [];

  if (search) {
    conditions.push(`(p.title LIKE ? OR p.excerpt LIKE ? OR p.body LIKE ?)`);
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  if (category) {
    conditions.push(`c.slug = ?`);
    params.push(category);
  }
  if (featured === '1' || featured === 'true') {
    conditions.push(`p.is_featured = 1`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT p.id, p.title, p.slug, p.excerpt, p.is_featured, p.published_at, p.created_at,
           c.name AS category_name, c.slug AS category_slug,
           u.name AS author_name, u.unit AS author_unit,
           m.storage_key AS cover_storage_key, m.alt_text AS cover_alt_text
    FROM posts p
    JOIN categories c ON c.id = p.category_id
    JOIN users u ON u.id = p.author_id
    LEFT JOIN media m ON m.id = p.cover_media_id
    ${where}
    ORDER BY p.is_featured DESC, p.published_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Math.min(Number(limit) || 12, 50), Number(offset) || 0);

  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM posts p JOIN categories c ON c.id = p.category_id
    ${where}
  `).get(...params).count;

  return { items: rows, total };
}

export function getPublicPostBySlug(db, slug) {
  publishDueScheduledPosts(db);
  const post = db.prepare(`
    SELECT p.id, p.title, p.slug, p.excerpt, p.body, p.is_featured, p.published_at, p.created_at, p.updated_at,
           c.name AS category_name, c.slug AS category_slug,
           u.name AS author_name, u.unit AS author_unit,
           m.storage_key AS cover_storage_key, m.alt_text AS cover_alt_text, m.title AS cover_title
    FROM posts p
    JOIN categories c ON c.id = p.category_id
    JOIN users u ON u.id = p.author_id
    LEFT JOIN media m ON m.id = p.cover_media_id
    WHERE p.slug = ? AND p.status = 'published'
  `).get(slug);

  if (!post) {
    throw new AppError(404, 'NOT_FOUND', 'Berita tidak ditemukan atau belum dipublikasikan.');
  }
  return post;
}

export function listAdminPosts(db, actor, { status = '', search = '' } = {}) {
  publishDueScheduledPosts(db);
  const conditions = [];
  const params = [];

  const isManager = actor.permissions.includes('content.manage') || actor.permissions.includes('content.review');
  if (!isManager) {
    conditions.push('p.author_id = ?');
    params.push(actor.id);
  }
  if (status) {
    conditions.push('p.status = ?');
    params.push(status);
  }
  if (search) {
    conditions.push('(p.title LIKE ? OR p.excerpt LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const items = db.prepare(`
    SELECT p.*, c.name AS category_name, u.name AS author_name, u.unit AS author_unit,
           m.storage_key AS cover_storage_key
    FROM posts p
    JOIN categories c ON c.id = p.category_id
    JOIN users u ON u.id = p.author_id
    LEFT JOIN media m ON m.id = p.cover_media_id
    ${where}
    ORDER BY p.updated_at DESC
  `).all(...params);

  const reviewStmt = db.prepare(`
    SELECT pr.*, u.name AS reviewer_name, r.display_name AS reviewer_role
    FROM post_reviews pr
    JOIN users u ON u.id = pr.reviewer_id
    JOIN roles r ON r.id = u.role_id
    WHERE pr.post_id = ?
    ORDER BY pr.id DESC
  `);

  return items.map((item) => ({
    ...item,
    reviews: reviewStmt.all(item.id)
  }));
}

function ensureUniqueSlug(db, baseSlug, ignoreId = null) {
  let candidate = baseSlug;
  let counter = 1;
  while (true) {
    const row = ignoreId
      ? db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').get(candidate, ignoreId)
      : db.prepare('SELECT id FROM posts WHERE slug = ?').get(candidate);
    if (!row) return candidate;
    counter += 1;
    candidate = `${baseSlug}-${counter}`;
  }
}

export function createPost(db, actor, payload, ip) {
  const title = cleanText(payload.title, 200);
  const body = cleanText(payload.body, 40000);
  const excerpt = cleanText(payload.excerpt, 500) || body.slice(0, 180);
  const categoryId = Number(payload.category_id);

  if (!title || title.length < 5) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Judul berita minimal 5 karakter.');
  }
  if (!body || body.length < 20) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Isi berita minimal 20 karakter.');
  }
  const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
  if (!cat) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Kategori tidak valid.');
  }

  let coverMediaId = payload.cover_media_id ? Number(payload.cover_media_id) : null;
  if (coverMediaId) {
    const m = db.prepare('SELECT id FROM media WHERE id = ?').get(coverMediaId);
    if (!m) coverMediaId = null;
  }

  const slug = ensureUniqueSlug(db, slugify(payload.slug || title));
  const now = nowIso();
  const isFeatured = payload.is_featured ? 1 : 0;
  const requiresPrincipal = payload.requires_principal_approval ? 1 : 0;

  let initialStatus = 'draft';
  let publishedAt = null;
  if (payload.submit_immediately) {
    initialStatus = 'submitted';
  } else if (payload.status === 'published' && actor.permissions.includes('content.publish') && !requiresPrincipal) {
    initialStatus = 'published';
    publishedAt = now;
  }

  const info = db.prepare(`
    INSERT INTO posts (author_id, category_id, title, slug, excerpt, body, cover_media_id, is_featured, requires_principal_approval, status, published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(actor.id, categoryId, title, slug, excerpt, body, coverMediaId, isFeatured, requiresPrincipal, initialStatus, publishedAt, now, now);

  const postId = Number(info.lastInsertRowid);
  const created = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);

  logAudit(db, {
    user: actor,
    action: 'POST_CREATED',
    entityType: 'post',
    entityId: postId,
    metadata: { title: created.title, status: created.status },
    ip
  });

  return created;
}

export function updatePost(db, actor, postId, payload, ip) {
  const id = Number(postId);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!post) throw new AppError(404, 'NOT_FOUND', 'Berita tidak ditemukan.');

  const isManager = actor.permissions.includes('content.manage') || actor.permissions.includes('content.review');
  if (!isManager && post.author_id !== actor.id) {
    throw new AppError(403, 'FORBIDDEN', 'Anda hanya dapat mengubah draf milik Anda sendiri.');
  }
  if (!isManager && !['draft', 'revision_required'].includes(post.status)) {
    throw new AppError(400, 'LOCKED_STATUS', 'Konten yang sedang ditinjau atau sudah terbit tidak dapat diubah kontributor.');
  }

  const title = payload.title !== undefined ? cleanText(payload.title, 200) : post.title;
  const body = payload.body !== undefined ? cleanText(payload.body, 40000) : post.body;
  const excerpt = payload.excerpt !== undefined ? cleanText(payload.excerpt, 500) : post.excerpt;
  const categoryId = payload.category_id !== undefined ? Number(payload.category_id) : post.category_id;
  const isFeatured = payload.is_featured !== undefined ? (payload.is_featured ? 1 : 0) : post.is_featured;
  const requiresPrincipal = payload.requires_principal_approval !== undefined
    ? (payload.requires_principal_approval ? 1 : 0)
    : post.requires_principal_approval;
  const coverMediaId = payload.cover_media_id !== undefined
    ? (payload.cover_media_id ? Number(payload.cover_media_id) : null)
    : post.cover_media_id;

  const slug = payload.slug ? ensureUniqueSlug(db, slugify(payload.slug), id) : post.slug;
  const now = nowIso();

  db.prepare(`
    UPDATE posts
    SET title = ?, slug = ?, excerpt = ?, body = ?, category_id = ?, cover_media_id = ?,
        is_featured = ?, requires_principal_approval = ?, updated_at = ?
    WHERE id = ?
  `).run(title, slug, excerpt, body, categoryId, coverMediaId, isFeatured, requiresPrincipal, now, id);

  logAudit(db, {
    user: actor,
    action: 'POST_UPDATED',
    entityType: 'post',
    entityId: id,
    metadata: { title },
    ip
  });

  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
}

export function transitionPostStatus(db, actor, postId, { targetStatus, notes = '', publishedAt = null }, ip) {
  const id = Number(postId);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!post) throw new AppError(404, 'NOT_FOUND', 'Berita tidak ditemukan.');

  const allowedNext = VALID_TRANSITIONS[post.status] || [];
  if (!allowedNext.includes(targetStatus)) {
    throw new AppError(400, 'INVALID_TRANSITION', `Transisi status dari "${post.status}" ke "${targetStatus}" tidak diizinkan.`);
  }

  // Permission enforcement per SAD Section 4.1 & 6.5
  if (targetStatus === 'submitted') {
    const canSubmit = actor.permissions.includes('content.create') && (post.author_id === actor.id || actor.permissions.includes('content.manage'));
    if (!canSubmit) throw new AppError(403, 'FORBIDDEN', 'Anda tidak berwenang mengirim konten ini.');
  } else if (['in_review', 'revision_required', 'approved'].includes(targetStatus)) {
    if (!actor.permissions.includes('content.review')) {
      throw new AppError(403, 'FORBIDDEN', 'Hanya Editor, Admin Sekolah, atau Super Admin yang dapat meninjau konten.');
    }
    if (targetStatus === 'revision_required' && !cleanText(notes, 1000)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Catatan revisi wajib diisi saat mengembalikan konten.');
    }
  } else if (['scheduled', 'published', 'archived'].includes(targetStatus)) {
    if (!actor.permissions.includes('content.publish')) {
      throw new AppError(403, 'FORBIDDEN', 'Anda tidak memiliki izin publikasi atau arsip.');
    }
    if (targetStatus === 'published' && post.requires_principal_approval && actor.role_name !== 'super_admin' && post.status !== 'approved') {
      throw new AppError(403, 'PRINCIPAL_APPROVAL_REQUIRED', 'Konten sensitif ini wajib disetujui (Approved) terlebih dahulu atau dipublikasikan oleh Super Admin.');
    }
  } else if (targetStatus === 'draft') {
    if (!actor.permissions.includes('content.manage') && post.author_id !== actor.id) {
      throw new AppError(403, 'FORBIDDEN', 'Tidak diizinkan mengembalikan ke draf.');
    }
  }

  const now = nowIso();
  let nextPublishedAt = post.published_at;
  let archivedAt = post.archived_at;

  if (targetStatus === 'scheduled') {
    if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Tanggal jadwal publikasi yang valid wajib diisi.');
    }
    nextPublishedAt = new Date(publishedAt).toISOString();
  } else if (targetStatus === 'published') {
    nextPublishedAt = now;
  } else if (targetStatus === 'archived') {
    archivedAt = now;
  }

  db.prepare(`
    UPDATE posts
    SET status = ?, published_at = ?, archived_at = ?, updated_at = ?
    WHERE id = ?
  `).run(targetStatus, nextPublishedAt, archivedAt, now, id);

  db.prepare(`
    INSERT INTO post_reviews (post_id, reviewer_id, decision, notes, reviewed_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, actor.id, targetStatus, cleanText(notes, 1000), now);

  logAudit(db, {
    user: actor,
    action: 'POST_STATUS_CHANGED',
    entityType: 'post',
    entityId: id,
    metadata: { from: post.status, to: targetStatus, notes: cleanText(notes, 200) },
    ip
  });

  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
}
