-- =============================================================================
-- WebSekolah — Seed Data Awal untuk Supabase
-- Jalankan SETELAH 001_websekolah_schema.sql dan SETELAH membuat user Super Admin
-- pertama di Supabase Auth (Authentication -> Users -> Add user).
-- =============================================================================

-- Kategori Berita
INSERT INTO public.categories (name, slug, description) VALUES
  ('Prestasi Siswa', 'prestasi-siswa', 'Capaian akademik dan non-akademik peserta didik WebSekolah.'),
  ('Kegiatan Sekolah', 'kegiatan-sekolah', 'Liputan kegiatan belajar, upacara, seminar, dan program unggulan.'),
  ('Akademik & Kurikulum', 'akademik-kurikulum', 'Informasi pembelajaran, asesmen, riset, dan bimbingan studi lanjut.'),
  ('Kesiswaan & Ekstrakurikuler', 'kesiswaan-ekskul', 'Aktivitas OSIS, ekstrakurikuler, dan pembinaan karakter siswa.'),
  ('Humas & Kerjasama', 'humas-kerjasama', 'Kunjungan institusi, kemitraan universitas, dan pengabdian masyarakat.')
ON CONFLICT (slug) DO NOTHING;

-- Profil Terstruktur Sekolah
INSERT INTO public.school_profiles (field_key, field_label, field_value) VALUES
  ('school_name', 'Nama Resmi Sekolah', 'WebSekolah'),
  ('nickname', 'Sebutan / Identitas', 'Portal Resmi WebSekolah'),
  ('npsn', 'NPSN', '20403174'),
  ('accreditation', 'Akreditasi', 'A (Unggul)'),
  ('principal_name', 'Kepala Sekolah', 'Drs. Bambang Suryanto, M.Pd.'),
  ('address', 'Alamat Lengkap', 'Jl. Pendidikan No. 1, Indonesia'),
  ('phone', 'Telepon Resmi', '(021) 512856'),
  ('email', 'Email Resmi', 'info@negerisugaria.com'),
  ('service_hours', 'Jam Layanan Informasi', 'Senin – Jumat, 07.30 – 15.00 WIB'),
  ('ppdb_official_url', 'Tautan Kanal Resmi PPDB/SPMB', 'https://negerisugaria.com/ppdb')
ON CONFLICT (field_key) DO NOTHING;

-- Pengaturan Website
INSERT INTO public.site_settings (key, value, description) VALUES
  ('site_title', 'WebSekolah — Portal Resmi Sekolah', 'Judul utama portal publik pada metadata SEO'),
  ('site_tagline', 'Unggul dalam Prestasi, Luhur dalam Budi Pekerti, Berakar pada Budaya', 'Tagline hero beranda'),
  ('require_principal_approval_for_featured', 'true', 'Wajib persetujuan pimpinan untuk konten unggulan tertentu (SAD 3.2)'),
  ('contact_auto_ack_message', 'Terima kasih. Permintaan informasi Anda telah tercatat pada sistem layanan WebSekolah dan akan segera ditindaklanjuti pada jam kerja.', 'Pesan konfirmasi setelah pengiriman formulir kontak'),
  ('maintenance_banner', '', 'Pesan pengumuman darurat di atas header bila diisi')
ON CONFLICT (key) DO NOTHING;

