-- Impor rekam medis: jejak sumber setara untuk nomor HP 08.. / 62.. / 0062.. (temuan review PR #333).
--
-- Persetujuan: koordinasi (Reza via Wowo) memilih opsi C -- kenali varian nomor yang setara di dalam
-- identitas sumber yang sama, TANPA mengubah jejak tersimpan, TANPA backfill, TANPA penggabungan.
-- Opsi A (gabung kartu berbeda yang isinya identik) dan B (jejak baru berformat lain) ditolak.
-- Pemasangan ke Production menunggu persetujuan terpisah atas teks persis migrasi ini.
--
-- Masalah: parser menulis digit HP dari nama folder pemilik apa adanya ke jejak sumber. Kartu yang
-- sama dari folder "Budi - 0812.." lalu "Budi - +62 812.." (dua sesi impor) mendapat dua jejak
-- berbeda, sedangkan sidik isi hanya dibandingkan bila jejaknya sama -> kunjungan tercatat dua kali.
--
-- ASUMSI STRUKTUR JEJAK (dari rowFromCard di src/lib/impor-rekam-medis.ts):
--   * Jejak "berstruktur" = tepat 4 bagian dipisah '::':
--       kunciTeks(nama pemilik) :: digit HP folder :: kunciTeks(pasien/nama berkas) :: kunciTeks(nama tab)
--     kunciTeks membuang '.' dan ':' sehingga bagian 1, 3, 4 tidak pernah memuat '::'; bagian 2 hanya
--     digit (identityFromPath membuang semua non-digit).
--   * Jejak cadangan "nama berkas::nama tab" (kartu di luar folder pemilik) punya 2 bagian dan TIDAK
--     pernah dianggap setara dengan jejak lain -- hanya cocok persis seperti sebelumnya.
--   * Dua jejak berstruktur setara bila bagian 1, 3, 4 sama persis dan bagian 2 sama menurut
--     indonesian_phone_key. Tab, berkas, pasien, atau pemilik berbeda = kartu sumber berbeda, walau
--     isinya kebetulan identik (tidak digabung).
--   * Varian hanya dicari bila HP kanonik di jejak = HP kanonik baris yang dikirim (parser selalu
--     mengisi HP baris dari folder yang sama). Dengan begitu kunci identitas HP yang dipegang pemanggil
--     melindungi semua varian jejak itu. Baris yang tidak memenuhi ini hanya dicocokkan persis.
--   * Sisa risiko yang diterima: nama berkas yang memuat '::' (mustahil di Windows) dengan bagian kedua
--     berupa digit bisa terbaca sebagai jejak berstruktur; tetap hanya setara dengan jejak yang sama
--     persis selain nomor HP.
--
-- Aturan (tidak berubah kecuali pencarian):
--   * tepat satu riwayat cocok (persis atau setara) & sidik identik  -> sudah_ada, tidak menulis apa pun;
--   * tepat satu riwayat cocok, sidik beda                         -> ditahan (bentrok);
--   * tepat satu riwayat cocok tanpa sidik                          -> ditahan (belum terbukti);
--   * LEBIH DARI SATU riwayat cocok (data lama sudah ganda)          -> ditahan (gagal tertutup), tidak
--     memilih salah satu, tidak menggabungkan;
--   * tidak ada                                                     -> dibuat baru.
--
-- Perubahan basis data: 3 fungsi baru, 1 indeks ekspresi TIDAK unik pada visits, dan dua RPC impor
-- diganti (cari jejak lewat fungsi setara; jalur per baris mengambil kunci identitas SEBELUM mencari).
-- Tidak ada UPDATE/DELETE pada data apa pun; jejak tersimpan tetap teks mentahnya.
-- Catatan operasional: indeks dibangun di dalam transaksi migrasi sehingga menahan tulis ke visits
-- selama pembangunan.

-- ---------------------------------------------------------------------------
-- 0. Gagal tertutup bila fungsi yang ditimpa bukan versi 20261101090000 yang direview
-- ---------------------------------------------------------------------------
do $precheck$
declare d text;
begin
  d := pg_get_functiondef('public.import_legacy_medical_record_resolved(text,text,timestamptz,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid)'::regprocedure);
  if position('where v.legacy_source_key = p_source_key' in d) = 0
     or position('v_existing_hash = v_hash' in d) = 0
     or position('import_legacy_source_match' in d) > 0 then
    raise exception 'Jejak setara: import_legacy_medical_record_resolved tidak sama dengan versi yang direview';
  end if;
  d := pg_get_functiondef('public.import_legacy_medical_records_bulk(jsonb)'::regprocedure);
  if position('from public.visits v where v.legacy_source_key = v_key;' in d) = 0
     or position('v_existing_hash = v_hash' in d) = 0
     or position('import_legacy_source_match' in d) > 0 then
    raise exception 'Jejak setara: import_legacy_medical_records_bulk tidak sama dengan versi yang direview';
  end if;
  if to_regprocedure('public.indonesian_phone_key(text)') is null
     or to_regprocedure('public.customer_identity_lock(text)') is null then
    raise exception 'Jejak setara: migrasi 20261101090000 belum terpasang';
  end if;
end $precheck$;

-- ---------------------------------------------------------------------------
-- 1. Bentuk kanonik jejak berstruktur (hanya untuk MENCOCOKKAN; jejak tersimpan tidak diubah)
-- ---------------------------------------------------------------------------
create function public.import_legacy_source_key_canonical(p_key text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when cardinality(string_to_array(p_key, '::')) = 4 and split_part(p_key, '::', 2) ~ '^[0-9]+$'
      then split_part(p_key, '::', 1) || '::' || public.indonesian_phone_key(split_part(p_key, '::', 2))
           || '::' || split_part(p_key, '::', 3) || '::' || split_part(p_key, '::', 4)
    else p_key
  end
$$;
comment on function public.import_legacy_source_key_canonical(text) is
  'Jejak sumber impor dengan bagian HP dikanonikkan (08/62/0062 -> 08). Hanya untuk mencocokkan; legacy_source_key tersimpan tidak pernah diubah.';
-- Pemeliharaan indeks ekspresi memeriksa hak EXECUTE peran yang meng-insert visits berjejak.
revoke all on function public.import_legacy_source_key_canonical(text) from public, anon;
grant execute on function public.import_legacy_source_key_canonical(text) to authenticated, service_role;

-- Tidak unik: data lama boleh saja sudah memuat dua varian; unik akan memaksa backfill/penggabungan.
-- Parsial: kunjungan klinik biasa (tanpa jejak) tidak pernah menghitung ekspresi ini.
create index visits_legacy_source_key_canonical_idx
  on public.visits (public.import_legacy_source_key_canonical(legacy_source_key))
  where legacy_source_key is not null;

-- ---------------------------------------------------------------------------
-- 2. Semua riwayat yang cocok: persis, atau setara bila jejaknya berstruktur dan HP-nya = HP baris
-- ---------------------------------------------------------------------------
create function public.import_legacy_source_match(p_key text, p_phone text)
returns table(visit_id uuid, existing_hash text)
language plpgsql stable security invoker set search_path = '' as $$
declare v_canon text := public.import_legacy_source_key_canonical(p_key);
begin
  -- Jejak berstruktur (lihat asumsi di atas) yang HP-nya = HP baris: cari semua varian setara.
  if cardinality(string_to_array(p_key, '::')) = 4 and split_part(p_key, '::', 2) ~ '^[0-9]+$' then
    if split_part(v_canon, '::', 2) = public.indonesian_phone_key(p_phone) then
      return query
        select v.id, v.legacy_source_hash from public.visits v
        where v.legacy_source_key is not null
          and public.import_legacy_source_key_canonical(v.legacy_source_key) = v_canon;
      return;
    end if;
  end if;
  return query select v.id, v.legacy_source_hash from public.visits v where v.legacy_source_key = p_key;
end $$;
revoke all on function public.import_legacy_source_match(text, text) from public, anon;
grant execute on function public.import_legacy_source_match(text, text) to authenticated;

create function public.import_legacy_source_ambiguous_reason() returns text
language sql immutable set search_path = '' as $$
  select 'Jejak sumber ganda di riwayat lama: beberapa riwayat tersimpan memakai jejak setara untuk kartu ini (nomor HP ditulis berbeda). Tidak ada yang dipilih atau digabung; periksa riwayat lama secara manual.'::text
$$;
revoke all on function public.import_legacy_source_ambiguous_reason() from public, anon;
grant execute on function public.import_legacy_source_ambiguous_reason() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Impor per baris: kunci identitas DULU, lalu cari jejak (persis atau setara)
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
  v_matches int;
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

  -- Kunci identitas yang sama dengan registrasi klinik (C3b), diambil SEBELUM mencari jejak:
  -- varian jejak setara tidak dijaga indeks unik, jadi hanya kunci ini yang membuat sesi kedua
  -- melihat kunjungan yang baru di-commit sesi pertama.
  perform public.customer_identity_lock(p_phone);

  select count(*)::int, (array_agg(m.visit_id))[1], (array_agg(m.existing_hash))[1]
    into v_matches, v_visit_id, v_existing_hash
  from public.import_legacy_source_match(p_source_key, p_phone) m;
  if v_matches > 1 then
    raise exception using errcode = 'P0001', message = public.import_legacy_source_ambiguous_reason();
  end if;
  if v_visit_id is not null then
    -- Hanya kiriman ulang yang terbukti identik boleh dianggap sudah ada (K1b).
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
-- 4. Impor massal: cari jejak setara di setiap jalur, termasuk jalur pengecualian/balapan
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
  v_matches int;
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

  -- Semua kunci identitas kiriman ini diambil terurut sebelum baris pertama (bebas deadlock). Varian
  -- jejak hanya dicari bila HP jejak = HP baris, jadi kunci ini juga melindungi varian jejaknya.
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
        select count(*)::int, (array_agg(m.visit_id))[1], (array_agg(m.existing_hash))[1]
          into v_matches, v_visit, v_existing_hash
        from public.import_legacy_source_match(v_key, v_row->>'phone') m;
        if v_matches > 1 then
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
            -- Kiriman lain mungkin baru saja menyimpan jejak yang sama/setara. Pernyataan baru memakai
            -- snapshot baru; tetap hanya 'sudah_ada' bila tepat satu kecocokan dengan sidik identik.
            select count(*)::int, (array_agg(m.visit_id))[1], (array_agg(m.existing_hash))[1]
              into v_matches, v_visit, v_existing_hash
            from public.import_legacy_source_match(v_key, v_row->>'phone') m;
            if v_matches > 1 then
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
revoke execute on function public.import_legacy_medical_record_resolved(
  text, text, timestamptz, text, text, text, text, text, text, text, date, text, text, text, text, text, text, uuid, uuid
) from public, anon;
grant execute on function public.import_legacy_medical_record_resolved(
  text, text, timestamptz, text, text, text, text, text, text, text, date, text, text, text, text, text, text, uuid, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Pemeriksaan akhir -- gagal tertutup bila salah satu invarian hilang
-- ---------------------------------------------------------------------------
do $check$
declare d text;
begin
  if public.import_legacy_source_key_canonical('budi::628123456789::snowy::01012026')
       <> public.import_legacy_source_key_canonical('budi::08123456789::snowy::01012026')
     or public.import_legacy_source_key_canonical('budi::00628123456789::snowy::01012026')
       <> 'budi::08123456789::snowy::01012026'
     or public.import_legacy_source_key_canonical('Snowy.xlsx::01012026') <> 'Snowy.xlsx::01012026'
     or public.import_legacy_source_key_canonical('budi::08123456789::snowy::01012026')
       = public.import_legacy_source_key_canonical('budi::08123456789::snowy::02012026') then
    raise exception 'Jejak setara: bentuk kanonik jejak tidak sesuai';
  end if;
  d := pg_get_functiondef('public.import_legacy_medical_record_resolved(text,text,timestamptz,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid)'::regprocedure);
  if position('import_legacy_source_match' in d) = 0 or position('v_matches > 1' in d) = 0
     or position('perform public.customer_identity_lock(p_phone)' in d) = 0
     or position('perform public.customer_identity_lock(p_phone)' in d) > position('import_legacy_source_match' in d)
     or position('v_existing_hash = v_hash' in d) = 0 or position('public.is_admin()' in d) = 0 then
    raise exception 'Jejak setara: impor per baris belum mengunci sebelum mencari jejak setara';
  end if;
  d := pg_get_functiondef('public.import_legacy_medical_records_bulk(jsonb)'::regprocedure);
  if position('legacy_source_key = v_key' in d) > 0
     or (length(d) - length(replace(d, 'import_legacy_source_match', ''))) / length('import_legacy_source_match') <> 2
     or position('v_matches > 1' in d) = 0 or position('customer_identity_lock' in d) = 0
     or position('public.is_admin()' in d) = 0 then
    raise exception 'Jejak setara: simpan massal belum memakai pencarian jejak setara di semua jalur';
  end if;
end $check$;
