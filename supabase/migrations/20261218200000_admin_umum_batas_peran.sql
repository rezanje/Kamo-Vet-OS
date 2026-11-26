-- Admin Umum (ADMIN_UMUM): batas peran di database (perbaikan temuan TINGGI-2 + SEDANG-2/3 dari review independen PR #594).
--
-- MASALAH (terbukti di hosted, probe dalam transaksi yang dibatalkan): Admin Umum tanpa konfigurasi Akses Grup tersimpan (bawaan = semua modul, semua cabang,
-- kemampuan all_branches + create_accounts) LOLOS preflight_employee_account(..., 'FINANCE') sehingga bisa membuat akun FINANCE (membaca angka gaji, semua cabang);
-- ADMIN hosted ditolak (ROLE_ACTION_DENIED) hanya karena konfigurasinya sudah disempitkan. Pengaman "Owner menyempitkan dulu" hanya prosedur manusia.
--
-- ATURAN BARU (keras, tidak tergantung konfigurasi): akun ADMIN_UMUM tidak boleh membuat, memberikan, atau mengubah akun berperan FINANCE / OWNER / ADMIN / ADMIN_UMUM
-- (peran istimewa atau lebih tinggi dari dirinya), dan tidak boleh mengubah/menautkan/menonaktifkan akun orang lain yang berperan demikian.
-- Tetap boleh: STAFF, DOCTOR, ADMIN_ONLINE, dan mengubah nama akunnya sendiri. Peran lain (OWNER, ADMIN, FINANCE, ...) TIDAK berubah sama sekali.
-- Akses Admin Umum yang lain tetap lengkap ("akses tetap lengkap, kita yang atur"): Owner menyempitkannya lewat Akses Grup.
--
-- Titik penegakan (satu-satunya penulis profiles.role + semua pembaca "boleh edit akun"):
--   preflight_employee_account, configure_employee_account (membuat/menetapkan peran),
--   edit_user_account (mengubah peran/cabang), user_account_edit_allowed (dipakai edit/link/aktifkan/penugasan cabang akun),
--   get_user_account_for_edit (daftar peran yang boleh dipilih).
-- Tambahan (SEDANG-1 bagian orang/peran): Akses Grup yang menyempitkan modul HRIS kini juga berlaku di database untuk Admin Umum pada fungsi penugasan cabang karyawan
--   dan epoch penggajian grosir (sebelumnya hanya menu). SEDANG-2: Jurnal Berulang (recurring_require_finance) kini menghormati tombol jurnal.buat_manual untuk Admin Umum.
-- SEDANG-3: penyetuju Rekap Setoran (OWNER, FINANCE, ADMIN, ADMIN_UMUM) hanya didokumentasikan (COMMENT), perilaku tidak berubah.
--
-- Catatan admin_umum_private.terapkan_semua/kembalikan_semua + tabel admin_umum_private.diubah: migrasi ini TIDAK memanggil penulis ulang dan TIDAK mengubah tabel
-- catatan itu (fungsi yang diubah di sini sudah tercatat di sana sejak 20261214110100). Semua pengubahan memakai tambalan berjangkar (tepat 1 kemunculan, gagal tertutup).
-- Rollback: ROLLBACK.sql di bukti (kembalikan definisi dari backup, lalu hapus 4 fungsi pembantu). Urutan: rollback ini DULU, baru ROLLBACK peran Admin Umum.
-- Tidak ada akun yang diberi peran ini oleh migrasi ini.
set local lock_timeout = '15s';

do $pre$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'user_role' and e.enumlabel = 'ADMIN_UMUM')
     or to_regclass('admin_umum_private.diubah') is null
     or to_regprocedure('public.jurnal_aksi_diizinkan(text)') is null
     or to_regprocedure('public.preflight_employee_account(uuid,text,uuid[])') is null
     or to_regprocedure('public.configure_employee_account(uuid,uuid,text,text,uuid[])') is null
     or to_regprocedure('public.edit_user_account(uuid,text,text,uuid[],text,uuid)') is null
     or to_regprocedure('public.user_account_edit_allowed(uuid)') is null
     or to_regprocedure('public.get_user_account_for_edit(uuid)') is null
     or to_regprocedure('public.recurring_require_finance()') is null
     or to_regprocedure('public.setoran_role()') is null or to_regprocedure('public.setoran_penyetuju()') is null then
    raise exception 'ADMIN_UMUM_BATAS_PRECONDITION: peran Admin Umum (20261214110100) belum terpasang lengkap; periksa urutan migrasi';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'admin_umum_private' and p.proname in ('peran_istimewa', 'aktor_admin_umum', 'tolak_peran_istimewa', 'tolak_edit_akun', 'wajib_modul')) then
    raise exception 'ADMIN_UMUM_BATAS_PRECONDITION: fungsi pembantu sudah ada; periksa urutan migrasi';
  end if;
