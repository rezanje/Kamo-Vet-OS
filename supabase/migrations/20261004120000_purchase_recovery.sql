-- New submissions only. No historical documents or stock are changed.
create table public.purchase_operations (
  actor_id uuid not null references public.profiles(id),
  kind text not null check(kind in ('receipt','invoice','asset')),
  request_key text not null check(length(request_key) between 1 and 100),
  payload jsonb not null,
  result jsonb not null,
  branch_id uuid references public.branches(id),
  created_at timestamptz not null default now(),
  primary key(actor_id,kind,request_key)
);
alter table public.purchase_operations enable row level security;
revoke all on public.purchase_operations from public,anon,authenticated,service_role;

-- Match Akses Grup: OWNER always allowed; explicit per-role rows replace defaults.
create function public.purchase_assert_access(p_kind text,p_branch uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text; v_module text; v_active boolean;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then
  raise exception 'Sesi login diperlukan.' using errcode='42501';
 end if;
 select role::text,is_active into v_role,v_active from public.profiles where id=auth.uid();
 if v_active is not true then raise exception 'Akun pengguna tidak aktif.' using errcode='42501';end if;
 if v_role is null or p_kind is null or p_kind not in ('receipt','invoice','asset') then
  raise exception 'Akses pembelian ditolak.' using errcode='42501';
 end if;
 v_module:=case when p_kind='asset' then 'aset-tetap' else 'pembelian' end;
 if v_role<>'OWNER' then
  if exists(select 1 from public.role_modules where role::text=v_role) then
   if not exists(select 1 from public.role_modules where role::text=v_role and module_id=v_module)then
    raise exception 'Akses modul ditolak.' using errcode='42501';end if;
  elsif v_role='STAFF' or (v_role='FINANCE' and p_kind<>'asset')then
   raise exception 'Akses modul ditolak.' using errcode='42501';
  end if;
 end if;
 if p_branch is not null and not public.user_can_access_branch(p_branch)then
  raise exception 'Cabang tidak dapat diakses.' using errcode='42501';end if;
end$$;
revoke all on function public.purchase_assert_access(text,uuid)from public,anon,authenticated,service_role;

-- The key lock is acquired before authorization and before any business locks.
-- The payload is canonical business input, not a stale derived layer plan.
create function public.recover_purchase_operation(p_kind text,p_request_key text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_existing public.purchase_operations%rowtype; v_branch uuid;
begin
 if p_request_key is null or p_request_key<>btrim(p_request_key) or length(p_request_key)not between 1 and 100 then
  raise exception 'Kunci transaksi tidak valid. Muat ulang formulir.';end if;
 perform pg_advisory_xact_lock(hashtextextended('purchase-request:'||auth.uid()::text||':'||p_kind||':'||p_request_key,0));
 if p_kind in ('receipt','invoice')then
  select branch_id into v_branch from public.purchase_orders where id=(p_payload->>'po_id')::uuid for update;
  if not found then raise exception 'PO tidak ditemukan.';end if;
 elsif p_kind='asset'then v_branch:=(p_payload->>'branch_id')::uuid;
 end if;
 perform public.purchase_assert_access(p_kind,v_branch);
 select * into v_existing from public.purchase_operations where actor_id=auth.uid()and kind=p_kind and request_key=p_request_key;
 if found then
  -- Check recorded scope as well as the current PO scope on every recovery.
  perform public.purchase_assert_access(p_kind,v_existing.branch_id);
  if v_existing.payload is distinct from p_payload then
   raise exception 'Kunci transaksi sudah dipakai dengan rincian berbeda.';end if;
  return v_existing.result;
 end if;
 return null;
end$$;
revoke all on function public.recover_purchase_operation(text,text,jsonb)from public,anon,service_role;
grant execute on function public.recover_purchase_operation(text,text,jsonb)to authenticated;

create function public.receive_purchase_order(
 p_po_id uuid,p_request_key text,p_no_terima_prefix text,p_no_terima_digits integer,
 p_tanggal date,p_surat_jalan text,p_catatan text,p_rows jsonb
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 v_po public.purchase_orders%rowtype; v_row jsonb; v_batch jsonb;
 v_item public.purchase_order_items%rowtype; v_payload jsonb; v_result jsonb;
 v_receipt uuid:=gen_random_uuid();v_entry uuid:=gen_random_uuid();
 v_no text;v_journal text;v_prefix text;v_seq bigint;v_constraint text;
 v_qty numeric;v_bad numeric;v_batches jsonb;v_sum numeric;v_total numeric:=0;
 v_factor numeric;v_base numeric;v_account uuid;v_grni uuid;v_complete boolean;
 v_warehouse_branch uuid;v_count integer;v_distinct integer;v_exp date;
begin
 if jsonb_typeof(p_rows)is distinct from 'array'or jsonb_array_length(p_rows)=0 or p_tanggal is null then
  raise exception 'Rincian penerimaan tidak valid.';end if;
 v_payload:=jsonb_build_object('po_id',p_po_id,'tanggal',p_tanggal,'surat_jalan',p_surat_jalan,'catatan',p_catatan,'rows',p_rows);
 v_result:=public.recover_purchase_operation('receipt',p_request_key,v_payload);
 if v_result is not null then return v_result;end if;
 select * into v_po from public.purchase_orders where id=p_po_id for update;
 perform public.purchase_assert_access('receipt',v_po.branch_id);
 if exists(select 1 from public.accounting_locks where id and closed_until>=p_tanggal)then raise exception 'Periode akuntansi sudah ditutup.';end if;
 if v_po.status in ('Batal','Diterima')then raise exception 'PO batal atau lengkap tidak bisa diterima lagi.';end if;
 if v_po.to_warehouse_id is null then raise exception 'Gudang tujuan wajib diisi.';end if;
 select branch_id into v_warehouse_branch from public.warehouses where id=v_po.to_warehouse_id;
 if not found or (v_po.branch_id is not null and v_warehouse_branch is distinct from v_po.branch_id)then
  raise exception 'Gudang tujuan tidak sesuai cabang PO.';end if;
 perform public.purchase_assert_access('receipt',v_warehouse_branch);
 if p_no_terima_prefix is null or length(p_no_terima_prefix)=0 or p_no_terima_digits is null
  or p_no_terima_digits not between 1 and 8 or length(p_no_terima_prefix)+p_no_terima_digits>30 then
  raise exception 'Format nomor penerimaan tidak valid.';end if;
 select count(*),count(distinct r->>'id')into v_count,v_distinct from jsonb_array_elements(p_rows)r;
 if v_count<>v_distinct then raise exception 'Baris penerimaan kosong atau ganda.';end if;
 if not exists(select 1 from jsonb_array_elements(p_rows)r where (r->>'qty_terima')::numeric>0 or coalesce((r->>'qty_rusak')::numeric,0)>0)then
  raise exception 'Tidak ada barang yang diterima.';end if;
 -- Validate everything against locked PO lines before allocating a receipt.
 for v_row in select r from jsonb_array_elements(p_rows)r order by r->>'id'loop
  v_qty:=(v_row->>'qty_terima')::numeric;v_bad:=coalesce((v_row->>'qty_rusak')::numeric,0);
  select * into v_item from public.purchase_order_items where id=(v_row->>'id')::uuid and po_id=p_po_id for update;
  if not found then raise exception 'Baris penerimaan bukan bagian PO.';end if;
  if v_qty is null or v_qty<0 or v_qty>1e18 or v_bad<0 or v_bad>1e18
   or coalesce(v_item.qty_terima,0)<0 or v_item.qty<=0 or v_item.qty>1e18
   or v_qty+v_bad>v_item.qty-coalesce(v_item.qty_terima,0) then
   raise exception 'Qty penerimaan melebihi sisa atau tidak valid.';end if;
  if v_item.item_id is null or v_item.faktor is null or v_item.faktor<=0 or v_item.faktor>1e18
   or v_item.harga_beli<0 or v_item.harga_beli>1e18 then raise exception 'Barang, harga atau faktor PO tidak valid.';end if;
  -- Stored PO units are authoritative; require their current master conversion to agree.
  select case when coalesce(nullif(v_item.satuan,''),i.unit)=i.unit then 1 else u.factor end into v_factor
   from public.items i left join public.item_units u on u.item_id=i.id and u.unit=v_item.satuan where i.id=v_item.item_id;
  v_base:=v_qty*v_item.faktor;
  if v_factor is distinct from v_item.faktor or v_base>1e18 or v_base::text in ('NaN','Infinity','-Infinity')then
   raise exception 'Satuan PO tidak sesuai master atau qty dasar tidak valid.';end if;
  if v_qty::text in ('NaN','Infinity','-Infinity')or v_bad::text in ('NaN','Infinity','-Infinity')or v_item.harga_beli::text in ('NaN','Infinity','-Infinity')then raise exception 'Angka penerimaan tidak valid.';end if;
  v_batches:=coalesce(v_row->'batches','[]'::jsonb);
  if jsonb_typeof(v_batches)is distinct from 'array'then raise exception 'Batch penerimaan tidak valid.';end if;
  v_sum:=0;
  for v_batch in select b from jsonb_array_elements(v_batches)b loop
   if (v_batch->>'qty')::numeric is null or (v_batch->>'qty')::numeric<=0 or (v_batch->>'qty')::numeric>1e18 then raise exception 'Qty batch tidak valid.';end if;
   v_exp:=nullif(v_batch->>'exp_date','')::date;
   v_sum:=v_sum+(v_batch->>'qty')::numeric;
  end loop;
  if v_sum>v_qty then raise exception 'Jumlah batch melebihi qty diterima.';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('purchase-receipt-number:'||p_no_terima_prefix,0));
 select coalesce(max(substring(g.no_terima,length(p_no_terima_prefix)+1)::bigint),0)+1 into v_seq from public.goods_receipts g
  where left(g.no_terima,length(p_no_terima_prefix))=p_no_terima_prefix and substring(g.no_terima,length(p_no_terima_prefix)+1)~'^[0-9]+$';
 loop
  if length(v_seq::text)>p_no_terima_digits then raise exception 'Nomor penerimaan sudah mencapai batas format.';end if;
  v_no:=p_no_terima_prefix||lpad(v_seq::text,p_no_terima_digits,'0');
  begin
   insert into public.goods_receipts(id,no_terima,po_id,tanggal,surat_jalan,catatan,received_by)
    values(v_receipt,v_no,p_po_id,p_tanggal,p_surat_jalan,p_catatan,auth.uid());exit;
  exception when unique_violation then get stacked diagnostics v_constraint=constraint_name;
   if v_constraint<>'goods_receipts_no_terima_key'then raise;end if;v_seq:=v_seq+1;
  end;
 end loop;
 -- Deterministic SKU order uses the shared aggregate-stock lock before FIFO layers.
 for v_row in select r from jsonb_array_elements(p_rows)r join public.purchase_order_items i on i.id=(r->>'id')::uuid order by i.item_id,i.id loop
  select * into v_item from public.purchase_order_items where id=(v_row->>'id')::uuid;
  v_qty:=(v_row->>'qty_terima')::numeric;v_bad:=coalesce((v_row->>'qty_rusak')::numeric,0);
  if v_qty=0 and v_bad=0 then continue;end if;
  v_batches:=coalesce(v_row->'batches','[]'::jsonb);
  select coalesce(sum((b->>'qty')::numeric),0)into v_sum from jsonb_array_elements(v_batches)b;
  if v_sum<v_qty then v_batches:=v_batches||jsonb_build_array(jsonb_build_object('qty',v_qty-v_sum,'exp_date',nullif(v_row->>'exp_date','')));end if;
  insert into public.goods_receipt_items(receipt_id,po_item_id,item_id,nama,satuan,qty_pesan,qty_sisa_sebelum,qty_terima,qty_rusak,harga,catatan,exp_date,batches)
   values(v_receipt,v_item.id,v_item.item_id,v_item.nama,v_item.satuan,v_item.qty,v_item.qty-coalesce(v_item.qty_terima,0),v_qty,v_bad,v_item.harga_beli,nullif(v_row->>'catatan',''),nullif(v_row->>'exp_date','')::date,v_batches);
  update public.purchase_order_items set qty_terima=coalesce(qty_terima,0)+v_qty,qty_rusak=coalesce(qty_rusak,0)+v_bad where id=v_item.id;
  for v_batch in select b from jsonb_array_elements(v_batches)b loop
   perform public.stock_in_fifo(v_po.to_warehouse_id,v_item.item_id,(v_batch->>'qty')::numeric*v_item.faktor,v_item.harga_beli/v_item.faktor,'purchase',coalesce(v_po.no_po,p_po_id::text),p_tanggal,nullif(v_batch->>'exp_date','')::date);
  end loop;
  v_total:=v_total+v_qty*v_item.harga_beli;
 end loop;
 if v_total>0 then
  select id into v_account from public.coa_accounts where code='1301'and is_active and not is_header;
  select id into v_grni from public.coa_accounts where code='2102'and is_active and not is_header;
  if v_account is null or v_grni is null then raise exception 'Akun persediaan/GRNI tidak aktif.';end if;
  v_prefix:='JRN-'||to_char(p_tanggal,'YYYYMM')||'-';
  perform pg_advisory_xact_lock(hashtext('vetos:journal:'||v_prefix)::bigint);
  select coalesce(max(substring(e.no_jurnal,length(v_prefix)+1)::bigint),0)+1 into v_seq from public.journal_entries e where left(e.no_jurnal,length(v_prefix))=v_prefix and substring(e.no_jurnal,length(v_prefix)+1)~'^[0-9]+$';
  loop
   v_journal:=v_prefix||case when length(v_seq::text)>4 then v_seq::text else lpad(v_seq::text,4,'0')end;
   begin
    insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
     values(v_entry,v_journal,p_tanggal,'Penerimaan barang '||v_no||' ('||coalesce(v_po.no_po,p_po_id::text)||')','purchase',v_no,v_po.branch_id);exit;
   exception when unique_violation then get stacked diagnostics v_constraint=constraint_name;
    if v_constraint<>'journal_entries_no_jurnal_key'then raise;end if;v_seq:=v_seq+1;
   end;
  end loop;
  insert into public.journal_lines(entry_id,account_id,debit,credit)values(v_entry,v_account,v_total,0),(v_entry,v_grni,0,v_total);
 end if;
 select bool_and(coalesce(qty_terima,0)>=qty)into v_complete from public.purchase_order_items where po_id=p_po_id;
 update public.purchase_orders set status=case when v_complete then 'Diterima'::public.po_status else 'Dipesan'::public.po_status end where id=p_po_id;
 v_result:=jsonb_build_object('receipt_id',v_receipt,'no_terima',v_no,'no_po',v_po.no_po,'no_jurnal',v_journal,'complete',v_complete,'total',v_total);
 insert into public.purchase_operations(actor_id,kind,request_key,payload,result,branch_id)values(auth.uid(),'receipt',p_request_key,v_payload,v_result,v_po.branch_id);
 return v_result;
end$$;
revoke all on function public.receive_purchase_order(uuid,text,text,integer,date,text,text,jsonb)from public,anon,service_role;
grant execute on function public.receive_purchase_order(uuid,text,text,integer,date,text,text,jsonb)to authenticated;

-- Unkeyed RPCs become private helpers so callers cannot bypass recovery.
alter function public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric)rename to create_purchase_invoice_from_po_internal;
revoke all on function public.create_purchase_invoice_from_po_internal(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric)from public,anon,authenticated,service_role;
alter function public.create_fixed_asset_purchase(text,uuid,date,numeric,numeric,integer,uuid,text,text)rename to create_fixed_asset_purchase_internal;
revoke all on function public.create_fixed_asset_purchase_internal(text,uuid,date,numeric,numeric,integer,uuid,text,text)from public,anon,authenticated,service_role;

create function public.create_purchase_invoice_from_po(
 p_po_id uuid,p_no_faktur_prefix text,p_no_faktur_digits integer,p_no_faktur_pemasok text,
 p_tanggal date,p_jatuh_tempo date,p_keterangan text,p_items jsonb,p_layer_updates jsonb,p_layer_inserts jsonb,p_ppn numeric,p_request_key text
)returns table(invoice_id uuid,no_faktur varchar(30),no_jurnal varchar(24),total numeric)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_payload jsonb;v_result jsonb;v_branch uuid;v_items jsonb;
begin
 if jsonb_typeof(p_items)is distinct from 'array'or p_ppn::text in ('NaN','Infinity','-Infinity')
  or exists(select 1 from jsonb_array_elements(p_items)r where (r->>'qty')::numeric::text in ('NaN','Infinity','-Infinity')or(r->>'harga')::numeric::text in ('NaN','Infinity','-Infinity'))then
  raise exception 'Qty, harga atau PPN faktur tidak valid.';end if;
 select jsonb_agg(jsonb_build_object('po_item_id',r->>'po_item_id','qty',(r->>'qty')::numeric,'harga',(r->>'harga')::numeric)order by r->>'po_item_id')into v_items from jsonb_array_elements(p_items)r;
 v_payload:=jsonb_build_object('po_id',p_po_id,'tanggal',p_tanggal,'jatuh_tempo',p_jatuh_tempo,'no_faktur_pemasok',p_no_faktur_pemasok,'keterangan',p_keterangan,'items',v_items);
 v_result:=public.recover_purchase_operation('invoice',p_request_key,v_payload);
 if v_result is null then
  select branch_id into v_branch from public.purchase_orders where id=p_po_id;
  perform public.purchase_assert_access('invoice',v_branch);
  select to_jsonb(r)into v_result from public.create_purchase_invoice_from_po_internal(p_po_id,p_no_faktur_prefix,p_no_faktur_digits,p_no_faktur_pemasok,p_tanggal,p_jatuh_tempo,p_keterangan,p_items,p_layer_updates,p_layer_inserts,p_ppn)r;
  insert into public.purchase_operations(actor_id,kind,request_key,payload,result,branch_id)values(auth.uid(),'invoice',p_request_key,v_payload,v_result,v_branch);
 end if;
 return query select (v_result->>'invoice_id')::uuid,(v_result->>'no_faktur')::varchar(30),(v_result->>'no_jurnal')::varchar(24),(v_result->>'total')::numeric;
end$$;
revoke all on function public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text)from public,anon,service_role;
grant execute on function public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text)to authenticated;

