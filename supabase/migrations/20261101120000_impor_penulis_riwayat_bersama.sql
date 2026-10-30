-- Impor rekam medis di cabang aktif: penulis riwayat bersama milik role sempit (D1), riwayat bersama
-- terkunci dari tulis langsung pengguna (D2), dan jalur baca hasil impor terbatas (RS-1).
--
-- Desain: docs/desain-impor-rekmed-rls-cabang-aktif.md (revisi 3 + catatan implementasi revisi 4).
-- Persetujuan: pemilik (Reza via koordinasi) menyetujui KODE dan TES D1 + D2 + RS-1 untuk PR draft.
-- Riwayat bersama hasil impor boleh dikunci dari ubah langsung pengguna, termasuk admin/finance;
-- hasil impor diperiksa lewat layar impor; halaman pasien biasa dan akses dokter TIDAK berubah.
-- Pemasangan ke Production BELUM disetujui: menunggu gerbang hosted (lihat dokumen desain §8) dan
-- persetujuan terpisah atas teks persis migrasi ini.
--
-- Masalah: dengan header cabang aktif (x-kamo-operational-branch), user_can_access_branch(NULL) = false,
-- sehingga RPC impor (SECURITY INVOKER) ditolak restrictive operational_branch_isolation saat menyisipkan
-- kunjungan tanpa cabang, dan riwayat bersama tidak terlihat untuk pencarian jejak.
--
-- Inti:
--   D1  Skema kamo_import berisi penulis SECURITY DEFINER yang DIMILIKI role kamo_legacy_import_writer
--       (NOLOGIN NOINHERIT NOBYPASSRLS, bukan pemilik tabel, tidak bisa di-SET oleh siapa pun sesudah
--       migrasi). Role hanya punya hak kolom + kebijakan RLS untuk baris riwayat bersama. Skema privat
--       BUKAN batas keamanan: setiap fungsi memvalidasi sendiri pemanggil (OWNER/ADMIN aktif), header
--       cabang (bila ada harus boleh diakses), jejak (1..500), sidik (dihitung ulang server), dan identitas
--       (pelanggan kandidat, anabul milik pelanggan). RPC publik tetap SECURITY INVOKER; pembuatan
--       pelanggan/anabul tetap di RPC publik di bawah RLS pemanggil.
--   D2  Restrictive untuk authenticated, tidak bergantung peran/kapabilitas/header: tidak bisa
--       INSERT/UPDATE/DELETE kunjungan tanpa cabang, dan tidak bisa menulis/memindahkan baris anak yang
--       menunjuk (langsung atau lewat induk) ke riwayat bersama. Predikat memakai helper milik role penulis
--       yang membaca lewat kebijakan SELECT role (tanpa bypass RLS); "helper(...) is false" membuat galat
--       atau NULL = ditolak (gagal tertutup).
--   RS-1 public.hasil_impor_rekam_medis(text[]) (INVOKER) -> kamo_import.baca_hasil_impor (tervalidasi,
--       1..500 jejak, jejak 1..500 karakter, maksimal 500 baris, hanya kunjungan tanpa cabang).
--
-- Batas janji D2: hanya tulis LANGSUNG oleh authenticated (Data API / RPC invoker). RPC SECURITY DEFINER
-- lama milik pemilik tabel melewati RLS dan tidak dinilai di sini (dicatat di dokumen desain §6).
-- Trigger: di visits/medical_records semua trigger SECURITY DEFINER kecuali
-- protect_inpatient_continuation_link (invoker, melewati cek bila current_user <> 'authenticated').
-- Role penulis tidak punya hak kolom continued_from_*, jadi tautan itu tetap NULL. Trigger baru pada
-- kedua tabel kelak WAJIB memperhitungkan role ini (pasca-cek di bawah gagal bila trigger invoker baru).
-- Tidak ada UPDATE/DELETE data, backfill, atau penggabungan.
--
-- Identitas pemanggil di fungsi milik role penulis: role TIDAK diberi USAGE skema `auth` (di Supabase hosted
-- `postgres` memegang USAGE `auth` tanpa grant option; memperluasnya tidak diizinkan). Maka role memakai
-- kamo_import.uid_permintaan(): tanpa argumen, tanpa akses tabel, SECURITY INVOKER, isi SQL byte-identik
-- dengan auth.uid() hosted (termasuk urutan request.jwt.claim.sub lalu request.jwt.claims->>'sub'). Migrasi
-- batal bila definisi auth.uid() (md5 pg_get_functiondef: teks, tanda tangan, volatilitas, security, config)
-- berbeda dari yang dibaca di katalog hosted, atau bila isi helper tidak sama persis dengan auth.uid().
-- RPC publik SECURITY INVOKER tetap memakai auth.uid() asli.

-- ---------------------------------------------------------------------------
-- 0. Prasyarat — gagal tertutup
-- ---------------------------------------------------------------------------
do $precheck$
declare d text;
begin
  if current_setting('server_version_num')::int < 160000 then
    raise exception 'Penulis riwayat bersama: butuh PostgreSQL 16+ (GRANT ... WITH SET)';
  end if;
  if exists (select 1 from pg_roles where rolname = 'kamo_legacy_import_writer') then
    raise exception 'Penulis riwayat bersama: role kamo_legacy_import_writer sudah ada; atributnya tidak bisa dipercaya';
  end if;
  if to_regnamespace('kamo_import') is not null then
    raise exception 'Penulis riwayat bersama: skema kamo_import sudah ada';
  end if;
  -- Sidik auth.uid() dari katalog hosted (dibaca read-only 2026-10-29, proyek koaglxcyjqfmgfzxszkj).
  if to_regprocedure('auth.uid()') is null
     or md5(pg_get_functiondef('auth.uid()'::regprocedure)) <> 'ea3b41bf29e2ad573067939329aa088e' then
    raise exception 'Penulis riwayat bersama: definisi auth.uid() berbeda dari sidik yang ditinjau; helper identitas tidak bisa dijamin setara';
  end if;
  if to_regprocedure('public.import_legacy_source_match(text,text)') is null
     or to_regprocedure('public.import_legacy_source_key_canonical(text)') is null
     or to_regprocedure('public.customer_identity_lock(text)') is null
     or to_regprocedure('public.user_can_access_branch(uuid)') is null then
    raise exception 'Penulis riwayat bersama: migrasi 20261101090000/20261101100000 belum terpasang';
  end if;
  d := pg_get_functiondef('public.import_legacy_medical_record_resolved(text,text,timestamptz,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid)'::regprocedure);
  if position('public.import_legacy_source_match(p_source_key, p_phone)' in d) = 0 or position('kamo_import' in d) > 0 then
    raise exception 'Penulis riwayat bersama: import_legacy_medical_record_resolved bukan versi 20261101100000';
  end if;
  d := pg_get_functiondef('public.import_legacy_medical_records_bulk(jsonb)'::regprocedure);
  if position('public.import_legacy_source_match(v_key' in d) = 0 or position('kamo_import' in d) > 0 then
    raise exception 'Penulis riwayat bersama: import_legacy_medical_records_bulk bukan versi 20261101100000';
  end if;
