"""Mutants of 20261107120000_owner_koreksi_racikan.sql for scripts/test-owner-koreksi-racikan-postgres.py --mutations.
Each mutant = (name, [(anchor, replacement, expected_occurrences), ...]); a stale anchor fails loudly. Every mutant must be KILLED by a real failing case."""
OWN = "p.is_active and p.role = 'OWNER')"
RESTORE_STOCK = """      insert into public.stock (warehouse_id, item_id, qty, updated_at)
      values (v_warehouse, v_target.item_id, -v_delta, now())
      on conflict (warehouse_id, item_id) do update
        set qty = public.stock.qty + excluded.qty, updated_at = excluded.updated_at;
"""
AUDIT_A = "  insert into clinic_private.owner_compound_corrections (id, actor_id,"
AUDIT_B = "v_before, clinic_private.compound_composition(p_recipe_id), v_cost_before, v_cost_after, v_rx.harga, v_effects, v_result);"
INV_ANY = "exists (select 1 from public.invoice_items ii where ii.compound_recipe_id = p_recipe_id or ii.prescription_item_id = v_rx.id)"
MUTANTS = [
    ('M1 owner-only check removed (both reads): any active role may correct', [(OWN, "p.is_active and (p.role = 'OWNER' or true))", 2)]),
    ('M2 reason requirement removed', [("if not p_dry and (length(regexp_replace(v_reason, '\\s', '', 'g')) < 5 or length(v_reason) > 500) then", "if false then", 1)]),
    ('M3 invoice-line guard removed (row already invoiced may be changed)', [(INV_ANY + "\n     or exists (select 1 from public.compound_issues i where i.recipe_id = p_recipe_id and i.posted_invoice_item_id is not null) then", "false then", 1)]),
    ('M4 only ACTIVE invoices count (a voided invoice line would not block)', [(INV_ANY, "exists (select 1 from public.invoice_items ii join public.invoices iv on iv.id = ii.invoice_id where iv.voided_at is null and (ii.compound_recipe_id = p_recipe_id or ii.prescription_item_id = v_rx.id))", 1)]),
    ('M5 official-recipe guard removed (own message)', [("if exists (select 1 from public.compound_official_usage u where u.recipe_id = p_recipe_id) then", "if false then", 1)]),
    ('M6 checked-out/archived visit guard removed', [("if v_visit.checked_out_at is not null or v_visit.archived_at is not null\n     or (", "if false\n     or (", 1)]),
    ('M7 discharged-and-Selesai guard removed', [("(v_visit.status = 'Selesai' and not exists", "(false and not exists", 1)]),
    ('M8 non-rawat-inap guard removed', [("if not exists (select 1 from public.inpatient_records ir where ir.visit_id = v_visit_id) then", "if false then", 1)]),
    ('M9 idempotency: different payload under the same key accepted', [("v_prior.recipe_id is distinct from p_recipe_id or v_prior.request_hash is distinct from v_hash then", "v_prior.recipe_id is distinct from p_recipe_id then", 1)]),
    ('M10 audit row not written', [(AUDIT_A, "  if false then insert into clinic_private.owner_compound_corrections (id, actor_id,", 1), (AUDIT_B, AUDIT_B + " end if;", 1)]),
    ('M11 audit stores the cost BEFORE as the cost after', [(AUDIT_B, "v_before, clinic_private.compound_composition(p_recipe_id), v_cost_before, v_cost_before, v_rx.harga, v_effects, v_result);", 1)]),
    ('M12 restore in FIFO order instead of reverse FIFO (wrong cost layer comes back)', [("order by (l.exp_date is null) desc, l.exp_date desc nulls first, l.tanggal desc, l.created_at desc, l.id desc, i.id desc", "order by l.tanggal, l.created_at, l.id, i.id", 1)]),
    ('M13 restored quantity never added back to stock', [(RESTORE_STOCK, "", 1)]),
    ('M14 coordinator lock removed (race with the cashier)', [("  perform clinic_private.billing_lock(clinic_private.billing_keys_visit(v_visit_id));\n", "  -- billing_lock removed by the mutant\n", 1)]),
    ('M15 price touched: prescription_items.harga rewritten', [("  select coalesce(round(sum(i.qty * i.unit_cost), 2), 0) into v_cost_after", "  execute 'update  public.prescription_items set harga = harga + 1 where id = ' || quote_literal(v_rx.id);\n  select coalesce(round(sum(i.qty * i.unit_cost), 2), 0) into v_cost_after", 1)]),
    ('M16 withdrawn-row guard removed', [("if v_rx.billing_withdrawn_at is not null then", "if false then", 1)]),
    ('M17 handed_over refused as well', [("if v_recipe.status = 'void' then", "if v_recipe.status in ('void', 'handed_over') then", 1)]),
    ('M18 branch access check removed', [("if v_branch is null or not public.user_can_access_branch(v_branch) then", "if v_branch is null then", 1)]),
    ('M19 NO_CHANGE guard removed (empty audit rows)', [("if v_changes = 0 then", "if false then", 1)]),
    ('M20 unchanged ingredients are processed as moves (delta 0 not skipped)', [("    continue when v_delta = 0;\n", "", 1)]),
    ('M21 inactive/non-material NEW ingredient accepted', [("(not v_item.is_active or not v_item.is_compound_material) and v_qty > v_existing_qty", "false and v_qty > v_existing_qty", 1)]),
    ('M22 quote wrapper not dry (no reason -> REASON_REQUIRED instead of a preview)', [("perform clinic_private.owner_correct_compound(p_recipe_id, p_ingredients, null, null, true);", "perform clinic_private.owner_correct_compound(p_recipe_id, p_ingredients, null, null, false);", 1)]),
    ('M23 restore sets a wrong layer cost (unit_cost instead of the physical layer cost)', [("          v_issue.physical_unit_cost, 'racik-koreksi', p_recipe_id::text);", "          v_issue.unit_cost + 1, 'racik-koreksi', p_recipe_id::text);", 1)]),
]
