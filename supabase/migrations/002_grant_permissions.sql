-- =============================================================================
-- Perbaikan Permission (GRANT) untuk role `anon` dan `authenticated` di Supabase
-- Jalankan isi file ini di Supabase Dashboard -> SQL Editor -> New Query -> Run
-- =============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Akses baca publik (anon) hanya pada tabel publik & kolom profil non-sensitif
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

-- Akses pengguna terautentikasi (tetap dibatasi oleh RLS sesuai peran RBAC)
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
