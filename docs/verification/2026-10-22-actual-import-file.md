# Actual supplied workbook: incident remains blocked by source decisions

Base `007a507` preserves PR84 and PR85. This change fixes false validation success; it does **not** claim the user's complete import now succeeds. No production release is authorized by this renewed investigation.

## Actual file access and structure

The supplied Library attachment was successfully materialized using a fresh authorized transfer. It is a genuine XLSX ZIP, 70,174 bytes, with a 34-column data worksheet (486 rows including its header) and an instruction worksheet. It was inspected before parsing. The raw workbook, parsed private rows and full action/RPC responses remain in a private directory outside git; none are included here.

The unchanged source has 485 master rows. All 485 omit **Jenis Barang**. Both XML inspection (no cached formula values hidden in that column) and the production parser confirm this. The balance parser reads 304 positive-balance rows without structural errors. Every balance row omits **Per Tanggal**; the form can supply that date explicitly, but the intended date was not provided for this investigation. Of 304 balances, 253 produce fractional-cent line valuations, and their source aggregate is not an exact cent amount.

## Real actions and isolated PostgreSQL

Tests used owned PostgreSQL 16 containers with `--network none`, no published ports or shared volumes, and all 222 repository migrations. The production TypeScript parsers/server actions ran in-process with a fixture Supabase query adapter backed by those native tables/RPCs; only authentication identity/cache/navigation were mocked. This is **not** a claim of authenticated browser/PostgREST/production acceptance.

Exact private action responses were retained. Only redacted aggregates are committed:

| Scenario | Preview / confirmation | Saved balance review / posting | Financial effect |
| --- | --- | --- | --- |
| Actual unchanged file, empty master, before fix | Preview incorrectly `ok: true` with 485 rejected; confirmation incorrectly `ok: true`, `phase: done`, zero items and an empty master run marked posted | All 304 balances rejected; review `can_post: false`; post action denied | Zero stock moves/journals |
| Actual unchanged file, **hypothetical** existing master | Explicit diagnostic assumption: all source codes seeded as active inventory, no expiry, fixture date 2026-01-01. Baseline actions still report the empty master successful | 304 balances prepare successfully; real review denies them with `Jumlah/nilai sumber harus positif dan tepat dua desimal; tinjau pembulatan`; post action denied | Zero stock moves/journals |
| Actual unchanged file, after fix | Preview and confirmation both `ok: false`, `phase: preview`, `run_id: null`, 485 rejected with actionable missing-type guidance | Correctly stops before preparation | No database writes (all relevant counts unchanged) |
| Fully **synthetic** explicit INV, qty 3 / cost 12.5 | Real parser, master preview/confirmation and stock preparation succeed | Native review/post succeed; exact retry returns identical receipt | One journal, qty 3; layer value, debit and credit all 37.5 |
| Fully **synthetic** explicit INV, qty 3 / cost 0.333333 | Preparation succeeds | Existing precision guard blocks review/post | No financial writes |

The hypothetical existing-master scenario isolates the source precision blocker with the **actual unchanged bytes**, but does not establish production SKU types, date, stock history, accounting locks or other GL. No type/date was inserted into the user's file, and no corrected customer workbook was produced based on assumptions.

## Scoped fix

`invalidMasterInput` rejects a master preview/confirmation when parsing yields no valid source rows, before import-run/master writes. It retains rejected/skipped row counts and capped row details, returns no run ID, and explains the reasons. This also prevents confirming legacy empty previews. Missing Jenis Barang now explains the accepted INV/SVC/NON/GROUP values. Mixed valid/rejected imports retain their existing path. An optional accompanying category file does not turn a zero-valid-master upload into a category-only import; no standalone contract for that flow was found.

No default type is guessed, no rounding is applied, and no financial guard or SQL migration is changed. Stock/journal atomicity and exact retry remain enforced by the existing posting RPC.

## Validation and evidence

- Four synthetic action regressions failed before implementation and passed afterward.
- Focused suites: 57 passed. Full suite: 311 files / 2,417 tests passed.
- Actual-file action rerun after fix: 485 rejects, null run IDs, no database writes.
- Synthetic real-action/native-SQL pipeline: preparation, saved review, precision denial, successful exact-cent posting/retry and reconciliation passed. Its first harness run hit the default five-second timeout; an outcome check confirmed no financial writes before retrying with an appropriate local-test timeout.
- TypeScript, scoped ESLint, whitespace and production build passed. Existing unrelated lint/Edge Runtime warnings remain.
- Independent Sol 6.1 high review found no Critical/Important regression; 51 focused tests independently passed. Reviewer did not inspect private source data.
- Native SQL regression `accurate_inventory_source_precision.sql` pins precision denial with no writes and a separate exact-cent posting with one balanced journal/exact retry. Run with `python3 scripts/test-accurate-inventory-accounting-postgres.py accurate_inventory_source_precision.sql`.

