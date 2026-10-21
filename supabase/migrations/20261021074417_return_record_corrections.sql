-- Return-specific corrections. Original documents, quantities and journals survive.
alter table public.sales_returns add column revision integer not null default 0,
 add column voided_at timestamptz, add column voided_on date, add column replaces_return_id uuid unique references public.sales_returns(id);
alter table public.purchase_returns add column revision integer not null default 0,
 add column voided_at timestamptz, add column voided_on date, add column replaces_return_id uuid unique references public.purchase_returns(id);

create table public.return_record_postings(
 kind text not null check(kind in('sales','purchase')), return_id uuid not null,
 source_id uuid not null, branch_id uuid not null references public.branches(id),
 ordinal bigint generated always as identity, snapshot jsonb not null,
 created_at timestamptz not null default now(), primary key(kind,return_id)
);
create table public.return_record_corrections(
 id uuid primary key, kind text not null, return_id uuid not null,
 branch_id uuid not null references public.branches(id), reason text not null,
 physical_evidence text not null, before_value jsonb not null,
 replacement_id uuid, reversal_journal_ids uuid[] not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(kind,return_id), foreign key(kind,return_id) references public.return_record_postings(kind,return_id)
);
create table public.return_record_requests(
 actor_id uuid not null references public.profiles(id), request_key text not null,
 payload jsonb not null, result jsonb not null, primary key(actor_id,request_key)
);
alter table public.return_record_postings enable row level security;
alter table public.return_record_corrections enable row level security;
alter table public.return_record_requests enable row level security;
revoke all on public.return_record_postings,public.return_record_corrections,public.return_record_requests from public,anon,authenticated,service_role;
grant select on public.return_record_postings,public.return_record_corrections to authenticated;
create function public.return_record_visible(p_kind text,p_branch uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 perform public.unit_posting_access(case when p_kind='purchase' then 'purchase-return:' else 'sales-return:' end,p_branch);
 return true;
exception when insufficient_privilege then return false;
end$$;
revoke all on function public.return_record_visible(text,uuid) from public,anon,service_role;
grant execute on function public.return_record_visible(text,uuid) to authenticated;
create policy return_posting_read on public.return_record_postings for select to authenticated
 using(public.return_record_visible(kind,branch_id));
create policy return_correction_read on public.return_record_corrections for select to authenticated
 using(public.return_record_visible(kind,branch_id));

-- Scope remains the existing module/branch scope. No role or module grants.
create function public.return_record_actor(p_kind text,p_branch uuid,p_owner boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and is_active and (not p_owner or role='OWNER') for share;
 if not found then raise exception 'Hanya Super Admin / OWNER aktif yang berhak mengoreksi retur' using errcode='42501';end if;
 perform 1 from public.branches where id=p_branch and is_active for share;
 if not found then raise exception 'Cabang retur tidak aktif' using errcode='42501';end if;
 if not public.user_can_access_branch(p_branch) then raise exception 'Cabang retur tidak dapat diakses' using errcode='42501';end if;
 perform public.unit_posting_access(case when p_kind='purchase' then 'purchase-return:' else 'sales-return:' end,p_branch);
 if p_owner and p_kind='sales' then perform public.sales_assert_access(p_branch);end if;
end$$;

-- Return refunds belong to this lifecycle; the general expense editor cannot
-- detach the refund from its stock/revenue journal or void it independently.
do $$declare body text;needle text:='perform public.expense_assert_access(exp.branch_id,true);';begin
 select pg_get_functiondef('public.revise_expense_atomic(text,uuid,integer,text,jsonb,text)'::regprocedure) into body;
 if position(needle in body)=0 then raise exception 'Expense guard insertion point changed';end if;
 execute replace(body,needle,needle||E'\n if exists(select 1 from public.return_record_postings rp cross join lateral jsonb_array_elements(rp.snapshot->''refunds'') refund where refund->>''id''=exp.id::text) then raise exception ''Refund retur hanya dapat dikoreksi bersama catatan retur'';end if;');
end$$;
revoke all on function public.return_record_actor(text,uuid,boolean) from public,anon,authenticated,service_role;

create function public.return_record_basis(p_kind text,p_source uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('lines',case when p_kind='sales' then
  (select jsonb_agg(jsonb_build_object('id',id,'item_id',item_id,'qty',qty,'harga',harga,'faktor',faktor,'hpp',hpp) order by id) from public.sale_items where sale_id=p_source)
 else (select jsonb_agg(jsonb_build_object('id',id,'item_id',item_id,'qty',qty,'qty_terima',qty_terima,'harga',harga_beli,'faktor',faktor) order by id) from public.purchase_order_items where po_id=p_source) end,
 'tax',(select jsonb_build_object('mode_pkp',mode_pkp,'ppn_rate',ppn_rate) from public.company_settings where id))
$$;
revoke all on function public.return_record_basis(text,uuid) from public,anon,authenticated,service_role;

-- Filter only return totals/quantities, preserving conservative source-cancellation
-- dependency checks. Fail migration if the expected canonical statements changed.
do $$declare f record;body text;needle text;begin
 if to_regprocedure('public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid)') is null then
  raise exception 'Canonical purchase invoice consumer is missing';
 end if;
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f' and p.proname in(
 'post_unit_return','pos_sale_post_refund','pay_purchase_invoice_atomic','pay_purchase_payment_order_atomic','mutate_purchase_payment_order','create_purchase_invoice_from_po','cancel_posted_sale','cancel_purchase_invoice') loop
  -- Some deployed schemas retain the pre-recovery invoker overload. It is not
  -- a canonical consumer and cannot INSERT invoices under any browser/service
  -- role. Do not rewrite it or widen its ACL; unexpected write access fails closed.
  if f.signature=to_regprocedure('public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric)') then
   if (select prosecdef from pg_proc where oid=f.signature)
    or has_table_privilege('authenticated','public.purchase_invoices','INSERT')
    or has_table_privilege('anon','public.purchase_invoices','INSERT')
    or has_table_privilege('service_role','public.purchase_invoices','INSERT') then
    raise exception 'Retired invoice overload has unexpected write authority';
   end if;
   continue;
  end if;
  select pg_get_functiondef(f.signature) into body;
  needle:=case f.proname
   when 'post_unit_return' then 'where rt.sale_id=sale.id'
   when 'pos_sale_post_refund' then 'from public.sales_returns where sale_id=p_sale.id and id<>p_doc'
   when 'pay_purchase_invoice_atomic' then 'from public.purchase_returns where purchase_returns.po_id=inv.po_id'
   when 'pay_purchase_payment_order_atomic' then 'from public.purchase_returns where po_id=r.po_id'
   when 'mutate_purchase_payment_order' then 'from public.purchase_returns where po_id=row.po_id'
   when 'create_purchase_invoice_from_po' then 'where rt.po_id=p_po_id'
   when 'cancel_posted_sale' then 'exists(select 1 from public.sales_returns where sale_id=s.id)'
   when 'cancel_purchase_invoice' then 'exists(select 1 from public.purchase_returns where purchase_returns.po_id=inv.po_id)' end;
  if needle is null or position(needle in body)=0 then raise exception 'Canonical return consumer changed: %',f.signature;end if;
  body:=replace(body,'where rt.po_id=p_source','where rt.voided_at is null and rt.po_id=p_source');
  body:=replace(body,'where rt.sale_id=p_source','where rt.voided_at is null and rt.sale_id=p_source');
  body:=replace(body,'where rt.sale_id=sale.id','where rt.voided_at is null and rt.sale_id=sale.id');
  body:=replace(body,'from public.sales_returns where sale_id=p_sale.id and id<>p_doc','from public.sales_returns where voided_at is null and sale_id=p_sale.id and id<>p_doc');
  body:=replace(body,'from public.sale_payment_refunds f join public.sale_payments p on p.id=f.sale_payment_id where p.sale_id=p_sale.id','from public.sale_payment_refunds f join public.sale_payments p on p.id=f.sale_payment_id join public.sales_returns active_return on active_return.id=f.sales_return_id and active_return.voided_at is null where p.sale_id=p_sale.id');
  body:=replace(body,'from public.sale_payment_refunds f where f.sale_payment_id=p.id','from public.sale_payment_refunds f join public.sales_returns active_return on active_return.id=f.sales_return_id and active_return.voided_at is null where f.sale_payment_id=p.id');
  body:=replace(body,'where purchase_returns.po_id=inv.po_id','where voided_at is null and purchase_returns.po_id=inv.po_id');
  body:=replace(body,'from public.purchase_returns where po_id=r.po_id','from public.purchase_returns where voided_at is null and po_id=r.po_id');
  body:=replace(body,'from public.purchase_returns where po_id=row.po_id','from public.purchase_returns where voided_at is null and po_id=row.po_id');
  body:=replace(body,'Nilai retur melebihi sisa hutang','Nilai retur melebihi sisa hutang. Nota kredit/refund pemasok untuk nilai di luar sisa utang belum didukung; tidak ada transfer otomatis');
  -- Invoice cost/receipt reconciliation must ignore cancelled return details.
  body:=replace(body,'where rt.po_id=p_po_id','where rt.voided_at is null and rt.po_id=p_po_id');
  body:=replace(body,'exists(select 1 from public.purchase_returns where po_id=p_po_id)','exists(select 1 from public.purchase_returns where voided_at is null and po_id=p_po_id)');
  body:=replace(body,'exists(select 1 from public.purchase_returns where purchase_returns.po_id=inv.po_id)','exists(select 1 from public.purchase_returns where voided_at is null and purchase_returns.po_id=inv.po_id)');
  body:=replace(body,'exists(select 1 from public.sales_returns where sale_id=s.id)','exists(select 1 from public.sales_returns where voided_at is null and sale_id=s.id)');
  execute body;
 end loop;
end$$;

-- Keep the existing tested posting logic private; the wrapper captures exact
-- provenance inside the same transaction, including supplier FIFO consumption.
alter function public.post_unit_return(text,uuid,text,jsonb,jsonb) rename to return_record_post_base;
revoke all on function public.return_record_post_base(text,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.post_unit_return(p_kind text,p_source uuid,p_request_key text,p_header jsonb,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare branch uuid;warehouse uuid;result jsonb;doc uuid;ref text;before_layers jsonb;before_moves uuid[];
 before_payments uuid[];snap jsonb;table_name text;items_table text;header_value jsonb;item_values jsonb;expense_values jsonb:='[]';item_ids uuid[];
begin
 if p_kind is null or p_kind not in('sales','purchase') then raise exception 'Jenis retur tidak valid';end if;
 if p_kind='purchase' then
  select branch_id,to_warehouse_id into branch,warehouse from public.purchase_orders where id=p_source for update;
 else
  select branch_id into branch from public.sales where id=p_source for update;
 end if;
 if branch is null then raise exception 'Sumber retur tidak ditemukan';end if;
 perform public.return_record_actor(p_kind,branch,false);
 -- A retry returns its original result without creating a new provenance record.
 select r.result into result from public.unit_posting_requests r where r.actor_id=auth.uid() and r.request_key=p_request_key;
 if found then return public.return_record_post_base(p_kind,p_source,p_request_key,p_header,p_items);end if;
 if not isfinite((p_header->>'tanggal')::date) or (p_header->>'tanggal')::date>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal retur tidak valid';end if;
 if p_kind='sales' and exists(select 1 from public.sales where id=p_source and (voided_at is not null or (payment_plan is not null and payments_finalized_at is null))) then raise exception 'Penjualan dibatalkan atau pembayaran belum selesai';end if;
 lock table public.warehouses in share mode;
 if p_kind='sales' then select id into warehouse from public.warehouses where branch_id=branch and is_active order by type,id limit 1;end if;
 perform 1 from public.company_settings where id for share;
 perform 1 from public.warehouses where id=warehouse and branch_id=branch and is_active for share;
 if warehouse is not null and not found then raise exception 'Gudang retur tidak aktif atau berbeda cabang';end if;
 select array_agg(id) into item_ids from (select (x->>'item_id')::uuid id from jsonb_array_elements(p_items)x
  union select c.component_item_id from public.sale_item_group_components c join public.sale_items si on si.id=c.sale_item_id where si.sale_id=p_source) affected;
 perform 1 from public.items where id=any(item_ids) order by id for share;
 -- Restrict snapshots to the chosen warehouse. Stocks lock before FIFO layers.
 perform 1 from public.stock where warehouse_id=warehouse and item_id=any(item_ids) order by item_id for update;
 -- Same order as correction: stock first, then the reconciliation ledger lock.
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') into before_layers from public.stock_layers l where warehouse_id=warehouse and item_id=any(item_ids);
 select coalesce(array_agg(id),'{}') into before_moves from public.stock_moves where warehouse_id=warehouse and item_id=any(item_ids);
 select coalesce(array_agg(p.id),'{}') into before_payments from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id where i.po_id=p_source;
 result:=public.return_record_post_base(p_kind,p_source,p_request_key,p_header,p_items);
 doc:=(result->>'document_id')::uuid;ref:=result->>'document_no';
 table_name:=case when p_kind='sales' then 'sales_returns' else 'purchase_returns' end;
 items_table:=case when p_kind='sales' then 'sales_return_items' else 'purchase_return_items' end;
 execute format('select to_jsonb(t) from public.%I t where id=$1',table_name) into header_value using doc;
 execute format('select coalesce(jsonb_agg(to_jsonb(t) order by id),''[]'') from public.%I t where return_id=$1',items_table) into item_values using doc;
 if p_kind='sales' then
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') into expense_values from public.expenses e where deskripsi='Refund retur '||ref||' (struk '||(select no_struk from public.sales where id=p_source)||')' and branch_id=branch;
  if (select sum((x->>'jumlah')::numeric) from jsonb_array_elements(expense_values)x) is distinct from (header_value->>'total')::numeric then raise exception 'Catatan refund hasil retur tidak lengkap';end if;
 end if;
 snap:=jsonb_build_object('header',header_value,'items',item_values,'refunds',expense_values,'payment_ids',to_jsonb(before_payments),'warehouse_id',warehouse,'basis',public.return_record_basis(p_kind,p_source),
  'refund_allocations',(select coalesce(jsonb_agg(to_jsonb(f) order by id),'[]') from public.sale_payment_refunds f where sales_return_id=doc),
  'item_types',(select jsonb_object_agg(id,coalesce(item_type,'Persediaan')) from public.items where id=any(item_ids)),
  'journals',(select coalesce(jsonb_agg(to_jsonb(j)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(l) order by id) from public.journal_lines l where entry_id=j.id)) order by j.id),'[]') from public.journal_entries j where source_ref=ref and source in('sales-return','sales-return-hpp','purchase-return')),
  'moves',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]') from public.stock_moves m where source_ref=ref and source in('retur-jual','retur-jual-group','retur-beli')),
  'stock',(select coalesce(jsonb_agg(jsonb_build_object('warehouse_id',warehouse_id,'item_id',item_id,'qty',qty) order by item_id),'[]') from public.stock where warehouse_id=warehouse and item_id=any(item_ids)),
  'layers',(select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') from public.stock_layers l where source_ref=ref and source in('retur-jual','retur-jual-group')),
  'takes',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'warehouse_id',l.warehouse_id,'item_id',l.item_id,'unit_cost',l.unit_cost,'exp_date',l.exp_date,'qty',(b->>'qty_left')::numeric-l.qty_left) order by l.id),'[]') from public.stock_layers l join jsonb_array_elements(before_layers)b on l.id=(b->>'id')::uuid where (b->>'qty_left')::numeric>l.qty_left),
  'baseline_moves',to_jsonb(before_moves));
 insert into public.return_record_postings(kind,return_id,source_id,branch_id,snapshot) values(p_kind,doc,p_source,branch,snap);
 return result;
