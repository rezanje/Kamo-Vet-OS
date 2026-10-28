-- S04 ROLLBACK — WRITES. Hanya bila diputuskan mundur SEBELUM ada penggajian yang memakai kebijakan ini.
-- Menghapus tabel kebijakan beserta isinya; aplikasi otomatis kembali ke perilaku lama (baris dua pelaksana
-- tertahan "perlu keputusan" dan memblokir penggajian). Tidak ada perubahan kode aplikasi yang perlu di-revert.
-- Alternatif yang lebih aman bila tabel sudah dipakai: dari layar Komisi, simpan kebijakan baru "Ditahan" (append-only).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
drop table if exists public.service_commission_policies;
delete from supabase_migrations.schema_migrations where version = '20261026002000';
commit;
