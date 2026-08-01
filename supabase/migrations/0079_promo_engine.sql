-- Mesin promo: pilih produk, batas qty, kelipatan, potong otomatis — spec 2026-08-01.
--
-- Sebelum ini promo hanya PENGINGAT: kasir melihat saran di layar lalu mengetik
-- diskonnya manual. Yang diminta tim (Andri, 2026-08-01): bisa memilih produk
-- mana yang kena, minimum & maksimum qty, aturan kelipatan, dan potongannya
-- jalan sendiri.
--
-- Catatan bug lama: kolom `min_qty` sudah dibaca server action sejak 0027 tapi
-- input-nya tidak pernah dipasang di formulir, jadi nilainya selalu kosong.

-- ── 1. Produk yang kena promo ──────────────────────────────────────────────
-- Tabel sendiri, bukan array di dalam `rule`, supaya bisa di-join untuk
-- menampilkan nama barang dan ikut terhapus rapi saat barang/promo dihapus.
create table promo_items (
  promo_id uuid not null references promos(id) on delete cascade,
  item_id  uuid not null references items(id)  on delete cascade,
  primary key (promo_id, item_id)
);
create index on promo_items(item_id);

alter table promo_items enable row level security;
-- Guard peran (OWNER/ADMIN) ada di server action promo, sama pola dgn promos.
create policy promo_items_all on promo_items for all to authenticated using (true) with check (true);

comment on table promo_items is
  'Barang yang kena promo. KOSONG = promo berlaku untuk semua barang.';

-- ── 2. Aturan promo naik dari jsonb jadi kolom ─────────────────────────────
-- Dipindah dari `rule` karena sekarang dipakai untuk MENGHITUNG UANG, bukan
-- sekadar menyusun kalimat saran: nilai yang salah tipe harus ditolak database,
-- bukan diam-diam jadi NaN saat kasir menekan bayar.
alter table promos
  add column min_qty        numeric(15,4),
  add column max_qty        numeric(15,4),
  add column kelipatan      boolean not null default false,
  add column auto_apply     boolean not null default false,
  add column discount_type  varchar(8),
  add column discount_value numeric(15,2),
  add constraint promos_qty_wajar check (
    (min_qty is null or min_qty > 0)
    and (max_qty is null or max_qty > 0)
    and (min_qty is null or max_qty is null or max_qty >= min_qty)
  ),
  add constraint promos_diskon_wajar check (
    discount_type is null or (
      discount_type in ('percent', 'nominal')
      and discount_value is not null and discount_value > 0
      and (discount_type <> 'percent' or discount_value <= 100)
    )
  );

comment on column promos.min_qty is
  'Qty minimum barang promo dalam satu transaksi supaya promo aktif. NULL = 1.';
comment on column promos.max_qty is
  'Batas qty yang dapat potongan. NULL = tanpa batas.';
comment on column promos.kelipatan is
  'true = potongan berulang tiap kelipatan min_qty (beli 5 dgn min 2 → 4 yang dapat). false = sekali syarat terpenuhi, seluruh qty dapat.';
comment on column promos.auto_apply is
  'true = kasir langsung dipotong otomatis. false = hanya muncul sebagai pengingat (perilaku lama).';

-- ── 3. Pindahkan isi `rule` lama ke kolom baru ─────────────────────────────
-- Promo lama tetap berjalan seperti sebelumnya: auto_apply sengaja dibiarkan
-- false supaya tidak ada potongan yang tiba-tiba muncul di kasir tanpa diminta.
update promos set
  min_qty        = nullif((rule->>'min_qty')::numeric, 0),
  discount_type  = nullif(rule->>'discount_type', ''),
  discount_value = nullif((rule->>'discount_value')::numeric, 0)
where rule is not null;

-- Barang pemicu lama (rule.trigger_item_ids) dipindah ke tabel baru.
insert into promo_items (promo_id, item_id)
select p.id, (x)::uuid
from promos p
cross join lateral jsonb_array_elements_text(coalesce(p.rule->'trigger_item_ids', '[]'::jsonb)) as x
where exists (select 1 from items i where i.id = (x)::uuid)
on conflict do nothing;

-- `rule` tidak dihapus: min_subtotal & suggest masih dibaca dari sana, dan
-- membuang kolomnya berarti kehilangan jejak konfigurasi promo lama.
