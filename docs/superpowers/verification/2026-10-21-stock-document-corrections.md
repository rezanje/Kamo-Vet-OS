# Penyesuaian persediaan and opname corrections — 21 October 2026

## Scope and isolation

Implemented in Codex Cloud from main `d6d9c70d24fed05ff16a2dfd32f55cbeaa48fb3f`, on `codex/stock-adjustment-opname-corrections`. Root `AGENTS.md` and `CLAUDE.md` were read. Installed Next is 15.5.25; the local Next documentation directory mentioned in AGENTS.md is absent. UI changes follow the repository's existing server-action/component conventions.

PR67 purchase invoice corrections are already merged and are not repeated. Open PR62's published changed-file list has no adjustment/opname action, page, or correction migration. PR68 is the parallel internal-bank-transfer task; its application paths and migration do not overlap this branch. No instructions were sent to the other implementation sessions.

Only inventory adjustment and opname result quantities are editable here. Transfer/receipt/return/sale activity is a dependency check, not a new correction feature. No bank-transfer, opening-balance, payroll, asset, wholesale, reset, generic posting, numbering, or FIFO primitive was changed.

## Behavior

- Active OWNER (Super Admin), current branch scope, active warehouse/branch/items/accounts, and open source/current accounting periods are checked inside database functions. No role capabilities or existing module permissions are broadened.
- Detail pages expose corrected quantity inputs and a required reason. Preview displays old/new transaction quantities, current/projected stock and inventory/variance accounting values. Save recomputes the full preview under source, stock and layer locks; a changed snapshot rejects before writing.
- Original headers/items remain intact. Each successful correction appends signed reversing stock moves, exact restored/removed original lots, exact reversing journal lines, replacement stock effects/journal, actor/reason, source snapshot and old/new counts. The immutable audit revision is the effective replacement document and links the original document and journal IDs; no duplicate original-family header is inserted.
- Effective adjustment totals/details and both backoffice/cashier opname result counts read the latest replacement. Cashier result reads do not expose cost or the OWNER correction form.
- All correction effects and the durable request result commit in one PostgreSQL transaction. Any stock, journal, audit or request failure aborts that transaction. Direct API writes cannot rewrite corrected source/history. Normal FIFO consumers can still decrease a protected lot's remaining quantity.
- Request keys and exact pending payloads survive reload and a server revision change after a lost response. The form freezes uncertain submissions and offers read-only recovery or retry of that same request. Reuse with a changed payload is rejected. A waiting recovery/duplicate submission sees the committed result, not a second posting.
- New outgoing rows in these two existing source forms use `issue_stock_document_recorded`. It derives quantity/reference/warehouse from the source row, enforces the source actor's existing role/module/branch or cashier-shift access, and atomically stores exact FIFO/expiry evidence with the stock issue. Duplicate issuance returns its recorded result; incomplete evidence rolls the stock issue back. This prerequisite avoids making future outgoing corrections depend on guessed average-cost lots.

## Conservative rejection and remaining boundaries

- Legacy outgoing stock documents without exact lot evidence are rejected, even when aggregate stock appears sufficient. No automatic backfill, inferred lot reconstruction or direct balance edit is provided.
- Incoming source layers must be complete, intact and match their stock moves. Later sales/use/transfers/returns, changed source data or valuation, insufficient stock, inconsistent stock/layer balances, incomplete/gross-mismatched journals, inactive accounts, closed periods and duplicate/incomplete opname results reject the correction. Subsequent corrections require the full post-correction stock/layer/movement snapshot to remain unchanged; even a later inbound movement can require dependency review.
- Opname with a linked shortage invoice is rejected. A replacement shortage that would require a petshop invoice is also rejected. Invoice/receivable review through Finance is required; this PR does not supply an automatic invoice/piutang correction workflow or pretend that correcting stock cancels a debt.
- Legacy integer-rupiah rounding that disagrees with actual FIFO value rejects rather than inventing a reconciliation adjustment. New source forms retain their existing rounding policy, so fractional valuation mismatches can still need review.
- Initial document creation still uses the existing multi-call posting flow; this PR makes its outgoing stock/evidence pair atomic, not the entire initial document creation. Partially posted originals cannot pass the correction evidence checks. Full original-creation recovery/atomicity is separate remaining work.
- The audit has no API write grants. The stock-specific history trigger is added to shared stock/journal tables but tests only these sources and corrected document identities. It does not replace generic ledger helpers. Production schema/ACL drift, real Supabase JWT/RLS integration and authenticated browser/API/database acceptance have not been certified.

