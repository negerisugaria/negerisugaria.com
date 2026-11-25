-- =============================================================================
-- WebSekolah — Skema Database PostgreSQL & Row-Level Security (RLS) untuk Supabase
-- Sesuai Software Architecture Design (SAD) v1.0
-- Jalankan file ini di Supabase Dashboard -> SQL Editor -> New Query
-- =============================================================================

-- 1. Tabel Peran & Profil Pengguna (terhubung ke auth.users)
CREATE TABLE IF NOT EXISTS public.roles (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

INSERT INTO public.roles (name, display_name, description) VALUES
  ('super_admin', 'Super Admin', 'Akses penuh: membuat akun Admin Sekolah baru, mengatur peran, audit log, dan pengaturan sistem.'),
  ('admin_sekolah', 'Admin Sekolah', 'Mengelola berita, pengumuman, agenda, halaman, profil sekolah, galeri/media, dan permintaan informasi.'),
  ('editor', 'Editor / Humas', 'Meninjau, meminta revisi, menyetujui, menjadwalkan, dan mempublikasikan konten.'),
  ('kontributor', 'Kontributor / Guru / Unit', 'Membuat draf konten dan mengirimkannya untuk ditinjau Editor.'),
  ('petugas_layanan', 'Petugas Layanan Informasi', 'Melihat dan menindaklanjuti tiket permintaan informasi masyarakat.')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL REFERENCES public.roles(name) DEFAULT 'kontributor',
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL DEFAULT 'Umum',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tabel Konten & Operasional
CREATE TABLE IF NOT EXISTS public.categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.media (
  id BIGSERIAL PRIMARY KEY,
  uploader_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  public_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size BIGINT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Dokumentasi',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.posts (
  id BIGSERIAL PRIMARY KEY,
  author_id UUID NOT NULL REFERENCES public.profiles(id),
  category_id BIGINT NOT NULL REFERENCES public.categories(id),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  cover_media_id BIGINT REFERENCES public.media(id) ON DELETE SET NULL,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  requires_principal_approval BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'submitted', 'in_review', 'revision_required', 'approved', 'scheduled', 'published', 'archived')
  ),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.post_reviews (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES public.profiles(id),
  decision TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.announcements (
  id BIGSERIAL PRIMARY KEY,
  author_id UUID NOT NULL REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'penting', 'mendesak')),
  start_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.events (
  id BIGSERIAL PRIMARY KEY,
  author_id UUID NOT NULL REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  location TEXT NOT NULL,
  organizer TEXT NOT NULL DEFAULT 'WebSekolah',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pages (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  section TEXT NOT NULL DEFAULT 'Profil',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.school_profiles (
  id BIGSERIAL PRIMARY KEY,
  field_key TEXT NOT NULL UNIQUE,
  field_label TEXT NOT NULL,
  field_value TEXT NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) >= 2),
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL CHECK (char_length(subject) >= 4),
  message TEXT NOT NULL CHECK (char_length(message) >= 10),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  response_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Fungsi Helper Keamanan RBAC (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role_name
  FROM public.profiles
  WHERE id = auth.uid() AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_active_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active'
  );
$$;

-- 4. Aktifkan RLS di Seluruh Tabel
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ROLES
CREATE POLICY "roles_read_authenticated" ON public.roles
  FOR SELECT TO authenticated USING (public.is_active_staff());

-- PROFILES (Hanya Super Admin yang bisa kelola semua user; staf aktif bisa lihat daftar nama/post count)
CREATE POLICY "profiles_read_staff" ON public.profiles
  FOR SELECT TO authenticated USING (public.is_active_staff());

CREATE POLICY "profiles_read_public_authors" ON public.profiles
  FOR SELECT TO anon USING (status = 'active');

CREATE POLICY "profiles_manage_super_admin" ON public.profiles
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');

-- CATEGORIES
CREATE POLICY "categories_public_read" ON public.categories
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "categories_manage_admin" ON public.categories
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin_sekolah'))
  WITH CHECK (public.current_user_role() IN ('super_admin', 'admin_sekolah'));

-- MEDIA
CREATE POLICY "media_public_read" ON public.media
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "media_insert_staff" ON public.media
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() IN ('super_admin', 'admin_sekolah', 'editor', 'kontributor'));

CREATE POLICY "media_delete_admin" ON public.media
  FOR DELETE TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin_sekolah', 'editor'));

-- POSTS (Publik hanya lihat status published; staf sesuai peran RBAC)
CREATE POLICY "posts_public_read" ON public.posts
  FOR SELECT TO anon
  USING (status = 'published' AND (published_at IS NULL OR published_at <= now()));

CREATE POLICY "posts_staff_read" ON public.posts
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin_sekolah', 'editor')
    OR author_id = auth.uid()
    OR (status = 'published' AND (published_at IS NULL OR published_at <= now()))
  );

CREATE POLICY "posts_insert_staff" ON public.posts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin_sekolah', 'editor', 'kontributor')
    AND author_id = auth.uid()
  );