end $pre$;

-- ───────────────────────── 1. Fungsi pembantu (skema admin_umum_private: tanpa USAGE/EXECUTE bagi peran API) ─────────────────────────
-- Peran istimewa/lebih tinggi dari Admin Umum: FINANCE (membaca gaji, semua cabang) dan OWNER/ADMIN/ADMIN_UMUM.
create function admin_umum_private.peran_istimewa(p_role text) returns boolean
language sql immutable set search_path = '' as $f$
  select coalesce(p_role in ('OWNER','ADMIN','ADMIN_UMUM','FINANCE'), false)
$f$;

create function admin_umum_private.aktor_admin_umum() returns boolean
language sql stable security definer set search_path = '' as $f$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role::text = 'ADMIN_UMUM')
$f$;

-- Hanya berlaku bila yang memanggil adalah Admin Umum aktif; peran lain: tidak berbuat apa-apa.
create function admin_umum_private.tolak_peran_istimewa(p_role text) returns void
language plpgsql stable security definer set search_path = '' as $f$
begin
  if admin_umum_private.aktor_admin_umum() and admin_umum_private.peran_istimewa(p_role) then
    raise exception 'ADMIN_UMUM_ROLE_DIBATASI: Admin Umum tidak boleh membuat, memberikan, atau mengubah akun berperan Finance, Admin, Admin Umum, atau Super Admin (Owner). Hanya Super Admin yang boleh. Tidak ada yang disimpan.' using errcode = '42501';
  end if;
end $f$;

-- Edit akun orang lain: peran baru DAN peran akun target tidak boleh istimewa. Mengubah akun sendiri tidak disentuh (aturan lama melarang ganti peran sendiri).
create function admin_umum_private.tolak_edit_akun(p_profile_id uuid, p_role text) returns void
language plpgsql stable security definer set search_path = '' as $f$
begin
  if not admin_umum_private.aktor_admin_umum() or p_profile_id is not distinct from auth.uid() then return; end if;
  perform admin_umum_private.tolak_peran_istimewa(p_role);
  if exists (select 1 from public.profiles t where t.id = p_profile_id and admin_umum_private.peran_istimewa(t.role::text)) then
    raise exception 'ADMIN_UMUM_ROLE_DIBATASI: Admin Umum tidak boleh membuat, memberikan, atau mengubah akun berperan Finance, Admin, Admin Umum, atau Super Admin (Owner). Hanya Super Admin yang boleh. Tidak ada yang disimpan.' using errcode = '42501';
  end if;
end $f$;