end $precheck$;

-- ---------------------------------------------------------------------------
-- 1. Role dan skema
-- ---------------------------------------------------------------------------
create role kamo_legacy_import_writer nologin noinherit nobypassrls nocreatedb nocreaterole noreplication;
comment on role kamo_legacy_import_writer is
  'Pemilik penulis/pembaca riwayat bersama impor rekam medis (kamo_import). Tanpa login, tanpa bypass RLS, bukan pemilik tabel. Jangan dijadikan anggota/peran yang bisa di-SET siapa pun.';

create schema kamo_import;
comment on schema kamo_import is
  'Fungsi impor rekam medis milik kamo_legacy_import_writer. Bukan batas keamanan: setiap fungsi memvalidasi pemanggil sendiri.';
revoke all on schema kamo_import from public;
grant usage on schema kamo_import to authenticated, kamo_legacy_import_writer;

-- ---------------------------------------------------------------------------
-- 1b. Identitas permintaan untuk fungsi milik role penulis (pengganti auth.uid() tanpa USAGE skema auth)
-- ---------------------------------------------------------------------------
-- Isi di antara $uid$ HARUS byte-identik dengan prosrc auth.uid() hosted (diperiksa gerbang di bawah).
-- Tanpa argumen, tanpa tabel, SECURITY INVOKER: hanya membaca GUC permintaan; UUID/JSON rusak = galat.
create function kamo_import.uid_permintaan() returns uuid
language sql stable security invoker set search_path = '' as $uid$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$uid$;
comment on function kamo_import.uid_permintaan() is
  'Salinan persis isi auth.uid() (sidik ditinjau) untuk fungsi milik kamo_legacy_import_writer, yang tidak diberi USAGE skema auth.';

-- ---------------------------------------------------------------------------
-- 2. Hak minimal role penulis (hak kolom; tanpa UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER)
-- ---------------------------------------------------------------------------
grant execute on function
  public.user_can_access_branch(uuid),
  public.indonesian_phone_key(text),
  public.import_legacy_text_key(text),
  public.import_legacy_phone_key(text),
  public.import_legacy_row_hash(jsonb),
  public.import_legacy_source_key_canonical(text),
  public.import_legacy_source_match(text, text),
  public.import_legacy_source_ambiguous_reason(),
  public.import_legacy_source_conflict_reason(text),
  public.customer_identity_lock(text)
to kamo_legacy_import_writer;

grant select (id, branch_id, customer_id, pet_id, created_at, dokter, keluhan, legacy_source_key, legacy_record_no, legacy_source_hash)
  on public.visits to kamo_legacy_import_writer;
grant insert (customer_id, pet_id, poli, dokter, keluhan, status, created_at, legacy_source_key, legacy_record_no, legacy_source_hash)
  on public.visits to kamo_legacy_import_writer;
grant select (id, visit_id, diagnosis, anamnesis, gejala_klinis, catatan_resep) on public.medical_records to kamo_legacy_import_writer;
grant insert (visit_id, diagnosis, anamnesis, gejala_klinis, catatan_resep) on public.medical_records to kamo_legacy_import_writer;
grant select (id, name, phone) on public.customers to kamo_legacy_import_writer;
grant select (id, customer_id, name) on public.pets to kamo_legacy_import_writer;
grant select (id, role, is_active) on public.profiles to kamo_legacy_import_writer;
-- Kolom FK rantai anak, hanya untuk helper D2 (dibatasi kebijakan ke rantai riwayat bersama).
grant select (id, medical_record_id) on public.compounding_recipes to kamo_legacy_import_writer;
grant select (id, visit_id) on public.consents to kamo_legacy_import_writer;
grant select (id, visit_id, medical_record_id, consent_id) on public.inpatient_records to kamo_legacy_import_writer;
grant select (id, inpatient_record_id) on public.inpatient_medications to kamo_legacy_import_writer;
grant select (id, visit_id) on public.bookings to kamo_legacy_import_writer;
grant select (id, visit_id) on public.invoices to kamo_legacy_import_writer;

-- Kebijakan TO role penulis (permissive; restrictive lama hanya untuk authenticated).
-- visits: riwayat bersama + semua kunjungan berjejak (impor paling awal 20260907160000 menyimpan cabang;
-- pencarian jejak harus tetap melihatnya agar kiriman ulang tidak menjadi duplikat).
create policy kamo_import_baca on public.visits for select to kamo_legacy_import_writer
  using (branch_id is null or legacy_source_key is not null);
create policy kamo_import_tulis on public.visits for insert to kamo_legacy_import_writer
  with check (branch_id is null and continued_from_visit_id is null and legacy_source_key is not null
              and length(btrim(legacy_source_key)) between 1 and 500 and length(legacy_source_key) <= 500
              and legacy_source_hash is not null);
create policy kamo_import_baca on public.medical_records for select to kamo_legacy_import_writer
  using (exists (select 1 from public.visits v where v.id = medical_records.visit_id and v.branch_id is null));
create policy kamo_import_tulis on public.medical_records for insert to kamo_legacy_import_writer
  with check (continued_from_record_id is null
              and exists (select 1 from public.visits v where v.id = medical_records.visit_id
                          and v.branch_id is null and v.legacy_source_key is not null));
create policy kamo_import_baca on public.customers for select to kamo_legacy_import_writer using (true);
create policy kamo_import_baca on public.pets for select to kamo_legacy_import_writer using (true);
create policy kamo_import_baca on public.profiles for select to kamo_legacy_import_writer using (id = (select kamo_import.uid_permintaan()));
create policy kamo_import_baca on public.compounding_recipes for select to kamo_legacy_import_writer
  using (exists (select 1 from public.medical_records m where m.id = compounding_recipes.medical_record_id));
create policy kamo_import_baca on public.consents for select to kamo_legacy_import_writer
  using (exists (select 1 from public.visits v where v.id = consents.visit_id and v.branch_id is null));
create policy kamo_import_baca on public.inpatient_records for select to kamo_legacy_import_writer
  using (exists (select 1 from public.visits v where v.id = inpatient_records.visit_id and v.branch_id is null)
         or exists (select 1 from public.medical_records m where m.id = inpatient_records.medical_record_id)
         or exists (select 1 from public.consents c where c.id = inpatient_records.consent_id));
create policy kamo_import_baca on public.inpatient_medications for select to kamo_legacy_import_writer
  using (exists (select 1 from public.inpatient_records r where r.id = inpatient_medications.inpatient_record_id));
create policy kamo_import_baca on public.bookings for select to kamo_legacy_import_writer
  using (exists (select 1 from public.visits v where v.id = bookings.visit_id and v.branch_id is null));
create policy kamo_import_baca on public.invoices for select to kamo_legacy_import_writer
  using (exists (select 1 from public.visits v where v.id = invoices.visit_id and v.branch_id is null));