create function public.create_fixed_asset_purchase(
 p_nama text,p_category_id uuid,p_tanggal date,p_harga numeric,p_nilai_sisa numeric,p_umur_bulan integer,p_branch_id uuid,p_funding text,p_credit_code text,p_request_key text
)returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_payload jsonb;v_result jsonb;v_asset uuid;
begin
 if p_harga::text in ('NaN','Infinity','-Infinity')or p_nilai_sisa::text in ('NaN','Infinity','-Infinity')then raise exception 'Nilai pembelian aset tidak valid.';end if;
 v_payload:=jsonb_build_object('nama',p_nama,'category_id',p_category_id,'tanggal',p_tanggal,'harga',p_harga,'nilai_sisa',p_nilai_sisa,'umur_bulan',p_umur_bulan,'branch_id',p_branch_id,'funding',p_funding,'credit_code',p_credit_code);
 v_result:=public.recover_purchase_operation('asset',p_request_key,v_payload);
 if v_result is not null then return(v_result->>'asset_id')::uuid;end if;
 v_asset:=public.create_fixed_asset_purchase_internal(p_nama,p_category_id,p_tanggal,p_harga,p_nilai_sisa,p_umur_bulan,p_branch_id,p_funding,p_credit_code);
 insert into public.purchase_operations(actor_id,kind,request_key,payload,result,branch_id)values(auth.uid(),'asset',p_request_key,v_payload,jsonb_build_object('asset_id',v_asset),p_branch_id);
 return v_asset;
