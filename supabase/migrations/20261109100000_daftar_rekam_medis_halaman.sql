-- Daftar Klinik > Rekam medis: paginasi + pencarian di server, dan filter cabang yang ikut menampilkan riwayat impor.
--
-- Masalah (Production 9 Nov 2026, 8.551 riwayat, 7.906 hasil impor tanpa cabang):
--   1. `daftar_rekam_medis(p_pet)` mengembalikan SELURUH daftar (~5 MB jsonb) dalam satu panggilan. Diukur sebagai
--      `authenticated` OWNER tanpa header cabang: ~4,9 dtk, padahal statement_timeout peran itu 8 dtk -> galat
--      "Rekam medis belum dapat dimuat lengkap" yang muncul-hilang, dan mati total begitu data bertambah.
--   2. Saat satu cabang dipilih, header `x-kamo-operational-branch` membuat RLS menyembunyikan semua kunjungan tanpa
--      cabang, termasuk riwayat impor (branch_id null karena data lama tidak memuat cabang).
--
-- Perbaikan: RPC BARU `daftar_rekam_medis_halaman` (fungsi lama TIDAK diubah/di-drop agar aplikasi lama tetap jalan).
--   - SECURITY INVOKER + STABLE + search_path kosong: RLS pemanggil berlaku persis seperti SELECT biasa. Tidak ada
--     baris yang terlihat lewat RPC ini yang tidak terlihat lewat SELECT biasa pemanggil yang sama (tidak melebarkan akses).
--   - p_cabang (opsional): baris cabang itu DITAMBAH riwayat impor tanpa cabang
--     (branch_id is null and legacy_source_key is not null). Aplikasi memanggilnya TANPA header cabang dan mengirim
--     cabang aktif (yang sudah divalidasi middleware) sebagai p_cabang; pengguna tanpa hak lintas cabang tetap hanya
--     melihat yang diizinkan RLS (riwayat impor tetap tidak terlihat bagi mereka, sama seperti sebelumnya).
--   - p_cari (opsional): nama pemilik, nomor telepon, atau nama hewan (mengandung, tanpa beda huruf besar/kecil;
--     dicocokkan dengan strpos, jadi % dan _ bukan wildcard).
--   - p_tampilan: 'semua' | 'rawat-jalan' (tanpa kunjungan yang masih punya rawat inap aktif).
--   - p_pet (opsional): riwayat satu hewan (kunjungan diarsipkan ikut tampil, sama seperti fungsi lama).
--   - p_batas 1..200 (default 50), p_offset >= 0. Urutan created_at desc, id.
--   Hasil: {jumlah, ringkasan{riwayat,hewan,impor}, batas, offset, baris[]} dalam SATU statement (satu snapshot),
--   bentuk tiap baris sama dengan `daftar_rekam_medis` (id, pet_id, branch_id, created_at, dokter, keluhan,
--   legacy_source_key, pets, customers, branches, medical_records, inpatient_records).
--   Masukan tidak sah -> exception 22023 (aplikasi menampilkan galat, tidak pernah daftar kosong).

do $pra$
begin
  if to_regclass('public.visits') is null or to_regclass('public.medical_records') is null
     or to_regclass('public.inpatient_records') is null or to_regclass('public.pets') is null
     or to_regclass('public.customers') is null or to_regclass('public.branches') is null then
    raise exception 'DAFTAR_REKAM_MEDIS_HALAMAN: tabel prasyarat tidak lengkap';
  end if;
  if exists (select 1 from pg_proc where proname = 'daftar_rekam_medis_halaman' and pronamespace = 'public'::regnamespace
             and oid <> coalesce(to_regprocedure('public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer)'), 0)) then
    raise exception 'DAFTAR_REKAM_MEDIS_HALAMAN: ada overload lain dengan nama yang sama';
  end if;
  if to_regprocedure('public.daftar_rekam_medis(uuid)') is null then
    raise exception 'DAFTAR_REKAM_MEDIS_HALAMAN: fungsi lama daftar_rekam_medis(uuid) harus tetap ada';
  end if;
end $pra$;

