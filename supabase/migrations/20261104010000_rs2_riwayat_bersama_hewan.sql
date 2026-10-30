-- RS-2: riwayat bersama hasil impor terbaca OWNER di jalur pelanggan → hewan → riwayat → detail,
-- juga saat cabang aktif klinik dipilih. Baca-saja, per hewan / per kunjungan, terbatas.
--
-- Desain: docs/desain-rs2-riwayat-bersama-hewan.md (checkpoint 1f4b4dc + koreksi review 1–3).
-- Batas yang disetujui review: OWNER aktif saja. ADMIN/DOCTOR/STAFF/FINANCE tidak berubah (D3 terpisah).
-- Pemasangan ke Production BELUM disetujui: SQL final menunggu review independen + izin terpisah.
--
-- Masalah: dengan header cabang aktif (x-kamo-operational-branch), user_can_access_branch(NULL) = false,
-- sehingga restrictive operational_branch_isolation menyembunyikan kunjungan tanpa cabang dari SELECT biasa.
-- Halaman riwayat pasien menampilkan 0 riwayat dan detail menjadi notFound.
--
-- Inti (pola RS-1, migrasi 20261101120000):
--   * public.riwayat_bersama_hewan(uuid, integer, integer) dan public.detail_riwayat_bersama(uuid):
--     SECURITY INVOKER (JWT + header asli pemanggil), memanggil pembaca privat.
--   * kamo_import.baca_riwayat_bersama_hewan / baca_detail_riwayat_bersama: SECURITY DEFINER milik
--     kamo_legacy_import_writer (NOLOGIN NOBYPASSRLS), membaca lewat kebijakan kamo_import_baca dan hak kolom
--     yang SUDAH ADA. Hanya baris branch_id IS NULL + legacy_source_key IS NOT NULL, dan hanya bila
--     visits.customer_id = pemilik hewan di pets (pelanggan↔hewan↔kunjungan konsisten).
--   * kamo_import.pastikan_pembaca_riwayat_bersama: OWNER aktif; header (bila ada) harus cabang aktif yang
--     boleh diakses. Header tidak dihapus atau diganti.
--
-- TIDAK ada: GRANT tabel/kolom baru, kebijakan baru/berubah, perubahan user_can_access_branch, service-role,
-- penghapusan header, bypass RLS, UPDATE/DELETE data, backfill, relink, atau impor ulang. Fungsi STABLE
-- sehingga DML di dalamnya ditolak Postgres. D1/D2/RS-1 tetap. Gerbang di akhir membandingkan jepretan
-- hak/kebijakan/fungsi lama sebelum dan sesudah; beda sedikit saja = seluruh migrasi batal.

