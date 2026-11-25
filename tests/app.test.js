import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../src/db/database.js';
import { seedDatabase } from '../src/db/seed.js';
import { createApp } from '../src/app.js';
import { resetRateLimiters } from '../src/modules/identity/authService.js';
import { resetContactLimiter } from '../src/modules/contact/contactService.js';

let server;
let baseUrl;
let tempDir;
let db;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'websekolah-test-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  const uploadDir = path.join(tempDir, 'uploads');
  db = getDb(dbPath);
  seedDatabase(db, { uploadDir });

  const handler = createApp({ db, uploadDir });
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (db) {
    db.close();
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function loginAs(email, password) {
  resetRateLimiters();
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  assert.equal(res.status, 200, `Login gagal untuk ${email}: ${JSON.stringify(data)}`);
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'Cookie sesi harus diset saat login');
  const cookie = setCookie.split(';')[0];
  return { cookie, csrfToken: data.csrfToken, user: data.user };
}

test('UAT-01 & Public Portal: beranda, profil sekolah, dan hanya berita published yang tampil', async () => {
  const homeRes = await fetch(`${baseUrl}/api/public/home`);
  assert.equal(homeRes.status, 200);
  const home = await homeRes.json();
  assert.equal(home.profileMap.school_name, 'WebSekolah');
  assert.ok(home.posts.length >= 4);

  const pageRes = await fetch(`${baseUrl}/api/public/pages/sejarah`);
  assert.equal(pageRes.status, 200);
  const pageData = await pageRes.json();
  assert.match(pageData.page.body, /WebSekolah/i);

  // Pastikan draft / in_review / scheduled tidak bisa diakses publik
  const hiddenRes = await fetch(`${baseUrl}/api/public/posts/persiapan-porseni-websekolah-2026`);
  assert.equal(hiddenRes.status, 404);

  // Pastikan aset static untuk GitHub Pages & Supabase adapter tersedia
  const [cfgRes, adpRes, cnameRes] = await Promise.all([
    fetch(`${baseUrl}/js/config.js`),
    fetch(`${baseUrl}/js/api-adapter.js`),
    fetch(`${baseUrl}/CNAME`)
  ]);
  assert.equal(cfgRes.status, 200);
  assert.equal(adpRes.status, 200);
  assert.equal(cnameRes.status, 200);
  assert.equal((await cnameRes.text()).trim(), 'negerisugaria.com');
});

test('RBAC: Super Admin dapat membuat user Admin Sekolah baru, sedangkan Admin Sekolah ditolak (403)', async () => {
  const superAuth = await loginAs('superadmin@websekolah.sch.id', 'SuperAdmin#2026');

  // Super Admin membuat Admin Sekolah baru
  const createRes = await fetch(`${baseUrl}/api/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: superAuth.cookie,
      'X-CSRF-Token': superAuth.csrfToken
    },
    body: JSON.stringify({
      name: 'Admin Sekolah Baru',
      email: 'admin.baru@websekolah.sch.id',
      password: 'PasswordKuat#2026',
      role_name: 'admin_sekolah',
      unit: 'Humas & Kurikulum'
    })
  });
  assert.equal(createRes.status, 201);
  const createdData = await createRes.json();
  assert.equal(createdData.user.role_name, 'admin_sekolah');
  assert.equal(createdData.user.status, 'active');

  // Admin Sekolah baru bisa login dan akses dashboard konten
  const newAdminAuth = await loginAs('admin.baru@websekolah.sch.id', 'PasswordKuat#2026');
  const dashRes = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: newAdminAuth.cookie }
  });
  assert.equal(dashRes.status, 200);
  const dashData = await dashRes.json();
  assert.ok(Array.isArray(dashData.report.postsByUser));
  assert.ok(dashData.report.postsByUser.some((u) => typeof u.post_count === 'number' && u.name));

  // Admin Sekolah DILARANG mengakses daftar user atau membuat user baru (403)
  const listUsersDenied = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Cookie: newAdminAuth.cookie }
  });
  assert.equal(listUsersDenied.status, 403);

  const createUserDenied = await fetch(`${baseUrl}/api/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: newAdminAuth.cookie,
      'X-CSRF-Token': newAdminAuth.csrfToken
    },
    body: JSON.stringify({
      name: 'User Ilegal',
      email: 'ilegal@websekolah.sch.id',
      password: 'Password#2026',
      role_name: 'super_admin'
    })
  });
  assert.equal(createUserDenied.status, 403);
});

