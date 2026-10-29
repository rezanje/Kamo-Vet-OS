-- Impor rekam medis lama: satu perjalanan ke database per potongan, bukan satu per baris.
--
-- Laporan Andri (29 Oktober 2026): satu folder 1 GB memakan ~6 jam di browser dan tumbang
-- semalam tanpa satu pun riwayat tersimpan. Penyebab utamanya bukan Excel-nya, melainkan
-- jumlah perjalanan bolak-balik: setiap BARIS memanggil import_legacy_medical_record_resolved
-- sendiri-sendiri, dan setiap pemeriksaan identitas memuat SELURUH tabel pelanggan + anabul.
--
-- Migrasi ini menambah dua fungsi baru dan TIDAK mengubah satu pun fungsi lama:
--   1. import_legacy_identity_scan   -- satu panggilan: mana source_key yang sudah ada, dan
--      SIAPA SAJA calon pemilik/anabul yang relevan untuk potongan ini (bukan seluruh tabel).
--      Hasilnya tetap diputuskan di aplikasi memakai aturan yang sudah teruji, jadi semantik
--      "mirip -> tanya manusia" tidak berubah. Penyaringnya sengaja LEBIH LUAS daripada
--      aturan aplikasi (nama ATAU telepon), jadi tidak mungkin menghilangkan kandidat.
--   2. import_legacy_medical_records_bulk -- menyimpan banyak baris dalam SATU transaksi,
--      dengan memanggil import_legacy_medical_record_resolved per baris di dalamnya. Semantik
--      validasi, pencocokan identitas, dan anti-ganda jadi identik secara konstruksi: kode
--      penyimpanannya memang kode yang sama. Tiap baris dibungkus subtransaksi sendiri, jadi
--      satu baris bermasalah tidak membatalkan 149 baris lainnya -- baris itu dikembalikan
--      sebagai 'ditahan' beserta alasannya.
--
-- Keamanan: keduanya SECURITY INVOKER dengan pemeriksaan peran yang sama seperti fungsi lama
-- (auth.uid() + public.is_admin()). SECURITY DEFINER sengaja TIDAK dipakai: fungsi per baris
-- yang dibungkus bergantung pada RLS pemanggil untuk menulis customers/pets/visits/
-- medical_records, dan menjalankannya sebagai pemilik fungsi akan diam-diam melewati RLS itu.
--
-- Tidak ada data yang diubah saat migrasi. Pra-pemeriksaan Production 29 Okt 2026:
-- 0 visits dengan legacy_source_key (belum ada rekam medis lama yang diimpor sama sekali).

-- ---------------------------------------------------------------------------
-- 1. Kunci normalisasi -- cerminan key()/phoneKey() di aplikasi
-- ---------------------------------------------------------------------------
-- key(): rapatkan spasi -> trim -> buang ':' di depan -> huruf kecil -> buang '.' dan ':'.
create function public.import_legacy_text_key(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
    replace(replace(
      lower(regexp_replace(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), '^:\s*', '')),
      '.', ''), ':', ''),
    '\s+', ' ', 'g')
$$;

create function public.import_legacy_phone_key(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(p, ''), '\D', '', 'g')
$$;

grant execute on function public.import_legacy_text_key(text) to authenticated;
grant execute on function public.import_legacy_phone_key(text) to authenticated;

-- Penyaring calon identitas berjalan per potongan impor; tanpa indeks ini setiap potongan
-- memindai penuh tabel pelanggan yang akan tumbuh ribuan baris selama impor berlangsung.
create index if not exists customers_import_name_key_idx
  on public.customers (public.import_legacy_text_key(name));
create index if not exists customers_import_phone_key_idx
  on public.customers (public.import_legacy_phone_key(phone));
-- Anabul calon diambil lewat pets_customer_id_idx yang sudah ada; tidak perlu indeks baru.

