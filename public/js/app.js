const mainEl = document.getElementById('main-content');
const navToggle = document.getElementById('nav-toggle');
const primaryNav = document.getElementById('primary-nav');

let homeCache = null;

function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatWibDate(iso, withTime = false) {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'long',
      ...(withTime ? { timeStyle: 'short' } : {}),
      timeZone: 'Asia/Jakarta'
    }).format(new Date(iso)) + (withTime ? ' WIB' : '');
  } catch {
    return iso;
  }
}

async function apiGet(url) {
  return window.WebSekolahApi.request(url, { method: 'GET' });
}

function mediaSrc(item) {
  return window.WebSekolahApi.getMediaSrc(item);
}

function updateSeo(title, description) {
  document.title = `${title} | WebSekolah`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc && description) {
    metaDesc.setAttribute('content', description);
  }
}

function populateChrome(data) {
  const pm = data.profileMap || {};
  const st = data.settings || {};
  document.getElementById('util-npsn').textContent = pm.npsn || '20403174';
  document.getElementById('util-akreditasi').textContent = pm.accreditation || 'A (Unggul)';
  document.getElementById('util-hours').textContent = pm.service_hours || 'Senin – Jumat, 07.30 – 15.00 WIB';
  document.getElementById('footer-address').textContent = pm.address || '';
  document.getElementById('footer-phone').textContent = pm.phone || '';
  document.getElementById('footer-email').textContent = pm.email || '';

  const banner = document.getElementById('maintenance-banner');
  if (st.maintenance_banner && st.maintenance_banner.trim()) {
    banner.textContent = st.maintenance_banner;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function renderBreadcrumb(crumbs) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="/" data-link>Beranda</a>
    ${crumbs.map((c, idx) => idx === crumbs.length - 1
      ? `<span aria-hidden="true">/</span><span>${esc(c.label)}</span>`
      : `<span aria-hidden="true">/</span><a href="${esc(c.href)}" data-link>${esc(c.label)}</a>`
    ).join('')}
  </nav>`;
}

async function renderHome() {
  const data = homeCache || await apiGet('/api/public/home');
  homeCache = data;
  populateChrome(data);
  const pm = data.profileMap || {};
  const st = data.settings || {};
  updateSeo(st.site_title || 'WebSekolah — Portal Resmi Sekolah', st.site_tagline);

  const featuredPosts = data.posts || [];
  const announcements = (data.announcements || []).slice(0, 3);
  const events = (data.events || []).slice(0, 4);
  const gallery = (data.gallery || []).slice(0, 3);

  mainEl.innerHTML = `
    <section class="hero">
      <div class="container hero-grid">
        <div>
          <span class="hero-kicker">Portal Informasi Resmi Sekolah</span>
          <h1>${esc(pm.school_name || 'WebSekolah')}</h1>
          <p class="hero-tagline">${esc(st.site_tagline || 'Unggul dalam Prestasi, Luhur dalam Budi Pekerti, Berakar pada Budaya')}</p>
          <div class="hero-actions">
            <a href="/profil/visi-misi" data-link class="btn btn-gold">Profil & Visi Misi</a>
            <a href="/ppdb" data-link class="btn btn-outline-light">Informasi PPDB/SPMB</a>
            <a href="/berita" data-link class="btn btn-outline-light">Berita Sekolah</a>
          </div>
        </div>
        <aside class="hero-card" aria-label="Identitas Ringkas Sekolah">
          <h2>Identitas Resmi Sekolah</h2>
          <ul class="hero-facts">
            <li><span>Sebutan</span><strong>${esc(pm.nickname || 'WebSekolah')}</strong></li>
            <li><span>NPSN</span><strong>${esc(pm.npsn || '20403174')}</strong></li>
            <li><span>Akreditasi</span><strong>${esc(pm.accreditation || 'A (Unggul)')}</strong></li>
            <li><span>Kepala Sekolah</span><strong>${esc(pm.principal_name || '-')}</strong></li>
            <li><span>Layanan Informasi</span><strong>${esc(pm.service_hours || '-')}</strong></li>
          </ul>
        </aside>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <div>
            <h2>Berita & Prestasi Terbaru</h2>
            <p>Publikasi resmi yang telah melalui proses kurasi dan verifikasi redaksi sekolah.</p>
          </div>
          <a href="/berita" data-link class="btn btn-outline">Semua Berita →</a>
        </div>
        <div class="grid-3">
          ${featuredPosts.map((p) => `
            <article class="card">
              ${(p.cover_storage_key || p.cover_public_url)
                ? `<img class="card-cover" src="${esc(mediaSrc(p))}" alt="${esc(p.cover_alt_text || p.title)}" loading="lazy" />`
                : `<div class="card-cover" aria-hidden="true"></div>`}
              <div class="card-body">
                <div class="card-meta">
                  <span class="badge">${esc(p.category_name)}</span>
                  <span>${esc(formatWibDate(p.published_at))}</span>
                </div>
                <h3><a href="/berita/${esc(p.slug)}" data-link>${esc(p.title)}</a></h3>
                <p>${esc(p.excerpt)}</p>
                <a class="card-link" href="/berita/${esc(p.slug)}" data-link>Baca selengkapnya →</a>
              </div>
            </article>
          `).join('')}
        </div>
      </div>
    </section>

    <section class="section section-alt">
      <div class="container split-layout">
        <div>
          <div class="section-head">
            <div>
              <h2>Pengumuman Resmi</h2>
              <p>Informasi penting yang berlaku saat ini.</p>
            </div>
            <a href="/pengumuman" data-link class="btn btn-outline">Lihat Semua</a>
          </div>
          <div class="announcement-list">
            ${announcements.length ? announcements.map((a) => `
              <article class="announcement-item priority-${esc(a.priority)}">
                <div class="card-meta">
                  <span class="badge badge-${esc(a.priority)}">${esc(a.priority.toUpperCase())}</span>
                  <span>Berlaku: ${esc(formatWibDate(a.start_at))}${a.end_at ? ` s.d. ${esc(formatWibDate(a.end_at))}` : ''}</span>
                </div>
                <h3>${esc(a.title)}</h3>
                <p>${esc(a.body)}</p>
              </article>
            `).join('') : '<p>Belum ada pengumuman aktif.</p>'}
          </div>
        </div>

        <div>
          <div class="section-head">
            <div>
              <h2>Agenda Kegiatan</h2>
              <p>Jadwal kegiatan akademik & kesiswaan.</p>
            </div>
            <a href="/agenda" data-link class="btn btn-outline">Kalender</a>
          </div>
          <div class="event-list">
            ${events.length ? events.map((ev) => {
              const d = new Date(ev.start_at);
              const day = Number.isNaN(d.getTime()) ? '--' : d.toLocaleDateString('id-ID', { day: '2-digit', timeZone: 'Asia/Jakarta' });
              const month = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('id-ID', { month: 'short', timeZone: 'Asia/Jakarta' });
              return `
                <article class="event-item">
                  <div class="event-date-box" aria-hidden="true">
                    <div class="day">${esc(day)}</div>
                    <div class="month">${esc(month)}</div>
                  </div>
                  <div>
                    <h3 style="margin:0 0 4px;font-size:1.03rem;">${esc(ev.title)}</h3>
                    <div class="card-meta" style="margin-bottom:6px;">
                      <span>📍 ${esc(ev.location)}</span>
                      <span>• ${esc(formatWibDate(ev.start_at, true))}</span>
                    </div>
                    <p style="margin:0;font-size:0.9rem;color:var(--ink-700);">${esc(ev.description)}</p>
                  </div>
                </article>
              `;
            }).join('') : '<p>Belum ada agenda terjadwal.</p>'}
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section-head">
          <div>
            <h2>Galeri Dokumentasi</h2>
            <p>Potret kegiatan, prestasi, dan fasilitas lingkungan WebSekolah.</p>
          </div>
          <a href="/galeri" data-link class="btn btn-outline">Jelajahi Galeri →</a>
        </div>
        <div class="grid-3">
          ${gallery.map((g) => `
            <figure class="card gallery-card" style="margin:0;">
              <img src="${esc(mediaSrc(g))}" alt="${esc(g.alt_text || g.title)}" loading="lazy" />
              <figcaption class="card-body">
                <span class="badge" style="align-self:flex-start;margin-bottom:8px;">${esc(g.category)}</span>
                <strong style="color:var(--navy-900);">${esc(g.title)}</strong>
              </figcaption>
            </figure>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

async function renderStaticPage(slug, sectionLabel, routePath) {
  if (!homeCache) {
    homeCache = await apiGet('/api/public/home');
    populateChrome(homeCache);
  }
  const { page } = await apiGet(`/api/public/pages/${encodeURIComponent(slug)}`);
  updateSeo(page.title, page.summary);
  const pm = homeCache.profileMap || {};

  const crumbs = sectionLabel && sectionLabel !== page.title
    ? [{ label: sectionLabel, href: routePath }, { label: page.title }]
    : [{ label: page.title }];

  const extraProfileTable = slug === 'struktur-organisasi' || slug === 'sejarah'
    ? `<div class="article-panel" style="margin-top:24px;">
        <h2 style="margin-top:0;font-family:var(--font-serif);color:var(--navy-900);">Data Resmi Sekolah</h2>
        <div class="grid-2">
          ${(homeCache.profiles || []).map((row) => `
            <div style="padding:10px 12px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;">
              <div style="font-size:0.8rem;color:var(--ink-500);">${esc(row.field_label)}</div>
              <div style="font-weight:700;color:var(--navy-900);">${esc(row.field_value)}</div>
            </div>
          `).join('')}
        </div>
      </div>`
    : '';

  const extraPpdbBanner = slug === 'ppdb-spmb'
    ? `<div class="article-panel" style="margin-top:24px;border-left:5px solid var(--gold-500);">
        <h2 style="margin-top:0;color:var(--navy-900);">Tautan Kanal Resmi PPDB/SPMB</h2>
        <p>Untuk pendaftaran dan pengumuman hasil seleksi resmi, silakan akses portal resmi dinas pendidikan setempat:</p>
        <div style="display:flex;flex-wrap:wrap;gap:12px;">
          <a class="btn btn-primary" href="${esc(pm.ppdb_official_url || 'https://ppdb.websekolah.sch.id')}" target="_blank" rel="noopener noreferrer">Buka Portal PPDB/SPMB Resmi ↗</a>
          <a class="btn btn-outline" href="/kontak" data-link>Tanya Petugas Layanan</a>
        </div>
      </div>`
    : '';

  mainEl.innerHTML = `
    <section class="page-banner">
      <div class="container">
        ${renderBreadcrumb(crumbs)}
        <h1>${esc(page.title)}</h1>
        <p>${esc(page.summary)}</p>
      </div>
    </section>
    <section class="section">
      <div class="container">
        <article class="article-panel">
          <div class="card-meta" style="margin-bottom:18px;">
            <span class="badge">${esc(page.section)}</span>
            <span>Diperbarui: ${esc(formatWibDate(page.updated_at, true))}</span>
          </div>
          <div class="article-body">${esc(page.body)}</div>
        </article>
        ${extraProfileTable}
        ${extraPpdbBanner}
      </div>
    </section>
  `;
}

async function renderBeritaList() {
  if (!homeCache) {
    homeCache = await apiGet('/api/public/home');
    populateChrome(homeCache);
  }
  updateSeo('Berita Sekolah', 'Kumpulan berita resmi, prestasi siswa, dan liputan kegiatan WebSekolah.');
  const categories = homeCache.categories || [];

  mainEl.innerHTML = `
    <section class="page-banner">
      <div class="container">
        ${renderBreadcrumb([{ label: 'Berita' }])}
        <h1>Berita & Liputan Resmi</h1>
        <p>Informasi terverifikasi seputar prestasi, kegiatan akademik, kesiswaan, dan kerjasama WebSekolah.</p>
      </div>
    </section>
    <section class="section">
      <div class="container">
        <form id="news-filter-form" class="filter-bar">
          <label class="skip-link" for="news-search">Cari berita</label>
          <input id="news-search" class="input" type="search" placeholder="Cari judul atau kata kunci berita..." />
          <label class="skip-link" for="news-cat">Filter kategori</label>
          <select id="news-cat" class="select">
            <option value="">Semua Kategori</option>
            ${categories.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('')}
          </select>
          <button type="submit" class="btn btn-primary">Cari</button>
        </form>
        <div id="news-results" class="grid-3"></div>
      </div>
    </section>
  `;

  async function loadNews() {
    const q = document.getElementById('news-search').value.trim();
    const cat = document.getElementById('news-cat').value;
    const params = new URLSearchParams();
    if (q) params.set('search', q);
    if (cat) params.set('category', cat);
    const { items } = await apiGet(`/api/public/posts?${params.toString()}`);
    const box = document.getElementById('news-results');
    if (!items.length) {
      box.innerHTML = `<div class="article-panel" style="grid-column:1/-1;text-align:center;">Tidak ada berita yang sesuai dengan pencarian Anda.</div>`;
      return;
    }
    box.innerHTML = items.map((p) => `
      <article class="card">
        ${(p.cover_storage_key || p.cover_public_url)
          ? `<img class="card-cover" src="${esc(mediaSrc(p))}" alt="${esc(p.cover_alt_text || p.title)}" loading="lazy" />`
          : `<div class="card-cover" aria-hidden="true"></div>`}
        <div class="card-body">
          <div class="card-meta">
            <span class="badge">${esc(p.category_name)}</span>
            <span>${esc(formatWibDate(p.published_at))}</span>
          </div>
          <h3><a href="/berita/${esc(p.slug)}" data-link>${esc(p.title)}</a></h3>
          <p>${esc(p.excerpt)}</p>
          <div style="font-size:0.82rem;color:var(--ink-500);margin-bottom:10px;">Oleh: ${esc(p.author_name)} (${esc(p.author_unit)})</div>
          <a class="card-link" href="/berita/${esc(p.slug)}" data-link>Baca selengkapnya →</a>
        </div>
      </article>
    `).join('');
  }

  document.getElementById('news-filter-form').addEventListener('submit', (e) => {
    e.preventDefault();
    loadNews();
  });
  document.getElementById('news-cat').addEventListener('change', loadNews);
  await loadNews();
}

async function renderBeritaDetail(slug) {
  if (!homeCache) {
    homeCache = await apiGet('/api/public/home');
    populateChrome(homeCache);
  }
  const { post } = await apiGet(`/api/public/posts/${encodeURIComponent(slug)}`);
  updateSeo(post.title, post.excerpt);

  mainEl.innerHTML = `
    <section class="page-banner">
      <div class="container">
        ${renderBreadcrumb([{ label: 'Berita', href: '/berita' }, { label: post.title }])}
        <h1>${esc(post.title)}</h1>
        <p>${esc(post.category_name)} • Dipublikasikan ${esc(formatWibDate(post.published_at, true))} • Oleh ${esc(post.author_name)} (${esc(post.author_unit)})</p>
      </div>
    </section>
    <section class="section">
      <div class="container">
        <article class="article-panel">
          ${(post.cover_storage_key || post.cover_public_url)
            ? `<figure style="margin:0 0 24px;">
                <img src="${esc(mediaSrc(post))}" alt="${esc(post.cover_alt_text || post.title)}" style="width:100%;max-height:420px;object-fit:cover;border-radius:10px;" />
                <figcaption style="font-size:0.84rem;color:var(--ink-500);margin-top:8px;">${esc(post.cover_alt_text || post.title)}</figcaption>
              </figure>`
            : ''}
          <div class="article-body">${esc(post.body)}</div>
          <div style="margin-top:28px;padding-top:18px;border-top:1px solid var(--border);">
            <a href="/berita" data-link class="btn btn-outline">← Kembali ke Daftar Berita</a>
          </div>
        </article>
      </div>
    </section>
  `;
}

async function renderAnnouncements() {
  if (!homeCache) {
    homeCache = await apiGet('/api/public/home');
    populateChrome(homeCache);
  }
  const { items } = await apiGet('/api/public/announcements');
  updateSeo('Pengumuman Resmi', 'Pengumuman resmi WebSekolah yang masih berlaku.');

  mainEl.innerHTML = `
    <section class="page-banner">
      <div class="container">
        ${renderBreadcrumb([{ label: 'Pengumuman' }])}
        <h1>Pengumuman Resmi Sekolah</h1>
        <p>Pengumuman aktif sesuai masa tayang yang ditetapkan oleh sekolah.</p>
      </div>
    </section>
    <section class="section">
      <div class="container announcement-list">
        ${items.length ? items.map((a) => `
          <article class="announcement-item priority-${esc(a.priority)}">
            <div class="card-meta">
              <span class="badge badge-${esc(a.priority)}">${esc(a.priority.toUpperCase())}</span>
              <span>Mulai: ${esc(formatWibDate(a.start_at, true))}</span>
              ${a.end_at ? `<span>• Berakhir: ${esc(formatWibDate(a.end_at, true))}</span>` : ''}
            </div>
            <h2 style="margin:0 0 8px;color:var(--navy-900);font-size:1.25rem;">${esc(a.title)}</h2>
            <p style="margin:0;white-space:pre-line;">${esc(a.body)}</p>
          </article>
        `).join('') : '<div class="article-panel">Tidak ada pengumuman aktif saat ini.</div>'}
      </div>
    </section>
  `;
}

async function renderAgenda() {
  if (!homeCache) {
    homeCache = await apiGet('/api/public/home');
    populateChrome(homeCache);
  }
  const { items } = await apiGet('/api/public/events');
  updateSeo('Agenda Sekolah', 'Kalender dan jadwal agenda kegiatan WebSekolah.');

  mainEl.innerHTML = `
    <section class="page-banner">
      <div class="container">
        ${renderBreadcrumb([{ label: 'Agenda' }])}
        <h1>Agenda Kegiatan Sekolah</h1>
        <p>Jadwal kegiatan akademik, kesiswaan, dan pertemuan resmi WebSekolah.</p>
      </div>
    </section>
    <section class="section">
      <div class="container event-list">
        ${items.length ? items.map((ev) => `
          <article class="event-item">
            <div class="event-date-box" aria-hidden="true">
              <div class="day">${esc(new Date(ev.start_at).toLocaleDateString('id-ID', { day: '2-digit', timeZone: 'Asia/Jakarta' }))}</div>
              <div class="month">${esc(new Date(ev.start_at).toLocaleDateString('id-ID', { month: 'short', timeZone: 'Asia/Jakarta' }))}</div>
            </div>
            <div>
              <h2 style="margin:0 0 6px;font-size:1.2rem;color:var(--navy-900);">${esc(ev.title)}</h2>
              <div class="card-meta">
                <span>🗓 ${esc(formatWibDate(ev.start_at, true))}</span>
                <span>• 📍 ${esc(ev.location)}</span>
                <span>• Penyelenggara: ${esc(ev.organizer)}</span>
              </div>
              <p style="margin:6px 0 0;">${esc(ev.description)}</p>
            </div>
          </article>
        `).join('') : '<div class="article-panel">Belum ada agenda kegiatan terjadwal.</div>'}
      </div>
    </section>
  `;
}

async function renderGallery() {
  if (!homeCache) {
    homeCache = await apiGet('/api/public/home');
    populateChrome(homeCache);
  }
  const { items } = await apiGet('/api/public/gallery');
  updateSeo('Galeri Dokumentasi', 'Dokumentasi foto dan arsip media kegiatan WebSekolah.');

  const images = items.filter((m) => m.mime_type.startsWith('image/'));
  const docs = items.filter((m) => m.mime_type === 'application/pdf');

  mainEl.innerHTML = `
    <section class="page-banner">
      <div class="container">
        ${renderBreadcrumb([{ label: 'Galeri' }])}
        <h1>Galeri & Dokumentasi Media</h1>
        <p>Dokumentasi foto kegiatan serta dokumen informasi publik resmi WebSekolah.</p>
      </div>
    </section>
    <section class="section">
      <div class="container">
        <div class="grid-3">
          ${images.map((g) => `
            <figure class="card gallery-card" style="margin:0;">
              <img src="${esc(mediaSrc(g))}" alt="${esc(g.alt_text || g.title)}" loading="lazy" />
              <figcaption class="card-body">
                <span class="badge" style="align-self:flex-start;margin-bottom:8px;">${esc(g.category)}</span>
                <strong style="color:var(--navy-900);margin-bottom:6px;">${esc(g.title)}</strong>
                <span style="font-size:0.84rem;color:var(--ink-500);">${esc(g.alt_text)}</span>
              </figcaption>
            </figure>
          `).join('')}
        </div>
        ${docs.length ? `
          <div class="article-panel" style="margin-top:32px;">
            <h2 style="margin-top:0;color:var(--navy-900);">Dokumen Unduhan Resmi (PDF)</h2>
            <ul>
              ${docs.map((d) => `<li><a href="${esc(mediaSrc(d))}" target="_blank" rel="noopener">${esc(d.title)}</a> (${Math.round(d.size / 1024)} KB)</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    </section>
  `;
}

async function renderContact() {
  if (!homeCache) {
    homeCache = await apiGet('/api/public/home');
    populateChrome(homeCache);
  }
  const pm = homeCache.profileMap || {};
  updateSeo('Kontak & Layanan Informasi', 'Formulir resmi permintaan informasi WebSekolah.');

  mainEl.innerHTML = `
    <section class="page-banner">
      <div class="container">
        ${renderBreadcrumb([{ label: 'Kontak' }])}
        <h1>Kontak & Permintaan Informasi</h1>
        <p>Sampaikan pertanyaan akademik, layanan legalisir, atau permintaan informasi resmi sekolah.</p>
      </div>
    </section>
    <section class="section">
      <div class="container split-layout">
        <div class="article-panel">
          <h2 style="margin-top:0;font-family:var(--font-serif);color:var(--navy-900);">Formulir Permintaan Informasi</h2>
          <div id="contact-feedback"></div>
          <form id="contact-form" class="form-grid" novalidate>
            <div class="honeypot" aria-hidden="true">
              <label for="c-website">Kosongkan kolom ini</label>
              <input id="c-website" name="website" type="text" tabindex="-1" autocomplete="off" />
            </div>
            <div class="form-field">
              <label for="c-name">Nama Lengkap *</label>
              <input id="c-name" class="input" name="name" required minlength="2" placeholder="Nama lengkap Anda" />
            </div>
            <div class="grid-2">
              <div class="form-field">
                <label for="c-email">Alamat Email *</label>
                <input id="c-email" class="input" name="email" type="email" required placeholder="nama@contoh.com" />
              </div>
              <div class="form-field">
                <label for="c-phone">Nomor Telepon / WhatsApp (Opsional)</label>
                <input id="c-phone" class="input" name="phone" type="tel" placeholder="08xxxxxxxxxx" />
              </div>
            </div>
            <div class="form-field">
              <label for="c-subject">Subjek Permintaan *</label>
              <input id="c-subject" class="input" name="subject" required minlength="4" placeholder="Contoh: Informasi Legalisir / PPDB" />
            </div>
            <div class="form-field">
              <label for="c-message">Pesan / Pertanyaan *</label>
              <textarea id="c-message" class="textarea" name="message" rows="5" required minlength="10" placeholder="Tuliskan pertanyaan Anda secara jelas..."></textarea>
            </div>
            <p style="font-size:0.84rem;color:var(--ink-500);margin:0;">
              Data Anda hanya digunakan untuk menindaklanjuti permintaan informasi sesuai <a href="/privasi" data-link>Kebijakan Privasi</a> sekolah.
            </p>
            <div>
              <button type="submit" class="btn btn-primary">Kirim Permintaan Informasi</button>
            </div>
          </form>
        </div>

        <aside class="article-panel">
          <h2 style="margin-top:0;font-family:var(--font-serif);color:var(--navy-900);">Alamat & Jam Layanan</h2>
          <p><strong>${esc(pm.school_name || 'WebSekolah')}</strong><br/>${esc(pm.address || '')}</p>
          <p><strong>Telepon:</strong> ${esc(pm.phone || '-')}<br/>
             <strong>Email:</strong> ${esc(pm.email || '-')}<br/>
             <strong>Jam Layanan:</strong> ${esc(pm.service_hours || '-')}</p>
          <hr style="border:none;border-top:1px solid var(--border);margin:18px 0;" />
          <h3 style="margin:0 0 8px;color:var(--navy-900);">Catatan Tata Kelola</h3>
          <p style="font-size:0.92rem;color:var(--ink-700);margin:0;">
            Setiap pesan yang masuk dicatat ke dalam sistem layanan informasi dan diteruskan ke Petugas Layanan atau Admin Sekolah untuk ditindaklanjuti.
          </p>
        </aside>
      </div>
    </section>
  `;

  document.getElementById('contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fb = document.getElementById('contact-feedback');
    const payload = {
      name: form.name.value,
      email: form.email.value,
      phone: form.phone.value,
      subject: form.subject.value,
      message: form.message.value,
      website: form.website.value
    };
    try {
      const data = await window.WebSekolahApi.request('/api/public/contact', {
        method: 'POST',
        body: payload
      });
      fb.innerHTML = `<div class="alert alert-success" role="status"><strong>Berhasil (Nomor Tiket #${esc(data.id)}):</strong> ${esc(data.confirmation)}</div>`;
      form.reset();
    } catch (err) {
      fb.innerHTML = `<div class="alert alert-error" role="alert">${esc(err.message)}</div>`;
    }
  });
}

async function route() {
  const p = window.location.pathname;
  primaryNav.classList.remove('open');
  navToggle.setAttribute('aria-expanded', 'false');

  try {
    if (p === '/' || p === '') {
      await renderHome();
    } else if (p === '/profil/sejarah') {
      await renderStaticPage('sejarah', 'Profil', '/profil/sejarah');
    } else if (p === '/profil/visi-misi') {
      await renderStaticPage('visi-misi', 'Profil', '/profil/visi-misi');
    } else if (p === '/profil/struktur-organisasi') {
      await renderStaticPage('struktur-organisasi', 'Profil', '/profil/struktur-organisasi');
    } else if (p === '/profil/sarana-prasarana') {
      await renderStaticPage('sarana-prasarana', 'Profil', '/profil/sarana-prasarana');
    } else if (p === '/akademik') {
      await renderStaticPage('akademik', 'Akademik', '/akademik');
    } else if (p === '/kesiswaan') {
      await renderStaticPage('kesiswaan', 'Kesiswaan', '/kesiswaan');
    } else if (p === '/ppdb') {
      await renderStaticPage('ppdb-spmb', 'PPDB/SPMB', '/ppdb');
    } else if (p === '/privasi') {
      await renderStaticPage('kebijakan-privasi', 'Privasi', '/privasi');
    } else if (p === '/berita') {
      await renderBeritaList();
    } else if (p.startsWith('/berita/')) {
      const slug = decodeURIComponent(p.slice('/berita/'.length));
      await renderBeritaDetail(slug);
    } else if (p === '/pengumuman') {
      await renderAnnouncements();
    } else if (p === '/agenda') {
      await renderAgenda();
    } else if (p === '/galeri') {
      await renderGallery();
    } else if (p === '/kontak') {
      await renderContact();
    } else {
      mainEl.innerHTML = `<section class="section"><div class="container article-panel"><h1>Halaman Tidak Ditemukan (404)</h1><p>Tautan yang Anda tuju tidak tersedia.</p><a href="/" data-link class="btn btn-primary">Kembali ke Beranda</a></div></section>`;
    }
  } catch (err) {
    mainEl.innerHTML = `<section class="section"><div class="container article-panel"><h1>Terjadi Kesalahan</h1><p>${esc(err.message)}</p><a href="/" data-link class="btn btn-primary">Kembali ke Beranda</a></div></section>`;
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-link]');
  if (link) {
    e.preventDefault();
    const href = link.getAttribute('href');
    if (href && href !== window.location.pathname) {
      window.history.pushState({}, '', href);
    }
    route();
  }
});

navToggle.addEventListener('click', () => {
  const open = primaryNav.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
});

document.querySelectorAll('.dropdown-trigger').forEach((btn) => {
  btn.addEventListener('click', () => {
    const parent = btn.closest('.has-dropdown');
    const isOpen = parent.classList.toggle('open');
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
});

window.addEventListener('popstate', route);
// Restore route redirected from GitHub Pages 404.html
(function restoreGhPagesRoute() {
  const sp = new URLSearchParams(window.location.search);
  const redirected = sp.get('__route');
  if (redirected) {
    window.history.replaceState({}, '', redirected);
  }
})();
route();
