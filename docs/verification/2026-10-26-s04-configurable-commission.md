# S04 — explicit ordinary commission policy for two saved service performers

Source: supplied checklist S04 (gid 831947777), including the 22 October addendum. The requirement is a saved source actor per service row, receipts showing the cashier and performer, and incentive evidence without manually assigning an entire line to one staff member. Existing PR126 provides saved performers, source receipts and single-actor commission. This branch extends only unresolved ordinary two-person commission; it does not change clinical or transaction posting.

An OWNER/ADMIN can append a dated policy for all branches or one branch. A branch policy takes precedence over the global policy; the latest effective date and creation time wins in a scope. The three explicit choices use **existing commission rules and rates**:

- `personal_rules`: pay each saved actor only through an active rule that names that employee. A global rule does not apply.
- `both_full`: run applicable existing rules for each saved actor using the full service basis. This can pay two full bases and is never the default.
- `split`: run applicable existing rules on the configured doctor/staff percentages of the saved basis. The two shares must total 100 with at most two decimals.

An explicit `pending` choice can supersede an earlier policy to pause two-person payout again without deleting history. It keeps the payroll block.

No policy or a malformed policy keeps the old pending behavior. A chosen policy without a matching active rule for every actor also stays pending; payroll calculation/finalization still stops. Ambiguous return source and DEMO fixed-pool snapshots remain pending/existing respectively. Explicit returns choose the policy by the original sale date, including an outside-period sale. One source row remains one branch revenue row; calculation-only actor rows drive commission and per-actor bases. The report labels the source revenue separately from overlapping individual bases. Existing posted transactions and finalized payroll slips are not rewritten.

The additive migration `20261026002000_service_commission_policy.sql` creates an append-only table. It grants SELECT to active authenticated profiles and INSERT only to active OWNER/ADMIN through RLS, with column-limited INSERT and no UPDATE/DELETE. No existing RLS policy, commission rule, role assignment or service RPC is modified. **Security-scope review/approval and target migration-history check are required before production application. This worker did not apply it to a target.** The app reader requires the migration first. No historical data backfill or policy row is inserted; an authorized operator must explicitly choose mode, date, optional branch and shares.

Dummy fixtures cover no policy, missing personal rule, personal/global separation, full basis, percentage split, branch override, negative return, invalid config, DEMO and uncertain return. Action validation tests cover invalid dates/shares and the server-owned audit fields. Disposable PostgreSQL 16 fixture covers grants, RLS, share constraint and immutable policy history. Field UAT and the actual business choice are deferred, so S04 should be marked **code-ready for configured two-person ordinary commission**, not fully operational by default.
