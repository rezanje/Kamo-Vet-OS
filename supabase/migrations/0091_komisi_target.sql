-- Komisi Penjual & Target Penjualan.
-- Spec docs/superpowers/specs/2026-08-03-komisi-target-penjualan-design.md
--
-- Latar: dua tile Accurate di modul Penjualan masih kosong. Insentif karyawan dihitung
-- di luar sistem dan tidak ada jejaknya, target penjualan tidak tersimpan sama sekali.

-- ── Aturan komisi ──────────────────────────────────────────────────────────────
-- Satu aturan = satu cara menghitung insentif. Cakupan yang null berarti "semua",
-- jadi satu aturan bisa dibatasi berlapis (karyawan X + kategori tertentu, dst).
-- Beberapa aturan boleh kena ke struk yang sama — itu memang diminta: persen omzet
-- global + nominal tetap per produk + persen per kategori bisa jalan bersamaan.
create table commission_rules (
  id uuid primary key default gen_random_uuid(),
  nama varchar(60) not null,
  tipe varchar(8) not null check (tipe in ('persen', 'nominal')),
  basis varchar(6) not null default 'omzet' check (basis in ('omzet', 'laba')),
  persen numeric(6,3) not null default 0 check (persen >= 0 and persen <= 100),
  nominal numeric(15,2) not null default 0 check (nominal >= 0),

  -- Cakupan: null = tanpa batas untuk dimensi itu.
  employee_id uuid references employees(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  category_id uuid references item_categories(id) on delete cascade,
  item_id uuid references items(id) on delete cascade,

  -- Ambang cair: komisi aturan ini baru dihitung kalau realisasi karyawan di periode
  -- itu (sesuai basisnya) sudah melewati angka ini. 0 = tanpa ambang.
  min_omzet numeric(15,2) not null default 0 check (min_omzet >= 0),

  berlaku_dari date,
  berlaku_sampai date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  -- Aturan tanpa angka = aturan yang diam-diam tidak membayar apa pun.
  check ((tipe = 'persen' and persen > 0) or (tipe = 'nominal' and nominal > 0)),
  check (berlaku_sampai is null or berlaku_dari is null or berlaku_sampai >= berlaku_dari)
);
alter table commission_rules enable row level security;
create policy commission_rules_all on commission_rules for all to authenticated using (true) with check (true);

comment on column commission_rules.basis is
  'omzet = harga jual; laba = harga jual - HPP. Basis laba melewatkan baris yang HPP-nya kosong.';
comment on column commission_rules.nominal is
  'Tipe nominal: rupiah per unit terjual, dikali qty.';
comment on column commission_rules.category_id is
  'Kategori induk ikut menjaring produk di kategori anaknya.';

-- ── Target penjualan ───────────────────────────────────────────────────────────
-- Satu baris = satu target periode untuk satu kombinasi cakupan.
create table sales_targets (
  id uuid primary key default gen_random_uuid(),
  periode varchar(7) not null,                                  -- YYYY-MM
  employee_id uuid references employees(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  category_id uuid references item_categories(id) on delete cascade,
  basis varchar(6) not null default 'omzet' check (basis in ('omzet', 'laba')),
  target numeric(15,2) not null check (target > 0),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (periode ~ '^\d{4}-\d{2}$')
);
-- nulls not distinct: cakupan kosong ikut dianggap nilai, supaya target "semua cabang"
-- tidak bisa dibuat dua kali untuk periode yang sama.
create unique index sales_targets_unik
  on sales_targets (periode, employee_id, branch_id, category_id) nulls not distinct;
create index on sales_targets(periode);
alter table sales_targets enable row level security;
create policy sales_targets_all on sales_targets for all to authenticated using (true) with check (true);

-- ── Komisi di slip gaji ────────────────────────────────────────────────────────
-- Potret, bukan tautan hidup: retur yang masuk setelah gaji disahkan tidak boleh
-- mengubah slip yang sudah dicetak — sama seperti kolom rincian lain di 0090.
alter table payrolls add column komisi numeric(15,2) not null default 0;
comment on column payrolls.komisi is
  'Komisi penjualan periode ini; potret saat gaji dihitung, tidak ikut berubah kalau data penjualan berubah belakangan.';