end$$;
revoke all on function public.create_fixed_asset_purchase(text,uuid,date,numeric,numeric,integer,uuid,text,text,text)from public,anon,service_role;
grant execute on function public.create_fixed_asset_purchase(text,uuid,date,numeric,numeric,integer,uuid,text,text,text)to authenticated;

-- Read-only recovery after refresh: the form may now show different remaining
-- quantities. This endpoint cannot create or change a business document.
create function public.get_purchase_operation_result(p_kind text,p_request_key text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_operation public.purchase_operations%rowtype;v_branch uuid;
begin
 if p_request_key is null or p_request_key<>btrim(p_request_key)or length(p_request_key)not between 1 and 100 then raise exception 'Kunci transaksi tidak valid.';end if;
 perform pg_advisory_xact_lock(hashtextextended('purchase-request:'||auth.uid()::text||':'||p_kind||':'||p_request_key,0));
 perform public.purchase_assert_access(p_kind,null);
 select * into v_operation from public.purchase_operations where actor_id=auth.uid()and kind=p_kind and request_key=p_request_key;
 if not found then return null;end if;
 perform public.purchase_assert_access(p_kind,v_operation.branch_id);
 if p_kind in ('receipt','invoice')then
  select branch_id into v_branch from public.purchase_orders where id=(v_operation.payload->>'po_id')::uuid for update;
  if not found then raise exception 'PO tidak ditemukan.';end if;
  perform public.purchase_assert_access(p_kind,v_branch);
 end if;
 return v_operation.result;
end$$;
revoke all on function public.get_purchase_operation_result(text,text)from public,anon,service_role;
grant execute on function public.get_purchase_operation_result(text,text)to authenticated;
