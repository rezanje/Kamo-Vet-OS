-- P07: an explicit final partial receipt, not a fabricated goods receipt/refund.
-- Original ordered quantities, PO value, stock, liabilities and advances stay intact.
create table public.purchase_order_receipt_closures (
 po_id uuid primary key references public.purchase_orders(id),
 actor_id uuid not null references public.profiles(id), actor_name text not null,
 branch_id uuid references public.branches(id),
 request_key text not null check(length(request_key)between 1 and 120),
 payload jsonb not null,
 reason text not null check(length(btrim(reason))between 3 and 1000),
 lines jsonb not null check(jsonb_typeof(lines)='array'),
 closed_at timestamptz not null default clock_timestamp(),
 unique(actor_id,request_key)
);
alter table public.purchase_order_receipt_closures enable row level security;
revoke all on public.purchase_order_receipt_closures from public,anon,authenticated,service_role;
-- Business proof is readable only through the existing PO row/branch visibility.
-- Internal retry payload/key are not part of this reader contract.
grant select(po_id,actor_id,actor_name,branch_id,reason,lines,closed_at)on public.purchase_order_receipt_closures to authenticated;
create policy purchase_order_receipt_closure_read on public.purchase_order_receipt_closures for select to authenticated
 using(exists(select 1 from public.purchase_orders po where po.id=po_id)
  and(branch_id is null or public.user_can_access_branch(branch_id)));

create function public.guard_po_receipt_closure_immutable()returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Bukti tutup sisa penerimaan tidak dapat diubah atau dihapus'using errcode='42501';end$$;
revoke all on function public.guard_po_receipt_closure_immutable()from public,anon,authenticated,service_role;
create trigger po_receipt_closure_immutable before update or delete on public.purchase_order_receipt_closures for each row execute function public.guard_po_receipt_closure_immutable();
create trigger po_receipt_closure_no_truncate before truncate on public.purchase_order_receipt_closures for each statement execute function public.guard_po_receipt_closure_immutable();

create function public.close_purchase_order_remainder(
 p_po_id uuid,p_request_key text,p_expected_rows jsonb,p_reason text,p_confirmed boolean
)returns jsonb language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders%rowtype;prior public.purchase_order_receipt_closures%rowtype;
 expected jsonb;actual jsonb;proof_lines jsonb;business_payload jsonb;result jsonb;actor_label text;
