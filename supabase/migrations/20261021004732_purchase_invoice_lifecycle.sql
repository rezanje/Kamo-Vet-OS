-- Immutable purchase history with exact valuation evidence; no historical inference.
alter table public.purchase_invoices
 add column revision integer not null default 0,
 add column voided_at timestamptz,
 add column voided_on date,
 add column void_reason text,
 add column voided_by uuid references public.profiles(id),
 add column reversal_journal_id uuid references public.journal_entries(id),
 add column replaces_invoice_id uuid unique references public.purchase_invoices(id);
create table public.purchase_invoice_postings(
 invoice_id uuid primary key references public.purchase_invoices(id),
 branch_id uuid references public.branches(id), warehouse_id uuid not null references public.warehouses(id),
 journal_id uuid not null unique references public.journal_entries(id),
 journal_snapshot jsonb not null, dpp numeric not null, ppn numeric not null,
 stock_moves jsonb not null default '[]', created_at timestamptz not null default now()
);
create table public.purchase_invoice_layer_proofs(
 invoice_id uuid not null references public.purchase_invoices(id), layer_id uuid not null,
 before_state jsonb, after_state jsonb not null, allocated boolean not null,
 primary key(invoice_id,layer_id)
);
create table public.purchase_invoice_cancellation_requests(
 actor_id uuid not null references public.profiles(id), request_key text not null,
 payload jsonb not null, result jsonb not null, invoice_id uuid not null references public.purchase_invoices(id),
 primary key(actor_id,request_key)
);
alter table public.purchase_invoice_postings enable row level security;
alter table public.purchase_invoice_layer_proofs enable row level security;
alter table public.purchase_invoice_cancellation_requests enable row level security;
revoke all on public.purchase_invoice_postings,public.purchase_invoice_layer_proofs,public.purchase_invoice_cancellation_requests from public,anon,authenticated,service_role;

create function public.guard_purchase_invoice_write() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role') then raise exception 'Faktur hanya dapat diubah melalui proses pembelian resmi' using errcode='42501';end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_purchase_invoice_write() from public,anon,authenticated,service_role;
create trigger purchase_invoice_write_guard before insert or update or delete on public.purchase_invoices for each row execute function public.guard_purchase_invoice_write();
create trigger purchase_invoice_items_write_guard before insert or update or delete on public.purchase_invoice_items for each row execute function public.guard_purchase_invoice_write();
revoke insert,update,delete on public.purchase_invoices,public.purchase_invoice_items from authenticated,anon,service_role;
create function public.guard_purchase_invoice_journal() returns trigger language plpgsql set search_path='' as $$
declare protected boolean;begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then protected:=new.source in ('purchase-invoice','purchase-invoice-void') or old.source in ('purchase-invoice','purchase-invoice-void');
  else select exists(select 1 from public.journal_entries where id in(new.entry_id,old.entry_id) and source in ('purchase-invoice','purchase-invoice-void')) into protected;end if;
  if protected then raise exception 'Riwayat jurnal faktur dilindungi' using errcode='42501';end if;
 end if;return coalesce(new,old);
end$$;
revoke all on function public.guard_purchase_invoice_journal() from public,anon,authenticated,service_role;
create trigger purchase_invoice_journal_guard before insert or update or delete on public.journal_entries for each row execute function public.guard_purchase_invoice_journal();
create trigger purchase_invoice_journal_lines_guard before insert or update or delete on public.journal_lines for each row execute function public.guard_purchase_invoice_journal();

create function public.guard_purchase_invoice_stock_move() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role') and
  (new.source in ('faktur-langsung','purchase-invoice-void') or old.source in ('faktur-langsung','purchase-invoice-void')) then
  raise exception 'Riwayat stok faktur dilindungi' using errcode='42501';
 end if;return coalesce(new,old);
end$$;
revoke all on function public.guard_purchase_invoice_stock_move() from public,anon,authenticated,service_role;
create trigger purchase_invoice_stock_move_guard before insert or update or delete on public.stock_moves for each row execute function public.guard_purchase_invoice_stock_move();

create function public.purchase_invoice_scope(p_branch uuid,p_warehouse uuid,p_supplier uuid) returns void language plpgsql security definer set search_path='' as $$
declare wh public.warehouses%rowtype;begin
 perform public.purchase_assert_access('invoice',p_branch);
 perform 1 from public.branches where id=p_branch and is_active for share;
 if p_branch is not null and not found then raise exception 'Cabang faktur tidak aktif' using errcode='42501';end if;
 select * into wh from public.warehouses where id=p_warehouse for share;
 if not found or not wh.is_active or wh.branch_id is distinct from p_branch then raise exception 'Gudang faktur tidak aktif atau tidak sesuai cabang';end if;
 perform public.purchase_assert_access('invoice',wh.branch_id);
 perform 1 from public.suppliers where id=p_supplier for share;
 if not found then raise exception 'Pemasok faktur tidak ditemukan';end if;
 perform public.purchase_assert_access('invoice',p_branch);
