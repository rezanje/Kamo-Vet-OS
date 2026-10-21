# Average activation accounting guard

Base: fresh main `9aafe37` (independent PR80 merged). Branch `codex/kamo-average-activation-guard`. The older prototype branch is preserved and will not be published or combined with this implementation.

Confirmed root cause: `activate_moving_average()` validates physical layer quantities/prices but never checks the existing inventory GL. It can switch method while remaining inventory is160 and GL1301 is0. No counterpart or historical repair can safely be inferred from that discrepancy.

Scope: add one private activation precondition and a guarded insertion into the existing activation RPC. Preserve its no-argument interface, existing costing/closing, idempotent already-active return, and all independent PR80 changes. No new costing engine, historical mutation, stock revaluation or production operation.

- [x] Native failing regression: missing GL, wrong branch allocation despite equal global totals, unallocated GL, unbalanced/nonfinite/future inventory journals, orphan/mismatched layers, negative opening pools, permissions; verify every denial leaves stock/history/settings/events/GL unchanged.
- [x] Implement activation-only reconciliation: finite, complete nonnegative remaining quantity/value from physical layers must match finite, balanced GL1301 per branch within1e-8 Rupiah (numeric division precision only). Negative opening pools have no audited signed layer basis and require separate reconciliation; ongoing known-cost negative-stock policy remains unchanged. Missing GL/PDRY fails closed without creating a journal or selecting a counterpart.
- [x] Hold the existing exclusive inventory advisory lock; acquire needed relation/row locks with NOWAIT, recheck current actor/scope and read stable stock/GL before any activation write. Fail with a retryable lock conflict instead of creating an inventory/journal lock inversion. Test real waiting sessions in both orders, role revocation and concurrent retries.
- [x] Update fictional existing activation fixtures to include their explicit balanced opening GL, retaining their behavioral assertions. Run average/correction/clinic/import and FIFO regressions in owned network-none PostgreSQL. Add one action/UI assertion for the actionable failure handling.
- [x] Record other confirmed/static requirement gaps separately. Fetch main/release status; do not modify PR68–73+79 branches. Test their migration combination where available; rebase only after the release changes are observable on main. Push only this narrow branch and create a draft PR. No production migration, activation, deployment or historical edits.

Verification and separate review findings: `docs/verification/2026-10-21-average-activation-accounting.md`. Draft PR: https://github.com/rezanje/Kamo-Vet-OS/pull/82 . Release/activation remain outside scope.

## PR81 review follow-up

- [x] Reproduce the missing opening-GL helper in PR81's actual combined runner.
- [x] Load it for three average suites and the clinic suite; preserve exact stock/closing source checks and allow only PR82's reviewed activation guard insertion.
- [x] Update the legacy direct-return fixture to assert PR72's rejection and rollback, preserving pre-PR72 FIFO coverage.
- [x] Execute deployed-main-then-pending and clean chronological PR81+PR82 replays, including `20261021183000_correction_master_reference_guards.sql`; both pass.
- [x] Record final combined activation races; publish only the test/fixture/documentation follow-up on the existing draft PR82.