-- ---------------------------------------------------------------------------
-- 3. Validasi pemanggil (dipakai semua fungsi; boleh dipanggil authenticated, hanya memvalidasi)
-- ---------------------------------------------------------------------------
create function kamo_import.pastikan_pengimpor() returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_header text;
  v_uid uuid := kamo_import.uid_permintaan();
begin
  if v_uid is null or not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.is_active and p.role in ('OWNER', 'ADMIN')
  ) then
    raise exception using errcode = '42501', message = 'Hanya OWNER/ADMIN aktif yang boleh mengimpor rekam medis';
  end if;
  -- Header cabang tidak dihapus/diubah: bila ada, harus cabang aktif yang boleh diakses pemanggil.
  -- JSON/uuid rusak = galat = ditolak.
  v_header := nullif(btrim(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-kamo-operational-branch', '')), '');
  if v_header is not null and public.user_can_access_branch(v_header::uuid) is not true then
    raise exception using errcode = '42501', message = 'Cabang aktif tidak valid atau tidak boleh diakses untuk impor rekam medis';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Pencarian jejak (persis/setara) atas riwayat berjejak, dengan validasi + otorisasi per baris
-- ---------------------------------------------------------------------------
-- Role penulis MELIHAT kunjungan berjejak bercabang (impor paling awal menyimpan cabang) supaya jejak
-- yang sudah dipakai tidak pernah dianggap kosong lalu disimpan ganda. Yang BOLEH keluar ke pemanggil
-- hanya kecocokan yang memang terjangkau pemanggil: riwayat bersama (cabang NULL) atau cabang yang lolos
-- user_can_access_branch di konteks pemanggil (JWT + header cabang aktif, sama seperti RLS biasanya).
-- Bila ADA kecocokan di cabang yang tidak terjangkau, jawabannya satu baris generik
-- (visit_id NULL, existing_hash NULL, terkunci true): tanpa UUID, sidik, cabang, atau jumlah kecocokan;
-- pemanggil wajib menahan baris itu (tidak menyimpan, tidak menimpa).
create function kamo_import.alasan_jejak_tidak_terjangkau() returns text
language sql immutable security definer set search_path = '' as $$
  select 'Jejak sumber ini sudah tercatat pada riwayat yang tidak bisa diakses dari akun/cabang aktif ini. Tidak ada yang disimpan atau ditimpa. Impor ulang dari konteks yang berhak, atau minta pemilik memeriksanya.'::text
$$;

create function kamo_import.cari_jejak(p_source_key text, p_phone text)
returns table(visit_id uuid, existing_hash text, terkunci boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform kamo_import.pastikan_pengimpor();
  if p_source_key is null or btrim(p_source_key) = '' or length(p_source_key) > 500 then
    raise exception using errcode = '22023', message = 'Jejak sumber wajib diisi (maksimal 500 karakter)';
  end if;
  if exists (
    select 1 from public.import_legacy_source_match(p_source_key, p_phone) m
    join public.visits v on v.id = m.visit_id
    where v.branch_id is not null and public.user_can_access_branch(v.branch_id) is not true
  ) then
    return query select null::uuid, null::text, true;
    return;
  end if;
  return query select m.visit_id, m.existing_hash, false from public.import_legacy_source_match(p_source_key, p_phone) m;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Penulis: satu kunjungan tanpa cabang + satu rekam medis, setelah validasi penuh
-- ---------------------------------------------------------------------------
create function kamo_import.simpan_riwayat_bersama(p_row jsonb, p_customer_id uuid, p_pet_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_key text;
  v_phone text;
  v_owner text;
  v_date timestamptz;
  v_hash text;
  v_matches int;
  v_visit uuid;
  v_existing_hash text;
  v_terkunci boolean;
begin
  perform kamo_import.pastikan_pengimpor();
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception using errcode = '22023', message = 'Isi riwayat tidak terbaca';
  end if;
  v_key := p_row ->> 'source_key';
  v_phone := p_row ->> 'phone';
  v_owner := p_row ->> 'owner_name';
  if v_key is null or btrim(v_key) = '' or length(v_key) > 500 then
    raise exception using errcode = '22023', message = 'Jejak sumber wajib diisi (maksimal 500 karakter)';
  end if;
  v_date := nullif(p_row ->> 'record_date', '')::timestamptz;
  if v_date is null or v_owner is null or v_phone is null or p_row ->> 'patient_name' is null then
    raise exception using errcode = '22023', message = 'Tanggal, pemilik, nomor telepon, dan pasien wajib diisi';
  end if;
  -- Sidik selalu dihitung server dari isi; sidik kiriman (bila ada) diabaikan.
  v_hash := public.import_legacy_row_hash(p_row);

  perform public.customer_identity_lock(v_phone);
  select count(*)::int, (array_agg(m.visit_id))[1], (array_agg(m.existing_hash))[1], coalesce(bool_or(m.terkunci), false)
    into v_matches, v_visit, v_existing_hash, v_terkunci
  from kamo_import.cari_jejak(v_key, v_phone) m;
  if v_terkunci then
    raise exception using errcode = 'P0001', message = kamo_import.alasan_jejak_tidak_terjangkau();
  end if;
  if v_matches > 1 then
    raise exception using errcode = 'P0001', message = public.import_legacy_source_ambiguous_reason();
  end if;
  if v_visit is not null then
    if v_existing_hash = v_hash then
      return v_visit;
    end if;
    raise exception using errcode = 'P0001', message = public.import_legacy_source_conflict_reason(v_existing_hash);
  end if;

  -- Identitas: pilihan pemanggil bukan bukti. Pelanggan harus kandidat menurut predikat yang sama dengan
  -- klarifikasi identitas (kunci HP sama ATAU kunci nama sama); anabul harus milik pelanggan itu.
  if p_customer_id is null or not exists (
    select 1 from public.customers c
    where c.id = p_customer_id
      and ((public.import_legacy_phone_key(v_phone) <> '' and public.import_legacy_phone_key(c.phone) = public.import_legacy_phone_key(v_phone))
           or (public.import_legacy_text_key(v_owner) <> '' and public.import_legacy_text_key(c.name) = public.import_legacy_text_key(v_owner)))
  ) then
    raise exception using errcode = '22023', message = 'Pemilik tidak cocok dengan nama atau nomor HP pada kartu impor';
  end if;
  if p_pet_id is null or not exists (select 1 from public.pets p where p.id = p_pet_id and p.customer_id = p_customer_id) then
    raise exception using errcode = '22023', message = 'Anabul tidak cocok dengan pemilik pada kartu impor';
  end if;

  insert into public.visits(
    customer_id, pet_id, poli, dokter, keluhan, status, created_at,
    legacy_source_key, legacy_record_no, legacy_source_hash
  ) values (
    p_customer_id, p_pet_id, 'Poli Umum', nullif(p_row ->> 'doctor', ''),
    coalesce(nullif(p_row ->> 'note', ''), nullif(p_row ->> 'anamnesis', '')), 'Selesai', v_date,
    v_key, nullif(p_row ->> 'record_no', ''), v_hash
  ) returning id into v_visit;

  insert into public.medical_records(visit_id, diagnosis, anamnesis, gejala_klinis, catatan_resep)
  values (
    v_visit, nullif(p_row ->> 'diagnosis', ''), nullif(p_row ->> 'anamnesis', ''),
    nullif(p_row ->> 'clinical_findings', ''), nullif(p_row ->> 'therapy', '')
  );
  return v_visit;
end $$;

-- ---------------------------------------------------------------------------
-- 6. RS-1: pembaca hasil impor terbatas
-- ---------------------------------------------------------------------------
create function kamo_import.baca_hasil_impor(p_keys text[])
returns table(
  kunci text, visit_id uuid, jejak_tersimpan text, tanggal timestamptz, pemilik text, hewan text,
  dokter text, keluhan text, diagnosis text, anamnesis text, gejala_klinis text, terapi text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform kamo_import.pastikan_pengimpor();
  if p_keys is null or array_ndims(p_keys) is distinct from 1 or cardinality(p_keys) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Kirim 1 sampai 500 jejak sumber';
  end if;
  if exists (select 1 from unnest(p_keys) k where k is null or btrim(k) = '' or length(k) > 500) then
    raise exception using errcode = '22023', message = 'Jejak sumber wajib diisi (maksimal 500 karakter)';
  end if;
  return query
    select k.kunci, v.id, v.legacy_source_key, v.created_at, c.name::text, p.name::text, v.dokter::text, v.keluhan,
           m.diagnosis, m.anamnesis, m.gejala_klinis, m.catatan_resep
    from (select distinct u.kunci from unnest(p_keys) as u(kunci)) k
    join public.visits v
      on v.legacy_source_key is not null and v.branch_id is null
     and public.import_legacy_source_key_canonical(v.legacy_source_key) = public.import_legacy_source_key_canonical(k.kunci)
    left join public.customers c on c.id = v.customer_id
    left join public.pets p on p.id = v.pet_id
    left join public.medical_records m on m.visit_id = v.id
    order by k.kunci, v.id
    limit 500;
end $$;

create function public.hasil_impor_rekam_medis(p_keys text[])
returns table(
  kunci text, visit_id uuid, jejak_tersimpan text, tanggal timestamptz, pemilik text, hewan text,
  dokter text, keluhan text, diagnosis text, anamnesis text, gejala_klinis text, terapi text
)
language sql stable security invoker set search_path = '' as $$
  select * from kamo_import.baca_hasil_impor(p_keys)
$$;
comment on function public.hasil_impor_rekam_medis(text[]) is
  'Layar impor: hasil impor riwayat bersama per jejak (maks. 500). INVOKER; validasi di kamo_import.baca_hasil_impor.';
revoke all on function public.hasil_impor_rekam_medis(text[]) from public, anon, service_role;
grant execute on function public.hasil_impor_rekam_medis(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. D2: helper "baris ini bagian rantai riwayat bersama?" (baca lewat kebijakan role, tanpa bypass)
-- ---------------------------------------------------------------------------
create function kamo_import.tanpa_cabang_kunjungan(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.visits v where v.id = p_id and v.branch_id is null)
$$;
create function kamo_import.tanpa_cabang_rekam(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.medical_records m join public.visits v on v.id = m.visit_id
                 where m.id = p_id and v.branch_id is null)
$$;
create function kamo_import.tanpa_cabang_racikan(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.compounding_recipes r join public.medical_records m on m.id = r.medical_record_id
                 join public.visits v on v.id = m.visit_id where r.id = p_id and v.branch_id is null)
$$;
create function kamo_import.tanpa_cabang_persetujuan(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.consents c join public.visits v on v.id = c.visit_id
                 where c.id = p_id and v.branch_id is null)
$$;
create function kamo_import.tanpa_cabang_ranap(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.inpatient_records r where r.id = p_id
                 and (kamo_import.tanpa_cabang_kunjungan(r.visit_id)
                      or kamo_import.tanpa_cabang_rekam(r.medical_record_id)
                      or kamo_import.tanpa_cabang_persetujuan(r.consent_id)))
$$;
create function kamo_import.tanpa_cabang_obat_ranap(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.inpatient_medications i where i.id = p_id
                 and kamo_import.tanpa_cabang_ranap(i.inpatient_record_id))
$$;
create function kamo_import.tanpa_cabang_booking(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b join public.visits v on v.id = b.visit_id
                 where b.id = p_id and v.branch_id is null)
$$;
create function kamo_import.tanpa_cabang_tagihan(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.invoices i join public.visits v on v.id = i.visit_id
                 where i.id = p_id and v.branch_id is null)
$$;

-- D2: restrictive per perintah (INSERT / UPDATE using+check / DELETE) untuk authenticated. SELECT tidak
-- disentuh. "lama" = baris sebelum (USING), "baru" = baris sesudah (WITH CHECK). Helper(NULL) = false.
-- Tautan continued_from_* hanya diperiksa pada baris baru: barisnya sendiri bercabang; trigger lama
-- sudah menolak authenticated mengubah tautan itu.
do $d2$
declare r record;
begin
  for r in select * from (values
    ('visits',
     'branch_id is not null',
     'branch_id is not null and kamo_import.tanpa_cabang_kunjungan(continued_from_visit_id) is false'),
    ('medical_records',
     'kamo_import.tanpa_cabang_kunjungan(visit_id) is false',
     'kamo_import.tanpa_cabang_kunjungan(visit_id) is false and kamo_import.tanpa_cabang_rekam(continued_from_record_id) is false'),
    ('prescription_items',
     'kamo_import.tanpa_cabang_rekam(medical_record_id) is false and kamo_import.tanpa_cabang_racikan(compound_recipe_id) is false', null),
    ('compounding_recipes', 'kamo_import.tanpa_cabang_rekam(medical_record_id) is false', null),
    ('compounding_ingredients', 'kamo_import.tanpa_cabang_racikan(recipe_id) is false', null),
    ('consents', 'kamo_import.tanpa_cabang_kunjungan(visit_id) is false', null),
    ('inpatient_records',
     'kamo_import.tanpa_cabang_kunjungan(visit_id) is false and kamo_import.tanpa_cabang_rekam(medical_record_id) is false and kamo_import.tanpa_cabang_persetujuan(consent_id) is false', null),
    ('inpatient_medications', 'kamo_import.tanpa_cabang_ranap(inpatient_record_id) is false', null),
    ('inpatient_daily_logs', 'kamo_import.tanpa_cabang_ranap(inpatient_record_id) is false', null),
    ('inpatient_status_log', 'kamo_import.tanpa_cabang_ranap(inpatient_record_id) is false', null),
    ('inpatient_med_doses', 'kamo_import.tanpa_cabang_obat_ranap(medication_id) is false', null),
    ('visit_operational_events',
     'kamo_import.tanpa_cabang_kunjungan(visit_id) is false and kamo_import.tanpa_cabang_booking(booking_id) is false', null),
    ('visit_referrals', 'kamo_import.tanpa_cabang_kunjungan(visit_id) is false', null),
    ('bookings', 'kamo_import.tanpa_cabang_kunjungan(visit_id) is false', null),
    ('follow_ups',
     'kamo_import.tanpa_cabang_kunjungan(visit_id) is false and kamo_import.tanpa_cabang_rekam(medical_record_id) is false', null),
    ('clinic_record_addenda',
     'kamo_import.tanpa_cabang_kunjungan(visit_id) is false and kamo_import.tanpa_cabang_rekam(medical_record_id) is false and kamo_import.tanpa_cabang_tagihan(invoice_id) is false', null),
    ('clinic_record_corrections', 'kamo_import.tanpa_cabang_rekam(medical_record_id) is false', null),
    ('invoice_edit_log', 'kamo_import.tanpa_cabang_tagihan(invoice_id) is false', null)
  ) t(tabel, lama, baru) loop
    execute format('create policy riwayat_bersama_terkunci_insert on public.%I as restrictive for insert to authenticated with check (%s)',
                   r.tabel, coalesce(r.baru, r.lama));
    execute format('create policy riwayat_bersama_terkunci_update on public.%I as restrictive for update to authenticated using (%s) with check (%s)',
                   r.tabel, r.lama, coalesce(r.baru, r.lama));
    execute format('create policy riwayat_bersama_terkunci_delete on public.%I as restrictive for delete to authenticated using (%s)',
                   r.tabel, r.lama);
  end loop;
end $d2$;

-- ---------------------------------------------------------------------------
-- 8. RPC publik (tetap SECURITY INVOKER): validasi pemanggil di depan, cari jejak & tulis lewat penulis
-- ---------------------------------------------------------------------------
create or replace function public.import_legacy_medical_record_resolved(
  p_source_key text,
  p_record_no text,
  p_record_date timestamptz,
  p_owner_name text,
  p_phone text,
  p_address text,
  p_patient_name text,
  p_species text,
  p_breed text,
  p_gender text,
  p_dob date,
  p_doctor text,
  p_note text,
  p_anamnesis text,
  p_clinical_findings text,
  p_diagnosis text,
  p_therapy text,
  p_customer_id uuid default null,
  p_pet_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_pet_id uuid;
  v_visit_id uuid;
  v_owner_key text;
  v_phone_key text;
  v_row jsonb;
  v_hash text;
  v_existing_hash text;
  v_matches int;
  v_terkunci boolean;
  v_exact uuid[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Hanya OWNER/ADMIN yang boleh mengimpor rekam medis';
  end if;
  perform kamo_import.pastikan_pengimpor();
  if p_source_key is null or btrim(p_source_key) = '' then
    raise exception 'Jejak sumber wajib diisi';
  end if;
  if length(p_source_key) > 500 then
    raise exception 'Jejak sumber maksimal 500 karakter';
  end if;
  if p_record_date is null or p_owner_name is null or p_phone is null or p_patient_name is null then
    raise exception 'Tanggal, pemilik, nomor telepon, dan pasien wajib diisi';
  end if;

  v_row := jsonb_build_object(
    'source_key', p_source_key,
    'record_no', p_record_no, 'record_date', p_record_date, 'owner_name', p_owner_name,
    'phone', p_phone, 'address', p_address, 'patient_name', p_patient_name,
    'species', p_species, 'breed', p_breed, 'gender', p_gender, 'dob', p_dob,
    'doctor', p_doctor, 'note', p_note, 'anamnesis', p_anamnesis,
    'clinical_findings', p_clinical_findings, 'diagnosis', p_diagnosis, 'therapy', p_therapy);
  v_hash := public.import_legacy_row_hash(v_row);

  -- Kunci identitas yang sama dengan registrasi klinik (C3b), diambil SEBELUM mencari jejak.
  perform public.customer_identity_lock(p_phone);

  -- Riwayat bersama tidak terlihat oleh pemanggil di cabang aktif: cari lewat penulis (tervalidasi).
  select count(*)::int, (array_agg(m.visit_id))[1], (array_agg(m.existing_hash))[1], coalesce(bool_or(m.terkunci), false)
    into v_matches, v_visit_id, v_existing_hash, v_terkunci
  from kamo_import.cari_jejak(p_source_key, p_phone) m;
  if v_terkunci then
    raise exception using errcode = 'P0001', message = kamo_import.alasan_jejak_tidak_terjangkau();
  end if;
  if v_matches > 1 then
    raise exception using errcode = 'P0001', message = public.import_legacy_source_ambiguous_reason();
  end if;
  if v_visit_id is not null then
    if v_existing_hash = v_hash then
      return v_visit_id;
    end if;
    raise exception using errcode = 'P0001', message = public.import_legacy_source_conflict_reason(v_existing_hash);
  end if;

  v_owner_key := public.import_legacy_text_key(p_owner_name);
  v_phone_key := public.indonesian_phone_key(p_phone);

  if p_customer_id is not null then
    select c.id into v_customer_id from public.customers c where c.id = p_customer_id;
    if v_customer_id is null then
      raise exception 'Pemilik pilihan sudah tidak tersedia';
    end if;
  else
    select coalesce(array_agg(c.id order by c.created_at, c.id), '{}') into v_exact
    from public.customers c
    where public.import_legacy_phone_key(c.phone) = v_phone_key
      and public.import_legacy_text_key(c.name) = v_owner_key;
    if cardinality(v_exact) > 1 then
      raise exception using errcode = 'P0001',
        message = 'Perlu keputusan identitas: ada beberapa pelanggan dengan nama dan nomor HP yang sama. Impor ulang folder ini untuk memilih pemilik yang benar.';
    end if;
    v_customer_id := v_exact[1];

    if v_customer_id is null then
      if exists (select 1 from public.customers c where public.import_legacy_phone_key(c.phone) = v_phone_key) then
        raise exception using errcode = 'P0001',
          message = 'Perlu keputusan identitas: nomor HP ini sudah dipakai pelanggan dengan nama berbeda. Impor ulang folder ini untuk memilih pemilik yang benar.';
      end if;
      insert into public.customers(name, phone, address)
      values (p_owner_name, p_phone, nullif(p_address, ''))
      returning id into v_customer_id;
    end if;
  end if;

  if p_pet_id is not null then
    select p.id into v_pet_id
    from public.pets p
    where p.id = p_pet_id and p.customer_id = v_customer_id;
    if v_pet_id is null then
      raise exception 'Anabul pilihan tidak cocok dengan pemilik pilihan';
    end if;
  else
    select p.id into v_pet_id
    from public.pets p
    where p.customer_id = v_customer_id
      and lower(btrim(p.name)) = lower(btrim(p_patient_name))
    order by p.created_at asc
    limit 1;

    if v_pet_id is null then
      insert into public.pets(customer_id, name, species, breed, gender, dob)
      values (v_customer_id, p_patient_name, nullif(p_species, ''), nullif(p_breed, ''), nullif(p_gender, ''), p_dob)
      returning id into v_pet_id;
    end if;
  end if;

  -- Kunjungan tanpa cabang + rekam medis hanya lewat penulis (validasi identitas & sidik di sana).
  return kamo_import.simpan_riwayat_bersama(v_row, v_customer_id, v_pet_id);
end;
$$;

create or replace function public.import_legacy_medical_records_bulk(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_row jsonb;
  v_key text;
  v_lock text;
  v_visit uuid;
  v_hash text;
  v_existing_hash text;
  v_matches int;
  v_terkunci boolean;
  v_status text;
  v_reason text;
  v_hasil jsonb := '[]'::jsonb;
  v_jumlah int;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Hanya OWNER/ADMIN yang boleh mengimpor rekam medis';
  end if;
  perform kamo_import.pastikan_pengimpor();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Daftar riwayat tidak terbaca';
  end if;
  v_jumlah := jsonb_array_length(p_rows);
  if v_jumlah = 0 then
    return v_hasil;
  end if;
  if v_jumlah > 500 then
    raise exception 'Maksimal 500 riwayat per kiriman, diterima %', v_jumlah;
  end if;

  -- Semua kunci identitas kiriman ini diambil terurut sebelum baris pertama (bebas deadlock).
  for v_lock in
    select distinct public.indonesian_phone_key(e.value->>'phone') as k
    from jsonb_array_elements(p_rows) as e(value)
    where public.indonesian_phone_key(e.value->>'phone') <> ''
    order by 1
  loop
    perform public.customer_identity_lock(v_lock);
  end loop;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_key := btrim(coalesce(v_row->>'source_key', ''));
    v_visit := null;
    v_reason := null;
    v_existing_hash := null;
    if v_key = '' then
      v_status := 'ditahan';
      v_reason := 'Jejak sumber wajib diisi';
    elsif length(v_key) > 500 then
      v_status := 'ditahan';
      v_reason := 'Jejak sumber maksimal 500 karakter';
    else
      begin
        v_hash := public.import_legacy_row_hash(v_row);
      exception when others then
        v_hash := null;
        v_reason := sqlerrm;
      end;
      if v_hash is null then
        v_status := 'ditahan';
        v_reason := coalesce(v_reason, 'Isi riwayat tidak terbaca');
      else
        select count(*)::int, (array_agg(m.visit_id))[1], (array_agg(m.existing_hash))[1], coalesce(bool_or(m.terkunci), false)
          into v_matches, v_visit, v_existing_hash, v_terkunci
        from kamo_import.cari_jejak(v_key, v_row->>'phone') m;
        if v_terkunci then
          v_status := 'ditahan';
          v_reason := kamo_import.alasan_jejak_tidak_terjangkau();
          v_visit := null;
        elsif v_matches > 1 then
          v_status := 'ditahan';
          v_reason := public.import_legacy_source_ambiguous_reason();
          v_visit := null;
        elsif v_visit is not null then
          if v_existing_hash = v_hash then
            v_status := 'sudah_ada';
          else
            v_status := 'ditahan';
            v_reason := public.import_legacy_source_conflict_reason(v_existing_hash);
            v_visit := null;
          end if;
        else
          begin
            v_visit := public.import_legacy_medical_record_resolved(
              v_key,
              nullif(v_row->>'record_no', ''),
              (v_row->>'record_date')::timestamptz,
              v_row->>'owner_name',
              v_row->>'phone',
              nullif(v_row->>'address', ''),
              v_row->>'patient_name',
              nullif(v_row->>'species', ''),
              nullif(v_row->>'breed', ''),
              nullif(v_row->>'gender', ''),
              nullif(v_row->>'dob', '')::date,
              nullif(v_row->>'doctor', ''),
              nullif(v_row->>'note', ''),
              nullif(v_row->>'anamnesis', ''),
              nullif(v_row->>'clinical_findings', ''),
              nullif(v_row->>'diagnosis', ''),
              nullif(v_row->>'therapy', ''),
              nullif(v_row->>'customer_id', '')::uuid,
              nullif(v_row->>'pet_id', '')::uuid
            );
            v_status := 'tersimpan';
          exception when others then
            v_reason := sqlerrm;
            -- Kiriman lain mungkin baru saja menyimpan jejak yang sama/setara (pernyataan baru, snapshot baru).
            select count(*)::int, (array_agg(m.visit_id))[1], (array_agg(m.existing_hash))[1], coalesce(bool_or(m.terkunci), false)
              into v_matches, v_visit, v_existing_hash, v_terkunci
            from kamo_import.cari_jejak(v_key, v_row->>'phone') m;
            if v_terkunci then
              v_status := 'ditahan';
              v_reason := kamo_import.alasan_jejak_tidak_terjangkau();
              v_visit := null;
            elsif v_matches > 1 then
              v_status := 'ditahan';
              v_reason := public.import_legacy_source_ambiguous_reason();
              v_visit := null;
            elsif v_visit is not null and v_existing_hash = v_hash then
              v_status := 'sudah_ada';
              v_reason := null;
            elsif v_visit is not null then
              v_status := 'ditahan';
              v_reason := public.import_legacy_source_conflict_reason(v_existing_hash);
              v_visit := null;
            else
              v_status := 'ditahan';
            end if;
          end;
        end if;
      end if;
    end if;
    v_hasil := v_hasil || jsonb_build_object(
      'source_key', v_key,
      'status', v_status,
      'reason', v_reason,
      'visit_id', v_visit
    );
  end loop;
  return v_hasil;
end;
$$;

revoke all on function public.import_legacy_medical_records_bulk(jsonb) from public, anon;
grant execute on function public.import_legacy_medical_records_bulk(jsonb) to authenticated;
revoke all on function public.import_legacy_medical_record_resolved(
  text, text, timestamptz, text, text, text, text, text, text, text, date, text, text, text, text, text, text, uuid, uuid
) from public, anon;
grant execute on function public.import_legacy_medical_record_resolved(
  text, text, timestamptz, text, text, text, text, text, text, text, date, text, text, text, text, text, text, uuid, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. ACL fungsi kamo_import SEBELUM pindah pemilik (sesudahnya admin migrasi tidak bisa memberi hak lagi)
-- ---------------------------------------------------------------------------
revoke all on all functions in schema kamo_import from public, anon, authenticated, service_role;
grant execute on function
  kamo_import.pastikan_pengimpor(),
  kamo_import.alasan_jejak_tidak_terjangkau(),
  kamo_import.cari_jejak(text, text),
  kamo_import.simpan_riwayat_bersama(jsonb, uuid, uuid),
  kamo_import.baca_hasil_impor(text[]),
  kamo_import.tanpa_cabang_kunjungan(uuid),
  kamo_import.tanpa_cabang_rekam(uuid),
  kamo_import.tanpa_cabang_racikan(uuid),
  kamo_import.tanpa_cabang_persetujuan(uuid),
  kamo_import.tanpa_cabang_ranap(uuid),
  kamo_import.tanpa_cabang_obat_ranap(uuid),
  kamo_import.tanpa_cabang_booking(uuid),
  kamo_import.tanpa_cabang_tagihan(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Pindah pemilik ke role penulis (urutan terbukti probe), semuanya di transaksi migrasi ini
-- ---------------------------------------------------------------------------
do $pemilik$
declare
  v_runner text := current_user;
  f regprocedure;
begin
  execute format('grant kamo_legacy_import_writer to %I with set true, inherit false', v_runner);
  grant create on schema kamo_import to kamo_legacy_import_writer;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'kamo_import'::regnamespace loop
    execute format('alter function %s owner to kamo_legacy_import_writer', f);
  end loop;
  revoke create on schema kamo_import from kamo_legacy_import_writer;
  execute format('revoke kamo_legacy_import_writer from %I granted by %I', v_runner, v_runner);
end $pemilik$;

-- ---------------------------------------------------------------------------
-- 11. Gerbang pasca-cek — gagal tertutup (seluruh migrasi batal bila satu saja gagal)
-- ---------------------------------------------------------------------------
do $gerbang$
declare
  w constant text := 'kamo_legacy_import_writer';
  v_role pg_roles%rowtype;
  v_bad text;
  v_allowed_exec text[] := array['pastikan_pengimpor', 'alasan_jejak_tidak_terjangkau', 'cari_jejak', 'simpan_riwayat_bersama', 'baca_hasil_impor',
    'tanpa_cabang_kunjungan', 'tanpa_cabang_rekam', 'tanpa_cabang_racikan', 'tanpa_cabang_persetujuan',
    'tanpa_cabang_ranap', 'tanpa_cabang_obat_ranap', 'tanpa_cabang_booking', 'tanpa_cabang_tagihan'];
  v_d2_tables text[] := array['visits', 'medical_records', 'prescription_items', 'compounding_recipes',
    'compounding_ingredients', 'consents', 'inpatient_records', 'inpatient_medications', 'inpatient_daily_logs',
    'inpatient_status_log', 'inpatient_med_doses', 'visit_operational_events', 'visit_referrals', 'bookings',
    'follow_ups', 'clinic_record_addenda', 'clinic_record_corrections', 'invoice_edit_log'];
  d text;
begin
  -- Pemilik: semua fungsi kamo_import milik role (ALTER OWNER bisa gagal diam-diam bila prasyarat kurang).
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
  where p.pronamespace = 'kamo_import'::regnamespace and pg_get_userbyid(p.proowner) <> w;
  if v_bad is not null or (select count(*) from pg_proc p where p.pronamespace = 'kamo_import'::regnamespace) <> 14 then
    raise exception 'Gerbang: fungsi kamo_import tidak dimiliki role penulis: %', coalesce(v_bad, 'jumlah fungsi salah');
  end if;
  -- Atribut role.
  select * into v_role from pg_roles where rolname = w;
  if v_role.rolsuper or v_role.rolbypassrls or v_role.rolcanlogin or v_role.rolinherit or v_role.rolcreaterole
     or v_role.rolcreatedb or v_role.rolreplication then
    raise exception 'Gerbang: atribut role penulis tidak sempit';
  end if;
  -- Keanggotaan: role bukan anggota peran apa pun; tidak ada keanggotaan SET/INHERIT ke role.
  if exists (select 1 from pg_auth_members m where m.member = w::regrole)
     or exists (select 1 from pg_auth_members m where m.roleid = w::regrole and (m.set_option or m.inherit_option)) then
    raise exception 'Gerbang: keanggotaan role penulis tidak bersih';
  end if;
  -- Keterjangkauan SET ROLE: tidak ada role non-superuser yang bisa menjadi role penulis.
  select string_agg(r.rolname, ', ') into v_bad from pg_roles r
  where not r.rolsuper and r.rolname <> w and pg_has_role(r.oid, w::regrole, 'SET');
  if v_bad is not null then
    raise exception 'Gerbang: role penulis bisa di-SET oleh: %', v_bad;
  end if;
  -- Skema: tanpa CREATE di mana pun; USAGE yang dibutuhkan ada.
  select string_agg(n.nspname, ', ') into v_bad from pg_namespace n where has_schema_privilege(w, n.oid, 'CREATE');
  if v_bad is not null then
    raise exception 'Gerbang: role penulis punya CREATE di skema: %', v_bad;
  end if;
  if not has_schema_privilege(w, 'public', 'USAGE') or not has_schema_privilege(w, 'kamo_import', 'USAGE') then
    raise exception 'Gerbang: role penulis kekurangan USAGE skema public/kamo_import';
  end if;
  -- Batas skema auth tidak diperluas: role penulis tidak memegang USAGE auth dan tidak memanggil auth.uid().
  if has_schema_privilege(w, 'auth', 'USAGE') then
    raise exception 'Gerbang: role penulis tidak boleh memegang USAGE skema auth';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
  where p.pronamespace = 'kamo_import'::regnamespace and p.prosrc ~* 'auth\s*\.\s*uid';
  if v_bad is not null
     or position('uid_permintaan' in (select pg_get_expr(pol.polqual, pol.polrelid) from pg_policy pol
                                     where pol.polrelid = 'public.profiles'::regclass and pol.polname = 'kamo_import_baca')) = 0 then
    raise exception 'Gerbang: fungsi/kebijakan role penulis masih memakai auth.uid(): %', coalesce(v_bad, 'kebijakan profiles');
  end if;
  -- Helper identitas: setara persis dengan auth.uid() yang sidiknya ditinjau.
  if md5(pg_get_functiondef('auth.uid()'::regprocedure)) <> 'ea3b41bf29e2ad573067939329aa088e'
     or (select prosrc from pg_proc where oid = 'kamo_import.uid_permintaan()'::regprocedure)
        is distinct from (select prosrc from pg_proc where oid = 'auth.uid()'::regprocedure)
     or exists (select 1 from pg_proc p where p.oid = 'kamo_import.uid_permintaan()'::regprocedure
                and (p.prosecdef or p.provolatile <> 's' or p.pronargs <> 0 or p.prorettype <> 'uuid'::regtype
                     or p.proretset or p.prolang <> (select oid from pg_language where lanname = 'sql'))) then
    raise exception 'Gerbang: helper identitas tidak setara dengan auth.uid() yang ditinjau';
  end if;
  -- Tabel: tanpa UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER di mana pun; INSERT hanya visits & medical_records;
  -- tidak memiliki tabel.
  select string_agg(c.oid::regclass::text, ', ') into v_bad from pg_class c
  where c.relkind in ('r', 'p', 'v', 'm', 'f') and c.relnamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
    and (has_table_privilege(w, c.oid, 'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         or has_any_column_privilege(w, c.oid, 'UPDATE') or has_any_column_privilege(w, c.oid, 'REFERENCES')
         or (has_any_column_privilege(w, c.oid, 'INSERT') and c.oid not in ('public.visits'::regclass, 'public.medical_records'::regclass))
         or pg_get_userbyid(c.relowner) = w);
  if v_bad is not null then
    raise exception 'Gerbang: hak tabel role penulis terlalu luas: %', v_bad;
  end if;
  -- Kolom: tidak bisa mengisi cabang, id, atau tautan lanjutan.
  if has_column_privilege(w, 'public.visits', 'branch_id', 'INSERT') or has_column_privilege(w, 'public.visits', 'id', 'INSERT')
     or has_column_privilege(w, 'public.visits', 'continued_from_visit_id', 'INSERT')
     or has_column_privilege(w, 'public.medical_records', 'continued_from_record_id', 'INSERT')
     or has_column_privilege(w, 'public.medical_records', 'id', 'INSERT')
     or not has_column_privilege(w, 'public.visits', 'legacy_source_hash', 'INSERT')
     or not has_column_privilege(w, 'public.medical_records', 'diagnosis', 'SELECT') then
    raise exception 'Gerbang: hak kolom role penulis tidak sesuai';
  end if;
  -- Fungsi yang dipanggil penulis benar-benar bisa dieksekusi role (GRANT tanpa hak hanya memberi WARNING).
  if not has_function_privilege(w, 'kamo_import.uid_permintaan()', 'EXECUTE')
     or not has_function_privilege(w, 'public.user_can_access_branch(uuid)', 'EXECUTE')
     or not has_function_privilege(w, 'public.import_legacy_source_match(text,text)', 'EXECUTE')
     or not has_function_privilege(w, 'public.import_legacy_source_key_canonical(text)', 'EXECUTE')
     or not has_function_privilege(w, 'public.import_legacy_row_hash(jsonb)', 'EXECUTE')
     or not has_function_privilege(w, 'public.customer_identity_lock(text)', 'EXECUTE')
     or not has_function_privilege(w, 'public.indonesian_phone_key(text)', 'EXECUTE')
     or not has_function_privilege(w, 'public.import_legacy_text_key(text)', 'EXECUTE')
     or not has_function_privilege(w, 'public.import_legacy_phone_key(text)', 'EXECUTE')
     or not has_function_privilege(w, 'public.import_legacy_source_ambiguous_reason()', 'EXECUTE')
     or not has_function_privilege(w, 'public.import_legacy_source_conflict_reason(text)', 'EXECUTE') then
    raise exception 'Gerbang: role penulis tidak bisa mengeksekusi fungsi yang dibutuhkan';
  end if;
  -- ACL fungsi kamo_import: tanpa PUBLIC/anon/service_role; authenticated hanya daftar yang diizinkan.
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
  where p.pronamespace = 'kamo_import'::regnamespace
    and (p.proacl is null
         or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
         or has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('service_role', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE') <> (p.proname = any(v_allowed_exec))
         or p.prosecdef <> (p.proname <> 'uid_permintaan')
         or array_to_string(p.proconfig, ',') is distinct from 'search_path=""');
  if v_bad is not null then
    raise exception 'Gerbang: ACL/konfigurasi fungsi kamo_import salah: %', v_bad;
  end if;
  -- Pencarian jejak: kecocokan di cabang yang tidak terjangkau tidak pernah keluar (UUID/sidik), dan
  -- penulis memakai pencarian yang sama (tidak ada jalur yang menganggapnya kosong lalu menulis ganda).
  d := pg_get_functiondef('kamo_import.cari_jejak(text,text)'::regprocedure);
  if position('public.user_can_access_branch(v.branch_id) is not true' in d) = 0
     or position('return query select null::uuid, null::text, true;' in d) = 0 then
    raise exception 'Gerbang: cari_jejak belum mengotorisasi kecocokan per cabang';
  end if;
  d := pg_get_functiondef('kamo_import.simpan_riwayat_bersama(jsonb,uuid,uuid)'::regprocedure);
  if position('from kamo_import.cari_jejak(v_key, v_phone) m' in d) = 0 or position('import_legacy_source_match' in d) > 0
     or position('if v_terkunci then' in d) = 0 or position('if v_terkunci then' in d) > position('insert into public.visits' in d) then
    raise exception 'Gerbang: penulis belum menahan kecocokan cabang yang tidak terjangkau sebelum menulis';
  end if;
  -- RPC publik tetap INVOKER dan memakai penulis.
  if exists (select 1 from pg_proc p where p.oid in (
       'public.import_legacy_medical_records_bulk(jsonb)'::regprocedure,
       'public.import_legacy_medical_record_resolved(text,text,timestamptz,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid)'::regprocedure,
       'public.hasil_impor_rekam_medis(text[])'::regprocedure) and p.prosecdef)
     or has_function_privilege('anon', 'public.hasil_impor_rekam_medis(text[])', 'EXECUTE') then
    raise exception 'Gerbang: RPC impor publik harus SECURITY INVOKER dan tertutup untuk anon';
  end if;
  d := pg_get_functiondef('public.import_legacy_medical_record_resolved(text,text,timestamptz,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid)'::regprocedure);
  if position('kamo_import.pastikan_pengimpor()' in d) = 0 or position('kamo_import.cari_jejak(p_source_key, p_phone)' in d) = 0
     or position('kamo_import.simpan_riwayat_bersama(v_row, v_customer_id, v_pet_id)' in d) = 0
     or position('insert into public.visits' in d) > 0 or position('import_legacy_source_match' in d) > 0
     or position('perform public.customer_identity_lock(p_phone)' in d) > position('kamo_import.cari_jejak' in d) then
    raise exception 'Gerbang: impor per baris belum memakai penulis';
  end if;
  d := pg_get_functiondef('public.import_legacy_medical_records_bulk(jsonb)'::regprocedure);
  if position('kamo_import.pastikan_pengimpor()' in d) = 0 or position('import_legacy_source_match' in d) > 0
     or (length(d) - length(replace(d, 'kamo_import.cari_jejak', ''))) / length('kamo_import.cari_jejak') <> 2 then
    raise exception 'Gerbang: impor massal belum mencari jejak lewat penulis di semua jalur';
  end if;
  -- D2: tiga restrictive per tabel, untuk authenticated.
  select string_agg(t, ', ') into v_bad from unnest(v_d2_tables) t
  where (select count(*) from pg_policy pol
         where pol.polrelid = ('public.' || t)::regclass and pol.polname like 'riwayat_bersama_terkunci_%'
           and not pol.polpermissive and pol.polroles = array['authenticated'::regrole::oid]
           and pol.polcmd in ('a', 'w', 'd')) <> 3;
  if v_bad is not null then
    raise exception 'Gerbang: kebijakan D2 tidak lengkap: %', v_bad;
  end if;
  -- Trigger pada tabel yang ditulis role: semuanya aktif, dan selain yang dikenal harus SECURITY DEFINER
  -- (trigger invoker berjalan sebagai role penulis dan bisa menganggapnya "sistem").
  select string_agg(t.tgrelid::regclass || '.' || t.tgname, ', ') into v_bad
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
  where t.tgrelid in ('public.visits'::regclass, 'public.medical_records'::regclass) and not t.tgisinternal
    and (t.tgenabled <> 'O' or (not p.prosecdef and p.oid <> 'public.protect_inpatient_continuation_link()'::regprocedure));
  if v_bad is not null then
    raise exception 'Gerbang: trigger visits/medical_records belum ditinjau untuk role penulis: %', v_bad;
  end if;
end $gerbang$;
