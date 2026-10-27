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

## Production comparison

Read-only preflight on the target passed with `0 failed` (details kept private). Rehearsed on PostgreSQL 17.6 and
16.15 with identical results. Human sign-off is not a repository gate: the `main` ruleset requires 0 approvals plus
the `Technical checks` status.

Note: the NULL fix edits the migration in place. Production has not applied it, which preflight proves. Any
non-production database that applied the earlier text keeps the NULL gap until it re-applies the migration.

## Post-change review — containment (06/07) and FIFO-floor test

Second independent agent review of `owner-apply/06…`, `07…`, `scripts/test-promo-package-fifo-floor-postgres.py`
and `scripts/promo-package-quote.mjs`.

Must-fix findings, both fixed:
1. **Thaw re-activated a promo a manager deliberately turned off.** The drift check ignored `is_active`, so
   toggling a frozen promo on and then off again looked unchanged. Fix: `06` records the row version (`xmin`),
   and `07` treats any later write as drift. Test: toggling on then off now blocks thaw.
2. **`READINESS.md` cited a review that was not on file.** Fixed by this section.

Non-blocking notes handled:
- Time zone pinned to UTC in both scripts.
- The install guard no longer checks the editor body; it checks the guard, its triggers bound to the right
  tables and function, and the constraint.
- `06` and `07` lock the record table and do not interleave.
- Re-run semantics are documented.
- The ledger check now also covers `stock`, `inventory_cost_events`, `cash_entries` and
  `sale_item_group_components`.
- Test coverage added:
  - deleted, re-activated and on-off drift;
  - an already-inactive package promo that must stay unrecorded;
  - `promo_id` in the quote;
  - the stored `promo_discount` read back after posting.

Accepted as fail-safe, no change:
- A target change committed while `06` waits on its lock is recorded stale, so thaw reports drift.

Corrected after the re-review:
- An earlier note said `VACUUM FREEZE` counts as drift. It does not: the reviewer showed the recorded row version
  is unchanged after `VACUUM FREEZE`, so a thaw still goes through.
- Older log banners printed "PostgreSQL 16" for every server. The shared test helper now prints the real server
  version.

Re-review of the final containment head: both must-fix findings were confirmed fixed, with the on/off case
reproduced independently. No new blocking issue was found.

Verified by the reviewer:
- Neither script writes outside `promos.is_active` and `ops_c04`.
- Engine discounts reach the floor check.
- Floor assertions are not vacuous.
- References are schema-qualified.
- Grants are revoked.
