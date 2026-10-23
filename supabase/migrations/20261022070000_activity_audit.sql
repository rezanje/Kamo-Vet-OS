-- A01: future-only business activity index. Domain audits/journals stay authoritative.
-- No existing source write/read policy or authentication configuration is changed.
create table public.activity_log (
 id bigint generated always as identity primary key,
 occurred_at timestamptz not null default clock_timestamp(),
 actor_id uuid,
 actor_name text not null,
 actor_kind text not null check(actor_kind in ('user','system')),
 module_id text not null,
 entity text not null,
 entity_id text not null,
 entity_ids text[] not null,
 object_label text not null,
 row_entity text not null,
 row_id text not null,
 action text not null check(action in ('create','update','delete')),
 scope text not null check(scope in ('global','branches','all')),
 branch_ids uuid[] not null,
 changed_fields text[] not null,
 before_state jsonb not null,
 after_state jsonb not null
 -- Deliberately no FK: a deleted object/account must not erase evidence.
);
create index activity_log_object_page on public.activity_log(entity,entity_id,id desc);
create index activity_log_object_members on public.activity_log using gin(entity_ids);
create index activity_log_module_page on public.activity_log(module_id,id desc);
create index activity_log_action_page on public.activity_log(action,id desc);
create index activity_log_branches on public.activity_log using gin(branch_ids);
alter table public.activity_log enable row level security;
revoke all on public.activity_log from public,anon,authenticated,service_role;
revoke all on sequence public.activity_log_id_seq from public,anon,authenticated,service_role;
grant select on public.activity_log to authenticated;

-- Existing master-audit reader roles; apply existing source-module overrides
-- and existing branch capabilities/selection. No new role grant.
create function public.activity_log_readable(p_module text,p_scope text,p_branches uuid[])
returns boolean language sql stable security definer set search_path='' as $$
 select auth.role()='authenticated' and exists(
  select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in ('OWNER','ADMIN')
   and (p.role='OWNER' or not exists(select 1 from public.role_modules m where m.role=p.role)
    or exists(select 1 from public.role_modules m where m.role=p.role and m.module_id=p_module))
 ) and case p_scope
  when 'global' then true
  when 'branches' then cardinality(p_branches)>0 and not exists(select 1 from unnest(p_branches) b where not public.user_can_access_branch(b))
  when 'all' then public.has_role_capability('all_branches') and coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-kamo-operational-branch' is null
  else false end;
$$;
revoke all on function public.activity_log_readable(text,text,uuid[]) from public,anon,service_role;
grant execute on function public.activity_log_readable(text,text,uuid[]) to authenticated;
create policy activity_log_read on public.activity_log for select to authenticated
 using(public.activity_log_readable(module_id,scope,branch_ids));

create function public.activity_log_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Log aktivitas bersifat tetap dan tidak dapat diubah atau dihapus' using errcode='42501';end$$;
revoke all on function public.activity_log_immutable() from public,anon,authenticated,service_role;
create trigger activity_log_immutable before update or delete on public.activity_log for each row execute function public.activity_log_immutable();
create trigger activity_log_no_truncate before truncate on public.activity_log for each statement execute function public.activity_log_immutable();

-- Explicit coverage registry, not a client-write API or automatic all-table hook.
create table public.activity_log_sources (
 entity text primary key, module_id text not null, label_key text,
 value_keys text[] not null default '{}',
 scope_kind text not null,
 parent_entity text, parent_key text,
 check((parent_entity is null)=(parent_key is null))
);
revoke all on public.activity_log_sources from public,anon,authenticated,service_role;
alter table public.activity_log_sources enable row level security;

