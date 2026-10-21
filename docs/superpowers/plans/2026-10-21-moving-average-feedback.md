# Feedback implementation plan

> Execution is authorized by the user's “sikat eksekusi”. Independent import,
> purchase UI and clinic paths are delegated; the coordinator owns core costing,
> closing, integration and verification.

**Goal:** deliver all five feedback items with consistent inventory and books.
**Architecture:** retain physical FEFO, add moving average valuation and immutable
cost events, then close completed months from dated event snapshots.
**Tech stack:** PostgreSQL migrations, Supabase RPC, existing Next.js/React styles.
**Spec:** ../specs/2026-10-21-moving-average-feedback-design.md

- [x] Reproduce missing inventory-import journal; implement exact opening posting
  and rollback/idempotency/branch/closed-period tests.
- [x] Expose purchase correction entry points and unit selection; display selected
  warehouse stock in PO and transfer forms with UI/data-loader tests.
- [x] Add core moving-average state, activation, dated immutable valuation events,
  receipt/issue and negative-stock variance handling; test real PostgreSQL first.
- [x] Integrate transfers, sale/group cancellation, PO repricing and reversal.
- [x] Integrate direct clinic/compound/delivery inventory paths and provenance.
- [x] Add completed-month closing, as-of snapshots and period/race protection.
- [x] Add average-aware reports and closing/activation UI.
- [x] Run focused and full tests, type checks, build, review the combined diff and
  document actual release readiness and any existing unrelated failures.
