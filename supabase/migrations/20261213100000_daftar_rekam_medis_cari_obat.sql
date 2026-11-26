-- Daftar Klinik > Rekam medis: filter "Obat / produk diberikan" (Andri 26 Nov 2026: "rekam medis yang bisa dicari
-- berdasarkan pemberian obat, misal RC Recovery").
--
-- Perubahan: `public.daftar_rekam_medis_halaman` mendapat parameter ketujuh `p_obat text default null`.
--   * Tanda tangan lama (uuid,text,text,uuid,integer,integer) DIGANTI oleh tanda tangan baru (+ text default null).
--     Dua overload dengan nama sama membuat PostgREST ambigu, jadi tanda tangan lama dihapus; panggilan aplikasi LAMA
--     (6 argumen bernama) tetap jalan karena parameter baru punya default null. Tanpa p_obat hasilnya IDENTIK bit demi bit
--     dengan fungsi sebelumnya (tidak ada kunci baru di JSON; dibuktikan diferensial di uji native).
--   * SECURITY INVOKER + STABLE + search_path kosong tetap: RLS pemanggil berlaku persis seperti SELECT biasa (cabang,
--     impor, Admin Online ditolak oleh pagar tabel yang sudah ada). Tidak ada tabel/kolom/indeks baru.
--
-- Aturan filter p_obat (didokumentasikan; app menampilkan teks yang sama):
--   * Tanpa beda huruf besar/kecil dan tanpa beda aksen (translate terhadap huruf beraksen umum; ekstensi unaccent tidak
--     dipasang). Pencocokan memakai strpos, jadi % dan _ bukan wildcard.
--   * Koma memisahkan PRODUK: "rc recovery, icare" = kunjungan yang punya KEDUANYA (setiap istilah harus cocok dengan minimal
--     satu baris produk di kunjungan itu; baris boleh berbeda). Spasi di dalam satu istilah = SEMUA kata harus ada pada
--     nama produk yang SAMA, urutan bebas ("recovery rc" = "rc recovery").
--   * Panjang total <= 100 huruf, tiap istilah >= 2 huruf, <= 5 istilah. Melanggar = exception 22023 (aplikasi menampilkan
--     galat, tidak pernah daftar kosong). Kosong / hanya spasi atau koma = tidak ada filter.
--   * Sumber teks yang dicari (satu kunjungan = satu atau lebih rekam medis):
--       1. baris resep `prescription_items` yang BELUM ditarik dari rekam medis (record_withdrawn_at is null). Baris yang
--          hanya ditarik dari tagihan (billing_withdrawn_at) tetap ada di rekam medis, jadi tetap dicari. Semua jenis baris
--          (obat, jasa, racikan) ikut. Baris bertaut master produk dicari lewat NAMA MASTER `items.name` (item_id, berindeks;
--          nama_obat sama dengan nama master pada 6.524 dari 6.524 baris hosted); baris tanpa master (racikan, input manual)
--          lewat `nama_obat`. Nama racikan dicari (mis. "Obat Racik Kapsul Antibiotic"), ISI racikan
--          (compounding_ingredients) TIDAK dicari: membacanya lewat RLS menambah >0,7 dtk (dicatat sebagai batasan).
--       2. baris tagihan kunjungan itu yang TIDAK bertaut ke baris resep (produk yang dijual kasir saat kunjungan):
--          nama master (item_id) atau `invoice_items.deskripsi` (tanpa master), hanya dari invoice yang tidak dibatalkan
--          (voided_at is null). Baris tagihan yang bertaut ke baris resep tidak dihitung dua kali.
--   * Digabung dengan p_cari (pemilik/telepon/hewan), p_cabang, p_tampilan, p_pet: semuanya harus terpenuhi.
--   * Ringkasan (riwayat/hewan/impor) tetap menghitung lingkup SEBELUM p_cari/p_obat, sama seperti p_cari.
--   * Bila p_obat diisi, tiap baris hasil mendapat kunci `obat_cocok`: [{nama, qty, sumber}] (sumber: resep | racikan |
--     tagihan; qty dijumlah per produk; maksimal 20 per kunjungan) supaya pengguna tahu mengapa kunjungan itu cocok.
--
-- Kinerja (hosted, OWNER semua cabang, 9,6 ribu kunjungan; ukuran di PROGRESS.md): daftar TANPA filter sudah ±2,3 dtk karena RLS
-- per baris (tidak berubah oleh migrasi ini); filter menambah ±0,5 dtk. Pencarian masuk lewat items (kecil, terbuka) lalu
-- indeks prescription_items_item_id_idx / invoice_items_item_id_idx, supaya RLS berantai hanya dihitung untuk baris kandidat.
-- Tanpa indeks baru: indeks trigram tidak membantu karena RLS dievaluasi lebih dulu dari strpos (tidak leakproof).
--
-- Pasang sebagai SATU transaksi (berkas ini tidak punya begin/commit sendiri). ROLLBACK.sql ada di folder bukti.

do $pra$
begin
  if to_regclass('public.visits') is null or to_regclass('public.medical_records') is null
     or to_regclass('public.prescription_items') is null or to_regclass('public.items') is null
     or to_regclass('public.invoices') is null or to_regclass('public.invoice_items') is null
     or to_regclass('public.inpatient_records') is null
     or to_regclass('public.pets') is null or to_regclass('public.customers') is null or to_regclass('public.branches') is null then
    raise exception 'DAFTAR_REKAM_MEDIS_OBAT: tabel prasyarat tidak lengkap';
  end if;
  if exists (select 1 from pg_proc where proname = 'daftar_rekam_medis_halaman' and pronamespace = 'public'::regnamespace
             and oid not in (coalesce(to_regprocedure('public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer)'), 0),
                             coalesce(to_regprocedure('public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer,text)'), 0))) then
    raise exception 'DAFTAR_REKAM_MEDIS_OBAT: ada overload lain dengan nama yang sama';
  end if;
  if to_regprocedure('public.daftar_rekam_medis(uuid)') is null then
    raise exception 'DAFTAR_REKAM_MEDIS_OBAT: fungsi lama daftar_rekam_medis(uuid) harus tetap ada';
  end if;
  if to_regprocedure('public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer)') is null
     and to_regprocedure('public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer,text)') is null then
    raise exception 'DAFTAR_REKAM_MEDIS_OBAT: daftar_rekam_medis_halaman belum ada (migrasi 20261109100000 wajib lebih dulu)';
  end if;
end $pra$;

drop function if exists public.daftar_rekam_medis_halaman(uuid, text, text, uuid, integer, integer);

create or replace function public.daftar_rekam_medis_halaman(
  p_cabang uuid default null,
  p_cari text default null,
  p_tampilan text default 'semua',
  p_pet uuid default null,
  p_batas integer default 50,
  p_offset integer default 0,
  p_obat text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_cari text := nullif(lower(btrim(coalesce(p_cari, ''))), '');
  v_obat_mentah text := nullif(btrim(coalesce(p_obat, '')), '');
  v_istilah text[];
  v_item_ids uuid[];
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
  if length(v_obat_mentah) > 100 then
    raise exception using errcode = '22023', message = 'DAFTAR_REKAM_MEDIS_HALAMAN: kata cari obat terlalu panjang';
  end if;
  if v_obat_mentah is not null then
    -- Istilah dipisah koma; dinormalkan (huruf kecil, tanpa aksen, spasi tunggal); istilah kosong dibuang.
    select array_agg(t order by n) into v_istilah
      from (select btrim(regexp_replace(lower(translate(x,
                    'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
                    'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')), '\s+', ' ', 'g')) as t, n
              from unnest(string_to_array(v_obat_mentah, ',')) with ordinality as u(x, n)) s
     where t <> '';
    if v_istilah is not null then
      if array_length(v_istilah, 1) > 5 then
        raise exception using errcode = '22023', message = 'DAFTAR_REKAM_MEDIS_HALAMAN: maksimal 5 obat per pencarian';
      end if;
      if exists (select 1 from unnest(v_istilah) t where length(t) < 2) then
        raise exception using errcode = '22023', message = 'DAFTAR_REKAM_MEDIS_HALAMAN: kata cari obat minimal 2 huruf';
      end if;
      -- Master produk yang namanya cocok dengan SALAH SATU istilah (tabel items kecil dan terbuka). Dipakai sebagai pintu
      -- masuk berindeks (item_id) ke baris resep/tagihan, supaya pencarian tidak memindai seluruh tabel anak lewat RLS.
      select array_agg(it.id) into v_item_ids
        from public.items it
       where it.name is not null
         and exists (select 1 from unnest(v_istilah) t
                      where not exists (select 1 from unnest(regexp_split_to_array(t, ' ')) w
                                         where strpos(lower(translate(it.name, 'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
                                  'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')), w) = 0));
    end if;
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
    ), istilah as (
      select u.n::integer as n, regexp_split_to_array(u.t, ' ') as kata
        from unnest(coalesce(v_istilah, array[]::text[])) with ordinality as u(t, n)
    ), saring0 as materialized (
      select l.* from lingkup l
       where (p_tampilan = 'semua'
              or not exists (select 1 from public.inpatient_records i where i.visit_id = l.id and i.discharged_at is null))
         and (v_cari is null
              or exists (select 1 from public.customers c where c.id = l.customer_id
                           and (strpos(lower(coalesce(c.name, '')), v_cari) > 0 or strpos(lower(coalesce(c.phone, '')), v_cari) > 0))
              or exists (select 1 from public.pets p where p.id = l.pet_id and strpos(lower(coalesce(p.name, '')), v_cari) > 0))
    ), bahan as materialized (
      -- Teks yang dicari, satu baris per baris produk (kolom `f` sudah dinormalkan). Hanya kunjungan yang lolos saringan lain.
      select x.visit_id, x.kunci, x.sumber, x.nama, x.qty, x.f
        from (
          -- 1. resep yang bertaut ke master produk cocok: nama master (nama_obat sama dengan nama master pada seluruh data hosted).
          select m.visit_id, 'p:' || pi.id::text as kunci,
                 case when pi.compound_recipe_id is null then 'resep' else 'racikan' end as sumber,
                 coalesce(nullif(btrim(pi.nama_obat), ''), it.name) as nama, pi.qty::numeric as qty,
                 lower(translate(it.name, 'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
                                  'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')) as f
            from public.prescription_items pi
            join public.items it on it.id = pi.item_id
            join public.medical_records m on m.id = pi.medical_record_id
           where v_istilah is not null and pi.item_id = any(coalesce(v_item_ids, array[]::uuid[]))
             and pi.record_withdrawn_at is null
          union all
          -- 2. resep tanpa master produk (racikan, input manual): nama_obat.
          select m.visit_id, 'p:' || pi.id::text,
                 case when pi.compound_recipe_id is null then 'resep' else 'racikan' end,
                 coalesce(nullif(btrim(pi.nama_obat), ''), '-'), pi.qty::numeric,
                 lower(translate(pi.nama_obat, 'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
                                  'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC'))
            from public.prescription_items pi
            join public.medical_records m on m.id = pi.medical_record_id
           where v_istilah is not null and pi.item_id is null and pi.record_withdrawn_at is null
             and pi.nama_obat is not null
          union all
          -- 3. tagihan kunjungan yang TIDAK bertaut ke baris resep (dijual kasir saat kunjungan), invoice tidak dibatalkan:
          --    3a. lewat master produk yang cocok, 3b. baris tagihan tanpa master (hanya deskripsi).
          select inv.visit_id, 'i:' || ii.id::text, 'tagihan',
                 coalesce(nullif(btrim(ii.deskripsi), ''), it.name), ii.qty::numeric, lower(translate(it.name, 'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
                                  'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC'))
            from (select i0.id, i0.invoice_id, i0.item_id, i0.deskripsi, i0.qty from public.invoice_items i0
                   where v_istilah is not null and i0.item_id = any(coalesce(v_item_ids, array[]::uuid[]))
                     and i0.prescription_item_id is null and i0.compound_recipe_id is null offset 0) ii
            join public.items it on it.id = ii.item_id
            join public.invoices inv on inv.id = ii.invoice_id
           where inv.voided_at is null
          union all
          select inv.visit_id, 'i:' || ii.id::text, 'tagihan',
                 coalesce(nullif(btrim(ii.deskripsi), ''), '-'), ii.qty::numeric, lower(translate(ii.deskripsi, 'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ',
                                  'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC'))
            from (select i0.id, i0.invoice_id, i0.deskripsi, i0.qty from public.invoice_items i0
                   where v_istilah is not null and i0.item_id is null and i0.deskripsi is not null
                     and i0.prescription_item_id is null and i0.compound_recipe_id is null offset 0) ii
            join public.invoices inv on inv.id = ii.invoice_id
           where inv.voided_at is null
        ) x
       where x.f is not null
    ), cocok as materialized (
      select b.visit_id, b.kunci, b.sumber, b.nama, b.qty, i.n
        from bahan b
        join istilah i on not exists (select 1 from unnest(i.kata) w where strpos(b.f, w) = 0)
    ), lengkap as materialized (
      -- Kunjungan yang punya baris cocok untuk SETIAP istilah.
      select c.visit_id from cocok c
       group by c.visit_id having count(distinct c.n) = (select count(*) from istilah)
    ), saring as materialized (
      select s.* from saring0 s
       where v_istilah is null or s.id in (select g.visit_id from lengkap g)
    ), kena as (
      -- Satu baris per baris produk yang cocok (istilah ganda dilipat), lalu dijumlah per produk.
      select c.visit_id, c.sumber, c.nama, sum(c.qty) as qty
        from (select distinct c0.visit_id, c0.kunci, c0.sumber, c0.nama, c0.qty from cocok c0) c
       group by c.visit_id, c.sumber, c.nama
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
        select jsonb_agg((jsonb_build_object(
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
        ) || case when v_istilah is null then '{}'::jsonb else jsonb_build_object('obat_cocok', coalesce((
                select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('nama', k.nama, 'qty', k.qty, 'sumber', k.sumber))
                                 order by k.nama, k.sumber)
                  from (select k0.* from kena k0 where k0.visit_id = h.id order by k0.nama, k0.sumber limit 20) k), '[]'::jsonb))
             end) order by h.created_at desc, h.id) from halaman h), '[]'::jsonb)
    )
  );
