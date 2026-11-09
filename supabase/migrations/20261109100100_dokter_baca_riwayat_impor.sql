-- Dokter boleh MEMBACA riwayat rekam medis hasil impor (kunjungan tanpa cabang) dari semua cabang.
--
-- Keputusan owner (Reza, DM 9 Nov 2026 15:17 WIB, "boleh"): DOKTER aktif boleh membaca (read-only) rekam medis hasil
-- impor (visits.branch_id IS NULL AND legacy_source_key IS NOT NULL) beserta medical_records/pets/customers yang
-- perlu untuk tampil. Hanya baca. Staf non-dokter TIDAK ikut. Akses baris ERP bercabang tidak berubah.
--
-- Sebelumnya: kebijakan RESTRICTIVE `operational_branch_isolation` (FOR ALL) di public.visits mensyaratkan
-- user_can_access_branch(branch_id), yang selalu false untuk branch_id NULL bagi pengguna tanpa hak lintas cabang.
-- Kebijakan permissive `visits_select` dan `mr_select` SUDAH mengizinkan DOKTER membaca impor lewat
-- can_read_legacy_medical_history(), tetapi restrictive itu memotongnya.
--
-- Perubahan:
--   1. AKSES (satu-satunya pelebaran): USING restrictive visits.operational_branch_isolation menjadi
--        (branch_id IS NULL AND legacy_source_key IS NOT NULL AND (select public.dokter_aktif_baca_impor()))
--        OR user_can_access_branch(branch_id)
--      WITH CHECK TIDAK berubah (tetap user_can_access_branch(branch_id)).
--      public.dokter_aktif_baca_impor(): SECURITY INVOKER, STABLE, membaca profil SENDIRI (profiles_select mengizinkan
--      id = auth.uid()): role = 'DOCTOR' AND is_active. Tanpa SECURITY DEFINER.
--   2. KINERJA (logika identik, tidak mengubah siapa melihat apa): visits.visits_select dan medical_records.mr_select
--      ditulis ulang dengan operand OR ditukar dan can_read_legacy_medical_history() (STABLE, tanpa argumen) dibungkus
--      `(select ...)` agar dievaluasi sekali per statement (InitPlan), bukan per baris. Tanpa ini, daftar rekam
--      medis dokter (~8.300 baris, 95% impor) memanggil dua fungsi SECURITY DEFINER per baris per tabel dan butuh
--      ~3,5x waktu OWNER (diukur di PostgreSQL native). Tes memastikan himpunan baris terlihat setiap peran non-dokter
--      identik sebelum/sesudah, dan dokter = sebelum + impor tanpa cabang.
--   Tidak ada kebijakan lain, GRANT tabel/kolom, atau fungsi akses lain yang berubah: sidik seluruh kebijakan public
--   selain tiga kebijakan di atas harus identik sebelum/sesudah, kalau tidak migrasi batal.
-- Hanya baca karena kunci tulis yang SUDAH ADA tetap berlaku untuk semua pengguna `authenticated`:
--   visits: riwayat_bersama_terkunci_update/delete (branch_id IS NOT NULL) + insert; visits_write (ucab atau
--   legacy+is_admin; dokter bukan admin). medical_records/consents/inpatient_records: riwayat_bersama_terkunci_*
--   (kamo_import.tanpa_cabang_kunjungan(visit_id) IS FALSE) + mr_write (ucab atau legacy+is_admin).
--   Prasyarat di bawah memastikan ke-12 kunci itu ada; tanpa itu migrasi batal.
-- Efek ke tabel anak lain lewat restrictive operational_parent_isolation: invoices, follow_ups, visit_referrals,
-- visit_operational_events, clinic_compound_sales, inpatient_records punya permissive SELECT berbasis
-- user_can_access_branch -> tetap tertutup bagi dokter untuk kunjungan tanpa cabang. consents (cs_all) ikut terbaca
-- (data produksi: 0 consent pada kunjungan impor) dan tulisnya terkunci.
-- Idempoten: tiap kebijakan boleh dalam bentuk lama atau bentuk baru; bentuk lain = batal.

create function pg_temp.dbi_kebijakan(p_rel regclass, p_nama text) returns text
language sql stable set search_path = '' as $f$
  select pol.polcmd::text || '|' || pol.polpermissive::text || '|'
         || array_to_string(array(select r::regrole::text from unnest(pol.polroles) r order by 1), ',') || '|'
         || regexp_replace(regexp_replace(coalesce(pg_get_expr(pol.polqual, pol.polrelid), ''), 'public\.', '', 'g'), '\s+', ' ', 'g') || '|'
         || regexp_replace(regexp_replace(coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), 'public\.', '', 'g'), '\s+', ' ', 'g')
    from pg_catalog.pg_policy pol where pol.polrelid = p_rel and pol.polname = p_nama
$f$;

