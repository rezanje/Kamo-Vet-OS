-- Impor Bagan Akun (Andri 3632): satu pintu simpan yang berwenang dan atomik.
--
-- Sebelumnya layar /pengaturan/impor/akun menulis langsung ke coa_accounts: insert semua akun,
-- lalu penautan induk satu per satu tanpa memeriksa hasilnya. Kalau penautan gagal, akun sudah
-- terlanjur masuk tanpa induk dan layar tetap melaporkan berhasil. Validasinya pun lebih longgar
-- dari layar Akun Perkiraan (kode bebas, induk tidak dicek header/kelompok/siklus).
--
-- Di sini:
--   read_coa_import_context()       — daftar akun + pemakaian + sidik jari (versi) untuk pratinjau.
--   import_coa_accounts(rows, versi) — mengulang SEMUA pemeriksaan di database, lalu insert, ubah,
--                                      dan tautkan induk dalam satu transaksi. Satu kegagalan =
--                                      tidak ada yang tersimpan.
-- Keduanya hanya untuk OWNER/ADMIN aktif dengan sesi login asli. Tidak menulis saldo, jurnal,
-- stok, atau tabel lain selain coa_accounts.

-- 0. Tulis langsung ke coa_accounts (layar Akun Perkiraan, rekening kas/bank) kini juga mensyaratkan
--    profil AKTIF — sama dengan penjaga master di aplikasi. Baca tetap terbuka (coa_read).
drop policy if exists coa_write on public.coa_accounts;
create policy coa_write on public.coa_accounts for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('OWNER', 'ADMIN')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('OWNER', 'ADMIN')));

-- 1. Kode yang dipakai keras oleh program. HARUS sama dengan KODE_SISTEM di src/lib/coa-sistem.ts
--    (dikunci tes src/lib/__tests__/impor-akun.test.ts).
create or replace function public.coa_import_system_codes() returns text[]
language sql immutable set search_path = '' as $$
  select array['1101','1102','1105','1201','1202','1203','1301','1303','1501','1509','2101','2102','2103','2201',
    '3101','3201','4101','4102','4201','4301','4302','4303','5101','5201','5301','5302','5303','5304','5305',
    '5401','5501','5601','5602','5901','5902']::text[]
$$;
revoke all on function public.coa_import_system_codes() from public, anon, authenticated, service_role;

create or replace function public.coa_import_assert_actor() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'COA_IMPORT_ACCESS_DENIED: Hanya OWNER/ADMIN aktif yang boleh mengimpor bagan akun.' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = auth.uid() and is_active and role in ('OWNER', 'ADMIN') for share;
  if not found then
    raise exception 'COA_IMPORT_ACCESS_DENIED: Hanya OWNER/ADMIN aktif yang boleh mengimpor bagan akun.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.coa_import_assert_actor() from public, anon, authenticated, service_role;

-- Sidik jari seluruh bagan akun (termasuk induknya). Berubah sedikit saja → pratinjau dianggap basi.
create or replace function public.coa_import_version() returns text
language sql stable security definer set search_path = '' as $$
  select md5(coalesce(string_agg(concat_ws('|', a.code, a.name, a.type, a.normal_balance, a.is_header::text,
    a.is_active::text, coalesce(p.code, '')), E'\n' order by a.code), ''))
  from public.coa_accounts a left join public.coa_accounts p on p.id = a.parent_id
$$;
revoke all on function public.coa_import_version() from public, anon, authenticated, service_role;

-- Pemakaian akun, sama dengan pemakaiAkun() di keuangan/coa/actions.ts (jurnal, rekening kas/bank,
-- kategori aset, jurnal berulang aktif).
create or replace function public.coa_import_usage()
returns table(code text, jurnal integer, rekening_kas boolean, kategori_aset boolean, jurnal_berulang boolean)
language sql stable security definer set search_path = '' as $$
  select a.code::text,
    case when exists (select 1 from public.journal_lines l where l.account_id = a.id) then 1 else 0 end,
    exists (select 1 from public.cash_accounts c where c.coa_code = a.code),
    exists (select 1 from public.asset_categories k where k.akun_beban = a.code or k.akun_akumulasi = a.code),
    exists (select 1 from public.recurring_journals r
      cross join lateral jsonb_array_elements(case when jsonb_typeof(r.lines) = 'array' then r.lines else '[]'::jsonb end) e
      where r.is_active and e ->> 'code' = a.code)
  from public.coa_accounts a
$$;
revoke all on function public.coa_import_usage() from public, anon, authenticated, service_role;

