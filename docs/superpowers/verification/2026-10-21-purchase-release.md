# Bounded purchase correction release

Baseline: production main c66507c. Reuse the reviewed PO lifecycle and purchase-payment corrections. Atomic bank reconciliation is included as a dependency because payment cancellation checks its exact source account/void metadata and must share ledger locks with reconciliation. Invoice lifecycle, bank transfers, opening balances, inventory correction and reset changes are excluded.

## Behavior

- Active OWNER can edit/cancel a PO before receipt, invoice, payment, advance or return dependencies exist. Existing create/status/reorder callers use protected atomic paths and preserve durable input.
- Active OWNER can cancel posted individual or grouped invoice payments with exact signed debt, journal and advance-allocation reversals. Original history remains; a replacement is reviewed through the existing payment flow. Ambiguous legacy provenance, closed periods and covering reconciliations block cancellation.
- Reconciliation creation/edit/cancellation and result recovery are atomic. Existing journals remain immutable; later reconciliations must be corrected first. All-branch capability is required to calculate a complete bank balance.
- Existing sale corrections, transaction notifications and saved receipt/input recovery remain in this branch.
- PO correction controls now appear only for an active OWNER; database checks remain authoritative.
- PO correction history uses the existing branch-access helper even when the source branch is absent. Inactive/unassigned staff cannot read global correction records. The native regression failed before this one-line policy correction and passed afterward.

## Verification

- 15 focused application suites / 85 tests passed, including actual forms, durable acknowledgement, PO owner-only controls, order/reorder callers, signed dated debt readers and existing finance/correction entry points.
- Native PostgreSQL PO suite passed, including actual concurrent advance-versus-PO cancellation.
- Native payment suite passed, including original atomic-payment regression, exact cancellation retries, source deactivation, both payment/cancellation orders and different-invoice supplier-wide advance races.
- Native reconciliation suite passed, including exact rollback after final request failure, immutable journals, cents, dependencies, access revocation while waiting, concurrent retries/recovery and ledger snapshot locks.
- Native bank/payment race suite passed in both orderings.
- TypeScript and scoped ESLint passed.
- Test-only reconciliation snapshots now cover all affected bank/request/revision/journal tables without depending on unrelated maintenance scripts. PostgreSQL runners use explicit owned localhost databases; inherited libpq routing options are stripped from the PO runner.

## Production gates and boundaries

Fresh current-production backup export (192 public tables) has been persisted and checksum-verified. Actual restore verification, current preview build, three-migration installation and authenticated production checks remain release gates. No purchase deployment or live financial correction is claimed here yet.

External refunds/repayments remain operator actions. This release corrects advance allocations in invoice payments; it does not claim a new standalone advance lifecycle or invoice cancellation. The earlier operational reset is not repeated.
