# A01 activity audit — implementation and release evidence

## State and boundary

Meeting 22 October 2026, 61:00–65:58: general cross-module activity and per-transaction/menu history showing actor, time, object, create/update/delete and relevant changes; deleted evidence must remain discoverable. Work starts from latest fetched main `6289994422ce32e795f6f27baba04b5db477210d` (PR81 merge), isolated branch `codex/a01-activity-audit-20261022`, workspace `/workspace/kamo-a01`. PR82 average changes and new SO feedback are excluded.

**Code-complete for the declared 43-table slice; A01 as a whole remains OPEN.** Implementation/test status is distinct from push, deployment, migration and UAT. No historical audit is reconstructed. Events begin when the new migration enables capture; a deletion of an older object is recorded as a current deletion, never a fabricated old creation.

| Gate | Status |
| --- | --- |
| Declared source-table implementation | Complete, subject to PR review |
| Independent review | Complete, findings fixed and rechecked |
| Commit / push / PR | See final handoff / PR record |
| Production deployment | Not performed |
| Production migration | Not applied |
| Local test migration | Applied to disposable PostgreSQL 16 only |
| Full Supabase / staging / production parity | Not verified |
| Business UAT | Pending |
| A01 checklist | Keep incomplete until scope and UAT are accepted |

The parent manages the meeting Google Sheet. This task does not edit it.

## What changed

`20261022070000_activity_audit.sql` appends an independent, compact activity index in the SAME database transaction as each registered source-row mutation. Existing correction audits, invoice histories, request idempotency and journals remain authoritative and unchanged. This index stores field-level evidence for row mutations; it does not duplicate existing correction payloads or manufacture financial journals. A command can legitimately produce multiple events across document headers, detail rows and journals; those are distinct source-row changes, not a second posting.

The new `/perusahaan/log-aktifitas` page connects the existing Perusahaan tile, displays server time in WIB with seconds, actor snapshot/ID, module, stable object/line identities, action and minimized before/after changes. It supports module/object/action/date/document-code filters and stable ID cursor pagination, 40 events per page. An object link reads stored identity without requiring a live source row. Object membership retains BOTH parent identities when a detail is reparented; the mutation is still a single event.

Menu shortcuts are shown only for explicitly supported menus and readers with the existing Perusahaan route access. Dedicated object shortcuts exist in SKU detail, customer selected-card detail, sales order/invoice, purchase order/invoice, and clinic invoice payment detail. Other registered objects can be selected from the general viewer or their menu shortcut. Existing journal log and clinic correction history are retained.

## Authorization and privacy

- New audit readers conservatively match the existing master lifecycle audit: **active OWNER/ADMIN**, current source-module access, current branch grants/capabilities and operational branch selection. Application navigation also requires the existing `perusahaan` route permission. Configured ADMIN without Perusahaan access gets no audit navigation; no route permission is added. FINANCE/STAFF/DOCTOR retain existing domain histories but do not gain this general audit viewer. Any request to extend that reader set requires a later decision and dedicated access tests.
- No existing source-table grant, RLS policy, role/module grant, account state or authentication configuration is broadened. New private capture/scope/context/sanitizer helpers have no application execute grant. The only exposed helper is a boolean current-access predicate.
- Actor comes from the verified server JWT subject and profile snapshot, not a submitted `created_by`, `received_by`, request payload or application context setting. Sessions without a subject are explicitly labeled system/database. The audit cannot identify a human behind a privileged database/session without a subject and does not pretend it can.
- Required branches include both original and resulting scopes on branch/parent moves. Transfers include the document branch and BOTH account/warehouse branches. A reader must retain access to every branch on that event; a branch selector cannot reveal a different branch. Global/unknown financial scope requires all-branch capability and no selected branch. Global masters remain global, as their source reads already are.
- No source/account FK on the audit: source deletion does not erase identity, label, scope, actor or values. Parent tombstones supply scope when a cascade removes an ancestor. No existing permanent-delete permission is introduced; e.g. customer deletion remains unavailable through its existing application policy.
- Application audit INSERT, UPDATE, DELETE and TRUNCATE are denied. UPDATE/DELETE/TRUNCATE guards also reject accidental privileged modification unless a database administrator deliberately changes the schema. This is application immutability, not tamper-proof evidence against a database owner.
- Persist only registered numeric/boolean/null values, typed dates, known approved status values, and explicit business code/document-number exceptions. Arbitrary item names, customer/contact/address/tax/bank details, notes/reasons, payment-method text, unit labels, attachments, payload JSON, request fingerprints, credentials and raw clinical records are not copied as before/after values. Redacted field names still indicate the kind of edit. Actor display name is retained deliberately for attribution. Business codes/document numbers are intentional allowlist exceptions; operators must not use these identifiers as free-form confidential notes.
- Audit rows are excluded from the two existing master-reference discovery helpers. An item's own code in an audit must not make an unused item permanently unrenamable/untrashable. Real business/import/configuration references still block the existing operations, as before.
- Same-value row saves do not append an update. Existing atomic RPC request-key retries do not perform a second mutation and therefore append no second event. Independent source statements remain independent events; the index does not invent cross-command deduplication or merge partially successful legacy multi-request workflows.