end$$;
revoke all on function public.purchase_invoice_scope(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.purchase_invoice_journal_snapshot(p_id uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('entry',to_jsonb(e),'lines',(select jsonb_agg(to_jsonb(l) order by l.id) from public.journal_lines l where l.entry_id=e.id)) from public.journal_entries e where e.id=p_id
$$;
revoke all on function public.purchase_invoice_journal_snapshot(uuid) from public,anon,authenticated,service_role;

create function public.purchase_invoice_source_active(p_invoice uuid) returns void language plpgsql security definer set search_path='' as $$
declare r record;begin
 for r in select distinct item_id from public.purchase_invoice_items where invoice_id=p_invoice order by item_id loop
  perform 1 from public.items where id=r.item_id and is_active for share;
  if not found then raise exception 'Barang sumber faktur tidak aktif' using errcode='42501';end if;
 end loop;
 for r in select distinct l.account_id from public.purchase_invoice_postings p join public.journal_lines l on l.entry_id=p.journal_id where p.invoice_id=p_invoice order by l.account_id loop
  perform 1 from public.coa_accounts where id=r.account_id and is_active and not is_header for share;
  if not found then raise exception 'Akun sumber faktur tidak aktif' using errcode='42501';end if;
 end loop;
end$$;
revoke all on function public.purchase_invoice_source_active(uuid) from public,anon,authenticated,service_role;

-- Expand existing recovery storage, keeping historical canonical payloads compatible.
alter table public.purchase_operations drop constraint purchase_operations_kind_check;
alter table public.purchase_operations add constraint purchase_operations_kind_check check(kind in ('receipt','invoice','invoice-direct','asset'));
do $$declare body text;begin
 select pg_get_functiondef('public.purchase_assert_access(text,uuid)'::regprocedure) into body;
 body:=replace(body,'''receipt'',''invoice'',''asset''','''receipt'',''invoice'',''invoice-direct'',''asset''');execute body;
 select pg_get_functiondef('public.recover_purchase_operation(text,text,jsonb)'::regprocedure) into body;
 body:=replace(body,'elsif p_kind=''asset''then v_branch:',E'elsif p_kind=''invoice-direct'' then\n  select branch_id into v_branch from public.warehouses where id=(p_payload->>''warehouse_id'')::uuid;\n  perform public.purchase_invoice_scope(v_branch,(p_payload->>''warehouse_id'')::uuid,(p_payload->>''supplier_id'')::uuid);\n elsif p_kind=''asset''then v_branch:');execute body;
 select pg_get_functiondef('public.get_purchase_operation_result(text,text)'::regprocedure) into body;
 body:=replace(body,'elsif p_kind=''asset''then',E'elsif p_kind=''invoice-direct'' then\n  select branch_id into v_branch from public.warehouses where id=(v_operation.payload->>''warehouse_id'')::uuid;\n  perform public.purchase_invoice_scope(v_branch,(v_operation.payload->>''warehouse_id'')::uuid,(v_operation.payload->>''supplier_id'')::uuid);\n elsif p_kind=''asset''then');execute body;
 -- All remaining-quantity checks ignore voided originals; original rows remain intact.
 select pg_get_functiondef('public.create_purchase_invoice_from_po_internal(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric)'::regprocedure) into body;
 body:=replace(body,'where inv.po_id = p_po_id','where inv.voided_at is null and inv.po_id = p_po_id');execute body;
end$$;

create function public.purchase_invoice_replacement(p_source uuid,p_po uuid,p_supplier uuid,p_branch uuid,p_warehouse uuid) returns void language plpgsql security definer set search_path='' as $$
declare src public.purchase_invoices%rowtype;proof public.purchase_invoice_postings%rowtype;begin
 if p_source is null then return;end if;
 select * into src from public.purchase_invoices where id=p_source for update;
 select * into proof from public.purchase_invoice_postings where invoice_id=p_source;
 if src.id is null or src.voided_at is null or proof.invoice_id is null or src.po_id is distinct from p_po
  or src.supplier_id is distinct from p_supplier or proof.branch_id is distinct from p_branch or proof.warehouse_id is distinct from p_warehouse then raise exception 'Faktur pengganti tidak sesuai sumber pembatalan';end if;
 perform public.purchase_invoice_scope(proof.branch_id,proof.warehouse_id,src.supplier_id);
 if exists(select 1 from public.purchase_invoices where replaces_invoice_id=p_source) then raise exception 'Faktur pengganti sudah tersimpan. Buka riwayat faktur';end if;
end$$;
revoke all on function public.purchase_invoice_replacement(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- The legacy signature stays available; client layer proposals never authorize valuation writes.
drop function public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text);
create function public.create_purchase_invoice_from_po(
 p_po_id uuid,p_no_faktur_prefix text,p_no_faktur_digits integer,p_no_faktur_pemasok text,
 p_tanggal date,p_jatuh_tempo date,p_keterangan text,p_items jsonb,p_layer_updates jsonb,p_layer_inserts jsonb,p_ppn numeric,p_request_key text,
 p_replaces_invoice_id uuid default null
)returns table(invoice_id uuid,no_faktur varchar(30),no_jurnal varchar(24),total numeric)
language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders%rowtype;r record;u record;layer public.stock_layers%rowtype;cfg record;
 payload jsonb;result jsonb;canonical jsonb;trusted jsonb:='[]';updates jsonb:='[]';inserts jsonb:='[]';before_layers jsonb;allocated uuid[]:='{}';
 total_value numeric;billed numeric;accepted numeric;dpp numeric;ppn numeric;remaining numeric;take numeric;new_cost numeric;old_cost numeric;v_invoice uuid;v_journal uuid;wh uuid;has_returns boolean;
begin
 perform public.purchase_assert_access('invoice',null);
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Rincian faktur tidak valid';end if;
 select jsonb_agg(jsonb_build_object('po_item_id',x->>'po_item_id','qty',(x->>'qty')::numeric,'harga',(x->>'harga')::numeric) order by x->>'po_item_id') into canonical from jsonb_array_elements(p_items)x;
 payload:=jsonb_build_object('po_id',p_po_id,'tanggal',p_tanggal,'jatuh_tempo',p_jatuh_tempo,'no_faktur_pemasok',p_no_faktur_pemasok,'keterangan',p_keterangan,'items',canonical);
 if p_replaces_invoice_id is not null then payload:=payload||jsonb_build_object('replaces_invoice_id',p_replaces_invoice_id);end if;
 result:=public.recover_purchase_operation('invoice',p_request_key,payload);
 select * into po from public.purchase_orders where id=p_po_id for update;
 perform public.purchase_invoice_scope(po.branch_id,po.to_warehouse_id,po.supplier_id);
 if result is not null then return query select (result->>'invoice_id')::uuid,(result->>'no_faktur')::varchar(30),(result->>'no_jurnal')::varchar(24),(result->>'total')::numeric;return;end if;
 perform public.purchase_payment_period(p_tanggal,p_tanggal);
 if p_jatuh_tempo is null or not isfinite(p_jatuh_tempo) or p_jatuh_tempo<p_tanggal then raise exception 'Jatuh tempo faktur tidak valid';end if;
 perform 1 from public.purchase_invoices where po_id=p_po_id order by id for update;
 perform public.purchase_invoice_replacement(p_replaces_invoice_id,p_po_id,po.supplier_id,po.branch_id,po.to_warehouse_id);
 has_returns:=exists(select 1 from public.purchase_returns where po_id=p_po_id);
 -- Old unproven invoices could already have repriced the same receipt. Never guess ownership.
 if exists(select 1 from public.purchase_invoices i where i.po_id=p_po_id and i.voided_at is null and not exists(select 1 from public.purchase_invoice_postings p where p.invoice_id=i.id)) then raise exception 'Faktur lama memerlukan rekonsiliasi asal nilai stok sebelum faktur tambahan';end if;
 for r in select x.*,i.item_id,i.harga_beli,i.faktor,i.satuan from jsonb_to_recordset(canonical)x(po_item_id uuid,qty numeric,harga numeric) left join public.purchase_order_items i on i.id=x.po_item_id and i.po_id=p_po_id order by i.item_id,x.po_item_id loop
  if r.item_id is null or r.qty is null or r.qty<=0 or r.qty>1e9 or r.harga is null or r.harga<0 or r.harga>1e12 or r.qty::text in ('NaN','Infinity','-Infinity') or r.harga::text in ('NaN','Infinity','-Infinity') or r.qty*r.harga<>round(r.qty*r.harga,2) then raise exception 'Qty dan harga faktur tidak valid';end if;
  select coalesce(sum(ii.qty*ii.faktor),0) into billed from public.purchase_invoice_items ii join public.purchase_invoices i on i.id=ii.invoice_id where i.po_id=p_po_id and i.voided_at is null and ii.po_item_id=r.po_item_id;
  select coalesce(i.qty_terima,i.qty)*i.faktor into accepted from public.purchase_order_items i where i.id=r.po_item_id;
  if billed+r.qty*r.faktor>accepted then raise exception 'Qty faktur melebihi sisa baris PO setelah konversi satuan.';end if;
  select * into u from public.unit_posting_factor(r.item_id,r.satuan);
  if u.factor is distinct from r.faktor or r.harga_beli<0 or r.harga_beli>1e12 or r.qty*r.harga_beli<>round(r.qty*r.harga_beli,2) then raise exception 'Harga atau satuan PO memerlukan rekonsiliasi';end if;
  if not exists(select 1 from public.items where id=r.item_id and coalesce(item_type,'Persediaan')='Persediaan') then raise exception 'Faktur ini khusus barang persediaan';end if;
  trusted:=trusted||jsonb_build_array(jsonb_build_object('po_item_id',r.po_item_id,'qty',r.qty,'harga',r.harga,'expected_harga_po',r.harga_beli,'expected_faktor',r.faktor));
 end loop;
 select sum((x->>'qty')::numeric*(x->>'harga')::numeric) into total_value from jsonb_array_elements(canonical)x;
 select mode_pkp,ppn_rate into cfg from public.company_settings where id for share;
 if cfg.mode_pkp and (cfg.ppn_rate is null or cfg.ppn_rate<0 or cfg.ppn_rate>100 or cfg.ppn_rate::text in ('NaN','Infinity','-Infinity')) then raise exception 'Tarif PPN tidak valid';end if;
 dpp:=case when coalesce(cfg.mode_pkp,false) then least(total_value,round(total_value*100/(100+cfg.ppn_rate))) else total_value end;ppn:=total_value-dpp;
 if p_ppn is distinct from ppn then raise exception 'Pajak berubah. Periksa kembali faktur';end if;
 -- A pre-invoice return already reduced AP and inventory at the PO cost. Only a
 -- first gross invoice at that exact cost can transfer all GRNI without repricing.
 if has_returns and (ppn<>0 or exists(select 1 from public.purchase_invoices where po_id=p_po_id)
  or exists(select 1 from public.purchase_order_items i left join jsonb_to_recordset(canonical)x(po_item_id uuid,qty numeric,harga numeric) on x.po_item_id=i.id
    where i.po_id=p_po_id and coalesce(i.qty_terima,i.qty)>0 and (x.qty is distinct from coalesce(i.qty_terima,i.qty) or x.harga is distinct from i.harga_beli))
  or exists(select 1 from public.purchase_return_items ri join public.purchase_returns rt on rt.id=ri.return_id left join public.purchase_order_items i on i.id=ri.source_line_id and i.po_id=p_po_id
    where rt.po_id=p_po_id and (i.id is null or ri.item_id is distinct from i.item_id or ri.harga is distinct from i.harga_beli/i.faktor or ri.hpp is distinct from ri.qty*i.harga_beli/i.faktor))) then
  raise exception 'Retur sebelum faktur hanya mendukung faktur bruto pertama dengan biaya PO yang sama. Rekonsiliasi perubahan harga atau pajak';
 end if;
 -- Aggregate-stock rows precede all layers, as in receipt and consumption families.
 for r in select distinct i.item_id from public.purchase_order_items i join jsonb_array_elements(canonical)x on i.id=(x->>'po_item_id')::uuid order by i.item_id loop
  perform 1 from public.stock where warehouse_id=po.to_warehouse_id and item_id=r.item_id for update;
  if not found then raise exception 'Stok penerimaan tidak ditemukan. Rekonsiliasi PO';end if;
 end loop;
 perform 1 from public.stock_layers where warehouse_id=po.to_warehouse_id and source='purchase' and source_ref=po.no_po order by id for update;
 select coalesce(jsonb_agg(to_jsonb(l)),'[]') into before_layers from public.stock_layers l where warehouse_id=po.to_warehouse_id and source='purchase' and source_ref=po.no_po;
 -- Receipt layers have no PO-line ID: unequal invoice costs for identical receipt costs are ambiguous.
 if exists(select 1 from jsonb_to_recordset(trusted)x(qty numeric,harga numeric,expected_harga_po numeric,expected_faktor numeric,po_item_id uuid) join public.purchase_order_items i on i.id=x.po_item_id group by i.item_id,x.expected_harga_po/x.expected_faktor having count(distinct x.harga/x.expected_faktor)>1) then raise exception 'Harga faktur berbeda pada asal stok yang sama. Rekonsiliasi baris PO';end if;
 for r in select i.item_id,sum(x.qty*x.expected_faktor) qty,x.expected_harga_po/x.expected_faktor old_cost,x.harga/x.expected_faktor*dpp/total_value new_cost from jsonb_to_recordset(trusted)x(qty numeric,harga numeric,expected_harga_po numeric,expected_faktor numeric,po_item_id uuid) join public.purchase_order_items i on i.id=x.po_item_id group by i.item_id,x.expected_harga_po/x.expected_faktor,x.harga/x.expected_faktor order by i.item_id loop
  if has_returns then
   if exists(select 1 from public.stock_layers l where l.warehouse_id=po.to_warehouse_id and l.item_id=r.item_id and l.source='purchase' and l.source_ref=po.no_po and l.unit_cost<>r.old_cost)
    or (select coalesce(sum(l.qty_in),0) from public.stock_layers l where l.warehouse_id=po.to_warehouse_id and l.item_id=r.item_id and l.source='purchase' and l.source_ref=po.no_po)<>r.qty
    or (select coalesce(sum(l.qty_left),0) from public.stock_layers l where l.warehouse_id=po.to_warehouse_id and l.item_id=r.item_id and l.source='purchase' and l.source_ref=po.no_po)<>r.qty-(select coalesce(sum(ri.qty),0) from public.purchase_return_items ri join public.purchase_returns rt on rt.id=ri.return_id where rt.po_id=p_po_id and ri.item_id=r.item_id)
    or r.new_cost<>r.old_cost then raise exception 'Asal nilai stok setelah retur tidak cocok. Rekonsiliasi sebelum faktur';end if;
   allocated:=allocated||array(select l.id from public.stock_layers l where l.warehouse_id=po.to_warehouse_id and l.item_id=r.item_id and l.source='purchase' and l.source_ref=po.no_po);
   continue;
  end if;
  remaining:=r.qty;
  for layer in select l.* from public.stock_layers l where l.warehouse_id=po.to_warehouse_id and l.item_id=r.item_id and l.source='purchase' and l.source_ref=po.no_po and l.unit_cost=r.old_cost and l.qty_left>0
   and not exists(select 1 from public.purchase_invoice_layer_proofs proof join public.purchase_invoices inv on inv.id=proof.invoice_id where proof.layer_id=l.id and proof.allocated and inv.voided_at is null)
   order by l.tanggal,l.created_at,l.id loop
   exit when remaining<=0;take:=least(remaining,layer.qty_left);
   updates:=updates||jsonb_build_array(jsonb_build_object('id',layer.id,'expected_qty_in',layer.qty_in,'expected_qty_left',layer.qty_left,'expected_unit_cost',layer.unit_cost)||case when take=layer.qty_left then jsonb_build_object('unit_cost',r.new_cost) else jsonb_build_object('qty_in',layer.qty_in-take,'qty_left',layer.qty_left-take) end);
   if take=layer.qty_left then allocated:=array_append(allocated,layer.id);
   else inserts:=inserts||jsonb_build_array((to_jsonb(layer)-'id'-'created_at')||jsonb_build_object('qty_in',take,'qty_left',take,'unit_cost',r.new_cost));end if;
   remaining:=remaining-take;
  end loop;
  if remaining>0 then raise exception 'Stok PO sudah terpakai atau asal biaya tidak lengkap. Rekonsiliasi sebelum faktur';end if;
 end loop;
 lock table public.journal_entries in share row exclusive mode;
 select to_jsonb(x) into result from public.create_purchase_invoice_from_po_internal(p_po_id,p_no_faktur_prefix,p_no_faktur_digits,p_no_faktur_pemasok,p_tanggal,p_jatuh_tempo,p_keterangan,trusted,updates,inserts,ppn)x;
 v_invoice:=(result->>'invoice_id')::uuid;
 update public.purchase_invoices set branch_id=po.branch_id,warehouse_id=po.to_warehouse_id,replaces_invoice_id=p_replaces_invoice_id where id=v_invoice;
 select id into v_journal from public.journal_entries where source='purchase-invoice' and source_ref=result->>'no_faktur';
 insert into public.purchase_invoice_postings(invoice_id,branch_id,warehouse_id,journal_id,journal_snapshot,dpp,ppn) values(v_invoice,po.branch_id,po.to_warehouse_id,v_journal,public.purchase_invoice_journal_snapshot(v_journal),dpp,ppn);
 -- Recheck and hold the actual posted accounts after any legacy numbering wait.
 perform public.purchase_invoice_source_active(v_invoice);
 insert into public.purchase_invoice_layer_proofs(invoice_id,layer_id,before_state,after_state,allocated)
 select v_invoice,l.id,b.value,to_jsonb(l),b.value is null or l.id=any(allocated) from public.stock_layers l left join jsonb_array_elements(before_layers)b on (b.value->>'id')::uuid=l.id
 where l.warehouse_id=po.to_warehouse_id and l.source='purchase' and l.source_ref=po.no_po and (b.value is distinct from to_jsonb(l) or l.id=any(allocated));
 perform public.purchase_invoice_scope(po.branch_id,po.to_warehouse_id,po.supplier_id);
 insert into public.purchase_operations(actor_id,kind,request_key,payload,result,branch_id) values(auth.uid(),'invoice',p_request_key,payload,result,po.branch_id);
 return query select v_invoice,(result->>'no_faktur')::varchar(30),(result->>'no_jurnal')::varchar(24),(result->>'total')::numeric;
end$$;
revoke all on function public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid) from public,anon,service_role;
grant execute on function public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid) to authenticated;

