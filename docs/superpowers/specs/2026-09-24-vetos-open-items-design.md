# VetOS Open Items — Integrity and Reporting Design

**Date:** 2026-09-24  
**Baseline:** `origin/main` at `686afd7`  
**Delivery constraint:** review branch only; no production data changes, backfill, merge, or deployment.

## Purpose

Resolve the highest-confidence open defects without duplicating work already in `main`, then create the foundations for trustworthy inventory valuation and company-controlled compounds.

The initial production-facing goal is that a clinic invoice can never leave inventory, cost of goods sold (HPP), and accounting in contradictory states.

## Verified current state

| Item | Finding on `main` | Decision |
| --- | --- | --- |
| BUG-01 / BUG-09 | Ordinary clinic medicines call `stockOut` at invoice time and swallow failures. Compounding ingredients instead call `stockOut` when the medical record or inline recipe is saved; the compound invoice line deliberately has no `item_id`. `postJournal` is best-effort and also swallows failures. | Separate the two issue points and join their cost to an invoice exactly once; a UI preflight alone cannot guarantee atomic posting. |
| BUG-02 | Booking compares the scheduled instant with `now`; the UI always labels any past instant as a past *date*. | Implement a date-vs-time classification. |
| BUG-03 | `tarikTransaksi` already includes non-void clinic invoices. | Do not rewrite; add a regression test and require authenticated real-data verification. |
| BUG-04 | Multi-unit support exists in the reviewed purchase, sales-document, and request forms. | Audit each documented form and add coverage only where a path is missing or inconsistent. |
| BUG-10 | Merged in PR #4 (`289e127`) as itemized clinic/compound reporting. | No duplicate implementation. |
| BUG-07 / BUG-08 | Fixed-asset and recurring-journal screens already exist. The stronger atomic asset and bounded-recurring changes are on divergent old branches, not `main`. | Keep out of this change set pending focused reconciliation and a precise recurrence definition. |
| REQ-02 / REQ-03 | Compounds are currently created per medical record; there is no official company catalogue or compound margin report. | Plan after inventory integrity and valuation basis are established. |
| REQ-04 | Visibility of HPP is a policy decision. | No access-control change without owner decision. |

## Phase A — Atomic clinic inventory and HPP

### Problem

Ordinary clinic medicine is issued after an invoice is created, and `stockOut` errors are logged and ignored. A compound's ingredients are issued earlier, during `simpanRekamMedis` or `addRacikan`; no consumed cost is stored on its ingredient rows. Its invoice has a null `item_id`, so the payment action cannot see its ingredient HPP. The shared `postJournal` helper is intentionally best-effort: moving inventory alone into a transaction while calling this helper would still allow an invoice without an HPP journal.

### Design

Use two coordinated, database-backed posting boundaries, preserving the two existing business events. Each database-side operation must enforce branch authorization under the authenticated caller and fail closed; service-role bypass is not an acceptable replacement for RLS.

1. At every compound-creation entry point (medical-record save, inline recipe, and inpatient daily-log POS), validate the branch warehouse, on-hand stock, and all active FIFO/FEFO layers for every ingredient; consume them and persist per-ingredient cost in one database transaction with recipe/BOM creation. Do not debit inventory a second time at checkout. A compound void restores the exact issued quantities and historical cost, not the current master buy price.
2. At individual and group invoice checkout, validate all ordinary medicine lines and their total demand, then atomically issue their FIFO/FEFO layers, persist invoice and line HPP, and write balanced revenue and inventory/HPP journals. Attach previously issued, unposted compound ingredient costs to the corresponding invoice lines and HPP journal exactly once. An invoice rejected before commit leaves no partial stock, invoice, or journal changes.
3. Store an immutable cost link between a compound recipe, its ingredients, and the clinic invoice line, including the exact quantity and cost used. Explicitly handle edits, void/reissue, and duplicate retries before any path can post cost twice; failing to support these paths is a blocker to releasing the full atomic boundary.
4. Fail closed on stock shortage, missing warehouse, missing/zero-cost layer, missing accounting account, or failed journal insertion. Free-text and service lines do not consume inventory. Present a recoverable, actionable error without marking the transaction complete.
5. Scope SQL tests to the authenticated role and RLS, concurrency and repeated submissions, compound creation/void, ordinary medicine checkout, grouped checkout, edit, and void/reissue. Do not run migrations against production as part of review.

### Error handling

The user sees the failed item and the reason (for example, insufficient stock), while the original form values remain on screen. No retry queue is created in this phase: a failed financial transaction is intentionally not a pending transaction until BUG-05 has an approved lifecycle and reconciliation design.

### Tests

- insufficient stock rejects ordinary checkout and compound creation at their respective entry points;
- no partial recipe or invoice, stock movement, or journal is produced after either rejection;
- valid stock produces FIFO/FEFO HPP per line and balanced COGS/inventory journal lines;
- a previously issued compound links exact ingredient costs to its later invoice without a second stock deduction;
- compound void and clinic invoice edit/reissue do not lose or double-post inventory/HPP;
- simultaneous and repeated checkout attempts preserve nonnegative stock and one posting;
- service and free-text lines remain valid without inventory.

## Phase B — Booking and reporting regressions

### BUG-02

Classify a booking as `future`, `today-past-time`, or `past-date` in a pure helper based on Jakarta time. The UI keeps the red treatment but uses `Jam booking sudah lewat` only for the second state and `Tanggal booking sudah lewat` only for the third.

### BUG-03 and BUG-10

Add regression coverage around the transaction aggregation contract: non-void clinic invoices contribute branch revenue and channel counts. BUG-10 remains unchanged because its implementation is already in the baseline.

### BUG-04

Create a route-by-route checklist for purchase invoice/PO, sales invoice/order, and both stock-request forms. Reuse the existing `unitOptions`/`pickUnit` contract; do not build a second unit model. Only forms proven missing that contract enter a later bounded change.

## Subsequent, separate phases

### REQ-01 — valuation

Add an owner/finance report of quantity, active FIFO value, and average HPP per item and warehouse/branch. It must calculate from stock layers/movements, not `items.buy_price`, and is read-only.

### REQ-02 / REQ-03 — official compounds and report

Introduce owner/admin-managed compound templates with immutable versioned ingredients. Doctors select a template, may set patient-specific dosage only within approved rules, and the invoice stores the selected template version. The compound report then joins the immutable sale, actual HPP, branch, and doctor to calculate quantity, cost, sale value, gross profit, and margin.

## Explicitly deferred decisions

| Item | Decision required |
| --- | --- |
| BUG-05 | Which transactions become drafts, draft expiry, who can resume, and how a later submission avoids duplicate financial posting. |
| BUG-06 | Whether “all reports” means every report screen; CSV/Excel can share a server-side tabular exporter, while PDF needs an approved print/PDF convention. |
| BUG-08 | Frequency, start/end or run-count, pause/resume, catch-up, approval, and idempotency rules. |
| REQ-04 | Owner decision: recommended visibility is OWNER/FINANCE only, with doctors seeing stock availability and official compound choices but not HPP. |

## Non-goals

- No data correction, production backfill, production migration run, merge, or deployment.
- No import of the divergent `codex/p0-p2-stabilization` / `codex/full-stabilization-release` branches.
- No authenticated production-data verification without explicitly supplied access.
