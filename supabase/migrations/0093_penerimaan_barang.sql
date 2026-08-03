-- Penerimaan Barang jadi dokumen sendiri.
--
-- Sekarang penerimaan bertahap sudah jalan, tapi jejaknya cuma satu angka kumulatif
-- di `purchase_order_items.qty_terima`. Akibatnya: tidak ada nomor dokumen, tidak
-- ketahuan kiriman mana datang kapan dan diterima siapa, dan barang yang datang
-- dalam keadaan rusak tidak punya tempat dicatat — pilihannya cuma "terima" (masuk
-- stok padahal rusak) atau "tidak terima" (klaim ke pemasok hilang jejak).

create table goods_receipts (
  id uuid primary key default gen_random_uuid(),
  no_terima varchar(30) not null unique,               -- TB.YYYY.MM.NNNNN
  po_id uuid not null references purchase_orders(id) on delete cascade,
  tanggal date not null default current_date,
  surat_jalan varchar(60),                             -- nomor surat jalan pemasok
  catatan text,
  lampiran_url text,
  received_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on goods_receipts(po_id);
create index on goods_receipts(tanggal);

create table goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references goods_receipts(id) on delete cascade,
  po_item_id uuid references purchase_order_items(id) on delete set null,
  item_id uuid references items(id) on delete set null,
  nama varchar(160) not null,
  satuan varchar(20),
  -- Potret saat barang datang, supaya dokumen lama tetap terbaca walau PO diubah.
  qty_pesan numeric not null default 0,
  qty_sisa_sebelum numeric not null default 0,
  qty_terima numeric not null default 0 check (qty_terima >= 0),
  qty_rusak numeric not null default 0 check (qty_rusak >= 0),
  harga numeric not null default 0,
  catatan text
);
create index on goods_receipt_items(receipt_id);

comment on column goods_receipt_items.qty_terima is
  'Barang yang diterima dalam kondisi baik — inilah yang masuk stok dan dijurnal.';
comment on column goods_receipt_items.qty_rusak is
  'Datang tapi ditolak karena rusak. TIDAK masuk stok dan tidak menambah hutang; dicatat untuk klaim ke pemasok.';
comment on column goods_receipt_items.qty_sisa_sebelum is
  'Sisa yang belum datang sebelum dokumen ini — dipakai membaca riwayat kiriman bertahap.';

alter table goods_receipts enable row level security;
alter table goods_receipt_items enable row level security;

create policy gr_all on goods_receipts for all to authenticated
  using (exists (select 1 from purchase_orders p where p.id = goods_receipts.po_id
                 and (p.branch_id is null or public.user_can_access_branch(p.branch_id))))
  with check (exists (select 1 from purchase_orders p where p.id = goods_receipts.po_id
                 and (p.branch_id is null or public.user_can_access_branch(p.branch_id))));

create policy gri_all on goods_receipt_items for all to authenticated
  using (exists (select 1 from goods_receipts g join purchase_orders p on p.id = g.po_id
                 where g.id = goods_receipt_items.receipt_id
                   and (p.branch_id is null or public.user_can_access_branch(p.branch_id))))
  with check (exists (select 1 from goods_receipts g join purchase_orders p on p.id = g.po_id
                 where g.id = goods_receipt_items.receipt_id
                   and (p.branch_id is null or public.user_can_access_branch(p.branch_id))));

-- Barang rusak yang menumpuk per baris PO, supaya sisa yang benar-benar ditunggu
-- bisa dihitung tanpa menjumlah ulang seluruh dokumen penerimaan tiap kali.
alter table purchase_order_items add column qty_rusak numeric not null default 0;
comment on column purchase_order_items.qty_rusak is
  'Akumulasi barang yang datang rusak dan ditolak. Sisa yang ditunggu = qty - qty_terima; yang rusak jadi urusan klaim, bukan pengurang pesanan.';
