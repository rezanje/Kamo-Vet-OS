-- Aset Tetap lengkap: golongan pajak, perubahan nilai/umur, disposisi, dan pindah cabang.
--
-- Yang ada sekarang cuma daftar aset + penyusutan komersial garis lurus. Akibatnya:
-- aset yang dijual atau dibuang tetap disusutkan selamanya, perbaikan besar yang
-- menambah nilai tidak punya tempat, aset yang pindah cabang tidak ada jejaknya, dan
-- penyusutan fiskal (yang dipakai SPT) harus dihitung manual di luar sistem.

-- Laba/rugi pelepasan aset — selisih harga jual vs nilai buku.
insert into coa_accounts (code, name, type, normal_balance) values
  ('4302', 'Laba Pelepasan Aset Tetap', 'PENDAPATAN', 'K'),
  ('5602', 'Rugi Pelepasan Aset Tetap', 'BEBAN', 'D')
on conflict (code) do nothing;

-- ── Golongan pajak (fiskal) ────────────────────────────────────────────────────
-- Terpisah dari kategori komersial: umur ekonomis versi perusahaan boleh beda dari
-- masa manfaat fiskal, dan itu memang bedanya laporan komersial vs SPT.
create table tax_asset_categories (
  id uuid primary key default gen_random_uuid(),
  nama varchar(60) not null unique,
  umur_bulan int not null check (umur_bulan > 0),
  metode varchar(14) not null default 'garis_lurus'
    check (metode in ('garis_lurus', 'saldo_menurun')),
  tarif_persen numeric(5,2) not null default 0 check (tarif_persen >= 0 and tarif_persen <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table tax_asset_categories enable row level security;
create policy taxcat_all on tax_asset_categories for all to authenticated using (true) with check (true);

comment on column tax_asset_categories.tarif_persen is
  'Tarif per tahun untuk metode saldo menurun. Metode garis lurus mengabaikannya dan memakai umur_bulan.';

-- Golongan bawaan mengikuti UU PPh Pasal 11.
insert into tax_asset_categories (nama, umur_bulan, metode, tarif_persen) values
  ('Golongan I (4 tahun)',            48,  'saldo_menurun', 50),
  ('Golongan II (8 tahun)',           96,  'saldo_menurun', 25),
  ('Golongan III (16 tahun)',         192, 'saldo_menurun', 12.5),
  ('Golongan IV (20 tahun)',          240, 'saldo_menurun', 10),
  ('Bangunan Permanen (20 tahun)',    240, 'garis_lurus',   5),
  ('Bangunan Tidak Permanen (10 th)', 120, 'garis_lurus',   10);

alter table fixed_assets
  add column tax_category_id uuid references tax_asset_categories(id) on delete set null,
  add column status varchar(10) not null default 'aktif'
    check (status in ('aktif', 'dilepas'));

comment on column fixed_assets.status is
  'dilepas = sudah dijual/dihapus. Penyusutan berhenti; is_active ikut dimatikan supaya mesin penyusutan melewatinya.';

-- ── Perubahan aset (nilai & umur) ──────────────────────────────────────────────
-- Perbaikan besar menambah nilai perolehan; revisi taksiran umur mengubah penyusutan
-- ke depan. Keduanya disimpan sebagai riwayat, bukan menimpa angka lama diam-diam.
create table asset_changes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references fixed_assets(id) on delete cascade,
  tanggal date not null default current_date,
  jenis varchar(6) not null check (jenis in ('nilai', 'umur')),
  nilai_lama numeric(15,2),
  nilai_baru numeric(15,2),
  umur_lama int,
  umur_baru int,
  keterangan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on asset_changes(asset_id);
alter table asset_changes enable row level security;
create policy asetchg_all on asset_changes for all to authenticated using (true) with check (true);

-- ── Disposisi (jual / hapus) ───────────────────────────────────────────────────
create table asset_disposals (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references fixed_assets(id) on delete cascade unique,
  tanggal date not null default current_date,
  jenis varchar(6) not null check (jenis in ('jual', 'hapus')),
  harga_jual numeric(15,2) not null default 0 check (harga_jual >= 0),
  metode varchar(16) not null default 'Transfer',
  account_id uuid references cash_accounts(id) on delete set null,
  -- Potret saat dilepas, supaya riwayat tetap terbaca walau aset diubah belakangan.
  harga_perolehan numeric(15,2) not null default 0,
  akumulasi numeric(15,2) not null default 0,
  nilai_buku numeric(15,2) not null default 0,
  laba_rugi numeric(15,2) not null default 0,
  keterangan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table asset_disposals enable row level security;
create policy asetdisp_all on asset_disposals for all to authenticated using (true) with check (true);

comment on column asset_disposals.laba_rugi is
  'Positif = laba (harga jual di atas nilai buku), negatif = rugi.';

-- ── Pindah aset antar cabang ───────────────────────────────────────────────────
-- Tanpa jurnal: perusahaannya sama, yang pindah cuma lokasi fisik & tanggung jawab.
create table asset_transfers (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references fixed_assets(id) on delete cascade,
  tanggal date not null default current_date,
  dari_branch_id uuid references branches(id) on delete set null,
  ke_branch_id uuid not null references branches(id) on delete restrict,
  keterangan text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on asset_transfers(asset_id);
alter table asset_transfers enable row level security;
create policy asettrf_all on asset_transfers for all to authenticated using (true) with check (true);
