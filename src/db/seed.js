import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getDb } from './database.js';
import { hashPassword } from '../modules/identity/password.js';
import { config, nowIso } from '../config/env.js';

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function generateGradientPng(width, height, rgbStart, rgbEnd, accentRgb) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    const ty = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x++) {
      const tx = x / Math.max(1, width - 1);
      const t = tx * 0.45 + ty * 0.55;
      let r = Math.round(rgbStart[0] + (rgbEnd[0] - rgbStart[0]) * t);
      let g = Math.round(rgbStart[1] + (rgbEnd[1] - rgbStart[1]) * t);
      let b = Math.round(rgbStart[2] + (rgbEnd[2] - rgbStart[2]) * t);

      const dx = Math.abs(x - width / 2);
      const dy = Math.abs(y - height / 2);
      if (dx < width * 0.22 && dy < height * 0.12 && (dx > width * 0.205 || dy > height * 0.105)) {
        [r, g, b] = accentRgb;
      }
      if (y > height - 12) {
        [r, g, b] = accentRgb;
      }

      const idx = 1 + x * 3;
      row[idx] = r;
      row[idx + 1] = g;
      row[idx + 2] = b;
    }
    rawRows.push(row);
  }

  const compressed = zlib.deflateSync(Buffer.concat(rawRows));
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

