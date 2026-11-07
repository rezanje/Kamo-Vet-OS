"""Mutants of 20261107150000_owner_tarik_baris_lunas.sql for scripts/test-owner-tarik-baris-lunas-postgres.py --mutations.
Each mutant = (name, [(anchor, replacement, expected_occurrences), ...]); a stale anchor fails loudly. Every mutant must be KILLED by a real failing case
(not by a harness crash). Mutants keep the tokens the migration's own install-time check requires (billing_lock, c_allowed_roles, array['OWNER'],
owner_invoice_corrections, stock_in_fifo, accounting_locks)."""
OWN = "p.is_active and p.role::text = any(c_allowed_roles))"
PAY_START = "  if not exists (select 1 from public.invoice_payments p where p.invoice_id = p_invoice_id and p.amount > 0)\n     or exists"
PAY_END = "<> v_inv.total then\n    raise exception using errcode = 'P0001', message = 'PAYMENT_METHOD: v1"
AUDIT_A = "  insert into clinic_private.owner_invoice_corrections (id, actor_id,"
AUDIT_B = "v_total_before, v_total_after, v_hpp, v_effects, (select jsonb_agg(e.value -> 'id') from jsonb_array_elements(v_journals) e), v_adv_before, v_adv_after, v_result);"
RESTORE_A = "    perform public.stock_in_fifo((v_r ->> 'warehouse_id')::uuid"
RESTORE_B = "      'klinik-edit', v_inv.invoice_no, current_date, null);"
REV_J = "jsonb_build_array(jsonb_build_object('code', '510002', 'debit', v_removed, 'credit', 0), jsonb_build_object('code', '150001', 'debit', 0, 'credit', v_removed)));"
MUTANTS = [
    ('M01 owner-only check removed (both reads): any active role may use it', ['main,neg'], [(OWN, "p.is_active and (p.role::text = any(c_allowed_roles) or true))", 2)]),
    ('M02 reason requirement removed', ['neg'], [("if not p_dry and (length(regexp_replace(v_reason, '\\s', '', 'g')) < c_min_reason or length(v_reason) > 500) then", "if false then", 1)]),
    ('M03 branch access check removed', ['neg'], [("if not public.user_can_access_branch((select v.branch_id from public.visits v where v.id = v_inv.visit_id)) then", "if false then", 1)]),
    ('M04 idempotency: different payload under the same key accepted', ['main'], [("or v_prior.request_hash is distinct from v_hash then", "then", 1)]),
    ('M05 voided-invoice guard removed', ['scope'], [("if v_inv.voided_at is not null then", "if false then", 1)]),
    ('M06 not-paid guard removed', ['scope'], [("if v_inv.paid_status is distinct from 'Lunas' or clinic_private.invoice_received(p_invoice_id) < v_inv.total or v_inv.total <= 0 then", "if false then", 1)]),
    ('M07 payment-method guard removed entirely (the advance-shortage guard has its own code)', ['scope'], [(PAY_START, "  if false and (not exists (select 1 from public.invoice_payments p where p.invoice_id = p_invoice_id and p.amount > 0)\n     or exists", 1), (PAY_END, "<> v_inv.total) then\n    raise exception using errcode = 'P0001', message = 'PAYMENT_METHOD: v1", 1)]),
    ('M08 loyalty-points guard removed', ['scope'], [("if c_refuse_if_points and v_visit.customer_id is not null", "if false and v_visit.customer_id is not null", 1)]),
    ('M09 ORIGINAL invoice date no longer checked against the closed period', ['scope'], [("or v_closed >= least(coalesce(v_jdate, v_cdate), v_cdate))", ")", 1)]),
    ('M10 inventory period (closed_through) no longer checked', ['scope'], [("    perform public.inventory_assert_open_date(current_date);", "    null;", 1)]),
    ('M11 refund guard removed', ['scope'], [("if exists (select 1 from public.clinic_refunds f where f.invoice_id = p_invoice_id)\n     or exists (select 1 from public.clinic_refund_requests f where f.invoice_id = p_invoice_id) then", "if false then", 1)]),
    ('M12 tax / discount / DP / voucher guards removed', ['scope'], [("or coalesce(v_inv.discount, 0) <> 0 or coalesce(v_inv.tax, 0) <> 0 or coalesce(v_inv.dp_amount, 0) <> 0", "", 1)]),
    ('M13 non-stage (outpatient) invoice guard removed', ['scope'], [("or not v_inv.stage_billing or", "or", 1)]),
    ('M14 correction_pending guard removed', ['scope'], [("or v_inv.reissued_from is not null or v_inv.correction_pending", "or v_inv.reissued_from is not null", 1)]),
    ('M15 racikan guard removed', ['neg'], [("if v_line.compound_recipe_id is not null then", "if false then", 1)]),
    ('M16 partial-quantity guard removed', ['neg'], [("if v_req_qty is not null and v_req_qty is distinct from v_line.qty then", "if false then", 1)]),
    ('M17 withdrawn-prescription guard removed', ['neg'], [("if not found or v_rx.billing_withdrawn_at is not null then", "if not found then", 1)]),
    ('M18 last-line guard removed', ['neg'], [("if v_total_lines = array_length(v_ids, 1) then", "if false then", 1)]),
    ('M19 BMHP hpp vs component cost check removed', ['main,neg'], [("if abs(coalesce(v_line.hpp, 0) - v_comp_cost) > c_cost_tolerance then", "if false then", 1)]),
    ('M20 stock ledger vs invoice lines check removed', ['scope'], [("if v_ledger is distinct from v_expected then", "if false then", 1)]),
    ('M21 plain stock line hpp vs stock-move cost check removed', ['scope'], [("if abs(coalesce(v_line.hpp, 0) - v_cost_ledger) > c_cost_tolerance or coalesce(v_line.hpp, 0) <= 0 then", "if false then", 1)]),
    ('M22 stock never restored', ['main'], [(RESTORE_A, "    if false then perform public.stock_in_fifo((v_r ->> 'warehouse_id')::uuid", 1), (RESTORE_B, RESTORE_B + " end if;", 1)]),
    ('M23 stock restored at a wrong cost', ['main'], [("(v_r ->> 'cost')::numeric / (v_r ->> 'qty')::numeric,\n      'klinik-edit'", "((v_r ->> 'cost')::numeric + 1) / (v_r ->> 'qty')::numeric,\n      'klinik-edit'", 1)]),
    ('M24 advance.applied not reduced (balance never re-credited)', ['main'], [("    update public.clinic_customer_advances set applied = applied - v_take where id = v_app.advance_id;", "    null;", 1)]),
    ('M25 reversal payment has the wrong amount', ['main'], [("p_invoice_id, current_date, -v_take, 'Uang Muka'", "p_invoice_id, current_date, -v_take - 1, 'Uang Muka'", 1)]),
    ('M26 reversal payment not linked to the original (reversal_of null)', ['main'], [("'314001', v_user, v_app.payment_id)", "'314001', v_user, null)", 1)]),
    ('M27 application always released instead of reduced', ['scope'], [("    if v_take = v_app.amount then", "    if true then", 1)]),
    ('M28 revenue journal reversed in the wrong direction', ['main'], [(REV_J, "jsonb_build_array(jsonb_build_object('code', '510002', 'debit', 0, 'credit', v_removed), jsonb_build_object('code', '150001', 'debit', v_removed, 'credit', 0)));", 1)]),
    ('M29 HPP journal skipped', ['main'], [("  if v_hpp > 0 then\n    v_jid := public.clinic_write_journal(", "  if false then\n    v_jid := public.clinic_write_journal(", 1)]),
    ('M30 revenue journal dated with the ORIGINAL journal date instead of today', ['main'], [("v_jid := public.clinic_write_journal(current_date, 'Tarik baris tagihan ' || v_inv.invoice_no || ': pembalikan pendapatan'", "v_jid := public.clinic_write_journal(v_jdate, 'Tarik baris tagihan ' || v_inv.invoice_no || ': pembalikan pendapatan'", 1)]),
    ('M31 prescription row not withdrawn (cart would resurrect it)', ['main'], [("update public.prescription_items set billing_withdrawn_at = clock_timestamp(),", "update public.prescription_items set billing_withdrawn_at = null,", 1)]),
    ('M32 audit row not written', ['main'], [(AUDIT_A, "  if false then insert into clinic_private.owner_invoice_corrections (id, actor_id,", 1), (AUDIT_B, AUDIT_B + " end if;", 1)]),
    ('M33 audit stores the total before as the total after', ['main'], [("v_total_before, v_total_after, v_hpp, v_effects, (select", "v_total_before, v_total_before, v_hpp, v_effects, (select", 1)]),
    ('M34 invoice_edit_log not written', ['main'], [("  insert into public.invoice_edit_log (invoice_id, edited_by, field_changed, old_value, new_value, reason)\n    values (p_invoice_id, v_user, 'total', v_total_before::text, v_total_after::text, 'Tarik baris (Owner): ' || v_reason);", "  null;", 1)]),
    ('M35 quote wrapper not dry (no reason -> REASON_REQUIRED instead of a preview)', ['main'], [("perform clinic_private.owner_remove_invoice_lines(p_invoice_id, p_lines, null, null, true);", "perform clinic_private.owner_remove_invoice_lines(p_invoice_id, p_lines, null, null, false);", 1)]),
    ('M36 coordinator lock removed (race with cashier / release)', ['race'], [("  perform clinic_private.billing_lock(clinic_private.billing_keys_invoice(p_invoice_id));", "  null; -- billing_lock removed by the mutant", 1)]),
    ('M37 duplicate line ids accepted', ['neg'], [("v_id is null or v_id = any(v_ids) or", "v_id is null or", 1)]),
    ('M38 oldest application reduced first instead of the newest', ['scope'], [("order by (select ca.created_at from public.clinic_customer_advances ca where ca.id = a.advance_id) desc, a.created_at desc, a.id desc for update\n  loop\n    exit when v_left <= 0;\n    v_take", "order by (select ca.created_at from public.clinic_customer_advances ca where ca.id = a.advance_id), a.created_at, a.id for update\n  loop\n    exit when v_left <= 0;\n    v_take", 1)]),
]
