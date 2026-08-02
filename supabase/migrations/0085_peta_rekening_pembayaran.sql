-- Kas & Bank: peta metode bayar → rekening + rekonsiliasi per rekening — spec 2026-08-02.
--
-- Sebelum ini SELURUH aplikasi menulis jurnal ke dua kode mati: Tunai→1101, sisanya→1102.
-- Rekening kedua (Mandiri, QRIS settlement, e-wallet) tidak pernah menerima mutasi walau
-- sudah didaftarkan di cash_accounts. Peta ini yang menentukan uang non-tunai masuk ke mana,
-- tanpa menambah klik untuk kasir.

create table payment_account_map (
  id uuid primary key default gen_random_uuid(),
  metode varchar(16) not null,
  -- null = aturan pusat (berlaku untuk semua cabang yang tidak punya aturan sendiri).
  branch_id uuid references branches(id) on delete cascade,
  cash_account_id uuid not null references cash_accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Dua index parsial, bukan satu unique(metode, branch_id): di Postgres NULL tidak pernah
-- sama dengan NULL, jadi unique biasa akan mengizinkan banyak baris pusat untuk metode sama.
create unique index payment_account_map_pusat on payment_account_map(metode) where branch_id is null;
create unique index payment_account_map_cabang on payment_account_map(metode, branch_id) where branch_id is not null;

alter table payment_account_map enable row level security;
-- Guard peran (OWNER/ADMIN/FINANCE) ada di server action, pola cash_accounts (0068).
create policy payment_account_map_all on payment_account_map for all to authenticated using (true) with check (true);

comment on table payment_account_map is
  'Peta metode bayar → rekening kas/bank. Kosong = pakai bawaan lama (Tunai→1101, selain itu→1102) supaya angka tidak berubah diam-diam saat peta belum diisi.';

-- Rekonsiliasi bank dulu terkunci ke akun 1102 ("BANK BCA" hardcode di judul layar).
-- Nullable: baris lama (kalau ada) tetap dibaca sebagai rekening bank bawaan.
alter table bank_reconciliations add column cash_account_id uuid references cash_accounts(id) on delete set null;
