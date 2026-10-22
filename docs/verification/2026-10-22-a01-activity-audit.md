# A01 activity audit — implementation and release evidence

## State and acceptance boundary

Meeting 22 October 2026, 61:00–65:58 requires general cross-module activity and per-transaction/menu history: actor, time, object, create/update/delete and relevant changes, including deleted objects. Original base was main `6289994422ce32e795f6f27baba04b5db477210d` (PR81); latest main `102f3b0555305524611296e29d16affc12553eb7` was subsequently merged without conflict, preserving released PR84/PR85 and consent repair fixes, isolated branch `codex/a01-activity-audit-20261022`, [draft PR83](https://github.com/rezanje/Kamo-Vet-OS/pull/83). PR82 average and subsequent SO feedback are excluded. The parent manages the Google Sheet; this task does not edit it.

The implementation now explicitly registers **179 source tables across 12 modules**, covering the business source tables found in the baseline schema and application mutation inventory. The initial 43-table implementation was insufficient for A01; it is not the final scope. The other 47 of the 226 public tables are the audit's own tables, technical idempotency/posting proofs, or existing domain audit/revision stores. Their own rows are **not** claimed indexed; the inventory names and explains every exclusion. No source business fact is substituted with a merely related journal/header event.

**Code, push, review, deployment, migration and UAT are separate gates. A01 stays unchecked until the business scope and UAT are accepted.** New actions are captured only after activation. There is no reconstruction of historical events, and existing events are never enriched from guessed live history.

| Gate | State |
| --- | --- |
| Implementation | Explicit source registry, general viewer, object/menu links and security/privacy tests prepared for review |
| Commit / push / PR | Same isolated branch and PR83; exact commit and checks recorded in final delivery |
| Independent review | Findings fixed; final verification recorded below |
| Local migration | All 228 migrations applied only to disposable PostgreSQL 16 |
| Staging / production deployment | Not performed |
| Staging / production migration | Not applied |
| Full Supabase production parity / business UAT | Pending |
| A01 checklist | Incomplete pending accepted evidence and UAT |

## Behavior and guarantees

The source-row trigger appends an immutable, minimized event in the **same database transaction** as each source mutation. Audit failure rolls back that mutation. Existing correction audits, request-key idempotency, journal posting and source guards remain in place. Multiple changed document/detail/journal rows produce distinct source events, not duplicate accounting postings. Same-value saves produce no update; an actual no-op RPC retry adds no events. Existing legacy multi-request workflows do not become cross-request atomic merely by adding row triggers.

`/perusahaan/log-aktifitas` shows actor snapshot/ID, WIB timestamp with seconds, module, root object and actual source-row identities, action and approved changes. Filters include module, associated object/source, action, code, WIB dates and stable ID cursor pagination (40 events/page). Stored object associations retain old and new parents when reparented and recursively retain ancestry on deletion/cascade. The viewer uses indexed JSON object references; it never requires a live source object to show deleted history. Boolean, bigint, natural and composite source keys are supported without truncating them into a different identity.

The generated lookup columns for existing events use **only identities already stored on those events**. Associations from before this upgrade are not invented from live records. Per-object links exist on transaction/detail menus and relevant payment/receipt/advance/return rows; the general viewer can independently trace every registered source identity. Existing detailed clinic and accounting correction history remains available at its original location.

## Authorization and privacy

- Readers remain **active OWNER/ADMIN**, subject to existing source-module, branch, selected-branch and role capabilities; navigation retains existing Perusahaan route access. Source-specific role/own-row restrictions further reduce access. Private proof sources with no authenticated source SELECT are captured with an empty reader set. OWNER-only source restrictions stay OWNER-only. No existing authentication, permission, source grant or RLS rule is broadened.
- Captured and current registry reader roles must both allow a read. Before/after branch moves require every original/resulting branch, including multiple account/warehouse references. Scoped ADMIN cannot see a cross-branch reparent event. Unknown/unresolvable scope requires all-branch access or fails closed; unknown dynamic modules are explicitly denied even to unrestricted OWNER/ADMIN. Missing-parent lookup never silently becomes a globally readable object.
- Dynamic cashier shifts preserve both old/new module requirements. Attachments resolve only known existing application module/table pairs (or actual tombstones); ambiguous parents require all matching scopes. Unknown attachment modules are hidden. Filenames, paths and file contents are never copied.
- Actor derives from the verified session subject and profile, never supplied `created_by`, `uploaded_by`, business actor or context payload. A privileged session without a subject is honestly labeled system/database; attribution does not invent a human.
- Registered safe fields use numeric/boolean/null, typed dates, approved statuses and explicit business document/code exceptions. Free-form strings, arbitrary status values, secrets, contact/bank/tax details, request hashes, JSON payloads and raw clinical records are excluded. Operators must not put confidential prose in document-number/code fields.
- **HRIS, access/company/settings/tax, clinical narratives and other sensitive sources use minimum metadata:** identity, action, actor, time, scope/associations and a constant `metadata` change descriptor. Before/after payloads are empty; even sensitive column names are not retained. Detailed payloads remain governed by their original source/history permissions. This is deliberate data minimization, not a claim of full medical/payroll before/after capture.
- Application INSERT/UPDATE/DELETE/TRUNCATE of the audit is denied; private helpers cannot be called by application roles. Schema-owner tampering/trigger disabling is outside the application immutability guarantee. Source deletion does not cascade into the log. Permanent deletion remains governed by existing source guards, e.g. employee deletion is still denied.
- Both audit tables are excluded from generic master-reference scanning, so an unused item's own audit/code/module configuration does not freeze a legitimate rename/trash. Real business references still block existing operations.

## Real source coverage

The [per-module/source coverage matrix](../evidence/2026-10-22-a01/source-coverage.md) lists every source and exclusion. The [machine-readable mutation inventory](../evidence/2026-10-22-a01/mutation-inventory.json) is the source-by-source contract, with registry settings, source files, direct writes/RPC calls and explicit exclusions. Trigger coverage applies to committed INSERT/UPDATE/DELETE from server actions, permitted direct API mutations and RPCs; it does not depend on every caller being rewritten.

| Module | Actual registered source coverage |
| --- | --- |
| Persediaan / POS | SKU/brand/unit/category, item units/prices/groups/variants, sales/items/payments/refunds/returns, stock/request/receipt/transfer/adjustment headers and children, move/layer/proofs, opname orders/counts/results, recipes/production headers and children, shifts/drafts, quests/points/rewards, cost settings/events/month values. Private technical proofs stay unreadable. Shift module follows actual clinic/petshop type. |
| CRM | Customers, pets/ownership transfers, categories/review statuses, promos/vouchers/discounts/composite promo items and points ledger. Personal values are redacted/minimized. |
| Penjualan | Quotations/orders/deliveries/invoices and all item rows, receipts, advances, delivery allocations, commissions and targets. A receipt/advance row is its own source event. |
| Pembelian | Suppliers/categories, orders/receipts/invoices and items, invoice payments, advances, payment orders/items, PO payments, returns/items and layer proofs. Private layer proofs stay unreadable. |
| Klinik | Visits, invoices/items/payments, compound sale snapshot/request result, medical/prescription/inpatient/log/medication/dose sources, compound recipe/ingredients/formula versions/issue/usage, demo metadata, bookings/capacity, consents/templates/rules, follow-ups, equipment/maintenance, referrals and operational event envelopes. No raw clinical narrative or signature contents. |
| Kas & Bank | Cash entries/transfers/reconciliations/expenses, accounts and payment mappings. Mapping's own branch remains required even when account is global. |
| Buku Besar | Journals **and lines**, COA, budgets/transfers, recurring journals and locks. Journals supplement rather than replace document events. |
| Aset Tetap | Assets, depreciation, changes, disposals, transfers and categories. |
| HRIS | Employees and branch assignments/import details, attendance/schedules, leave/overtime, payroll/salary components, reimbursement, advances/installments, KPI and shifts: metadata only. |
| Pengaturan | Payroll/company/access profiles/branch/role/module capability metadata, approvals/numbering, WA/tier/alerts, notifications, WA send log, import batches/rows and initial scope mappings. Source settings are audited, never changed by this feature. |
| Perusahaan | Branches/warehouses, month-end runs and polymorphic attachments (actual module/parent association used). Metadata only. |
| Pajak | Tax asset categories metadata; no raw tax/personal payload. |
| Laporan | Underlying registered business mutations are captured. Read/view/export telemetry and retention/export features are outside A01 create/update/delete scope and are not added. |

Technical request/proof/revision exclusions remain explicit. Existing domain audit tables are not recursively audited into a duplicate log, and immutable posting proofs retain their original guards. Static discovery resolves literal table calls, not arbitrary generated SQL; trigger/PK/permission contracts and official RPC regressions supply complementary evidence. Adding a future source table requires an explicit registry/privacy/scope decision and tests; there is no unsafe automatic all-table payload capture.

## Verification and reproduction

Read AGENTS.md, CLAUDE.md, engineering/release guidance and existing source policies/guards. Installed Next15.5.25 lacks `node_modules/next/dist/docs/`; existing patterns, installed types and production build were used.

```sh
npm test -- --reporter=dot
npx tsc --noEmit
# Scoped eslint on changed TS/TSX/MJS files
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fictional-a01-build npm run build
python3 scripts/test-activity-audit-postgres.py --schema-output docs/evidence/2026-10-22-a01/schema-snapshot.json
python3 scripts/test-activity-audit-baseline.py --ref 102f3b0555305524611296e29d16affc12553eb7
node scripts/test-activity-audit-browser.mjs
node scripts/inventory-activity-mutations.mjs
git diff --check
```

The SQL runner owns/removes fresh network-none PostgreSQL16 containers, publishes no ports and accepts no remote database URL. It applies all228 migrations with fictional auth/storage shims, existing COA prerequisites and original native per-suite fixture recipes, then uses isolated database clones. This is not production schema parity or a full GoTrue/PostgREST reset. Browser tests use the actual server page and Chromium on loopback, with a fictional query boundary; they do not represent real authenticated API/database integration.

Tests cover immutable audit grants/guards, actor spoofing, active/role/module/branch/selected-branch denial, current vs captured permissions, composite/natural/large IDs, all source PK/trigger contracts, safe/redacted and metadata-only snapshots, parent/cascade/reparent and retained deletion, official command retries, injected audit-failure rollback, filter/pagination/source history and existing correction regressions. Representative business-family fixtures exercise actual guarded source operations; a registry/trigger contract check is not falsely described as a CUD fixture for every one of179 tables.

Expanded framework/UI tests were first observed failing against the old implementation. Independent review found and fixed payment mapping's missing own-branch requirement and permissive handling of an unknown dynamic module; denial tests cover the fixes. The original main baseline previously passed2401 tests/308 files. Final merged-main application verification passed2458 tests/315 files; typecheck, scoped lint and the actual-page browser check passed. Final SQL:18 passing suites and the one documented cancellation baseline failure; all six A01 suites pass.

Final command outcomes, exact counts and additional native regression runs are recorded in [verification.json](../evidence/2026-10-22-a01/verification.json) and the PR. Browser evidence: [desktop](../evidence/2026-10-22-a01/activity-desktop-filtered.png), [mobile](../evidence/2026-10-22-a01/activity-mobile-object.png).

The overnight rerun first exposed two **fixture clock mismatches**, not product failures: fixtures used UTC `current_date`, while purchase/asset guards use the Jakarta business date. Between17:00–23:59UTC, `current_date+1` can still mean today in Jakarta. Both exact failures were reproduced on pristine latest main222; both suites passed there when fixture sessions used `SET TIME ZONE 'Asia/Jakarta'`. The A01 runner now uses that explicit session clock for fictional fixtures; no production configuration, guard, expected assertion or date validation was loosened. [Initial UTC run](../evidence/2026-10-22-a01/sql-initial-utc.log), [baseline reproduction](../evidence/2026-10-22-a01/sql-baseline.log), [final SQL](../evidence/2026-10-22-a01/sql-final.log).

**Known baseline failure remains:** `posted_sale_cancellations.sql` reaches its legacy `OTHER.FIFO` call to `stock_out_fifo` with protected `sales-return` alias and fails `Efek retur hanya melalui jalur koreksi catatan retur resmi`. The identical failure was independently reproduced on pristine both original main6289994 and latest main102f3b0 with222 original migrations and native prerequisites, without A01. No guard/assertion is weakened or skipped. The runner reports nonzero honestly; cancellation regression beyond that stopping point remains unproven. An extra pre-integration native regression run passed inpatient consent and compound/SKU binding; `clinical_occupation_selection.sql` failed an existing direct employee-status update guard. That exact failure was reproduced again on pristine latest main222; the product lifecycle guard was retained. The current run does not falsely count the occupation fixture green. Earlier moving-average SQL regression passed; no PR82 code was imported and its concurrency runner was not run.

Existing React act()/Supabase Edge-runtime and repository-wide build lint warnings are retained and identified separately from failures.

## Migration, deployment and rollback — instructions only

1. Review PR83 exact HEAD, registry/exclusions, source permission/privacy mapping and tests. Verify approved staging's schema/migration history against the222-migration base and take an approved backup. No deployment target is assumed from access to a cloud development workspace.
2. On an explicitly approved isolated staging target, apply the six additive migrations **in order**: `20261022070000_activity_audit.sql`, `20261022080000_activity_audit_framework.sql`, `20261022081000_activity_audit_financial.sql`, `20261022082000_activity_audit_inventory.sql`, `20261022083000_activity_audit_people_settings.sql`, `20261022084000_activity_audit_remaining_modules.sql`. Use migration tooling/error-stop and an encompassing transaction for the ordered batch (e.g. `psql --single-transaction --set ON_ERROR_STOP=1` with six ordered `--file` arguments). Never run the disposable fixture runner against a remote database.
3. Verify all registered capture triggers, role/source grants, immutable log guards and real authenticated reads/denials before deploying the matching application. Migration capture starts upon commit, including while an older app remains active. Old-app UI compatibility does not create old historical events.
4. Run business UAT: ordinary SKU/customer edit; receipt/payment/advance/return, journal-line/asset-child and clinical invoice payment actions; HRIS/settings metadata; actual RPC retry; nested deletion/reparent; source transaction/menu links; general log including deleted objects; revoked permission, scoped/selected branch and reader denials. Confirm sensitive payloads stay absent. Compare existing correction histories/journals, measure source-write latency, audit growth, pagination and concurrent workloads on representative sanitized volume. No production-scale/performance claim is made from local fixtures.
5. After a separate production release decision, repeat backup, migration, deployment and verification on that approved target. This task does not perform that decision or any production mutation.
6. Application rollback: redeploy the approved previous UI while retaining the additive audit schema/triggers if capture is healthy. Existing finance/inventory/source state requires no reversal. Do not revert migration by dropping logs.
7. Emergency database mitigation requires a separate decision: pause writes, record time/incident, back up retained events, transactionally disable only `a01_activity_change`/`a01_activity_delete` on the explicitly registered source tables (`activity_log_sources`, reviewed against migrations). Keep all existing source guards, auth/policies, journals/domain audits and audit data intact. Audit-table master-reference exclusion may stay. Mark the resulting capture gap honestly; never recreate it as recorded history. Re-enable fixed reviewed capture before normal auditing resumes. No disable/drop/truncate action was executed here.

## Remaining gates and decisions

- Parent/business review of source matrix and minimum-metadata privacy choices, then real authenticated staging UAT and schema parity.
- Representative-volume latency/growth/concurrency/recovery validation; local trigger tests do not prove production workload behavior.
- General reader roles remain OWNER/ADMIN. Expanding reader rights, retention/archival/export or collecting more sensitive before/after data requires a later explicit decision. None is silently enabled.
- This candidate is ready for code review, **not production release approval**. Authenticated shared-database/UAT, workload validation and baseline regression disposition remain parent-coordinated release gates. The known cancellation baseline failure requires separate resolution before claiming that entire regression green.
- No merge, staging/production migration, deployment, production data/auth/permission mutation, new SO feedback, PR82 work or Sheet edit was performed.
