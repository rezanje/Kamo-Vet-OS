-- Daftar Klinik > Rekam medis dibaca dalam SATU query (RPC), bukan 8 halaman PostgREST paralel.
--
-- Masalah (Production 31 Okt 2026, setelah 20261031082216): halaman pertama lolos (~3 dtk), tetapi 6 halaman
-- berikutnya yang dibaca bersamaan gagal 500 (batas statement 8 dtk). Tiap halaman PostgREST (offset + count=exact)
-- mengevaluasi RLS seluruh visits + medical_records DUA kali (data + hitungan) karena urutan butuh semua baris; 8 halaman
-- = 16 evaluasi penuh, 6 bersamaan di server kecil -> antre CPU -> timeout.
--
-- Perbaikan: satu fungsi SECURITY INVOKER (RLS pemanggil berlaku persis seperti SELECT biasa) yang mengembalikan
-- {jumlah, baris[]} dengan bentuk baris yang sama dengan embed PostgREST lama:
--   visits (id, pet_id, branch_id, created_at, dokter, keluhan, legacy_source_key)
--   + pets{name,species,breed} + customers{name,phone} + branches{code}
--   + medical_records[{diagnosis,anamnesis}] (inner: hanya kunjungan yang punya rekam medis terlihat)
--   + inpatient_records[{created_at,discharged_at,condition_status}]
-- Urutan created_at desc, id. Satu snapshot (satu statement), jadi jumlah & baris pasti konsisten.
-- Lebih dari 10.000 baris -> baris = null (aplikasi menampilkan pesan batas, tidak pernah daftar terpotong).
-- Ukur Production (baca-saja, OWNER, 3.845 riwayat): ~2,1 dtk untuk semua baris; per hewan ~0,7 dtk.

do $pra$
begin
  if to_regclass('public.visits') is null or to_regclass('public.medical_records') is null
     or to_regclass('public.inpatient_records') is null or to_regclass('public.pets') is null
     or to_regclass('public.customers') is null or to_regclass('public.branches') is null then
    raise exception 'DAFTAR_REKAM_MEDIS: tabel prasyarat tidak lengkap';
  end if;
  if exists (select 1 from pg_proc where proname = 'daftar_rekam_medis' and pronamespace = 'public'::regnamespace
             and oid <> coalesce(to_regprocedure('public.daftar_rekam_medis(uuid)'), 0)) then
    raise exception 'DAFTAR_REKAM_MEDIS: ada overload lain dengan nama yang sama';
  end if;
end $pra$;

create or replace function public.daftar_rekam_medis(p_pet uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with sumber as (
    select v.id, v.pet_id, v.branch_id, v.created_at, v.dokter, v.keluhan, v.legacy_source_key, v.customer_id
      from public.visits v
     where (p_pet is null or v.pet_id = p_pet)
       and exists (select 1 from public.medical_records m where m.visit_id = v.id)
  ), jumlah as (select count(*)::integer as n from sumber)
  select jsonb_build_object('jumlah', j.n, 'baris',
    case when j.n > 10000 then null else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'pet_id', s.pet_id, 'branch_id', s.branch_id, 'created_at', s.created_at,
        'dokter', s.dokter, 'keluhan', s.keluhan, 'legacy_source_key', s.legacy_source_key,
        'pets', (select jsonb_build_object('name', p.name, 'species', p.species, 'breed', p.breed)
                   from public.pets p where p.id = s.pet_id),
        'customers', (select jsonb_build_object('name', c.name, 'phone', c.phone)
                        from public.customers c where c.id = s.customer_id),
        'branches', (select jsonb_build_object('code', b.code) from public.branches b where b.id = s.branch_id),
        'medical_records', (select jsonb_agg(jsonb_build_object('diagnosis', m.diagnosis, 'anamnesis', m.anamnesis) order by m.id)
                              from public.medical_records m where m.visit_id = s.id),
        'inpatient_records', coalesce((select jsonb_agg(jsonb_build_object('created_at', i.created_at,
                              'discharged_at', i.discharged_at, 'condition_status', i.condition_status) order by i.created_at, i.id)
                              from public.inpatient_records i where i.visit_id = s.id), '[]'::jsonb)
      ) order by s.created_at desc, s.id) from sumber s), '[]'::jsonb) end)
  from jumlah j
;
$$;

revoke all on function public.daftar_rekam_medis(uuid) from public, anon;
grant execute on function public.daftar_rekam_medis(uuid) to authenticated;

do $pasca$
declare v record;
begin
  select p.prosecdef, p.provolatile, p.proconfig into v from pg_proc p where p.oid = 'public.daftar_rekam_medis(uuid)'::regprocedure;
  if v.prosecdef or v.provolatile <> 's' or v.proconfig is distinct from array['search_path=""']
     or has_function_privilege('anon', 'public.daftar_rekam_medis(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.daftar_rekam_medis(uuid)', 'execute') then
    raise exception 'DAFTAR_REKAM_MEDIS: pasca-cek gagal';
  end if;
end $pasca$;
