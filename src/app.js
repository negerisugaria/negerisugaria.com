import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from './config/env.js';
import {
  AppError,
  getClientIp,
  parseMultipart,
  readBodyBuffer,
  readJsonBody,
  sendJson,
  sendText
} from './utils/http.js';
import {
  authenticateRequest,
  login,
  logout,
  requireAnyPermission,
  requireAuth,
  requireCsrf,
  requirePermission
} from './modules/identity/authService.js';
import { getSummaryReport, listAuditLogs } from './modules/audit/auditService.js';
import { createUser, listRoles, listUsers, updateUser } from './modules/users/userService.js';
import {
  createCategory,
  createPost,
  getPublicPostBySlug,
  listAdminPosts,
  listCategories,
  listPublicPosts,
  publishDueScheduledPosts,
  transitionPostStatus,
  updatePost
} from './modules/news/newsService.js';
import {
  createAnnouncement,
  listAdminAnnouncements,
  listPublicAnnouncements,
  updateAnnouncement
} from './modules/announcements/announcementService.js';
import { createEvent, listAdminEvents, listPublicEvents, updateEvent } from './modules/events/eventService.js';
import { deleteMedia, listMedia, uploadMedia } from './modules/gallery/mediaService.js';
import {
  getPublicPageBySlug,
  getPublicSchoolData,
  listAdminPages,
  listSiteSettings,
  updatePage,
  updateProfiles,
  updateSiteSettings
} from './modules/schoolProfile/profileService.js';
import { listAdminContacts, submitPublicContact, updateContactStatus } from './modules/contact/contactService.js';

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data: https://*.supabase.co; style-src 'self'; script-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
}

function serveStaticFile(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = STATIC_MIME[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': ['.html', '.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=3600'
  });
  res.end(content);
  return true;
}

