-- P05: price-only correction before physical receipt/invoice; preserve DP and line identity.
create function public.revise_purchase_order_prices(
 p_request_key text,p_purchase_order_id uuid,p_expected_revision integer,p_items jsonb,p_reason text
)returns jsonb language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare po public.purchase_orders%rowtype;prior public.purchase_order_requests%rowtype;
 payload jsonb;result jsonb;audit_id uuid:=gen_random_uuid();r record;source public.purchase_order_items%rowtype;
 v_total numeric:=0;advances numeric;closed date;before_value jsonb;
begin
 if auth.uid()is null or auth.role()is distinct from 'authenticated' then raise exception 'Sesi login diperlukan'using errcode='42501';end if;
 if nullif(btrim(p_request_key),'')is null or length(p_request_key)>120 or p_purchase_order_id is null or p_expected_revision is null or p_expected_revision<0
 or length(btrim(coalesce(p_reason,'')))not between 3 and 1000 then raise exception 'Identitas atau alasan koreksi harga tidak valid';end if;
 payload:=jsonb_build_object('purchase_order_id',p_purchase_order_id,'revision',p_expected_revision,'action','prices','items',p_items,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-order-correction:'||auth.uid()::text||':'||p_request_key,0));
 select * into po from public.purchase_orders where id=p_purchase_order_id for update;
 if not found then raise exception 'PO tidak ditemukan';end if;
 perform 1 from public.profiles where id=auth.uid()and is_active and role='OWNER'for update;
 if not found then raise exception 'Hanya Super Admin aktif yang bisa mengoreksi harga PO'using errcode='42501';end if;
 perform public.purchase_assert_access('receipt',po.branch_id);
 select * into prior from public.purchase_order_requests where actor_id=auth.uid()and request_key=p_request_key;
 if found then if prior.payload is distinct from payload then raise exception 'Kunci koreksi sudah dipakai dengan rincian berbeda';end if;return prior.result;end if;
 if po.revision<>p_expected_revision then raise exception 'PO sudah berubah. Muat ulang sebelum mengoreksi';end if;
 if po.status not in('Draft','Dipesan')then raise exception 'Harga PO yang sudah selesai atau batal tidak bisa dikoreksi langsung';end if;
 select closed_until into closed from public.accounting_locks where id for update;
 if closed is not null and po.tanggal<=closed then raise exception 'Periode PO sudah ditutup';end if;
 if not exists(select 1 from public.branches where id=po.branch_id and is_active)
 or not exists(select 1 from public.warehouses where id=po.to_warehouse_id and branch_id=po.branch_id and is_active)then raise exception 'Cabang atau gudang PO tidak aktif';end if;
 if exists(select 1 from public.purchase_order_items where po_id=po.id and(coalesce(qty_terima,0)<>0 or coalesce(qty_rusak,0)<>0))
 or exists(select 1 from public.goods_receipts where po_id=po.id)or exists(select 1 from public.purchase_invoices where po_id=po.id)
 or exists(select 1 from public.po_payments where po_id=po.id)or exists(select 1 from public.purchase_returns where po_id=po.id)
 or exists(select 1 from public.purchase_order_receipt_closures where po_id=po.id)then raise exception 'PO sudah memiliki penerimaan, faktur atau transaksi turunan. Gunakan koreksi dokumen terkait';end if;
 -- Same row-version barrier used by DP posting: RR cannot read a stale sum after a concurrent DP.
 insert into public.purchase_advance_capacity_locks(po_id)values(po.id)on conflict(po_id)do update set epoch=public.purchase_advance_capacity_locks.epoch+1;
 if exists(select 1 from public.purchase_advances where po_id=po.id and(status='batal'and not public.purchase_advance_refund_proven(id)
 or status='aktif'and(jumlah is null or jumlah<=0 or jumlah::text in('NaN','Infinity','-Infinity')or jumlah<>round(jumlah,2)or coalesce(terpakai,0)<>0)))then
  raise exception 'Bukti atau alokasi DP memerlukan rekonsiliasi sebelum koreksi harga';end if;
 select coalesce(sum(jumlah),0)into advances from public.purchase_advances where po_id=po.id and status='aktif';
 if jsonb_typeof(p_items)is distinct from 'array'or jsonb_array_length(p_items)not between 1 and 1000 then raise exception 'Isi semua baris harga PO (maksimal 1000)';end if;
 if jsonb_array_length(p_items)<>(select count(*)from public.purchase_order_items where po_id=po.id)
 or (select count(distinct x->>'id')from jsonb_array_elements(p_items)x)<>jsonb_array_length(p_items)
 or exists(select 1 from jsonb_array_elements(p_items)x where jsonb_typeof(x)is distinct from 'object'or x-'id'-'harga_beli'<>'{}'::jsonb)then raise exception 'Rincian harga harus berisi tepat semua ID baris sumber dan harga beli';end if;
 for r in select * from jsonb_to_recordset(p_items)x(id uuid,harga_beli numeric)order by id loop
  select * into source from public.purchase_order_items where id=r.id and po_id=po.id for update;
  if not found or source.qty is null or source.qty<=0 or source.qty::text in('NaN','Infinity','-Infinity')then raise exception 'Baris sumber harga PO tidak valid';end if;
  if r.harga_beli is null or r.harga_beli<0 or r.harga_beli>1e12 or r.harga_beli::text in('NaN','Infinity','-Infinity')or r.harga_beli<>round(r.harga_beli,2)then raise exception 'Harga beli harus terbatas dan maksimal 2 angka desimal';end if;
  v_total:=v_total+source.qty*r.harga_beli;
 end loop;
 if v_total<=0 or v_total::text in('NaN','Infinity','-Infinity')or v_total<>round(v_total,2)then raise exception 'Total PO harus positif dan maksimal 2 angka desimal';end if;
 if v_total<advances then raise exception 'Total PO baru % lebih kecil dari DP aktif %. Koreksi ini tidak mengembalikan DP',v_total,advances using errcode='22003';end if;
 before_value:=jsonb_build_object('mode','prices','po',to_jsonb(po),'items',(select jsonb_agg(to_jsonb(i)order by i.id)from public.purchase_order_items i where po_id=po.id));
 insert into public.purchase_order_revisions(id,purchase_order_id,branch_id,action,reason,before_value,after_value,created_by)
 values(audit_id,po.id,po.branch_id,'edit',btrim(p_reason),before_value,'{}',auth.uid());
 update public.purchase_order_items i set harga_beli=x.harga_beli from jsonb_to_recordset(p_items)x(id uuid,harga_beli numeric)where i.id=x.id and i.po_id=po.id;
 update public.purchase_orders set total=v_total,revision=revision+1 where id=po.id;
 update public.purchase_order_revisions set after_value=jsonb_build_object('mode','prices','po',(select to_jsonb(p)from public.purchase_orders p where id=po.id),'items',(select jsonb_agg(to_jsonb(i)order by i.id)from public.purchase_order_items i where po_id=po.id))where id=audit_id;
 result:=jsonb_build_object('po_id',po.id,'revision',po.revision+1,'action','edit','mode','prices','revision_id',audit_id,'total',v_total);
 insert into public.purchase_order_requests(actor_id,request_key,purchase_order_id,payload,result,branch_id)values(auth.uid(),p_request_key,po.id,payload,result,po.branch_id);
 return result;
end$$;
revoke all on function public.revise_purchase_order_prices(text,uuid,integer,jsonb,text)from public,anon,service_role;
grant execute on function public.revise_purchase_order_prices(text,uuid,integer,jsonb,text)to authenticated;