insert into public.activity_log_sources(entity,module_id,label_key,value_keys,scope_kind) values
 ('items','pos','code',array['code','sell_price','buy_price','min_stock','is_active','trashed_at','lifecycle_revision'],'global'),
 ('customers','crm',null,array['tier','points','total_spending'],'global'),
 ('brands','pos',null,array['is_active','trashed_at','lifecycle_revision'],'global'),
 ('units','pos',null,array['is_active','trashed_at','lifecycle_revision'],'global'),
 ('suppliers','pembelian',null,array['is_active','trashed_at','lifecycle_revision'],'global'),
 ('supplier_categories','pembelian',null,array['is_active','trashed_at','lifecycle_revision'],'global'),
 ('sales','pos','no_struk',array['subtotal','discount','total','bayar','kembali','marketplace_status','disbursed_at','voided_at','revision'],'direct'),
 ('sales_quotations','penjualan','no_penawaran',array['tanggal','total','status'],'direct'),
 ('sales_orders','penjualan','no_pesanan',array['tanggal','rencana_kirim','total','status'],'direct'),
 ('sales_deliveries','penjualan','no_kirim',array['tanggal'],'order'),
 ('sales_invoices','penjualan','no_faktur',array['tanggal','jatuh_tempo','dpp','ppn','total','carried_paid','status','voided_on','revision'],'direct'),
 ('purchase_orders','pembelian','no_po',array['tanggal','total','status','revision'],'direct'),
 ('goods_receipts','pembelian','no_terima',array['tanggal'],'po'),
 ('purchase_invoices','pembelian','no_faktur',array['tanggal','jatuh_tempo','total','voided_at','voided_on','revision'],'po'),
 ('visits','klinik',null,array['status'],'direct'),
 ('invoices','klinik','invoice_no',array['subtotal','discount','tax','total','dp_amount','dp_date','paid_status','paid_at','voided_at','correction_pending'],'visit'),
 ('cash_entries','kas-bank','no_bukti',array['jenis','tanggal','jumlah','voided_at','revision'],'direct'),
 ('cash_transfers','kas-bank','no_transfer',array['tanggal','jumlah','biaya_admin','voided_at','revision'],'accounts'),
 ('bank_reconciliations','kas-bank',null,array['tanggal','saldo_bank','saldo_buku','biaya_adm','bunga','selisih','voided_at','revision'],'all'),
 ('expenses','kas-bank',null,array['tanggal','jumlah','metode_bayar','voided_at','revision'],'direct'),
 ('journal_entries','buku-besar','no_jurnal',array['tanggal','voided_at','revision'],'direct'),
 ('fixed_assets','aset-tetap',null,array['tanggal_perolehan','harga_perolehan','nilai_sisa','umur_bulan','status','is_active','correction_revision'],'direct'),
 ('stock_transfers','pos','no_pemindahan',array['proses','tanggal','status'],'warehouses'),
 ('stock_requests','pos','no_request',array['status','priority'],'request'),
 ('stock_receipts','pos','receipt_number',array['received_at'],'request_receipt'),
 ('inventory_adjustments','pos','no_adj',array['tanggal','alasan','nilai_masuk','nilai_keluar'],'warehouse'),
 ('opname_orders','pos','no_opname',array['tanggal_mulai','status'],'warehouse'),
 ('opname_results','pos','no_hasil',array['tanggal'],'opname');

-- Child edits appear in their transaction history, including redacted-only edits.
-- IDs identify the affected line, without copying description/medical/contact text.
insert into public.activity_log_sources(entity,module_id,value_keys,scope_kind,parent_entity,parent_key) values
 ('sale_items','pos',array['qty','harga','item_discount_value','promo_discount','hpp','faktor'],'parent','sales','sale_id'),
 ('sales_quotation_items','penjualan',array['qty','harga'],'parent','sales_quotations','quotation_id'),
 ('sales_order_items','penjualan',array['qty','harga','qty_kirim','qty_faktur'],'parent','sales_orders','order_id'),
 ('sales_delivery_items','penjualan',array['qty','hpp'],'parent','sales_deliveries','delivery_id'),
 ('sales_invoice_items','penjualan',array['qty','harga','hpp'],'parent','sales_invoices','invoice_id'),
 ('purchase_order_items','pembelian',array['qty','harga_beli','qty_terima'],'parent','purchase_orders','po_id'),
 ('goods_receipt_items','pembelian',array['qty_pesan','qty_sisa_sebelum','qty_terima','qty_rusak','harga'],'parent','goods_receipts','receipt_id'),
 ('purchase_invoice_items','pembelian',array['qty','harga'],'parent','purchase_invoices','invoice_id'),
 ('purchase_invoice_payments','pembelian',array['tanggal','amount','voided_at'],'parent','purchase_invoices','invoice_id'),
 ('invoice_items','klinik',array['qty','harga','hpp','diskon_persen','faktor'],'parent','invoices','invoice_id'),
 ('stock_request_items','pos',array['qty_diminta','qty_diterima','kondisi'],'parent','stock_requests','request_id'),
 ('stock_receipt_items','pos',array['qty_ordered','qty_received','condition'],'parent','stock_receipts','stock_receipt_id'),
 ('stock_transfer_items','pos',array['qty','selected_qty','faktor'],'parent','stock_transfers','transfer_id'),
 ('inventory_adjustment_items','pos',array['qty_sistem','qty_baru','selisih','nilai'],'parent','inventory_adjustments','adjustment_id'),
 ('opname_result_items','pos',array['qty_sistem','qty_fisik','selisih'],'parent','opname_results','result_id');

