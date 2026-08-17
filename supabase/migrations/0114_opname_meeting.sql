-- Stok opname — hasil meeting ERP 14 Agustus 2026 (M1–M10).
--
-- Tiga perubahan besar yang butuh skema baru:
--   1. Hitungan dikunci per barang dan tersimpan saat itu juga (K6). Mati lampu di
--      tengah hitungan tidak boleh menghapus angka yang sudah dihitung.
--   2. Selisih kurang di petshop dinilai HARGA JUAL dan lahir sebagai faktur
--      penjualan kategori khusus (K1) — kepala toko yang menanggung, jadi nilainya
--      harga jual, bukan modal. Klinik tetap modal (K2).
--   3. Daftar barang yang dihitung digenerate: 20 terlaris + 10 acak (K4).

-- ── 1. Hitungan terkunci ──────────────────────────────────────────────────────
-- Satu baris = satu barang yang sudah dikunci petugas. Buka kunci = baris dihapus.
-- qty_sistem disimpan sebagai FOTO saat dikunci, bukan dibaca ulang saat simpan:
-- toko tetap jualan selama opname, jadi barang yang laku setelah dihitung tidak
-- boleh muncul sebagai selisih kurang.
create table if not exists opname_counts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references opname_orders(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  qty_fisik numeric not null default 0 check (qty_fisik >= 0),
  qty_sistem numeric not null default 0,
  locked_by uuid references profiles(id) on delete set null,
  locked_at timestamptz not null default now(),
  unique (order_id, item_id)
);
create index if not exists opname_counts_order_idx on opname_counts(order_id);

alter table opname_counts enable row level security;
drop policy if exists opname_counts_all on opname_counts;
create policy opname_counts_all on opname_counts
  for all to authenticated using (true) with check (true);

comment on table opname_counts is
  'Hitungan fisik yang sudah dikunci petugas. Tersimpan tiap kunci; buka kunci = hapus baris.';
comment on column opname_counts.qty_sistem is
  'Stok sistem saat barang dikunci. Selisih dihitung terhadap angka ini, bukan stok saat simpan.';

-- ── 2. Faktur penjualan kategori "selisih stok" ───────────────────────────────
-- Selisih kurang petshop dikonversi jadi faktur penjualan supaya tertagih ke
-- kepala toko lewat jalur piutang yang sudah ada. Kategori memisahkannya dari
-- penjualan biasa di laporan.
alter table sales_invoices
  add column if not exists kategori varchar(16) not null default 'umum';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sales_invoices_kategori_check'
  ) then
    alter table sales_invoices
      add constraint sales_invoices_kategori_check
      check (kategori in ('umum', 'selisih_stok'));
  end if;
end $$;

comment on column sales_invoices.kategori is
  'umum = penjualan biasa; selisih_stok = faktur otomatis dari hasil opname (harga jual, tanpa promo).';

alter table opname_results
  add column if not exists invoice_id uuid references sales_invoices(id) on delete set null;

comment on column opname_results.invoice_id is
  'Faktur selisih stok yang lahir dari hasil ini (hanya petshop; klinik dijurnal pakai modal).';

-- ── 3. Generator daftar hitung: 20 terlaris + 10 acak ─────────────────────────
-- Barang cepat laku paling rawan selisih; yang acak menangkap barang hilang yang
-- tidak laku. Kalau barang terlarisnya belum sampai 20 (cabang baru), sisanya
-- ditambal dari yang acak supaya jumlahnya tetap 30.
create or replace function opname_daftar_hitung(
  p_warehouse uuid,
  p_top int default 20,
  p_acak int default 10
)
returns table (item_id uuid, alasan text)
language sql
stable
as $$
  with kandidat as (
    select s.item_id from stock s where s.warehouse_id = p_warehouse
  ),
  terlaris as (
    select si.item_id, sum(si.qty) as terjual
    from sale_items si
    join sales sa on sa.id = si.sale_id
    where sa.branch_id = (select branch_id from warehouses where id = p_warehouse)
      and sa.created_at >= now() - interval '90 days'
      and si.item_id is not null
      and si.item_id in (select k.item_id from kandidat k)
    group by si.item_id
    order by terjual desc
    limit greatest(coalesce(p_top, 0), 0)
  ),
  acak as (
    select k.item_id
    from kandidat k
    where k.item_id not in (select t.item_id from terlaris t)
    order by random()
    limit greatest(coalesce(p_top, 0) + coalesce(p_acak, 0) - (select count(*) from terlaris), 0)
  )
  select t.item_id, 'terlaris'::text from terlaris t
  union all
  select a.item_id, 'acak'::text from acak a;
$$;

comment on function opname_daftar_hitung is
  'Daftar barang untuk satu perintah opname: p_top barang terlaris 90 hari + sisanya acak.';