alter table public.purchase_invoice_postings add column movement_ids uuid[] not null default '{}';
create function public.create_direct_purchase_invoice(p_request_key text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare wh public.warehouses%rowtype;r record;u record;item public.items%rowtype;cfg record;attachment jsonb;result jsonb;
 invoice uuid:=gen_random_uuid();journal uuid;number text;prefix text;digits integer;seq bigint;d date;due date;supplier uuid;replacement uuid;
 rows jsonb:='[]';total numeric:=0;dpp numeric;ppn numeric;value numeric;allocated numeric:=0;gross_allocated numeric:=0;line_count integer:=0;line_index integer:=0;
 qty_before numeric;layer_id uuid;move_id uuid;moves jsonb:='[]';
begin
 perform public.purchase_assert_access('invoice',null);
 select * into wh from public.warehouses where id=(p_payload->>'warehouse_id')::uuid;
 supplier:=(p_payload->>'supplier_id')::uuid;
 perform public.purchase_invoice_scope(wh.branch_id,wh.id,supplier);
 result:=public.recover_purchase_operation('invoice-direct',p_request_key,p_payload);
 if result is not null then return result;end if;
 d:=(p_payload->>'tanggal')::date;due:=(p_payload->>'jatuh_tempo')::date;
 perform public.purchase_payment_period(d,d);
 if due is null or not isfinite(due) or due<d then raise exception 'Jatuh tempo faktur tidak valid';end if;
 replacement:=nullif(p_payload->>'replaces_invoice_id','')::uuid;
 perform public.purchase_invoice_replacement(replacement,null,supplier,wh.branch_id,wh.id);
 if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 500 then raise exception 'Rincian faktur tidak valid';end if;
 for r in select * from jsonb_to_recordset(p_payload->'items')x(item_id uuid,qty numeric,harga numeric,satuan text,exp_date date) order by item_id,satuan,exp_date,qty,harga loop
  if r.qty is null or r.qty<=0 or r.qty>1e9 or r.harga is null or r.harga<0 or r.harga>1e12 or r.qty::text in ('NaN','Infinity','-Infinity') or r.harga::text in ('NaN','Infinity','-Infinity') or r.qty*r.harga<>round(r.qty*r.harga,2) then raise exception 'Qty atau harga faktur tidak valid';end if;
  select * into u from public.unit_posting_factor(r.item_id,r.satuan);
  select * into item from public.items where id=r.item_id;
  if coalesce(item.item_type,'Persediaan')<>'Persediaan' then raise exception 'Faktur langsung khusus barang persediaan';end if;
  if r.exp_date is not null and (not isfinite(r.exp_date) or r.exp_date<d) then raise exception 'Tanggal kedaluwarsa tidak valid';end if;
  if r.qty*u.factor>1e12 or length(u.unit)>20 then raise exception 'Jumlah atau satuan barang tidak valid';end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('item_id',item.id,'nama',item.name,'qty',r.qty,'harga',r.harga,'satuan',u.unit,'faktor',u.factor,'exp_date',r.exp_date));
  total:=total+r.qty*r.harga;
 end loop;
 if total<=0 or total>1e15 then raise exception 'Nilai faktur tidak valid';end if;
 if jsonb_typeof(p_payload->'lampiran') is distinct from 'array' or jsonb_array_length(p_payload->'lampiran')>100 then raise exception 'Lampiran tidak valid';end if;
 for attachment in select x from jsonb_array_elements(p_payload->'lampiran')x loop
  if coalesce(attachment->>'path','') not like 'pembelian/%' or position('..' in attachment->>'path')>0 or length(attachment->>'path')>500
   or coalesce(length(attachment->>'nama'),0) not between 1 and 200 or length(attachment->>'mime')>120
   or ((attachment->>'ukuran')::numeric is not null and ((attachment->>'ukuran')::numeric<=0 or (attachment->>'ukuran')::numeric>10485760)) then raise exception 'Referensi lampiran tidak valid';end if;
 end loop;
 select mode_pkp,ppn_rate into cfg from public.company_settings where id for share;
 if cfg.mode_pkp and (cfg.ppn_rate is null or cfg.ppn_rate<0 or cfg.ppn_rate>100 or cfg.ppn_rate::text in ('NaN','Infinity','-Infinity')) then raise exception 'Tarif PPN tidak valid';end if;
 dpp:=case when coalesce(cfg.mode_pkp,false) then least(total,round(total*100/(100+cfg.ppn_rate))) else total end;ppn:=total-dpp;
 for r in select distinct (x->>'item_id')::uuid item_id from jsonb_array_elements(rows)x order by 1 loop
  insert into public.stock(warehouse_id,item_id,qty) values(wh.id,r.item_id,0) on conflict(warehouse_id,item_id) do nothing;
  select qty into qty_before from public.stock where warehouse_id=wh.id and item_id=r.item_id for update;
  if qty_before<0 then raise exception 'Stok negatif perlu direkonsiliasi sebelum pembelian langsung';end if;
 end loop;
 lock table public.journal_entries in share row exclusive mode;
 select pola,digit into prefix,digits from public.document_numbering where jenis='FB';
 prefix:=coalesce(prefix,'FB.{YYYY}.{MM}.');digits:=coalesce(digits,5);
 prefix:=replace(replace(replace(replace(prefix,'{YYYY}',to_char(d,'YYYY')),'{YY}',to_char(d,'YY')),'{MM}',to_char(d,'MM')),'{DD}',to_char(d,'DD'));
 if digits not between 1 and 8 or length(prefix)+digits>30 then raise exception 'Format nomor faktur tidak valid';end if;
 perform pg_advisory_xact_lock(hashtext('vetos:purchase-invoice:'||prefix)::bigint);
 select coalesce(max(substring(no_faktur,length(prefix)+1)::bigint),0)+1 into seq from public.purchase_invoices where left(no_faktur,length(prefix))=prefix and substring(no_faktur,length(prefix)+1)~'^[0-9]+$';
 if length(seq::text)>digits then raise exception 'Nomor faktur sudah penuh';end if;
 number:=prefix||lpad(seq::text,digits,'0');
 insert into public.purchase_invoices(id,no_faktur,no_faktur_pemasok,supplier_id,branch_id,warehouse_id,tanggal,jatuh_tempo,total,keterangan,surat_jalan,created_by,replaces_invoice_id)
 values(invoice,number,p_payload->>'no_faktur_pemasok',supplier,wh.branch_id,wh.id,d,due,total,p_payload->>'keterangan',p_payload->>'surat_jalan',auth.uid(),replacement);
 insert into public.purchase_invoice_items(invoice_id,item_id,nama,qty,harga,satuan,faktor,exp_date)
 select invoice,x.item_id,left(x.nama,160),x.qty,x.harga,x.satuan,x.faktor,x.exp_date from jsonb_to_recordset(rows)x(item_id uuid,nama text,qty numeric,harga numeric,satuan text,faktor numeric,exp_date date);
 insert into public.document_attachments(modul,ref_id,path,nama,mime,ukuran,uploaded_by)
 select 'pembelian',invoice,x.path,x.nama,x.mime,x.ukuran,auth.uid() from jsonb_to_recordset(p_payload->'lampiran')x(path text,nama text,mime text,ukuran bigint);
 line_count:=jsonb_array_length(rows);
 for r in select * from jsonb_to_recordset(rows)x(item_id uuid,qty numeric,harga numeric,faktor numeric,exp_date date) loop
  line_index:=line_index+1;
  gross_allocated:=gross_allocated+r.qty*r.harga;
  value:=case when line_index=line_count then dpp-allocated else round(gross_allocated*dpp/total,2)-allocated end;
  allocated:=allocated+value;
  layer_id:=gen_random_uuid();
  perform public.stock_in_fifo(wh.id,r.item_id,r.qty*r.faktor,value/(r.qty*r.faktor),'faktur-langsung',number,d,r.exp_date);
 end loop;
 lock table public.journal_entries in share row exclusive mode;
 journal:=public.clinic_write_journal(d,'Faktur pembelian langsung '||number,'purchase-invoice',number,wh.branch_id,
  jsonb_build_array(jsonb_build_object('code','1301','debit',dpp,'credit',0),jsonb_build_object('code','1105','debit',ppn,'credit',0),jsonb_build_object('code','2101','debit',0,'credit',total)));
 select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') into moves from public.stock_moves m where source='faktur-langsung' and source_ref=number;
 insert into public.purchase_invoice_postings(invoice_id,branch_id,warehouse_id,journal_id,journal_snapshot,dpp,ppn,stock_moves,movement_ids)
 values(invoice,wh.branch_id,wh.id,journal,public.purchase_invoice_journal_snapshot(journal),dpp,ppn,moves,
  array(select id from public.stock_moves where warehouse_id=wh.id and item_id in(select (x->>'item_id')::uuid from jsonb_array_elements(rows)x)));
 insert into public.purchase_invoice_layer_proofs(invoice_id,layer_id,after_state,allocated)
 select invoice,l.id,to_jsonb(l),true from public.stock_layers l where warehouse_id=wh.id and source='faktur-langsung' and source_ref=number;
 perform public.purchase_invoice_scope(wh.branch_id,wh.id,supplier);
 result:=jsonb_build_object('invoice_id',invoice,'no_faktur',number,'no_jurnal',(select no_jurnal from public.journal_entries where id=journal),'total',total);
 insert into public.purchase_operations(actor_id,kind,request_key,payload,result,branch_id) values(auth.uid(),'invoice-direct',p_request_key,p_payload,result,wh.branch_id);
 return result;
