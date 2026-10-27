-- U11 ROLLBACK — WRITES (satu fungsi). Jalankan hanya bila diputuskan mundur, lalu revert commit aplikasi U11.
-- Cabang yang sudah dibuat TIDAK dihapus (gudang/transaksi bisa sudah menempel). Hanya jalan pembuatan ditutup.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
drop function if exists public.create_branch(text,text,text,boolean);
delete from supabase_migrations.schema_migrations where version = '20261028131000';
commit;