## Real coverage by module

All listed tables capture INSERT/UPDATE/DELETE occurring after activation, whether the actual row write originates in a server action, direct permitted API mutation or existing RPC. Trigger capture does not make a previously non-atomic multi-request workflow atomic: each committed source statement has its own audit. Header and detail coverage are distinguished explicitly.

| Module | Registered headers / masters | Registered details | Main remaining gaps |
| --- | --- | --- | --- |
| CRM | `customers` | None | Pets, categories/status masters, promos/vouchers, loyalty ledger and WA events. Personal values remain redacted. |
| Persediaan / POS | `items`, `brands`, `units`, `sales`, `stock_requests`, `stock_receipts`, `stock_transfers`, `inventory_adjustments`, `opname_orders`, `opname_results` | `sale_items`, `stock_request_items`, `stock_receipt_items`, `stock_transfer_items`, `inventory_adjustment_items`, `opname_result_items` | Item prices per branch/tier, item-unit/category configuration, opname order/count staging rows, production, quests/rewards, shifts, stock/FIFO layer/move internals and component-allocation rows. |
| Penjualan | `sales_quotations`, `sales_orders`, `sales_deliveries`, `sales_invoices` | `sales_quotation_items`, `sales_order_items`, `sales_delivery_items`, `sales_invoice_items` | Sales advances/receipts and return records have existing domain accounting/history but no new dedicated index row; commissions/targets also unregistered. Header changes from those workflows are captured only if a registered header actually mutates. |
| Pembelian | `suppliers`, `supplier_categories`, `purchase_orders`, `goods_receipts`, `purchase_invoices` | `purchase_order_items`, `goods_receipt_items`, `purchase_invoice_items`, `purchase_invoice_payments` | Advances, payment orders and return records are not dedicated index sources; related journal/header mutations are not a claim of complete semantic payment/return coverage. |
| Klinik | `visits` (status-only values), `invoices` | `invoice_items` | Medical records/prescriptions, inpatient care, compounds/catalogs, bookings/consents/follow-ups, invoice payment rows and staff schedules. No raw medical/clinical narrative capture. |
| Kas & Bank | `cash_entries`, `cash_transfers`, `bank_reconciliations`, `expenses` | None | Account/mapping changes, AP/AR receipts outside registered purchase payment rows, attachment metadata. |
| Buku Besar | `journal_entries` | None | Journal line-only edits, COA/budget/recurring/closing configuration. A journal entry is a related accounting event, not a substitute for a missing source-module activity record. |
| Aset Tetap | `fixed_assets` | None | Change/disposal/transfer/depreciation child records and category masters. A captured asset header alone does not prove every asset workflow is covered. |
| HRIS | None | None | All HRIS actions remain outside this slice; existing payroll/HR audit is unchanged. |
| Pajak / Perusahaan / Pengaturan | None as independent sources | None | Tax/company/access/account/approval/branch/numbering settings, month-end run metadata and configuration remain outside this slice. Perusahaan is the navigation location, not a claim of company-settings capture. |
| Laporan | Read-only viewer of underlying data | None | No new report-view/export activity tracking. |

The reproducible [static inventory](../evidence/2026-10-22-a01/mutation-inventory.json) contains 428 literal Supabase calls: 289 direct mutation chains and 139 RPC calls. 86 direct mutation call sites target registered tables. **This is not 86/289 business coverage:** one call may affect many rows, an RPC may write multiple tables, and dynamic/indirect clients are not fully resolved. The inventory identifies exact source locations for follow-up; the SQL registry of 43 tables is the actual capture contract.

## Verification and reproduction

