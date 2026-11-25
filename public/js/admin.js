const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const sidebarNav = document.getElementById('sidebar-nav');
const viewTitle = document.getElementById('view-title');
const viewSubtitle = document.getElementById('view-subtitle');
const topbarActions = document.getElementById('topbar-actions');
const adminContent = document.getElementById('admin-content');
const adminToast = document.getElementById('admin-toast');

let currentUser = null;
let csrfToken = '';
let activeTab = 'overview';

function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtWib(iso) {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Jakarta'
    }).format(new Date(iso)) + ' WIB';
  } catch {
    return iso;
  }
}

function hasPerm(code) {
  return Boolean(currentUser?.permissions?.includes(code));
}

function hasAnyPerm(codes) {
  return codes.some((c) => hasPerm(c));
}

function showToast(message, type = 'success') {
  adminToast.textContent = message;
  adminToast.className = `alert ${type === 'error' ? 'alert-error' : 'alert-success'}`;
  adminToast.classList.remove('hidden');
  setTimeout(() => adminToast.classList.add('hidden'), 5000);
}

async function api(url, { method = 'GET', body = null, isForm = false } = {}) {
  try {
    return await window.WebSekolahApi.request(url, { method, body, isForm, csrfToken });
  } catch (err) {
    if (err.status === 401) {
      showLogin();
    }
    throw err;
  }
}

function showLogin() {
  currentUser = null;
  csrfToken = '';
  dashboardView.classList.add('hidden');
  loginView.classList.remove('hidden');
}

function showDashboard() {
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  document.getElementById('user-name').textContent = currentUser.name;
  document.getElementById('user-email').textContent = currentUser.email;
  document.getElementById('user-role-badge').textContent = currentUser.role_display_name;
  renderSidebar();
  openTab(activeTab);
}

function getAvailableTabs() {
  const tabs = [
    { id: 'overview', label: 'Dashboard', show: true },
    { id: 'posts', label: 'Berita & Workflow', show: hasAnyPerm(['content.create', 'content.manage', 'content.review']) },
    { id: 'announcements', label: 'Pengumuman', show: hasPerm('announcements.manage') },
    { id: 'events', label: 'Agenda Sekolah', show: hasPerm('events.manage') },
    { id: 'pages', label: 'Halaman & Profil', show: hasAnyPerm(['pages.manage', 'profile.manage']) },
    { id: 'media', label: 'Galeri & Media', show: hasAnyPerm(['media.manage', 'content.create']) },
    { id: 'contacts', label: 'Permintaan Informasi', show: hasPerm('contact.manage') },
    { id: 'users', label: 'Pengguna & Peran', badge: 'Super Admin', show: hasPerm('users.manage') },
    { id: 'audit', label: 'Audit Log', show: hasPerm('audit.view') },
    { id: 'settings', label: 'Pengaturan Sistem', show: hasPerm('settings.manage') }
  ];
  return tabs.filter((t) => t.show);
}

function renderSidebar() {
  const tabs = getAvailableTabs();
  if (!tabs.some((t) => t.id === activeTab)) {
    activeTab = tabs[0]?.id || 'overview';
  }
  sidebarNav.innerHTML = tabs.map((t) => `
    <button type="button" class="sb-link ${t.id === activeTab ? 'active' : ''}" data-tab="${esc(t.id)}">
      <span>${esc(t.label)}</span>
      ${t.badge ? `<span class="badge" style="font-size:0.65rem;">${esc(t.badge)}</span>` : ''}
    </button>
  `).join('');

  sidebarNav.querySelectorAll('.sb-link').forEach((btn) => {
    btn.addEventListener('click', () => openTab(btn.dataset.tab));
  });
}