-- ---------------------------------------------------------------------------
-- 2. Pemindaian identitas + riwayat yang sudah ada -- satu panggilan per potongan
-- ---------------------------------------------------------------------------
create function public.import_legacy_identity_scan(
  p_source_keys text[],
  p_owner_keys text[],
  p_phone_keys text[]
) returns jsonb
language plpgsql
security invoker
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_sources text[] := coalesce(p_source_keys, array[]::text[]);
  v_owners text[] := coalesce(p_owner_keys, array[]::text[]);
  v_phones text[] := coalesce(p_phone_keys, array[]::text[]);
  v_sudah_ada jsonb;
  v_customers jsonb;
  v_pets jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Hanya OWNER/ADMIN yang boleh mengimpor rekam medis';
  end if;
  if array_length(v_sources, 1) > 1000 or array_length(v_owners, 1) > 1000 or array_length(v_phones, 1) > 1000 then
    raise exception 'Terlalu banyak kunci dalam satu pemeriksaan impor';
  end if;

  select coalesce(jsonb_agg(v.legacy_source_key), '[]'::jsonb) into v_sudah_ada
  from public.visits v
  where v.legacy_source_key = any(v_sources);

  -- Calon pemilik: nama ATAU telepon cocok. Penyaring ini superset dari aturan aplikasi,
  -- jadi tidak ada kandidat klarifikasi yang hilang. Anabul diambil hanya untuk calon itu.
  with calon as (
    select c.id, c.name, c.phone
    from public.customers c
    where public.import_legacy_text_key(c.name) = any(v_owners)
       or public.import_legacy_phone_key(c.phone) = any(v_phones)
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'phone', k.phone)) from calon k), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'customer_id', p.customer_id, 'name', p.name))
              from public.pets p where p.customer_id in (select id from calon)), '[]'::jsonb)
  into v_customers, v_pets;

  return jsonb_build_object('sudah_ada', v_sudah_ada, 'customers', v_customers, 'pets', v_pets);
end;
$$;

revoke all on function public.import_legacy_identity_scan(text[], text[], text[]) from public, anon;
grant execute on function public.import_legacy_identity_scan(text[], text[], text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Simpan massal -- satu transaksi, satu perjalanan, status per baris
-- ---------------------------------------------------------------------------
create function public.import_legacy_medical_records_bulk(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_row jsonb;
  v_key text;
  v_visit uuid;
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

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_key := btrim(coalesce(v_row->>'source_key', ''));
    v_visit := null;
    v_reason := null;
    if v_key = '' then
      v_status := 'ditahan';
      v_reason := 'Jejak sumber wajib diisi';
    else
      select v.id into v_visit from public.visits v where v.legacy_source_key = v_key;
      if v_visit is not null then
        v_status := 'sudah_ada';
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
          -- Dua kiriman berbarengan: yang kalah di indeks unik menemukan barisnya sudah ada.
          -- Statement baru di transaksi ini memakai snapshot baru, jadi commit lawan terlihat.
          select v.id into v_visit from public.visits v where v.legacy_source_key = v_key;
          if v_visit is not null then
            v_status := 'sudah_ada';
          else
            v_status := 'ditahan';
            v_reason := sqlerrm;
          end if;
        end;
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

-- ---------------------------------------------------------------------------
-- 4. Pemeriksaan akhir -- gagal tertutup bila salah satu invarian hilang
-- ---------------------------------------------------------------------------
do $check$
declare d text;
begin
  d := pg_get_functiondef('public.import_legacy_medical_records_bulk(jsonb)'::regprocedure);
  if position('public.import_legacy_medical_record_resolved(' in d) = 0 then
    raise exception 'Simpan massal tidak memakai fungsi impor per baris yang sudah teruji';
  end if;
  if position('public.is_admin()' in d) = 0 then
    raise exception 'Simpan massal tidak memeriksa peran OWNER/ADMIN';
  end if;
  if position('legacy_source_key = v_key' in d) = 0 then
    raise exception 'Simpan massal tidak memeriksa riwayat yang sudah ada';
  end if;
  d := pg_get_functiondef('public.import_legacy_medical_record_resolved(text,text,timestamptz,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid)'::regprocedure);
  if position('legacy_source_key = p_source_key' in d) = 0 then
    raise exception 'Fungsi impor per baris berubah; penjaga anti-ganda hilang';
  end if;
  if position('public.is_admin()' in d) = 0 then
    raise exception 'Fungsi impor per baris berubah; pemeriksaan peran hilang';
  end if;
  d := pg_get_functiondef('public.import_legacy_identity_scan(text[],text[],text[])'::regprocedure);
  if position('public.is_admin()' in d) = 0 then
    raise exception 'Pemindaian identitas tidak memeriksa peran OWNER/ADMIN';
  end if;
end $check$;