end
$$;

revoke all on function public.daftar_rekam_medis_halaman(uuid, text, text, uuid, integer, integer, text) from public, anon;
grant execute on function public.daftar_rekam_medis_halaman(uuid, text, text, uuid, integer, integer, text) to authenticated;

do $pasca$
declare v record;
begin
  select p.prosecdef, p.provolatile, p.proconfig into v from pg_proc p
   where p.oid = 'public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer,text)'::regprocedure;
  if v.prosecdef or v.provolatile <> 's' or v.proconfig is distinct from array['search_path=""']
     or has_function_privilege('anon', 'public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer,text)', 'execute') then
    raise exception 'DAFTAR_REKAM_MEDIS_OBAT: pasca-cek gagal';
  end if;
  if to_regprocedure('public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer)') is not null then
    raise exception 'DAFTAR_REKAM_MEDIS_OBAT: tanda tangan lama masih ada (overload ambigu)';
  end if;
  if (select count(*) from pg_proc where proname = 'daftar_rekam_medis_halaman' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'DAFTAR_REKAM_MEDIS_OBAT: jumlah overload bukan 1';
  end if;
  if to_regprocedure('public.daftar_rekam_medis(uuid)') is null then
    raise exception 'DAFTAR_REKAM_MEDIS_OBAT: fungsi lama hilang';
  end if;
end $pasca$;
