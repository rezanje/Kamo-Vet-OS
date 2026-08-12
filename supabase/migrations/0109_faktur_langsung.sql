-- Faktur Pembelian Langsung: beli barang tanpa PO, barang masuk di dokumen yang sama.
--
-- Sampai sekarang faktur pembelian WAJIB berasal dari PO yang sudah diterima.
-- Di lapangan pembelian tidak selalu lewat PO (pemasok datang bawa barang, beli
-- dadakan). Tim keuangan memastikan pemakaiannya khusus BARANG yang masuk gudang,
-- bukan tagihan jasa — tagihan jasa tetap lewat Buku Besar → Pencatatan Beban.
--
-- Bentuknya sengaja "faktur + terima barang sekaligus": kalau fakturnya tidak
-- membawa barang masuk, akan ada tagihan yang barangnya tidak ketahuan ke mana.

alter table purchase_invoices alter column po_id drop not null;

-- Faktur langsung tidak punya PO, jadi cabang & gudangnya harus disimpan sendiri.
-- Tanpa branch_id, jurnal pembayarannya kehilangan cabang; tanpa warehouse_id,
-- stok tidak tahu harus masuk ke mana.
alter table purchase_invoices add column if not exists branch_id uuid references branches(id) on delete set null;
alter table purchase_invoices add column if not exists warehouse_id uuid references warehouses(id) on delete set null;

-- Faktur yang tidak bersandar pada PO WAJIB punya gudang tujuan.
alter table purchase_invoices drop constraint if exists purchase_invoices_asal_check;
alter table purchase_invoices add constraint purchase_invoices_asal_check
  check (po_id is not null or warehouse_id is not null);

-- Kadaluarsa per baris — pola sama dengan goods_receipt_items (migrasi 0104).
alter table purchase_invoice_items add column if not exists exp_date date;

-- Satuan & faktor WAJIB ada: stok selalu disimpan dalam satuan dasar. Tanpa ini
-- "beli 2 box" tercatat 2 pcs, dan stok maupun modalnya meleset sebesar faktornya.
alter table purchase_invoice_items add column if not exists satuan varchar(20);
alter table purchase_invoice_items add column if not exists faktor numeric not null default 1;

-- Faktur pembelian wajib berjurnal TEPAT SEKALI. Sumbernya sudah dipakai jalur PO
-- ('purchase-invoice') dan layar Sinkron sudah mendeteksinya, jadi faktur langsung
-- memakai sumber yang sama — sekalian dimasukkan ke daftar putih anti-jurnal-dobel
-- yang dipasang migrasi 0106 (dulu terlewat).
drop index if exists journal_entries_sekali_saja;
create unique index journal_entries_sekali_saja
  on journal_entries (source, source_ref)
  where source_ref is not null and source in (
    'sale', 'sale-hpp', 'sale-online', 'klinik', 'klinik-hpp', 'klinik-void',
    'purchase', 'purchase-invoice', 'purchase-return', 'sales-return', 'sales-return-hpp',
    'transfer', 'transfer-void', 'kas-entry', 'kas-entry-void',
    'payroll', 'kasbon', 'recurring', 'cash-account-opening', 'closing', 'saldo-awal'
  );

comment on column purchase_invoices.po_id is
  'NULL = faktur langsung (tanpa PO); barangnya masuk lewat faktur ini sendiri.';