Read AGENTS.md, CLAUDE.md, existing release/engineering evidence, master lifecycle migration, source RLS/module/branch rules and local Supabase PostgreSQL guidance. Installed Next 15.5.25 lacks `node_modules/next/dist/docs/`; existing server/client patterns, installed type declarations and production build were used.

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/kamo-npm-cache
npm test -- --reporter=dot
npx tsc --noEmit
# Scoped eslint on changed .ts/.tsx/.mjs files (listed in the PR diff).
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fictional-a01-build npm run build
# Runs all 14 suites independently; currently returns nonzero for the
# explicitly documented pre-existing posted-sale cancellation fixture failure.
python3 scripts/test-activity-audit-postgres.py
node scripts/test-activity-audit-browser.mjs
node scripts/inventory-activity-mutations.mjs
git diff --check
```

The A01 runner reuses the existing disposable PostgreSQL harness, owns/removes a fresh network-none `postgres:16` container, accepts no external database URL, publishes no ports, uses only fictional fixtures and Supabase auth/storage shims, and applies all 223 source migrations. It seeds the existing pre-0068 COA prerequisite and the fictional COA 4101 prerequisite expected by the legacy manual-journal fixture (the same code exists in supabase/seed.sql). Each suite gets a fresh database clone; the existing dedicated cancellation/wholesale/reconciliation fixture recipes are reused exactly, so committed fixtures cannot pollute another suite. This is not a clean full Supabase reset or evidence of production schema parity. Docker plus a cached `postgres:16` image are required.

The Chromium runner uses the actual server page, real HTML forms and links, a fictional Supabase-query boundary, and loopback HTTP only. It requires local Vite, Playwright and `/usr/bin/chromium` (`KAMO_PLAYWRIGHT_MODULE` can select an installed package). It proves navigation and presentation, **not real GoTrue/PostgREST/Next authenticated end-to-end integration**.

Observed evidence:

- Untouched main baseline: **2,401 tests / 308 files passed**.
- Feature RED: new SQL test failed because `activity_log` did not exist; viewer/navigation tests failed for missing implementation/tile. The official-transfer regression reproduced the reviewer-found ambiguous SQL reference before its fix. Accessible-filter test exposed missing concise accessible names before the UI fix.
- SQL A01: actual official transfer create/retry; current actor vs spoofed business creator/context; safe/redacted before/after; recognized vs arbitrary status; no-op update; deleted transaction/customer identity; cascade child retention; reparent both identities/both branches; anonymous/disabled/wrong-role/module/branch/selected-branch denials; revoked branch grant; private helper execution and audit INSERT/UPDATE/DELETE/TRUNCATE denials; injected audit failure rolls back source create, update and delete.
- Independent reviewer used separate owned PostgreSQL 16 containers: all migrations apply; official transfer header B/accounts A is hidden from ADMIN A; exact retry adds no events; reparented line retains both identities/branches and hides old values from a single-branch reader; both ordinary and legacy PO→receipt cascade keep original branch scope; audit-only master history does not block unused masters while a real reference still does. All substantive findings were fixed and rechecked; no unresolved critical/important finding was reported.
- Full application suite, typecheck, scoped lint, production build and named SQL suites: see final result record below. Build retains the repository's Supabase Edge-runtime warning; test suite retains pre-existing React act() warnings.
- Browser: 40-row cursor pagination in both directions, reset/preservation of filters, deleted-object selection, redacted values, concise accessible names, failed-load feedback, denied-role feedback, no document horizontal overflow at 390px, zero page/server rendering errors. [Desktop](../evidence/2026-10-22-a01/activity-desktop-filtered.png) · [Mobile](../evidence/2026-10-22-a01/activity-mobile-object.png).

## Final verification results

| Check | Observed result |
| --- | --- |
| Full Vitest | **2,417 passed, 311 files; zero failed** |
| A01 focused UI/navigation | 16 tests passed, including concise accessible filter names |
| TypeScript | Passed (`npx tsc --noEmit`) |
| Scoped ESLint | Passed, zero errors/warnings on changed TS/TSX/MJS |
| Production build | Passed using fictional loopback Supabase configuration; existing Edge-runtime/cache warnings retained |
| Migration source chain | All 223 applied in owned PostgreSQL 16 with test auth/storage shims |
| SQL regression runner | **13 passed / 1 baseline failure**, continues across isolated suites and exits nonzero honestly |
| Actual viewer Chromium | Passed; independent reviewer rerun also passed |
| Inventory regeneration | 43 registered tables; 428 call sites, reproduced byte-for-byte by independent reviewer |
| Diff whitespace | Passed |

The 13 passing SQL suites are `activity_audit.sql`, `master_data_lifecycle.sql`, `master_item_code_history.sql`, `stock_document_corrections.sql`, `clinic_billing_lifecycle.sql`, `manual-journal-corrections.sql`, `cash-entry-corrections.sql`, `wholesale_corrections.sql`, `purchase_invoice_lifecycle.sql`, `purchase_payment_corrections.sql`, `asset_purchase_correction.sql`, `bank_reconciliation_lifecycle.sql`, and `internal_transfer_corrections.sql`.

The remaining `posted_sale_cancellations.sql` failure is `Efek retur hanya melalui jalur koreksi catatan retur resmi`: its legacy `OTHER.FIFO` loop calls `stock_out_fifo` with a protected `sales-return` source alias. **The identical failure reproduces on pristine main 6289994 with all 222 original migrations and the same original fixture preparation, without A01.** The independent reviewer reproduced it separately. This is an existing fixture/return-guard mismatch; the return guard is not loosened and the assertion is not skipped or rewritten. Earlier generic-runner missing-COA/missing-fixture failures were diagnosed as test preparation issues and resolved by the dedicated runner's existing fixture recipes, without product/permission changes. Full cancellation regression acceptance remains unproven beyond that stopping point; all SQL is not claimed green.

The [machine-readable evidence](../evidence/2026-10-22-a01/verification.json) records these separate outcomes. No true concurrent workload test was added for the capture triggers themselves; existing command idempotency is exercised through the real official transfer RPC and domain SQL regression suites, and workload/deadlock acceptance remains a staging gate.

## Migration, rollout and rollback instructions — not executed remotely

1. Review exact source/application commit, the capture table list and full open-gap list. Keep A01 incomplete until business owners accept the scope. Agree whether OWNER/ADMIN-only readers suffice; granting another role is explicitly deferred.
2. In approved isolated staging, verify the existing migration history matches this base (222 existing migrations), source columns/policies, backup/restore procedure and expected source-data volume. Run the source-chain test and authenticated real browser/API acceptance there. Benchmark insert/update latency, audit growth and filtered pagination on representative sanitized volumes; no production-size claim is made here.
3. Apply **only** `supabase/migrations/20261022070000_activity_audit.sql` to that approved staging target with error-stop and an encompassing transaction (e.g. `psql --single-transaction --set ON_ERROR_STOP=1 --file=...` using the separately approved staging connection). Do not point the test runner or these instructions at production without a later decision. New registry creation fails on unexpected existing schema instead of silently masking drift.
4. Deploy the matching application after migration verification. Capture starts when the migration enables the triggers, even if an older application is briefly still serving. Verify a new ordinary item/customer edit, official transaction correction/retry, original-scope deletion, general viewer, per-object/menu links and every role/cabang denial against real staging auth. The app reports unavailable history when the migration/query fails rather than showing a false empty log.
5. Roll back application UI by redeploying the previously approved app; keep the additive audit schema and triggers to preserve evidence if source mutations remain healthy. No historical source state needs reversal because this migration changes no financial/inventory data or journals.
6. If a verified audit-capture failure blocks business writes and database rollback is approved, pause writes, record the incident/time, back up the log, and transactionally disable ONLY `a01_activity_change` / `a01_activity_delete` on the explicit registered source tables. Keep all existing source guards, policies, journals, domain audits and `activity_log` intact. The master-reference audit exclusion can remain while retained audit data exists. Mark the resulting capture gap honestly and re-enable reviewed fixed triggers before resuming normal auditing. **Do not drop/truncate audit history or reconstruct the gap as if it had been captured.** A database owner must deliberately approve this emergency action; none was run here.

## Remaining decisions / acceptance gates

- Prioritize and implement unregistered source workflows from the inventory before declaring A01 universally complete. Add tests for each new registry entry and related nested detail/branch rules; new tables are not auto-covered.
- Decide reader role requirements without silently broadening FINANCE/STAFF/DOCTOR or Perusahaan access. Existing histories are preserved.
- Approve privacy/status field mappings and retention/archival/export policy; current app cannot edit/delete logs. Unknown status strings deliberately redact values rather than copy arbitrary text.
- Privileged maintenance/TRUNCATE, schema owners disabling triggers, and unregistered source tables are outside this application-audit guarantee. Supported application row mutations are captured; this is not a database-owner tamper detector.
- Full authenticated staging browser/API/database acceptance, source-schema/production parity, concurrent operational behavior under real workload, size/performance and recovery/UAT are pending. No production query, business mutation, migration, deploy, auth/permission change, merge or Sheet edit was performed.
