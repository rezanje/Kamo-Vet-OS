-- Koreksi catatan harian rawat inap (spec 2026-07-20).
-- Sebelumnya murni append-only: tidak ada policy UPDATE sama sekali. Sekarang boleh
-- dikoreksi, TAPI isi lama wajib tersimpan — rekam medis yang bisa diubah diam-diam
-- tidak ada nilainya kalau terjadi sengketa dengan pemilik hewan.

alter table inpatient_daily_logs add column updated_at timestamptz;
alter table inpatient_daily_logs add column updated_by uuid references profiles(id) on delete set null;

-- Satu baris per koreksi, berisi snapshot SEBELUM diubah.
create table inpatient_daily_log_edits (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references inpatient_daily_logs(id) on delete cascade,
  edited_by uuid references profiles(id) on delete set null,
  edited_at timestamptz not null default now(),
  before jsonb not null,
  alasan text
);
create index on inpatient_daily_log_edits(log_id);

alter table inpatient_daily_log_edits enable row level security;
create policy idle_sel on inpatient_daily_log_edits for select to authenticated using (true);
create policy idle_ins on inpatient_daily_log_edits for insert to authenticated with check (true);

create policy idl_upd on inpatient_daily_logs for update to authenticated using (true) with check (true);