-- 2. Bahan pratinjau. Gagal dibaca = error, bukan daftar kosong.
create or replace function public.read_coa_import_context() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.coa_import_assert_actor();
  return jsonb_build_object(
    'versi', public.coa_import_version(),
    'akun', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'type', a.type,
      'normal_balance', a.normal_balance, 'is_header', a.is_header, 'is_active', a.is_active, 'parent_id', a.parent_id)
      order by a.code) from public.coa_accounts a), '[]'::jsonb),
    'pemakaian', coalesce((select jsonb_object_agg(u.code, jsonb_build_object('jurnal', u.jurnal, 'rekeningKas', u.rekening_kas,
      'kategoriAset', u.kategori_aset, 'jurnalBerulang', u.jurnal_berulang))
      from public.coa_import_usage() u
      where u.jurnal > 0 or u.rekening_kas or u.kategori_aset or u.jurnal_berulang), '{}'::jsonb));
end $$;
revoke all on function public.read_coa_import_context() from public, anon, service_role;
grant execute on function public.read_coa_import_context() to authenticated;

-- 3. Simpan. p_rows: [{code,name,type,normal_balance,is_header,is_active|null,set_parent,parent_code|null}]
create or replace function public.import_coa_accounts(p_rows jsonb, p_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sys text[] := public.coa_import_system_codes();
  v_bad text;
  v_parent text;
  v_created integer := 0;
  v_updated integer := 0;
  v_same integer := 0;
begin
  perform public.coa_import_assert_actor();

  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception 'COA_IMPORT_INVALID: Data impor harus berisi 1 sampai 1000 akun.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) v
    where jsonb_typeof(v) is distinct from 'object'
      or jsonb_typeof(v -> 'code') is distinct from 'string'
      or jsonb_typeof(v -> 'name') is distinct from 'string'
      or jsonb_typeof(v -> 'type') is distinct from 'string'
      or jsonb_typeof(v -> 'normal_balance') is distinct from 'string'
      or jsonb_typeof(v -> 'is_header') is distinct from 'boolean'
      or coalesce(jsonb_typeof(v -> 'is_active'), 'null') not in ('boolean', 'null')
      or coalesce(jsonb_typeof(v -> 'set_parent'), 'null') not in ('boolean', 'null')
      or coalesce(jsonb_typeof(v -> 'parent_code'), 'null') not in ('string', 'null')) then
    raise exception 'COA_IMPORT_INVALID: Bentuk data impor tidak dikenal.' using errcode = '22023';
  end if;

  -- Satu impor pada satu waktu; selama berjalan tidak ada akun, jurnal, rekening kas/bank,
  -- kategori aset atau jurnal berulang yang berubah, jadi pemeriksaan di bawah tetap benar.
  lock table public.coa_accounts in share row exclusive mode;
  lock table public.journal_lines, public.cash_accounts, public.asset_categories, public.recurring_journals in share mode;

  if p_version is null or p_version <> public.coa_import_version() then
    raise exception 'COA_IMPORT_STALE: Bagan akun sudah berubah sejak pratinjau dibuat. Periksa ulang file sebelum menyimpan.'
      using errcode = '55000';
  end if;

  drop table if exists pg_temp.coa_import_rows;
  create temp table coa_import_rows (
    ord bigint primary key, code text not null, name text not null, type text not null, normal_balance text not null,
    is_header boolean not null, is_active boolean, set_parent boolean not null, parent_code text,
    is_new boolean not null default true, account_id uuid,
    old_name text, old_type text, old_normal text, old_header boolean, old_active boolean, old_parent_code text,
    jurnal boolean not null default false, rekening_kas boolean not null default false,
    kategori_aset boolean not null default false, jurnal_berulang boolean not null default false,
    changed boolean not null default false
  ) on commit drop;

  insert into pg_temp.coa_import_rows(ord, code, name, type, normal_balance, is_header, is_active, set_parent, parent_code)
  select e.ord, e.v ->> 'code', e.v ->> 'name', e.v ->> 'type', e.v ->> 'normal_balance', (e.v ->> 'is_header')::boolean,
    (e.v ->> 'is_active')::boolean, coalesce((e.v ->> 'set_parent')::boolean, false), e.v ->> 'parent_code'
  from jsonb_array_elements(p_rows) with ordinality e(v, ord);

  -- Isian per baris. Kode tidak pernah dirapikan di sini: yang tidak persis dipakai apa adanya ditolak.
  select code into v_bad from pg_temp.coa_import_rows
  where code = '' or code <> btrim(code) or length(code) > 12
    or name = '' or name <> btrim(name) or length(name) > 80
    or type not in ('ASET', 'LIABILITAS', 'EKUITAS', 'PENDAPATAN', 'BEBAN') or normal_balance not in ('D', 'K')
    or (parent_code is not null and (parent_code = '' or parent_code <> btrim(parent_code)))
    or (not set_parent and parent_code is not null)
  order by ord limit 1;
  if found then
    raise exception 'COA_IMPORT_INVALID: Baris akun "%" tidak valid (kode, nama, tipe atau saldo normal).', v_bad using errcode = '22023';
  end if;

  select code into v_bad from pg_temp.coa_import_rows group by code having count(*) > 1 order by code limit 1;
  if found then
    raise exception 'COA_IMPORT_DUPLICATE: Kode % muncul lebih dari sekali di file.', v_bad using errcode = '23505';
  end if;

  update pg_temp.coa_import_rows r set is_new = false, account_id = a.id,
    old_name = a.name, old_type = a.type, old_normal = a.normal_balance, old_header = a.is_header,
    old_active = a.is_active, old_parent_code = p.code,
    jurnal = u.jurnal > 0, rekening_kas = u.rekening_kas, kategori_aset = u.kategori_aset, jurnal_berulang = u.jurnal_berulang
  from public.coa_accounts a
  left join public.coa_accounts p on p.id = a.parent_id
  join public.coa_import_usage() u on u.code = a.code
  where a.code = r.code;

  -- Akun baru: kontrak kode KAMO (4–6 angka, digit pertama = kelompok, bukan jatah rekening
  -- kas/bank 1103–1199, bukan kode sistem) dan sisi saldo laba-rugi yang wajar.
  select code into v_bad from pg_temp.coa_import_rows
  where is_new and case when code ~ '^[1-5][0-9]{3,5}$' then
      type <> (case left(code, 1) when '1' then 'ASET' when '2' then 'LIABILITAS' when '3' then 'EKUITAS'
                                  when '4' then 'PENDAPATAN' else 'BEBAN' end)
      or code::integer between 1103 and 1199
      or code = any(v_sys)
    else true end
  order by ord limit 1;
  if found then
    raise exception 'COA_IMPORT_CODE: Kode % tidak cocok dengan kontrak kode akun KAMO; kode tidak diubah otomatis.', v_bad using errcode = '22023';
  end if;

  select code into v_bad from pg_temp.coa_import_rows
  where (is_new or type <> old_type or normal_balance <> old_normal)
    and ((type = 'PENDAPATAN' and normal_balance <> 'K') or (type = 'BEBAN' and normal_balance <> 'D'))
  order by ord limit 1;
  if found then
    raise exception 'COA_IMPORT_INVALID: Akun % — kelompok laba-rugi harus bersaldo normal wajar.', v_bad using errcode = '22023';
  end if;

  -- Akun lama: kelompok & saldo normal terkunci untuk akun berjurnal/sistem/rekening/aset/berulang.
  select code into v_bad from pg_temp.coa_import_rows
  where not is_new and (type <> old_type or normal_balance <> old_normal)
    and (jurnal or code = any(v_sys) or rekening_kas or kategori_aset or jurnal_berulang)
  order by ord limit 1;
  if found then
    raise exception 'COA_IMPORT_PROTECTED: Kelompok/saldo normal akun % tidak boleh diubah lewat impor (akun sistem, berjurnal atau terpakai).', v_bad
      using errcode = '42501';
  end if;

  select code into v_bad from pg_temp.coa_import_rows
  where not is_new and type <> old_type
    and type <> (case left(code, 1) when '1' then 'ASET' when '2' then 'LIABILITAS' when '3' then 'EKUITAS'
                                    when '4' then 'PENDAPATAN' when '5' then 'BEBAN' else '' end)
  order by ord limit 1;
  if found then
    raise exception 'COA_IMPORT_CODE: Kelompok akun % harus sesuai digit pertama kodenya.', v_bad using errcode = '22023';
  end if;

  select code into v_bad from pg_temp.coa_import_rows where not is_new and name <> old_name and rekening_kas order by ord limit 1;
  if found then
    raise exception 'COA_IMPORT_PROTECTED: Akun % adalah akun rekening kas/bank — ganti namanya dari menu Kas & Bank.', v_bad using errcode = '42501';
  end if;

  select code into v_bad from pg_temp.coa_import_rows
  where not is_new and is_active is false and old_active
    and (code = any(v_sys) or rekening_kas or kategori_aset or jurnal_berulang)
  order by ord limit 1;
  if found then
    raise exception 'COA_IMPORT_PROTECTED: Akun % masih dipakai (sistem, rekening, kategori aset atau jurnal berulang) dan tidak boleh dinonaktifkan.', v_bad
      using errcode = '42501';
  end if;

  select code into v_bad from pg_temp.coa_import_rows where is_header and jurnal order by ord limit 1;
  if found then
    raise exception 'COA_IMPORT_PARENT: Akun % sudah dipakai jurnal, jadi tidak bisa menjadi akun induk.', v_bad using errcode = '23514';
  end if;

  select r.code, r.parent_code into v_bad, v_parent from pg_temp.coa_import_rows r
  where r.set_parent and r.parent_code is not null
    and not exists (select 1 from public.coa_accounts a where a.code = r.parent_code)
    and not exists (select 1 from pg_temp.coa_import_rows f where f.code = r.parent_code)
  order by r.ord limit 1;
  if found then
    raise exception 'COA_IMPORT_PARENT: Induk % untuk akun % tidak ada di file maupun di bagan akun.', v_parent, v_bad using errcode = '23503';
  end if;

  update pg_temp.coa_import_rows set changed = not is_new and (
    name <> old_name or type <> old_type or normal_balance <> old_normal or is_header <> old_header
    or (is_active is not null and is_active <> old_active)
    or (set_parent and parent_code is distinct from old_parent_code));
  select count(*) filter (where is_new), count(*) filter (where changed), count(*) filter (where not is_new and not changed)
    into v_created, v_updated, v_same from pg_temp.coa_import_rows;

  -- Tulis: akun baru (tanpa induk dulu), perubahan akun lama, lalu penautan induk.
  insert into public.coa_accounts(code, name, type, normal_balance, is_header, is_active)
  select code, name, type, normal_balance, is_header, coalesce(is_active, true) from pg_temp.coa_import_rows where is_new order by ord;

  update pg_temp.coa_import_rows r set account_id = a.id from public.coa_accounts a where r.is_new and a.code = r.code;

  update public.coa_accounts a set name = r.name, type = r.type, normal_balance = r.normal_balance,
    is_header = r.is_header, is_active = coalesce(r.is_active, a.is_active)
  from pg_temp.coa_import_rows r
  where r.changed and a.id = r.account_id
    and (a.name, a.type, a.normal_balance, a.is_header, a.is_active)
      is distinct from (r.name, r.type, r.normal_balance, r.is_header, coalesce(r.is_active, a.is_active));

  update public.coa_accounts a set parent_id = p.id
  from pg_temp.coa_import_rows r
  left join public.coa_accounts p on p.code = r.parent_code
  where r.set_parent and a.id = r.account_id and a.parent_id is distinct from p.id;

  -- Pemeriksaan akhir atas keadaan sesudah tulis (gagal = seluruh impor batal).
  select c.code into v_bad
  from public.coa_accounts c join public.coa_accounts p on p.id = c.parent_id
  where (c.id in (select account_id from pg_temp.coa_import_rows) or p.id in (select account_id from pg_temp.coa_import_rows))
    and c.id <> p.id and (not p.is_header or p.type <> c.type)
  order by c.code limit 1;
  if found then
    raise exception 'COA_IMPORT_PARENT: Induk akun % harus akun induk (header) dengan kelompok yang sama.', v_bad using errcode = '23514';
  end if;

  select a.code into v_bad from public.coa_accounts a
  where a.id in (select account_id from pg_temp.coa_import_rows) and not a.is_header
    and exists (select 1 from public.coa_accounts c where c.parent_id = a.id and c.id <> a.id)
  order by a.code limit 1;
  if found then
    raise exception 'COA_IMPORT_PARENT: Akun % masih punya akun rincian, jadi harus tetap akun induk.', v_bad using errcode = '23514';
  end if;

  with recursive naik(asal, kini, lewat, melingkar) as (
    select a.id, a.parent_id, array[a.id], false
    from public.coa_accounts a
    where a.id in (select account_id from pg_temp.coa_import_rows) and a.parent_id is not null
    union all
    select n.asal, p.parent_id, n.lewat || n.kini, n.kini = any(n.lewat)
    from naik n join public.coa_accounts p on p.id = n.kini
    where not n.melingkar
  )
  select a.code into v_bad from naik n join public.coa_accounts a on a.id = n.asal where n.melingkar order by a.code limit 1;
  if found then
    raise exception 'COA_IMPORT_CYCLE: Induk akun % melingkar.', v_bad using errcode = '23514';
  end if;

  return jsonb_build_object('dibuat', v_created, 'diubah', v_updated, 'sama', v_same, 'versi', public.coa_import_version());
end $$;
revoke all on function public.import_coa_accounts(jsonb, text) from public, anon, service_role;
grant execute on function public.import_coa_accounts(jsonb, text) to authenticated;

comment on function public.import_coa_accounts(jsonb, text) is
  'Impor bagan akun atomik (OWNER/ADMIN aktif). Hanya menulis coa_accounts; tidak membuat saldo/jurnal. Ditolak bila versi pratinjau basi.';
