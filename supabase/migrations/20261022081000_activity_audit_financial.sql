-- Explicit financial coverage. Existing source ACLs, RLS and guards stay intact.
-- Document headers keep their own identity; lines group into their document.
-- Every referenced branch is required, including old/new references on reparent.
insert into public.activity_log_sources
 (entity,module_id,label_key,value_keys,scope_kind,identity_keys,branch_columns,scope_parents,metadata_only,parent_entity,parent_key)
values
 ('sales_receipts','penjualan','no_terima',array['tanggal','jumlah','dari_uang_muka'],'refs',array['id'],'{}','[{"entity":"sales_invoices","key":"invoice_id"},{"entity":"sales_advances","key":"advance_id"},{"entity":"cash_accounts","key":"account_id"}]',false,null,null),
 ('sales_advances','penjualan','no_um',array['tanggal','jumlah','terpakai','status'],'refs',array['id'],'{}','[{"entity":"sales_orders","key":"order_id"},{"entity":"cash_accounts","key":"account_id"}]',false,null,null),
 ('sales_returns','pos','no_retur',array['tanggal','total','revision','voided_at','voided_on'],'refs',array['id'],'{}','[{"entity":"sales","key":"sale_id"},{"entity":"sales_returns","key":"replaces_return_id"}]',false,null,null),
 ('sales_return_items','pos',null,array['qty','harga','selected_qty','faktor','hpp','kondisi','exp_date'],'refs',array['id'],'{}','[{"entity":"sales_returns","key":"return_id"},{"entity":"sale_items","key":"source_line_id"}]',false,'sales_returns','return_id'),
 ('purchase_advances','pembelian','no_um',array['tanggal','jumlah','terpakai','status'],'refs',array['id'],'{}','[{"entity":"purchase_orders","key":"po_id"},{"entity":"cash_accounts","key":"account_id"}]',false,null,null),
 -- This header has no branch or invoice reference. Do not infer its scope from
 -- whichever child happens to exist at trigger time; require all-branch context.
 ('payment_orders','pembelian','no_pp',array['tanggal','rencana_bayar','total','status','approved_at','paid_at','revision'],'all',array['id'],'{}','[]',false,null,null),
 ('payment_order_items','pembelian',null,array['jumlah'],'refs',array['id'],'{}','[{"entity":"payment_orders","key":"order_id"},{"entity":"purchase_invoices","key":"invoice_id"}]',false,'payment_orders','order_id'),
 ('purchase_returns','pembelian','no_retur',array['tanggal','total','revision','voided_at','voided_on'],'refs',array['id'],'{}','[{"entity":"purchase_orders","key":"po_id"},{"entity":"purchase_returns","key":"replaces_return_id"}]',false,null,null),
 ('purchase_return_items','pembelian',null,array['qty','harga','selected_qty','faktor','hpp'],'refs',array['id'],'{}','[{"entity":"purchase_returns","key":"return_id"},{"entity":"purchase_order_items","key":"source_line_id"}]',false,'purchase_returns','return_id'),
 -- Clinical payment linkage may reveal patient context: retain metadata only.
 ('invoice_payments','klinik',null,'{}','refs',array['id'],'{}','[{"entity":"invoices","key":"invoice_id"},{"entity":"invoices","key":"transferred_from"}]',true,'invoices','invoice_id'),
 ('journal_lines','buku-besar',null,array['debit','credit'],'refs',array['id'],'{}','[{"entity":"journal_entries","key":"entry_id"}]',false,'journal_entries','entry_id'),
 ('asset_depreciations','aset-tetap',null,array['amount'],'refs',array['id'],'{}','[{"entity":"fixed_assets","key":"asset_id"}]',false,'fixed_assets','asset_id'),
 ('asset_changes','aset-tetap',null,array['tanggal','nilai_lama','nilai_baru','umur_lama','umur_baru'],'refs',array['id'],'{}','[{"entity":"fixed_assets","key":"asset_id"}]',false,'fixed_assets','asset_id'),
 ('asset_disposals','aset-tetap',null,array['tanggal','harga_jual','harga_perolehan','akumulasi','nilai_buku','laba_rugi'],'refs',array['id'],'{}','[{"entity":"fixed_assets","key":"asset_id"},{"entity":"cash_accounts","key":"account_id"}]',false,'fixed_assets','asset_id'),
 ('asset_transfers','aset-tetap',null,array['tanggal'],'refs',array['id'],array['dari_branch_id','ke_branch_id'],'[{"entity":"fixed_assets","key":"asset_id"}]',false,'fixed_assets','asset_id'),
 ('po_payments','pembelian',null,array['tanggal','amount'],'refs',array['id'],'{}','[{"entity":"purchase_orders","key":"po_id"}]',false,'purchase_orders','po_id'),
 -- Payment allocations include a frozen bank-account payload. Record metadata
 -- rather than carrying payload or field-level details into the common index.
 ('sale_payments','pos',null,'{}','refs',array['id'],'{}','[{"entity":"sales","key":"sale_id"}]',true,'sales','sale_id'),
 ('sale_payment_refunds','pos',null,array['amount'],'refs',array['id'],'{}','[{"entity":"sales_returns","key":"sales_return_id"},{"entity":"sale_payments","key":"sale_payment_id"},{"entity":"expenses","key":"expense_id"}]',false,'sales_returns','sales_return_id'),
 ('sales_invoice_delivery_allocations','penjualan',null,array['qty','hpp'],'refs',array['invoice_item_id','delivery_item_id'],'{}','[{"entity":"sales_invoice_items","key":"invoice_item_id"},{"entity":"sales_delivery_items","key":"delivery_item_id"}]',false,'sales_invoice_items','invoice_item_id'),
 -- FIFO proof states contain internal row payloads; never copy either payload.
 ('purchase_invoice_layer_proofs','pembelian',null,'{}','refs',array['invoice_id','layer_id'],'{}','[{"entity":"purchase_invoices","key":"invoice_id"},{"entity":"stock_layers","key":"layer_id"}]',true,'purchase_invoices','invoice_id'),
 -- Hybrid command receipt and frozen selling-price fact. The request-key PK
 -- does not make these business snapshot/link mutations a technical-only store.
 ('clinic_compound_sales','klinik',null,'{}','refs',array['request_key'],'{}','[{"entity":"visits","key":"visit_id"},{"entity":"medical_records","key":"medical_record_id"},{"entity":"compounding_recipes","key":"recipe_id"},{"entity":"items","key":"sale_item_id"}]',true,'visits','visit_id');

-- Proof rows have no authenticated read policy or grant. Even metadata must not
-- become visible through the activity viewer to a newly permitted role.
update public.activity_log_sources set reader_roles='{}'
 where entity='purchase_invoice_layer_proofs';

do $$declare source text;begin
 foreach source in array array[
 'sales_receipts','sales_advances','sales_returns','sales_return_items',
 'purchase_advances','payment_orders','payment_order_items','purchase_returns','purchase_return_items',
 'invoice_payments','journal_lines','asset_depreciations','asset_changes','asset_disposals','asset_transfers',
 'po_payments','sale_payments','sale_payment_refunds','sales_invoice_delivery_allocations','purchase_invoice_layer_proofs','clinic_compound_sales'] loop
  execute format('create trigger a01_activity_change after insert or update on public.%I for each row execute function public.capture_activity_log()',source);
  execute format('create trigger a01_activity_delete before delete on public.%I for each row execute function public.capture_activity_log()',source);
 end loop;
end$$;
