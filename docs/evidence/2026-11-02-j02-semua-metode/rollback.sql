-- Rollback 20261106050000_j02_koreksi_semua_metode_pos.sql
-- Aman: fungsi baru hanya menambah jalur koreksi. Koreksi yang sudah tercatat (jejak, jurnal,
-- alokasi) tetap sah dan tetap terbaca; fungsi lama Tunai<->Transfer tidak tersentuh.
-- Aplikasi versi baru memanggil fungsi ini — rollback DB harus disertai rollback aplikasi.
drop function if exists public.correct_pos_sale_payment_methods(uuid,integer,text,text,jsonb);
delete from supabase_migrations.schema_migrations where version='20261106050000';
