-- Identitas cabang untuk dokumen cetak (Andri 26 Nov 2026: rekam medis harus tercetak dengan logo + nama + alamat CABANG kunjungannya,
-- mis. Kamo Pets Clinic Cimanggu, bukan kop tetap "KAMO PET CARE").
--
-- Yang ditambahkan (aditif; tidak ada fungsi lama yang diganti, tidak ada data yang diisi: semua kolom baru NULL sampai Owner/Admin mengisinya di layar):
--  1. public.branches: kolom alamat, telepon, logo_path (nama cabang SUDAH ada: kolom name, diubah lewat Perusahaan > Cabang / update_branch_info).
--     CHECK: panjang/karakter alamat + telepon; logo_path hanya boleh 'cabang-logo/<id cabang itu sendiri>/<nama aman>.(png|jpg|jpeg|webp)'.
--  2. public.update_branch_identity(...): satu-satunya jalan menulis ketiga kolom itu. SECURITY DEFINER, hanya OWNER/ADMIN aktif, kunci baris,
--     berkas logo wajib sudah ada di storage (bucket dokumen), jejak ke clinic_private.master_edit_audit.
--  3. Pemicu penjaga a00_guard_branch_identity_edit: akun login (authenticated/anon) tidak bisa mengubah ketiga kolom lewat REST langsung
--     (kebijakan branches_update memakai USING true, jadi tanpa pemicu ini akun mana pun bisa menimpa alamat/logo yang tercetak di dokumen).
--  4. Storage: berkas logo disimpan di bucket `dokumen` awalan `cabang-logo/<id cabang>/`. Kebijakan lama TIDAK diubah. Ditambah empat kebijakan
--     RESTRICTIVE yang hanya berlaku untuk bucket dokumen + awalan cabang-logo/: unggah hanya OWNER/ADMIN dengan nama yang sah (cabang ada),
--     hapus hanya OWNER/ADMIN, ubah ditolak untuk semua. BACA tetap lewat kebijakan lama dokumen_read (semua akun internal; logo tercetak di dokumen)
--     dan Admin Online tetap ditolak oleh pagar lama admin_online_fence_storage. Objek lain (pengeluaran/, pembelian/, komplain/, bucket lain) tidak tersentuh:
--     ekspresi kebijakan bernilai true sebelum fungsi apa pun dipanggil.
--  5. Pagar Admin Online dijalankan ulang (guard_all/fence_all): fungsi baru menolak Admin Online; fungsi kebijakan storage sengaja dikecualikan
--     guard_all karena dipakai kebijakan, jadi masing-masing sudah menolak peran selain OWNER/ADMIN sendiri.
--
-- ROLLBACK (garis besar; berkas lengkap di folder bukti):
--   drop policy cabang_logo_tulis_ketat / cabang_logo_hapus_ketat / cabang_logo_ubah_ketat on storage.objects;
--   drop trigger a00_guard_branch_identity_edit on public.branches; drop function public.guard_branch_identity_direct_edit();
--   drop function public.update_branch_identity(uuid, text, text, text, boolean); drop function public.cabang_logo_boleh_tulis(text); drop function public.cabang_logo_boleh_hapus(text);
--   alter table public.branches drop constraint branches_identitas_cek; alter table public.branches drop column alamat, drop column telepon, drop column logo_path;
set local lock_timeout = '5s';

-- ───────────── 1. Kolom + batasan ─────────────
alter table public.branches add column alamat text, add column telepon text, add column logo_path text;
alter table public.branches add constraint branches_identitas_cek check (
  (alamat is null or (length(alamat) between 3 and 200 and alamat !~ '[[:cntrl:]]'))
  and (telepon is null or (length(telepon) between 3 and 30 and telepon ~ '^[0-9+()./, -]+$'))
  and (logo_path is null or logo_path ~* ('^cabang-logo/' || id::text || '/[a-z0-9._-]{1,120}\.(png|jpe?g|webp)$'))
);
comment on column public.branches.alamat is 'Alamat cabang untuk kop dokumen cetak (opsional). Hanya lewat update_branch_identity.';
comment on column public.branches.telepon is 'Telepon cabang untuk kop dokumen cetak (opsional). Hanya lewat update_branch_identity.';
comment on column public.branches.logo_path is 'Jalur logo cabang di bucket dokumen (cabang-logo/<id>/<berkas>); dibaca lewat tautan bertanda tangan dari server. Hanya lewat update_branch_identity.';

-- ───────────── 2. Penjaga penulisan langsung ─────────────
create function public.guard_branch_identity_direct_edit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.alamat is distinct from old.alamat or new.telepon is distinct from old.telepon or new.logo_path is distinct from old.logo_path) then
    raise exception 'Alamat, telepon, dan logo cabang hanya bisa diubah lewat Pengaturan > Cabang' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger a00_guard_branch_identity_edit before update on public.branches
  for each row execute function public.guard_branch_identity_direct_edit();

