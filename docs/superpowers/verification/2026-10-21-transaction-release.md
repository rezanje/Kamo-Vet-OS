# Bounded transaction correction release

Scope: retail/online sales, manual journals, and existing expense correction surfaces. This release reuses reviewed work from c52e96e and 6ecf18d without releasing unrelated purchase, inventory, banking or reset application changes. Production baseline: cb687ce.

- Sales: OWNER can cancel or cancel and prepare a separately reviewed replacement. Original receipt and signed financial, exact FIFO stock, customer/staff reward reversals remain auditable. Active reports exclude voided sales; cancelled receipt history remains visible. Online receipt numbers now open the correction detail.
- Manual journals: existing OWNER edit/void path retained. Creation now uses a single durable atomic request, consistent with correction forms.
- Expenses: existing authorized edit/void path reused. Clinic lists now link eligible active managers to the shared bookkeeping detail, show cancelled history and refresh after correction. Closed-period/closed-shift safeguards remain.
- Shared journal numbering takes relation locks before advisory number locks, preserving posting behavior and preventing lock-order deadlocks.

## Verification

- 13 focused application suites / 133 tests passed, including four new entrypoint tests, sale actions/replacement, payment/FIFO callers, completion readers and existing finance controls.
- After adding clinic refresh assertion: both affected suites / 10 tests passed.
- Native PostgreSQL: all migrations applied; merchant fee, split payment, online return and posted sale cancellation suites passed. Actual concurrent cancellation/retry/reward orderings passed.
- Native PostgreSQL finance: expense workflow, manual journal correction, cash correction and atomic manual journal creation suites passed.
- TypeScript, scoped lint, diff whitespace validation and production build passed.
- Fresh production backup 64e94738-7bfd-4b82-a9cd-20c78a77b100: 187 tables, 3,163,749 bytes. Disk checksum and real isolated restore passed. Retained privately with restore receipt; no private data included here.

## Release status

Prepared and tested. Production installation and deployment are not yet confirmed. Browser connection for the KAMO administration profile is unresponsive; terminal account access belongs to different projects. Do not mark production complete until exact-project installation, deployment and authenticated acceptance are recorded.

## Boundaries

Corrections preserve accounting history rather than deleting posted rows. Existing returns, closed shifts/periods, settled marketplace receipts and incompatible reward history require reconciliation and are blocked. Replacement does not automatically refund or charge an external payment provider. Whole ERP transaction correction remains outside this bounded release. The fresh-trial reset is already completed and is not repeated here.
