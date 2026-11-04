-- COST_MISSING from BMHP posting named only the material ("COST_MISSING: Revolution Dog Teal 2.0 Ml New"),
-- so the cashier could not tell WHY a payment failed or what to do (Andri, 4 Nov 2026: Teal 0.3 / 0.6 rows,
-- Revolution 0.1 ml; removing the 0.6 row did not help because the 0.3 row issues the same material).
--
-- This changes ONLY the text of the rejection raised by clinic_private.bmhp_issue. The condition is untouched:
-- stock is still refused when the FIFO/average issue has a shortfall, no cost, or a zero-cost layer. The text now
-- carries the facts the cashier needs, in a fixed machine-readable tail that src/lib/klinik-posting.ts renders:
--   COST_MISSING: <material> [stok=<qty in base unit>;butuh=<qty needed>;satuan=<base unit>;sebab=<harga0|lapisan>]
--   sebab=lapisan  FIFO layers do not cover the needed quantity (shortfall)
--   sebab=harga0   layers exist but cost nothing (e.g. stock added by Penyesuaian while the item's Harga beli is 0)
-- Signature, SECURITY DEFINER-ness (invoker), search_path and ACL are unchanged; anchored replace fails hard on drift.

do $patch$
declare
  signature regprocedure := 'clinic_private.bmhp_issue(uuid,uuid,text,date)'::regprocedure;
  definition text := pg_get_functiondef(signature);
  old_text text := E'message = format(''COST_MISSING: %s'', v_item.name);';
  new_text text := E'message = format(''COST_MISSING: %s [stok=%s;butuh=%s;satuan=%s;sebab=%s]'',\n        left(v_item.name, 60), trim_scale(coalesce(v_stock, 0)), trim_scale(v_qty), left(v_item.unit, 20),\n        case when v_out.shortfall > 0 then ''lapisan'' else ''harga0'' end);';
begin
  if position('[stok=%s;butuh=%s' in definition) > 0 then
    raise exception 'COST_MISSING detail already applied; inspect before re-running';
  end if;
  if (length(definition) - length(replace(definition, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'COST_MISSING_DRIFT: clinic_private.bmhp_issue changed; review before release';
  end if;
  execute replace(definition, old_text, new_text);
end $patch$;
revoke all on function clinic_private.bmhp_issue(uuid, uuid, text, date) from public, anon, authenticated, service_role;