-- Penyempitan modul lewat Akses Grup berlaku di database untuk Admin Umum (pola sama seperti recurring_require_finance / user_account_edit_allowed):
-- bila Owner sudah menyimpan daftar modul untuk Admin Umum dan modul ini tidak ada, tolak. Tanpa konfigurasi tersimpan: bawaan = semua modul (tidak ditolak).
create function admin_umum_private.wajib_modul(p_module text) returns void
language plpgsql stable security definer set search_path = '' as $f$
begin
  if admin_umum_private.aktor_admin_umum()
     and exists (select 1 from public.role_modules m where m.role = 'ADMIN_UMUM')
     and not exists (select 1 from public.role_modules m where m.role = 'ADMIN_UMUM' and m.module_id = p_module) then
    raise exception 'ROLE_ACTION_DENIED: modul % tidak dibuka untuk Admin Umum. Minta Super Admin membukanya di Pengaturan > Akses Grup.', p_module using errcode = '42501';
  end if;
end $f$;

revoke all on function admin_umum_private.peran_istimewa(text) from public, anon, authenticated, service_role;
revoke all on function admin_umum_private.aktor_admin_umum() from public, anon, authenticated, service_role;
revoke all on function admin_umum_private.tolak_peran_istimewa(text) from public, anon, authenticated, service_role;
revoke all on function admin_umum_private.tolak_edit_akun(uuid, text) from public, anon, authenticated, service_role;
revoke all on function admin_umum_private.wajib_modul(text) from public, anon, authenticated, service_role;

-- ───────────────────────── 2. Tambalan berjangkar (tepat 1 kemunculan, gagal tertutup) ─────────────────────────
create function pg_temp.batas_patch(p_sig text, p_anchor text, p_new text) returns void
language plpgsql as $f$
declare v text; n int;
begin
  v := pg_get_functiondef(p_sig::regprocedure);
  n := (length(v) - length(replace(v, p_anchor, ''))) / length(p_anchor);
  if n <> 1 then raise exception 'ADMIN_UMUM_BATAS_ANCHOR: % kemunculan (harus 1) di % untuk jangkar [%]', n, p_sig, left(p_anchor, 70); end if;
  execute replace(v, p_anchor, p_new);
end $f$;

