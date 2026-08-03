-- Akses Grup: hak akses modul per peran, bisa diatur pemilik tanpa ganti kode.
--
-- Sebelumnya "siapa boleh buka apa" dipatok di dua tempat berbeda di dalam kode
-- (daftar modul sidebar dan daftar prefix URL di middleware), jadi tiap perubahan
-- hak akses harus lewat developer dan gampang tidak sinkron satu sama lain.
--
-- Aturan yang dijaga:
--   1. Peran TANPA baris di sini memakai aturan bawaan — memasang fitur ini tidak
--      mengubah hak akses siapa pun sampai pemilik benar-benar mengaturnya.
--   2. OWNER tidak pernah dibatasi, bahkan kalau barisnya ada. Tanpa jaminan ini,
--      satu salah centang bisa mengunci pemilik keluar dari aplikasinya sendiri
--      tanpa cara membalikkannya dari dalam aplikasi.

create table role_modules (
  role user_role not null,
  module_id varchar(24) not null,
  created_at timestamptz not null default now(),
  primary key (role, module_id)
);

alter table role_modules enable row level security;

-- Dibaca semua yang sudah login: sidebar dan middleware butuh angka ini tiap
-- permintaan halaman.
create policy role_modules_read on role_modules for select to authenticated using (true);

-- Ditulis HANYA oleh OWNER. Dijaga di database, bukan cuma di server action —
-- kalau cuma di aplikasi, siapa pun yang pegang kunci anon bisa menaikkan
-- aksesnya sendiri lewat API.
create policy role_modules_write on role_modules for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'OWNER'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'OWNER'));

comment on table role_modules is
  'Modul yang boleh dibuka tiap peran. Peran tanpa baris = pakai aturan bawaan di kode. OWNER selalu penuh.';