export function createApp({ db, uploadDir = config.uploadDir, publicDir = path.join(ROOT_DIR, 'public') }) {
  return async function handleRequest(req, res) {
    applySecurityHeaders(res);

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = (req.method || 'GET').toUpperCase();
    const ip = getClientIp(req);

    try {
      // Health check
      if (method === 'GET' && pathname === '/health') {
        return sendJson(res, 200, { status: 'ok', service: 'websekolah' });
      }

      // SEO: robots.txt & sitemap.xml (FR-14)
      if (method === 'GET' && pathname === '/robots.txt') {
        return sendText(
          res,
          200,
          'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/admin/\nSitemap: /sitemap.xml\n'
        );
      }

      if (method === 'GET' && pathname === '/sitemap.xml') {
        publishDueScheduledPosts(db);
        const pages = db.prepare("SELECT slug, updated_at FROM pages WHERE status = 'published'").all();
        const posts = db.prepare("SELECT slug, updated_at FROM posts WHERE status = 'published'").all();
        const origin = `http://${req.headers.host || 'localhost'}`;
        const urls = [
          `${origin}/`,
          `${origin}/berita`,
          `${origin}/pengumuman`,
          `${origin}/agenda`,
          `${origin}/galeri`,
          `${origin}/kontak`,
          ...pages.map((p) => `${origin}/${p.slug === 'akademik' || p.slug === 'kesiswaan' ? p.slug : p.slug === 'ppdb-spmb' ? 'ppdb' : `profil/${p.slug}`}`),
          ...posts.map((p) => `${origin}/berita/${p.slug}`)
        ];
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
          .map((u) => `  <url><loc>${u}</loc></url>`)
          .join('\n')}\n</urlset>`;
        return sendText(res, 200, xml, 'application/xml; charset=utf-8');
      }

      // Uploaded media serving (non-executable storage outside public/)
      if (method === 'GET' && pathname.startsWith('/media/')) {
        const key = path.basename(decodeURIComponent(pathname.slice('/media/'.length)));
        const mediaRow = db.prepare('SELECT mime_type, storage_key FROM media WHERE storage_key = ?').get(key);
        if (!mediaRow) {
          throw new AppError(404, 'NOT_FOUND', 'Berkas media tidak ditemukan.');
        }
        const filePath = path.join(uploadDir, path.basename(mediaRow.storage_key));
        if (!fs.existsSync(filePath)) {
          throw new AppError(404, 'NOT_FOUND', 'File fisik tidak ditemukan.');
        }
        const content = fs.readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': mediaRow.mime_type,
          'Content-Disposition': 'inline',
          'Cache-Control': 'public, max-age=86400'
        });
        res.end(content);
        return;
      }

      // ================= PUBLIC API =================
      if (method === 'GET' && pathname === '/api/public/home') {
        const school = getPublicSchoolData(db);
        const posts = listPublicPosts(db, { limit: 6 });
        const announcements = listPublicAnnouncements(db);
        const events = listPublicEvents(db);
        const categories = listCategories(db);
        const gallery = listMedia(db).filter((m) => m.mime_type.startsWith('image/')).slice(0, 6);
        return sendJson(res, 200, {
          ...school,
          posts: posts.items,
          announcements,
          events,
          categories,
          gallery
        });
      }

      if (method === 'GET' && pathname.startsWith('/api/public/pages/')) {
        const slug = decodeURIComponent(pathname.slice('/api/public/pages/'.length));
        return sendJson(res, 200, { page: getPublicPageBySlug(db, slug) });
      }

      if (method === 'GET' && pathname === '/api/public/posts') {
        const search = url.searchParams.get('search') || '';
        const category = url.searchParams.get('category') || '';
        const featured = url.searchParams.get('featured') || '';
        const limit = Number(url.searchParams.get('limit') || 12);
        const offset = Number(url.searchParams.get('offset') || 0);
        return sendJson(res, 200, listPublicPosts(db, { search, category, featured, limit, offset }));
      }

      if (method === 'GET' && pathname.startsWith('/api/public/posts/')) {
        const slug = decodeURIComponent(pathname.slice('/api/public/posts/'.length));
        return sendJson(res, 200, { post: getPublicPostBySlug(db, slug) });
      }

      if (method === 'GET' && pathname === '/api/public/announcements') {
        return sendJson(res, 200, { items: listPublicAnnouncements(db) });
      }

      if (method === 'GET' && pathname === '/api/public/events') {
        return sendJson(res, 200, { items: listPublicEvents(db) });
      }

      if (method === 'GET' && pathname === '/api/public/gallery') {
        const category = url.searchParams.get('category') || '';
        return sendJson(res, 200, { items: listMedia(db, { category }) });
      }

      if (method === 'POST' && pathname === '/api/public/contact') {
        const body = await readJsonBody(req);
        const result = submitPublicContact(db, body, ip);
        return sendJson(res, 201, result);
      }

      // ================= AUTH API =================
      const auth = authenticateRequest(req, db);

      if (method === 'POST' && pathname === '/api/auth/login') {
        const body = await readJsonBody(req);
        const result = login(db, {
          email: body.email,
          password: body.password,
          ip,
          userAgent: req.headers['user-agent']
        });
        return sendJson(
          res,
          200,
          { user: result.user, csrfToken: result.csrfToken },
          { 'Set-Cookie': result.setCookieHeader }
        );
      }

      if (method === 'GET' && pathname === '/api/auth/me') {
        requireAuth(auth);
        return sendJson(res, 200, { user: auth.user, csrfToken: auth.csrfToken });
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        if (auth) requireCsrf(req, auth);
        const clearCookie = logout(db, auth, ip);
        return sendJson(res, 200, { loggedOut: true }, { 'Set-Cookie': clearCookie });
      }

      // ================= ADMIN CMS API =================
      if (pathname.startsWith('/api/admin/')) {
        requireAuth(auth);
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          requireCsrf(req, auth);
        }

        // Dashboard summary
        if (method === 'GET' && pathname === '/api/admin/dashboard') {
          publishDueScheduledPosts(db);
          const report = getSummaryReport(db);
          const recentAudit = auth.user.permissions.includes('audit.view')
            ? listAuditLogs(db, { limit: 8 }).items
            : [];
          return sendJson(res, 200, { report, recentAudit });
        }

        // Users & Roles (STRICTLY SUPER ADMIN ONLY: users.manage & roles.manage)
        if (method === 'GET' && pathname === '/api/admin/roles') {
          requirePermission(auth, 'roles.manage');
          return sendJson(res, 200, { items: listRoles(db) });
        }

        if (method === 'GET' && pathname === '/api/admin/users') {
          requirePermission(auth, 'users.manage');
          return sendJson(res, 200, { items: listUsers(db) });
        }

        if (method === 'POST' && pathname === '/api/admin/users') {
          requirePermission(auth, 'users.manage');
          requirePermission(auth, 'roles.manage');
          const body = await readJsonBody(req);
          const created = createUser(db, auth.user, body, ip);
          return sendJson(res, 201, { user: created });
        }

        if (method === 'PATCH' && pathname.startsWith('/api/admin/users/')) {
          requirePermission(auth, 'users.manage');
          const id = pathname.slice('/api/admin/users/'.length);
          const body = await readJsonBody(req);
          if (body.role_name !== undefined) {
            requirePermission(auth, 'roles.manage');
          }
          const updated = updateUser(db, auth.user, id, body, ip);
          return sendJson(res, 200, { user: updated });
        }

        // Categories
        if (method === 'GET' && pathname === '/api/admin/categories') {
          requireAnyPermission(auth, ['content.create', 'content.manage', 'content.review']);
          return sendJson(res, 200, { items: listCategories(db) });
        }

        if (method === 'POST' && pathname === '/api/admin/categories') {
          requirePermission(auth, 'content.manage');
          const body = await readJsonBody(req);
          return sendJson(res, 201, { category: createCategory(db, auth.user, body, ip) });
        }

        // Posts & Workflow
        if (method === 'GET' && pathname === '/api/admin/posts') {
          requireAnyPermission(auth, ['content.create', 'content.manage', 'content.review']);
          const status = url.searchParams.get('status') || '';
          const search = url.searchParams.get('search') || '';
          return sendJson(res, 200, { items: listAdminPosts(db, auth.user, { status, search }) });
        }

        if (method === 'POST' && pathname === '/api/admin/posts') {
          requirePermission(auth, 'content.create');
          const body = await readJsonBody(req);
          return sendJson(res, 201, { post: createPost(db, auth.user, body, ip) });
        }

        if (method === 'POST' && /^\/api\/admin\/posts\/\d+\/transition$/.test(pathname)) {
          requireAnyPermission(auth, ['content.create', 'content.review', 'content.publish', 'content.manage']);
          const id = pathname.split('/')[4];
          const body = await readJsonBody(req);
          const updated = transitionPostStatus(db, auth.user, id, body, ip);
          return sendJson(res, 200, { post: updated });
        }

        if (method === 'PATCH' && /^\/api\/admin\/posts\/\d+$/.test(pathname)) {
          requireAnyPermission(auth, ['content.create', 'content.manage', 'content.review']);
          const id = pathname.split('/')[4];
          const body = await readJsonBody(req);
          return sendJson(res, 200, { post: updatePost(db, auth.user, id, body, ip) });
        }

        // Announcements
        if (method === 'GET' && pathname === '/api/admin/announcements') {
          requirePermission(auth, 'announcements.manage');
          return sendJson(res, 200, { items: listAdminAnnouncements(db) });
        }
        if (method === 'POST' && pathname === '/api/admin/announcements') {
          requirePermission(auth, 'announcements.manage');
          const body = await readJsonBody(req);
          return sendJson(res, 201, { announcement: createAnnouncement(db, auth.user, body, ip) });
        }
        if (method === 'PATCH' && /^\/api\/admin\/announcements\/\d+$/.test(pathname)) {
          requirePermission(auth, 'announcements.manage');
          const id = pathname.split('/')[4];
          const body = await readJsonBody(req);
          return sendJson(res, 200, { announcement: updateAnnouncement(db, auth.user, id, body, ip) });
        }

        // Events / Agenda
        if (method === 'GET' && pathname === '/api/admin/events') {
          requirePermission(auth, 'events.manage');
          return sendJson(res, 200, { items: listAdminEvents(db) });
        }
        if (method === 'POST' && pathname === '/api/admin/events') {
          requirePermission(auth, 'events.manage');
          const body = await readJsonBody(req);
          return sendJson(res, 201, { event: createEvent(db, auth.user, body, ip) });
        }
        if (method === 'PATCH' && /^\/api\/admin\/events\/\d+$/.test(pathname)) {
          requirePermission(auth, 'events.manage');
          const id = pathname.split('/')[4];
          const body = await readJsonBody(req);
          return sendJson(res, 200, { event: updateEvent(db, auth.user, id, body, ip) });
        }

        // Static Pages & School Profile
        if (method === 'GET' && pathname === '/api/admin/pages') {
          requirePermission(auth, 'pages.manage');
          return sendJson(res, 200, { items: listAdminPages(db) });
        }
        if (method === 'PATCH' && /^\/api\/admin\/pages\/\d+$/.test(pathname)) {
          requirePermission(auth, 'pages.manage');
          const id = pathname.split('/')[4];
          const body = await readJsonBody(req);
          return sendJson(res, 200, { page: updatePage(db, auth.user, id, body, ip) });
        }
        if (method === 'GET' && pathname === '/api/admin/profile') {
          requirePermission(auth, 'profile.manage');
          return sendJson(res, 200, { items: getPublicSchoolData(db).profiles });
        }
        if (method === 'PUT' && pathname === '/api/admin/profile') {
          requirePermission(auth, 'profile.manage');
          const body = await readJsonBody(req);
          return sendJson(res, 200, { items: updateProfiles(db, auth.user, body.items, ip) });
        }

        // Media / Gallery
        if (method === 'GET' && pathname === '/api/admin/media') {
          requireAnyPermission(auth, ['media.manage', 'content.create', 'content.manage']);
          return sendJson(res, 200, { items: listMedia(db) });
        }
        if (method === 'POST' && pathname === '/api/admin/media') {
          requirePermission(auth, 'media.manage');
          const ct = req.headers['content-type'] || '';
          const buf = await readBodyBuffer(req, config.maxUploadBytes + 128 * 1024);
          const { fields, files } = parseMultipart(buf, ct);
          const created = uploadMedia(db, auth.user, { file: files[0], fields, uploadDir }, ip);
          return sendJson(res, 201, { media: created });
        }
        if (method === 'DELETE' && /^\/api\/admin\/media\/\d+$/.test(pathname)) {
          requirePermission(auth, 'media.manage');
          const id = pathname.split('/')[4];
          return sendJson(res, 200, deleteMedia(db, auth.user, id, { uploadDir }, ip));
        }

        // Contact Messages
        if (method === 'GET' && pathname === '/api/admin/contacts') {
          requirePermission(auth, 'contact.manage');
          const status = url.searchParams.get('status') || '';
          return sendJson(res, 200, { items: listAdminContacts(db, { status }) });
        }
        if (method === 'PATCH' && /^\/api\/admin\/contacts\/\d+$/.test(pathname)) {
          requirePermission(auth, 'contact.manage');
          const id = pathname.split('/')[4];
          const body = await readJsonBody(req);
          return sendJson(res, 200, { contact: updateContactStatus(db, auth.user, id, body, ip) });
        }

        // Audit Logs (Super Admin)
        if (method === 'GET' && pathname === '/api/admin/audit-logs') {
          requirePermission(auth, 'audit.view');
          const limit = url.searchParams.get('limit') || 60;
          const offset = url.searchParams.get('offset') || 0;
          const action = url.searchParams.get('action') || '';
          return sendJson(res, 200, listAuditLogs(db, { limit, offset, action }));
        }

        // Site Settings (Super Admin)
        if (method === 'GET' && pathname === '/api/admin/settings') {
          requirePermission(auth, 'settings.manage');
          return sendJson(res, 200, { items: listSiteSettings(db) });
        }
        if (method === 'PUT' && pathname === '/api/admin/settings') {
          requirePermission(auth, 'settings.manage');
          const body = await readJsonBody(req);
          return sendJson(res, 200, { items: updateSiteSettings(db, auth.user, body.settings, ip) });
        }

        throw new AppError(404, 'NOT_FOUND', 'Endpoint admin tidak ditemukan.');
      }

      if (pathname.startsWith('/api/')) {
        throw new AppError(404, 'NOT_FOUND', 'Endpoint API tidak ditemukan.');
      }

      // ================= STATIC & FRONTEND ROUTES =================
      if (method === 'GET') {
        const safeRel = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
        const candidate = path.join(publicDir, safeRel);
        if (safeRel !== '/' && safeRel !== '\\' && candidate.startsWith(publicDir) && serveStaticFile(res, candidate)) {
          return;
        }

        if (pathname === '/admin' || pathname.startsWith('/admin/')) {
          if (serveStaticFile(res, path.join(publicDir, 'admin.html'))) return;
        }

        if (serveStaticFile(res, path.join(publicDir, 'index.html'))) return;
      }

      throw new AppError(404, 'NOT_FOUND', 'Halaman tidak ditemukan.');
    } catch (err) {
      if (err instanceof AppError) {
        return sendJson(res, err.status, {
          error: { code: err.code, message: err.message, details: err.details }
        });
      }
      console.error('Unhandled server error:', err);
      return sendJson(res, 500, {
        error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan internal pada server.' }
      });
    }
  };
}