begin
 if auth.uid()is null or p_po_id is null or p_confirmed is distinct from true
 or p_request_key is null or p_request_key<>btrim(p_request_key)or length(p_request_key)not between 1 and 120
 or length(btrim(coalesce(p_reason,'')))not between 3 and 1000
 or jsonb_typeof(p_expected_rows)is distinct from 'array'or jsonb_array_length(p_expected_rows)not between 1 and 2000 then
  raise exception 'Konfirmasi, alasan, atau rincian tutup sisa tidak valid'using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('purchase-short-close:'||auth.uid()::text||':'||p_request_key,0));
 -- Same lock order as receipt/invoice/advance: PO, actor, then PO lines.
 select * into po from public.purchase_orders where id=p_po_id for update;
 if not found then raise exception 'PO tidak ditemukan';end if;
 select full_name into actor_label from public.profiles where id=auth.uid()and is_active and role='OWNER'for share;
 if not found then raise exception 'Hanya Super Admin aktif yang bisa menutup sisa PO'using errcode='42501';end if;
 perform public.purchase_assert_access('receipt',po.branch_id);
 if exists(select 1 from jsonb_array_elements(p_expected_rows)x group by x->>'id'having count(*)>1)then raise exception 'Baris tutup sisa ganda'using errcode='22023';end if;
 select jsonb_agg(jsonb_build_object('id',(x->>'id')::uuid,'qty',(x->>'qty')::numeric,'qty_terima',coalesce((x->>'qty_terima')::numeric,0),'qty_rusak',coalesce((x->>'qty_rusak')::numeric,0),'satuan',x->>'satuan','faktor',(x->>'faktor')::numeric)order by(x->>'id')::uuid)
 into expected from jsonb_array_elements(p_expected_rows)x;
 business_payload:=jsonb_build_object('po_id',p_po_id,'rows',expected,'reason',btrim(p_reason));
 select * into prior from public.purchase_order_receipt_closures where actor_id=auth.uid()and request_key=p_request_key;
 if found then
  if prior.payload is distinct from business_payload then raise exception 'Kunci tutup sisa sudah dipakai dengan rincian berbeda'using errcode='22023';end if;
  return to_jsonb(prior)-'request_key'-'payload';
 end if;
 if po.status not in('Draft','Dipesan')or exists(select 1 from public.purchase_order_receipt_closures where po_id=p_po_id)then raise exception 'PO sudah selesai/batal atau sisanya sudah ditutup; muat ulang';end if;
 perform 1 from public.purchase_order_items where po_id=p_po_id order by id for update;
 if exists(select 1 from public.purchase_order_items where po_id=p_po_id and(qty is null or qty<=0 or qty::text in('NaN','Infinity','-Infinity')or coalesce(qty_terima,0)<0 or coalesce(qty_terima,0)>qty or coalesce(qty_terima,0)::text in('NaN','Infinity','-Infinity')or faktor is null or faktor<=0 or faktor::text in('NaN','Infinity','-Infinity')))then raise exception 'Jumlah atau faktor PO tidak valid; periksa sumber sebelum menutup';end if;
 select jsonb_agg(jsonb_build_object('id',id,'qty',qty,'qty_terima',coalesce(qty_terima,0),'qty_rusak',coalesce(qty_rusak,0),'satuan',satuan,'faktor',faktor)order by id),
 jsonb_agg(jsonb_build_object('id',id,'item_id',item_id,'ordered_qty',qty,'received_qty',coalesce(qty_terima,0),'closed_qty',qty-coalesce(qty_terima,0),'qty_rusak',coalesce(qty_rusak,0),'satuan',satuan,'faktor',faktor,'received_was_null',qty_terima is null)order by id)
 into actual,proof_lines from public.purchase_order_items where po_id=p_po_id;
 if actual is distinct from expected then raise exception 'Penerimaan atau rincian PO sudah berubah. Muat ulang dan konfirmasi ulang sisa'using errcode='40001';end if;
 if not exists(select 1 from public.goods_receipts where po_id=p_po_id)
 or not exists(select 1 from public.purchase_order_items where po_id=p_po_id and coalesce(qty_terima,0)>0)
 or not exists(select 1 from public.purchase_order_items where po_id=p_po_id and coalesce(qty_terima,0)<qty)then raise exception 'Tutup sisa hanya untuk PO yang sudah diterima sebagian dan masih memiliki sisa';end if;
 insert into public.purchase_order_receipt_closures(po_id,actor_id,actor_name,branch_id,request_key,payload,reason,lines)
 values(p_po_id,auth.uid(),coalesce(nullif(actor_label,''),auth.uid()::text),po.branch_id,p_request_key,business_payload,btrim(p_reason),proof_lines)
 returning to_jsonb(purchase_order_receipt_closures)-'request_key'-'payload'into result;
 -- NULL meant never received, not ordered qty. Record explicit zero before
 -- reusing Diterima, so legacy invoice coalesce(qty_terima,qty) cannot bill it.
 -- The original NULL marker remains in the immutable proof; no receipt is added.
 update public.purchase_order_items set qty_terima=0 where po_id=p_po_id and qty_terima is null;
 -- Existing A01 captures this PO status transition with the authenticated actor.
 -- An audit failure rolls back the proof and zero-normalization as one transaction.
 update public.purchase_orders set status='Diterima'where id=p_po_id;
 return result;
end$$;
revoke all on function public.close_purchase_order_remainder(uuid,text,jsonb,text,boolean)from public,anon,service_role;
grant execute on function public.close_purchase_order_remainder(uuid,text,jsonb,text,boolean)to authenticated;

-- Read-only recovery of this actor's exact request, including after a lost reply.
create function public.get_purchase_order_short_close(p_po_id uuid,p_request_key text)returns jsonb
language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders%rowtype;result jsonb;
begin
 if auth.uid()is null or not exists(select 1 from public.profiles where id=auth.uid()and role='OWNER'and is_active)then raise exception 'Hanya Super Admin aktif yang bisa memeriksa tutup sisa'using errcode='42501';end if;
 select * into po from public.purchase_orders where id=p_po_id for share;
 if not found then raise exception 'PO tidak ditemukan';end if;
 perform public.purchase_assert_access('receipt',po.branch_id);
 select to_jsonb(c)-'request_key'-'payload'into result from public.purchase_order_receipt_closures c where po_id=p_po_id and actor_id=auth.uid()and request_key=p_request_key;
 return result;
end$$;
revoke all on function public.get_purchase_order_short_close(uuid,text)from public,anon,service_role;
grant execute on function public.get_purchase_order_short_close(uuid,text)to authenticated;
