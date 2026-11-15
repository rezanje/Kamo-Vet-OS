-- Promo "Syarat -> Hasil": the `nilai` (spend) syarat is ONE pool of money per receipt (Andri, 11 Nov 2026, PayDay 11.11).
--
-- BUG: promo_sh_verify_claims (20261106510000) checks every claimed promo against the whole cart on its OWN: cart value >= sets x min.
-- Seven "Belanja minimal Rp100.000 -> potongan" promos therefore all passed on one Rp155.000 receipt and three rewards
-- (Rp19.000 + Rp14.000 + Rp14.000) were granted for ONE Rp100.000 of spend. Andri: "setiap 100k tidak bisa ditambah dengan item2 hadiah
-- syarat yang lain" - a threshold buys ONE reward set; the same spend cannot qualify a second promo.
--
-- RULE (the app engine promo-syarat-hasil.ts plans exactly the same): every claimed promo consumes
--     promo_sets x (largest `nilai` row of that promo)
-- of the money actually charged for the cart (the same per-line value this function already computes: lesser of qty x official price and what
-- is charged, after EVERY discount incl. the reward discounts, R5), and the consumption of ALL claimed promos together may not exceed that
-- money. One Rp100.000 threshold then buys one set, Rp250.000 buys two, whichever promos the cashier / a modified client claims.
-- Promos that only have qty rows consume no spend (their units are already exclusive per claim). A promo with several nilai rows needs the
-- largest of them per set (the rows are AND-ed over the same money).
--
-- WHAT CHANGES: only promo_sh_verify_claims (anchored patch of the installed definition, fail closed on drift: every anchor must occur exactly
-- once). The existing per-promo checks stay as they are; the shared check is added after the promo loop. Error code is the existing
-- PROMO_SH_NILAI, so apps (old and new) already map it to the Indonesian cashier message. NOTHING else is touched: no table, column,
-- trigger, policy, grant; ACL / owner / SECURITY DEFINER / search_path of the function are preserved by CREATE OR REPLACE.
-- Old app + this migration: a receipt that stacks claims is refused at finalization with PROMO_SH_NILAI (stock and snapshot roll back);
-- receipts with a single nilai claim per Rp100.000 are untouched.
-- The migration has no BEGIN/COMMIT of its own (the apply wraps it in one transaction with the tracking row).
do $$
declare
 sig regprocedure:='public.promo_sh_verify_claims(uuid)'::regprocedure;
 definition text:=pg_get_functiondef(sig);
 p record;
begin
 if position('SH_NILAI_SHARED' in definition)>0 then raise exception 'SH_NILAI_SHARED_DRIFT: promo_sh_verify_claims already patched';end if;
 for p in select * from(values
  ($a$cart numeric;problem text;$a$,
   $b$cart numeric;need numeric:=0;nmax numeric:=0;problem text;$b$),
  ($a$    if cart<a*(row_json->>'min')::numeric then$a$,
   $b$    nmax:=greatest(nmax,(row_json->>'min')::numeric); -- SH_NILAI_SHARED: the strictest nilai row of the promo is what one set consumes
    if cart<a*(row_json->>'min')::numeric then$b$),
  ($a$  cur_row:=0;
 end loop;$a$,
   $b$  cur_row:=0;
  need:=need+a*nmax;nmax:=0; -- SH_NILAI_SHARED: spend consumed by this promo's sets
 end loop;
 -- SH_NILAI_SHARED: ONE pool of money for the whole receipt. `cart` (money actually charged after every discount) was computed for every nilai row above.
 if need>cart then
  raise exception 'PROMO_SH_NILAI: whole-cart value % is below the combined need % of all claimed promo sets (one nilai threshold buys ONE reward set; the same spend cannot satisfy two promos)',cart,need;
 end if;$b$)
 ) x(old_text,new_text) loop
  if (length(definition)-length(replace(definition,p.old_text,'')))/length(p.old_text)<>1 then
   raise exception 'SH_NILAI_SHARED_DRIFT: promo_sh_verify_claims changed; review before release (anchor %)',left(p.old_text,40);
  end if;
  definition:=replace(definition,p.old_text,p.new_text);
 end loop;
 execute definition;
end$$;
