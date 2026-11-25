// Supabase Edge Function: manage-users
// Memungkinkan Super Admin membuat akun Admin Sekolah baru (serta mengubah peran/status/password)
// tanpa pernah mengekspos SUPABASE_SERVICE_ROLE_KEY ke browser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS'
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: { message: 'Konfigurasi Edge Function Supabase belum lengkap.' } });
  }

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json(401, { error: { message: 'Token autentikasi diperlukan.' } });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 1. Verifikasi user yang memanggil
  const { data: userData, error: userErr } = await adminClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json(401, { error: { message: 'Sesi tidak valid atau kedaluwarsa.' } });
  }

  const actorId = userData.user.id;
  const { data: actorProfile } = await adminClient
    .from('profiles')
    .select('id, email, name, role_name, status')
    .eq('id', actorId)
    .single();

  if (!actorProfile || actorProfile.status !== 'active' || actorProfile.role_name !== 'super_admin') {
    return json(403, {
      error: { message: 'Akses ditolak. Hanya Super Admin aktif yang dapat mengelola pengguna.' }
    });
  }

  try {
    // GET: daftar semua pengguna
    if (req.method === 'GET') {
      const { data: users, error } = await adminClient
        .from('profiles')
        .select('id, name, email, unit, status, role_name, last_login_at, created_at, updated_at, roles(display_name)')
        .order('created_at', { ascending: false });
      if (error) return json(400, { error: { message: error.message } });
      return json(200, {
        items: (users ?? []).map((u: Record<string, unknown>) => ({
          ...u,
          role_display_name: (u.roles as { display_name?: string } | null)?.display_name ?? u.role_name
        }))
      });
    }

    // POST: Super Admin membuat user Admin Sekolah / user baru
    if (req.method === 'POST') {
      const body = await req.json();
      const name = String(body.name ?? '').trim();
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const roleName = String(body.role_name ?? 'admin_sekolah').trim();
      const unit = String(body.unit ?? 'Admin Sekolah / Tata Usaha').trim();

      if (name.length < 3 || !email.includes('@') || password.length < 8) {
        return json(400, {
          error: { message: 'Nama (min 3 karakter), email valid, dan password (min 8 karakter) wajib diisi.' }
        });
      }

      const { data: createdAuth, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role_name: roleName, unit }
      });

      if (createErr || !createdAuth?.user) {
        return json(400, { error: { message: createErr?.message || 'Gagal membuat akun Auth.' } });
      }

      const newUserId = createdAuth.user.id;
      const { data: profile, error: profErr } = await adminClient
        .from('profiles')
        .insert({
          id: newUserId,
          name,
          email,
          role_name: roleName,
          unit,
          status: 'active'
        })
        .select('id, name, email, unit, status, role_name, created_at, roles(display_name)')
        .single();

      if (profErr) {
        await adminClient.auth.admin.deleteUser(newUserId);
        return json(400, { error: { message: profErr.message } });
      }

      await adminClient.from('audit_logs').insert({
        user_id: actorProfile.id,
        actor_email: actorProfile.email,
        action: 'USER_CREATED',
        entity_type: 'user',
        entity_id: newUserId,
        metadata: { email, role: roleName, unit }
      });

      return json(201, {
        user: {
          ...profile,
          role_display_name: (profile.roles as { display_name?: string } | null)?.display_name ?? profile.role_name
        }
      });
    }

    // PATCH: Ubah peran, status aktif/nonaktif, atau reset password
    if (req.method === 'PATCH') {
      const body = await req.json();
      const targetId = String(body.id ?? '').trim();
      if (!targetId) {
        return json(400, { error: { message: 'ID pengguna target wajib diisi.' } });
      }
      if (targetId === actorProfile.id && body.status === 'inactive') {
        return json(400, { error: { message: 'Super Admin tidak dapat menonaktifkan akunnya sendiri.' } });
      }
      if (targetId === actorProfile.id && body.role_name && body.role_name !== 'super_admin') {
        return json(400, { error: { message: 'Super Admin tidak dapat menurunkan perannya sendiri.' } });
      }

      const authUpdates: Record<string, unknown> = {};
      if (body.password && String(body.password).length >= 8) {
        authUpdates.password = String(body.password);
      }
      if (body.status === 'inactive') {
        authUpdates.ban_duration = '876000h';
      } else if (body.status === 'active') {
        authUpdates.ban_duration = 'none';
      }

      if (Object.keys(authUpdates).length > 0) {
        const { error: authUpdErr } = await adminClient.auth.admin.updateUserById(targetId, authUpdates);
        if (authUpdErr) return json(400, { error: { message: authUpdErr.message } });
      }

      const profileUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.name !== undefined) profileUpdates.name = String(body.name).trim();
      if (body.unit !== undefined) profileUpdates.unit = String(body.unit).trim();
      if (body.role_name !== undefined) profileUpdates.role_name = String(body.role_name).trim();
      if (body.status !== undefined) profileUpdates.status = String(body.status).trim();

      const { data: updated, error: updErr } = await adminClient
        .from('profiles')
        .update(profileUpdates)
        .eq('id', targetId)
        .select('id, name, email, unit, status, role_name, last_login_at, created_at, updated_at, roles(display_name)')
        .single();

      if (updErr) return json(400, { error: { message: updErr.message } });

      await adminClient.from('audit_logs').insert({
        user_id: actorProfile.id,
        actor_email: actorProfile.email,
        action: body.status === 'inactive' ? 'USER_DEACTIVATED' : 'USER_UPDATED',
        entity_type: 'user',
        entity_id: targetId,
        metadata: {
          email: updated.email,
          role: updated.role_name,
          status: updated.status
        }
      });

      return json(200, {
        user: {
          ...updated,
          role_display_name: (updated.roles as { display_name?: string } | null)?.display_name ?? updated.role_name
        }
      });
    }

    return json(405, { error: { message: 'Metode HTTP tidak didukung.' } });
  } catch (err) {
    return json(500, { error: { message: err instanceof Error ? err.message : 'Kesalahan server.' } });
  }
});