create function public.activity_log_scope(p_kind text,p_row jsonb)
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare ids uuid[]; b uuid;
begin
 case p_kind
 when 'global','all' then return '{}'::uuid[];
 when 'direct' then b:=(p_row->>'branch_id')::uuid;
 when 'visit' then
  select branch_id into b from public.visits where id=(p_row->>'visit_id')::uuid;
  if not found then select branch_ids into ids from public.activity_log where entity='visits' and entity_id=p_row->>'visit_id' order by id desc limit 1;return coalesce(ids,'{}');end if;
 when 'order' then
  select branch_id into b from public.sales_orders where id=(p_row->>'order_id')::uuid;
  if not found then select branch_ids into ids from public.activity_log where entity='sales_orders' and entity_id=p_row->>'order_id' order by id desc limit 1;return coalesce(ids,'{}');end if;
 when 'po' then
  b:=(p_row->>'branch_id')::uuid;
  if b is null then
   select branch_id into b from public.purchase_orders where id=(p_row->>'po_id')::uuid;
   if not found then select branch_ids into ids from public.activity_log where entity='purchase_orders' and entity_id=p_row->>'po_id' order by id desc limit 1;return coalesce(ids,'{}');end if;
  end if;
 when 'warehouse' then select branch_id into b from public.warehouses where id=(p_row->>'warehouse_id')::uuid;
 when 'opname' then
  select w.branch_id into b from public.opname_orders o join public.warehouses w on w.id=o.warehouse_id where o.id=(p_row->>'order_id')::uuid;
  if not found then select branch_ids into ids from public.activity_log where entity='opname_orders' and entity_id=p_row->>'order_id' order by id desc limit 1;return coalesce(ids,'{}');end if;
 when 'request' then
  select array_agg(distinct x) into ids from (select (p_row->>'from_branch_id')::uuid x union select branch_id from public.warehouses where id=(p_row->>'to_warehouse_id')::uuid) branches where x is not null;
  return coalesce(ids,'{}');
 when 'request_receipt' then
  select public.activity_log_scope('request',to_jsonb(r)) into ids from public.stock_requests r where id=(p_row->>'stock_request_id')::uuid;
  if not found then select branch_ids into ids from public.activity_log where entity='stock_requests' and entity_id=p_row->>'stock_request_id' order by id desc limit 1;end if;
  return coalesce(ids,'{}');
 when 'warehouses' then
  select array_agg(distinct branch_id) into ids from public.warehouses where id in ((p_row->>'from_warehouse_id')::uuid,(p_row->>'to_warehouse_id')::uuid);
  return coalesce(ids,'{}');
 when 'accounts' then
  -- A global account requires complete company visibility even if header has a branch.
  if exists(select 1 from public.cash_accounts where id in ((p_row->>'from_account_id')::uuid,(p_row->>'to_account_id')::uuid) and branch_id is null) then return '{}';end if;
  if p_row->>'branch_id' is null then return '{}';end if;
  select array_agg(distinct branches.b order by branches.b) into ids from (
   select branch_id b from public.cash_accounts where id in ((p_row->>'from_account_id')::uuid,(p_row->>'to_account_id')::uuid)
   union select (p_row->>'branch_id')::uuid
  ) branches;
  return coalesce(ids,'{}');
 else raise exception 'Unknown activity scope';
 end case;
 return case when b is null then '{}'::uuid[] else array[b] end;
