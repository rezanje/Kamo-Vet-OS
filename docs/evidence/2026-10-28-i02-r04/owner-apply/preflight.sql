-- I02 preflight (read-only). Semua baris harus ok=true sebelum apply.sql.
select 'post_opname_atomic ada' as cek, to_regprocedure('public.post_opname_atomic(uuid,date,jsonb)') is not null as ok
union all select 'opname_posting_journal ada', to_regprocedure('public.opname_posting_journal(date,uuid,text,text,text,jsonb)') is not null
union all select 'issue_stock_document_recorded ada', to_regprocedure('public.issue_stock_document_recorded(text,uuid,uuid)') is not null
union all select 'akun 1301 & 5902 aktif, bukan header', (select count(*)=2 from public.coa_accounts where code in('1301','5902') and is_active and not is_header)
union all select 'definisi saat ini = kebijakan lama (belum I02)', position('legacy-retail-charge' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))>0
union all select 'stock_opname_account belum ada', to_regprocedure('public.stock_opname_account(text)') is null
union all select 'trigger laporan harga opname terpasang', exists(select 1 from pg_trigger where tgname='opname_price_report_before_receipt' and not tgisinternal);

-- Informasi (bukan syarat): data lama yang TIDAK diubah oleh I02. Catat angkanya untuk readback.
select count(*) as faktur_selisih_stok_lama, coalesce(sum(total),0) as nilai_faktur_lama from public.sales_invoices where kategori='selisih_stok';
select count(*) as jurnal_opname_lama, (select count(*) from public.journal_entries where source='opname-selisih') as jurnal_faktur_selisih_lama from public.journal_entries where source='opname';
