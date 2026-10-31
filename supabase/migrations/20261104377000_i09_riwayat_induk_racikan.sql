-- I09 lanjutan (keputusan pemilik 29 Okt 2026): riwayat per SKU induk racikan nonstok.
--
-- Seperti kartu stok, tetapi virtual: induk racikan tidak pernah punya stok fisik, jadi
-- riwayatnya disusun dari fakta yang sudah ada, tanpa menulis apa pun:
--   * "Masuk"  = setiap racikan yang dibuat untuk SKU ini (clinic_compound_sales.sale_item_id
--                -> compounding_recipes), 1 racikan per baris;
--   * "Keluar" = setiap baris invoice klinik yang menagih racikan tersebut
--                (invoice_items.compound_recipe_id).
-- Tidak ada harga/HPP yang dikembalikan (konvensi read_compound_trace, PR #281).
--
-- Akses: pengguna aktif dengan modul Persediaan atau Klinik (aturan bawaan sama dengan
-- lib/akses.ts bila peran belum punya aturan tersimpan). Baris dari cabang yang tidak bisa
-- diakses tetap ikut dihitung dan nomornya tetap tampil, tetapi tanpa id tautan, tanpa nama
-- pasien/pelanggan, dan tanpa nama racikan.
--
-- Paging: p_offset/p_limit dengan total_baris di setiap baris, dibaca lengkap oleh aplikasi
-- dengan verifikasi jumlah (readCompleteList), sama seperti kartu stok.

create index if not exists clinic_compound_sales_sale_item_idx
  on public.clinic_compound_sales (sale_item_id) where recipe_id is not null;

create or replace function public.read_compound_parent_history(
  p_item_id uuid, p_dari date, p_sampai date, p_offset integer default 0, p_limit integer default 500
) returns table (
  id text, arah text, waktu timestamptz, tanggal date, qty numeric, satuan text,
  nomor_racikan text, recipe_id uuid, nama_racikan text, status_racikan text, sumber text,
  visit_id uuid, pasien text, pelanggan text, cabang text,
  invoice_id uuid, nomor_invoice text, invoice_batal boolean,
  bisa_dibuka boolean, total_baris bigint
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare me public.profiles%rowtype;
begin
  if p_item_id is null or auth.uid() is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'Akses riwayat racikan ditolak' using errcode = '42501';
  end if;
  select * into me from public.profiles p where p.id = auth.uid() and p.is_active;
  if not found or not (me.role = 'OWNER'
    or exists (select 1 from public.role_modules m where m.role = me.role and m.module_id in ('pos', 'klinik'))
    or (not exists (select 1 from public.role_modules m where m.role = me.role) and me.role in ('ADMIN', 'DOCTOR', 'STAFF'))) then
    raise exception 'Akses riwayat racikan ditolak' using errcode = '42501';
  end if;
  if p_dari is null or p_sampai is null or p_dari > p_sampai
     or p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'RIWAYAT_TIDAK_VALID: rentang tanggal atau halaman tidak valid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.items i where i.id = p_item_id)
     or not (clinic_private.is_racikan_sku(p_item_id)
             or exists (select 1 from public.clinic_compound_sales s where s.sale_item_id = p_item_id)) then
    raise exception 'RIWAYAT_TIDAK_VALID: barang ini bukan induk racikan' using errcode = '22023';
  end if;

  return query
  with racikan as (
    select r.id rid, r.recipe_name::text recipe_name, r.status::text status, r.created_at, s.sale_unit,
           v.id vid, v.branch_id, v.created_at visit_at, b.name::text branch_name,
           pt.name::text pet_name, c.name::text customer_name,
           fv.name::text formula_name, fv.version formula_version,
           public.user_can_access_branch(v.branch_id) boleh
    from public.clinic_compound_sales s
    join public.compounding_recipes r on r.id = s.recipe_id
    join public.visits v on v.id = s.visit_id
    left join public.branches b on b.id = v.branch_id
    left join public.pets pt on pt.id = v.pet_id
    left join public.customers c on c.id = v.customer_id
    left join public.compound_official_usage u on u.recipe_id = r.id
    left join public.compound_formula_versions fv on fv.id = u.formula_version_id
    where s.sale_item_id = p_item_id and s.recipe_id is not null
  ),
  -- Nomor racikan = nomor resep di halaman racik (R/<tahun>/<bulan-hari>/<3 huruf id>, UTC).
  bernomor as (
    select k.*, 'R/' || to_char(k.visit_at at time zone 'UTC', 'YYYY') || '/' || to_char(k.visit_at at time zone 'UTC', 'MMDD')
           || '/' || upper(left(k.rid::text, 3)) nomor
    from racikan k
  ),
  baris as (
    select 'masuk:' || k.rid::text id, 'masuk'::text arah, k.created_at waktu,
           (k.created_at at time zone 'Asia/Jakarta')::date tanggal, 1::numeric qty, k.sale_unit::text satuan,
           k.nomor, k.rid, k.recipe_name, k.status, k.formula_name, k.formula_version,
           k.vid, k.pet_name, k.customer_name, k.branch_name,
           null::uuid inv_id, null::text inv_no, null::boolean inv_void, k.boleh
    from bernomor k
    union all
    select 'keluar:' || ii.id::text, 'keluar', inv.created_at,
           (inv.created_at at time zone 'Asia/Jakarta')::date, ii.qty::numeric, coalesce(ii.satuan, k.sale_unit)::text,
           k.nomor, k.rid, k.recipe_name, k.status, k.formula_name, k.formula_version,
           k.vid, k.pet_name, k.customer_name, k.branch_name,
           inv.id, inv.invoice_no::text, inv.voided_at is not null, k.boleh
    from bernomor k
    join public.invoice_items ii on ii.compound_recipe_id = k.rid
    join public.invoices inv on inv.id = ii.invoice_id
  ),
  terpilih as (
    select x.*, count(*) over () jumlah from baris x where x.tanggal between p_dari and p_sampai
  )
  select t.id, t.arah, t.waktu, t.tanggal, t.qty, t.satuan,
         t.nomor, case when t.boleh then t.rid end,
         case when t.boleh then t.recipe_name end, t.status,
         case when t.formula_name is not null then 'Resep resmi: ' || t.formula_name || ' v' || t.formula_version
              else 'Racikan bebas dari rekam medis' end,
         case when t.boleh then t.vid end,
         case when t.boleh then t.pet_name end, case when t.boleh then t.customer_name end, t.branch_name,
         case when t.boleh then t.inv_id end, t.inv_no, t.inv_void,
         t.boleh, t.jumlah
  from terpilih t
  order by t.waktu, t.id
  offset p_offset limit p_limit;
end $$;
revoke all on function public.read_compound_parent_history(uuid, date, date, integer, integer) from public, anon, service_role;
grant execute on function public.read_compound_parent_history(uuid, date, date, integer, integer) to authenticated;
comment on function public.read_compound_parent_history(uuid, date, date, integer, integer) is
  'I09: riwayat virtual SKU induk racikan nonstok (Masuk = racikan dibuat, Keluar = racikan ditagih). Baca saja, tanpa harga.';
