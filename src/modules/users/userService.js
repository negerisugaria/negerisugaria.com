import { nowIso } from '../../config/env.js';
import { AppError, cleanText, validateEmail } from '../../utils/http.js';
import { hashPassword } from '../identity/password.js';
import { logAudit } from '../audit/auditService.js';

export function listRoles(db) {
  return db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
    FROM roles r
    ORDER BY r.id ASC
  `).all();
}

export function listUsers(db) {
  return db.prepare(`
    SELECT u.id, u.name, u.email, u.unit, u.status, u.last_login_at, u.created_at, u.updated_at,
           r.id AS role_id, r.name AS role_name, r.display_name AS role_display_name
    FROM users u
    JOIN roles r ON r.id = u.role_id
    ORDER BY r.id ASC, u.id DESC
  `).all();
}

export function createUser(db, actor, payload, ip) {
  const name = cleanText(payload.name, 120);
  const email = validateEmail(payload.email);
  const password = String(payload.password || '');
  const roleName = cleanText(payload.role_name || 'admin_sekolah', 60);
  const unit = cleanText(payload.unit || 'Tata Usaha & Humas', 120);

  if (!name || name.length < 3) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Nama lengkap minimal 3 karakter.');
  }
  if (!email) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Format email tidak valid.');
  }
  if (password.length < 8) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Password minimal 8 karakter.');
  }

  const role = db.prepare('SELECT * FROM roles WHERE name = ?').get(roleName);
  if (!role) {
    throw new AppError(400, 'INVALID_ROLE', 'Peran yang dipilih tidak ditemukan.');
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    throw new AppError(409, 'EMAIL_EXISTS', 'Email sudah terdaftar pada sistem.');
  }

  const now = nowIso();
  const passwordHash = hashPassword(password);
  const info = db.prepare(`
    INSERT INTO users (role_id, name, email, password_hash, unit, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(role.id, name, email, passwordHash, unit, now, now);

  const newUserId = Number(info.lastInsertRowid);
  const created = db.prepare(`
    SELECT u.id, u.name, u.email, u.unit, u.status, u.created_at,
           r.id AS role_id, r.name AS role_name, r.display_name AS role_display_name
    FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(newUserId);

  logAudit(db, {
    user: actor,
    action: 'USER_CREATED',
    entityType: 'user',
    entityId: newUserId,
    metadata: { email: created.email, role: created.role_name, unit: created.unit },
    ip
  });

  return created;
}

export function updateUser(db, actor, targetId, payload, ip) {
  const id = Number(targetId);
  const target = db.prepare(`
    SELECT u.*, r.name AS role_name
    FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(id);

  if (!target) {
    throw new AppError(404, 'NOT_FOUND', 'Pengguna tidak ditemukan.');
  }

  const updates = {};
  if (payload.name !== undefined) {
    const name = cleanText(payload.name, 120);
    if (name.length < 3) throw new AppError(400, 'VALIDATION_ERROR', 'Nama minimal 3 karakter.');
    updates.name = name;
  }
  if (payload.unit !== undefined) {
    updates.unit = cleanText(payload.unit, 120) || 'Umum';
  }
  if (payload.role_name !== undefined) {
    const role = db.prepare('SELECT * FROM roles WHERE name = ?').get(String(payload.role_name));
    if (!role) throw new AppError(400, 'INVALID_ROLE', 'Peran tidak valid.');
    if (target.id === actor.id && role.name !== 'super_admin') {
      throw new AppError(400, 'SELF_ROLE_LOCK', 'Super Admin tidak dapat menurunkan perannya sendiri.');
    }
    updates.role_id = role.id;
  }
  if (payload.status !== undefined) {
    if (!['active', 'inactive'].includes(payload.status)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Status harus active atau inactive.');
    }
    if (target.id === actor.id && payload.status === 'inactive') {
      throw new AppError(400, 'SELF_DEACTIVATE', 'Anda tidak dapat menonaktifkan akun Anda sendiri.');
    }
    updates.status = payload.status;
  }
  if (payload.password !== undefined && String(payload.password).length > 0) {
    if (String(payload.password).length < 8) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Password baru minimal 8 karakter.');
    }
    updates.password_hash = hashPassword(String(payload.password));
  }

  // Ensure at least one active super_admin remains
  if ((updates.status === 'inactive' || (updates.role_id && target.role_name === 'super_admin'))) {
    const activeSuperAdmins = db.prepare(`
      SELECT COUNT(*) AS count
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.name = 'super_admin' AND u.status = 'active' AND u.id != ?
    `).get(id).count;
    if (activeSuperAdmins === 0) {
      throw new AppError(400, 'LAST_SUPER_ADMIN', 'Sistem harus memiliki minimal satu Super Admin aktif.');
    }
  }

  const now = nowIso();
  const nextName = updates.name ?? target.name;
  const nextUnit = updates.unit ?? target.unit;
  const nextRoleId = updates.role_id ?? target.role_id;
  const nextStatus = updates.status ?? target.status;
  const nextPass = updates.password_hash ?? target.password_hash;

  db.prepare(`
    UPDATE users
    SET name = ?, unit = ?, role_id = ?, status = ?, password_hash = ?, updated_at = ?
    WHERE id = ?
  `).run(nextName, nextUnit, nextRoleId, nextStatus, nextPass, now, id);

  if (nextStatus === 'inactive') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }

  const updated = db.prepare(`
    SELECT u.id, u.name, u.email, u.unit, u.status, u.last_login_at, u.created_at, u.updated_at,
           r.id AS role_id, r.name AS role_name, r.display_name AS role_display_name
    FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(id);

  logAudit(db, {
    user: actor,
    action: nextStatus !== target.status && nextStatus === 'inactive' ? 'USER_DEACTIVATED' : 'USER_UPDATED',
    entityType: 'user',
    entityId: id,
    metadata: {
      email: updated.email,
      previous_role: target.role_name,
      new_role: updated.role_name,
      status: updated.status,
      password_reset: Boolean(updates.password_hash)
    },
    ip
  });

  return updated;
}
