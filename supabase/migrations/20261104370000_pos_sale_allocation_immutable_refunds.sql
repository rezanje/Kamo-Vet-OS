-- Fix: pos_sale_allocation_immutable() is shared by sale_payments and
-- sale_payment_refunds. Since 20261024140000 its first IF read old.sale_id in
-- the same boolean expression as tg_table_name; PL/pgSQL resolves the record
-- field regardless of the table check, so on sale_payment_refunds (no sale_id)
-- every UPDATE/DELETE failed with 'record "old" has no field "sale_id"' instead
-- of the intended guard. Nest the branches so each table's fields are read only
-- inside its own branch. Behaviour is otherwise identical:
--  * sale_payments + open correction gate for old.sale_id: allowed, but the
--    row may not move to another sale;
--  * DELETE whose parent (sales / sales_returns) is already gone: allowed
--    (cascade from the parent);
--  * everything else: 'Snapshot alokasi pembayaran sudah tetap'.
create or replace function public.pos_sale_allocation_immutable() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='sale_payments' then
  if tg_op in('UPDATE','DELETE') then
   if public.pos_sale_payment_correction_allowed(old.sale_id) then
    if tg_op='UPDATE' then
     if new.sale_id is distinct from old.sale_id then
      raise exception 'Induk alokasi pembayaran tidak boleh dipindah';end if;
    end if;
    if tg_op='DELETE' then return old;else return new;end if;
   end if;
  end if;
  if tg_op='DELETE' then
   if not exists(select 1 from public.sales where id=old.sale_id) then return old;end if;
  end if;
 else
  if tg_op='DELETE' then
   if not exists(select 1 from public.sales_returns where id=old.sales_return_id) then return old;end if;
  end if;
 end if;
 raise exception 'Snapshot alokasi pembayaran sudah tetap';
end $$;
revoke all on function public.pos_sale_allocation_immutable() from public,anon,authenticated,service_role;