-- ---------------------------------------------------------------------------
-- 0. Jepretan keadaan yang TIDAK boleh berubah (fungsi sementara sesi, hilang di akhir sesi)
-- ---------------------------------------------------------------------------
create function pg_temp.rs2_jepret() returns text
language sql stable set search_path = '' as $f$
  select concat_ws(E'\n',
    -- Hak tabel dan kolom role penulis.
    (select string_agg(s.x, ',' order by s.x) from (
       select c.oid::regclass::text || ':' || a.privilege_type as x
       from pg_class c cross join lateral aclexplode(c.relacl) a
       where a.grantee = 'kamo_legacy_import_writer'::regrole
       union all
       select c.oid::regclass::text || '.' || att.attname || ':' || a.privilege_type
       from pg_attribute att join pg_class c on c.oid = att.attrelid cross join lateral aclexplode(att.attacl) a
       where a.grantee = 'kamo_legacy_import_writer'::regrole) s),
    -- Semua kebijakan RLS di skema public (nama, perintah, jenis, role, USING, WITH CHECK).
    (select md5(string_agg(pol.polrelid::regclass::text || '|' || pol.polname || '|' || pol.polcmd::text || '|' || pol.polpermissive::text || '|'
                           || array_to_string(array(select r::regrole::text from unnest(pol.polroles) r order by r::regrole::text), ',') || '|'
                           || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || '|'
                           || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
                           E'\n' order by pol.polrelid::regclass::text, pol.polname))
     from pg_policy pol join pg_class c on c.oid = pol.polrelid where c.relnamespace = 'public'::regnamespace),
    -- Fungsi kamo_import lama + fungsi akses/identitas yang dipakai (definisi, pemilik, ACL).
    (select string_agg(p.oid::regprocedure::text || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proacl::text, '') || '|'
                       || md5(pg_get_functiondef(p.oid)), E'\n' order by p.oid::regprocedure::text)
     from pg_proc p
     where (p.pronamespace = 'kamo_import'::regnamespace
            and p.proname not in ('pastikan_pembaca_riwayat_bersama', 'baca_riwayat_bersama_hewan', 'baca_detail_riwayat_bersama'))
        or p.oid in ('public.user_can_access_branch(uuid)'::regprocedure, 'public.can_read_legacy_medical_history()'::regprocedure,
                     'public.has_role_capability(text)'::regprocedure, 'public.is_admin()'::regprocedure,
                     'public.hasil_impor_rekam_medis(text[])'::regprocedure, 'auth.uid()'::regprocedure)),
    -- Keanggotaan dan atribut role penulis, ACL skema kamo_import.
    (select string_agg(m.member::regrole::text || '>' || m.roleid::regrole::text || ':' || m.admin_option || '/' || m.inherit_option
                       || '/' || m.set_option || ':' || m.grantor::regrole::text,
                       ',' order by m.member::regrole::text, m.roleid::regrole::text, m.grantor::regrole::text)
     from pg_auth_members m
     where m.roleid = 'kamo_legacy_import_writer'::regrole or m.member = 'kamo_legacy_import_writer'::regrole),
    (select concat_ws('|', r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolreplication, r.rolbypassrls)
     from pg_roles r where r.rolname = 'kamo_legacy_import_writer'),
    (select n.nspname || ':' || coalesce(n.nspacl::text, '') from pg_namespace n where n.nspname = 'kamo_import'))
$f$;

-- ---------------------------------------------------------------------------
-- 1. Prasyarat — gagal tertutup
-- ---------------------------------------------------------------------------
do $precheck$
declare
  w constant text := 'kamo_legacy_import_writer';
  v_role pg_roles%rowtype;
  v_col text;
begin
  if current_setting('server_version_num')::int < 160000 then
    raise exception 'RS-2: butuh PostgreSQL 16+ (GRANT ... WITH SET)';
  end if;
  select * into v_role from pg_roles where rolname = w;
  if not found then
    raise exception 'RS-2: role kamo_legacy_import_writer belum ada (migrasi 20261101120000 wajib terpasang dulu)';
  end if;
  if v_role.rolsuper or v_role.rolbypassrls or v_role.rolcanlogin or v_role.rolinherit or v_role.rolcreaterole
     or v_role.rolcreatedb or v_role.rolreplication
     or exists (select 1 from pg_auth_members m where m.member = w::regrole)
     or exists (select 1 from pg_auth_members m where m.roleid = w::regrole and (m.set_option or m.inherit_option)) then
    raise exception 'RS-2: role penulis tidak dalam keadaan sempit yang ditinjau';
  end if;
  if to_regnamespace('kamo_import') is null
     or (select count(*) from pg_proc p where p.pronamespace = 'kamo_import'::regnamespace) <> 14
     or exists (select 1 from pg_proc p where p.pronamespace = 'kamo_import'::regnamespace and pg_get_userbyid(p.proowner) <> w) then
    raise exception 'RS-2: skema kamo_import tidak sama dengan keadaan pasca 20261101120000';
  end if;
  if to_regprocedure('public.riwayat_bersama_hewan(uuid,integer,integer)') is not null
     or to_regprocedure('public.detail_riwayat_bersama(uuid)') is not null then
    raise exception 'RS-2: fungsi pembaca publik sudah ada';
  end if;
  -- Identitas: helper role penulis tetap setara persis dengan auth.uid() yang sidiknya ditinjau.
  if md5(pg_get_functiondef('auth.uid()'::regprocedure)) <> 'ea3b41bf29e2ad573067939329aa088e'
     or (select prosrc from pg_proc where oid = 'kamo_import.uid_permintaan()'::regprocedure)
        is distinct from (select prosrc from pg_proc where oid = 'auth.uid()'::regprocedure) then
    raise exception 'RS-2: helper identitas tidak setara dengan auth.uid() yang ditinjau';
  end if;
  -- Kebijakan baca role penulis yang diandalkan pembaca (tidak dibuat/diubah di sini).
  if (select count(*) from pg_policy pol
      where pol.polname = 'kamo_import_baca' and pol.polcmd = 'r' and pol.polroles = array[w::regrole::oid]
        and pol.polrelid in ('public.visits'::regclass, 'public.medical_records'::regclass, 'public.pets'::regclass, 'public.profiles'::regclass)) <> 4 then
    raise exception 'RS-2: kebijakan kamo_import_baca yang dibutuhkan tidak lengkap';
  end if;
  -- Hak kolom yang dibaca HARUS sudah ada; migrasi ini tidak memberi hak tabel/kolom.
  foreach v_col in array array['id', 'branch_id', 'customer_id', 'pet_id', 'created_at', 'dokter', 'keluhan', 'legacy_source_key'] loop
    if not has_column_privilege(w, 'public.visits', v_col, 'SELECT') then
      raise exception 'RS-2: role penulis tidak bisa membaca visits.%', v_col;
    end if;
  end loop;
  foreach v_col in array array['id', 'visit_id', 'diagnosis', 'anamnesis', 'gejala_klinis', 'catatan_resep'] loop
    if not has_column_privilege(w, 'public.medical_records', v_col, 'SELECT') then
      raise exception 'RS-2: role penulis tidak bisa membaca medical_records.%', v_col;
    end if;
  end loop;
  if not has_column_privilege(w, 'public.pets', 'id', 'SELECT') or not has_column_privilege(w, 'public.pets', 'customer_id', 'SELECT')
     or not has_column_privilege(w, 'public.profiles', 'id', 'SELECT') or not has_column_privilege(w, 'public.profiles', 'role', 'SELECT')
     or not has_column_privilege(w, 'public.profiles', 'is_active', 'SELECT')
     or not has_function_privilege(w, 'public.user_can_access_branch(uuid)', 'EXECUTE')
     or not has_function_privilege(w, 'kamo_import.uid_permintaan()', 'EXECUTE') then
    raise exception 'RS-2: hak baca/eksekusi role penulis yang dibutuhkan tidak lengkap';
  end if;