-- ───────────── 3. Satu-satunya jalan menulis: update_branch_identity ─────────────
create function public.update_branch_identity(p_id uuid, p_alamat text, p_telepon text, p_logo_path text default null, p_ubah_logo boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := clinic_private.master_actor_role();
  b public.branches%rowtype;
  v_alamat text; v_telepon text; v_logo text;
begin
  if v_role is null or v_role not in ('OWNER', 'ADMIN') then
    raise exception 'Hanya OWNER/ADMIN aktif yang dapat mengubah identitas cabang' using errcode = '42501';
  end if;
  select * into b from public.branches where id = p_id for update;
  if not found then raise exception 'Cabang tidak ditemukan' using errcode = 'CG002'; end if;

  v_alamat := nullif(regexp_replace(btrim(coalesce(p_alamat, '')), '\s+', ' ', 'g'), '');
  v_telepon := nullif(regexp_replace(btrim(coalesce(p_telepon, '')), '\s+', ' ', 'g'), '');
  if v_alamat is not null and (length(v_alamat) not between 3 and 200 or v_alamat ~ '[[:cntrl:]]') then
    raise exception 'Alamat cabang 3 sampai 200 karakter' using errcode = '22023';
  end if;
  if v_telepon is not null and (length(v_telepon) not between 3 and 30 or v_telepon !~ '^[0-9+()./, -]+$') then
    raise exception 'Telepon cabang 3 sampai 30 karakter: angka, spasi, plus, kurung, titik, koma, garis miring, atau tanda minus' using errcode = '22023';
  end if;

  v_logo := case when coalesce(p_ubah_logo, false) then nullif(btrim(coalesce(p_logo_path, '')), '') else b.logo_path end;
  if coalesce(p_ubah_logo, false) and v_logo is not null and v_logo is distinct from b.logo_path then
    if v_logo !~* ('^cabang-logo/' || b.id::text || '/[a-z0-9._-]{1,120}\.(png|jpe?g|webp)$') then
      raise exception 'Jalur logo tidak sah untuk cabang ini' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'dokumen' and o.name = v_logo) then
      raise exception 'Berkas logo belum terunggah' using errcode = '22023';
    end if;
  end if;

  if v_alamat is not distinct from b.alamat and v_telepon is not distinct from b.telepon and v_logo is not distinct from b.logo_path then
    return jsonb_build_object('id', b.id, 'alamat', b.alamat, 'telepon', b.telepon, 'logo_path', b.logo_path, 'logo_lama', null, 'changed', false);
  end if;

  update public.branches set alamat = v_alamat, telepon = v_telepon, logo_path = v_logo where id = b.id;
  insert into clinic_private.master_edit_audit(entity, entity_id, action, before_state, after_state, actor_id)
    values ('branches', b.id, 'update',
            jsonb_build_object('alamat', b.alamat, 'telepon', b.telepon, 'logo_path', b.logo_path),
            jsonb_build_object('alamat', v_alamat, 'telepon', v_telepon, 'logo_path', v_logo), auth.uid());
  return jsonb_build_object('id', b.id, 'alamat', v_alamat, 'telepon', v_telepon, 'logo_path', v_logo,
                            'logo_lama', case when b.logo_path is distinct from v_logo then b.logo_path end, 'changed', true);
end $$;
comment on function public.update_branch_identity(uuid, text, text, text, boolean) is 'Ubah alamat, telepon, logo cabang untuk kop dokumen. Hanya OWNER/ADMIN aktif; berkas logo harus sudah ada di storage.';
revoke all on function public.update_branch_identity(uuid, text, text, text, boolean) from public, anon, service_role;
grant execute on function public.update_branch_identity(uuid, text, text, text, boolean) to authenticated;
revoke all on function public.guard_branch_identity_direct_edit() from public, anon, authenticated, service_role;