end$$;
revoke all on function public.activity_log_scope(text,jsonb) from public,anon,authenticated,service_role;

create function public.activity_log_context(p_entity text,p_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.activity_log_sources%rowtype;r jsonb;ids uuid[];result jsonb;
begin
 select * into strict cfg from public.activity_log_sources where entity=p_entity and parent_entity is null;
 execute format('select to_jsonb(t) from public.%I t where id=$1',p_entity) into r using p_id::uuid;
 if r is null then
  select jsonb_build_object('label',object_label,'scope',scope,'branches',branch_ids) into result
  from public.activity_log where entity=p_entity and entity_id=p_id order by id desc limit 1;
  return coalesce(result,jsonb_build_object('label',p_id,'scope','all','branches','[]'::jsonb));
 end if;
 ids:=public.activity_log_scope(cfg.scope_kind,r);
 return jsonb_build_object('label',coalesce(r->>cfg.label_key,p_id),'scope',case when cfg.scope_kind='global' then 'global' when cardinality(ids)>0 then 'branches' else 'all' end,'branches',ids);
end$$;
revoke all on function public.activity_log_context(text,text) from public,anon,authenticated,service_role;

create function public.activity_log_safe_value(p_key text,p_value jsonb)
returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(p_value) in ('number','boolean','null')
  or (jsonb_typeof(p_value)='string' and (
   p_key='code'
   or (p_key=any(array['tanggal','rencana_kirim','jatuh_tempo','tanggal_perolehan','tanggal_mulai','dp_date','paid_at','voided_at','voided_on','trashed_at','received_at','disbursed_at'])
    and (p_value#>>'{}') ~ '^\d{4}-\d{2}-\d{2}(T[0-9:.+Z-]+)?$')
   or (p_key=any(array['status','paid_status','marketplace_status','tier','jenis','proses','alasan','priority','condition','kondisi'])
    and (p_value#>>'{}')=any(array['New','Silver','Gold','Platinum','draft','dikirim','diterima','ditolak','diproses','selesai','batal','Draft','Dipesan','Diterima','Batal','Belum Lunas','DP','Lunas','belum','lunas','pending','Aktif','Nonaktif','active','disposed','Terbuka','Selesai','Sedang dikirim','Diterima Sebagian','Diterima Seluruhnya','Dibatalkan','Masuk','Keluar','Kirim Barang','Terima Barang','rusak','hilang','kadaluarsa','temuan','lainnya','normal','tinggi','baik','kurang','Menunggu Persetujuan','Disetujui','Dikirim','Ditolak','Menunggu','Diperiksa','Pembayaran']))
  ));
$$;
revoke all on function public.activity_log_safe_value(text,jsonb) from public,anon,authenticated,service_role;

create function public.capture_activity_log() returns trigger
language plpgsql security definer set search_path='' as $$
declare cfg public.activity_log_sources%rowtype;
 old_value jsonb:='{}';new_value jsonb:='{}';row_value jsonb;
 before_value jsonb;after_value jsonb;fields text[];ids uuid[];old_ids uuid[];
 root_entity text;root_id text;root_ids text[];ctx jsonb;old_ctx jsonb;label text;scope_value text;actor uuid;actor_label text;kind text;
begin
 select * into strict cfg from public.activity_log_sources where entity=tg_table_name;
 if tg_op<>'INSERT' then old_value:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then new_value:=to_jsonb(new);end if;
 select coalesce(array_agg(k order by k),'{}') into fields
 from (select jsonb_object_keys(old_value||new_value) k) keys
 where k<>all(array['created_at','updated_at']) and old_value->k is distinct from new_value->k;
 if tg_op='UPDATE' and cardinality(fields)=0 then return new;end if;
 row_value:=case when tg_op='DELETE' then old_value else new_value end;
 root_entity:=cfg.entity;root_id:=row_value->>'id';
 if cfg.parent_entity is not null then
  root_entity:=cfg.parent_entity;root_id:=row_value->>cfg.parent_key;
  ctx:=public.activity_log_context(root_entity,root_id);
  label:=ctx->>'label';scope_value:=ctx->>'scope';
  select coalesce(array_agg(b::uuid),'{}') into ids from jsonb_array_elements_text(ctx->'branches') b;
  root_ids:=array[root_id];
  if tg_op='UPDATE' and old_value->>cfg.parent_key is distinct from root_id then
   root_ids:=array[root_id,old_value->>cfg.parent_key];
   old_ctx:=public.activity_log_context(root_entity,old_value->>cfg.parent_key);
   select coalesce(array_agg(distinct b::uuid),'{}') into ids from jsonb_array_elements_text((ctx->'branches')||(old_ctx->'branches')) b;
   if old_ctx->>'scope'='all' or scope_value='all' then scope_value:='all';end if;
  end if;
 else
  root_ids:=case when tg_op='UPDATE' and old_value->>'id' is distinct from root_id then array[root_id,old_value->>'id'] else array[root_id] end;
  ids:=public.activity_log_scope(cfg.scope_kind,row_value);
  scope_value:=case when cfg.scope_kind='global' then 'global' when cardinality(ids)>0 then 'branches' else 'all' end;
  if tg_op='UPDATE' and scope_value<>'global' then
   old_ids:=public.activity_log_scope(cfg.scope_kind,old_value);
   if cardinality(old_ids)=0 then scope_value:='all';else
    select array_agg(distinct b order by b) into ids from unnest(ids||old_ids) b;
   end if;
  end if;
  label:=coalesce(row_value->>cfg.label_key,root_id);
 end if;
 select coalesce(jsonb_object_agg(k,v),'{}') into before_value from jsonb_each(old_value) e(k,v) where k=any(cfg.value_keys) and k=any(fields) and public.activity_log_safe_value(k,v);
 select coalesce(jsonb_object_agg(k,v),'{}') into after_value from jsonb_each(new_value) e(k,v) where k=any(cfg.value_keys) and k=any(fields) and public.activity_log_safe_value(k,v);
 -- JWT subject is supplied by PostgREST/GoTrue, never by business payload/GUC.
 actor:=auth.uid();
 select full_name into actor_label from public.profiles where id=actor;
 kind:=case when actor is null then 'system' else 'user' end;
 insert into public.activity_log(actor_id,actor_name,actor_kind,module_id,entity,entity_id,entity_ids,object_label,row_entity,row_id,action,scope,branch_ids,changed_fields,before_state,after_state)
 values(actor,coalesce(nullif(actor_label,''),case when actor is null then 'Sistem / database' else actor::text end),kind,cfg.module_id,root_entity,root_id,root_ids,left(coalesce(label,root_id),160),cfg.entity,row_value->>'id',
  case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,scope_value,ids,fields,before_value,after_value);
 return coalesce(new,old);
end$$;
revoke all on function public.capture_activity_log() from public,anon,authenticated,service_role;

do $$declare r record;begin
 for r in select entity from public.activity_log_sources loop
  -- BEFORE DELETE retains parent scope before FK cascades remove it. AFTER
  -- INSERT/UPDATE observes final row after existing validation/default triggers.
  execute format('create trigger a01_activity_change after insert or update on public.%I for each row execute function public.capture_activity_log()',r.entity);
  execute format('create trigger a01_activity_delete before delete on public.%I for each row execute function public.capture_activity_log()',r.entity);
 end loop;
end$$;

-- An activity index is not a business usage/reference. Without this exclusion,
-- every audited master would become permanently untrashable/unrenamable merely
-- because its code appeared in its own audit. Existing real references still win.
do $$declare f regprocedure; definition text;begin
 foreach f in array array['public.master_item_code_has_references(text)'::regprocedure,'public.master_data_has_references(text,uuid,text)'::regprocedure] loop
  definition:=pg_get_functiondef(f);
  if position('''master_data_lifecycle_audit'',''profiles''' in definition)=0 then raise exception 'Unexpected master reference helper definition';end if;
  execute replace(definition,'''master_data_lifecycle_audit'',''profiles''','''master_data_lifecycle_audit'',''activity_log'',''profiles''');
 end loop;
end$$;
