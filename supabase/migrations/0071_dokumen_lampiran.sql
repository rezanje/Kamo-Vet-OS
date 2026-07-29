-- Lampiran dokumen per transaksi (pembelian, penjualan, pengeluaran) — spec 2026-07-30.
-- Satu tabel generik, bukan kolom per modul: modul + ref_id menunjuk ke dokumen sumber
-- (PO, penjualan, pengeluaran, dst) supaya modul baru tinggal ikut tanpa migrasi lagi.
create table if not exists document_attachments (
  id uuid primary key default gen_random_uuid(),
  modul varchar(24) not null,
  ref_id uuid not null,
  nama varchar(200) not null,
  path text not null,
  mime varchar(120),
  ukuran bigint,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists document_attachments_ref_idx on document_attachments(modul, ref_id);

alter table document_attachments enable row level security;
-- Lampiran ikut dokumen induknya; guard peran ada di server action masing-masing modul.
drop policy if exists doc_attach_all on document_attachments;
create policy doc_attach_all on document_attachments for all to authenticated using (true) with check (true);

-- Bucket privat: bukti pembayaran & nota tidak boleh terbuka ke publik.
insert into storage.buckets (id, name, public) values ('dokumen', 'dokumen', false)
on conflict (id) do nothing;

drop policy if exists dokumen_read on storage.objects;
create policy dokumen_read on storage.objects for select to authenticated
  using (bucket_id = 'dokumen');
drop policy if exists dokumen_write on storage.objects;
create policy dokumen_write on storage.objects for insert to authenticated
  with check (bucket_id = 'dokumen');
drop policy if exists dokumen_delete on storage.objects;
create policy dokumen_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dokumen');
