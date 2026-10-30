-- Kartu rekam medis TERTUNDA ("Perlu Dilengkapi"): kartu lama hasil migrasi yang belum lengkap (nomor HP kosong/rusak,
-- nama kosong, tanggal bentrok) disimpan UTUH di ruang tunggu terpisah, BUKAN di pelanggan/hewan/kunjungan. Tim
-- melengkapinya dari aplikasi; begitu lengkap, kartu dipindah ke riwayat resmi lewat jalur impor yang sudah ada
-- (import_legacy_medical_record_resolved) dengan pemilik baru bertanda impor (Q01). Keputusan OWNER 2026-10-30.
--
-- Desain:
--   * Tabel kamo_import.kartu_tertunda milik role penulis kamo_legacy_import_writer (pola D1). RLS aktif tanpa
--     kebijakan; tidak ada GRANT ke anon/authenticated/service_role. Akses hanya lewat fungsi.
--   * Fungsi kamo_import.* SECURITY DEFINER milik role penulis, masing-masing memanggil pastikan_pengimpor()
--     (OWNER/ADMIN aktif + header cabang sah). Pembaca/pengisi publik SECURITY INVOKER.
--   * lengkapi_kartu_tertunda SECURITY INVOKER: pembuatan pemilik baru (INSERT customers dengan imported_at) dan
--     penulisan riwayat (import_legacy_medical_record_resolved) berjalan sebagai pemanggil dengan RLS biasa.
--   * Tidak ada DELETE: kartu hanya berpindah status perlu_dilengkapi -> selesai | dibatalkan (dengan alasan).
--   * Tidak mengubah tabel, kebijakan, hak, atau fungsi yang sudah ada.

-- ---------------------------------------------------------------------------
-- 0. Prasyarat — gagal tertutup
-- ---------------------------------------------------------------------------
do $pra$
begin
  if to_regrole('kamo_legacy_import_writer') is null or to_regnamespace('kamo_import') is null
     or to_regprocedure('kamo_import.pastikan_pengimpor()') is null
     or to_regprocedure('kamo_import.uid_permintaan()') is null
     or to_regprocedure('public.customer_identity_lock(text)') is null
     or to_regprocedure('public.import_legacy_phone_key(text)') is null
     or to_regprocedure('public.import_legacy_medical_record_resolved(text,text,timestamp with time zone,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid)') is null
     or to_regclass('kamo_import.kartu_tertunda') is not null then
    raise exception 'Kartu tertunda: prasyarat penulis riwayat bersama tidak lengkap atau tabel sudah ada';
  end if;
end $pra$;

-- ---------------------------------------------------------------------------
-- 1. Tabel ruang tunggu
-- ---------------------------------------------------------------------------
create table kamo_import.kartu_tertunda (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique check (btrim(source_key) <> '' and length(source_key) <= 500),
  batch_sha256 text not null check (batch_sha256 ~ '^[0-9a-f]{64}$'),
  local_record_id text not null check (btrim(local_record_id) <> '' and length(local_record_id) <= 100),
  sumber_berkas text check (length(sumber_berkas) <= 255),
  sumber_sheet text check (length(sumber_sheet) <= 255),
  kekurangan text[] not null check (
    cardinality(kekurangan) between 1 and 8
    and kekurangan <@ array['hp_kosong', 'hp_tidak_valid', 'hp_angka', 'nama_pemilik_kosong', 'nama_hewan_kosong',
                            'tanggal_bentrok', 'tanggal_kosong', 'kemungkinan_salinan']::text[]),
  isi jsonb not null check (jsonb_typeof(isi) = 'object'),
  isi_hash text not null,
  status text not null default 'perlu_dilengkapi' check (status in ('perlu_dilengkapi', 'selesai', 'dibatalkan')),
  visit_id uuid references public.visits(id),
  penyelesaian jsonb check (penyelesaian is null or jsonb_typeof(penyelesaian) = 'object'),
  catatan text check (length(catatan) <= 500),
  dibuat_oleh uuid not null,
  dibuat_pada timestamptz not null default now(),
  diubah_oleh uuid,
  diubah_pada timestamptz,
  check ((status = 'selesai') = (visit_id is not null)),
  check (status <> 'dibatalkan' or btrim(coalesce(catatan, '')) <> '')
);
comment on table kamo_import.kartu_tertunda is
  'Kartu rekam medis lama yang belum lengkap (Perlu Dilengkapi). Bukan riwayat resmi; dipindah lewat lengkapi_kartu_tertunda.';