end$$;
revoke all on function public.create_direct_purchase_invoice(text,jsonb) from public,anon,service_role;
grant execute on function public.create_direct_purchase_invoice(text,jsonb) to authenticated;

-- Snapshot the movement boundary after PO posting too; a consumed-then-returned layer is not unused stock.
do $$declare body text;begin
 select pg_get_functiondef('public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid)'::regprocedure) into body;
 body:=replace(body,'perform public.purchase_invoice_scope(po.branch_id,po.to_warehouse_id,po.supplier_id);'||chr(10)||' insert into public.purchase_operations',
 E'update public.purchase_invoice_postings set movement_ids=array(select m.id from public.stock_moves m where m.warehouse_id=po.to_warehouse_id and m.item_id in(select ii.item_id from public.purchase_invoice_items ii where ii.invoice_id=v_invoice)) where purchase_invoice_postings.invoice_id=v_invoice;\n perform public.purchase_invoice_scope(po.branch_id,po.to_warehouse_id,po.supplier_id);\n insert into public.purchase_operations');execute body;
end$$;

create function public.cancel_purchase_invoice(p_invoice_id uuid,p_expected_revision integer,p_request_key text,p_reason text,p_tanggal date default (now() at time zone 'Asia/Jakarta')::date) returns jsonb language plpgsql security definer set search_path='' as $$
declare inv public.purchase_invoices%rowtype;proof public.purchase_invoice_postings%rowtype;prior public.purchase_invoice_cancellation_requests%rowtype;
 v_po uuid;r record;layer public.stock_layers%rowtype;payload jsonb;result jsonb;reversal uuid;lines jsonb;today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
 perform public.purchase_assert_access('invoice',null);
 if not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then raise exception 'Pembatalan faktur hanya oleh OWNER' using errcode='42501';end if;
 if p_request_key is null or length(btrim(p_request_key)) not between 1 and 120 or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then raise exception 'Identitas dan alasan pembatalan wajib diisi';end if;
 payload:=jsonb_build_object('invoice_id',p_invoice_id,'revision',p_expected_revision,'reason',btrim(p_reason),'tanggal',p_tanggal);
 perform pg_advisory_xact_lock(hashtextextended('purchase-invoice-cancel:'||auth.uid()::text||':'||p_request_key,0));
 select i.po_id into v_po from public.purchase_invoices i where i.id=p_invoice_id;
 perform 1 from public.purchase_orders p where p.id=v_po for update;
 perform 1 from public.purchase_invoices i where i.po_id=v_po or i.id=p_invoice_id order by i.id for update;
 select * into inv from public.purchase_invoices where id=p_invoice_id;
 select * into proof from public.purchase_invoice_postings where invoice_id=p_invoice_id;
 if inv.id is null then raise exception 'Faktur tidak ditemukan';end if;
 if proof.invoice_id is null then raise exception 'Bukti asal nilai faktur lama belum lengkap. Rekonsiliasi manual diperlukan';end if;
 perform public.purchase_invoice_scope(proof.branch_id,proof.warehouse_id,inv.supplier_id);
 perform public.purchase_invoice_source_active(inv.id);
 if not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then raise exception 'Pembatalan faktur hanya oleh OWNER' using errcode='42501';end if;
 select * into prior from public.purchase_invoice_cancellation_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then if prior.payload is distinct from payload then raise exception 'Kunci pembatalan sudah dipakai dengan rincian berbeda';end if;return prior.result;end if;
 if inv.voided_at is not null or inv.revision is distinct from p_expected_revision then raise exception 'Faktur sudah berubah atau dibatalkan. Muat ulang riwayat';end if;
 perform public.purchase_payment_period(inv.tanggal,p_tanggal);
 if p_tanggal<inv.tanggal or exists(select 1 from public.purchase_invoice_payments where invoice_id=inv.id and tanggal>p_tanggal) then raise exception 'Tanggal pembatalan mendahului faktur atau riwayat pembayaran';end if;
 if proof.ppn>0 and date_trunc('month',inv.tanggal)<>date_trunc('month',p_tanggal) then raise exception 'PPN sudah melewati masa asal. Rekonsiliasi pajak sebelum pembatalan';end if;
 if exists(select 1 from public.purchase_invoice_payments where invoice_id=inv.id and reversal_of is null and voided_at is null)
  or coalesce((select sum(amount) from public.purchase_invoice_payments where invoice_id=inv.id),0)<>0 then raise exception 'Balikkan seluruh pembayaran faktur terlebih dahulu';end if;
 if exists(select 1 from public.payment_order_items b join public.payment_orders o on o.id=b.order_id where b.invoice_id=inv.id and o.status in ('draft','disetujui')) then raise exception 'Batalkan perintah bayar yang masih memesan nilai faktur terlebih dahulu';end if;
 if exists(select 1 from public.purchase_returns where purchase_returns.po_id=inv.po_id) then raise exception 'Faktur memiliki retur PO. Rekonsiliasi retur sebelum pembatalan';end if;
 if not exists(select 1 from public.purchase_invoice_layer_proofs where invoice_id=inv.id) then raise exception 'Bukti nilai stok faktur tidak lengkap';end if;
 for r in select distinct item_id from public.purchase_invoice_items where invoice_id=inv.id order by item_id loop
  perform 1 from public.items where id=r.item_id and is_active for share;
  if not found then raise exception 'Barang sumber tidak aktif. Rekonsiliasi sebelum pembatalan';end if;
  perform 1 from public.stock where warehouse_id=proof.warehouse_id and item_id=r.item_id for update;
  if not found then raise exception 'Saldo stok sumber tidak ditemukan';end if;
 end loop;
 for r in select * from public.purchase_invoice_layer_proofs where invoice_id=inv.id order by layer_id loop
  select * into layer from public.stock_layers where id=r.layer_id for update;
  if not found or to_jsonb(layer) is distinct from r.after_state then raise exception 'Stok atau harga sudah berubah setelah faktur. Rekonsiliasi sebelum pembatalan';end if;
 end loop;
 if exists(select 1 from public.stock_moves m where m.warehouse_id=proof.warehouse_id and m.item_id in(select item_id from public.purchase_invoice_items where invoice_id=inv.id) and m.qty<0 and m.source<>'purchase-invoice-void' and not(m.id=any(proof.movement_ids))) then raise exception 'Barang sudah dipakai setelah faktur. Rekonsiliasi sebelum pembatalan';end if;
 if inv.po_id is null and (select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from public.stock_moves m where source='faktur-langsung' and source_ref=inv.no_faktur) is distinct from proof.stock_moves then raise exception 'Riwayat stok sumber berubah. Rekonsiliasi sebelum pembatalan';end if;
 lock table public.journal_entries in share row exclusive mode;
 if public.purchase_invoice_journal_snapshot(proof.journal_id) is distinct from proof.journal_snapshot then raise exception 'Jurnal sumber berubah. Rekonsiliasi sebelum pembatalan';end if;
 select jsonb_agg(jsonb_build_object('code',a.code,'debit',l.credit,'credit',l.debit) order by l.id) into lines from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=proof.journal_id;
 reversal:=public.clinic_write_journal(p_tanggal,'Pembatalan faktur '||inv.no_faktur||': '||btrim(p_reason),'purchase-invoice-void',inv.no_faktur,proof.branch_id,lines);
 for r in select * from public.purchase_invoice_layer_proofs where invoice_id=inv.id order by layer_id loop
  if r.before_state is null then update public.stock_layers set qty_left=0 where id=r.layer_id;
  else update public.stock_layers set qty_in=(r.before_state->>'qty_in')::numeric,qty_left=(r.before_state->>'qty_left')::numeric,unit_cost=(r.before_state->>'unit_cost')::numeric where id=r.layer_id;end if;
 end loop;
 if inv.po_id is null then
  for r in select * from jsonb_to_recordset(proof.stock_moves)x(warehouse_id uuid,item_id uuid,qty numeric,unit_cost numeric) order by item_id loop
   update public.stock set qty=qty-r.qty,updated_at=now() where warehouse_id=r.warehouse_id and item_id=r.item_id and qty>=r.qty;
   if not found then raise exception 'Stok pembelian langsung tidak cukup untuk pembatalan';end if;
   insert into public.stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values(p_tanggal,r.warehouse_id,r.item_id,-r.qty,r.unit_cost,'purchase-invoice-void',inv.no_faktur);
  end loop;
 else
  -- A PO correction changes valuation only; zero-quantity card entries retain the correction trail.
  for r in select distinct item_id from public.purchase_invoice_items where invoice_id=inv.id loop
   insert into public.stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values(p_tanggal,proof.warehouse_id,r.item_id,0,0,'purchase-invoice-void',inv.no_faktur);
  end loop;
 end if;
 perform public.purchase_invoice_scope(proof.branch_id,proof.warehouse_id,inv.supplier_id);
 if not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then raise exception 'Pembatalan faktur hanya oleh OWNER' using errcode='42501';end if;
 update public.purchase_invoices set voided_at=now(),voided_on=p_tanggal,voided_by=auth.uid(),void_reason=btrim(p_reason),reversal_journal_id=reversal,revision=revision+1 where id=inv.id;
 result:=jsonb_build_object('invoice_id',inv.id,'no_faktur',inv.no_faktur,'reversal_journal_id',reversal,'po_id',inv.po_id);
 insert into public.purchase_invoice_cancellation_requests(actor_id,request_key,payload,result,invoice_id) values(auth.uid(),p_request_key,payload,result,inv.id);
 return result;
