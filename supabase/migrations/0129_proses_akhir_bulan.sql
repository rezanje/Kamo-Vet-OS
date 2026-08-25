-- Proses akhir bulan otomatis (S8).
--
-- Tiga pekerjaan awal bulan yang selama ini manual dan gampang terlewat: posting
-- penyusutan aset, posting jurnal berulang, dan mengunci bulan yang sudah lewat.
-- Yang ketiga paling mahal kalau lupa — transaksi bisa disisipkan ke bulan yang
-- laporannya sudah dikirim ke pemilik.

-- Penguncian otomatis dimatikan sampai klien menyalakannya sendiri: mengunci
-- pembukuan tanpa diminta bisa menahan pekerjaan yang sedang berjalan.
alter table accounting_locks add column if not exists auto_kunci boolean not null default false;
-- Masa tenggang setelah bulan berakhir, untuk transaksi susulan yang wajar
-- (faktur pemasok telat datang, setoran hari terakhir baru dicatat tanggal 2).
alter table accounting_locks add column if not exists auto_kunci_jeda_hari smallint not null default 5;

comment on column accounting_locks.auto_kunci is
  'Kunci periode otomatis saat proses akhir bulan berjalan. Default mati.';
comment on column accounting_locks.auto_kunci_jeda_hari is
  'Berapa hari setelah bulan berakhir sebelum periode dikunci otomatis.';

-- Catatan tiap kali proses akhir bulan dijalankan — supaya "sudah jalan atau belum"
-- bisa dijawab dari layar, bukan dari log server yang tidak bisa dibuka klien.
create table if not exists month_end_runs (
  id uuid primary key default gen_random_uuid(),
  periode varchar(7) not null,
  dijalankan_at timestamptz not null default now(),
  -- 'cron' = otomatis tiap tanggal 1, 'manual' = ditekan dari layar Tutup Buku.
  sumber varchar(10) not null default 'cron',
  dijalankan_oleh uuid references auth.users(id) on delete set null,
  berhasil boolean not null default true,
  ringkasan text,
  rincian jsonb
);

create index if not exists month_end_runs_periode_idx on month_end_runs (periode, dijalankan_at desc);

alter table month_end_runs enable row level security;
create policy month_end_runs_read on month_end_runs for select to authenticated using (true);
-- Ditulis oleh cron (service role, mem-bypass RLS) dan oleh OWNER/ADMIN dari layar.
create policy month_end_runs_write on month_end_runs for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')));
