# Local candidate — rekap rawat inap / DP lanjutan opsional

## Scope and authorization

Andri authorized an invoice-like running inpatient statement and optional subsequent DP calculated from **50% of the remaining combined transaction balance after prior payments**. Initial minimum DP and authorized financial exceptions remain unchanged. Local-only work; no remote reads/writes, push, PR creation, merge, migration installation or deployment.

Base: `847fd9de93405ca51e9f5a4f9437e3a9c3450c67`, branch `hermes/ranap-rekap-dp-opsional`. Detailed evidence and the final commit SHA are in `/opt/data/kamo-pr-ranap-rekap-dp-opsional.md` and `/opt/data/kamo-ranap-rekap-dp-results.json`.

## Business behavior

- Three cards: Total transaksi, DP / total dibayar, Sisa tagihan.
- Rincian tagihan includes active invoices' stored lines/prices/discounts/tax and new prescription rows. New rows and their estimated tax are explicitly **pending, not booked AR/revenue**. Posting remains manual, using the existing Tagih sekarang action.
- Combined total = active stored invoice totals + all pending estimates including estimated PPN.
- Paid = existing active-invoice money readmodel (header DP + net payment rows, existing legacy-paid semantics, excluding void copies) + this visit's **unused** advance balance. Do not add receipt totals or applied advances a second time.
- Remaining = max(0, combined total − paid); optional DP = ceil(remaining / 2) whole rupiah. Example: 1,300,000 + 200,000 − 500,000 = 1,000,000 remaining; suggested DP **500,000**, not 450,000.
- The 50% button only fills an editable payment draft. It is not a submit button. If any payment amount has already been typed, it is disabled instead of overwriting mixed-method parts. Existing manual receipt allocation and save action remain unchanged.
- The legacy header DP appears in the payment history separately from wallet balance; original per-method receipt history and document links remain.

## Exact DB qualification

Forward migration: `20261104020000_ranap_rekap_dp_opsional.sql`, after main/hosted RS2 migration `20261104010000`. Parent rebased onto main `688fe64c`; the uninstalled candidate was renamed without changing its SQL body. Earlier local counts and artifacts below refer to the pre-rebase baseline and must not be presented as proof of the rebased head.

Only the trusted public `clinic_post_inpatient_stage_invoice(uuid,text,jsonb,jsonb)` wrapper is changed. It retains its coordinator lock, authorization, shift, period, clinical-line, duplicate, stock, journal and private posting-context checks. At its final DP enforcement point it waives the minimum only if another invoice of the **same visit** exists with:

1. a different ID from the new stage;
2. `voided_at IS NULL`;
3. `total > 0`;
4. `correction_pending` false/null.

There is no new client defer flag, no global minimum-setting change, no global `enforce_min_dp` change, no new tables/columns/FKs/RLS, and no changes to receipt, stock or journal posting functions. A positive prior invoice issued under the existing authorized exception also qualifies; current money received is not re-tested as a cumulative minimum target.

- No previous qualifying invoice: original initial minimum and authorized exception apply.
- Zero-value-only previous document: cannot bypass the actual initial minimum.
- Voided originals do not qualify. If the only active replacement is still correction-pending, it does not qualify; after correction completes, it does.
- Cancelled/reversed receipt with a surviving qualifying active invoice: still a subsequent stage, so no compulsory recollection. Existing release/reversal workflow and audit remain.
- Completed replacement carries transferred header money once; old voided original is excluded from statement totals.
- An already discharged stay is still accepted by the existing stage wrapper; this candidate does not add an open-stay-only restriction. Ordinary outpatient posting is not exempted.

## Verification on the complete local schema

Only Supabase auth/storage platform shims are used. Financial cores, stock/FIFO, journals, RLS and public RPCs are original. Calls execute as authenticated fictional users; no hosted/PostgREST or authenticated-browser UAT claim.

- Baseline has **325 SQL migration files**, candidate **326**, counted from disk and confirmed by bootstrap. Do not repeat the earlier assumed 326 baseline / 327 candidate count.
- Original mandatory-repeat-DP reproduced: 2 PASS / 1 expected FAIL, `DP_MINIMAL` requests 150,000 for a 300,000 subsequent stage despite a prior 500,000 header DP.
- Original misleading summary reproduced: 10 PASS / 1 expected FAIL in the rendered-page tests; wallet zero failed the requested total/paid/balance card contract.
- Final candidate-specific public-RPC suite: **24 PASS / 0 FAIL**. Includes zero-DP STAFF stages, real revenue/AR, stock/FIFO/HPP once, idempotency, mixed later receipt allocated to the oldest original invoice, per-account cancellation, initial minimum, zero-document bypass rejection, advance application/release/cancellation, reissue pending/completed behavior, stored price/tax/discount preservation, cross-branch/inactive rejection, period close and two real-session lock schedules.
- Original initial-DP/admission public-RPC suite: **28 PASS / 0 FAIL**, including STAFF/DOCTOR behavior, consent/doctor/plan/type failures and atomic rollback, replay, concurrent duplicate and authorization revocation.
- Original mitigation public-RPC suite: **66 PASS / 0 FAIL**.
- Original independent-session financial concurrency suite: **17 PASS / 0 FAIL**.
- Full Vitest: **5,019 passed / 0 failed / 1 skipped (5,020 total), 636 files**, with Node's experimental webstorage disabled and one worker.
- Typecheck, changed TypeScript ESLint, and `git diff --check`: pass.
- Failed intermediate run retained: 22 PASS / 1 FAIL from a test expectation incorrectly assuming HPP 14,000. The actual original fixture has unit cost 2,000, so two units correctly cost 4,000; the assertion was corrected from the fixture definition, and final verification re-ran all native suites. This was not silently relabeled as an all-green run.
- A candidate-specific zero-value bypass was found by review, reproduced RED (23 PASS / 1 FAIL in SQL and one rendered-page failure), then fixed by requiring positive prior total in both DB and UI; all final suites above include the fix.

## Review and release gates

Ready for independent code/product review, **not released**. No independent reviewer tool was available in this delegated session; do not describe self-review as independent approval. No authenticated browser/UAT, hosted PostgREST embed replay, Production preflight, Production migration or build was run. The required installed Next guide directory is absent from the shared dependency tree; the installed README was read, no network documentation fetch was made, and existing framework APIs/patterns were retained.

Before any future release: independent finance/security review; branch synchronization against then-current main; rerun local gates; separately authorized hosted compatibility/readback checks and authenticated cashier UAT; backup the existing stage wrapper's function definition; apply this migration before deploying the new UI. Never install solely because this local candidate passes. Rollback planning must restore/recreate the previous wrapper definition and the previous UI, without deleting invoices, receipts or audit history.