## Verification actually run in this task

Commands:

```sh
python3 scripts/test-stock-document-corrections-postgres.py --baseline
python3 scripts/test-stock-document-corrections-postgres.py
npx vitest run src/lib/__tests__/stock-document-issue.test.ts src/lib/__tests__/stock-correction-actions.test.ts src/components/__tests__/stock-correction-form.test.tsx
npx tsc --noEmit
npx eslint 'src/app/(app)/pos/koreksi-stok' 'src/app/(app)/pos/penyesuaian' 'src/app/(app)/pos/opname' src/lib/stock-correction-types.ts src/lib/stock-document-issue.ts src/lib/__tests__/stock-document-issue.test.ts src/lib/__tests__/stock-correction-actions.test.ts src/components/__tests__/stock-correction-form.test.tsx
npm test
npm run build
git diff --check
```

Baseline SQL failed on the absent preview RPC as expected. The added mixed-cost outgoing-source case separately failed on its absent recorded-issuance RPC before implementation. The reload regression failed when the server revision advanced and passed after preserving pending identity independently of revision.

The SQL runner creates an owned PostgreSQL 16 Docker container with networking disabled, applies all 209 repository migration files, uses fictional auth/storage shims and the existing pre-0068 COA fixture, and removes its container. No database URL or production credentials are accepted. This is native PostgreSQL with repository migrations, not full Supabase provisioning or production parity.

SQL assertions cover both source families, incoming/outgoing corrections, mixed-cost/expiry lot restoration, correction-to-baseline cancellation, fractional counts, read-only preview, immutable originals, inventory quantity/card/layer/journal agreement, exact/conflicting retries, source-issuance retry, access denial, missing evidence, duplicate/NaN input, stale price preview, closed period, linked invoice, transfer/return dependency, insufficient stock, protected history/private request tables, and full snapshot rollback after injected replacement-journal failure. Injected proof-storage failure also rolls the initial stock issue back. Independent sessions demonstrably wait on locks for identical requests, both correction/consumption orderings and actor revocation during a source-document wait.

A final red/green SQL regression covers a correction after cancellation to a zero-effect replacement. Later revisions use the exact complete after-state comparison; they do not mistake earlier reversal movements for downstream activity by falling back to the original document timestamp.

A separate red/green regression verifies that an incoming replacement retains its source lot's expiry date when present. Exact outgoing-lot restoration also preserves cost and expiry.

Nine focused application tests, TypeScript, scoped ESLint and production build passed. Build retains unrelated existing warnings.

Full suite: **2,203 passed, 3 failed; 264 passed files, 2 failed files**. The same three failures reproduced on an untouched archive of main d6d9c70 using the same dependency installation:

1. `merchant-fee-report-pages.test.tsx` — `shows merchandise, merchant fee and final bill separately on sale detail`: missing auth mock/getUser.
2. Same file — `does not invent a fee for historical sales`: same missing auth mock.
3. `remaining-transaction-forms.test.tsx` — `clears acknowledged controlled rows and keeps defaults on later remount`: expects an absent `draft_key` input.

No unrelated test fixes are included. Form tests use jsdom and mocked actions; they are not a real authenticated browser round trip.

## Release gate

No merge, production deployment, production SQL/data mutation, credentials change, permission expansion or reset was performed. The SQL migration is a review artifact only. Matching migration and app need a separately authorized release and an isolated staging database for authenticated end-to-end acceptance. A cloud app preview, if produced by the branch build, does not establish that the new database functions exist there; do not exercise stock fixtures against a production-connected preview.
