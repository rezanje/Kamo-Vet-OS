-- A partially received PO can remain Dipesan. A new DP must stop at the
-- first receipt document, while a retry of an already posted request remains
-- recoverable through pay_purchase_advance_atomic's prior-request path.
create function public.guard_purchase_advance_receipt() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.po_id is null or new.status <> 'aktif' then return new; end if;
  -- Receipt posting and the existing DP writer lock the parent PO first.
  perform 1 from public.purchase_orders where id = new.po_id for update;
  if exists (select 1 from public.goods_receipts where po_id = new.po_id) then
    raise exception 'PO sudah melewati penerimaan pertama; DP baru ditolak. Lanjutkan pembayaran melalui faktur/utang'
      using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function public.guard_purchase_advance_receipt() from public, anon, authenticated, service_role;
create trigger purchase_advance_receipt_guard
  before insert or update of po_id, supplier_id, jumlah, status on public.purchase_advances
  for each row execute function public.guard_purchase_advance_receipt();
