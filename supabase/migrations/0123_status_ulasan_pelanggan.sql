-- Status ulasan pelanggan (permintaan komisaris, 18 Agustus 2026).
--
-- Latar: pelanggan yang memberi bintang 1 di Google — atau sebaliknya yang rajin
-- memuji — sekarang cuma dicatat di kolom `catatan` bebas. Isinya tidak bisa
-- disaring, tidak bisa dihitung, dan tidak kelihatan waktu orangnya datang ke
-- kasir. Daftar statusnya sengaja jadi master supaya manajemen menambah sendiri
-- tanpa lewat developer.

create table if not exists customer_review_statuses (
  id uuid primary key default gen_random_uuid(),
  nama varchar(60) not null unique,
  warna varchar(7) not null default '#6b7280',
  -- Nada menentukan perlakuan di layar depan: yang negatif ditonjolkan ke kasir
  -- dan admin klinik, sisanya cukup jadi label.
  nada varchar(8) not null default 'netral' check (nada in ('positif', 'netral', 'negatif')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table customer_review_statuses enable row level security;
create policy crs_all on customer_review_statuses for all to authenticated using (true) with check (true);

alter table customers
  add column if not exists review_status_id uuid references customer_review_statuses(id) on delete set null,
  add column if not exists review_catatan text,
  add column if not exists review_updated_at timestamptz;

create index if not exists customers_review_status_idx on customers(review_status_id);

comment on column customers.review_status_id is
  'Status ulasan terkini. Kosong = belum pernah dinilai.';
comment on column customers.review_catatan is
  'Konteks singkat status ulasan, mis. "protes soal antrian, 12 Agu".';

-- Contoh awal supaya menu tidak kosong saat pertama dibuka; boleh diubah/dinonaktifkan.
insert into customer_review_statuses (nama, warna, nada) values
  ('Bintang 1 Google', '#b91c1c', 'negatif'),
  ('Komplain', '#c2410c', 'negatif'),
  ('Ulasan positif',  '#15803d', 'positif'),
  ('Endorse / KOL',   '#7c3aed', 'positif')
on conflict (nama) do nothing;
