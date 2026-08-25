-- Format nomor dokumen bisa diatur sendiri (S5).
--
-- Sampai sekarang awalan dan jumlah digit tertanam di kode: mengubah "FB.2026.08.00001"
-- jadi bentuk lain harus lewat developer. Tabel ini menyimpan polanya; kode membaca
-- dari sini saat dokumen dibuat, dan jatuh ke bawaan di lib/no-dokumen kalau barisnya
-- belum ada. Tabel kosong = perilaku persis seperti sebelum fitur ini menyala.

create table if not exists document_numbering (
  jenis varchar(10) primary key,
  -- Awalan sebelum digit urutan. Token yang dikenal: {YYYY} {YY} {MM} {DD}.
  pola varchar(30) not null,
  digit smallint not null default 5 check (digit between 1 and 8),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table document_numbering enable row level security;
-- Baca terbuka: hampir semua layar transaksi perlu tahu format nomornya saat menyimpan.
create policy document_numbering_read on document_numbering for select to authenticated using (true);
-- Tulis hanya OWNER/ADMIN — nomor dokumen itu identitas resmi, bukan preferensi tampilan.
create policy document_numbering_write on document_numbering for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')));

comment on column document_numbering.pola is
  'Awalan sebelum digit urutan, mis. FB.{YYYY}.{MM}. — token: {YYYY} {YY} {MM} {DD}';