create function pg_temp.dbi_sidik_lain() returns text
language sql stable set search_path = '' as $f$
  select md5(string_agg(pol.polrelid::regclass::text || '|' || pol.polname || '|' || pol.polcmd::text || '|' || pol.polpermissive::text || '|'
                        || array_to_string(array(select r::regrole::text from unnest(pol.polroles) r order by 1), ',') || '|'
                        || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
                        E'\n' order by pol.polrelid::regclass::text, pol.polname))
    from pg_catalog.pg_policy pol join pg_catalog.pg_class c on c.oid = pol.polrelid
   where c.relnamespace = 'public'::regnamespace
     and (pol.polrelid, pol.polname) not in (('public.visits'::regclass, 'operational_branch_isolation'),
                                             ('public.visits'::regclass, 'visits_select'),
                                             ('public.medical_records'::regclass, 'mr_select'))
$f$;

create function pg_temp.dbi_bentuk(p_kebijakan text, p_baru boolean) returns text
language sql immutable as $f$
  select case p_kebijakan
    when 'isolasi' then '*|false|authenticated|' || case when p_baru
      then '(((branch_id IS NULL) AND (legacy_source_key IS NOT NULL) AND ( SELECT dokter_aktif_baca_impor() AS dokter_aktif_baca_impor)) OR user_can_access_branch(branch_id))'
      else 'user_can_access_branch(branch_id)' end || '|user_can_access_branch(branch_id)'
    when 'visits_select' then 'r|true|authenticated|' || case when p_baru
      then '(((legacy_source_key IS NOT NULL) AND ( SELECT can_read_legacy_medical_history() AS can_read_legacy_medical_history)) OR user_can_access_branch(branch_id))'
      else '(user_can_access_branch(branch_id) OR ((legacy_source_key IS NOT NULL) AND can_read_legacy_medical_history()))' end || '|'
    when 'mr_select' then 'r|true|authenticated|' || case when p_baru
      then '(EXISTS ( SELECT 1 FROM visits v WHERE ((v.id = medical_records.visit_id) AND (((v.legacy_source_key IS NOT NULL) AND ( SELECT can_read_legacy_medical_history() AS can_read_legacy_medical_history)) OR user_can_access_branch(v.branch_id)))))'
      else '(EXISTS ( SELECT 1 FROM visits v WHERE ((v.id = medical_records.visit_id) AND (user_can_access_branch(v.branch_id) OR ((v.legacy_source_key IS NOT NULL) AND can_read_legacy_medical_history())))))' end || '|'
  end
$f$;

do $pra$
declare
  v_n int;
  v_k text;
begin
  v_k := pg_temp.dbi_kebijakan('public.visits', 'operational_branch_isolation');
  if v_k is null or v_k not in (pg_temp.dbi_bentuk('isolasi', false), pg_temp.dbi_bentuk('isolasi', true)) then
    raise exception 'DOKTER_BACA_IMPOR: visits.operational_branch_isolation tidak sama dengan yang ditinjau: %', v_k;
  end if;
  v_k := pg_temp.dbi_kebijakan('public.visits', 'visits_select');
  if v_k is null or v_k not in (pg_temp.dbi_bentuk('visits_select', false), pg_temp.dbi_bentuk('visits_select', true)) then
    raise exception 'DOKTER_BACA_IMPOR: visits.visits_select tidak sama dengan yang ditinjau: %', v_k;
  end if;
  v_k := pg_temp.dbi_kebijakan('public.medical_records', 'mr_select');
  if v_k is null or v_k not in (pg_temp.dbi_bentuk('mr_select', false), pg_temp.dbi_bentuk('mr_select', true)) then
    raise exception 'DOKTER_BACA_IMPOR: medical_records.mr_select tidak sama dengan yang ditinjau: %', v_k;
  end if;
  -- Fungsi yang dibungkus InitPlan harus tetap STABLE tanpa argumen (hasil sama sepanjang statement).
  if (select provolatile from pg_proc where oid = 'public.can_read_legacy_medical_history()'::regprocedure) <> 's' then
    raise exception 'DOKTER_BACA_IMPOR: can_read_legacy_medical_history() bukan STABLE';
  end if;
  -- Kunci tulis riwayat impor yang menjadi jaminan "hanya baca" harus ada.
  select count(*) into v_n from pg_policy pol
   where not pol.polpermissive and pol.polroles = array['authenticated'::regrole::oid]
     and (pol.polrelid, pol.polname, pol.polcmd) in (
       ('public.visits'::regclass, 'riwayat_bersama_terkunci_insert', 'a'),
       ('public.visits'::regclass, 'riwayat_bersama_terkunci_update', 'w'),
       ('public.visits'::regclass, 'riwayat_bersama_terkunci_delete', 'd'),
       ('public.medical_records'::regclass, 'riwayat_bersama_terkunci_insert', 'a'),
       ('public.medical_records'::regclass, 'riwayat_bersama_terkunci_update', 'w'),
       ('public.medical_records'::regclass, 'riwayat_bersama_terkunci_delete', 'd'),
       ('public.consents'::regclass, 'riwayat_bersama_terkunci_insert', 'a'),
       ('public.consents'::regclass, 'riwayat_bersama_terkunci_update', 'w'),
       ('public.consents'::regclass, 'riwayat_bersama_terkunci_delete', 'd'),
       ('public.inpatient_records'::regclass, 'riwayat_bersama_terkunci_insert', 'a'),
       ('public.inpatient_records'::regclass, 'riwayat_bersama_terkunci_update', 'w'),
       ('public.inpatient_records'::regclass, 'riwayat_bersama_terkunci_delete', 'd'));
  if v_n <> 12 then
    raise exception 'DOKTER_BACA_IMPOR: kunci tulis riwayat impor tidak lengkap (% dari 12)', v_n;
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'role', 'SELECT')
     or not has_column_privilege('authenticated', 'public.profiles', 'is_active', 'SELECT')
     or not has_column_privilege('authenticated', 'public.profiles', 'id', 'SELECT') then
    raise exception 'DOKTER_BACA_IMPOR: authenticated tidak bisa membaca profiles(id, role, is_active)';
  end if;
  if exists (select 1 from pg_proc where proname = 'dokter_aktif_baca_impor' and pronamespace = 'public'::regnamespace
             and oid <> coalesce(to_regprocedure('public.dokter_aktif_baca_impor()'), 0)) then
    raise exception 'DOKTER_BACA_IMPOR: ada overload lain dengan nama yang sama';
  end if;