end$$;
revoke all on function public.cancel_purchase_invoice(uuid,integer,text,text,date) from public,anon,service_role;
grant execute on function public.cancel_purchase_invoice(uuid,integer,text,text,date) to authenticated;

create function public.get_purchase_invoice_cancellation(p_invoice_id uuid,p_request_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare proof public.purchase_invoice_postings%rowtype;inv public.purchase_invoices%rowtype;result jsonb;begin
 perform public.purchase_assert_access('invoice',null);
 if not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then raise exception 'Pembatalan faktur hanya oleh OWNER' using errcode='42501';end if;
 select * into inv from public.purchase_invoices where id=p_invoice_id;
 select * into proof from public.purchase_invoice_postings where invoice_id=p_invoice_id;
 perform public.purchase_invoice_scope(proof.branch_id,proof.warehouse_id,inv.supplier_id);
 perform pg_advisory_xact_lock(hashtextextended('purchase-invoice-cancel:'||auth.uid()::text||':'||p_request_key,0));
 select q.result into result from public.purchase_invoice_cancellation_requests q where q.actor_id=auth.uid() and q.request_key=p_request_key and q.invoice_id=p_invoice_id;
 perform public.purchase_invoice_scope(proof.branch_id,proof.warehouse_id,inv.supplier_id);
 perform public.purchase_invoice_source_active(inv.id);
 if not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then raise exception 'Pembatalan faktur hanya oleh OWNER' using errcode='42501';end if;
 return result;
end$$;
revoke all on function public.get_purchase_invoice_cancellation(uuid,text) from public,anon,service_role;
grant execute on function public.get_purchase_invoice_cancellation(uuid,text) to authenticated;

-- Existing payment families retain their locking/recovery paths and only exclude void debt.
do $$declare body text;signature text;begin
 foreach signature in array array[
 'public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid)',
 'public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid,integer)',
 'public.mutate_purchase_payment_order(text,text,uuid,integer,jsonb,jsonb)'
 ] loop
  if to_regprocedure(signature) is null then continue;end if;
  select pg_get_functiondef(signature::regprocedure) into body;
  body:=replace(body,'where i.po_id=inv.po_id order by','where i.po_id=inv.po_id and i.voided_at is null order by');
  body:=replace(body,'where po_id=r.po_id order by','where po_id=r.po_id and voided_at is null order by');
  body:=replace(body,'where po_id=row.po_id order by','where po_id=row.po_id and voided_at is null order by');
  -- Direct payment rejects before replay; order writes also have a row guard below.
  body:=replace(body,'perform public.purchase_payment_scope(branch,p_account_id);',E'if inv.voided_at is not null then raise exception ''Faktur sudah dibatalkan'';end if;\n perform public.purchase_payment_scope(branch,p_account_id);');
  execute body;
 end loop;
end$$;
create function public.guard_void_purchase_invoice_consumer() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.purchase_invoices where id=new.invoice_id for update;
 if exists(select 1 from public.purchase_invoices where id=new.invoice_id and voided_at is not null) then raise exception 'Faktur sudah dibatalkan';end if;
 return new;
end$$;
revoke all on function public.guard_void_purchase_invoice_consumer() from public,anon,authenticated,service_role;
create trigger payment_void_invoice_guard before insert or update on public.purchase_invoice_payments for each row execute function public.guard_void_purchase_invoice_consumer();
create trigger payment_order_void_invoice_guard before insert or update on public.payment_order_items for each row execute function public.guard_void_purchase_invoice_consumer();

-- Returns after a correction require reconciliation of their original PO liability basis.
do $$declare body text;begin
 select pg_get_functiondef('public.post_unit_return(text,uuid,text,jsonb,jsonb)'::regprocedure) into body;
 body:=replace(body,'branch:=po.branch_id;wh:=po.to_warehouse_id;',E'branch:=po.branch_id;wh:=po.to_warehouse_id;\n  if exists(select 1 from public.purchase_invoices where po_id=p_source and voided_at is not null) then raise exception ''PO memiliki koreksi faktur. Rekonsiliasi dasar retur terlebih dahulu'';end if;');
 execute body;
end$$;

-- A recovery is read-only, but still requires today's actor and source scope.
do $$declare body text;begin
 select pg_get_functiondef('public.recover_purchase_operation(text,text,jsonb)'::regprocedure) into body;
 body:=replace(body,'perform public.purchase_assert_access(p_kind,v_branch);',E'perform public.purchase_assert_access(p_kind,v_branch);\n if p_kind=''invoice'' then perform public.purchase_invoice_scope(p.branch_id,p.to_warehouse_id,p.supplier_id) from public.purchase_orders p where p.id=(p_payload->>''po_id'')::uuid;end if;');
 body:=replace(body,'return v_existing.result;',E'if p_kind in (''invoice'',''invoice-direct'') then perform public.purchase_invoice_source_active((v_existing.result->>''invoice_id'')::uuid);end if;\n  return v_existing.result;');execute body;
 select pg_get_functiondef('public.get_purchase_operation_result(text,text)'::regprocedure) into body;
 body:=replace(body,'return v_operation.result;',E'if p_kind in (''invoice'',''invoice-direct'') then\n  perform public.purchase_invoice_scope(coalesce(i.branch_id,p.branch_id),coalesce(i.warehouse_id,p.to_warehouse_id),i.supplier_id) from public.purchase_invoices i left join public.purchase_orders p on p.id=i.po_id where i.id=(v_operation.result->>''invoice_id'')::uuid;\n  if not found then raise exception ''Faktur hasil transaksi tidak ditemukan'';end if;\n  perform public.purchase_invoice_source_active((v_operation.result->>''invoice_id'')::uuid);\n end if;\n return v_operation.result;');execute body;
end$$;