See [actual before](../evidence/2026-10-22-actual-import-file/actual-empty-master-before.json), [actual saved review](../evidence/2026-10-22-actual-import-file/actual-empty-master-review.json), [hypothetical master](../evidence/2026-10-22-actual-import-file/actual-hypothetical-master.json), [actual after](../evidence/2026-10-22-actual-import-file/actual-after-fix.json), [synthetic reconciliation](../evidence/2026-10-22-actual-import-file/synthetic-reconcile.json), [red tests](../evidence/2026-10-22-actual-import-file/red.log), [full tests](../evidence/2026-10-22-actual-import-file/full-tests.log), [build](../evidence/2026-10-22-actual-import-file/build.log).

## Required before a successful customer import

1. Confirm whether all 485 rows are inventory or provide their actual types; do not infer types from names, categories or positive balances.
2. Confirm the intended opening position date.
3. Finance/source owner must decide how fractional-cent source valuation is reconciled. Existing posting intentionally refuses to invent that decision. Further production blockers may also exist; production stock/GL/schema were not queried.

The parent was asked to obtain the minimum type/date clarification. No raw workbook/private rows were published. No production import, transaction/journal write, data reset/deletion, credentials/permission change, merge or deployment was performed. A01/PR82/PR83 were not touched.

## Follow-up: rounding recommendation and exact decisions

This is an unimplemented proposal for Finance/source-owner approval. Existing `src/lib/pos-money.ts` uses decimal arithmetic and HALF_UP; the Accurate bridge separately requires the exact inventory basis to be cents and reconciles it against layers/moves. Do not relax those guards or round only the journal while leaving an unequal inventory basis.

Using the original worksheet's decimal strings directly (100-digit arithmetic), independently verified with Python Decimal and decimal.js HALF_UP:

| Candidate calculation | Aggregate difference in rupiah |
| --- | --- |
| Round the sum of original qty × unit cost once to two decimals, minus original unrounded sum | -0.002648502629865 |
| Sum of rounded row values, minus original unrounded sum | +0.067351497370135 |
| Sum of rounded row values, minus rounded batch total | +0.07 |
| Round unit HPP first, multiply by qty and sum, minus rounded batch total | -0.23 |

Maximum absolute single-row rounding residual is 0.0049989347970 rupiah. The existing parser's numeric-decimal total differs from original XML arithmetic by only -0.000000000203995 rupiah; floating-point conversion alone does not explain the precision refusal. These are aggregate diagnostics, not approved posting adjustments. No individual row or original total is published.

Recommended decision candidate: use the authoritative Accurate inventory valuation at the agreed branch/warehouse/date as the control total. If Finance accepts a computed source target, prefer HALF_UP once on the sum of full-precision qty × HPP, rather than rounding each unit HPP. Preserve raw qty/HPP and explicitly review the residual. Any future implementation must represent approved posted valuation and its rounding reconciliation explicitly, retain source evidence and make stock/layer/move/GL totals reconcile under the revised audited contract. The current model cannot be fixed safely by changing only journal rounding; allocation/valuation representation needs separate design and tests before any guard changes. If the source report instead authorizes per-row rounded values, its +0.07 difference is a deliberate alternative decision.

Source file versus existing metadata:

- File has codes, names, categories, units, balance qty/cost and one source branch/warehouse pair. Type and date columns are blank.
- Existing production `items` and `item_units` could supply type, active flag, base unit/conversions and expiry requirements by an exact unique code match. Production branches/warehouses could resolve the source destination. Those records were not accessible through an authenticated database connector in this session; no credentials were sought or guessed. Do not mistake the diagnostic fixture for production coverage.
- For a confirmed stock-only import of already-known SKUs, preserve existing master attributes rather than filling all file types or rewriting blank master fields. Only unmatched/ambiguous/new SKUs need a supplied type. Current master-import validation remains strict; a stock-only route would need an explicit reviewed contract.

Minimum missing decisions: (1) stock-only for existing SKUs versus master updates/new SKUs, and actual types only where no exact master match exists; (2) intended opening date; (3) authoritative source valuation and approved rounding scope/control total. Equity selection/reason and existing-stock/GL checks remain mandatory in the existing OWNER review. The status-only PR is useful to stop false success, but insufficient for the customer import.