end $pra$;

select set_config('kamo_dokter_impor.sidik_awal', pg_temp.dbi_sidik_lain(), true);

create or replace function public.dokter_aktif_baca_impor()
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.is_active and p.role = 'DOCTOR'
  )
$$;
comment on function public.dokter_aktif_baca_impor() is
  'Pemanggil adalah DOKTER aktif (profil sendiri). Dipakai kebijakan RLS baca riwayat impor tanpa cabang (20261109100100).';
revoke all on function public.dokter_aktif_baca_impor() from public, anon;
grant execute on function public.dokter_aktif_baca_impor() to authenticated;

-- 1. Akses: cabang dokter ditulis lebih dulu (baris impor berhenti di InitPlan; baris bercabang gagal cepat di
--    `branch_id is null` lalu ke user_can_access_branch seperti sebelumnya).
alter policy operational_branch_isolation on public.visits
  using ((branch_id is null and legacy_source_key is not null and (select public.dokter_aktif_baca_impor()))
         or public.user_can_access_branch(branch_id));

-- 2. Kinerja, logika identik.
alter policy visits_select on public.visits
  using ((legacy_source_key is not null and (select public.can_read_legacy_medical_history()))
         or public.user_can_access_branch(branch_id));
alter policy mr_select on public.medical_records
  using (exists (select 1 from public.visits v
                  where v.id = medical_records.visit_id
                    and ((v.legacy_source_key is not null and (select public.can_read_legacy_medical_history()))
                         or public.user_can_access_branch(v.branch_id))));

do $pasca$
declare
  v_k text;
  v record;
begin
  v_k := pg_temp.dbi_kebijakan('public.visits', 'operational_branch_isolation');
  if v_k is distinct from pg_temp.dbi_bentuk('isolasi', true) then
    raise exception 'DOKTER_BACA_IMPOR: pasca-cek operational_branch_isolation gagal: %', v_k;
  end if;
  v_k := pg_temp.dbi_kebijakan('public.visits', 'visits_select');
  if v_k is distinct from pg_temp.dbi_bentuk('visits_select', true) then
    raise exception 'DOKTER_BACA_IMPOR: pasca-cek visits_select gagal: %', v_k;
  end if;
  v_k := pg_temp.dbi_kebijakan('public.medical_records', 'mr_select');
  if v_k is distinct from pg_temp.dbi_bentuk('mr_select', true) then
    raise exception 'DOKTER_BACA_IMPOR: pasca-cek mr_select gagal: %', v_k;
  end if;
  if pg_temp.dbi_sidik_lain() is distinct from current_setting('kamo_dokter_impor.sidik_awal', true) then
    raise exception 'DOKTER_BACA_IMPOR: kebijakan lain ikut berubah';
  end if;
  select p.prosecdef, p.provolatile, p.proconfig into v from pg_proc p where p.oid = 'public.dokter_aktif_baca_impor()'::regprocedure;
  if v.prosecdef or v.provolatile <> 's' or v.proconfig is distinct from array['search_path=""']
     or has_function_privilege('anon', 'public.dokter_aktif_baca_impor()', 'execute')
     or not has_function_privilege('authenticated', 'public.dokter_aktif_baca_impor()', 'execute') then
    raise exception 'DOKTER_BACA_IMPOR: pasca-cek helper gagal';
  end if;
end $pasca$;

drop function pg_temp.dbi_bentuk(text, boolean);
drop function pg_temp.dbi_sidik_lain();
drop function pg_temp.dbi_kebijakan(regclass, text);
