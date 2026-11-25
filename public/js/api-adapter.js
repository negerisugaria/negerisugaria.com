// Unified API Adapter:
// - Jika window.WEBSEKOLAH_CONFIG.supabaseUrl & supabaseAnonKey terisi -> gunakan Supabase (Auth, PostgREST, Storage, Edge Function)
// - Jika kosong -> gunakan backend Node.js lokal (/api/...)

(function () {
  const ROLE_PERMISSIONS = {
    super_admin: [
      'users.manage', 'roles.manage', 'settings.manage', 'audit.view', 'reports.view',
      'content.create', 'content.manage', 'content.review', 'content.publish',
      'announcements.manage', 'events.manage', 'media.manage', 'pages.manage',
      'profile.manage', 'contact.manage'
    ],
    admin_sekolah: [
      'reports.view', 'content.create', 'content.manage', 'content.review', 'content.publish',
      'announcements.manage', 'events.manage', 'media.manage', 'pages.manage',
      'profile.manage', 'contact.manage'
    ],
    editor: [
      'reports.view', 'content.create', 'content.review', 'content.publish',
      'announcements.manage', 'events.manage', 'media.manage'
    ],
    kontributor: ['content.create', 'media.manage'],
    petugas_layanan: ['contact.manage']
  };

  const ROLE_LABELS = {
    super_admin: 'Super Admin',
    admin_sekolah: 'Admin Sekolah',
    editor: 'Editor / Humas',
    kontributor: 'Kontributor / Guru / Unit',
    petugas_layanan: 'Petugas Layanan Informasi'
  };

  const VALID_TRANSITIONS = {
    draft: ['submitted', 'archived'],
    submitted: ['in_review', 'revision_required', 'approved', 'published', 'scheduled'],
    in_review: ['revision_required', 'approved', 'published', 'scheduled'],
    revision_required: ['submitted', 'archived'],
    approved: ['scheduled', 'published', 'archived'],
    scheduled: ['published', 'archived', 'draft'],
    published: ['archived', 'draft'],
    archived: ['draft']
  };

  const SESSION_KEY = 'websekolah_supabase_session';

  function getCfg() {
    const cfg = window.WEBSEKOLAH_CONFIG || {};
    const url = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
    const key = String(cfg.supabaseAnonKey || '').trim();
    return { url, key, enabled: Boolean(url && key) };
  }

  function getStoredSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setStoredSession(session) {
    if (!session) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function makeError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
  }

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 180) || `item-${Date.now()}`;
  }

  async function sbFetch(path, { method = 'GET', body = null, headers = {}, auth = true, rawBody = false } = {}) {
    const { url, key } = getCfg();
    const sess = getStoredSession();
    const reqHeaders = {
      apikey: key,
      ...headers
    };
    if (auth && sess?.access_token) {
      reqHeaders.Authorization = `Bearer ${sess.access_token}`;
    } else if (key.startsWith('eyJ')) {
      reqHeaders.Authorization = `Bearer ${key}`;
    }
    let payload = body;
    if (body && !rawBody && !(body instanceof FormData)) {
      reqHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetch(`${url}${path}`, { method, headers: reqHeaders, body: payload });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }
    if (!res.ok) {
      const msg = data?.error?.message || data?.msg || data?.message || data?.hint || `HTTP ${res.status}`;
      throw makeError(res.status, msg);
    }
    return data;
  }

  async function buildUserFromAuth(authUser) {
    const profiles = await sbFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=*`);
    const p = profiles?.[0];
    if (!p) throw makeError(403, 'Profil pengguna belum terdaftar pada tabel profiles.');
    if (p.status !== 'active') throw makeError(403, 'Akun Anda sedang dinonaktifkan.');
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      unit: p.unit,
      status: p.status,
      role_name: p.role_name,
      role_display_name: ROLE_LABELS[p.role_name] || p.role_name,
      permissions: ROLE_PERMISSIONS[p.role_name] || []
    };
  }

  async function logSbAudit(user, action, entityType, entityId, metadata = {}) {
    try {
      await sbFetch('/rest/v1/audit_logs', {
        method: 'POST',
        body: {
          user_id: user?.id || null,
          actor_email: user?.email || 'system',
          action,
          entity_type: entityType,
          entity_id: entityId != null ? String(entityId) : null,
          metadata
        }
      });
    } catch {
      // jangan blokir alur utama jika audit gagal
    }
  }

  function mapPostRow(p) {
    return {
      ...p,
      category_name: p.categories?.name || '',
      category_slug: p.categories?.slug || '',
      author_name: p.profiles?.name || '',
      author_unit: p.profiles?.unit || '',
      cover_storage_key: p.media?.storage_key || null,
      cover_public_url: p.media?.public_url || null,
      cover_alt_text: p.media?.alt_text || '',
      cover_title: p.media?.title || ''
    };
  }

  async function handleSupabase(urlPath, { method = 'GET', body = null, isForm = false } = {}) {
    const parsed = new URL(urlPath, window.location.origin);
    const pathname = parsed.pathname;

    // ---------- PUBLIC ----------
    if (method === 'GET' && pathname === '/api/public/home') {
      const now = new Date().toISOString();
      const [profiles, settings, pages, posts, announcements, events, categories, gallery] = await Promise.all([
        sbFetch('/rest/v1/school_profiles?select=field_key,field_label,field_value&order=id.asc', { auth: false }),
        sbFetch('/rest/v1/site_settings?select=key,value', { auth: false }),
        sbFetch('/rest/v1/pages?status=eq.published&select=id,title,slug,section,summary,body,updated_at&order=id.asc', { auth: false }),
        sbFetch('/rest/v1/posts?status=eq.published&select=*,categories(name,slug),profiles(name,unit),media(storage_key,public_url,alt_text,title)&order=is_featured.desc,published_at.desc&limit=6', { auth: false }),
        sbFetch(`/rest/v1/announcements?status=eq.published&start_at=lte.${encodeURIComponent(now)}&select=id,title,body,priority,start_at,end_at,created_at&order=start_at.desc`, { auth: false }),
        sbFetch('/rest/v1/events?status=eq.published&select=id,title,description,start_at,end_at,location,organizer,created_at&order=start_at.asc', { auth: false }),
        sbFetch('/rest/v1/categories?select=*&order=name.asc', { auth: false }),
        sbFetch('/rest/v1/media?mime_type=like.image%25&select=*&order=id.desc&limit=6', { auth: false })
      ]);

      const activeAnns = announcements.filter((a) => !a.end_at || a.end_at >= now);
      return {
        profiles,
        profileMap: Object.fromEntries(profiles.map((r) => [r.field_key, r.field_value])),
        settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
        pages,
        posts: posts.map(mapPostRow),
        announcements: activeAnns,
        events,
        categories,
        gallery
      };
    }

    if (method === 'GET' && pathname.startsWith('/api/public/pages/')) {
      const slug = decodeURIComponent(pathname.slice('/api/public/pages/'.length));
      const rows = await sbFetch(`/rest/v1/pages?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=*`, { auth: false });
      if (!rows.length) throw makeError(404, 'Halaman tidak ditemukan.');
      return { page: rows[0] };
    }

    if (method === 'GET' && pathname === '/api/public/posts') {
      const search = (parsed.searchParams.get('search') || '').trim().toLowerCase();
      const cat = parsed.searchParams.get('category') || '';
      const rows = await sbFetch(
        '/rest/v1/posts?status=eq.published&select=*,categories(name,slug),profiles(name,unit),media(storage_key,public_url,alt_text,title)&order=is_featured.desc,published_at.desc',
        { auth: false }
      );
      let items = rows.map(mapPostRow);
      if (cat) items = items.filter((p) => p.category_slug === cat);
      if (search) {
        items = items.filter((p) =>
          p.title.toLowerCase().includes(search) ||
          p.excerpt.toLowerCase().includes(search) ||
          p.body.toLowerCase().includes(search)
        );
      }
      return { items, total: items.length };
    }

    if (method === 'GET' && pathname.startsWith('/api/public/posts/')) {
      const slug = decodeURIComponent(pathname.slice('/api/public/posts/'.length));
      const rows = await sbFetch(
        `/rest/v1/posts?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=*,categories(name,slug),profiles(name,unit),media(storage_key,public_url,alt_text,title)`,
        { auth: false }
      );
      if (!rows.length) throw makeError(404, 'Berita tidak ditemukan atau belum dipublikasikan.');
      return { post: mapPostRow(rows[0]) };
    }

    if (method === 'GET' && pathname === '/api/public/announcements') {
      const now = new Date().toISOString();
      const rows = await sbFetch(`/rest/v1/announcements?status=eq.published&start_at=lte.${encodeURIComponent(now)}&select=*&order=start_at.desc`, { auth: false });
      return { items: rows.filter((a) => !a.end_at || a.end_at >= now) };
    }

    if (method === 'GET' && pathname === '/api/public/events') {
      const rows = await sbFetch('/rest/v1/events?status=eq.published&select=*&order=start_at.asc', { auth: false });
      return { items: rows };
    }

    if (method === 'GET' && pathname === '/api/public/gallery') {
      const rows = await sbFetch('/rest/v1/media?select=*&order=id.desc', { auth: false });
      return { items: rows };
    }

    if (method === 'POST' && pathname === '/api/public/contact') {
      if (body.website && String(body.website).trim() !== '') {
        throw makeError(400, 'Permintaan ditolak oleh sistem perlindungan spam.');
      }
      const inserted = await sbFetch('/rest/v1/contact_messages', {
        method: 'POST',
        auth: false,
        headers: { Prefer: 'return=representation' },
        body: {
          name: String(body.name || '').trim(),
          email: String(body.email || '').trim().toLowerCase(),
          phone: String(body.phone || '').trim(),
          subject: String(body.subject || '').trim(),
          message: String(body.message || '').trim(),
          status: 'new'
        }
      });
      return {
        id: inserted?.[0]?.id || Date.now(),
        confirmation: 'Terima kasih. Permintaan informasi Anda telah tercatat pada sistem layanan WebSekolah.'
      };
    }

    // ---------- AUTH ----------
    if (method === 'POST' && pathname === '/api/auth/login') {
      const authData = await sbFetch('/auth/v1/token?grant_type=password', {
        method: 'POST',
        auth: false,
        body: { email: String(body.email || '').trim().toLowerCase(), password: String(body.password || '') }
      });
      setStoredSession({
        access_token: authData.access_token,
        refresh_token: authData.refresh_token,
        user: authData.user
      });
      const user = await buildUserFromAuth(authData.user);
      await sbFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        body: { last_login_at: new Date().toISOString() }
      }).catch(() => {});
      await logSbAudit(user, 'LOGIN_SUCCESS', 'auth', user.id, { role: user.role_name });
      return { user, csrfToken: 'supabase-jwt' };
    }

    if (method === 'GET' && pathname === '/api/auth/me') {
      const sess = getStoredSession();
      if (!sess?.access_token) throw makeError(401, 'Belum login.');
      try {
        const authUser = await sbFetch('/auth/v1/user');
        const user = await buildUserFromAuth(authUser);
        return { user, csrfToken: 'supabase-jwt' };
      } catch (e) {
        setStoredSession(null);
        throw makeError(401, e.message || 'Sesi berakhir.');
      }
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      const sess = getStoredSession();
      if (sess?.access_token) {
        await sbFetch('/auth/v1/logout', { method: 'POST' }).catch(() => {});
      }
      setStoredSession(null);
      return { loggedOut: true };
    }

    // ---------- ADMIN ----------
    const authUser = await sbFetch('/auth/v1/user');
    const actor = await buildUserFromAuth(authUser);

    if (method === 'GET' && pathname === '/api/admin/dashboard') {
      const [posts, profiles, announcements, contacts, audit] = await Promise.all([
        sbFetch('/rest/v1/posts?select=id,status,author_id'),
        sbFetch('/rest/v1/profiles?select=id,name,email,role_name,roles(display_name)&order=created_at.asc'),
        sbFetch('/rest/v1/announcements?status=eq.published&select=id'),
        actor.permissions.includes('contact.manage')
          ? sbFetch('/rest/v1/contact_messages?select=id,status')
          : Promise.resolve([]),
        actor.permissions.includes('audit.view')
          ? sbFetch('/rest/v1/audit_logs?select=*&order=id.desc&limit=8')
          : Promise.resolve([])
      ]);

      const postsByStatus = {};
      const countsByUser = {};
      for (const p of posts) {
        postsByStatus[p.status] = (postsByStatus[p.status] || 0) + 1;
        countsByUser[p.author_id] = (countsByUser[p.author_id] || 0) + 1;
      }
      const postsByUser = profiles
        .map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role_display_name: u.roles?.display_name || ROLE_LABELS[u.role_name] || u.role_name,
          post_count: countsByUser[u.id] || 0
        }))
        .sort((a, b) => b.post_count - a.post_count);

      const contactByStatus = {};
      for (const c of contacts) {
        contactByStatus[c.status] = (contactByStatus[c.status] || 0) + 1;
      }

      return {
        report: {
          postsByStatus,
          postsByUser,
          announcementsActive: announcements.length,
          contactByStatus
        },
        recentAudit: audit
      };
    }

    // Users & Roles via Edge Function `manage-users`
    if (pathname === '/api/admin/roles' && method === 'GET') {
      const items = await sbFetch('/rest/v1/roles?select=*');
      return { items };
    }
    if (pathname === '/api/admin/users' && method === 'GET') {
      return await sbFetch('/functions/v1/manage-users', { method: 'GET' });
    }
    if (pathname === '/api/admin/users' && method === 'POST') {
      return await sbFetch('/functions/v1/manage-users', { method: 'POST', body });
    }
    if (pathname.startsWith('/api/admin/users/') && method === 'PATCH') {
      const id = pathname.slice('/api/admin/users/'.length);
      return await sbFetch('/functions/v1/manage-users', { method: 'PATCH', body: { id, ...body } });
    }

    // Categories
    if (pathname === '/api/admin/categories' && method === 'GET') {
      return { items: await sbFetch('/rest/v1/categories?select=*&order=name.asc') };
    }

    // Posts
    if (pathname === '/api/admin/posts' && method === 'GET') {
      const rows = await sbFetch('/rest/v1/posts?select=*,categories(name),profiles(name,unit),media(storage_key,public_url),post_reviews(*,profiles(name))&order=updated_at.desc');
      return {
        items: rows.map((r) => ({
          ...mapPostRow(r),
          reviews: (r.post_reviews || []).map((rv) => ({
            ...rv,
            reviewer_name: rv.profiles?.name || 'Reviewer'
          }))
        }))
      };
    }

    if (pathname === '/api/admin/posts' && method === 'POST') {
      const now = new Date().toISOString();
      const status = body.submit_immediately ? 'submitted' : 'draft';
      const slug = `${slugify(body.title)}-${Math.random().toString(36).slice(2, 6)}`;
      const created = await sbFetch('/rest/v1/posts', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: {
          author_id: actor.id,
          category_id: Number(body.category_id),
          title: String(body.title || '').trim(),
          slug,
          excerpt: String(body.excerpt || body.body || '').trim().slice(0, 180),
          body: String(body.body || '').trim(),
          cover_media_id: body.cover_media_id ? Number(body.cover_media_id) : null,
          is_featured: Boolean(body.is_featured),
          status,
          created_at: now,
          updated_at: now
        }
      });
      await logSbAudit(actor, 'POST_CREATED', 'post', created?.[0]?.id, { title: body.title, status });
      return { post: created?.[0] };
    }

    if (/^\/api\/admin\/posts\/\d+\/transition$/.test(pathname) && method === 'POST') {
      const id = pathname.split('/')[4];
      const existingRows = await sbFetch(`/rest/v1/posts?id=eq.${id}&select=*`);
      const post = existingRows?.[0];
      if (!post) throw makeError(404, 'Berita tidak ditemukan.');

      const targetStatus = body.targetStatus;
      if (!(VALID_TRANSITIONS[post.status] || []).includes(targetStatus)) {
        throw makeError(400, `Transisi status dari "${post.status}" ke "${targetStatus}" tidak diizinkan.`);
      }
      const now = new Date().toISOString();
      const updates = { status: targetStatus, updated_at: now };
      if (targetStatus === 'published') updates.published_at = now;
      if (targetStatus === 'archived') updates.archived_at = now;

      const updated = await sbFetch(`/rest/v1/posts?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: updates
      });
      await sbFetch('/rest/v1/post_reviews', {
        method: 'POST',
        body: { post_id: Number(id), reviewer_id: actor.id, decision: targetStatus, notes: body.notes || '' }
      });
      await logSbAudit(actor, 'POST_STATUS_CHANGED', 'post', id, { from: post.status, to: targetStatus });
      return { post: updated?.[0] };
    }

    // Announcements
    if (pathname === '/api/admin/announcements' && method === 'GET') {
      return { items: await sbFetch('/rest/v1/announcements?select=*&order=created_at.desc') };
    }
    if (pathname === '/api/admin/announcements' && method === 'POST') {
      const created = await sbFetch('/rest/v1/announcements', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: {
          author_id: actor.id,
          title: body.title,
          body: body.body,
          priority: body.priority || 'normal',
          start_at: body.start_at || new Date().toISOString(),
          end_at: body.end_at || null,
          status: body.status || 'published'
        }
      });
      return { announcement: created?.[0] };
    }
    if (/^\/api\/admin\/announcements\/\d+$/.test(pathname) && method === 'PATCH') {
      const id = pathname.split('/')[4];
      const updated = await sbFetch(`/rest/v1/announcements?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: { ...body, updated_at: new Date().toISOString() }
      });
      return { announcement: updated?.[0] };
    }

    // Events
    if (pathname === '/api/admin/events' && method === 'GET') {
      return { items: await sbFetch('/rest/v1/events?select=*&order=start_at.desc') };
    }
    if (pathname === '/api/admin/events' && method === 'POST') {
      const created = await sbFetch('/rest/v1/events', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: {
          author_id: actor.id,
          title: body.title,
          description: body.description,
          location: body.location,
          organizer: body.organizer || 'WebSekolah',
          start_at: body.start_at,
          status: 'published'
        }
      });
      return { event: created?.[0] };
    }
    if (/^\/api\/admin\/events\/\d+$/.test(pathname) && method === 'PATCH') {
      const id = pathname.split('/')[4];
      const updated = await sbFetch(`/rest/v1/events?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: { ...body, updated_at: new Date().toISOString() }
      });
      return { event: updated?.[0] };
    }

    // Pages & Profile
    if (pathname === '/api/admin/pages' && method === 'GET') {
      return { items: await sbFetch('/rest/v1/pages?select=*&order=id.asc') };
    }
    if (/^\/api\/admin\/pages\/\d+$/.test(pathname) && method === 'PATCH') {
      const id = pathname.split('/')[4];
      const updated = await sbFetch(`/rest/v1/pages?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: { ...body, updated_by: actor.id, updated_at: new Date().toISOString() }
      });
      return { page: updated?.[0] };
    }
    if (pathname === '/api/admin/profile' && method === 'GET') {
      return { items: await sbFetch('/rest/v1/school_profiles?select=*&order=id.asc') };
    }
    if (pathname === '/api/admin/profile' && method === 'PUT') {
      for (const item of body.items || []) {
        await sbFetch(`/rest/v1/school_profiles?field_key=eq.${encodeURIComponent(item.field_key)}`, {
          method: 'PATCH',
          body: { field_value: item.field_value, updated_by: actor.id, updated_at: new Date().toISOString() }
        });
      }
      return { items: await sbFetch('/rest/v1/school_profiles?select=*&order=id.asc') };
    }

    // Media (Supabase Storage + media table)
    if (pathname === '/api/admin/media' && method === 'GET') {
      return { items: await sbFetch('/rest/v1/media?select=*&order=id.desc') };
    }
    if (pathname === '/api/admin/media' && method === 'POST' && isForm && body instanceof FormData) {
      const file = body.get('file');
      if (!file || !(file instanceof File) || file.size === 0) {
        throw makeError(400, 'File wajib dipilih.');
      }
      if (file.size > 5 * 1024 * 1024) {
        throw makeError(400, 'Ukuran file melebihi batas 5 MB.');
      }
      const allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
      if (!allowed.includes(file.type)) {
        throw makeError(400, 'Hanya file PNG, JPG/JPEG, WEBP, atau PDF yang diperbolehkan.');
      }
      const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
      const storageKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const { url } = getCfg();
      await sbFetch(`/storage/v1/object/media/${storageKey}`, {
        method: 'POST',
        rawBody: true,
        headers: { 'Content-Type': file.type },
        body: file
      });
      const publicUrl = `${url}/storage/v1/object/public/media/${storageKey}`;
      const created = await sbFetch('/rest/v1/media', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: {
          uploader_id: actor.id,
          title: String(body.get('title') || file.name),
          original_name: file.name,
          storage_key: storageKey,
          public_url: publicUrl,
          mime_type: file.type,
          size: file.size,
          alt_text: String(body.get('alt_text') || file.name),
          category: String(body.get('category') || 'Dokumentasi')
        }
      });
      await logSbAudit(actor, 'MEDIA_UPLOADED', 'media', created?.[0]?.id, { title: created?.[0]?.title });
      return { media: created?.[0] };
    }
    if (/^\/api\/admin\/media\/\d+$/.test(pathname) && method === 'DELETE') {
      const id = pathname.split('/')[4];
      const rows = await sbFetch(`/rest/v1/media?id=eq.${id}&select=*`);
      const m = rows?.[0];
      if (!m) throw makeError(404, 'Media tidak ditemukan.');
      await sbFetch(`/rest/v1/media?id=eq.${id}`, { method: 'DELETE' });
      await sbFetch(`/storage/v1/object/media/${encodeURIComponent(m.storage_key)}`, { method: 'DELETE' }).catch(() => {});
      return { deleted: true };
    }

    // Contacts
    if (pathname === '/api/admin/contacts' && method === 'GET') {
      return { items: await sbFetch('/rest/v1/contact_messages?select=*&order=id.desc') };
    }
    if (/^\/api\/admin\/contacts\/\d+$/.test(pathname) && method === 'PATCH') {
      const id = pathname.split('/')[4];
      const updated = await sbFetch(`/rest/v1/contact_messages?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: { ...body, updated_at: new Date().toISOString() }
      });
      return { contact: updated?.[0] };
    }

    // Audit Logs
    if (pathname === '/api/admin/audit-logs' && method === 'GET') {
      const items = await sbFetch('/rest/v1/audit_logs?select=*&order=id.desc&limit=80');
      return { items, total: items.length };
    }

    // Site Settings
    if (pathname === '/api/admin/settings' && method === 'GET') {
      return { items: await sbFetch('/rest/v1/site_settings?select=*&order=key.asc') };
    }
    if (pathname === '/api/admin/settings' && method === 'PUT') {
      for (const [k, v] of Object.entries(body.settings || {})) {
        await sbFetch(`/rest/v1/site_settings?key=eq.${encodeURIComponent(k)}`, {
          method: 'PATCH',
          body: { value: String(v ?? ''), updated_by: actor.id, updated_at: new Date().toISOString() }
        });
      }
      return { items: await sbFetch('/rest/v1/site_settings?select=*&order=key.asc') };
    }

    throw makeError(404, 'Endpoint tidak ditemukan pada adapter Supabase.');
  }

  async function request(url, { method = 'GET', body = null, isForm = false, csrfToken = '' } = {}) {
    if (getCfg().enabled) {
      return handleSupabase(url, { method, body, isForm });
    }

    const headers = {};
    if (csrfToken && method !== 'GET') {
      headers['X-CSRF-Token'] = csrfToken;
    }
    let payload = body;
    if (body && !isForm) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(url, { method, headers, body: payload });
    const data = await res.json();
    if (!res.ok) {
      throw makeError(res.status, data?.error?.message || 'Permintaan gagal diproses');
    }
    return data;
  }

  window.WebSekolahApi = {
    request,
    isSupabaseEnabled: () => getCfg().enabled,
    getMediaSrc: (item) => {
      if (!item) return '';
      if (item.cover_public_url) return item.cover_public_url;
      if (item.public_url) return item.public_url;
      const key = item.cover_storage_key || item.storage_key;
      return key ? `/media/${encodeURIComponent(key)}` : '';
    }
  };
})();