export function seedDatabase(db, { uploadDir = config.uploadDir } = {}) {
  const roleCount = db.prepare('SELECT COUNT(*) AS count FROM roles').get().count;
  if (roleCount > 0) {
    return { seeded: false, reason: 'already_seeded' };
  }

  const now = nowIso();
  fs.mkdirSync(uploadDir, { recursive: true });

  const permissionsList = [
    ['users.manage', 'Mengelola akun pengguna dan status aktif/nonaktif'],
    ['roles.manage', 'Menetapkan atau mengubah peran pengguna'],
    ['settings.manage', 'Mengelola konfigurasi website dan kebijakan sistem'],
    ['audit.view', 'Melihat catatan jejak aktivitas (audit log)'],
    ['reports.view', 'Melihat laporan ringkas konten dan aktivitas'],
    ['content.create', 'Membuat dan mengubah draf berita/konten milik sendiri'],
    ['content.manage', 'Mengelola seluruh berita dan kategori'],
    ['content.review', 'Meninjau, meminta revisi, dan menyetujui konten'],
    ['content.publish', 'Menjadwalkan, mempublikasikan, dan mengarsipkan konten'],
    ['announcements.manage', 'Mengelola pengumuman sekolah'],
    ['events.manage', 'Mengelola agenda kegiatan sekolah'],
    ['media.manage', 'Mengunggah dan mengelola file media/galeri'],
    ['pages.manage', 'Mengelola halaman statis sekolah'],
    ['profile.manage', 'Mengelola profil terstruktur sekolah'],
    ['contact.manage', 'Melihat dan menindaklanjuti permintaan informasi']
  ];

  const insertPerm = db.prepare('INSERT INTO permissions (code, description) VALUES (?, ?)');
  const permIds = {};
  for (const [code, desc] of permissionsList) {
    const info = insertPerm.run(code, desc);
    permIds[code] = Number(info.lastInsertRowid);
  }

  const rolesDef = [
    {
      name: 'super_admin',
      display_name: 'Super Admin',
      description: 'Mengelola seluruh konfigurasi sistem, pengguna, peran (termasuk membuat Admin Sekolah baru), konten, audit log, dan pengaturan website.',
      perms: permissionsList.map(([c]) => c)
    },
    {
      name: 'admin_sekolah',
      display_name: 'Admin Sekolah',
      description: 'Mengelola profil sekolah, halaman statis, berita, kategori, pengumuman, agenda, galeri/media, permintaan informasi, dan laporan; tidak dapat mengelola akun/peran Super Admin maupun membuat user baru.',
      perms: [
        'reports.view',
        'content.create',
        'content.manage',
        'content.review',
        'content.publish',
        'announcements.manage',
        'events.manage',
        'media.manage',
        'pages.manage',
        'profile.manage',
        'contact.manage'
      ]
    },
    {
      name: 'editor',
      display_name: 'Editor / Humas',
      description: 'Meninjau, mengoreksi, meminta revisi, menyetujui, menjadwalkan, dan mempublikasikan konten berita serta pengumuman.',
      perms: [
        'reports.view',
        'content.create',
        'content.review',
        'content.publish',
        'announcements.manage',
        'events.manage',
        'media.manage'
      ]
    },
    {
      name: 'kontributor',
      display_name: 'Kontributor / Guru / Unit',
      description: 'Membuat dan mengubah draf berita miliknya, mengunggah media pendukung, serta mengirimkan konten untuk ditinjau Editor.',
      perms: ['content.create', 'media.manage']
    },
    {
      name: 'petugas_layanan',
      display_name: 'Petugas Layanan Informasi',
      description: 'Melihat dan menindaklanjuti tiket permintaan informasi dari masyarakat dan orang tua.',
      perms: ['contact.manage']
    }
  ];

  const insertRole = db.prepare('INSERT INTO roles (name, display_name, description, created_at) VALUES (?, ?, ?, ?)');
  const insertRolePerm = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
  const roleIds = {};
  for (const r of rolesDef) {
    const info = insertRole.run(r.name, r.display_name, r.description, now);
    const rId = Number(info.lastInsertRowid);
    roleIds[r.name] = rId;
    for (const pCode of r.perms) {
      insertRolePerm.run(rId, permIds[pCode]);
    }
  }

  const insertUser = db.prepare(`
    INSERT INTO users (role_id, name, email, password_hash, unit, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `);

  const superAdminId = Number(
    insertUser.run(
      roleIds.super_admin,
      'Drs. Bambang Suryanto, M.Pd.',
      'superadmin@websekolah.sch.id',
      hashPassword('SuperAdmin#2026'),
      'Tim TI & Pimpinan WebSekolah',
      now,
      now
    ).lastInsertRowid
  );

  const adminSekolahId = Number(
    insertUser.run(
      roleIds.admin_sekolah,
      'Ratna Kusuma Wardhani, S.Pd.',
      'admin@websekolah.sch.id',
      hashPassword('AdminSekolah#2026'),
      'Tata Usaha & Humas WebSekolah',
      now,
      now
    ).lastInsertRowid
  );

  const editorId = Number(
    insertUser.run(
      roleIds.editor,
      'Adi Nugroho, S.S.',
      'editor@websekolah.sch.id',
      hashPassword('Editor#2026'),
      'Tim Publikasi & Humas',
      now,
      now
    ).lastInsertRowid
  );

  const kontributorId = Number(
    insertUser.run(
      roleIds.kontributor,
      'Dewi Lestari, M.Sc.',
      'kontributor@websekolah.sch.id',
      hashPassword('Kontributor#2026'),
      'Unit Kesiswaan & Olimpiade',
      now,
      now
    ).lastInsertRowid
  );

  const petugasId = Number(
    insertUser.run(
      roleIds.petugas_layanan,
      'Hendra Wijaya',
      'layanan@websekolah.sch.id',
      hashPassword('Layanan#2026'),
      'PPID & Layanan Informasi',
      now,
      now
    ).lastInsertRowid
  );

  const insertCat = db.prepare('INSERT INTO categories (name, slug, description, created_at) VALUES (?, ?, ?, ?)');
  const categories = [
    ['Prestasi Siswa', 'prestasi-siswa', 'Capaian akademik dan non-akademik peserta didik WebSekolah.'],
    ['Kegiatan Sekolah', 'kegiatan-sekolah', 'Liputan kegiatan belajar, upacara, seminar, dan program unggulan.'],
    ['Akademik & Kurikulum', 'akademik-kurikulum', 'Informasi pembelajaran, asesmen, riset, dan bimbingan studi lanjut.'],
    ['Kesiswaan & Ekstrakurikuler', 'kesiswaan-ekskul', 'Aktivitas OSIS, ekstrakurikuler, dan pembinaan karakter siswa.'],
    ['Humas & Kerjasama', 'humas-kerjasama', 'Kunjungan institusi, kemitraan universitas, dan pengabdian masyarakat.']
  ];
  const catIds = {};
  for (const [name, slug, desc] of categories) {
    const info = insertCat.run(name, slug, desc, now);
    catIds[slug] = Number(info.lastInsertRowid);
  }

  const insertMedia = db.prepare(`
    INSERT INTO media (uploader_id, title, original_name, storage_key, mime_type, size, alt_text, category, created_at)
    VALUES (?, ?, ?, ?, 'image/png', ?, ?, ?, ?)
  `);

  const mediaSamples = [
    {
      title: 'Gedung Utama Kampus WebSekolah',
      filename: 'gedung-websekolah.png',
      alt: 'Fasad gedung utama WebSekolah yang bersih, tertata, dan ramah lingkungan',
      category: 'Profil & Sarpras',
      colors: [[15, 35, 66], [36, 75, 130], [200, 150, 46]]
    },
    {
      title: 'Tim Olimpiade Sains Nasional WebSekolah',
      filename: 'tim-osn-websekolah.png',
      alt: 'Siswa berprestasi WebSekolah penerima medali Olimpiade Sains Nasional',
      category: 'Prestasi',
      colors: [[20, 58, 92], [44, 108, 148], [218, 170, 62]]
    },
    {
      title: 'WebSekolah Science & Innovation Expo',
      filename: 'science-expo.png',
      alt: 'Pameran karya riset ilmiah siswa di aula utama WebSekolah',
      category: 'Akademik',
      colors: [[28, 48, 82], [65, 95, 135], [220, 165, 55]]
    },
    {
      title: 'Perpustakaan Digital & Ruang Riset Siswa',
      filename: 'perpustakaan-digital.png',
      alt: 'Ruang baca modern dan akses referensi digital di Perpustakaan WebSekolah',
      category: 'Fasilitas',
      colors: [[18, 42, 72], [52, 86, 122], [195, 145, 45]]
    }
  ];

  const mediaIds = [];
  for (const m of mediaSamples) {
    const key = `seed-${m.filename}`;
    const pngBuf = generateGradientPng(480, 300, m.colors[0], m.colors[1], m.colors[2]);
    fs.writeFileSync(path.join(uploadDir, key), pngBuf);
    const info = insertMedia.run(adminSekolahId, m.title, m.filename, key, pngBuf.length, m.alt, m.category, now);
    mediaIds.push(Number(info.lastInsertRowid));
  }

  const insertPost = db.prepare(`
    INSERT INTO posts (author_id, category_id, title, slug, excerpt, body, cover_media_id, is_featured, requires_principal_approval, status, published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const daysAhead = (d) => new Date(Date.now() + d * 86400000).toISOString();

  const post1Id = Number(
    insertPost.run(
      kontributorId,
      catIds['prestasi-siswa'],
      'Kontingen WebSekolah Raih 5 Medali Olimpiade Sains Nasional 2026',
      'kontingen-websekolah-raih-5-medali-osn-2026',
      'Lima delegasi WebSekolah berhasil membawa pulang medali emas dan perak pada bidang Matematika, Fisika, Informatika, dan Biologi tingkat nasional.',
      'Kabar membanggakan datang dari kontingen Olimpiade Sains Nasional (OSN) WebSekolah pada ajang OSN Tahun 2026. Sebanyak lima peserta didik meraih 2 medali emas dan 3 medali perak setelah melalui rangkaian seleksi ketat mulai dari tingkat daerah hingga nasional.\n\nKepala Sekolah menyampaikan apresiasi tinggi kepada para pembina, guru pendamping, serta orang tua yang telah mendukung proses pembinaan intensif melalui Kelompok Ilmiah Remaja (KIR) dan Klinik Riset WebSekolah.\n\nCapaian ini memperkuat komitmen WebSekolah dalam membangun budaya riset, berpikir kritis, dan karakter unggul berintegritas.',
      mediaIds[1],
      1,
      0,
      'published',
      daysAgo(2),
      daysAgo(4),
      daysAgo(2)
    ).lastInsertRowid
  );

  insertPost.run(
    adminSekolahId,
    catIds['akademik-kurikulum'],
    'Peluncuran Program WebSekolah Research Fellowship dan Kelas Kolaborasi Riset',
    'peluncuran-websekolah-research-fellowship',
    'Program pendampingan karya tulis ilmiah dan proyek lintas disiplin untuk mempersiapkan siswa menghadapi kompetisi riset dan perguruan tinggi terbaik.',
    'WebSekolah resmi membuka program Research Fellowship bagi siswa kelas X dan XI. Program ini memadukan kurikulum merdeka dengan pendampingan metodologi riset oleh dosen mitra dari perguruan tinggi serta alumni WebSekolah.\n\nSiswa peserta program akan memilih topik riset strategis mulai dari energi terbarukan, kecerdasan buatan terapan, hingga pelestarian budaya nusantara.',
    mediaIds[2],
    1,
    0,
    'published',
    daysAgo(5),
    daysAgo(6),
    daysAgo(5)
  );

  insertPost.run(
    editorId,
    catIds['kegiatan-sekolah'],
    'Peringatan Hari Jadi WebSekolah: Merawat Tradisi Prestasi dan Pengabdian',
    'peringatan-hari-jadi-websekolah',
    'Rangkaian acara refleksi sejarah, pentas budaya, bakti sosial, dan temu alumni lintas angkatan digelar di Kampus WebSekolah.',
    'Bertempat di lingkungan kampus WebSekolah, keluarga besar sekolah menyelenggarakan rangkaian Hari Jadi sekolah dengan mengusung semangat "Berakar Kuat pada Karakter, Melangkah Pasti Menuju Masa Depan".\n\nAcara meliputi upacara, pameran arsip sekolah, diskusi karier bersama alumni, serta santunan pendidikan bagi masyarakat sekitar.',
    mediaIds[0],
    1,
    1,
    'published',
    daysAgo(9),
    daysAgo(11),
    daysAgo(9)
  );

  insertPost.run(
    adminSekolahId,
    catIds['humas-kerjasama'],
    'Kunjungan Akademik dan Penandatanganan Nota Kesepahaman Literasi Digital',
    'kunjungan-akademik-literasi-digital',
    'Penguatan kompetensi literasi digital, keamanan siber dasar, dan etika informasi bagi siswa WebSekolah.',
    'Dalam upaya membekali siswa dengan kecakapan abad ke-21, WebSekolah menjalin kerja sama pelatihan literasi digital dan keamanan informasi bagi pengurus OSIS, MPK, serta tim jurnalis sekolah.\n\nPelatihan ini menekankan verifikasi sumber informasi, etika bermedia sosial, dan perlindungan data pribadi.',
    mediaIds[3],
    0,
    0,
    'published',
    daysAgo(14),
    daysAgo(15),
    daysAgo(14)
  );

  const reviewPostId = Number(
    insertPost.run(
      kontributorId,
      catIds['kesiswaan-ekskul'],
      'Persiapan Pekan Olahraga dan Seni Pelajar Tahun 2026',
      'persiapan-porseni-websekolah-2026',
      'Draf liputan kesiapan tim basket, paduan suara, dan debat bahasa Inggris menjelang Porseni tingkat daerah.',
      'Tim ekstrakurikuler WebSekolah menjalani pemusatan latihan rutin setiap sore untuk menghadapi Pekan Olahraga dan Seni Pelajar.',
      mediaIds[0],
      0,
      0,
      'in_review',
      null,
      daysAgo(1),
      daysAgo(1)
    ).lastInsertRowid
  );

  insertPost.run(
    kontributorId,
    catIds['akademik-kurikulum'],
    'Jadwal Simulasi Asesmen Literasi dan Numerasi Semester Genap',
    'simulasi-asesmen-semester-genap',
    'Draf panduan teknis pelaksanaan simulasi asesmen berbasis komputer untuk kelas XI.',
    'Seluruh peserta didik kelas XI diharapkan memeriksa pembagian ruang laboratorium komputer sebelum pelaksanaan simulasi.',
    null,
    0,
    0,
    'revision_required',
    null,
    daysAgo(3),
    daysAgo(2)
  );

  insertPost.run(
    editorId,
    catIds['kegiatan-sekolah'],
    'Agenda Wisuda Purna Siswa Angkatan 2027 (Terjadwal)',
    'agenda-wisuda-purna-siswa-2027',
    'Rilis resmi persiapan pelepasan peserta didik kelas XII akan tayang sesuai jadwal pengumuman panitia.',
    'Informasi lengkap mengenai susunan acara dan ketentuan tamu undangan akan dipublikasikan otomatis pada tanggal yang telah dijadwalkan.',
    mediaIds[0],
    0,
    1,
    'scheduled',
    daysAhead(5),
    daysAgo(1),
    daysAgo(1)
  );

  const insertReview = db.prepare(`
    INSERT INTO post_reviews (post_id, reviewer_id, decision, notes, reviewed_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertReview.run(post1Id, editorId, 'published', 'Bahasa sesuai kaidah jurnalistik sekolah dan data medali terverifikasi.', daysAgo(2));
  insertReview.run(reviewPostId, editorId, 'in_review', 'Sedang diperiksa kesesuaian nama pembina cabang olahraga.', daysAgo(1));

  const insertAnn = db.prepare(`
    INSERT INTO announcements (author_id, title, body, priority, start_at, end_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertAnn.run(
    adminSekolahId,
    'Informasi Resmi Penerimaan Peserta Didik Baru (PPDB/SPMB) Tahun Ajaran 2026/2027',
    'Seluruh informasi daya tampung, jalur pendaftaran, jadwal verifikasi berkas, dan tautan portal resmi Dinas Pendidikan tersedia pada menu PPDB/SPMB. Masyarakat diimbau tidak mempercayai informasi di luar kanal resmi WebSekolah.',
    'penting',
    daysAgo(3),
    daysAhead(45),
    'published',
    now,
    now
  );
  insertAnn.run(
    editorId,
    'Pelaksanaan Penilaian Sumatif Akhir Semester Gasal Tahun Ajaran 2026/2027',
    'Penilaian Sumatif Akhir Semester dilaksanakan secara tertib pada pekan pertama Desember 2026. Peserta didik wajib membawa kartu peserta ujian dan hadir 15 menit sebelum sesi dimulai.',
    'mendesak',
    daysAgo(1),
    daysAhead(20),
    'published',
    now,
    now
  );
  insertAnn.run(
    adminSekolahId,
    'Layanan Legalisir Ijazah & Transkrip Alumni',
    'Pelayanan legalisir dokumen alumni dibuka setiap hari kerja Senin–Jumat pukul 08.00–14.00 WIB di Loket Tata Usaha WebSekolah.',
    'normal',
    daysAgo(10),
    daysAhead(90),
    'published',
    now,
    now
  );

  const insertEvent = db.prepare(`
    INSERT INTO events (author_id, title, description, start_at, end_at, location, organizer, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
  `);
  insertEvent.run(
    adminSekolahId,
    'Sosialisasi Kurikulum & Persiapan Studi Lanjut Orang Tua Kelas XII',
    'Pertemuan koordinasi antara pimpinan sekolah, tim Bimbingan Konseling, dan orang tua/wali siswa kelas XII membahas strategi SNBP, SNBT, dan beasiswa internasional.',
    daysAhead(4),
    daysAhead(4),
    'Aula Utama WebSekolah',
    'Wakasek Kurikulum & Tim BK',
    now,
    now
  );
  insertEvent.run(
    editorId,
    'WebSekolah Science & Innovation Expo 2026',
    'Pameran karya ilmiah remaja, demo robotika, dan presentasi poster riset siswa WebSekolah terbuka untuk pelajar SMP/SMA.',
    daysAhead(11),
    daysAhead(12),
    'Hall Utama & Laboratorium Terpadu WebSekolah',
    'KIR WebSekolah & OSIS',
    now,
    now
  );
  insertEvent.run(
    adminSekolahId,
    'Rapat Kerja Evaluasi Mutu Pembelajaran Semester Gasal',
    'Evaluasi capaian pembelajaran, program literasi, serta kalender kegiatan semester genap bersama seluruh dewan guru dan tenaga kependidikan.',
    daysAhead(18),
    daysAhead(18),
    'Ruang Sidang Utama WebSekolah',
    'Kepala Sekolah & Manajemen Mutu',
    now,
    now
  );

  const insertPage = db.prepare(`
    INSERT INTO pages (title, slug, section, summary, body, status, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, 'published', ?, ?)
  `);
  const staticPages = [
    [
      'Sejarah WebSekolah',
      'sejarah',
      'Profil',
      'Jejak perjalanan WebSekolah dalam membangun pusat keunggulan akademik, karakter, dan literasi digital.',
      'WebSekolah didirikan sebagai institusi pendidikan menengah yang mengedepankan integritas, keilmuan, dan pelayanan publik berbasis transparansi informasi.\n\nSepanjang perjalanannya, WebSekolah terus bertransformasi memadukan nilai-nilai karakter kebangsaan, pembinaan riset peserta didik, serta pemanfaatan teknologi informasi secara bertanggung jawab.\n\nHingga kini, WebSekolah terus menjaga harmoni antara prestasi akademik, budaya sekolah yang inklusif, dan tata kelola layanan pendidikan yang modern.',
    ],
    [
      'Visi, Misi, dan Tujuan Sekolah',
      'visi-misi',
      'Profil',
      'Arah strategis WebSekolah dalam membentuk insan beriman, berkarakter Pancasila, unggul dalam prestasi, dan berwawasan global.',
      'VISI SEKOLAH:\n"Terwujudnya peserta didik yang beriman dan bertakwa, berakhlak mulia, berkarakter kebangsaan, unggul dalam ilmu pengetahuan dan teknologi, berbudaya, serta berwawasan lingkungan dan global."\n\nMISI SEKOLAH:\n1. Menyelenggarakan pembelajaran aktif, inovatif, dan berbasis riset yang mengembangkan potensi akademik dan non-akademik secara optimal.\n2. Menanamkan nilai integritas, etika, gotong royong, dan kepedulian sosial dalam kehidupan sehari-hari.\n3. Mengembangkan ekosistem literasi digital, keterampilan abad ke-21, dan penguasaan bahasa asing.\n4. Mendorong kepedulian lingkungan hidup melalui program sekolah hijau yang berkelanjutan.\n5. Membangun tata kelola layanan pendidikan yang transparan, akuntabel, dan kolaboratif bersama orang tua, alumni, dan masyarakat.',
    ],
    [
      'Struktur Organisasi',
      'struktur-organisasi',
      'Profil',
      'Susunan kepemimpinan, wakil kepala sekolah, tata usaha, dan unit penjaminan mutu WebSekolah.',
      'Tata kelola WebSekolah dijalankan secara kolaboratif oleh unsur pimpinan dan unit pelaksana:\n\n• Kepala Sekolah: Penanggung jawab kebijakan mutu, manajemen pendidikan, dan representasi institusi.\n• Wakil Kepala Sekolah Bidang Kurikulum: Pengelolaan program akademik, asesmen, riset siswa, dan pengembangan pembelajaran.\n• Wakil Kepala Sekolah Bidang Kesiswaan: Pembinaan OSIS/MPK, ekstrakurikuler, prestasi lomba, dan pembinaan karakter.\n• Wakil Kepala Sekolah Bidang Sarana & Prasarana: Pengelolaan fasilitas, laboratorium, ruang belajar, dan keamanan lingkungan.\n• Wakil Kepala Sekolah Bidang Humas & Kerjasama: Publikasi resmi, komunikasi orang tua/alumni, PPID, dan kemitraan eksternal.\n• Kepala Tata Usaha: Layanan administrasi kepegawaian, persuratan, kearsipan, dan layanan legalisir.\n• Tim Pengelola Website & Layanan Informasi: Menjamin akurasi konten, workflow persetujuan publikasi, serta keamanan portal resmi.',
    ],
    [
      'Sarana dan Prasarana',
      'sarana-prasarana',
      'Profil',
      'Dukungan ruang belajar representatif, laboratorium sains & komputer, perpustakaan digital, serta fasilitas olahraga dan seni.',
      'Untuk mendukung pembelajaran berbasis riset dan pengembangan minat bakat, WebSekolah dilengkapi berbagai fasilitas:\n\n• 27 Ruang Kelas Berbasis Multimedia yang nyaman dan terkoneksi jaringan internet kampus.\n• Laboratorium Fisika, Kimia, Biologi, dan Ruang Riset KIR berstandar olimpiade.\n• Laboratorium Komputer & Bahasa dengan perangkat modern untuk asesmen dan pemrograman.\n• Perpustakaan Sekolah dengan koleksi cetak, ruang diskusi, dan katalog digital.\n• Aula Utama WebSekolah sebagai pusat seminar, kegiatan seni budaya, dan pertemuan sekolah.\n• Rumah Ibadah, Lapangan Basket/Futsal, Ruang Musik, dan Unit Kesehatan Sekolah (UKS).',
    ],
    [
      'Program Akademik',
      'akademik',
      'Akademik',
      'Implementasi Kurikulum Merdeka, penguatan riset siswa, pembinaan olimpiade sains, dan layanan bimbingan studi lanjut.',
      'WebSekolah menerapkan Kurikulum Merdeka dengan pendekatan pembelajaran mendalam (deep learning), diferensiasi minat peserta didik, serta Projek Penguatan Profil Pelajar Pancasila (P5).\n\nProgram Unggulan Akademik:\n1. Pembinaan Olimpiade Sains & Riset (OSN, OPSI, LKIR) dengan pendampingan intensif.\n2. Layanan Bimbingan Konseling dan Pemetaan Studi Lanjut (SNBP, SNBT, PTN/PTS, dan Universitas Luar Negeri).\n3. Klinik Akademik dan Program Literasi-Numerasi Terpadu.\n4. Kolaborasi pembelajaran berbasis proyek bersama perguruan tinggi mitra dan praktisi.',
    ],
    [
      'Kesiswaan & Ekstrakurikuler',
      'kesiswaan',
      'Kesiswaan',
      'Wadah kepemimpinan OSIS/MPK serta puluhan ekstrakurikuler sains, seni budaya, olahraga, jurnalistik, dan kepemimpinan.',
      'Pembinaan kesiswaan di WebSekolah diarahkan untuk menyeimbangkan kecerdasan intelektual, kepemimpinan, kreativitas, dan empati sosial.\n\nOrganisasi & Ekstrakurikuler:\n• Kepemimpinan & Sosial: OSIS WebSekolah, MPK, Pramuka, PMR, PKS.\n• Ilmiah & Bahasa: Kelompok Ilmiah Remaja (KIR), English Club, Jurnalistik & Fotografi, Robotika.\n• Seni & Budaya: Paduan Suara, Teater, Tari Tradisional & Modern, Band.\n• Olahraga: Basket, Futsal, Bulu Tangkis, Panahan, Pencak Silat, dan Atletik.',
    ],
    [
      'Informasi PPDB / SPMB',
      'ppdb-spmb',
      'PPDB/SPMB',
      'Pusat informasi resmi Penerimaan Peserta Didik Baru (PPDB/SPMB) WebSekolah merujuk pada ketentuan Dinas Pendidikan.',
      'PERHATIAN RESMI:\nPelaksanaan Penerimaan Peserta Didik Baru (PPDB / SPMB) WebSekolah sepenuhnya mengikuti petunjuk teknis dan jadwal resmi Dinas Pendidikan.\n\nJalur Pendaftaran Umum (mengacu regulasi berlaku):\n1. Jalur Zonasi / Domisili\n2. Jalur Afirmasi\n3. Jalur Perpindahan Tugas Orang Tua/Wali\n4. Jalur Prestasi Akademik & Non-Akademik\n\nCatatan Penting:\n• Website ini berfungsi sebagai portal informasi resmi sekolah, bukan sistem pendaftaran transaksional.\n• Pendaftaran, pemeringkatan, dan pengumuman hasil seleksi dilakukan melalui portal resmi PPDB/SPMB Dinas Pendidikan.\n• Apabila memerlukan klarifikasi informasi jadwal atau berkas verifikasi, masyarakat dapat menghubungi Petugas Layanan Informasi melalui menu Kontak atau loket resmi sekolah.',
    ],
    [
      'Kebijakan Privasi & Layanan Informasi',
      'kebijakan-privasi',
      'Privasi',
      'Komitmen perlindungan data pribadi pengunjung dan tata kelola informasi publik sesuai regulasi perlindungan data pribadi di Indonesia.',
      'WebSekolah berkomitmen menjaga privasi pengunjung website:\n\n1. Pengumpulan Data Minimal: Formulir kontak hanya meminta nama, alamat email, nomor telepon (opsional), subjek, dan pesan yang diperlukan untuk menindaklanjuti permintaan informasi.\n2. Tujuan Pemrosesan: Data digunakan semata-mata oleh Petugas Layanan Informasi / Admin Sekolah yang berwenang untuk menjawab pertanyaan atau layanan administrasi.\n3. Keamanan & Retensi: Seluruh akses dashboard dilindungi autentikasi terenkripsi dan pencatatan audit. Data pribadi siswa, guru, atau orang tua tidak dipublikasikan ke halaman terbuka tanpa dasar hukum dan persetujuan yang sah.\n4. Hak Pengunjung: Anda dapat mengajukan permintaan koreksi atau penghapusan pesan informasi melalui kontak resmi Tata Usaha WebSekolah.',
    ]
  ];

  for (const [title, slug, section, summary, body] of staticPages) {
    insertPage.run(title, slug, section, summary, body, adminSekolahId, now);
  }

  const insertProfile = db.prepare(`
    INSERT INTO school_profiles (field_key, field_label, field_value, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const profileRows = [
    ['school_name', 'Nama Resmi Sekolah', 'WebSekolah', adminSekolahId],
    ['nickname', 'Sebutan / Identitas', 'Portal Resmi WebSekolah', adminSekolahId],
    ['npsn', 'NPSN', '20403174', adminSekolahId],
    ['accreditation', 'Akreditasi', 'A (Unggul)', adminSekolahId],
    ['principal_name', 'Kepala Sekolah', 'Drs. Bambang Suryanto, M.Pd.', adminSekolahId],
    ['address', 'Alamat Lengkap', 'Jl. Pendidikan No. 1, Indonesia', adminSekolahId],
    ['phone', 'Telepon Resmi', '(021) 512856', adminSekolahId],
    ['email', 'Email Resmi', 'info@websekolah.sch.id', adminSekolahId],
    ['service_hours', 'Jam Layanan Informasi', 'Senin – Jumat, 07.30 – 15.00 WIB', adminSekolahId],
    ['ppdb_official_url', 'Tautan Kanal Resmi PPDB/SPMB', 'https://ppdb.websekolah.sch.id', adminSekolahId]
  ];
  for (const [k, label, val, uid] of profileRows) {
    insertProfile.run(k, label, val, uid, now);
  }

  const insertSetting = db.prepare(`
    INSERT INTO site_settings (key, value, description, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const settingsRows = [
    ['site_title', 'WebSekolah — Portal Resmi Sekolah', 'Judul utama portal publik pada metadata SEO'],
    ['site_tagline', 'Unggul dalam Prestasi, Luhur dalam Budi Pekerti, Berakar pada Budaya', 'Tagline hero beranda'],
    ['require_principal_approval_for_featured', 'true', 'Wajib persetujuan pimpinan/pejabat untuk konten unggulan tertentu (SAD 3.2)'],
    ['contact_auto_ack_message', 'Terima kasih. Permintaan informasi Anda telah tercatat pada sistem layanan WebSekolah dan akan segera ditindaklanjuti pada jam kerja.', 'Pesan konfirmasi setelah pengiriman formulir kontak'],
    ['maintenance_banner', '', 'Pesan pengumuman darurat di atas header bila diisi']
  ];
  for (const [k, v, d] of settingsRows) {
    insertSetting.run(k, v, d, superAdminId, now);
  }

  const insertMsg = db.prepare(`
    INSERT INTO contact_messages (name, email, phone, subject, message, status, assigned_to, response_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMsg.run(
    'Siti Aminah',
    'siti.aminah@example.com',
    '081234567890',
    'Pertanyaan Jadwal Verifikasi Berkas PPDB Jalur Prestasi',
    'Selamat pagi Bapak/Ibu, mohon informasi jam layanan verifikasi dokumen piagam prestasi di WebSekolah.',
    'new',
    petugasId,
    '',
    daysAgo(1),
    daysAgo(1)
  );
  insertMsg.run(
    'Budi Santoso (Alumni 2008)',
    'budi.alumni@example.com',
    '081398765432',
    'Permohonan Informasi Legalisir Ijazah',
    'Apakah layanan legalisir ijazah dapat diwakilkan dengan surat kuasa bermeterai?',
    'resolved',
    petugasId,
    'Sudah dijawab via email: diperbolehkan membawa surat kuasa bermeterai, fotokopi KTP pemberi & penerima kuasa, serta ijazah asli.',
    daysAgo(4),
    daysAgo(3)
  );

  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (user_id, actor_email, action, entity_type, entity_id, metadata, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, '127.0.0.1', ?)
  `);
  insertAudit.run(
    superAdminId,
    'superadmin@websekolah.sch.id',
    'SYSTEM_SEED',
    'system',
    'initial',
    JSON.stringify({ message: 'Inisialisasi database awal WebSekolah sesuai SAD v1.0' }),
    now
  );

  return { seeded: true };
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const db = getDb();
  const res = seedDatabase(db);
  console.log('Seed result:', res);
}
