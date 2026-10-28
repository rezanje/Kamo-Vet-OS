-- Hanya kalau diputuskan mundur. Mengembalikan tier_settings ke hak tulis UPDATE saja.
-- Baris tier_settings yang sudah dibuat lewat layar TIDAK dihapus (itu data pemilik).
-- Akibat rollback: simpan Pengaturan Loyalitas kembali gagal (sekarang dengan pesan error)
-- bila barisnya belum ada.
begin;
drop policy if exists tier_settings_insert on public.tier_settings;
delete from supabase_migrations.schema_migrations where version = '20261029140000';
commit;
