-- Manajemen pengguna: akun per karyawan (ganti akun demo rame-rame).
-- profiles dapat is_active + admin boleh ubah profil orang lain (set role/nonaktif).

alter table profiles add column is_active boolean not null default true;

create policy profiles_admin_update on profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