end $precheck$;

select set_config('kamo_rs2.jepret_awal', pg_temp.rs2_jepret(), true);

-- ---------------------------------------------------------------------------
-- 2. Validator pembaca: OWNER aktif; header (bila ada) cabang aktif yang boleh diakses
-- ---------------------------------------------------------------------------
create function kamo_import.pastikan_pembaca_riwayat_bersama() returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_header text;
  v_uid uuid := kamo_import.uid_permintaan();
begin
  if v_uid is null or not exists (
    select 1 from public.profiles p where p.id = v_uid and p.is_active and p.role = 'OWNER'
  ) then
    raise exception using errcode = '42501', message = 'Riwayat bersama dari cabang aktif hanya untuk OWNER aktif';
  end if;
  -- Header cabang tidak dihapus/diubah: bila ada, harus cabang aktif yang boleh diakses pemanggil.
  -- JSON/uuid rusak = galat = ditolak.
  v_header := nullif(btrim(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-kamo-operational-branch', '')), '');
  if v_header is not null and public.user_can_access_branch(v_header::uuid) is not true then
    raise exception using errcode = '42501', message = 'Cabang aktif tidak valid atau tidak boleh diakses';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Pembaca per hewan: hanya riwayat bersama, satu baris per kunjungan, berhalaman
-- ---------------------------------------------------------------------------
create function kamo_import.baca_riwayat_bersama_hewan(p_pet uuid, p_dari integer, p_jumlah integer)
returns table(visit_id uuid, pet_id uuid, customer_id uuid, tanggal timestamptz, dokter text, keluhan text,
              diagnosis text, anamnesis text, gejala_klinis text, terapi text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kamo_import.pastikan_pembaca_riwayat_bersama();
  if p_pet is null or p_dari is null or p_jumlah is null
     or p_dari not between 0 and 10000 or p_jumlah not between 1 and 200 then
    raise exception using errcode = '22023', message = 'Hewan wajib diisi; halaman 0–10000, jumlah 1–200';
  end if;
  return query
    select v.id, v.pet_id, v.customer_id, v.created_at, v.dokter::text, v.keluhan, m.diagnosis, m.anamnesis, m.gejala_klinis, m.catatan_resep
    from public.visits v
    join public.pets p on p.id = v.pet_id and p.customer_id = v.customer_id
    join lateral (select mr.diagnosis, mr.anamnesis, mr.gejala_klinis, mr.catatan_resep
                  from public.medical_records mr where mr.visit_id = v.id order by mr.id limit 1) m on true
    where v.pet_id = p_pet and v.branch_id is null and v.legacy_source_key is not null
    order by v.created_at desc, v.id
    offset p_dari limit p_jumlah;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Pembaca detail: kosong bila tidak ada ATAU bercabang (tidak bisa dibedakan, tanpa metadata)
-- ---------------------------------------------------------------------------
create function kamo_import.baca_detail_riwayat_bersama(p_visit uuid)
returns table(visit_id uuid, pet_id uuid, customer_id uuid, tanggal timestamptz, dokter text, keluhan text,
              diagnosis text, anamnesis text, gejala_klinis text, terapi text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kamo_import.pastikan_pembaca_riwayat_bersama();
  if p_visit is null then
    raise exception using errcode = '22023', message = 'Kunjungan wajib diisi';
  end if;
  return query
    select v.id, v.pet_id, v.customer_id, v.created_at, v.dokter::text, v.keluhan, m.diagnosis, m.anamnesis, m.gejala_klinis, m.catatan_resep
    from public.visits v
    join public.pets p on p.id = v.pet_id and p.customer_id = v.customer_id
    join lateral (select mr.diagnosis, mr.anamnesis, mr.gejala_klinis, mr.catatan_resep
                  from public.medical_records mr where mr.visit_id = v.id order by mr.id limit 1) m on true
    where v.id = p_visit and v.branch_id is null and v.legacy_source_key is not null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Pembungkus publik INVOKER (identitas & header asli pemanggil)
-- ---------------------------------------------------------------------------
create function public.riwayat_bersama_hewan(p_pet uuid, p_dari integer, p_jumlah integer)
returns table(visit_id uuid, pet_id uuid, customer_id uuid, tanggal timestamptz, dokter text, keluhan text,
              diagnosis text, anamnesis text, gejala_klinis text, terapi text)
language sql stable security invoker set search_path = '' as $$
  select * from kamo_import.baca_riwayat_bersama_hewan(p_pet, p_dari, p_jumlah)
$$;
comment on function public.riwayat_bersama_hewan(uuid, integer, integer) is
  'Riwayat bersama (tanpa cabang, hasil impor) satu hewan untuk OWNER aktif, 1–200 baris per halaman. INVOKER; validasi di kamo_import.';

create function public.detail_riwayat_bersama(p_visit uuid)
returns table(visit_id uuid, pet_id uuid, customer_id uuid, tanggal timestamptz, dokter text, keluhan text,
              diagnosis text, anamnesis text, gejala_klinis text, terapi text)
language sql stable security invoker set search_path = '' as $$
  select * from kamo_import.baca_detail_riwayat_bersama(p_visit)
$$;
comment on function public.detail_riwayat_bersama(uuid) is
  'Detail baca-saja satu riwayat bersama (tanpa cabang, hasil impor) untuk OWNER aktif. INVOKER; validasi di kamo_import.';

-- ---------------------------------------------------------------------------
-- 6. ACL SEBELUM pindah pemilik (sesudahnya admin migrasi tidak bisa memberi hak lagi) — pola §9 PR342
-- ---------------------------------------------------------------------------
revoke all on function kamo_import.pastikan_pembaca_riwayat_bersama(),
  kamo_import.baca_riwayat_bersama_hewan(uuid, integer, integer),
  kamo_import.baca_detail_riwayat_bersama(uuid) from public, anon, authenticated, service_role;
-- Pembungkus INVOKER memanggil pembaca sebagai authenticated. Validator hanya dipanggil fungsi milik
-- role penulis (pemiliknya sendiri), jadi tidak diberikan ke authenticated.
grant execute on function kamo_import.baca_riwayat_bersama_hewan(uuid, integer, integer),
  kamo_import.baca_detail_riwayat_bersama(uuid) to authenticated;
revoke all on function public.riwayat_bersama_hewan(uuid, integer, integer),
  public.detail_riwayat_bersama(uuid) from public, anon, service_role;
grant execute on function public.riwayat_bersama_hewan(uuid, integer, integer),
  public.detail_riwayat_bersama(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Pindah pemilik TIGA fungsi baru saja ke role penulis (urutan identik §10 PR342)
-- ---------------------------------------------------------------------------
do $pemilik$
declare
  v_runner text := current_user;
begin
  execute format('grant kamo_legacy_import_writer to %I with set true, inherit false', v_runner);
  grant create on schema kamo_import to kamo_legacy_import_writer;
  alter function kamo_import.pastikan_pembaca_riwayat_bersama() owner to kamo_legacy_import_writer;
  alter function kamo_import.baca_riwayat_bersama_hewan(uuid, integer, integer) owner to kamo_legacy_import_writer;
  alter function kamo_import.baca_detail_riwayat_bersama(uuid) owner to kamo_legacy_import_writer;
  revoke create on schema kamo_import from kamo_legacy_import_writer;
  execute format('revoke kamo_legacy_import_writer from %I granted by %I', v_runner, v_runner);
end $pemilik$;

-- ---------------------------------------------------------------------------
-- 8. Gerbang pasca-cek — gagal tertutup (seluruh migrasi batal bila satu saja gagal)
-- ---------------------------------------------------------------------------
do $gerbang$
declare
  w constant text := 'kamo_legacy_import_writer';
  v_baru constant text[] := array['pastikan_pembaca_riwayat_bersama', 'baca_riwayat_bersama_hewan', 'baca_detail_riwayat_bersama'];
  v_bad text;
  v_role pg_roles%rowtype;
  d text;
begin
  -- Keadaan lama identik: hak tabel/kolom role, semua kebijakan public, fungsi kamo_import lama & fungsi akses,
  -- keanggotaan/atribut role, ACL skema.
  if pg_temp.rs2_jepret() is distinct from current_setting('kamo_rs2.jepret_awal') then
    raise exception 'Gerbang RS-2: hak, kebijakan, atau fungsi lama berubah';
  end if;
  -- Fungsi baru: 17 total, semua milik role penulis, SECURITY DEFINER, STABLE, plpgsql, search_path kosong.
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
  where p.pronamespace = 'kamo_import'::regnamespace and pg_get_userbyid(p.proowner) <> w;
  if v_bad is not null or (select count(*) from pg_proc p where p.pronamespace = 'kamo_import'::regnamespace) <> 17
     or (select count(*) from pg_proc p where p.pronamespace = 'kamo_import'::regnamespace and p.proname = any(v_baru)) <> 3 then
    raise exception 'Gerbang RS-2: fungsi kamo_import tidak lengkap/tidak dimiliki role penulis: %', coalesce(v_bad, 'jumlah fungsi salah');
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
  where p.pronamespace = 'kamo_import'::regnamespace and p.proname = any(v_baru)
    and (not p.prosecdef or p.provolatile <> 's' or p.prolang <> (select oid from pg_language where lanname = 'plpgsql')
         or array_to_string(p.proconfig, ',') is distinct from 'search_path=""'
         or p.proacl is null
         or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
         or has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('service_role', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE') <> (p.proname <> 'pastikan_pembaca_riwayat_bersama')
         or exists (select 1 from aclexplode(p.proacl) a
                    where a.grantee not in (p.proowner, 'authenticated'::regrole::oid) or a.privilege_type <> 'EXECUTE' or a.is_grantable));
  if v_bad is not null then
    raise exception 'Gerbang RS-2: ACL/konfigurasi pembaca privat salah: %', v_bad;
  end if;
  -- Pembungkus publik: INVOKER, STABLE, search_path kosong, hanya authenticated (bukan PUBLIC/anon/service_role).
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
  where p.oid in ('public.riwayat_bersama_hewan(uuid,integer,integer)'::regprocedure, 'public.detail_riwayat_bersama(uuid)'::regprocedure)
    and (p.prosecdef or p.provolatile <> 's' or array_to_string(p.proconfig, ',') is distinct from 'search_path=""'
         or p.proacl is null
         or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
         or has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('service_role', p.oid, 'EXECUTE')
         or not has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise exception 'Gerbang RS-2: pembungkus publik harus INVOKER dan hanya untuk authenticated: %', v_bad;
  end if;
  -- Role penulis tetap sempit: atribut, keanggotaan, keterjangkauan SET ROLE, CREATE skema, USAGE auth.
  select * into v_role from pg_roles where rolname = w;
  if v_role.rolsuper or v_role.rolbypassrls or v_role.rolcanlogin or v_role.rolinherit or v_role.rolcreaterole
     or v_role.rolcreatedb or v_role.rolreplication
     or exists (select 1 from pg_auth_members m where m.member = w::regrole)
     or exists (select 1 from pg_auth_members m where m.roleid = w::regrole and (m.set_option or m.inherit_option)) then
    raise exception 'Gerbang RS-2: role penulis tidak sempit setelah pindah pemilik';
  end if;
  select string_agg(r.rolname, ', ') into v_bad from pg_roles r
  where not r.rolsuper and r.rolname <> w and pg_has_role(r.oid, w::regrole, 'SET');
  if v_bad is not null then
    raise exception 'Gerbang RS-2: role penulis bisa di-SET oleh: %', v_bad;
  end if;
  -- Skema sementara sesi migrasi ini (jepretan di §0) dikecualikan: Postgres melaporkan CREATE di sana untuk
  -- setiap role ber-hak TEMP, bukan hak yang diberikan; skema itu hilang di akhir sesi.
  select string_agg(n.nspname, ', ') into v_bad from pg_namespace n
  where has_schema_privilege(w, n.oid, 'CREATE') and n.oid is distinct from pg_my_temp_schema();
  if v_bad is not null or has_schema_privilege(w, 'auth', 'USAGE') then
    raise exception 'Gerbang RS-2: role penulis punya CREATE skema atau USAGE auth: %', coalesce(v_bad, 'auth');
  end if;
  -- Isi: validator OWNER aktif + header; pembaca memvalidasi dulu, hanya riwayat bersama berjejak, relasi konsisten.
  d := pg_get_functiondef('kamo_import.pastikan_pembaca_riwayat_bersama()'::regprocedure);
  if position('p.is_active and p.role = ''OWNER''' in d) = 0 or position('kamo_import.uid_permintaan()' in d) = 0
     or position('public.user_can_access_branch(v_header::uuid) is not true' in d) = 0 or d ~* 'auth\s*\.\s*uid' then
    raise exception 'Gerbang RS-2: validator pembaca tidak sesuai';
  end if;
  foreach v_bad in array array['kamo_import.baca_riwayat_bersama_hewan(uuid,integer,integer)', 'kamo_import.baca_detail_riwayat_bersama(uuid)'] loop
    d := pg_get_functiondef(v_bad::regprocedure);
    if position('perform kamo_import.pastikan_pembaca_riwayat_bersama();' in d) = 0
       or position('perform kamo_import.pastikan_pembaca_riwayat_bersama();' in d) > position('return query' in d)
       or position('v.branch_id is null and v.legacy_source_key is not null' in d) = 0
       or position('join public.pets p on p.id = v.pet_id and p.customer_id = v.customer_id' in d) = 0
       or position('limit 1) m on true' in d) = 0
       or d ~* '\m(insert|update|delete|truncate|merge)\M' or d ~* 'auth\s*\.\s*uid' then
      raise exception 'Gerbang RS-2: pembaca % tidak sesuai', v_bad;
    end if;
  end loop;
  d := pg_get_functiondef('kamo_import.baca_riwayat_bersama_hewan(uuid,integer,integer)'::regprocedure);
  if position('p_dari not between 0 and 10000 or p_jumlah not between 1 and 200' in d) = 0
     or position('offset p_dari limit p_jumlah' in d) = 0 or position('where v.pet_id = p_pet' in d) = 0 then
    raise exception 'Gerbang RS-2: batas halaman pembaca hewan tidak sesuai';
  end if;
  if position('kamo_import.baca_riwayat_bersama_hewan(p_pet, p_dari, p_jumlah)' in
              pg_get_functiondef('public.riwayat_bersama_hewan(uuid,integer,integer)'::regprocedure)) = 0
     or position('kamo_import.baca_detail_riwayat_bersama(p_visit)' in
              pg_get_functiondef('public.detail_riwayat_bersama(uuid)'::regprocedure)) = 0 then
    raise exception 'Gerbang RS-2: pembungkus publik tidak memanggil pembaca privat';
  end if;
end $gerbang$;

drop function pg_temp.rs2_jepret();