create or replace function public.daftar_rekam_medis_halaman(
  p_cabang uuid default null,
  p_cari text default null,
  p_tampilan text default 'semua',
  p_pet uuid default null,
  p_batas integer default 50,
  p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_cari text := nullif(lower(btrim(coalesce(p_cari, ''))), '');
begin
  if p_batas is null or p_batas < 1 or p_batas > 200 then
    raise exception using errcode = '22023', message = 'DAFTAR_REKAM_MEDIS_HALAMAN: batas harus 1-200';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception using errcode = '22023', message = 'DAFTAR_REKAM_MEDIS_HALAMAN: offset tidak sah';
  end if;
  if p_tampilan is null or p_tampilan not in ('semua', 'rawat-jalan') then
    raise exception using errcode = '22023', message = 'DAFTAR_REKAM_MEDIS_HALAMAN: tampilan tidak dikenal';
  end if;
  if length(v_cari) > 100 then
    raise exception using errcode = '22023', message = 'DAFTAR_REKAM_MEDIS_HALAMAN: kata cari terlalu panjang';
  end if;

  return (
    with lingkup as materialized (
      select v.id, v.pet_id, v.branch_id, v.created_at, v.dokter, v.keluhan, v.legacy_source_key, v.customer_id
        from public.visits v
       where (p_pet is null or v.pet_id = p_pet)
         and (p_pet is not null or v.archived_at is null)
         and (p_cabang is null or v.branch_id = p_cabang
              or (v.branch_id is null and v.legacy_source_key is not null))
         and exists (select 1 from public.medical_records m where m.visit_id = v.id)
    ), saring as materialized (
      select l.* from lingkup l
       where (p_tampilan = 'semua'
              or not exists (select 1 from public.inpatient_records i where i.visit_id = l.id and i.discharged_at is null))
         and (v_cari is null
              or exists (select 1 from public.customers c where c.id = l.customer_id
                           and (strpos(lower(coalesce(c.name, '')), v_cari) > 0 or strpos(lower(coalesce(c.phone, '')), v_cari) > 0))
              or exists (select 1 from public.pets p where p.id = l.pet_id and strpos(lower(coalesce(p.name, '')), v_cari) > 0))
    ), halaman as (
      select s.* from saring s order by s.created_at desc, s.id limit p_batas offset p_offset
    )
    select jsonb_build_object(
      'jumlah', (select count(*)::integer from saring),
      'ringkasan', (select jsonb_build_object('riwayat', count(*)::integer, 'hewan', count(distinct l.pet_id)::integer,
                                              'impor', (count(*) filter (where l.legacy_source_key is not null))::integer)
                      from lingkup l),
      'batas', p_batas,
      'offset', p_offset,
      'baris', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', h.id, 'pet_id', h.pet_id, 'branch_id', h.branch_id, 'created_at', h.created_at,
          'dokter', h.dokter, 'keluhan', h.keluhan, 'legacy_source_key', h.legacy_source_key,
          'pets', (select jsonb_build_object('name', p.name, 'species', p.species, 'breed', p.breed)
                     from public.pets p where p.id = h.pet_id),
          'customers', (select jsonb_build_object('name', c.name, 'phone', c.phone)
                          from public.customers c where c.id = h.customer_id),
          'branches', (select jsonb_build_object('code', b.code) from public.branches b where b.id = h.branch_id),
          'medical_records', (select jsonb_agg(jsonb_build_object('diagnosis', m.diagnosis, 'anamnesis', m.anamnesis) order by m.id)
                                from public.medical_records m where m.visit_id = h.id),
          'inpatient_records', coalesce((select jsonb_agg(jsonb_build_object('created_at', i.created_at,
                                'discharged_at', i.discharged_at, 'condition_status', i.condition_status) order by i.created_at, i.id)
                                from public.inpatient_records i where i.visit_id = h.id), '[]'::jsonb)
        ) order by h.created_at desc, h.id) from halaman h), '[]'::jsonb)
    )
  );
end
$$;

revoke all on function public.daftar_rekam_medis_halaman(uuid, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.daftar_rekam_medis_halaman(uuid, text, text, uuid, integer, integer) to authenticated;

do $pasca$
declare v record;
begin
  select p.prosecdef, p.provolatile, p.proconfig into v from pg_proc p
   where p.oid = 'public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer)'::regprocedure;
  if v.prosecdef or v.provolatile <> 's' or v.proconfig is distinct from array['search_path=""']
     or has_function_privilege('anon', 'public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer)', 'execute') then
    raise exception 'DAFTAR_REKAM_MEDIS_HALAMAN: pasca-cek gagal';
  end if;
  if to_regprocedure('public.daftar_rekam_medis(uuid)') is null then
    raise exception 'DAFTAR_REKAM_MEDIS_HALAMAN: fungsi lama hilang';
  end if;
end $pasca$;
