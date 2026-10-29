-- Impor rekam medis: tiga temuan harness PR #328, diperbaiki tanpa menyentuh data lama.
--
-- Persetujuan: Reza menyetujui implementasi perbaikan K1b, K3, dan C3b untuk direview di PR.
-- Pemasangan ke Production menunggu persetujuan terpisah atas teks persis migrasi ini.
--
-- K1b  Jejak sumber sama, isi berbeda. Sebelumnya kartu kedua dilaporkan 'sudah_ada' dan
--      hilang tanpa tanda. Sekarang setiap riwayat impor menyimpan sidik isinya; hanya
--      kiriman ulang yang sidiknya TERBUKTI identik yang boleh 'sudah_ada'. Sidik beda, atau
--      riwayat lama tanpa sidik (tidak bisa dibuktikan sama), ditahan beserta alasannya.
--      Riwayat lama tidak pernah ditimpa dan tidak ada baris baru yang dibuat.
-- K3   Nomor Indonesia 08.. dan +628../628.. dianggap pemilik berbeda. Sekarang satu kunci HP
--      kanonik (indonesian_phone_key) dipakai impor, pemindaian identitas, dan registrasi.
--      Data pelanggan lama TIDAK diubah, digabung, atau dinormalkan; yang berubah hanya cara
--      mencocokkannya.
-- C3b  Registrasi live dan impor yang berbarengan membuat pemilik ganda karena registrasi
--      tidak melihat pelanggan impor yang belum commit. Sekarang kedua jalur mengambil kunci
--      identitas yang sama (advisory lock per kunci HP kanonik) sebelum mencari lalu membuat
--      pelanggan, sehingga yang kedua menunggu yang pertama selesai dan melihat hasilnya.
--
-- Identitas ambigu TIDAK pernah digabung otomatis:
--   * impor: lebih dari satu pelanggan cocok nama+HP, atau HP sudah dipakai pelanggan dengan
--     nama lain dan belum ada pilihan manusia -> baris ditahan, bukan memilih salah satu;
--   * registrasi: lebih dari satu pelanggan dengan kunci HP yang sama dan tidak ada yang
--     persis sama tulisannya -> ditolak dengan pesan, bukan memilih salah satu.
--
-- Tidak ada UPDATE/DELETE pada customers, pets, visits, atau medical_records yang sudah ada.
-- Satu-satunya perubahan skema tabel: kolom baru visits.legacy_source_hash (null untuk semua
-- baris lama). Pra-pemeriksaan Production 29 Okt 2026: 0 visits dengan legacy_source_key.

-- ---------------------------------------------------------------------------
-- 0. Gagal tertutup bila fungsi yang ditimpa sudah berubah dari yang direview
-- ---------------------------------------------------------------------------
do $precheck$
declare d text;
begin
  d := pg_get_functiondef('public.import_legacy_medical_record_resolved(text,text,timestamptz,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid)'::regprocedure);
  if position('where v.legacy_source_key = p_source_key' in d) = 0
     or position('pg_advisory_xact_lock(hashtext(v_owner_key' in d) = 0
     or position('legacy_source_hash' in d) > 0 then
    raise exception 'Impor identitas atomik: import_legacy_medical_record_resolved tidak sama dengan versi yang direview';
  end if;
  d := pg_get_functiondef('public.import_legacy_medical_records_bulk(jsonb)'::regprocedure);
  if position('select v.id into v_visit from public.visits v where v.legacy_source_key = v_key;' in d) = 0
     or position('legacy_source_hash' in d) > 0 then
    raise exception 'Impor identitas atomik: import_legacy_medical_records_bulk tidak sama dengan versi yang direview';
  end if;
  if to_regclass('public.customers_import_phone_key_idx') is null then
    raise exception 'Impor identitas atomik: indeks customers_import_phone_key_idx tidak ada';
  end if;
end $precheck$;

