# I02 — atomic stock-count posting

## Verified failure and change

A fictional action regression reproduced the old failure mode: `simpanHasil` committed a result and stock movement before journal validation failed. An open order could therefore retain partial effects and invite another attempt. This establishes a code defect, not the identity/cause of a particular customer incident; no original OPO/OPR was supplied for that claim.

New postings use one guarded PostgreSQL transaction for source result/lines, preserved count snapshots, stock movements/layers and FIFO proof, required balanced journals, existing retail shortage invoice, final status and durable receipt. The selected date is used consistently, including positive stock adjustments. Exact numeric FIFO cost stays in SQL. Identical lost-response retries return the same receipt; changed payloads reject. Uncertain/empty responses never report success or retire the draft. New receipts fence late source/count/scope changes and reopening. Existing open orders with any legacy result are blocked for reconciliation, with their original result visible; this release does not automatically repair/replay them.

## Integration manifest

Base main: `e46f45e97ae2500b3aaade5e8a9e50915f9fcca3`.

This candidate reuses both existing reviewed commits unchanged, rather than implementing them again:

- PR110 / I03: `277f3d669ffea1a70e98715c3274dae6f9660bf9` — complete paginated office history/result visibility.
- PR112 / I04: `37eadbbd08fb3bdeb0c5a0a63c25a95fe7d6af72` — preserve locked snapshots and show authoritative counts on retries.

Source branches remain intact. Releasing this combined candidate also includes those two commits; coordinate their PRs rather than applying their changes twice. No clinical performer/commission or catalog price/commission files are changed.

## Verification

- RED: old action left one result and one stock effect on synthetic journal failure. Legacy-partial page tests also failed before the fix. Status reopening guard had a separate SQL RED before its correction.
- Focused application tests: 7 files / 35 passed.
- Full application suite: 357 files / 2,712 passed.
- TypeScript and scoped ESLint passed.
- `python scripts/test-opname-posting-postgres.py`: PostgreSQL 17.6, 238 repository migrations, fictional auth/storage shims, owned network-none disposable database. SQL cases passed for gain/shortage/mixed/zero-cost, dates, exact fractional clinic FIFO, negative snapshot and intervening sale, uncounted rows, legacy retail invoice reconciliation, invalid/scope/period/branch/shift restrictions, rollback on journal/audit failure, immutable completed sources/counts/status, ordinary correction and receipt replay after correction.
- Four real two-session races passed: identical posting returns one result/receipt/movement/journal; cancellation wins; posting wins; late unlock waits then rejects without deadlock or snapshot change.
- Final independent read-only review: no remaining P1/P2; no broad suite rerun by reviewer.
- Production build passed with fictional Supabase environment values; only existing unrelated image/unused-variable warnings. Exact preview status will be recorded in the PR after terminal completion. Hosted full user simulations remain deferred.

The SQL baseline is repository history with synthetic shims, not a full copy of target schema/data. Read-only target preflight found 222 migration records, latest `20261023091210`, all nine named helper dependencies present, and no new receipt table. Presence alone is not proof of full definition/schema parity.

## Migration and release gate

Only new migration: `supabase/migrations/20261023134000_opname_atomic_posting.sql`.

SHA-256: `554095cd4170227f74a83ea490a6c62692358df7c9d79b2e0d8b36225c349ba9`.

Dependencies are existing stock-count tables, inventory/FIFO and accounting helpers: `inventory_is_average`, `stock_document_access`, `user_can_access_branch`, `purchase_payment_period`, `issue_stock_document_recorded`, `stock_in_fifo`, `sales_write_journal`, `wholesale_assert_journal`, and existing cancellation rules. Author/test only: **not applied to target**. Do not blanket replay missing historical migrations. Before release, verify exact helper signatures/definitions, existing table/trigger/owner compatibility, target recovery evidence and migration checksum, then apply this migration transactionally before switching the app. Existing table ACL/RLS are not widened. The new private receipt table/helpers are revoked; only the guarded posting RPC is callable by authenticated users.

Main/deployment remains blocked by the earlier automatic approval rejection for PR103. No denied operation was retried, no alternate merge route used, and no target write performed for this candidate.

Rollback must retain receipts, source snapshots and terminal guards. An app-only rollback reintroduces the old multi-request posting path, which is unsafe and may be stopped by the new fences. Prefer disabling new posting/fixing forward; do not drop receipts, erase history or rerun legacy partial sources. Existing approved corrections are separate effective documents and do not rewrite the original result.

## Explicit remaining limits/decisions

- Preserve current warehouse policy: clinic shortage uses actual FIFO cost variance; retail shortage creates the historical head-store receivable/sales invoice. Whether retail should instead expense shortages needs a business decision. Report-price choice does not silently change that policy. Retail fractional invoice totals that cannot meet the existing whole-rupiah rule fail atomically; no invented rounding allocation.
- Existing correction preview rounds values to cents and rejects certain exact sub-cent sources (for example cost 0.3125 vs 0.31). A regression proves the rejection leaves stock unchanged. This inherited limitation is not weakened or claimed fixed here.
- Existing historical partial results need source-level reconciliation before any repair. No data cleanup, automatic compensation, historical financial rewrite or production simulation is included.
- I02 customer incident identification and full user acceptance remain separate from the verified synthetic code fix. I03/I04 coverage is described in their existing evidence documents; this does not mark all inventory feedback complete.