end$$;
revoke all on function public.post_unit_return(text,uuid,text,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.post_unit_return(text,uuid,text,jsonb,jsonb) to authenticated;

create function public.correct_return_record(p_kind text,p_return_id uuid,p_expected_revision integer,p_request_key text,p_reason text,p_physical_evidence text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare posting public.return_record_postings%rowtype;prior public.return_record_requests%rowtype;
 payload jsonb;result jsonb;replacement jsonb;original jsonb;details jsonb;source uuid;branch uuid;
 t text;it text;d date:=(now() at time zone 'Asia/Jakarta')::date;closed date;audit uuid:=gen_random_uuid();
 j jsonb;m jsonb;l jsonb;take jsonb;current_value jsonb;reversal uuid;reversals uuid[]:='{}';row_input jsonb;row_original jsonb;unit_value record;warehouse uuid;refund jsonb;
begin
 if p_kind is null or p_kind not in('sales','purchase') or p_return_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(btrim(coalesce(p_reason,''))) not between 3 and 1000
  or length(btrim(coalesce(p_physical_evidence,''))) not between 10 and 2000 or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Identitas, alasan dan bukti fisik retur wajib lengkap';end if;
 t:=case when p_kind='sales' then 'sales_returns' else 'purchase_returns' end;
 it:=case when p_kind='sales' then 'sales_return_items' else 'purchase_return_items' end;
 payload:=jsonb_build_object('kind',p_kind,'return_id',p_return_id,'revision',p_expected_revision,'reason',btrim(p_reason),'physical_evidence',btrim(p_physical_evidence),'items',p_items);
 perform pg_advisory_xact_lock(hashtextextended('vetos:return-correction:'||auth.uid()::text||':'||p_request_key,0));
 execute format('select %I from public.%I where id=$1',case when p_kind='sales' then 'sale_id' else 'po_id' end,t) into source using p_return_id;
 if p_kind='sales' then select branch_id into branch from public.sales where id=source for update;
 else select branch_id into branch from public.purchase_orders where id=source for update;end if;
 if branch is null then raise exception 'Retur tidak ditemukan';end if;
 perform public.return_record_actor(p_kind,branch,true);
 select * into prior from public.return_record_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then if prior.payload is distinct from payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda';end if;return prior.result;end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update',t) into original using p_return_id;
 if (original->>'revision')::integer<>p_expected_revision or original->>'voided_at' is not null then raise exception 'Retur sudah berubah. Muat ulang rincian';end if;
 select * into posting from public.return_record_postings where kind=p_kind and return_id=p_return_id for update;
 if not found then raise exception 'Retur lama belum memiliki provenance stok/jurnal/refund yang pasti. Rekonsiliasi bukti sumber diperlukan; koreksi otomatis diblokir';end if;
 execute format('select coalesce(jsonb_agg(to_jsonb(t) order by id),''[]'') from public.%I t where return_id=$1',it) into details using p_return_id;
 if original is distinct from posting.snapshot->'header' or details is distinct from posting.snapshot->'items' then raise exception 'Dokumen sumber retur berubah; rekonsiliasi diperlukan';end if;
 perform 1 from public.company_settings where id for share;
 if public.return_record_basis(p_kind,source) is distinct from posting.snapshot->'basis' then raise exception 'Dasar harga/satuan/penerimaan atau pajak sumber berubah. Rekonsiliasi retur diperlukan';end if;
 lock table public.warehouses in share mode;
 perform 1 from public.items where posting.snapshot->'item_types' ? id::text order by id for share;
 if (select jsonb_object_agg(id,coalesce(item_type,'Persediaan')) from public.items where posting.snapshot->'item_types' ? id::text) is distinct from posting.snapshot->'item_types' then raise exception 'Jenis barang/komponen berubah. Rekonsiliasi retur diperlukan';end if;
 warehouse:=(posting.snapshot->>'warehouse_id')::uuid;
 if warehouse is not null then
  perform 1 from public.warehouses where id=warehouse and branch_id=branch and is_active for share;
  if not found then raise exception 'Gudang retur tidak aktif atau berbeda cabang';end if;
  if p_kind='sales' and warehouse is distinct from (select id from public.warehouses where branch_id=branch and is_active order by type,id limit 1) then raise exception 'Gudang tujuan retur berubah. Rekonsiliasi diperlukan';end if;
 end if;
 for row_input in select x from jsonb_array_elements(p_items)x loop
  select x into row_original from jsonb_array_elements(details)x where x->>'source_line_id'=row_input->>'source_line_id' and x->>'item_id'=row_input->>'item_id';
  if row_original is null or row_input->>'satuan' is distinct from row_original->>'satuan'
   or (p_kind='sales' and (coalesce(row_input->>'kondisi','baik') is distinct from row_original->>'kondisi' or row_input->>'exp_date' is distinct from row_original->>'exp_date')) then raise exception 'Sumber, satuan, kondisi atau lot koreksi berbeda. Rekonsiliasi diperlukan';end if;
  select * into unit_value from public.unit_posting_factor((row_input->>'item_id')::uuid,row_input->>'satuan',true);
  if unit_value.factor is distinct from (row_original->>'faktor')::numeric then raise exception 'Faktor satuan berubah. Rekonsiliasi diperlukan';end if;
 end loop;
 if exists(select 1 from public.return_record_postings rp where rp.kind=p_kind and rp.source_id=source and rp.ordinal>posting.ordinal
  and not exists(select 1 from public.return_record_corrections c where c.kind=rp.kind and c.return_id=rp.return_id)) then raise exception 'Ada retur lanjutan pada sumber yang sama. Koreksi retur terakhir dahulu';end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if not isfinite((original->>'tanggal')::date) or (original->>'tanggal')::date>d then raise exception 'Tanggal sumber retur tidak valid';end if;
 if closed is not null and ((original->>'tanggal')::date<=closed or d<=closed) then raise exception 'Periode sumber atau koreksi sudah ditutup';end if;
 if p_kind='sales' and exists(select 1 from public.payrolls where periode=to_char((original->>'tanggal')::date,'YYYY-MM')) then raise exception 'Periode komisi sudah masuk penggajian. Rekonsiliasi komisi diperlukan';end if;
 if p_kind='sales' then
  -- Current payroll calculates commission across separate HTTP transactions.
  -- Until that family has an atomic snapshot, checking only existing payrolls
  -- cannot exclude an in-flight calculation. Never modify that payroll flow here.
  lock table public.employees in share mode;
  if exists(select 1 from public.sales s where s.id=source and (s.salesperson_id is not null or exists(select 1 from public.employees e where e.profile_id=s.cashier_id))) then
   raise exception 'Retur terhubung karyawan/komisi. Koreksi otomatis diblokir sampai rekonsiliasi komisi dan penggajian atomik tersedia';
  end if;
 end if;
 if p_kind='purchase' then
  perform 1 from public.purchase_invoices where po_id=source order by id for update;
  if exists(select 1 from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id where i.po_id=source and not (posting.snapshot->'payment_ids' @> jsonb_build_array(p.id))) then raise exception 'Pembayaran faktur berubah setelah retur. Koreksi pembayaran terlebih dahulu';end if;
  if exists(select 1 from public.payment_order_items o join public.purchase_invoices i on i.id=o.invoice_id where i.po_id=source) then raise exception 'Retur terkait perintah bayar. Selesaikan dependensi perintah bayar dahulu';end if;
 end if;
 if (select coalesce(jsonb_agg(to_jsonb(f) order by id),'[]') from public.sale_payment_refunds f where sales_return_id=p_return_id) is distinct from posting.snapshot->'refund_allocations' then raise exception 'Alokasi refund berubah. Rekonsiliasi diperlukan';end if;
 for refund in select x from jsonb_array_elements(posting.snapshot->'refunds')x order by x->>'id' loop
  select to_jsonb(e) into current_value from public.expenses e where id=(refund->>'id')::uuid for update;
  if current_value is distinct from refund then raise exception 'Catatan refund telah dikoreksi atau dibayar. Rekonsiliasi refund diperlukan';end if;
  if current_value->>'journal_entry_id' is not null then raise exception 'Refund sudah diposting melalui pembayaran terpisah';end if;
  if current_value->>'shift_id' is not null then
   perform 1 from public.cashier_shifts where id=(current_value->>'shift_id')::uuid and status='open' for update;
   if not found then raise exception 'Shift refund sudah ditutup. Rekonsiliasi kas diperlukan';end if;
  end if;
 end loop;
 -- Lock aggregate inventory before its layers. The baseline catches any later
 -- sale/transfer/adjustment, including replenishment and backdated transactions.
 for m in select x from jsonb_array_elements(posting.snapshot->'moves')x order by x->>'warehouse_id',x->>'item_id' loop
  perform 1 from public.stock where warehouse_id=(m->>'warehouse_id')::uuid and item_id=(m->>'item_id')::uuid and qty>=0 for update;
  if not found then raise exception 'Saldo stok hilang atau negatif';end if;
  if exists(select 1 from public.stock_moves sm where sm.warehouse_id=(m->>'warehouse_id')::uuid and sm.item_id=(m->>'item_id')::uuid
    and not (posting.snapshot->'baseline_moves' @> jsonb_build_array(sm.id))
    and not exists(select 1 from jsonb_array_elements(posting.snapshot->'moves') own where own->>'id'=sm.id::text)) then raise exception 'Stok retur sudah dipakai/dijual/ditransfer atau memiliki mutasi lanjutan. Rekonsiliasi stok dahulu';end if;
  select to_jsonb(sm) into current_value from public.stock_moves sm where id=(m->>'id')::uuid;
  if current_value is distinct from m then raise exception 'Provenance mutasi retur tidak cocok';end if;
  if (select qty from public.stock where warehouse_id=(m->>'warehouse_id')::uuid and item_id=(m->>'item_id')::uuid) is distinct from
   (select (x->>'qty')::numeric from jsonb_array_elements(posting.snapshot->'stock')x where x->>'warehouse_id'=m->>'warehouse_id' and x->>'item_id'=m->>'item_id') then raise exception 'Saldo stok retur sudah berubah tanpa provenance yang sesuai. Rekonsiliasi stok dahulu';end if;
 end loop;
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 perform public.return_record_actor(p_kind,branch,true);
 for j in select x from jsonb_array_elements(posting.snapshot->'journals')x loop
  select to_jsonb(e)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(jl) order by id) from public.journal_lines jl where entry_id=e.id)) into current_value from public.journal_entries e where id=(j->>'id')::uuid;
  if current_value is distinct from j or j->>'voided_at' is not null then raise exception 'Provenance jurnal retur tidak cocok';end if;
  if exists(select 1 from public.bank_reconciliations r where r.voided_at is null and r.tanggal>=(j->>'tanggal')::date and (
    -- Legacy statements may retain only their COA snapshot. Check it directly,
    -- and also check a current mapping without discarding NULL-account rows.
    exists(select 1 from public.journal_lines jl join public.coa_accounts c on c.id=jl.account_id where jl.entry_id=(j->>'id')::uuid
      and (c.code=r.bank_coa_code or exists(select 1 from public.cash_accounts a where a.id=r.cash_account_id and a.coa_code=c.code)))
    -- With no resolvable legacy mapping, a cash/bank refund cannot be proven
    -- unrelated. Pure AP/inventory journals do not affect a bank statement.
    or (r.cash_account_id is null and not exists(select 1 from public.coa_accounts c
      where c.code=r.bank_coa_code and c.type='ASET' and not c.is_header
       and (c.code in('1101','1102') or exists(select 1 from public.cash_accounts a where a.coa_code=c.code)))
      -- Journal provenance survives deletion of a custom cash-account master.
      and j->>'source'='sales-return')
   )) then raise exception 'Rekonsiliasi bank mencakup retur atau mapping legacy belum pasti. Koreksi/cocokkan rekonsiliasi dahulu';end if;
 end loop;
 if jsonb_array_length(posting.snapshot->'journals')=0 then raise exception 'Jurnal retur tidak lengkap';end if;
 -- Reversal corrects recorded quantities only after the actor has checked the
 -- physical evidence. It neither schedules delivery nor calls a bank/provider.
 if p_kind='sales' then
  for l in select x from jsonb_array_elements(posting.snapshot->'layers')x order by x->>'id' loop
   select to_jsonb(sl) into current_value from public.stock_layers sl where id=(l->>'id')::uuid for update;
   if current_value is distinct from l or (l->>'qty_left')::numeric<>(l->>'qty_in')::numeric then raise exception 'Lapisan retur sudah terpakai atau berubah';end if;
   update public.stock_layers set qty_left=0 where id=(l->>'id')::uuid;
  end loop;
  for m in select x from jsonb_array_elements(posting.snapshot->'moves')x loop
   if (select coalesce(sum((x->>'qty_in')::numeric),0) from jsonb_array_elements(posting.snapshot->'layers')x where x->>'warehouse_id'=m->>'warehouse_id' and x->>'item_id'=m->>'item_id')
     is distinct from (select sum((x->>'qty')::numeric) from jsonb_array_elements(posting.snapshot->'moves')x where x->>'warehouse_id'=m->>'warehouse_id' and x->>'item_id'=m->>'item_id') then raise exception 'Retur menutup stok minus; rekonsiliasi lapisan diperlukan';end if;
   update public.stock set qty=qty-(m->>'qty')::numeric,updated_at=now() where warehouse_id=(m->>'warehouse_id')::uuid and item_id=(m->>'item_id')::uuid;
   insert into public.stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values((original->>'tanggal')::date,(m->>'warehouse_id')::uuid,(m->>'item_id')::uuid,-(m->>'qty')::numeric,(m->>'unit_cost')::numeric,'return-record-void',audit::text);
  end loop;
 else
  for take in select x from jsonb_array_elements(posting.snapshot->'takes')x order by x->>'id' loop
   perform 1 from public.stock_layers sl where id=(take->>'id')::uuid and warehouse_id=(take->>'warehouse_id')::uuid and item_id=(take->>'item_id')::uuid
    and unit_cost=(take->>'unit_cost')::numeric and exp_date is not distinct from (take->>'exp_date')::date and qty_left+(take->>'qty')::numeric<=qty_in for update;
   if not found then raise exception 'Lapisan FIFO pemasok berubah. Rekonsiliasi diperlukan';end if;
   update public.stock_layers set qty_left=qty_left+(take->>'qty')::numeric where id=(take->>'id')::uuid;
  end loop;
  for m in select x from jsonb_array_elements(posting.snapshot->'moves')x loop
   if -(m->>'qty')::numeric is distinct from (select sum((x->>'qty')::numeric) from jsonb_array_elements(posting.snapshot->'takes')x where x->>'warehouse_id'=m->>'warehouse_id' and x->>'item_id'=m->>'item_id') then
    -- Multiple lines for a SKU are checked in aggregate below.
    if (select -sum((x->>'qty')::numeric) from jsonb_array_elements(posting.snapshot->'moves')x where x->>'warehouse_id'=m->>'warehouse_id' and x->>'item_id'=m->>'item_id') is distinct from
       (select sum((x->>'qty')::numeric) from jsonb_array_elements(posting.snapshot->'takes')x where x->>'warehouse_id'=m->>'warehouse_id' and x->>'item_id'=m->>'item_id') then raise exception 'Snapshot FIFO retur pemasok tidak lengkap';end if;
   end if;
   update public.stock set qty=qty-(m->>'qty')::numeric,updated_at=now() where warehouse_id=(m->>'warehouse_id')::uuid and item_id=(m->>'item_id')::uuid;
   insert into public.stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values((original->>'tanggal')::date,(m->>'warehouse_id')::uuid,(m->>'item_id')::uuid,-(m->>'qty')::numeric,(m->>'unit_cost')::numeric,'return-record-void',audit::text);
  end loop;
 end if;
 for j in select x from jsonb_array_elements(posting.snapshot->'journals')x loop
  reversal:=gen_random_uuid();reversals:=array_append(reversals,reversal);
  -- Restate the original OPEN accounting date so return reports and signed
  -- journal history agree, including earlier dates within the open period.
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(reversal,public.sales_next_number('JRN',(original->>'tanggal')::date),(original->>'tanggal')::date,'Koreksi catatan retur '||(original->>'no_retur'),'return-record-void',audit::text,branch);
  insert into public.journal_lines(entry_id,account_id,debit,credit) select reversal,account_id,credit,debit from public.journal_lines where entry_id=(j->>'id')::uuid;
 end loop;
 execute format('update public.%I set voided_at=now(),voided_on=$2,revision=revision+1 where id=$1',t) using p_return_id,d;
 update public.expenses set voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_reason),revision=revision+1
  where id in(select (x->>'id')::uuid from jsonb_array_elements(posting.snapshot->'refunds')x);
 if jsonb_array_length(p_items)>0 then
  replacement:=public.post_unit_return(p_kind,source,'return-replacement:'||audit::text,jsonb_build_object('tanggal',(original->>'tanggal')::date,'keterangan',btrim(p_reason)),p_items);
  execute format('update public.%I set replaces_return_id=$1 where id=$2',t) using p_return_id,(replacement->>'document_id')::uuid;
  -- The link is part of the canonical replacement snapshot too.
  update public.return_record_postings set snapshot=jsonb_set(snapshot,'{header,replaces_return_id}',to_jsonb(p_return_id)) where kind=p_kind and return_id=(replacement->>'document_id')::uuid;
 end if;
 insert into public.return_record_corrections(id,kind,return_id,branch_id,reason,physical_evidence,before_value,replacement_id,reversal_journal_ids,created_by)
 values(audit,p_kind,p_return_id,branch,btrim(p_reason),btrim(p_physical_evidence),posting.snapshot,(replacement->>'document_id')::uuid,reversals,auth.uid());
 result:=jsonb_build_object('return_id',p_return_id,'audit_id',audit,'replacement_id',replacement->>'document_id','replacement_no',replacement->>'document_no','revision',p_expected_revision+1);
 insert into public.return_record_requests values(auth.uid(),p_request_key,payload,result);
 return result;