-- ---------------------------------------------------------------------------
-- 1. Kunci HP Indonesia kanonik (K3)
-- ---------------------------------------------------------------------------
-- Cermin persis kunciHpIndonesia() di src/lib/kontak.ts. Vektor uji bersama:
-- src/lib/__tests__/fixtures/kunci-hp-indonesia.json (dipakai vitest DAN harness PostgreSQL).
--   * buang semua karakter non-digit;
--   * 0062xxxxxxxx (min 12 digit) -> 0xxxxxxxx  (awalan panggilan internasional + 62);
--   * 62xxxxxxxx   (min 10 digit) -> 0xxxxxxxx  (kode negara tanpa +);
--   * selain itu apa adanya.
-- Batas panjang mencegah nomor lokal pendek yang kebetulan diawali "62" ikut diubah.
-- Bukan aturan minimum digit HP (itu keputusan bisnis terpisah, belum diputuskan).
create function public.indonesian_phone_key(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when d ~ '^0062' and length(d) >= 12 then '0' || substr(d, 5)
    when d ~ '^62' and length(d) >= 10 then '0' || substr(d, 3)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s
$$;
comment on function public.indonesian_phone_key(text) is
  'Kunci pencocokan HP Indonesia: 08.., +628.., 628.., 00628.. -> 08... Tidak mengubah data tersimpan.';
revoke all on function public.indonesian_phone_key(text) from public, anon;
grant execute on function public.indonesian_phone_key(text) to authenticated, service_role;

-- Kunci impor lama sekarang memakai kunci kanonik. Tanda tangan dan nama tetap, jadi indeks
-- ekspresi dan pemindaian identitas otomatis ikut; indeks dibangun ulang di bawah karena
-- hasil fungsinya berubah.
create or replace function public.import_legacy_phone_key(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select public.indonesian_phone_key(p)
$$;
reindex index public.customers_import_phone_key_idx;

-- ---------------------------------------------------------------------------
-- 2. Kunci identitas pelanggan bersama (C3b)
-- ---------------------------------------------------------------------------
-- Satu kunci per kunci HP kanonik, dipegang sampai transaksi selesai. Impor dan registrasi
-- sama-sama memanggil ini SEBELUM mencari pelanggan, jadi pencarian sesudah kunci didapat
-- selalu melihat pelanggan yang dibuat pemegang kunci sebelumnya.
create function public.customer_identity_lock(p_phone text) returns void
language plpgsql volatile set search_path = '' as $$
declare v_key text := public.indonesian_phone_key(p_phone);
begin
  if v_key <> '' then
    perform pg_advisory_xact_lock(hashtextextended('kamo:customer-identity:' || v_key, 0));
  end if;
end $$;
revoke all on function public.customer_identity_lock(text) from public, anon;
grant execute on function public.customer_identity_lock(text) to authenticated, service_role;

-- Cari pelanggan berdasarkan kunci HP kanonik, tanpa pernah memilih di antara yang ambigu.
--   none      -> belum ada;
--   one       -> tepat satu pelanggan dengan kunci itu, atau tepat satu yang tulisan HP-nya
--                persis sama (perilaku lama registrasi tetap terjaga);
--   ambiguous -> beberapa pelanggan, tidak ada satu pun yang bisa dipilih tanpa manusia.
create function public.customer_pick_by_phone(p_phone text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_key text := public.indonesian_phone_key(p_phone);
  v_ids uuid[];
  v_exact uuid[];
begin
  if v_key = '' then
    return jsonb_build_object('status', 'none');
  end if;
  select coalesce(array_agg(c.id order by c.created_at, c.id), '{}') into v_ids
  from public.customers c
  where public.import_legacy_phone_key(c.phone) = v_key;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('status', 'none');
  end if;
  if cardinality(v_ids) = 1 then
    return jsonb_build_object('status', 'one', 'customer_id', v_ids[1]);
  end if;
  select coalesce(array_agg(c.id), '{}') into v_exact
  from public.customers c
  where c.id = any(v_ids) and c.phone = btrim(p_phone);
  if cardinality(v_exact) = 1 then
    return jsonb_build_object('status', 'one', 'customer_id', v_exact[1]);
  end if;
  return jsonb_build_object('status', 'ambiguous', 'count', cardinality(v_ids));
end $$;
revoke all on function public.customer_pick_by_phone(text) from public, anon;
grant execute on function public.customer_pick_by_phone(text) to authenticated;

-- Registrasi klinik: cari-atau-buat pemilik secara atomik di bawah kunci identitas yang sama
-- dengan impor. SECURITY INVOKER: RLS customers milik pemanggil tetap berlaku.
create function public.registrasi_pelanggan_atomik(
  p_name text, p_phone text, p_dob date, p_email text, p_address text, p_catatan text
) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_pick jsonb;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Silakan masuk ulang';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or public.indonesian_phone_key(p_phone) = '' then
    raise exception 'Nama dan No. HP wajib diisi';
  end if;
  perform public.customer_identity_lock(p_phone);
  -- Pernyataan baru sesudah kunci: snapshot baru, jadi pelanggan yang di-commit pemegang
  -- kunci sebelumnya (impor atau registrasi lain) terlihat di sini.
  v_pick := public.customer_pick_by_phone(p_phone);
  if v_pick->>'status' = 'one' then
    return jsonb_build_object('customer_id', v_pick->>'customer_id', 'dibuat', false);
  end if;
  if v_pick->>'status' = 'ambiguous' then
    raise exception using errcode = 'P0001',
      message = 'Nomor HP ini terdaftar pada beberapa pelanggan. Minta admin memeriksa data pelanggan; sistem tidak memilih salah satu secara otomatis.';
  end if;
  insert into public.customers(name, phone, dob, email, address, catatan)
  values (btrim(p_name), btrim(p_phone), p_dob, nullif(btrim(coalesce(p_email, '')), ''),
          nullif(p_address, ''), nullif(p_catatan, ''))
  returning id into v_id;
  return jsonb_build_object('customer_id', v_id, 'dibuat', true);
end $$;
revoke all on function public.registrasi_pelanggan_atomik(text, text, date, text, text, text) from public, anon;
grant execute on function public.registrasi_pelanggan_atomik(text, text, date, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sidik isi riwayat impor (K1b)
-- ---------------------------------------------------------------------------
alter table public.visits add column legacy_source_hash text;
comment on column public.visits.legacy_source_hash is
  'Sidik isi kartu medis yang diimpor. Kiriman ulang dengan jejak sumber sama hanya dianggap sudah ada bila sidiknya identik. Null untuk kunjungan yang bukan hasil impor dan untuk impor sebelum kolom ini ada.';

-- Isi kartu yang dinormalkan dengan aturan yang SAMA seperti pencocokan identitas, supaya
-- spasi/huruf besar/format HP saja tidak dianggap isi berbeda. Tanggal dinilai sebagai
-- tanggal WIB. STABLE (bukan IMMUTABLE) karena memakai cast teks -> timestamptz.
create function public.import_legacy_row_hash(p_row jsonb) returns text
language sql stable set search_path = '' as $$
  select md5(jsonb_build_array(
    nullif(btrim(coalesce(p_row->>'record_no', '')), ''),
    ((nullif(p_row->>'record_date', ''))::timestamptz at time zone 'Asia/Jakarta')::date,
    public.import_legacy_text_key(p_row->>'owner_name'),
    public.indonesian_phone_key(p_row->>'phone'),
    public.import_legacy_text_key(p_row->>'patient_name'),
    nullif(btrim(coalesce(p_row->>'address', '')), ''),
    nullif(btrim(coalesce(p_row->>'species', '')), ''),
    nullif(btrim(coalesce(p_row->>'breed', '')), ''),
    nullif(btrim(coalesce(p_row->>'gender', '')), ''),
    (nullif(p_row->>'dob', ''))::date,
    nullif(btrim(coalesce(p_row->>'doctor', '')), ''),
    nullif(btrim(coalesce(p_row->>'note', '')), ''),
    nullif(btrim(coalesce(p_row->>'anamnesis', '')), ''),
    nullif(btrim(coalesce(p_row->>'clinical_findings', '')), ''),
    nullif(btrim(coalesce(p_row->>'diagnosis', '')), ''),
    nullif(btrim(coalesce(p_row->>'therapy', '')), '')
  )::text)
$$;
revoke all on function public.import_legacy_row_hash(jsonb) from public, anon;
grant execute on function public.import_legacy_row_hash(jsonb) to authenticated;

-- Alasan yang ditampilkan ke pengguna; satu sumber teks untuk jalur per baris dan massal.
create function public.import_legacy_source_conflict_reason(p_existing_hash text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_existing_hash is null then
      'Jejak sumber belum terbukti sama: jejak ini sudah dipakai riwayat lama yang tidak bisa dibuktikan identik. Riwayat lama tidak diubah; periksa kartu ini secara manual.'
    else
      'Jejak sumber bentrok: kartu ini memakai jejak sumber yang sama dengan riwayat tersimpan, tetapi isinya berbeda. Riwayat lama tidak diubah; periksa nama folder, file, atau tab lalu impor ulang.'
  end
$$;
revoke all on function public.import_legacy_source_conflict_reason(text) from public, anon;
grant execute on function public.import_legacy_source_conflict_reason(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Impor per baris: sidik, kunci identitas bersama, tanpa pilihan otomatis yang ambigu
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
  v_hash text;
  v_existing_hash text;
  v_exact uuid[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Hanya OWNER/ADMIN yang boleh mengimpor rekam medis';
  end if;
  if p_source_key is null or btrim(p_source_key) = '' then
    raise exception 'Jejak sumber wajib diisi';
  end if;
  if p_record_date is null or p_owner_name is null or p_phone is null or p_patient_name is null then
    raise exception 'Tanggal, pemilik, nomor telepon, dan pasien wajib diisi';
  end if;

  v_hash := public.import_legacy_row_hash(jsonb_build_object(
    'record_no', p_record_no, 'record_date', p_record_date, 'owner_name', p_owner_name,
    'phone', p_phone, 'address', p_address, 'patient_name', p_patient_name,
    'species', p_species, 'breed', p_breed, 'gender', p_gender, 'dob', p_dob,
    'doctor', p_doctor, 'note', p_note, 'anamnesis', p_anamnesis,
    'clinical_findings', p_clinical_findings, 'diagnosis', p_diagnosis, 'therapy', p_therapy));

  select v.id, v.legacy_source_hash into v_visit_id, v_existing_hash
  from public.visits v
  where v.legacy_source_key = p_source_key;
  if v_visit_id is not null then
    -- Hanya kiriman ulang yang terbukti identik boleh dianggap sudah ada (K1b).
    if v_existing_hash = v_hash then
      return v_visit_id;
    end if;
    raise exception using errcode = 'P0001', message = public.import_legacy_source_conflict_reason(v_existing_hash);
  end if;

  v_owner_key := public.import_legacy_text_key(p_owner_name);
  v_phone_key := public.indonesian_phone_key(p_phone);
  -- Kunci identitas yang sama dengan registrasi klinik (C3b).
  perform public.customer_identity_lock(p_phone);

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
      -- HP yang sama sudah milik pelanggan dengan nama lain: jangan digabung, jangan dibuat
      -- kembar. Pemindaian aplikasi biasanya sudah menanyakannya; ini penjaga terakhir untuk
      -- pelanggan yang muncul setelah pemindaian (misalnya didaftarkan live saat impor).
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

  insert into public.visits(
    branch_id, customer_id, pet_id, poli, dokter, keluhan, status, created_at,
    legacy_source_key, legacy_record_no, legacy_source_hash
  ) values (
    null, v_customer_id, v_pet_id, 'Poli Umum', nullif(p_doctor, ''),
    coalesce(nullif(p_note, ''), nullif(p_anamnesis, '')), 'Selesai', p_record_date,
    p_source_key, nullif(p_record_no, ''), v_hash
  ) returning id into v_visit_id;

  insert into public.medical_records(visit_id, diagnosis, anamnesis, gejala_klinis, catatan_resep)
  values (
    v_visit_id, nullif(p_diagnosis, ''), nullif(p_anamnesis, ''),
    nullif(p_clinical_findings, ''), nullif(p_therapy, '')
  );
  return v_visit_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Impor massal: sidik di setiap jalur, termasuk jalur pengecualian/balapan
-- ---------------------------------------------------------------------------
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
  v_status text;
  v_reason text;
  v_hasil jsonb := '[]'::jsonb;
  v_jumlah int;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Hanya OWNER/ADMIN yang boleh mengimpor rekam medis';
  end if;
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

  -- Ambil semua kunci identitas kiriman ini dalam urutan tetap sebelum baris pertama
  -- diproses. Dua kiriman yang berbagi beberapa nomor HP mengunci dengan urutan sama,
  -- jadi tidak bisa saling mengunci (deadlock).
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
        select v.id, v.legacy_source_hash into v_visit, v_existing_hash
        from public.visits v where v.legacy_source_key = v_key;
        if v_visit is not null then
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
            -- Kiriman lain mungkin baru saja menyimpan jejak yang sama. Pernyataan baru di
            -- transaksi ini memakai snapshot baru, jadi commit lawan terlihat. Tetap hanya
            -- 'sudah_ada' bila sidiknya terbukti identik.
            select v.id, v.legacy_source_hash into v_visit, v_existing_hash
            from public.visits v where v.legacy_source_key = v_key;
            if v_visit is not null and v_existing_hash = v_hash then
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

-- ACL tidak berubah oleh create or replace, tetapi ditegaskan ulang.
revoke all on function public.import_legacy_medical_records_bulk(jsonb) from public, anon;
grant execute on function public.import_legacy_medical_records_bulk(jsonb) to authenticated;
revoke execute on function public.import_legacy_medical_record_resolved(
  text, text, timestamptz, text, text, text, text, text, text, text, date, text, text, text, text, text, text, uuid, uuid
) from public, anon;
grant execute on function public.import_legacy_medical_record_resolved(
  text, text, timestamptz, text, text, text, text, text, text, text, date, text, text, text, text, text, text, uuid, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Pemeriksaan akhir -- gagal tertutup bila salah satu invarian hilang
-- ---------------------------------------------------------------------------
do $check$
declare d text;
begin
  if public.indonesian_phone_key('+62 812-3456-7890') <> '081234567890'
     or public.indonesian_phone_key('0812 3456 7890') <> '081234567890'
     or public.import_legacy_phone_key('628123456789') <> '08123456789' then
    raise exception 'Kunci HP kanonik tidak sesuai';
  end if;
  d := pg_get_functiondef('public.import_legacy_medical_records_bulk(jsonb)'::regprocedure);
  if position('v_existing_hash = v_hash' in d) = 0 or position('customer_identity_lock' in d) = 0
     or position('public.import_legacy_medical_record_resolved(' in d) = 0 or position('public.is_admin()' in d) = 0 then
    raise exception 'Simpan massal belum memeriksa sidik dan kunci identitas';
  end if;
  d := pg_get_functiondef('public.import_legacy_medical_record_resolved(text,text,timestamptz,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid)'::regprocedure);
  if position('v_existing_hash = v_hash' in d) = 0 or position('customer_identity_lock' in d) = 0
     or position('legacy_source_hash' in d) = 0 or position('public.is_admin()' in d) = 0 then
    raise exception 'Impor per baris belum memeriksa sidik dan kunci identitas';
  end if;
  d := pg_get_functiondef('public.registrasi_pelanggan_atomik(text,text,date,text,text,text)'::regprocedure);
  if position('customer_identity_lock' in d) = 0 or position('customer_pick_by_phone' in d) = 0 then
    raise exception 'Registrasi belum memakai kunci identitas bersama';
  end if;
end $check$;
