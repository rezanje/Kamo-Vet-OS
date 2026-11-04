-- Promo "Syarat -> Hasil", stage 2c: the below-HPP waiver inside the ORIGINAL cashier price floor (P03).
-- Requires 20261106310000 (sale_items.promo_floor_waiver) and 20261104372000 (P03_GRUP_FLOOR).
--
-- Rule (Andri 4 Nov, Q5): only a promo the OWNER explicitly allowed below HPP may sell a reward line below HPP, net must stay > 0 and the
-- line must not be pushed lower by voucher/points/total discount. For a line flagged promo_floor_waiver (the claim trigger and
-- the finalize verification only allow the flag on a reward line of a waiver promo, with no manual discount) the floor becomes
--     net_alloc >= least(hpp, gross - promo_discount)
-- where net_alloc = (gross - promo_discount) * net_total / after_items:
--   * promo alone below HPP  -> floor = gross - promo_discount, so net_total must equal after_items (no receipt-level discount stacking);
--   * promo alone at/above HPP -> floor stays HPP (unchanged behaviour);
--   * net > 0 is checked by the untouched statement above it; hpp NULL still refuses.
-- Every line without the flag keeps the exact original expression. One anchor, fail closed on drift.
-- (The CASE is parenthesised on purpose: PL/pgSQL ends an IF condition at the first THEN token it meets.)
begin;
do $$
declare
 signature regprocedure:='public.cashier_post_stock_atomic(uuid,uuid)'::regprocedure;
 definition text:=pg_get_functiondef(signature);
 old_text constant text:=$old$if line.hpp is null or (gross-item_discount)*net_total/after_items < line.hpp then$old$;
 new_text constant text:=$new$if line.hpp is null or (gross-item_discount)*net_total/after_items < (case when coalesce(line.promo_floor_waiver,false) and manual<=0 then least(line.hpp,gross-item_discount) else line.hpp end) then -- P05_PROMO_WAIVER$new$;
begin
 if position('P05_PROMO_WAIVER' in definition)>0 then raise exception 'P05_DRIFT: promo waiver floor already applied';end if;
 if position('P03_GRUP_FLOOR' in definition)=0 then raise exception 'P05_DRIFT: P03 floor not present; apply 20261104372000 first';end if;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'P05_DRIFT: cashier_post_stock_atomic floor changed; review before release';
 end if;
 execute replace(definition,old_text,new_text);
end$$;
revoke all on function public.cashier_post_stock_atomic(uuid,uuid) from public,anon,service_role;
grant execute on function public.cashier_post_stock_atomic(uuid,uuid) to authenticated;
commit;