end$$;
revoke all on function public.correct_return_record(text,uuid,integer,text,text,text,jsonb) from public,anon,service_role;
grant execute on function public.correct_return_record(text,uuid,integer,text,text,text,jsonb) to authenticated;

-- Raw document/audit writes and forged return journals are not a correction API.
revoke insert,update,delete on public.sales_returns,public.sales_return_items,public.purchase_returns,public.purchase_return_items from authenticated,anon,service_role;
create function public.return_record_protected_effect() returns trigger language plpgsql security invoker set search_path='' as $$
declare protected boolean:=false;begin
 if current_user in('authenticated','anon','service_role') then
  if tg_table_name='journal_lines' then select exists(select 1 from public.journal_entries where id in(new.entry_id,old.entry_id) and source in('sales-return','sales-return-hpp','purchase-return','return-record-void')) into protected;
  elsif tg_table_name='expenses' then protected:=exists(select 1 from public.return_record_postings rp cross join lateral jsonb_array_elements(rp.snapshot->'refunds') refund where refund->>'id'=coalesce(new.id,old.id)::text);
  else protected:=coalesce(new.source,'') in('sales-return','sales-return-hpp','purchase-return','return-record-void','retur-jual','retur-jual-group','retur-beli') or coalesce(old.source,'') in('sales-return','sales-return-hpp','purchase-return','return-record-void','retur-jual','retur-jual-group','retur-beli');end if;
  if protected then raise exception 'Efek retur hanya melalui jalur koreksi catatan retur resmi' using errcode='42501';end if;
 end if;return coalesce(new,old);
end$$;
revoke all on function public.return_record_protected_effect() from public,anon,authenticated,service_role;
create trigger return_record_journal_guard before insert or update or delete on public.journal_entries for each row execute function public.return_record_protected_effect();
create trigger return_record_line_guard before insert or update or delete on public.journal_lines for each row execute function public.return_record_protected_effect();
create trigger return_record_move_guard before insert or update or delete on public.stock_moves for each row execute function public.return_record_protected_effect();
create trigger return_record_refund_guard before update or delete on public.expenses for each row execute function public.return_record_protected_effect();

-- Usage metrics must not count the bookkeeping reversal as a new physical
-- outbound movement, or count the superseded supplier return a second time.
-- The stock card continues to show the full, signed and dated stock_moves.
create view public.return_record_effective_stock_moves with(security_invoker=true) as
 select m.* from public.stock_moves m where m.source<>'return-record-void'
 and not (m.source='retur-beli' and exists(select 1 from public.purchase_returns r where r.no_retur=m.source_ref and r.voided_at is not null))
 and not (m.source in('retur-jual','retur-jual-group') and exists(select 1 from public.sales_returns r where r.no_retur=m.source_ref and r.voided_at is not null));
grant select on public.return_record_effective_stock_moves to authenticated;
