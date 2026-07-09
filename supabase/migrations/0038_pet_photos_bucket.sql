-- Storage bucket buat foto anabul (registrasi pasien klinik).
-- Publik dibaca (foto dipajang di form/rekam medis), tulis hanya user login.

insert into storage.buckets (id, name, public)
values ('pet-photos', 'pet-photos', true)
on conflict (id) do nothing;

create policy pet_photos_read on storage.objects for select to public
  using (bucket_id = 'pet-photos');

create policy pet_photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'pet-photos');

create policy pet_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'pet-photos');