-- Halaman Statis Sesuai Navigasi SAD 8.1
INSERT INTO public.pages (title, slug, section, summary, body, status) VALUES
  (
    'Sejarah WebSekolah',
    'sejarah',
    'Profil',
    'Jejak perjalanan WebSekolah dalam membangun pusat keunggulan akademik, karakter, dan literasi digital.',
    E'WebSekolah didirikan sebagai institusi pendidikan menengah yang mengedepankan integritas, keilmuan, dan pelayanan publik berbasis transparansi informasi.\n\nSepanjang perjalanannya, WebSekolah terus bertransformasi memadukan nilai-nilai karakter kebangsaan, pembinaan riset peserta didik, serta pemanfaatan teknologi informasi secara bertanggung jawab.',
    'published'
  ),
  (
    'Visi, Misi, dan Tujuan Sekolah',
    'visi-misi',
    'Profil',
    'Arah strategis WebSekolah dalam membentuk insan beriman, berkarakter Pancasila, unggul dalam prestasi, dan berwawasan global.',
    E'VISI SEKOLAH:\n"Terwujudnya peserta didik yang beriman dan bertakwa, berakhlak mulia, berkarakter kebangsaan, unggul dalam ilmu pengetahuan dan teknologi, berbudaya, serta berwawasan lingkungan dan global."\n\nMISI SEKOLAH:\n1. Menyelenggarakan pembelajaran aktif, inovatif, dan berbasis riset.\n2. Menanamkan nilai integritas, etika, gotong royong, dan kepedulian sosial.\n3. Mengembangkan ekosistem literasi digital dan keterampilan abad ke-21.\n4. Membangun tata kelola layanan pendidikan yang transparan dan akuntabel.',
    'published'
  ),
  (
    'Struktur Organisasi',
    'struktur-organisasi',
    'Profil',
    'Susunan kepemimpinan, wakil kepala sekolah, tata usaha, dan unit penjaminan mutu WebSekolah.',
    E'• Kepala Sekolah: Penanggung jawab kebijakan mutu dan representasi institusi.\n• Wakasek Kurikulum: Pengelolaan program akademik dan riset siswa.\n• Wakasek Kesiswaan: Pembinaan OSIS/MPK, ekstrakurikuler, dan prestasi.\n• Wakasek Sarpras: Pengelolaan fasilitas dan laboratorium.\n• Wakasek Humas: Publikasi resmi dan kemitraan.\n• Kepala Tata Usaha: Layanan administrasi dan kearsipan.',
    'published'
  ),
  (
    'Sarana dan Prasarana',
    'sarana-prasarana',
    'Profil',
    'Dukungan ruang belajar representatif, laboratorium sains & komputer, perpustakaan digital, serta fasilitas olahraga dan seni.',
    E'• Ruang Kelas Berbasis Multimedia terkoneksi internet kampus.\n• Laboratorium Fisika, Kimia, Biologi, Komputer, dan Bahasa.\n• Perpustakaan Digital & Ruang Diskusi.\n• Aula Utama, Rumah Ibadah, Lapangan Olahraga, dan UKS.',
    'published'
  ),
  (
    'Program Akademik',
    'akademik',
    'Akademik',
    'Implementasi Kurikulum Merdeka, penguatan riset siswa, pembinaan olimpiade sains, dan layanan bimbingan studi lanjut.',
    E'WebSekolah menerapkan Kurikulum Merdeka dengan pembelajaran mendalam, diferensiasi minat, serta Projek Penguatan Profil Pelajar Pancasila (P5).',
    'published'
  ),
  (
    'Kesiswaan & Ekstrakurikuler',
    'kesiswaan',
    'Kesiswaan',
    'Wadah kepemimpinan OSIS/MPK serta puluhan ekstrakurikuler sains, seni budaya, olahraga, dan jurnalistik.',
    E'Organisasi & Ekstrakurikuler meliputi OSIS, MPK, Pramuka, PMR, KIR, English Club, Robotika, Jurnalistik, Paduan Suara, Teater, Basket, Futsal, dan Panahan.',
    'published'
  ),
  (
    'Informasi PPDB / SPMB',
    'ppdb-spmb',
    'PPDB/SPMB',
    'Pusat informasi resmi Penerimaan Peserta Didik Baru (PPDB/SPMB) WebSekolah.',
    E'Pelaksanaan PPDB/SPMB mengikuti petunjuk teknis dan jadwal resmi Dinas Pendidikan. Portal ini berfungsi sebagai pusat informasi resmi sekolah.',
    'published'
  ),
  (
    'Kebijakan Privasi & Layanan Informasi',
    'kebijakan-privasi',
    'Privasi',
    'Komitmen perlindungan data pribadi pengunjung dan tata kelola informasi publik.',
    E'WebSekolah hanya mengumpulkan data minimal pada formulir kontak untuk menindaklanjuti permintaan informasi sesuai regulasi perlindungan data pribadi di Indonesia.',
    'published'
  )
ON CONFLICT (slug) DO NOTHING;

-- Catatan:
-- Setelah membuat user Super Admin pertama di Supabase Authentication -> Users,
-- jalankan perintah berikut (ganti UUID dan email sesuai user yang Anda buat):
--
-- INSERT INTO public.profiles (id, role_name, name, email, unit, status)
-- SELECT id, 'super_admin', 'Super Admin WebSekolah', email, 'Tim TI & Pimpinan', 'active'
-- FROM auth.users
-- WHERE email = 'superadmin@negerisugaria.com'
-- ON CONFLICT (id) DO UPDATE SET role_name = 'super_admin', status = 'active';
