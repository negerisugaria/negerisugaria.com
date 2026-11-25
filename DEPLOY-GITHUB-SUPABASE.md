# Panduan Deploy WebSekolah ke `https://negerisugaria.com/` (GitHub Pages + Supabase)

Arsitektur ini berjalan **100% tanpa VPS / tanpa server Node.js**:
- **Frontend Statis**: GitHub Pages (`https://github.com/negerisugaria/negerisugaria.com`) → Domain `https://negerisugaria.com/`.
- **Database, Auth, Storage, & User Management**: Supabase (PostgreSQL + RLS + Auth + Storage + Edge Function `manage-users`).

---

## Langkah 1 — Siapkan Proyek Supabase (Gratis)
1. Buka [https://supabase.com](https://supabase.com) → **New Project** (pilih region Singapore `ap-southeast-1`).
2. Masuk ke **SQL Editor → New Query**, jalankan seluruh isi file:
   - `supabase/migrations/001_websekolah_schema.sql`
   - `supabase/seed.sql`
3. Buat akun **Super Admin pertama**:
   - Buka **Authentication → Users → Add user → Create new user**.
   - Masukkan email (misal `superadmin@negerisugaria.com`) dan password kuat, centang **Auto Confirm User**.
   - Jalankan query berikut di **SQL Editor** untuk menetapkannya sebagai `super_admin`:
     ```sql
     INSERT INTO public.profiles (id, role_name, name, email, unit, status)
     SELECT id, 'super_admin', 'Super Admin WebSekolah', email, 'Tim TI & Pimpinan', 'active'
     FROM auth.users
     WHERE email = 'superadmin@negerisugaria.com'
     ON CONFLICT (id) DO UPDATE SET role_name = 'super_admin', status = 'active';
     ```
4. Deploy **Edge Function `manage-users`** (agar Super Admin dapat membuat user **Admin Sekolah** baru langsung dari `/admin` tanpa mengekspos `service_role` key):
   - Di terminal komputer Anda (dengan Supabase CLI):
     ```bash
     npx supabase login
     npx supabase link --project-ref <PROJECT_REF_ANDA>
     npx supabase functions deploy manage-users --no-verify-jwt
     ```
   - *(Catatan: `--no-verify-jwt` aman karena fungsi `manage-users/index.ts` memverifikasi JWT user + memeriksa `role_name === 'super_admin'` secara eksplisit di server).*

---

## Langkah 2 — Masukkan Kunci Publik Supabase
Buka **Supabase Dashboard → Project Settings → API**, salin **Project URL** dan **anon public key**.

Pilih salah satu cara:
- **Cara A (Paling mudah)**: Isi langsung pada file `public/js/config.js`:
  ```js
  window.WEBSEKOLAH_CONFIG = {
    supabaseUrl: 'https://xxxxxxxxxxxx.supabase.co',
    supabaseAnonKey: 'eyJhbGciOi...'
  };
  ```
- **Cara B (Via GitHub Variables)**: Buka repo GitHub → **Settings → Secrets and variables → Actions → Variables**, tambahkan `SUPABASE_URL` dan `SUPABASE_ANON_KEY` (workflow `.github/workflows/deploy-pages.yml` akan otomatis menyisipkannya saat deploy).

---

## Langkah 3 — Push ke GitHub & Aktifkan GitHub Pages
1. Push kode proyek ini ke repositori `https://github.com/negerisugaria/negerisugaria.com`:
   ```bash
   cd /home/diskominfo/.gemini/antigravity/scratch/websekolah
   git init
   git add .
   git commit -m "Deploy WebSekolah ke GitHub Pages + Supabase"
   git branch -M main
   git remote add origin https://github.com/negerisugaria/negerisugaria.com.git
   git push -u origin main
   ```
2. Di GitHub repo **Settings → Pages**:
   - **Source**: pilih **GitHub Actions**.
   - **Custom domain**: isi `negerisugaria.com` lalu centang **Enforce HTTPS** (DNS di Hostinger Anda sudah mengarah ke IP GitHub Pages `185.199.108–111.153`).

---

## Langkah 4 — Uji Coba
- Portal Publik: `https://negerisugaria.com/`
- Dashboard CMS: `https://negerisugaria.com/admin`
- Login sebagai **Super Admin**, lalu buka menu **Pengguna & Peran** untuk membuat user **Admin Sekolah** baru.
