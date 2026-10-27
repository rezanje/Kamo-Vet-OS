-- I02 readback (read-only) setelah apply.sql. Semua ok=true.
select 'kebijakan baru terpasang' as cek, position('uniform-variance-expense' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))>0 as ok
union all select 'tidak ada HPP/faktur toko di posting baru', position('5101' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))=0 and position('sales_invoices' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))=0
union all select 'pemetaan akun: persediaan 1301', public.stock_opname_account('inventory')='1301'
union all select 'pemetaan akun: selisih 5902', public.stock_opname_account('variance')='5902'
union all select 'authenticated boleh posting', has_function_privilege('authenticated','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE')
union all select 'anon tidak boleh posting', not has_function_privilege('anon','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE')
union all select 'pemetaan akun tidak terbuka ke klien', not has_function_privilege('authenticated','public.stock_opname_account(text)','EXECUTE');

-- Bandingkan dengan angka preflight: harus sama persis (data lama tidak diubah).
select count(*) as faktur_selisih_stok_lama, coalesce(sum(total),0) as nilai_faktur_lama from public.sales_invoices where kategori='selisih_stok';
select count(*) as jurnal_opname_lama, (select count(*) from public.journal_entries where source='opname-selisih') as jurnal_faktur_selisih_lama from public.journal_entries where source='opname';