create index kartu_tertunda_status_idx on kamo_import.kartu_tertunda (status, dibuat_pada desc, id);
alter table kamo_import.kartu_tertunda owner to kamo_legacy_import_writer;
alter table kamo_import.kartu_tertunda enable row level security;
revoke all on table kamo_import.kartu_tertunda from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Helper (SECURITY DEFINER, milik role penulis)
-- ---------------------------------------------------------------------------
create function kamo_import.teks_kartu(p_isi jsonb, p_kunci text, p_maks integer) returns text
language plpgsql immutable set search_path = '' as $$
declare v jsonb := p_isi -> p_kunci;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'string' then
    raise exception using errcode = '22023', message = format('Isi kartu "%s" harus teks', p_kunci);
  end if;
  if length(v #>> '{}') > p_maks then
    raise exception using errcode = '22023', message = format('Isi kartu "%s" melebihi %s karakter', p_kunci, p_maks);
  end if;
  return nullif(v #>> '{}', '');
end $$;

create function kamo_import.tanggal_kartu(p_isi jsonb, p_kunci text) returns date
language plpgsql immutable set search_path = '' as $$
declare t text := kamo_import.teks_kartu(p_isi, p_kunci, 10);
begin
  if t is null then return null; end if;
  if t !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode = '22023', message = format('Tanggal kartu "%s" harus YYYY-MM-DD', p_kunci);
  end if;
  return t::date;
end $$;

create function kamo_import.simpan_kartu_tertunda(p_row jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_key text;
  v_isi jsonb;
  v_hash text;
  v_kekurangan text[];
  v_ada kamo_import.kartu_tertunda%rowtype;
  v_id uuid;
  v_kunci text;
begin
  perform kamo_import.pastikan_pengimpor();
  if p_row is null or jsonb_typeof(p_row) <> 'object' or jsonb_typeof(p_row -> 'isi') is distinct from 'object'
     or jsonb_typeof(p_row -> 'kekurangan') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Baris kartu tertunda tidak terbaca';
  end if;
  v_key := p_row ->> 'source_key';
  v_isi := p_row -> 'isi';
  for v_kunci in select jsonb_object_keys(v_isi) loop
    if v_kunci not in ('owner_name', 'phone', 'address', 'patient_name', 'species', 'breed', 'gender', 'dob', 'record_no',
                       'tanggal_usulan', 'tanggal_tab', 'tanggal_sel', 'doctor', 'note', 'anamnesis', 'clinical_findings',
                       'diagnosis', 'therapy') then
      raise exception using errcode = '22023', message = format('Kolom kartu "%s" tidak dikenal', v_kunci);
    end if;
  end loop;
  -- Batas = kolom DB tujuan (sama dengan rencana migrasi); lebih panjang = ditolak, tidak dipotong.
  perform kamo_import.teks_kartu(v_isi, 'owner_name', 100), kamo_import.teks_kartu(v_isi, 'phone', 30),
          kamo_import.teks_kartu(v_isi, 'address', 1000), kamo_import.teks_kartu(v_isi, 'patient_name', 100),
          kamo_import.teks_kartu(v_isi, 'species', 50), kamo_import.teks_kartu(v_isi, 'breed', 50),
          kamo_import.teks_kartu(v_isi, 'gender', 10), kamo_import.teks_kartu(v_isi, 'record_no', 100),
          kamo_import.teks_kartu(v_isi, 'doctor', 100), kamo_import.teks_kartu(v_isi, 'note', 5000),
          kamo_import.teks_kartu(v_isi, 'anamnesis', 10000), kamo_import.teks_kartu(v_isi, 'clinical_findings', 10000),
          kamo_import.teks_kartu(v_isi, 'diagnosis', 10000), kamo_import.teks_kartu(v_isi, 'therapy', 10000),
          kamo_import.tanggal_kartu(v_isi, 'dob'), kamo_import.tanggal_kartu(v_isi, 'tanggal_usulan'),
          kamo_import.tanggal_kartu(v_isi, 'tanggal_tab'), kamo_import.tanggal_kartu(v_isi, 'tanggal_sel');
  if coalesce(kamo_import.teks_kartu(v_isi, 'note', 5000), kamo_import.teks_kartu(v_isi, 'anamnesis', 10000),
              kamo_import.teks_kartu(v_isi, 'clinical_findings', 10000), kamo_import.teks_kartu(v_isi, 'diagnosis', 10000),
              kamo_import.teks_kartu(v_isi, 'therapy', 10000)) is null then
    raise exception using errcode = '22023', message = 'Kartu tanpa isi klinis tidak disimpan';
  end if;
  select coalesce(array_agg(x order by x), '{}') into v_kekurangan
  from (select distinct jsonb_array_elements_text(p_row -> 'kekurangan') x) s;
  v_hash := md5(v_isi::text);

  if v_key is null or btrim(v_key) = '' or length(v_key) > 500 then
    raise exception using errcode = '22023', message = 'Jejak sumber wajib diisi (maksimal 500 karakter)';
  end if;
  -- Sudah jadi riwayat resmi dengan jejak yang sama: tidak disimpan ulang.
  if exists (select 1 from public.visits v where v.legacy_source_key = v_key) then
    return jsonb_build_object('source_key', v_key, 'status', 'sudah_masuk', 'id', null);
  end if;
  select * into v_ada from kamo_import.kartu_tertunda k where k.source_key = v_key for update;
  if found then
    if v_ada.isi_hash = v_hash and v_ada.kekurangan = v_kekurangan then
      return jsonb_build_object('source_key', v_key, 'status', 'sudah_ada', 'id', v_ada.id);
    end if;
    return jsonb_build_object('source_key', v_key, 'status', 'bentrok', 'id', v_ada.id);
  end if;
  insert into kamo_import.kartu_tertunda (source_key, batch_sha256, local_record_id, sumber_berkas, sumber_sheet,
                                          kekurangan, isi, isi_hash, dibuat_oleh)
  values (v_key, p_row ->> 'batch_sha256', p_row ->> 'local_record_id', nullif(p_row ->> 'sumber_berkas', ''),
          nullif(p_row ->> 'sumber_sheet', ''), v_kekurangan, v_isi, v_hash, kamo_import.uid_permintaan())
  returning id into v_id;
  return jsonb_build_object('source_key', v_key, 'status', 'tersimpan', 'id', v_id);
end $$;

create function kamo_import.baca_kartu_tertunda(p_id uuid, p_status text, p_cari text, p_dari integer, p_jumlah integer)
returns table(
  id uuid, status text, kekurangan text[], isi jsonb, sumber_berkas text, sumber_sheet text, local_record_id text,
  visit_id uuid, catatan text, dibuat_pada timestamptz, diubah_pada timestamptz, total bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare v_cari text := nullif(lower(btrim(coalesce(p_cari, ''))), '');
begin
  perform kamo_import.pastikan_pengimpor();
  if p_dari is null or p_dari < 0 or p_jumlah is null or p_jumlah < 1 or p_jumlah > 200
     or (p_id is null and p_status not in ('perlu_dilengkapi', 'selesai', 'dibatalkan')) then
    raise exception using errcode = '22023', message = 'Parameter daftar kartu tertunda tidak sah';
  end if;
  return query
    select k.id, k.status, k.kekurangan, k.isi, k.sumber_berkas, k.sumber_sheet, k.local_record_id, k.visit_id, k.catatan,
           k.dibuat_pada, k.diubah_pada, count(*) over ()
    from kamo_import.kartu_tertunda k
    where (p_id is not null and k.id = p_id)
       or (p_id is null and k.status = p_status and (v_cari is null
           or lower(coalesce(k.isi ->> 'owner_name', '')) like '%' || v_cari || '%'
           or lower(coalesce(k.isi ->> 'patient_name', '')) like '%' || v_cari || '%'
           or coalesce(k.isi ->> 'phone', '') like '%' || v_cari || '%'
           or lower(coalesce(k.sumber_berkas, '')) like '%' || v_cari || '%'))
    order by k.dibuat_pada desc, k.id
    offset p_dari limit p_jumlah;
end $$;

-- Kunci kartu untuk dilengkapi (FOR UPDATE di transaksi pemanggil). Hanya status perlu_dilengkapi.
create function kamo_import.kunci_kartu_tertunda(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r kamo_import.kartu_tertunda%rowtype;
begin
  perform kamo_import.pastikan_pengimpor();
  select * into r from kamo_import.kartu_tertunda k where k.id = p_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Kartu tertunda tidak ditemukan'; end if;
  if r.status <> 'perlu_dilengkapi' then
    raise exception using errcode = 'P0001', message = 'Kartu ini sudah selesai atau dibatalkan';
  end if;
  return jsonb_build_object('source_key', r.source_key, 'kekurangan', to_jsonb(r.kekurangan), 'isi', r.isi);
end $$;

create function kamo_import.tutup_kartu_tertunda(p_id uuid, p_visit uuid, p_penyelesaian jsonb, p_catatan text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare r kamo_import.kartu_tertunda%rowtype;
begin
  perform kamo_import.pastikan_pengimpor();
  select * into r from kamo_import.kartu_tertunda k where k.id = p_id for update;
  if not found or r.status <> 'perlu_dilengkapi' then
    raise exception using errcode = 'P0001', message = 'Kartu ini sudah selesai atau dibatalkan';
  end if;
  if p_visit is not null then
    -- Riwayat resmi wajib benar-benar ada dengan jejak kartu ini.
    if not exists (select 1 from public.visits v where v.id = p_visit and v.legacy_source_key = r.source_key) then
      raise exception using errcode = 'P0001', message = 'Riwayat hasil kartu tidak ditemukan';
    end if;
    update kamo_import.kartu_tertunda
       set status = 'selesai', visit_id = p_visit, penyelesaian = p_penyelesaian,
           diubah_oleh = kamo_import.uid_permintaan(), diubah_pada = now()
     where id = p_id;
  else
    if btrim(coalesce(p_catatan, '')) = '' or length(p_catatan) > 500 then
      raise exception using errcode = '22023', message = 'Alasan pembatalan wajib diisi (maksimal 500 karakter)';
    end if;
    update kamo_import.kartu_tertunda
       set status = 'dibatalkan', catatan = btrim(p_catatan), diubah_oleh = kamo_import.uid_permintaan(), diubah_pada = now()
     where id = p_id;
  end if;
end $$;

do $milik$
declare f regprocedure;
begin
  foreach f in array array[
    'kamo_import.teks_kartu(jsonb,text,integer)', 'kamo_import.tanggal_kartu(jsonb,text)',
    'kamo_import.simpan_kartu_tertunda(jsonb)', 'kamo_import.baca_kartu_tertunda(uuid,text,text,integer,integer)',
    'kamo_import.kunci_kartu_tertunda(uuid)', 'kamo_import.tutup_kartu_tertunda(uuid,uuid,jsonb,text)'
  ]::regprocedure[] loop
    execute format('alter function %s owner to kamo_legacy_import_writer', f);
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $milik$;

-- ---------------------------------------------------------------------------
-- 3. RPC publik (SECURITY INVOKER)
-- ---------------------------------------------------------------------------
create function public.simpan_kartu_tertunda(p_rows jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare v_out jsonb := '[]'::jsonb; v_row jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Hanya OWNER/ADMIN yang boleh menyimpan kartu tertunda';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'Kiriman kartu tertunda harus larik maksimal 500 baris';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_out := v_out || jsonb_build_array(kamo_import.simpan_kartu_tertunda(v_row));
  end loop;
  return v_out;
end $$;

create function public.daftar_kartu_tertunda(p_status text, p_cari text, p_dari integer, p_jumlah integer)
returns table(
  id uuid, status text, kekurangan text[], isi jsonb, sumber_berkas text, sumber_sheet text, local_record_id text,
  visit_id uuid, catatan text, dibuat_pada timestamptz, diubah_pada timestamptz, total bigint
)
language sql stable security invoker set search_path = '' as $$
  select * from kamo_import.baca_kartu_tertunda(null, p_status, p_cari, p_dari, p_jumlah)
$$;

create function public.detail_kartu_tertunda(p_id uuid)
returns table(
  id uuid, status text, kekurangan text[], isi jsonb, sumber_berkas text, sumber_sheet text, local_record_id text,
  visit_id uuid, catatan text, dibuat_pada timestamptz, diubah_pada timestamptz, total bigint
)
language sql stable security invoker set search_path = '' as $$
  select * from kamo_import.baca_kartu_tertunda(p_id, null, null, 0, 1)
$$;

create function public.batalkan_kartu_tertunda(p_id uuid, p_alasan text) returns void
language plpgsql volatile security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Hanya OWNER/ADMIN yang boleh membatalkan kartu tertunda';
  end if;
  perform kamo_import.tutup_kartu_tertunda(p_id, null, null, p_alasan);
end $$;

/*
 * Lengkapi satu kartu lalu pindahkan ke riwayat resmi, dalam SATU transaksi:
 *   - pemilik: p_customer_id (dipilih) ATAU nomor HP (p_phone / HP kartu yang sah). HP = patokan utama; >1 kartu
 *     dengan HP sama = ditolak (pilih pemiliknya); 0 = pemilik baru dibuat dengan imported_at (Q01).
 *   - hewan: p_pet_id (milik pemilik) ATAU nama kartu / p_patient_name; >1 hewan senama (termasuk nonaktif) = ditolak.
 *   - tanggal: p_record_date wajib bila kartu bertanda tanggal bentrok/kosong; selain itu tanggal usulan kartu.
 *   - penulisan riwayat lewat import_legacy_medical_record_resolved (jejak & sidik sama, idempoten).
 */
create function public.lengkapi_kartu_tertunda(
  p_id uuid,
  p_phone text default null,
  p_customer_id uuid default null,
  p_owner_name text default null,
  p_patient_name text default null,
  p_pet_id uuid default null,
  p_record_date date default null
) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_kartu jsonb;
  v_isi jsonb;
  v_kurang text[];
  v_phone text;
  v_digit text;
  v_customer uuid;
  v_customer_phone text;
  v_customer_name text;
  v_owner text;
  v_patient text;
  v_pet uuid;
  v_n integer;
  v_date date;
  v_baru boolean := false;
  v_visit uuid;
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Hanya OWNER/ADMIN yang boleh melengkapi kartu tertunda';
  end if;
  v_kartu := kamo_import.kunci_kartu_tertunda(p_id);
  v_isi := v_kartu -> 'isi';
  select coalesce(array_agg(x), '{}') into v_kurang from jsonb_array_elements_text(v_kartu -> 'kekurangan') x;

  -- Nomor HP: isian petugas, atau HP kartu bila kartu tidak bertanda masalah HP. Tidak pernah dikarang.
  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  if v_phone is null and not (v_kurang && array['hp_kosong', 'hp_tidak_valid', 'hp_angka']) then
    v_phone := nullif(btrim(coalesce(v_isi ->> 'phone', '')), '');
  end if;
  if v_phone is not null then
    v_digit := regexp_replace(v_phone, '[^0-9]', '', 'g');
    if length(v_phone) > 30 or length(v_digit) < 10 or length(v_digit) > 15 or v_digit ~ '^(\d)\1*$' then
      raise exception using errcode = '22023', message = 'Nomor HP tidak valid (10–15 angka, bukan angka berulang)';
    end if;
  end if;

  if p_customer_id is not null then
    select c.id, c.phone, c.name into v_customer, v_customer_phone, v_customer_name from public.customers c where c.id = p_customer_id;
    if v_customer is null then raise exception using errcode = 'P0001', message = 'Pemilik pilihan tidak ditemukan'; end if;
    if v_phone is not null and public.import_legacy_phone_key(v_phone) <> public.import_legacy_phone_key(v_customer_phone) then
      raise exception using errcode = 'P0001', message = 'Nomor HP berbeda dengan nomor pemilik yang dipilih';
    end if;
    v_phone := v_customer_phone;
  else
    if v_phone is null then
      raise exception using errcode = '22023', message = 'Isi nomor HP pemilik atau pilih pemilik yang sudah ada';
    end if;
    perform public.customer_identity_lock(v_phone);
    select count(*)::int, min(c.id::text)::uuid into v_n, v_customer
      from public.customers c where public.import_legacy_phone_key(c.phone) = public.import_legacy_phone_key(v_phone);
    if v_n > 1 then
      raise exception using errcode = 'P0001', message = 'Ada beberapa pemilik dengan nomor HP ini; pilih pemiliknya';
    end if;
    if v_n = 1 then
      select c.phone, c.name into v_customer_phone, v_customer_name from public.customers c where c.id = v_customer;
    else
      v_owner := coalesce(nullif(btrim(coalesce(v_isi ->> 'owner_name', '')), ''), nullif(btrim(coalesce(p_owner_name, '')), ''));
      if v_owner is null then raise exception using errcode = '22023', message = 'Nama pemilik wajib diisi untuk pemilik baru'; end if;
      if length(v_owner) > 100 then raise exception using errcode = '22023', message = 'Nama pemilik maksimal 100 karakter'; end if;
      -- Kartu riwayat lama = pelanggan lama: imported_at sejak lahir (tidak pernah dihitung pelanggan baru Q01).
      insert into public.customers (name, phone, address, imported_at)
      values (v_owner, v_phone, nullif(v_isi ->> 'address', ''), now())
      returning id, phone, name into v_customer, v_customer_phone, v_customer_name;
      v_baru := true;
    end if;
  end if;
  v_owner := coalesce(nullif(btrim(coalesce(v_isi ->> 'owner_name', '')), ''), nullif(btrim(coalesce(p_owner_name, '')), ''), v_customer_name);
  if length(v_owner) > 100 then raise exception using errcode = '22023', message = 'Nama pemilik maksimal 100 karakter'; end if;

  -- Hewan.
  if p_pet_id is not null then
    select p.id, p.name into v_pet, v_patient from public.pets p where p.id = p_pet_id and p.customer_id = v_customer;
    if v_pet is null then raise exception using errcode = 'P0001', message = 'Hewan pilihan bukan milik pemilik ini'; end if;
  else
    v_patient := coalesce(nullif(btrim(coalesce(v_isi ->> 'patient_name', '')), ''), nullif(btrim(coalesce(p_patient_name, '')), ''));
    if v_patient is null then raise exception using errcode = '22023', message = 'Nama hewan wajib diisi'; end if;
    if length(v_patient) > 100 then raise exception using errcode = '22023', message = 'Nama hewan maksimal 100 karakter'; end if;
    select count(*)::int into v_n from public.pets p
     where p.customer_id = v_customer and lower(btrim(p.name)) = lower(btrim(v_patient));
    if v_n > 1 then
      raise exception using errcode = 'P0001', message = 'Ada beberapa hewan bernama sama pada pemilik ini; pilih hewannya';
    end if;
  end if;

  -- Tanggal.
  if v_kurang && array['tanggal_bentrok', 'tanggal_kosong'] and p_record_date is null then
    raise exception using errcode = '22023', message = 'Pilih tanggal pemeriksaan yang benar';
  end if;
  v_date := coalesce(p_record_date, kamo_import.tanggal_kartu(v_isi, 'tanggal_usulan'));
  if v_date is null then raise exception using errcode = '22023', message = 'Pilih tanggal pemeriksaan yang benar'; end if;
  if v_date > v_today or v_date < date '1990-01-01' then
    raise exception using errcode = '22023', message = 'Tanggal pemeriksaan di luar rentang yang wajar';
  end if;

  v_visit := public.import_legacy_medical_record_resolved(
    v_kartu ->> 'source_key', nullif(v_isi ->> 'record_no', ''),
    (v_date::timestamp at time zone 'Asia/Jakarta'), v_owner, v_customer_phone, nullif(v_isi ->> 'address', ''), v_patient,
    nullif(v_isi ->> 'species', ''), nullif(v_isi ->> 'breed', ''), nullif(v_isi ->> 'gender', ''),
    kamo_import.tanggal_kartu(v_isi, 'dob'), nullif(v_isi ->> 'doctor', ''), nullif(v_isi ->> 'note', ''),
    nullif(v_isi ->> 'anamnesis', ''), nullif(v_isi ->> 'clinical_findings', ''), nullif(v_isi ->> 'diagnosis', ''),
    nullif(v_isi ->> 'therapy', ''), v_customer, v_pet);

  perform kamo_import.tutup_kartu_tertunda(p_id, v_visit, jsonb_build_object(
    'customer_id', v_customer, 'pemilik_baru', v_baru, 'tanggal', v_date, 'hp_diisi', p_phone is not null,
    'nama_pemilik_diisi', p_owner_name is not null, 'nama_hewan_diisi', p_patient_name is not null), null);
  return v_visit;
end $$;

revoke all on function public.simpan_kartu_tertunda(jsonb), public.daftar_kartu_tertunda(text, text, integer, integer),
  public.detail_kartu_tertunda(uuid), public.batalkan_kartu_tertunda(uuid, text),
  public.lengkapi_kartu_tertunda(uuid, text, uuid, text, text, uuid, date) from public, anon, service_role;
grant execute on function public.simpan_kartu_tertunda(jsonb), public.daftar_kartu_tertunda(text, text, integer, integer),
  public.detail_kartu_tertunda(uuid), public.batalkan_kartu_tertunda(uuid, text),
  public.lengkapi_kartu_tertunda(uuid, text, uuid, text, text, uuid, date) to authenticated;
