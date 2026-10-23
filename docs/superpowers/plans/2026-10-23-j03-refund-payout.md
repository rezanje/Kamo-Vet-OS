# J03 refund payout implementation plan

Goal: choose actual cash/transfer payout independently of original sale payment allocation, preserve source quantities/stock/cost/revenue and never report pending money as paid.

Verified current defect: retail UI says cash, while both legacy and planned SQL refund paths credit original payment accounts; planned refunds also create original-method expenses. No clinic return workflow currently exists. R05 is owned by another lane.

Approach: reuse the guarded source-locking retail return core and its stock/HPP/provenance wrapper. Explicit cash payout requires the actor's active petshop shift and mapped cash account; original payment allocations still cap refunded amounts. Transfer is a request, with no posted return/stock/journal until finance records completion. This follows existing request/finance processing patterns and avoids inventing a refund holding account. UI must state that posting boundary. No external bank call or message.

Transfer claim reserves source-return eligibility while finance handles it; old and new return entry points must honor reservations. Complete checks quote/source/period/account, then posts return/refund/receipt atomically once. A failed completion retains processing/request and creates no partial financial effects. Cancellation retains audit, releases only an unpaid reservation, never deletes history. All source guards, stock locks, module/branch/role permissions remain effective.

Original split-payment allocation stays independent of the chosen payout account. Source snapshots determine fee/tax/discount reversal. Customer point/spending effects must follow existing cancellation source evidence; if points cannot be reconciled, fail closed and report. No silent negative-point or legacy-history repair policy.

- [ ] RED real SQL: transfer-origin→cash credits cash only; source allocation exact; partial/full/retry; transfer pending zero financial writes; two claims/cash cannot consume the same reserved eligibility; completion once to selected bank; source/branch/role/period/bank mismatch and journal/audit failure rollback.
- [ ] Minimal reviewed migration: private request/payout proof tables, source quote/canonical rows, actual payout helper and guarded core integration; existing no-choice behavior remains compatible. New effects audited without exposing bank destination in the global activity index.
- [ ] RED action/component: explicit method/destination, no source price/branch authority from browser, distinct pending/completed response handling, durable key/draft and receipt-only recovery.
- [ ] Retail form, source request status and finance queue/claim/record-transfer flow using current access patterns. No settings/credentials changes.
- [ ] Diagnose clinic source/payment/stock snapshots and add only provable equivalent flow. Record exact missing contract/data if unable; retail candidate alone is not full J03.
- [ ] Focused checks while iterating; one stable aggregate app/type/lint/build/SQL pass, narrow review, normal scoped push/PR. No target migration/main retry/deployment.

Ledger: author implementation locally first; no holding account, real payment, mass deletion, payroll rewrite or new cross-user report sharing. Preserve PR123/124 and all source branches.
