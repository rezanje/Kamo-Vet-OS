-- Penyetuju transaksi / approval berjenjang (S6).
--
-- Sampai sekarang siapa pun yang boleh membuka layarnya bisa langsung mengeluarkan
-- uang, berapa pun nilainya. Yang dijaga di sini bukan "siapa boleh membuka layar"
-- (itu sudah diurus Akses Grup) tapi "berapa nilai yang boleh dilepas tanpa bertanya".
--
-- Titik pengamanannya sengaja diletakkan di SAAT UANG KELUAR, bukan saat dokumen
-- dibuat: dokumen boleh disiapkan siapa saja, yang perlu izin atasan itu
-- pembayarannya. Dengan begitu tidak ada dokumen setengah jadi yang menggantung.

create table if not exists approval_rules (
  id uuid primary key default gen_random_uuid(),
  -- Jenis transaksi yang dijaga, mis. 'bayar-faktur' / 'kas-keluar'.
  jenis varchar(30) not null,
  -- Perlu persetujuan kalau nilainya LEBIH BESAR dari angka ini.
  min_nilai numeric not null default 0 check (min_nilai >= 0),
  -- Peran yang berhak menyetujui.
  penyetuju_role varchar(20) not null check (penyetuju_role in ('OWNER', 'ADMIN', 'FINANCE')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists approval_rules_jenis_idx on approval_rules (jenis, is_active);

create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  jenis varchar(30) not null,
  -- Dokumen yang dimintakan persetujuan (faktur pembelian, bukti kas, dst).
  ref_id uuid not null,
  no_dokumen varchar(40),
  nilai numeric not null default 0,
  keterangan text,
  penyetuju_role varchar(20) not null,
  status varchar(12) not null default 'menunggu'
    check (status in ('menunggu', 'disetujui', 'ditolak', 'terpakai')),
  diajukan_oleh uuid references auth.users(id) on delete set null,
  diajukan_at timestamptz not null default now(),
  diputus_oleh uuid references auth.users(id) on delete set null,
  diputus_at timestamptz,
  catatan text
);

-- Satu dokumen hanya boleh punya satu pengajuan yang masih hidup. Tanpa ini, menekan
-- tombol bayar tiga kali membuat tiga antrean persetujuan untuk faktur yang sama.
create unique index if not exists approval_requests_aktif_unik
  on approval_requests (jenis, ref_id)
  where status in ('menunggu', 'disetujui');

create index if not exists approval_requests_status_idx on approval_requests (status, diajukan_at desc);

alter table approval_rules enable row level security;
alter table approval_requests enable row level security;

create policy approval_rules_read on approval_rules for select to authenticated using (true);
create policy approval_rules_write on approval_rules for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('OWNER', 'ADMIN')));

-- Pengajuan boleh dibaca semua yang login: pengaju perlu tahu statusnya sendiri.
create policy approval_requests_read on approval_requests for select to authenticated using (true);
-- Membuat pengajuan boleh siapa saja yang bertransaksi; keputusannya yang dibatasi.
create policy approval_requests_insert on approval_requests for insert to authenticated with check (true);
