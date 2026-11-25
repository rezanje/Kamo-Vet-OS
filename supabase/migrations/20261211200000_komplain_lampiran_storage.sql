-- Komplain Pelanggan — tambalan lampiran (temuan MAJOR-1 + MINOR-1 dari review independen PR #581).
--
-- MASALAH (MAJOR-1): bucket `dokumen` hanya punya kebijakan storage.objects yang memeriksa NAMA BUCKET (dokumen_read / dokumen_write /
--   dokumen_delete: bucket_id = 'dokumen'). Berkas lampiran komplain berada di `komplain/<ms>-<nama>`, jadi SEMUA akun internal di SEMUA
--   cabang dapat mendaftar, membuat tautan bertanda tangan, membaca, dan MENGHAPUS lampiran komplain orang lain (hosted: STAFF melihat 813 dari
--   813 objek). Aturan "STAFF/DOCTOR hanya komplain miliknya" bocor lewat berkas, dan jejak tak-dapat-diubah tidak berlaku untuk berkasnya.
--
-- PERBAIKAN: empat kebijakan RESTRICTIVE (di-AND dengan kebijakan lama, jadi hanya bisa MENGETATKAN) yang hanya berlaku untuk
--   bucket = 'dokumen' DAN nama diawali 'komplain/'. Objek lain (pengeluaran/, pembelian/, penjualan-online/, <modul>/<id>/, bucket lain)
--   tidak disentuh sama sekali: ekspresi kebijakan mengembalikan true sebelum fungsi apa pun dipanggil.
--     * SELECT : Owner membaca semua berkas komplain/; selain itu hanya (a) berkas yang SUDAH dilampirkan pada komplain yang boleh dilihat
--                akun ini (komplain_visible: cabang + pembuat/petugas/izin kelola) atau (b) berkas milik sendiri yang BELUM dilampirkan
--                (pengunggah, agar unggah-dulu-lalu-simpan tetap jalan; Supabase mengisi owner_id = id akun penunggah).
--     * INSERT : hanya akun yang boleh memakai Komplain Pelanggan (OWNER/ADMIN/FINANCE/STAFF/DOCTOR aktif). Admin Online ditolak.
--     * DELETE : hanya selama berkas BELUM dilampirkan pada komplain mana pun, oleh pengunggahnya atau Owner. Lampiran yang sudah
--                terdaftar tidak bisa dihapus siapa pun lewat API (jejak komplain tak boleh hilang).
--     * UPDATE : ditolak untuk komplain/ (tak ada kebijakan UPDATE yang memperbolehkan; ini pagar agar kelak tidak terbuka tak sengaja).
--   Admin Online: ditolak untuk komplain/ (baca/tulis/hapus) oleh pagar lama admin_online_fence_storage DAN oleh pemeriksaan peran di
--   fungsi baru (dua lapis, masing-masing diuji).
--   Pengikatan berkas ke pengunggah di sisi RPC: clinic_private.komplain_lampiran sekarang mewajibkan setiap berkas yang dilampirkan
--   ADA di storage.objects (bucket dokumen) dan dimiliki akun pemanggil (owner_id = auth.uid()); komplain_buat/komplain_catatan memanggilnya.
--   Jadi akun lain tidak bisa melampirkan berkas orang lain ataupun jalur yang tidak pernah diunggah.
--
-- MINOR-1: komplain_pilihan memberi nama + peran SEMUA akun yang punya akses cabang (Owner/Admin/Finance/rekan) kepada STAFF/DOCTOR,
--   padahal RLS `profiles` menyembunyikan profil orang lain. Sekarang OWNER/ADMIN/FINANCE dan pemegang izin kelola tetap melihat semua
--   akun yang bisa ditugaskan; STAFF/DOCTOR biasa hanya melihat rekan ber-peran STAFF/DOCTOR di cabang itu (nama Owner/Admin/Finance tersembunyi).
--   Catatan: penugasan lewat RPC tidak diubah (akun yang boleh ditugaskan tetap sama); yang dibatasi hanya DAFTAR yang ditampilkan.
-- MINOR-2 (KPI "Ditutup bulan ini") sudah mengikuti saringan cabang/kategori/tingkat/petugas/asal dan SENGAJA tidak mengikuti saringan
--   status/tanggal; perbaikannya hanya label di layar ("tidak ikut saringan status & tanggal"), tanpa perubahan database.
--
-- Tambahan kecil: log konfigurasi komplain kebal TRUNCATE (pemilik database), seperti jejak/lampiran/komplain.
-- Satu transaksi. Tidak menyentuh data. Fungsi lama yang diganti: clinic_private.komplain_lampiran(jsonb), public.komplain_pilihan(uuid)
-- (tambalan berjangkar dari definisi hidup; gagal tertutup bila jangkar tidak tepat satu kali).
--
-- ROLLBACK (lihat ROLLBACK.sql di folder bukti; garis besar):
--   drop policy komplain_berkas_baca_ketat on storage.objects; drop policy komplain_berkas_tulis_ketat on storage.objects;
--   drop policy komplain_berkas_hapus_ketat on storage.objects; drop policy komplain_berkas_ubah_ketat on storage.objects;
--   drop function public.komplain_berkas_boleh_baca(text, text); drop function public.komplain_berkas_boleh_hapus(text, text);
--   drop trigger komplain_config_log_tetap_truncate on public.complaint_config_log;
--   lalu pulihkan definisi lama komplain_lampiran dan komplain_pilihan dari cadangan (create or replace) dan jalankan guard_all().
set local lock_timeout = '5s';

-- ───────────── 1. Fungsi kebijakan storage (dipanggil sebagai pengguna, jadi harus dapat dieksekusi authenticated) ─────────────
-- Boleh MEMBACA berkas komplain/ ini? p_owner = pemilik objek (coalesce(owner_id, owner)).
create function public.komplain_berkas_boleh_baca(p_name text, p_owner text) returns boolean
language plpgsql stable security definer set search_path = '' as $f$
declare v_role text;
begin
  v_role := clinic_private.komplain_actor();
  if v_role is null then return false; end if;                      -- Admin Online, akun nonaktif, tanpa sesi
  if v_role = 'OWNER' then return true; end if;
  if exists (select 1 from public.customer_complaint_files f join public.customer_complaints c on c.id = f.complaint_id
             where f.path = p_name and public.komplain_visible(c.branch_id, c.created_by, c.assigned_to)) then
    return true;                                                    -- sudah dilampirkan pada komplain yang boleh dilihat
  end if;
  return p_owner is not null and p_owner = auth.uid()::text         -- unggahan sendiri yang belum dilampirkan
     and not exists (select 1 from public.customer_complaint_files f where f.path = p_name);
end $f$;
comment on function public.komplain_berkas_boleh_baca(text, text) is 'Kebijakan storage komplain/: Owner semua; lainnya hanya berkas terlampir pada komplain yang boleh dilihat, atau unggahan sendiri yang belum terlampir.';
revoke all on function public.komplain_berkas_boleh_baca(text, text) from public, anon, service_role;
grant execute on function public.komplain_berkas_boleh_baca(text, text) to authenticated;

-- Boleh MENGHAPUS berkas komplain/ ini? Hanya yang belum dilampirkan, oleh pengunggah atau Owner.
create function public.komplain_berkas_boleh_hapus(p_name text, p_owner text) returns boolean
language plpgsql stable security definer set search_path = '' as $f$
declare v_role text;
begin
  v_role := clinic_private.komplain_actor();
  if v_role is null then return false; end if;
  if exists (select 1 from public.customer_complaint_files f where f.path = p_name) then return false; end if;   -- lampiran tak boleh hilang
  return v_role = 'OWNER' or (p_owner is not null and p_owner = auth.uid()::text);
end $f$;
comment on function public.komplain_berkas_boleh_hapus(text, text) is 'Kebijakan storage komplain/: hapus hanya bila belum terlampir pada komplain mana pun, oleh pengunggah atau Owner.';
revoke all on function public.komplain_berkas_boleh_hapus(text, text) from public, anon, service_role;
grant execute on function public.komplain_berkas_boleh_hapus(text, text) to authenticated;

-- ───────────── 2. Kebijakan RESTRICTIVE di storage.objects (hanya bila kolom owner_id ada: Supabase asli) ─────────────
do $storage$
begin
  if to_regclass('storage.objects') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
    raise notice 'KOMPLAIN_LAMPIRAN: storage.objects tanpa kolom owner_id (bukan Supabase): kebijakan storage dilewati';
    return;
  end if;
  execute $p$create policy komplain_berkas_baca_ketat on storage.objects as restrictive for select to authenticated
    using (bucket_id <> 'dokumen' or name not like 'komplain/%' or public.komplain_berkas_boleh_baca(name, coalesce(owner_id, owner::text)))$p$;
  execute $p$create policy komplain_berkas_tulis_ketat on storage.objects as restrictive for insert to authenticated
    with check (bucket_id <> 'dokumen' or name not like 'komplain/%' or public.komplain_boleh())$p$;
  execute $p$create policy komplain_berkas_hapus_ketat on storage.objects as restrictive for delete to authenticated
    using (bucket_id <> 'dokumen' or name not like 'komplain/%' or public.komplain_berkas_boleh_hapus(name, coalesce(owner_id, owner::text)))$p$;
  execute $p$create policy komplain_berkas_ubah_ketat on storage.objects as restrictive for update to authenticated
    using (bucket_id <> 'dokumen' or name not like 'komplain/%') with check (bucket_id <> 'dokumen' or name not like 'komplain/%')$p$;
end $storage$;

-- ───────────── 3. Tambalan berjangkar: lampiran harus milik pemanggil; daftar petugas menurut peran pelihat ─────────────
do $patch$
declare v_def text; v_anchor text; v_repl text; v_n integer;
begin
  -- 3a. komplain_lampiran: berkas harus ada di storage.objects (bucket dokumen) dan milik akun pemanggil.
  v_def := pg_get_functiondef('clinic_private.komplain_lampiran(jsonb)'::regprocedure);
  v_anchor := E'\n  return v;\nend';
  v_n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_n <> 1 or v_def like '%KOMPLAIN_LAMPIRAN_MILIK%' then
    raise exception 'KOMPLAIN_LAMPIRAN_JANGKAR: komplain_lampiran berbeda dari yang diharapkan (jangkar %x)', v_n; end if;
  v_repl := E'\n  if jsonb_array_length(v) > 0 and exists (select 1 from jsonb_to_recordset(v) as x(path text)\n'
         || E'             where not exists (select 1 from storage.objects o where o.bucket_id = ''dokumen'' and o.name = x.path\n'
         || E'                               and coalesce(o.owner_id, o.owner::text) = auth.uid()::text)) then\n'
         || E'    raise exception using errcode = ''22023'', message = ''KOMPLAIN_LAMPIRAN_MILIK: berkas lampiran harus diunggah oleh akun ini lewat layar komplain (berkas tidak ditemukan atau milik akun lain).'';\n'
         || E'  end if;\n  return v;\nend';
  execute replace(v_def, v_anchor, v_repl);

  -- 3b. komplain_pilihan: STAFF/DOCTOR biasa hanya melihat rekan STAFF/DOCTOR; OWNER/ADMIN/FINANCE dan pemegang izin kelola melihat semua.
  v_def := pg_get_functiondef('public.komplain_pilihan(uuid)'::regprocedure);
  v_anchor := 'where p.is_active and clinic_private.komplain_user_di_cabang(p.id, p_branch)) end);';
  v_n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_n <> 1 or v_def like '%KOMPLAIN_PETUGAS_PERAN%' then
    raise exception 'KOMPLAIN_PILIHAN_JANGKAR: komplain_pilihan berbeda dari yang diharapkan (jangkar %x)', v_n; end if;
  v_repl := E'where p.is_active and clinic_private.komplain_user_di_cabang(p.id, p_branch)\n'
         || E'         and (v_role in (''OWNER'', ''ADMIN'', ''FINANCE'') or clinic_private.komplain_kelola() or p.role::text in (''STAFF'', ''DOCTOR'') /* KOMPLAIN_PETUGAS_PERAN */)) end);';
  execute replace(v_def, v_anchor, v_repl);
end $patch$;

-- ───────────── 3c. Log konfigurasi juga kebal TRUNCATE (jejak, lampiran, komplain sudah; log konfigurasi hanya kebal ubah/hapus) ─────────────
create trigger komplain_config_log_tetap_truncate before truncate on public.complaint_config_log for each statement execute function clinic_private.komplain_guard_tetap();

-- ───────────── 4. Pagar Admin Online (jalankan ulang; fungsi kebijakan sengaja dikecualikan guard_all karena dipakai kebijakan) ─────────────
select admin_online_private.guard_all();
select admin_online_private.fence_all();
notify pgrst, 'reload schema';

-- ───────────── 5. Pemeriksaan pasang: gagal = seluruh migrasi batal ─────────────
do $check$
declare f record; v_def text;
begin
  for f in select p.oid, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('komplain_berkas_boleh_baca', 'komplain_berkas_boleh_hapus') loop
    if has_function_privilege('anon', f.oid, 'execute') or has_function_privilege('service_role', f.oid, 'execute') or not has_function_privilege('authenticated', f.oid, 'execute') then
      raise exception 'KOMPLAIN_LAMPIRAN_ACL: hak eksekusi % salah', f.proname; end if;
    if not exists (select 1 from pg_proc p where p.oid = f.oid and p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']) then
      raise exception 'KOMPLAIN_LAMPIRAN_SECDEF: % harus SECURITY DEFINER dengan search_path kosong', f.proname; end if;
  end loop;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('komplain_berkas_boleh_baca', 'komplain_berkas_boleh_hapus')) <> 2 then
    raise exception 'KOMPLAIN_LAMPIRAN_FUNGSI: dua fungsi kebijakan harus ada'; end if;
  if to_regclass('storage.objects') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
    if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and permissive = 'RESTRICTIVE'
          and policyname in ('komplain_berkas_baca_ketat', 'komplain_berkas_tulis_ketat', 'komplain_berkas_hapus_ketat', 'komplain_berkas_ubah_ketat')) <> 4 then
      raise exception 'KOMPLAIN_LAMPIRAN_KEBIJAKAN: empat kebijakan RESTRICTIVE storage harus ada'; end if;
    if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
      raise exception 'KOMPLAIN_LAMPIRAN_RLS: RLS storage.objects harus aktif'; end if;
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.complaint_config_log'::regclass and tgname = 'komplain_config_log_tetap_truncate' and not tgisinternal) then
    raise exception 'KOMPLAIN_LAMPIRAN_TRUNCATE: pemicu TRUNCATE log konfigurasi tidak terpasang'; end if;
  v_def := pg_get_functiondef('clinic_private.komplain_lampiran(jsonb)'::regprocedure);
  if v_def not like '%KOMPLAIN_LAMPIRAN_MILIK%' or v_def not like '%storage.objects%' then raise exception 'KOMPLAIN_LAMPIRAN_TAMBALAN: pemeriksaan kepemilikan tidak terpasang'; end if;
  v_def := pg_get_functiondef('public.komplain_pilihan(uuid)'::regprocedure);
  if v_def not like '%KOMPLAIN_PETUGAS_PERAN%' or v_def !~ 'admin_online_private\.deny_admin_online' then raise exception 'KOMPLAIN_PILIHAN_TAMBALAN: tambalan peran/penjaga tidak lengkap'; end if;
  if exists (select 1 from pg_proc p where p.oid in ('clinic_private.komplain_lampiran(jsonb)'::regprocedure, 'public.komplain_pilihan(uuid)'::regprocedure)
             and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))) then
    raise exception 'KOMPLAIN_LAMPIRAN_ACL_LAMA: hak eksekusi fungsi yang diganti berubah'; end if;
end $check$;