CREATE POLICY "posts_update_manager" ON public.posts
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'admin_sekolah', 'editor')
    OR (author_id = auth.uid() AND status IN ('draft', 'revision_required'))
  )
  WITH CHECK (
    public.current_user_role() IN ('super_admin', 'admin_sekolah', 'editor')
    OR (author_id = auth.uid() AND status IN ('draft', 'submitted', 'revision_required'))
  );

-- POST REVIEWS
CREATE POLICY "post_reviews_read_staff" ON public.post_reviews
  FOR SELECT TO authenticated USING (public.is_active_staff());

CREATE POLICY "post_reviews_insert_staff" ON public.post_reviews
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_staff() AND reviewer_id = auth.uid());

-- ANNOUNCEMENTS
CREATE POLICY "announcements_public_read" ON public.announcements
  FOR SELECT TO anon
  USING (status = 'published' AND start_at <= now() AND (end_at IS NULL OR end_at >= now()));

CREATE POLICY "announcements_staff_read" ON public.announcements
  FOR SELECT TO authenticated USING (public.is_active_staff());

CREATE POLICY "announcements_manage" ON public.announcements
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin_sekolah', 'editor'))
  WITH CHECK (public.current_user_role() IN ('super_admin', 'admin_sekolah', 'editor'));

-- EVENTS
CREATE POLICY "events_public_read" ON public.events
  FOR SELECT TO anon USING (status = 'published');

CREATE POLICY "events_staff_read" ON public.events
  FOR SELECT TO authenticated USING (public.is_active_staff());

CREATE POLICY "events_manage" ON public.events
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin_sekolah', 'editor'))
  WITH CHECK (public.current_user_role() IN ('super_admin', 'admin_sekolah', 'editor'));

-- PAGES & SCHOOL PROFILES
CREATE POLICY "pages_public_read" ON public.pages
  FOR SELECT TO anon USING (status = 'published');

CREATE POLICY "pages_staff_read" ON public.pages
  FOR SELECT TO authenticated USING (public.is_active_staff());

CREATE POLICY "pages_manage" ON public.pages
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin_sekolah'))
  WITH CHECK (public.current_user_role() IN ('super_admin', 'admin_sekolah'));

CREATE POLICY "school_profiles_public_read" ON public.school_profiles
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "school_profiles_manage" ON public.school_profiles
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin_sekolah'))
  WITH CHECK (public.current_user_role() IN ('super_admin', 'admin_sekolah'));

-- SITE SETTINGS (Khusus Super Admin untuk ubah)
CREATE POLICY "site_settings_public_read" ON public.site_settings
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "site_settings_manage_super_admin" ON public.site_settings
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');

-- CONTACT MESSAGES (Publik boleh kirim; Admin Sekolah/Super Admin/Petugas Layanan bisa kelola)
CREATE POLICY "contact_public_insert" ON public.contact_messages
  FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'new');

CREATE POLICY "contact_manage_staff" ON public.contact_messages
  FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin_sekolah', 'petugas_layanan'));

CREATE POLICY "contact_update_staff" ON public.contact_messages
  FOR UPDATE TO authenticated
  USING (public.current_user_role() IN ('super_admin', 'admin_sekolah', 'petugas_layanan'))
  WITH CHECK (public.current_user_role() IN ('super_admin', 'admin_sekolah', 'petugas_layanan'));

-- AUDIT LOGS (Hanya Super Admin yang membaca; staf aktif dapat mencatat log aksi)
CREATE POLICY "audit_read_super_admin" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "audit_insert_staff" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_staff());

-- 5. Supabase Storage Bucket untuk Galeri & Media
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "storage_media_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'media');

CREATE POLICY "storage_media_staff_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND public.current_user_role() IN ('super_admin', 'admin_sekolah', 'editor', 'kontributor')
  );

CREATE POLICY "storage_media_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND public.current_user_role() IN ('super_admin', 'admin_sekolah', 'editor')
  );

-- 6. Grant Privilege Dasar PostgreSQL (dibatasi lebih lanjut oleh RLS di atas)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

GRANT SELECT ON
  public.school_profiles,
  public.site_settings,
  public.pages,
  public.posts,
  public.categories,
  public.media,
  public.announcements,
  public.events
TO anon;

GRANT SELECT (id, name, unit, status) ON public.profiles TO anon;
GRANT INSERT ON public.contact_messages TO anon;

GRANT SELECT ON
  public.roles,
  public.profiles,
  public.categories,
  public.media,
  public.posts,
  public.post_reviews,
  public.announcements,
  public.events,
  public.pages,
  public.school_profiles,
  public.site_settings,
  public.contact_messages,
  public.audit_logs
TO authenticated;

GRANT INSERT, UPDATE, DELETE ON
  public.profiles,
  public.categories,
  public.media,
  public.posts,
  public.post_reviews,
  public.announcements,
  public.events,
  public.pages,
  public.school_profiles,
  public.site_settings,
  public.contact_messages
TO authenticated;

GRANT INSERT ON public.audit_logs TO authenticated;
