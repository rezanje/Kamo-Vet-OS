-- Booking online (gap menu Klinik) — pemilik hewan memesan jadwal dari luar sistem.
--
-- Booking BUKAN kunjungan. Dia cuma permintaan yang belum tentu jadi: staf klinik
-- yang memutuskan, dan kunjungan baru lahir saat pendaftaran. Kalau booking
-- langsung menulis ke `visits`, antrian bisa penuh oleh pesanan iseng dari orang
-- yang tidak pernah datang.

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  branch_id uuid not null references branches(id),
  poli text not null default 'Poli Umum',
  tanggal date not null,
  jam text not null,                       -- "HH:MM", jam buka klinik saja

  nama_pemilik text not null,
  phone text not null,
  nama_hewan text not null,
  jenis_hewan text not null default 'Anjing',
  keluhan text,

  -- baru → dikonfirmasi / ditolak. "batal" dipakai kalau pemiliknya membatalkan.
  status text not null default 'baru' check (status in ('baru', 'dikonfirmasi', 'ditolak', 'batal')),
  catatan_staf text,
  handled_by uuid references auth.users(id),
  handled_at timestamptz,
  -- Terisi kalau booking sudah diubah jadi pendaftaran; sekaligus mencegah satu
  -- booking dipakai mendaftar dua kali.
  visit_id uuid references visits(id)
);

create index if not exists idx_bookings_status on bookings (status, tanggal);
create index if not exists idx_bookings_phone on bookings (phone, tanggal);

alter table bookings enable row level security;

-- Formulir booking terbuka untuk umum (tanpa login), jadi INSERT-nya dipagari di
-- database, bukan cuma di layar: status awal wajib 'baru' dan kolom keputusan staf
-- tidak boleh diisi dari luar.
drop policy if exists bookings_public_insert on bookings;
create policy bookings_public_insert on bookings for insert to anon
  with check (
    status = 'baru'
    and visit_id is null and handled_by is null and catatan_staf is null
    and length(nama_pemilik) between 2 and 80
    and length(phone) between 8 and 20
    and length(nama_hewan) between 1 and 60
    and tanggal >= current_date and tanggal <= current_date + 60
  );

-- Publik TIDAK boleh membaca booking siapa pun (termasuk miliknya sendiri): daftar
-- itu berisi nomor HP orang lain. Konfirmasi dikirim staf lewat WA/telepon.
drop policy if exists bookings_staff_all on bookings;
create policy bookings_staff_all on bookings for all to authenticated using (true) with check (true);

-- Daftar cabang klinik perlu terbaca halaman publik untuk isi dropdown-nya.
-- Yang dibuka hanya cabang aktif — alamat kliniknya memang informasi publik.
drop policy if exists branches_public_read on branches;
create policy branches_public_read on branches for select to anon using (is_active);

-- Rem anti-iseng: satu nomor HP maksimal 5 booking aktif dalam sehari. Ditaruh di
-- database karena pengirimnya anonim — pagar di layar bisa dilewati dengan mudah.
create or replace function cek_batas_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare jumlah int;
begin
  select count(*) into jumlah from bookings
   where phone = new.phone and tanggal = new.tanggal and status in ('baru', 'dikonfirmasi');
  if jumlah >= 5 then
    raise exception 'Terlalu banyak booking untuk nomor ini pada tanggal tersebut';
  end if;
  return new;
end $$;

drop trigger if exists trg_batas_booking on bookings;
create trigger trg_batas_booking before insert on bookings
  for each row execute function cek_batas_booking();