async function openTab(tabId) {
  activeTab = tabId;
  renderSidebar();
  topbarActions.innerHTML = '';
  adminContent.innerHTML = '<div class="panel">Memuat data...</div>';

  try {
    if (tabId === 'overview') await renderOverview();
    else if (tabId === 'posts') await renderPosts();
    else if (tabId === 'announcements') await renderAnnouncements();
    else if (tabId === 'events') await renderEvents();
    else if (tabId === 'pages') await renderPagesAndProfile();
    else if (tabId === 'media') await renderMedia();
    else if (tabId === 'contacts') await renderContacts();
    else if (tabId === 'users') await renderUsers();
    else if (tabId === 'audit') await renderAudit();
    else if (tabId === 'settings') await renderSettings();
  } catch (err) {
    adminContent.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function renderOverview() {
  viewTitle.textContent = 'Dashboard';
  viewSubtitle.textContent = `Selamat datang, ${currentUser.name} (${currentUser.role_display_name})`;
  const { report, recentAudit } = await api('/api/admin/dashboard');
  const ps = report.postsByStatus || {};
  const postsByUser = report.postsByUser || [];

  adminContent.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Berita Terbit (Published)</div>
        <div class="stat-value">${esc(ps.published || 0)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Antrean Review / Submitted</div>
        <div class="stat-value">${esc((ps.submitted || 0) + (ps.in_review || 0))}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pengumuman Aktif</div>
        <div class="stat-value">${esc(report.announcementsActive || 0)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Tiket Informasi Baru</div>
        <div class="stat-value">${esc(report.contactByStatus?.new || 0)}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Distribusi Konten Berita</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>User</th><th>Peran</th><th>Jumlah Postingan</th></tr></thead>
          <tbody>
            ${postsByUser.length ? postsByUser.map((u) => `
              <tr>
                <td>
                  <strong>${esc(u.name)}</strong>
                  <div style="font-size:0.78rem;color:var(--ink-500);">${esc(u.email)}</div>
                </td>
                <td><span class="status-pill status-draft">${esc(u.role_display_name)}</span></td>
                <td><strong>${esc(u.post_count)}</strong></td>
              </tr>
            `).join('') : '<tr><td colspan="3">Belum ada data pengguna.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    ${recentAudit.length ? `
      <div class="panel">
        <div class="panel-head"><h2>Aktivitas Log</h2></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Waktu</th><th>Aktor</th><th>Aksi</th><th>Entitas</th></tr></thead>
            <tbody>
              ${recentAudit.map((a) => `
                <tr>
                  <td>${esc(fmtWib(a.created_at))}</td>
                  <td>${esc(a.actor_email)}</td>
                  <td><strong>${esc(a.action)}</strong></td>
                  <td>${esc(a.entity_type)} #${esc(a.entity_id || '-')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}
  `;
}

async function renderUsers() {
  viewTitle.textContent = 'Manajemen Pengguna & Peran';
  viewSubtitle.textContent = 'Khusus Super Admin: Buat akun Admin Sekolah baru, tetapkan peran, dan kelola status aktif akun.';

  const [{ items: users }, { items: roles }] = await Promise.all([
    api('/api/admin/users'),
    api('/api/admin/roles')
  ]);

  adminContent.innerHTML = `
    <div class="panel" style="border-left:4px solid var(--gold-500);">
      <div class="panel-head"><h2>Buat User Admin / Pengelola Baru</h2></div>
      <form id="create-user-form" class="form-grid">
        <div class="grid-2">
          <div class="form-field">
            <label for="u-name">Nama Lengkap *</label>
            <input id="u-name" class="input" name="name" required placeholder="Contoh: Siti Nurhaliza, S.Pd." />
          </div>
          <div class="form-field">
            <label for="u-email">Email Resmi Sekolah *</label>
            <input id="u-email" class="input" name="email" type="email" required placeholder="admin2@websekolah.sch.id" />
          </div>
        </div>
        <div class="grid-3">
          <div class="form-field">
            <label for="u-role">Level Peran (Role) *</label>
            <select id="u-role" class="select" name="role_name">
              ${roles.map((r) => `<option value="${esc(r.name)}" ${r.name === 'admin_sekolah' ? 'selected' : ''}>${esc(r.display_name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="u-unit">Unit Kerja / Jabatan</label>
            <input id="u-unit" class="input" name="unit" value="Admin Sekolah / Tata Usaha" />
          </div>
          <div class="form-field">
            <label for="u-password">Password Awal (min 8 karakter) *</label>
            <input id="u-password" class="input" name="password" type="password" required minlength="8" placeholder="Minimal 8 karakter" />
          </div>
        </div>
        <div>
          <button type="submit" class="btn btn-primary">Tambah User Baru</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Daftar Akun Pengelola (${users.length})</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nama & Unit</th>
              <th>Email</th>
              <th>Peran</th>
              <th>Status</th>
              <th>Login Terakhir</th>
              <th>Aksi Super Admin</th>
            </tr>
          </thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td><strong>${esc(u.name)}</strong><div style="font-size:0.78rem;color:var(--ink-500);">${esc(u.unit)}</div></td>
                <td>${esc(u.email)}</td>
                <td>
                  <select class="select role-select" data-id="${esc(u.id)}" style="min-width:165px;padding:6px 8px;font-size:0.84rem;" ${u.id === currentUser.id ? 'disabled' : ''}>
                    ${roles.map((r) => `<option value="${esc(r.name)}" ${r.name === u.role_name ? 'selected' : ''}>${esc(r.display_name)}</option>`).join('')}
                  </select>
                </td>
                <td><span class="status-pill status-${esc(u.status)}">${esc(u.status === 'active' ? 'Aktif' : 'Nonaktif')}</span></td>
                <td>${esc(fmtWib(u.last_login_at))}</td>
                <td>
                  <div class="action-row">
                    ${u.id !== currentUser.id ? `
                      <button type="button" class="btn btn-outline btn-sm toggle-user-btn" data-id="${esc(u.id)}" data-next="${u.status === 'active' ? 'inactive' : 'active'}">
                        ${u.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    ` : '<span style="font-size:0.78rem;color:var(--ink-500);">Akun Anda</span>'}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('create-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const res = await api('/api/admin/users', {
        method: 'POST',
        body: {
          name: f.name.value,
          email: f.email.value,
          role_name: f.role_name.value,
          unit: f.unit.value,
          password: f.password.value
        }
      });
      showToast(`Akun "${res.user.name}" (${res.user.role_display_name}) berhasil dibuat.`);
      await renderUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  adminContent.querySelectorAll('.toggle-user-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/users/${btn.dataset.id}`, {
          method: 'PATCH',
          body: { status: btn.dataset.next }
        });
        showToast('Status akun berhasil diperbarui.');
        await renderUsers();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  adminContent.querySelectorAll('.role-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await api(`/api/admin/users/${sel.dataset.id}`, {
          method: 'PATCH',
          body: { role_name: sel.value }
        });
        showToast('Peran pengguna berhasil diperbarui.');
        await renderUsers();
      } catch (err) {
        showToast(err.message, 'error');
        await renderUsers();
      }
    });
  });
}

async function renderPosts() {
  viewTitle.textContent = 'Berita & Workflow Publikasi';
  viewSubtitle.textContent = 'Alur SAD: Draft → Submitted → In Review → Revision Required / Approved → Scheduled / Published → Archived.';

  const [{ items: posts }, { items: categories }, { items: media }] = await Promise.all([
    api('/api/admin/posts'),
    api('/api/admin/categories'),
    api('/api/admin/media')
  ]);

  const images = media.filter((m) => m.mime_type.startsWith('image/'));

  adminContent.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Buat Berita / Artikel Baru</h2></div>
      <form id="create-post-form" class="form-grid">
        <div class="grid-2">
          <div class="form-field">
            <label for="p-title">Judul Berita *</label>
            <input id="p-title" class="input" name="title" required minlength="5" placeholder="Judul berita sekolah..." />
          </div>
          <div class="form-field">
            <label for="p-cat">Kategori *</label>
            <select id="p-cat" class="select" name="category_id">
              ${categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid-2">
          <div class="form-field">
            <label for="p-cover">Gambar Sampul (dari Galeri Media)</label>
            <select id="p-cover" class="select" name="cover_media_id">
              <option value="">-- Tanpa Gambar Sampul --</option>
              ${images.map((m) => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="p-excerpt">Ringkasan Singkat (Excerpt)</label>
            <input id="p-excerpt" class="input" name="excerpt" placeholder="Ringkasan 1-2 kalimat..." />
          </div>
        </div>
        <div class="form-field">
          <label for="p-body">Isi Berita Lengkap *</label>
          <textarea id="p-body" class="textarea" name="body" rows="4" required minlength="20" placeholder="Tulis isi berita resmi..."></textarea>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;">
          <label style="display:flex;align-items:center;gap:6px;font-size:0.9rem;">
            <input type="checkbox" name="is_featured" /> Tampilkan sebagai Berita Unggulan
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:0.9rem;">
            <input type="checkbox" name="submit_immediately" /> Langsung Kirim untuk Ditinjau (Submitted)
          </label>
        </div>
        <div>
          <button type="submit" class="btn btn-primary">Simpan Berita</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Daftar Konten Berita (${posts.length})</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Judul & Kategori</th>
              <th>Penulis</th>
              <th>Status</th>
              <th>Catatan Review Terakhir</th>
              <th>Aksi Workflow</th>
            </tr>
          </thead>
          <tbody>
            ${posts.map((p) => {
              const lastRev = p.reviews?.[0];
              const canReview = hasPerm('content.review');
              const canPublish = hasPerm('content.publish');
              return `
                <tr>
                  <td>
                    <strong>${esc(p.title)}</strong>
                    <div style="font-size:0.78rem;color:var(--ink-500);">${esc(p.category_name)} • /berita/${esc(p.slug)}</div>
                  </td>
                  <td>${esc(p.author_name)}</td>
                  <td>
                    <span class="status-pill status-${esc(p.status)}">${esc(p.status)}</span>
                    ${p.published_at ? `<div style="font-size:0.75rem;color:var(--ink-500);margin-top:4px;">${esc(fmtWib(p.published_at))}</div>` : ''}
                  </td>
                  <td style="max-width:240px;font-size:0.82rem;">
                    ${lastRev ? `<div><strong>${esc(lastRev.reviewer_name)}:</strong> ${esc(lastRev.notes || lastRev.decision)}</div>` : '<span style="color:var(--ink-500);">-</span>'}
                  </td>
                  <td>
                    <div class="action-row">
                      ${['draft', 'revision_required'].includes(p.status) ? `
                        <button type="button" class="btn btn-outline btn-sm wf-btn" data-id="${esc(p.id)}" data-target="submitted">Kirim Review</button>
                      ` : ''}
                      ${canReview && p.status === 'submitted' ? `
                        <button type="button" class="btn btn-outline btn-sm wf-btn" data-id="${esc(p.id)}" data-target="in_review">Tinjau</button>
                      ` : ''}
                      ${canReview && ['submitted', 'in_review'].includes(p.status) ? `
                        <button type="button" class="btn btn-outline btn-sm wf-rev-btn" data-id="${esc(p.id)}">Minta Revisi</button>
                        <button type="button" class="btn btn-outline btn-sm wf-btn" data-id="${esc(p.id)}" data-target="approved">Setujui</button>
                      ` : ''}
                      ${canPublish && ['submitted', 'in_review', 'approved', 'scheduled'].includes(p.status) ? `
                        <button type="button" class="btn btn-primary btn-sm wf-btn" data-id="${esc(p.id)}" data-target="published">Publikasikan</button>
                      ` : ''}
                      ${canPublish && p.status === 'published' ? `
                        <button type="button" class="btn btn-outline btn-sm wf-btn" data-id="${esc(p.id)}" data-target="archived">Arsipkan</button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('create-post-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/admin/posts', {
        method: 'POST',
        body: {
          title: f.title.value,
          category_id: Number(f.category_id.value),
          cover_media_id: f.cover_media_id.value ? Number(f.cover_media_id.value) : null,
          excerpt: f.excerpt.value,
          body: f.body.value,
          is_featured: f.is_featured.checked,
          submit_immediately: f.submit_immediately.checked
        }
      });
      showToast('Berita berhasil disimpan.');
      await renderPosts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  adminContent.querySelectorAll('.wf-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/posts/${btn.dataset.id}/transition`, {
          method: 'POST',
          body: { targetStatus: btn.dataset.target, notes: `Diubah menjadi ${btn.dataset.target}` }
        });
        showToast(`Status berita diperbarui menjadi ${btn.dataset.target}.`);
        await renderPosts();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  adminContent.querySelectorAll('.wf-rev-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const notes = window.prompt('Masukkan catatan revisi untuk kontributor:');
      if (!notes) return;
      try {
        await api(`/api/admin/posts/${btn.dataset.id}/transition`, {
          method: 'POST',
          body: { targetStatus: 'revision_required', notes }
        });
        showToast('Berita dikembalikan untuk revisi.');
        await renderPosts();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

async function renderAnnouncements() {
  viewTitle.textContent = 'Pengelolaan Pengumuman';
  viewSubtitle.textContent = 'Atur pengumuman resmi lengkap dengan prioritas dan masa tayang (start_at & end_at).';
  const { items } = await api('/api/admin/announcements');

  adminContent.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Tambah Pengumuman Baru</h2></div>
      <form id="ann-form" class="form-grid">
        <div class="grid-2">
          <div class="form-field">
            <label for="a-title">Judul Pengumuman *</label>
            <input id="a-title" class="input" name="title" required minlength="4" />
          </div>
          <div class="form-field">
            <label for="a-prio">Prioritas</label>
            <select id="a-prio" class="select" name="priority">
              <option value="normal">Normal</option>
              <option value="penting">Penting</option>
              <option value="mendesak">Mendesak</option>
            </select>
          </div>
        </div>
        <div class="grid-2">
          <div class="form-field">
            <label for="a-start">Tanggal Mulai Tayang</label>
            <input id="a-start" class="input" name="start_at" type="datetime-local" />
          </div>
          <div class="form-field">
            <label for="a-end">Tanggal Berakhir (Opsional)</label>
            <input id="a-end" class="input" name="end_at" type="datetime-local" />
          </div>
        </div>
        <div class="form-field">
          <label for="a-body">Isi Pengumuman *</label>
          <textarea id="a-body" class="textarea" name="body" rows="3" required></textarea>
        </div>
        <div><button type="submit" class="btn btn-primary">Publikasikan Pengumuman</button></div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Daftar Pengumuman (${items.length})</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Judul</th><th>Prioritas</th><th>Masa Tayang</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${items.map((a) => `
              <tr>
                <td><strong>${esc(a.title)}</strong><div style="font-size:0.8rem;color:var(--ink-500);">${esc(a.body.slice(0, 120))}</div></td>
                <td><span class="badge badge-${esc(a.priority)}">${esc(a.priority)}</span></td>
                <td>${esc(fmtWib(a.start_at))}<br/>s.d. ${esc(a.end_at ? fmtWib(a.end_at) : 'Tanpa batas')}</td>
                <td><span class="status-pill status-${esc(a.status)}">${esc(a.status)}</span></td>
                <td>
                  <button type="button" class="btn btn-outline btn-sm ann-toggle" data-id="${esc(a.id)}" data-next="${a.status === 'published' ? 'archived' : 'published'}">
                    ${a.status === 'published' ? 'Arsipkan' : 'Publikasikan'}
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('ann-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/admin/announcements', {
        method: 'POST',
        body: {
          title: f.title.value,
          priority: f.priority.value,
          start_at: f.start_at.value ? new Date(f.start_at.value).toISOString() : undefined,
          end_at: f.end_at.value ? new Date(f.end_at.value).toISOString() : undefined,
          body: f.body.value,
          status: 'published'
        }
      });
      showToast('Pengumuman berhasil ditambahkan.');
      await renderAnnouncements();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  adminContent.querySelectorAll('.ann-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/announcements/${btn.dataset.id}`, {
          method: 'PATCH',
          body: { status: btn.dataset.next }
        });
        showToast('Status pengumuman diperbarui.');
        await renderAnnouncements();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

async function renderEvents() {
  viewTitle.textContent = 'Agenda Kegiatan Sekolah';
  viewSubtitle.textContent = 'Kelola jadwal, lokasi, dan penyelenggara kegiatan sekolah.';
  const { items } = await api('/api/admin/events');

  adminContent.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Tambah Agenda Baru</h2></div>
      <form id="ev-form" class="form-grid">
        <div class="grid-2">
          <div class="form-field">
            <label for="ev-title">Nama Kegiatan *</label>
            <input id="ev-title" class="input" name="title" required />
          </div>
          <div class="form-field">
            <label for="ev-loc">Lokasi *</label>
            <input id="ev-loc" class="input" name="location" required placeholder="Aula Utama WebSekolah" />
          </div>
        </div>
        <div class="grid-2">
          <div class="form-field">
            <label for="ev-start">Waktu Mulai *</label>
            <input id="ev-start" class="input" name="start_at" type="datetime-local" required />
          </div>
          <div class="form-field">
            <label for="ev-org">Penyelenggara</label>
            <input id="ev-org" class="input" name="organizer" value="WebSekolah" />
          </div>
        </div>
        <div class="form-field">
          <label for="ev-desc">Deskripsi *</label>
          <textarea id="ev-desc" class="textarea" name="description" rows="3" required></textarea>
        </div>
        <div><button type="submit" class="btn btn-primary">Simpan Agenda</button></div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Daftar Agenda (${items.length})</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Kegiatan</th><th>Waktu</th><th>Lokasi</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${items.map((ev) => `
              <tr>
                <td><strong>${esc(ev.title)}</strong><div style="font-size:0.8rem;color:var(--ink-500);">${esc(ev.organizer)}</div></td>
                <td>${esc(fmtWib(ev.start_at))}</td>
                <td>${esc(ev.location)}</td>
                <td><span class="status-pill status-${esc(ev.status)}">${esc(ev.status)}</span></td>
                <td>
                  <button type="button" class="btn btn-outline btn-sm ev-toggle" data-id="${esc(ev.id)}" data-next="${ev.status === 'published' ? 'archived' : 'published'}">
                    ${ev.status === 'published' ? 'Arsipkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('ev-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/admin/events', {
        method: 'POST',
        body: {
          title: f.title.value,
          location: f.location.value,
          start_at: new Date(f.start_at.value).toISOString(),
          organizer: f.organizer.value,
          description: f.description.value
        }
      });
      showToast('Agenda sekolah berhasil ditambahkan.');
      await renderEvents();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  adminContent.querySelectorAll('.ev-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/events/${btn.dataset.id}`, {
          method: 'PATCH',
          body: { status: btn.dataset.next }
        });
        showToast('Status agenda diperbarui.');
        await renderEvents();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

async function renderPagesAndProfile() {
  viewTitle.textContent = 'Halaman Statis & Profil Sekolah';
  viewSubtitle.textContent = 'Perbarui informasi resmi Sejarah, Visi-Misi, Akademik, Kesiswaan, PPDB/SPMB, dan Identitas Sekolah.';

  const [pagesRes, profRes] = await Promise.all([
    hasPerm('pages.manage') ? api('/api/admin/pages') : Promise.resolve({ items: [] }),
    hasPerm('profile.manage') ? api('/api/admin/profile') : Promise.resolve({ items: [] })
  ]);

  adminContent.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Identitas Terstruktur Sekolah</h2></div>
      <form id="profile-form" class="form-grid">
        <div class="grid-2">
          ${profRes.items.map((row) => `
            <div class="form-field">
              <label for="prof-${esc(row.field_key)}">${esc(row.field_label)}</label>
              <input id="prof-${esc(row.field_key)}" class="input profile-input" data-key="${esc(row.field_key)}" value="${esc(row.field_value)}" />
            </div>
          `).join('')}
        </div>
        <div><button type="submit" class="btn btn-primary">Simpan Profil Sekolah</button></div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Halaman Statis Website</h2></div>
      <div class="form-grid">
        ${pagesRes.items.map((p) => `
          <form class="page-edit-form" data-id="${esc(p.id)}" style="padding:16px;border:1px solid var(--border);border-radius:10px;background:#f8fafc;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <strong>${esc(p.title)} (${esc(p.slug)})</strong>
              <span class="status-pill status-${esc(p.status)}">${esc(p.status)}</span>
            </div>
            <div class="form-field" style="margin-bottom:10px;">
              <label>Ringkasan</label>
              <input class="input" name="summary" value="${esc(p.summary)}" />
            </div>
            <div class="form-field" style="margin-bottom:10px;">
              <label>Isi Halaman</label>
              <textarea class="textarea" name="body" rows="4">${esc(p.body)}</textarea>
            </div>
            <button type="submit" class="btn btn-outline btn-sm">Simpan Perubahan Halaman</button>
          </form>
        `).join('')}
      </div>
    </div>
  `;

  document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const items = [...adminContent.querySelectorAll('.profile-input')].map((inp) => ({
      field_key: inp.dataset.key,
      field_value: inp.value
    }));
    try {
      await api('/api/admin/profile', { method: 'PUT', body: { items } });
      showToast('Data profil sekolah berhasil disimpan.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  adminContent.querySelectorAll('.page-edit-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/api/admin/pages/${form.dataset.id}`, {
          method: 'PATCH',
          body: { summary: form.summary.value, body: form.body.value }
        });
        showToast('Halaman statis berhasil diperbarui.');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

async function renderMedia() {
  viewTitle.textContent = 'Galeri & Manajemen Media';
  viewSubtitle.textContent = 'Unggah gambar (PNG, JPG, WEBP) atau dokumen PDF (maks 5 MB) dengan validasi keamanan MIME & Alt Text.';
  const { items } = await api('/api/admin/media');

  adminContent.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Unggah Berkas Media Baru</h2></div>
      <form id="upload-form" class="form-grid">
        <div class="grid-3">
          <div class="form-field">
            <label for="m-file">Pilih File (PNG/JPG/WEBP/PDF, maks 5 MB) *</label>
            <input id="m-file" class="input" type="file" name="file" accept=".png,.jpg,.jpeg,.webp,.pdf" required />
          </div>
          <div class="form-field">
            <label for="m-title">Judul Media *</label>
            <input id="m-title" class="input" name="title" required placeholder="Dokumentasi kegiatan..." />
          </div>
          <div class="form-field">
            <label for="m-cat">Kategori</label>
            <input id="m-cat" class="input" name="category" value="Dokumentasi" />
          </div>
        </div>
        <div class="form-field">
          <label for="m-alt">Alt Text (Deskripsi Aksesibilitas Gambar) *</label>
          <input id="m-alt" class="input" name="alt_text" required placeholder="Deskripsi singkat isi gambar bagi pembaca layar" />
        </div>
        <div><button type="submit" class="btn btn-primary">Unggah Media</button></div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Pustaka Media (${items.length})</h2></div>
      <div class="grid-3">
        ${items.map((m) => `
          <div class="card">
            ${m.mime_type.startsWith('image/')
              ? `<img src="${esc(window.WebSekolahApi.getMediaSrc(m))}" alt="${esc(m.alt_text)}" class="card-cover" />`
              : `<div class="card-cover" style="display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">DOKUMEN PDF</div>`}
            <div class="card-body">
              <div class="card-meta"><span class="badge">${esc(m.category)}</span><span>${Math.round(m.size / 1024)} KB</span></div>
              <strong style="margin-bottom:6px;color:var(--navy-900);">${esc(m.title)}</strong>
              <div style="font-size:0.8rem;color:var(--ink-500);margin-bottom:12px;">Alt: ${esc(m.alt_text)}</div>
              ${hasPerm('media.manage') ? `<button type="button" class="btn btn-danger btn-sm del-media-btn" data-id="${esc(m.id)}">Hapus Media</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/admin/media', { method: 'POST', body: fd, isForm: true });
      showToast('File media berhasil diunggah & divalidasi.');
      await renderMedia();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  adminContent.querySelectorAll('.del-media-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/media/${btn.dataset.id}`, { method: 'DELETE' });
        showToast('Media berhasil dihapus.');
        await renderMedia();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

async function renderContacts() {
  viewTitle.textContent = 'Permintaan Informasi & Kontak';
  viewSubtitle.textContent = 'Tindak lanjuti pesan dan pertanyaan masyarakat dari formulir kontak publik.';
  const { items } = await api('/api/admin/contacts');

  adminContent.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Kotak Masuk Layanan Informasi (${items.length})</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Pengirim</th><th>Subjek & Pesan</th><th>Status</th><th>Catatan Tindak Lanjut</th><th>Aksi</th></tr></thead>
          <tbody>
            ${items.map((c) => `
              <tr>
                <td><strong>${esc(c.name)}</strong><div style="font-size:0.78rem;color:var(--ink-500);">${esc(c.email)}<br/>${esc(c.phone || '-')}</div></td>
                <td><strong>${esc(c.subject)}</strong><div style="font-size:0.84rem;color:var(--ink-700);margin-top:4px;">${esc(c.message)}</div></td>
                <td><span class="status-pill status-${esc(c.status)}">${esc(c.status)}</span></td>
                <td><input class="input contact-notes" data-id="${esc(c.id)}" value="${esc(c.response_notes)}" placeholder="Catatan tindak lanjut..." style="min-width:190px;padding:6px 8px;" /></td>
                <td>
                  <div class="action-row">
                    <button type="button" class="btn btn-outline btn-sm contact-btn" data-id="${esc(c.id)}" data-status="in_progress">Proses</button>
                    <button type="button" class="btn btn-primary btn-sm contact-btn" data-id="${esc(c.id)}" data-status="resolved">Selesai</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  adminContent.querySelectorAll('.contact-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const notesInput = adminContent.querySelector(`.contact-notes[data-id="${btn.dataset.id}"]`);
      try {
        await api(`/api/admin/contacts/${btn.dataset.id}`, {
          method: 'PATCH',
          body: { status: btn.dataset.status, response_notes: notesInput?.value || '' }
        });
        showToast('Status permintaan informasi diperbarui.');
        await renderContacts();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

async function renderAudit() {
  viewTitle.textContent = 'Audit Log Aktivitas';
  viewSubtitle.textContent = 'Rekam jejak autentikasi, perubahan peran, publikasi konten, dan konfigurasi sistem (Super Admin).';
  const { items, total } = await api('/api/admin/audit-logs?limit=80');

  adminContent.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Jejak Audit Sistem (Total: ${total})</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Waktu (WIB)</th><th>Aktor</th><th>Aksi</th><th>Entitas</th><th>Detail Metadata</th><th>IP</th></tr></thead>
          <tbody>
            ${items.map((a) => `
              <tr>
                <td style="white-space:nowrap;">${esc(fmtWib(a.created_at))}</td>
                <td>${esc(a.actor_email)}</td>
                <td><strong>${esc(a.action)}</strong></td>
                <td>${esc(a.entity_type)} #${esc(a.entity_id || '-')}</td>
                <td style="font-size:0.8rem;max-width:280px;word-break:break-word;">${esc(JSON.stringify(a.metadata))}</td>
                <td>${esc(a.ip_address)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderSettings() {
  viewTitle.textContent = 'Pengaturan Sistem Website';
  viewSubtitle.textContent = 'Konfigurasi portal dan kebijakan persetujuan publikasi (Super Admin).';
  const { items } = await api('/api/admin/settings');

  adminContent.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>Konfigurasi Website</h2></div>
      <form id="settings-form" class="form-grid">
        ${items.map((s) => `
          <div class="form-field">
            <label for="set-${esc(s.key)}">${esc(s.key)} — <span style="font-weight:400;color:var(--ink-500);">${esc(s.description)}</span></label>
            <input id="set-${esc(s.key)}" class="input setting-input" data-key="${esc(s.key)}" value="${esc(s.value)}" />
          </div>
        `).join('')}
        <div><button type="submit" class="btn btn-primary">Simpan Pengaturan</button></div>
      </form>
    </div>
  `;

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const settings = {};
    adminContent.querySelectorAll('.setting-input').forEach((inp) => {
      settings[inp.dataset.key] = inp.value;
    });
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { settings } });
      showToast('Pengaturan website berhasil disimpan.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

if (window.WebSekolahApi.isSupabaseEnabled()) {
  const demoBox = document.querySelector('.demo-box');
  if (demoBox) {
    demoBox.innerHTML = `<div class="demo-title">Mode Produksi Supabase Aktif</div><p class="demo-note" style="margin-top:0;">Masuk menggunakan akun <strong>Super Admin</strong> atau <strong>Admin Sekolah</strong> yang terdaftar pada Supabase Auth.</p>`;
  }
}

document.querySelectorAll('.quick-login').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.getElementById('login-email').value = btn.dataset.email;
    document.getElementById('login-password').value = btn.dataset.pass;
  });
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  try {
    const data = await window.WebSekolahApi.request('/api/auth/login', {
      method: 'POST',
      body: {
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value
      }
    });
    currentUser = data.user;
    csrfToken = data.csrfToken;
    activeTab = 'overview';
    showDashboard();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    // ignore
  }
  showLogin();
});

// Check existing session on load
(async () => {
  try {
    const data = await window.WebSekolahApi.request('/api/auth/me', { method: 'GET' });
    currentUser = data.user;
    csrfToken = data.csrfToken;
    showDashboard();
    return;
  } catch {
    // not logged in
  }
  showLogin();
})();
