# Website Resmi & CMS Portal WebSekolah

Implementasi full-stack **Modular Monolith** sesuai dokumen **Software Architecture Design (SAD) v1.0** untuk portal resmi **WebSekolah**.

## Arsitektur & Fitur Utama
- **Runtime & Storage**: Node.js (`>=22.5`, menggunakan `node:http`, `node:sqlite`, `node:crypto`) tanpa ketergantungan eksternal pihak ketiga, dengan penyimpanan file media terpisah di `storage/uploads/`.
- **Portal Publik (`/`)**:
  - Struktur navigasi sesuai SAD Bagian 8.1: Beranda, Profil (Sejarah, Visi & Misi, Struktur Organisasi, Sarana & Prasarana), Akademik, Kesiswaan, Berita (pencarian & filter kategori), Pengumuman (berdasarkan masa tayang `start_at`–`end_at`), Agenda, Galeri, PPDB/SPMB, Kontak (dengan honeypot & rate limit), dan Kebijakan Privasi.
  - Metadata SEO, `sitemap.xml`, dan `robots.txt`.
- **Dashboard CMS & RBAC (`/admin`)**:
  - **Level Pengguna Utama**:
    - **Super Admin (`super_admin`)**: Akses penuh — dapat **membuat user Admin Sekolah baru** (maupun peran lain), mengubah peran, mengaktifkan/menonaktifkan akun, melihat **Audit Log**, dan mengubah **Pengaturan Sistem**.
    - **Admin Sekolah (`admin_sekolah`)**: Mengelola konten berita, pengumuman, agenda, halaman statis, profil sekolah, galeri/media, dan permintaan informasi. Diblokir secara tegas (`403 Forbidden`) pada manajemen user/peran, audit sistem sensitif, dan pengaturan sistem.
    - Peran pendukung SAD lainnya (`editor`, `kontributor`, `petugas_layanan`) juga tersedia untuk demonstrasi workflow editorial penuh.
  - **Workflow Konten (SAD Bagian 6.5)**: `draft → submitted → in_review → revision_required / approved → scheduled / published → archived`, lengkap dengan riwayat tinjauan (`post_reviews`).
  - **Keamanan (SAD Bagian 9)**: Password hashing `scrypt`, cookie sesi `HttpOnly` + `SameSite=Lax` bertanda tangan HMAC, token CSRF, proteksi XSS, validasi magic-byte & whitelist upload file, serta audit logging.

## Cara Menjalankan
```bash
npm run seed   # Inisialisasi database & akun demo
npm start      # Menjalankan server di http://127.0.0.1:4100 (ubah dengan env PORT=...)
npm test       # Menjalankan pengujian otomatis (UAT-01 s.d. UAT-08 + RBAC)
```

## Akun Demo Default
| Peran | Email | Password |
| :--- | :--- | :--- |
| **Super Admin** | `superadmin@websekolah.sch.id` | `SuperAdmin#2026` |
| **Admin Sekolah** | `admin@websekolah.sch.id` | `AdminSekolah#2026` |
| Editor / Humas | `editor@websekolah.sch.id` | `Editor#2026` |
| Kontributor | `kontributor@websekolah.sch.id` | `Kontributor#2026` |
| Petugas Layanan | `layanan@websekolah.sch.id` | `Layanan#2026` |
