# C04 migration — security pre-review (27 Oct 2026)

Scope: `supabase/migrations/20261026002100_promo_package_total_mode.sql`. Independent read-only review by a separate
agent with no access to the author's conclusions, plus the author's checks. This is a **pre-review**: the release
gate still needs the integrator's sign-off before Step 3 of `owner-apply/OWNER-RUNBOOK.md`.

## What the migration does

1. `promos_discount_mode_valid` CHECK, `NOT VALID` (future writes only).
2. Rewrites the body of the existing SECURITY DEFINER `public.edit_promo(uuid,text,jsonb,uuid[])` by replacing four
   anchors in its own `pg_get_functiondef` output, after asserting: function exists, SECURITY DEFINER,
   `search_path=""`, no EXECUTE for anon/service_role, EXECUTE for authenticated, each anchor exactly once.
3. New SECURITY DEFINER trigger function `public.assert_active_package_promo_target()` (EXECUTE revoked from
   public/anon/authenticated/service_role) on two DEFERRABLE INITIALLY DEFERRED constraint triggers.

## Findings

| # | Question | Result |
|---|---|---|
| 1 | Privilege escalation / RLS bypass | None. `discount_mode` is accepted only as a JSON string in `per_unit`/`package_total`; the rule receives only the constant `'package_total'` or loses the key. Key stripped before `jsonb_populate_record`. Every caller still passes `assert_promo_manager` (editor and `guard_promo_configuration`). RLS on promos/promo_items unchanged. |
| 2 | Dynamic `EXECUTE` | Safe: input is the server's own definition plus constant strings; exact-once anchors; no anchor is produced by an earlier replacement. After apply: SECURITY DEFINER, `search_path=""`, owner and ACL unchanged (verified; also asserted by readback). |
| 3 | Trigger function | All references schema-qualified; revoked EXECUTE does not stop firing (verified); its `FOR SHARE` hits a row the same transaction already locks `FOR UPDATE`; checkout only reads; constant error text. |
| 4 | Legacy promos / posted sales | Unchanged. No DML on sales or history. New, intended: removing the only target of an *active package* promo fails at commit. |
| 5 | **Correctness gap (fixed on this branch)** | The CHECK evaluated to NULL (= pass) when `discount_type` or `min_qty` was NULL, so a manager writing the table directly could store an active package promo the app refuses; checkout at that branch would then stop with an explicit error. Fixed with `coalesce(..., false)`; red→green test added to `supabase/tests/promo_package_total.sql`. Safe to change because the migration is not applied anywhere (preflight proves it on production). |

## Production checks the reviewer required — now in the owner package

- No promo already stores `discount_mode` (preflight Query A `data:` row).
- Production `edit_promo` byte-identical to the repository (fingerprint), owned by the applying role.
- Constraint, triggers and guard function names not yet present.
- `lock_timeout 5s` in `02-apply-writes.sql` so the apply cannot queue behind a long transaction and stall checkout reads.
- Guard function grants checked after apply (readback) before the flag is turned on.

## Production comparison (read-only, 27 Oct 03:32Z)

Production `edit_promo` fingerprint equals the repository (`f4a53d51…`), SECURITY DEFINER, `search_path=""`,
grants authenticated-only, owner `postgres`; no promo stores `discount_mode`; C04 objects absent. Rehearsed on
PostgreSQL 17.6 and 16.15 with identical results. Remaining gate: integrator sign-off of this review.