-- ───────────── 4. Storage: fungsi kebijakan (dipanggil sebagai pengguna, jadi harus dapat dieksekusi authenticated) ─────────────
create function public.cabang_logo_boleh_tulis(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $f$
declare v_role text;
begin
  v_role := clinic_private.master_actor_role();
  if v_role is null or v_role not in ('OWNER', 'ADMIN') then return false; end if;      -- Admin Online, staf, dokter, finance, akun nonaktif, tanpa sesi
  if p_name is null or p_name !~* '^cabang-logo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9._-]{1,120}\.(png|jpe?g|webp)$' then return false; end if;
  return exists (select 1 from public.branches x where x.id::text = lower(split_part(p_name, '/', 2)));
end $f$;
comment on function public.cabang_logo_boleh_tulis(text) is 'Kebijakan storage cabang-logo/: unggah hanya OWNER/ADMIN, nama harus cabang-logo/<id cabang yang ada>/<berkas png|jpg|jpeg|webp>.';
revoke all on function public.cabang_logo_boleh_tulis(text) from public, anon, service_role;
grant execute on function public.cabang_logo_boleh_tulis(text) to authenticated;

create function public.cabang_logo_boleh_hapus(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $f$
declare v_role text;
begin
  v_role := clinic_private.master_actor_role();
  return v_role is not null and v_role in ('OWNER', 'ADMIN');
end $f$;
comment on function public.cabang_logo_boleh_hapus(text) is 'Kebijakan storage cabang-logo/: hapus hanya OWNER/ADMIN aktif.';
revoke all on function public.cabang_logo_boleh_hapus(text) from public, anon, service_role;
grant execute on function public.cabang_logo_boleh_hapus(text) to authenticated;

-- ───────────── 5. Kebijakan RESTRICTIVE di storage.objects (hanya bila kolom owner_id ada: Supabase asli) ─────────────
do $storage$
begin
  if to_regclass('storage.objects') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
    raise notice 'CABANG_LOGO: storage.objects tanpa kolom owner_id (bukan Supabase): kebijakan storage dilewati';
    return;
  end if;
  execute $p$create policy cabang_logo_tulis_ketat on storage.objects as restrictive for insert to authenticated
    with check (bucket_id <> 'dokumen' or name not like 'cabang-logo/%' or public.cabang_logo_boleh_tulis(name))$p$;
  execute $p$create policy cabang_logo_hapus_ketat on storage.objects as restrictive for delete to authenticated
    using (bucket_id <> 'dokumen' or name not like 'cabang-logo/%' or public.cabang_logo_boleh_hapus(name))$p$;
  execute $p$create policy cabang_logo_ubah_ketat on storage.objects as restrictive for update to authenticated
    using (bucket_id <> 'dokumen' or name not like 'cabang-logo/%') with check (bucket_id <> 'dokumen' or name not like 'cabang-logo/%')$p$;
end $storage$;

-- ───────────── 6. Pagar Admin Online (jalankan ulang; fungsi kebijakan dikecualikan guard_all karena dipakai kebijakan) ─────────────
select admin_online_private.guard_all();
select admin_online_private.fence_all();
notify pgrst, 'reload schema';

-- ───────────── 7. Pemeriksaan pasang: gagal = seluruh migrasi batal ─────────────
do $check$
declare f record;
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'branches' and column_name in ('alamat', 'telepon', 'logo_path') and is_nullable = 'YES') <> 3 then
    raise exception 'CABANG_IDENTITAS_KOLOM: tiga kolom nullable harus ada'; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.branches'::regclass and conname = 'branches_identitas_cek') then
    raise exception 'CABANG_IDENTITAS_CEK: batasan hilang'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.branches'::regclass and tgname = 'a00_guard_branch_identity_edit' and not tgisinternal) then
    raise exception 'CABANG_IDENTITAS_PEMICU: pemicu penjaga tidak terpasang'; end if;
  for f in select p.oid, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('update_branch_identity', 'cabang_logo_boleh_tulis', 'cabang_logo_boleh_hapus') loop
    if has_function_privilege('anon', f.oid, 'execute') or has_function_privilege('service_role', f.oid, 'execute') or not has_function_privilege('authenticated', f.oid, 'execute') then
      raise exception 'CABANG_IDENTITAS_ACL: hak eksekusi % salah', f.proname; end if;
    if not exists (select 1 from pg_proc p where p.oid = f.oid and p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=""']) then
      raise exception 'CABANG_IDENTITAS_SECDEF: % harus SECURITY DEFINER dengan search_path kosong', f.proname; end if;
  end loop;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('update_branch_identity', 'cabang_logo_boleh_tulis', 'cabang_logo_boleh_hapus')) <> 3 then
    raise exception 'CABANG_IDENTITAS_FUNGSI: tiga fungsi harus ada'; end if;
  if has_function_privilege('authenticated', 'public.guard_branch_identity_direct_edit()'::regprocedure, 'execute') then
    raise exception 'CABANG_IDENTITAS_ACL_PEMICU: fungsi pemicu tidak boleh dapat dieksekusi klien'; end if;
  if (select prosrc from pg_proc where oid = 'public.update_branch_identity(uuid,text,text,text,boolean)'::regprocedure) !~ 'admin_online_private\.deny_admin_online' then
    raise exception 'CABANG_IDENTITAS_PAGAR: update_branch_identity tanpa penjaga Admin Online'; end if;
  if to_regclass('storage.objects') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
    if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and permissive = 'RESTRICTIVE'
          and policyname in ('cabang_logo_tulis_ketat', 'cabang_logo_hapus_ketat', 'cabang_logo_ubah_ketat')) <> 3 then
      raise exception 'CABANG_IDENTITAS_KEBIJAKAN: tiga kebijakan RESTRICTIVE storage harus ada'; end if;
  end if;
  if exists (select 1 from public.branches where alamat is not null or telepon is not null or logo_path is not null) then
    raise exception 'CABANG_IDENTITAS_DATA: migrasi tidak boleh mengisi data'; end if;
end $check$;
