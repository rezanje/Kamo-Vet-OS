# Purchase invoice correction and recovery verification

Worktree: `/Users/rezanje/.codex/worktrees/kamo-feedback-oct20/VET_OS`
Base: `2fdf121` (full SHA in manifest). Independent specification and quality reviews approved this local implementation. Production application remains pending.
Owned scope: exactly 28 files listed with individual SHA256 in `/tmp/vetos-purchase-invoice-freeze-20261021.json`.
Manifest SHA256: `f7216335a50de2cebc408338b8677718886973fe544a6cc8c787d884dbbd2dbb`.

## Implemented behavior

- Direct invoices post header, rows, attachments, stock, FIFO, journal and durable request result in one database transaction. Unit/factor, supplier/warehouse/branch, active inventory item, finite amount/date/expiry and inclusive VAT/DPP are checked in the database.
- PO invoices retain the existing internal posting routine but derive trusted FIFO plans, capture exact before/after layer and journal evidence, and exclude void originals from remaining quantity. Ledger lock precedes explicit invoice/journal numbering; no core FIFO helper changed.
- OWNER cancellation requires reason, revision, durable key, original/current open posting dates, same original VAT month, and a date not preceding source invoice or payment history. Active payments, payment orders, PO returns, downstream consumption or changed layer/journal evidence block cancellation. Existing payment reversal must run first; invoice cancellation never restores advances.
- Cancellation preserves original invoices/items/journals, adds a reversing journal and compensating stock history, restores exact recorded PO valuation or removes exact direct-invoice receipt quantity, and reopens PO invoicable quantity.
- A unique replacement link permits one replacement through the existing PO/direct forms; original input, supplier/date/warehouse/rows/note/attachments are prefilled. Durable request identity survives local draft expiry, failures preserve input, and visible read-only result recovery is available.
- Active liability, purchase, dashboard, operations and payment-order candidates exclude void invoices. Dated subledger reversal preserves historical balances; VAT source/ref reversal nets in the original month. History and links remain visible.
- Protected invoice/item/journal/stock-move writes reject raw authenticated/service-role DML. New proof/request tables are private with RLS; branch read isolation retained. Replay rechecks current source scope, item and account activity.

## Exact local verification completed

- `python3 scripts/test-purchase-invoice-lifecycle-postgres.py` PASS: all production migrations; unchanged original purchase recovery/receipt/FIFO assertions with fixture-only compatibility adjustments; actual PO receipt, partial invoice splitting/factors/VAT; direct invoice; late fault rollback; original journal/line/item immutability; cancellation/replacement/remaining quantity; payment reversal prerequisite; order reservation/return/VAT/downstream-price/consumption blocks; date/amount/actor/module/branch/RLS/raw-DML checks; matching/changed retry and result recovery.
- Same runner PASS real concurrent same-key direct creation and cancellation, PO creation, both consume-versus-cancel orderings, and inactive warehouse recheck after a lock wait. Barrier queries scoped to `datname=current_database()`; all PG environment variables stripped, only owned unique localhost 5432 database, dropped afterward.
- `python3 scripts/test-purchase-payment-corrections-postgres.py` PASS including existing atomic-payment suite, source-account deactivation, identical cancellation, both payment/cancel orderings and supplier-wide advance races on different invoices.
- `node node_modules/typescript/bin/tsc --noEmit` PASS.
- Scoped ESLint on all 24 owned TypeScript/TSX files PASS.
- Focused Vitest six suites / 31 tests PASS: transaction-form-draft, purchase-invoice-form, unit-submission-actions, purchase-actions, purchase-payment-subledger, purchase-invoice-actions.
- `git diff --check` PASS. CLI-generated `supabase/.temp/cli-latest` restored to HEAD.

## Review boundaries / deliberate safety blocks

- Legacy invoices lacking trusted posting evidence cannot be cancelled automatically; PO invoices with ambiguous historical allocations cannot be extended. An ordinary pre-invoice return is supported only for the first gross invoice of all received quantities at unchanged PO cost with zero VAT and exact linked return HPP/source-layer evidence; altered cost, net-only quantities or ambiguous returned stock requires reconciliation. The original history stays readable with reconciliation guidance.
- Any PO return blocks invoice cancellation; a PO containing a corrected invoice blocks subsequent return posting until reconciliation of its liability basis. Later FIFO use or altered valuation also blocks. VAT cancellation crossing the original tax month blocks.
- This is local verification only. No live migration, deployment, user provisioning, reset, or key handoff. Final broad verification and release remain parent-owned after remaining complaint fixes.
- Parent-owned reset registry already includes `purchase_invoice_postings`, `purchase_invoice_layer_proofs`, and `purchase_invoice_cancellation_requests` (141 operational / 65 masters); no further new table introduced.
- Parent's journal-number follow-up, race runner, remaining-form and merchant-fee fixture fixes, reset registry and docs are excluded from this manifest. Parent reported cross-family races and verified reset/restore independently; those are not claimed as this agent's reruns.

## Spec-review corrections verified and refrozen

1. Dashboard now reuses `sisaFakturablePerBaris` from the existing liability page. It adds received-but-unbilled PO value to active invoice value, retains the baseline `Diterima` status boundary, includes direct invoices, excludes void originals and applies returns once. No new report abstraction.
2. Removed the unconditional pre-invoice return ban. The safe narrow case preserves full receipt gross invoicing, GRNI transfer, existing AP return offset and unchanged inventory valuation; cancellation with returns and returns after corrected invoices remain blocked.

Targeted follow-up verification: purchase-dashboard Vitest 5/5 PASS (receipt before invoice, partial repricing plus direct invoice, sole invoice cancellation, once-only replacement, return before and after gross invoice). Full invoice-native runner PASS including new actual receipt 400 -> real return 100 -> gross invoice 400: quantity 3, FIFO value 300, inventory debit balance 300, AP credit balance 300, GRNI zero, other accounts net zero. Price-change, net-only invoice and changed-layer cases reject. Existing native lifecycle/recovery/concurrency cases remain PASS. Final tsc and scoped dashboard/test ESLint PASS, diff-check PASS. Earlier payment regression gates remain applicable; no broad rerun.

Specification rereview approved the unbilled-PO dashboard and narrow return corrections, independently rerunning the five dashboard checks. Quality review independently ran the invoice-native suite and five application suites (21 tests), found the post-number-wait inactive-COA gap, then approved the final 28-file snapshot after independently rerunning the complete invoice-native suite including the new rollback race. No P1/P2 finding remains in this bounded milestone. Final combined verification and production release remain open.

## Quality-review correction: current account check after PO counter wait

Independent quality review identified that the legacy PO internal routine read account activity before its journal-number wait. The native runner reproduced RED: with the actual journal counter held, an actual PO invoice blocked on it; account 2101 was deactivated and committed; releasing the gate still allowed the invoice to commit.

A single existing-helper call `purchase_invoice_source_active(v_invoice)` now runs immediately after purchase-invoice posting evidence is inserted. It validates the actual journal accounts after the wait and holds their FOR SHARE locks through commit. No new helper or table.

GREEN: the same actual concurrent case now rejects and an exact before/after JSON snapshot across invoice headers/items, aggregate stock, FIFO layers, stock movements, journal headers/lines, posting evidence, layer evidence and durable operation results is unchanged. Full invoice-native runner (including original recovery, both consume/cancel orderings and the ordinary return/gross-invoice case) PASS. Python compile and diff-check PASS. No application files changed or broad tests rerun for this correction. Manifest remains 28 owned files.
