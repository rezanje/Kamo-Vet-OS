-- Promo "Syarat -> Hasil", stage 2c: the below-HPP waiver inside the ORIGINAL cashier price floor (P03).
-- Requires 20261106510000 (sale_items.promo_floor_waiver) and 20261104372000 (P03_GRUP_FLOOR).
--
-- Rule (Andri 4 Nov, Q5): only a promo the OWNER explicitly allowed below HPP may sell a reward line below HPP, net must stay > 0 and the
-- line must not be pushed lower by voucher/points/total discount. For a line flagged promo_floor_waiver (the claim trigger and
-- the finalize verification only allow the flag on a reward line of a waiver promo, with no manual discount) the floor becomes
--     net_alloc >= least(hpp, gross - promo_discount)
-- where net_alloc = (gross - promo_discount) * net_total / after_items:
--   * promo alone below HPP  -> floor = gross - promo_discount, so net_total must equal after_items (no receipt-level discount stacking);
--   * promo alone at/above HPP -> floor stays HPP (unchanged behaviour);
--   * net > 0 is checked by the untouched statement above it; hpp NULL still refuses.
-- Every line without the flag keeps the exact original expression. Two anchors (floor condition + its raise message), fail closed on drift.
--
-- SCOPE OF THE WAIVER (stage-2 review L1): the relaxed floor applies to the WHOLE flagged line, so the line may contain reward units
-- ONLY. Migration 20261106510000 enforces it (readable trigger message PROMO_SH_CLAIM + CHECK sale_items_promo_claim_shape): a waiver
-- line needs promo_hasil_units = qty and promo_syarat_units = 0. The app must therefore SPLIT a cart line into a plain/syarat line and a
-- pure reward line (the same contract as the Bolt pool: a claimed line is excluded from the pool as a whole, L2). The non-reward units
-- keep the ordinary HPP floor.
--
-- READABLE REFUSAL (L3): with a promo alone below HPP the line floor is gross - promo_discount, so net_total must equal after_items.
-- Any receipt-level reduction (voucher, points, total discount, CASH ROUNDING that lowers the total) refuses the sale. The refusal now
-- says so for waiver lines (extra hint after the original message); the message of every non-waiver line is byte-identical.
-- The app should therefore not apply rounding-down on receipts that carry a waiver line.
--
-- Known limitation (pre-existing, review S4): the P03 floor exists only in cashier_post_stock_atomic. A caller that issues stock with
-- sale_stock_out_fifo and calls finalize_pos_sale directly skips the floor entirely (SH claim verification still runs there, but the
-- waiver / no-stacking rule is not enforced). Closing that is a follow-up outside this migration (finalize_pos_sale is untouched).
-- R1 (stage-2 re-review): a waiver promo with a nilai syarat can no longer be unlocked by value the customer does not pay. Migration
-- 20261106510000 counts every line toward nilai at the LESSER of qty x official price and what the customer is actually charged (a fake
-- Rp1 / 100%-discounted / qty-1,000,000-at-harga-0 Jasa line counts ~0), and this floor already forces net_total = after_items on a waiver
-- sale, so the money counted for the threshold is the money charged for the lines. Documented refinement of Andri's "nilai = whole cart";
-- residual: a receipt-level discount on a NON-waiver sale is not subtracted (bounded by the reward line's own HPP floor).
-- (The CASE is parenthesised on purpose: PL/pgSQL ends an IF condition at the first THEN token it meets.)
begin;
do $$
declare
 signature regprocedure:='public.cashier_post_stock_atomic(uuid,uuid)'::regprocedure;
 definition text:=pg_get_functiondef(signature);
 old_text constant text:=$old$if line.hpp is null or (gross-item_discount)*net_total/after_items < line.hpp then$old$;
 new_text constant text:=$new$if line.hpp is null or (gross-item_discount)*net_total/after_items < (case when coalesce(line.promo_floor_waiver,false) and manual<=0 then least(line.hpp,gross-item_discount) else line.hpp end) then -- P05_PROMO_WAIVER$new$;
old_raise constant text:=$old$raise exception 'Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak: %', line.nama using errcode='55000';$old$;
 new_raise constant text:=$new$raise exception 'Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak: %', line.nama||(case when coalesce(line.promo_floor_waiver,false) then ' (baris promo di bawah HPP: total struk tidak boleh lebih rendah dari subtotal setelah promo - tanpa voucher, poin, diskon total, atau pembulatan tunai ke bawah)' else '' end) using errcode='55000';$new$;
begin
 if position('P05_PROMO_WAIVER' in definition)>0 then raise exception 'P05_DRIFT: promo waiver floor already applied';end if;
 if position('P03_GRUP_FLOOR' in definition)=0 then raise exception 'P05_DRIFT: P03 floor not present; apply 20261104372000 first';end if;
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
  raise exception 'P05_DRIFT: cashier_post_stock_atomic floor changed; review before release';
 end if;
 if (length(definition)-length(replace(definition,old_raise,'')))/length(old_raise)<>1 then
  raise exception 'P05_DRIFT: cashier_post_stock_atomic floor message changed; review before release';
 end if;
 execute replace(replace(definition,old_text,new_text),old_raise,new_raise);
end$$;
revoke all on function public.cashier_post_stock_atomic(uuid,uuid) from public,anon,service_role;
grant execute on function public.cashier_post_stock_atomic(uuid,uuid) to authenticated;
commit;