-- 2a. Membuat/menetapkan peran akun: tolak peran istimewa untuk Admin Umum dengan pesan jelas (sesudah validasi masukan, sebelum pemeriksaan kemampuan).
select pg_temp.batas_patch('public.preflight_employee_account(uuid,text,uuid[])',
  $a$if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') and ($a$,
  $a$perform admin_umum_private.tolak_peran_istimewa(p_role);
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') and ($a$);
select pg_temp.batas_patch('public.configure_employee_account(uuid,uuid,text,text,uuid[])',
  $a$if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') then$a$,
  $a$perform admin_umum_private.tolak_peran_istimewa(p_role);
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') then$a$);

-- 2b. Mengubah akun: peran baru/akun target istimewa ditolak dengan pesan jelas (sebelum pemeriksaan umum "dapat dikelola").
select pg_temp.batas_patch('public.edit_user_account(uuid,text,text,uuid[],text,uuid)',
  $a$if not public.user_account_edit_allowed(p_profile_id) then raise exception using errcode='42501',message='ACCOUNT_EDIT_DENIED: akun atau cabang tidak dapat dikelola';end if;$a$,
  $a$perform admin_umum_private.tolak_edit_akun(p_profile_id,p_role);
 if not public.user_account_edit_allowed(p_profile_id) then raise exception using errcode='42501',message='ACCOUNT_EDIT_DENIED: akun atau cabang tidak dapat dikelola';end if;$a$);

-- 2c. "Boleh mengelola akun ini" (edit, tautkan karyawan, aktif/nonaktif, penugasan cabang akun): akun FINANCE orang lain ikut tertutup untuk Admin Umum.
select pg_temp.batas_patch('public.user_account_edit_allowed(uuid)',
  $a$if target.role in('OWNER','ADMIN','ADMIN_UMUM') and target.id<>actor.id then return false;end if;$a$,
  $a$if target.role in('OWNER','ADMIN','ADMIN_UMUM') and target.id<>actor.id then return false;end if;
 if actor.role='ADMIN_UMUM' and target.id<>actor.id and admin_umum_private.peran_istimewa(target.role::text) then return false;end if;$a$);

-- 2d. Daftar peran yang boleh dipilih (layar edit akun): Finance tidak ditawarkan kepada Admin Umum.
select pg_temp.batas_patch('public.get_user_account_for_edit(uuid)',
  $a$(candidate not in('OWNER','ADMIN','ADMIN_UMUM') and (not candidate_all$a$,
  $a$(candidate not in('OWNER','ADMIN','ADMIN_UMUM') and not (actor.role='ADMIN_UMUM' and admin_umum_private.peran_istimewa(candidate)) and (not candidate_all$a$);

-- 2e. SEDANG-2: Jurnal Berulang membuat jurnal 'recurring' dari jurnal manual sumber: Admin Umum tanpa izin jurnal.buat_manual ditolak (pesan sama seperti jurnal manual).
-- Dipasang SESUDAH pemeriksaan modul Buku Besar yang lama (pesan lama tetap yang pertama). Peran lain tidak berubah.
select pg_temp.batas_patch('public.recurring_require_finance()',
  $a$return v_actor.id;$a$,
  $a$if v_actor.role='ADMIN_UMUM' and not public.jurnal_aksi_diizinkan('jurnal.buat_manual') then
    raise exception 'Izin Buat jurnal manual belum diberikan untuk peran Admin Umum' using errcode='42501';
  end if;
  return v_actor.id;$a$);

-- 2f. SEDANG-1 (orang): modul HRIS yang dicabut Owner dari Admin Umum kini berlaku juga untuk panggilan RPC langsung.
-- assign_employee_secondary_branches (SECURITY INVOKER) memanggil reopen_employee_branch_assignments (DEFINER) SEBELUM menulis, jadi ikut tertutup lewat sana.
select pg_temp.batas_patch('public.reopen_employee_branch_assignments(uuid,uuid[],date)',
  $a$perform admin_online_private.deny_admin_online();$a$,
  $a$perform admin_online_private.deny_admin_online();
  perform admin_umum_private.wajib_modul('hris');$a$);
select pg_temp.batas_patch('public.end_employee_branch_assignment(uuid,uuid,date,text)',
  $a$perform admin_online_private.deny_admin_online();$a$,
  $a$perform admin_online_private.deny_admin_online();
  perform admin_umum_private.wajib_modul('hris');$a$);
select pg_temp.batas_patch('public.set_employee_primary_branches(uuid[],uuid,text)',
  $a$perform admin_online_private.deny_admin_online();$a$,
  $a$perform admin_online_private.deny_admin_online();
  perform admin_umum_private.wajib_modul('hris');$a$);
select pg_temp.batas_patch('public.get_wholesale_payroll_epoch(text)',
  $a$perform admin_online_private.deny_admin_online();$a$,
  $a$perform admin_online_private.deny_admin_online();
  perform admin_umum_private.wajib_modul('hris');$a$);

-- ───────────────────────── 3. Dokumentasi (SEDANG-3) ─────────────────────────
comment on function public.setoran_role() is 'Peran akun yang boleh masuk ke Rekap Setoran: OWNER, ADMIN, ADMIN_UMUM, FINANCE, STAFF (selain itu null). Admin Umum disamakan dengan ADMIN (Andri, 26 Nov 2026).';
comment on function public.setoran_penyetuju() is 'Penyetuju Rekap Setoran SENGAJA: OWNER, FINANCE, ADMIN, ADMIN_UMUM (Admin Umum sama seperti ADMIN, bukan lebih). Void: OWNER/FINANCE saja (setoran_role). Pembuat tidak boleh menyetujui setorannya sendiri. Fungsi ini tidak memeriksa modul/tindakan Akses Grup: penyempitan hanya di layar (lihat review PR #594, SEDANG-1/3).';
comment on schema admin_umum_private is 'Penulis ulang peran Admin Umum (terapkan_semua/kembalikan_semua; tabel diubah) + pembatas peran (peran_istimewa, aktor_admin_umum, tolak_peran_istimewa, tolak_edit_akun, wajib_modul; 20261218200000). Tanpa akses peran API.';

-- ───────────────────────── 4. Pagar Admin Online dijalankan ulang ─────────────────────────
select admin_online_private.fence_all();
select admin_online_private.guard_all();

-- ───────────────────────── 5. Pemeriksaan pasca-pasang (gagal tertutup) ─────────────────────────
do $check$
declare n int; r record; f text;
begin
  -- penulis ulang peran Admin Umum: tidak ada yang perlu diubah lagi / tak dikenal (semantik tabel catatan tidak berubah)
  select count(*) into n from admin_umum_private.terapkan_semua(true) where status in ('DIUBAH', 'SISA_TAK_DIKENAL');
  if n <> 0 then raise exception 'ADMIN_UMUM_BATAS_CHECK: % objek masih perlu diubah / tak dikenal oleh penulis ulang', n; end if;
  -- setiap fungsi yang diubah memuat pemanggilan pembatas yang benar
  for r in select * from (values
      ('public.preflight_employee_account(uuid,text,uuid[])', 'tolak_peran_istimewa'),
      ('public.configure_employee_account(uuid,uuid,text,text,uuid[])', 'tolak_peran_istimewa'),
      ('public.edit_user_account(uuid,text,text,uuid[],text,uuid)', 'tolak_edit_akun'),
      ('public.user_account_edit_allowed(uuid)', 'peran_istimewa'),
      ('public.get_user_account_for_edit(uuid)', 'peran_istimewa'),
      ('public.recurring_require_finance()', 'jurnal_aksi_diizinkan'),
      ('public.reopen_employee_branch_assignments(uuid,uuid[],date)', 'wajib_modul'),
      ('public.end_employee_branch_assignment(uuid,uuid,date,text)', 'wajib_modul'),
      ('public.set_employee_primary_branches(uuid[],uuid,text)', 'wajib_modul'),
      ('public.get_wholesale_payroll_epoch(text)', 'wajib_modul')) v(sig, kw) loop
    if (select p.prosrc from pg_proc p where p.oid = r.sig::regprocedure) !~ r.kw then raise exception 'ADMIN_UMUM_BATAS_CHECK: % tidak memuat %', r.sig, r.kw; end if;
  end loop;
  -- fungsi pembantu: tidak dapat dipanggil peran API, search_path kosong
  foreach f in array array['admin_umum_private.peran_istimewa(text)', 'admin_umum_private.aktor_admin_umum()', 'admin_umum_private.tolak_peran_istimewa(text)',
                           'admin_umum_private.tolak_edit_akun(uuid,text)', 'admin_umum_private.wajib_modul(text)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') or has_function_privilege('service_role', f, 'execute') then
      raise exception 'ADMIN_UMUM_BATAS_CHECK: % dapat dipanggil peran API', f; end if;
    if (select p.proconfig from pg_proc p where p.oid = f::regprocedure) is distinct from array['search_path=""'] and (select p.proconfig from pg_proc p where p.oid = f::regprocedure) is distinct from array['search_path=''''']  then
      raise exception 'ADMIN_UMUM_BATAS_CHECK: % search_path salah', f; end if;
  end loop;
  if has_schema_privilege('authenticated', 'admin_umum_private', 'usage') or has_schema_privilege('anon', 'admin_umum_private', 'usage') then
    raise exception 'ADMIN_UMUM_BATAS_CHECK: skema admin_umum_private terbuka'; end if;
  if exists (select 1 from public.profiles where role::text = 'ADMIN_UMUM') then raise exception 'ADMIN_UMUM_BATAS_CHECK: ada akun ADMIN_UMUM; migrasi ini tidak boleh memberi peran'; end if;
end $check$;
