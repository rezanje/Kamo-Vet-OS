-- Izin tulis kategori barang — temuan uji manual 2026-07-28.
--
-- `item_categories` lahir di 0001 dengan HANYA policy SELECT (item_categories_read).
-- Selama kategori cuma dibaca (dropdown), itu tidak pernah kelihatan. Begitu halaman
-- CRUD /pos/kategori dibuat (0066), setiap simpan ditolak:
--   "new row violates row-level security policy for table item_categories"
--
-- Sengaja TIDAK memakai `for all`: tanpa policy DELETE, aturan "kategori tidak pernah
-- dihapus, hanya dinonaktifkan" jadi dijaga database, bukan cuma kesepakatan di kode.
-- Pola sama dengan items (items_read / items_insert / items_write).
create policy item_categories_insert on item_categories for insert to authenticated
  with check (true);

create policy item_categories_update on item_categories for update to authenticated
  using (true) with check (true);