test('UAT-02, UAT-03, UAT-04: Workflow berita Kontributor -> Submitted -> Revision Required -> Approved -> Published', async () => {
  const contribAuth = await loginAs('kontributor@websekolah.sch.id', 'Kontributor#2026');
  const editorAuth = await loginAs('editor@websekolah.sch.id', 'Editor#2026');

  // Kontributor membuat draf
  const createRes = await fetch(`${baseUrl}/api/admin/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: contribAuth.cookie,
      'X-CSRF-Token': contribAuth.csrfToken
    },
    body: JSON.stringify({
      title: 'Lomba Debat Bahasa Indonesia Tingkat Nasional',
      category_id: 1,
      body: 'Tim debat WebSekolah berhasil melaju ke babak final tingkat nasional dengan membawa gagasan literasi digital.'
    })
  });
  assert.equal(createRes.status, 201);
  const { post } = await createRes.json();
  assert.equal(post.status, 'draft');

  // Kontributor tidak boleh langsung mempublikasikan
  const illegalPublish = await fetch(`${baseUrl}/api/admin/posts/${post.id}/transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: contribAuth.cookie,
      'X-CSRF-Token': contribAuth.csrfToken
    },
    body: JSON.stringify({ targetStatus: 'published' })
  });
  assert.equal(illegalPublish.status, 400); // invalid direct transition OR 403

  // Kontributor submit
  const submitRes = await fetch(`${baseUrl}/api/admin/posts/${post.id}/transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: contribAuth.cookie,
      'X-CSRF-Token': contribAuth.csrfToken
    },
    body: JSON.stringify({ targetStatus: 'submitted' })
  });
  assert.equal(submitRes.status, 200);
  assert.equal((await submitRes.json()).post.status, 'submitted');

  // Editor minta revisi
  const revRes = await fetch(`${baseUrl}/api/admin/posts/${post.id}/transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: editorAuth.cookie,
      'X-CSRF-Token': editorAuth.csrfToken
    },
    body: JSON.stringify({ targetStatus: 'revision_required', notes: 'Tambahkan nama anggota tim debat.' })
  });
  assert.equal(revRes.status, 200);
  assert.equal((await revRes.json()).post.status, 'revision_required');

  // Kontributor submit ulang, lalu Editor publikasikan
  await fetch(`${baseUrl}/api/admin/posts/${post.id}/transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: contribAuth.cookie,
      'X-CSRF-Token': contribAuth.csrfToken
    },
    body: JSON.stringify({ targetStatus: 'submitted' })
  });

  const pubRes = await fetch(`${baseUrl}/api/admin/posts/${post.id}/transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: editorAuth.cookie,
      'X-CSRF-Token': editorAuth.csrfToken
    },
    body: JSON.stringify({ targetStatus: 'published', notes: 'Lengkap dan disetujui.' })
  });
  assert.equal(pubRes.status, 200);
  assert.equal((await pubRes.json()).post.status, 'published');

  // Kini tampil di portal publik
  const publicRes = await fetch(`${baseUrl}/api/public/posts/${post.slug}`);
  assert.equal(publicRes.status, 200);
});

test('UAT-05 & CSRF: Pengguna tanpa login dan request tanpa CSRF ditolak', async () => {
  const unauthRes = await fetch(`${baseUrl}/api/admin/dashboard`);
  assert.equal(unauthRes.status, 401);

  const adminAuth = await loginAs('admin@websekolah.sch.id', 'AdminSekolah#2026');
  const noCsrfRes = await fetch(`${baseUrl}/api/admin/announcements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminAuth.cookie
    },
    body: JSON.stringify({ title: 'Tanpa CSRF', body: 'Harus ditolak' })
  });
  assert.equal(noCsrfRes.status, 403);
});

test('UAT-06: Formulir kontak publik menyimpan pesan valid dan menolak honeypot spam', async () => {
  resetContactLimiter();
  const spamRes = await fetch(`${baseUrl}/api/public/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Bot Spam',
      email: 'bot@spam.example',
      subject: 'Promo Iklan',
      message: 'Klik tautan ini sekarang juga!',
      website: 'http://spam.example'
    })
  });
  assert.equal(spamRes.status, 400);

  const validRes = await fetch(`${baseUrl}/api/public/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Wali Murid X',
      email: 'wali@example.com',
      subject: 'Jadwal Pengambilan Rapor',
      message: 'Mohon informasi jadwal pengambilan rapor semester gasal kelas X.'
    })
  });
  assert.equal(validRes.status, 201);
  const data = await validRes.json();
  assert.ok(data.id > 0);
});

test('UAT-07: Upload file berbahaya / tipe tidak diizinkan ditolak', async () => {
  const adminAuth = await loginAs('admin@websekolah.sch.id', 'AdminSekolah#2026');
  const form = new FormData();
  form.append('title', 'Script Berbahaya');
  form.append('alt_text', 'Tes upload');
  form.append('file', new Blob(['<?php system($_GET["c"]); ?>'], { type: 'application/x-php' }), 'shell.php');

  const res = await fetch(`${baseUrl}/api/admin/media`, {
    method: 'POST',
    headers: {
      Cookie: adminAuth.cookie,
      'X-CSRF-Token': adminAuth.csrfToken
    },
    body: form
  });
  assert.equal(res.status, 400);
  const errData = await res.json();
  assert.equal(errData.error.code, 'INVALID_FILE_TYPE');
});

test('UAT-08: Super Admin menonaktifkan akun langsung membatalkan sesi aktif dan menolak login', async () => {
  const superAuth = await loginAs('superadmin@websekolah.sch.id', 'SuperAdmin#2026');
  const targetAuth = await loginAs('admin.baru@websekolah.sch.id', 'PasswordKuat#2026');

  const deactRes = await fetch(`${baseUrl}/api/admin/users/${targetAuth.user.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: superAuth.cookie,
      'X-CSRF-Token': superAuth.csrfToken
    },
    body: JSON.stringify({ status: 'inactive' })
  });
  assert.equal(deactRes.status, 200);

  // Sesi yang sebelumnya aktif langsung ditolak
  const stillActiveCheck = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: targetAuth.cookie }
  });
  assert.equal(stillActiveCheck.status, 401);

  // Login ulang juga ditolak
  resetRateLimiters();
  const relogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin.baru@websekolah.sch.id', password: 'PasswordKuat#2026' })
  });
  assert.equal(relogin.status, 403);
});
