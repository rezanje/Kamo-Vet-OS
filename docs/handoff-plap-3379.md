# Approved promo Excel + per-program reports: local checkpoint

## Scope / integration

- Branch: `hermes/plap-3379-resume`; resumed candidate `652da0f6116f27c977bd4698db0f3c8b421d87d9`.
- Normal merge of the supplied newer main snapshot `0a9b0323adbccbec92f2711c9941b14bfee97423`, integration commit `42c89ae1`.
- The local `main` ref is older than that supplied snapshot, not a newer integration target. No fetch was used.
- Payment-action conflict retains BOTH promo attribution and main's DP override reason / atomic DP-admission dispatch. Existing cashiers, clinical UI, inpatient payments and separate shared-UI work were not redesigned.
- All migrations already present on the supplied main stay byte-identical. The previously unapplied promo candidate is renumbered to `20261104150000_promo_atribusi_klinik_dan_impor_daftar.sql`; it remains UNAPPLIED.

## Fixes in this resumption

1. Same-name preview now rejects ambiguous existing master names rather than selecting an arbitrary record for its diff.
2. Preview rejects existing `package_total` / unsupported discount modes, matching the import RPC instead of offering a save that the database rejects.
3. Reject oversized Excel uploads before `arrayBuffer()` allocation, using the parser's shared 1,000,000-byte limit.
4. Forward SQL candidate normalizes JSON `null` branch IDs before array expansion: the application's all-branches payload previously attempted to expand a scalar. Verified only as a SQL text contract; no PostgreSQL execution in this task.
5. Added rendered workspace tests for the template link, red invalid rows and disabled save, same-name before/after diff and one save, and invalidating the previous preview when selecting another file. Access tests use actual STAFF / DOCTOR / FINANCE roles, all denied master write.

## Existing engine reconciliation

Item-specific clinic promotions already use `loadPromoAktif`, `promo_items`, and the shared service-line pricing engine on main. This candidate adds import and attribution/reporting, not a second eligibility engine. Expiry-on-access already exists on main; its unchanged tests were rerun, without adding expiry SQL or claiming a cron.

## Verification

- RED: two new preview cases failed with `valid: true` before the fixes.
- RED: oversized-file test observed `arrayBuffer()` called before rejection.
- RED: all-branches SQL text-contract test failed before `nullif(..., 'null'::jsonb)`.
- Final bounded targeted Vitest: **211 passed, 0 failed, 0 skipped in 17 files**. Includes clinic payment action (48), clinic promo posting (3), attribution (7), report page (8), import parsing/review (26), import actions (11), rendered import workspace (3), expiry regressions, service-line pricing and group billing.
- `NODE_OPTIONS=--max-old-space-size=1024`; Vitest `--pool=forks --maxWorkers=1`.
- Changed-file ESLint and `git diff --check` are separate local gates. Exact final results are in `/opt/data/kamo-plap-3379-results.json`.
- Raw RED/final logs and machine-readable final Vitest output are under `/opt/data/kamo-plap-3379-*`.

## Release blockers / limits

This is a usable local source/UI/helper checkpoint, **not a release-ready or deployed feature**. Migration 0415 changes clinic posting/correction/reissue attribution and creates a privileged import RPC; this is **DB-dependent, not UI-only**.

Next gate: when the single native database slot is available, compile 0415 AFTER the complete supplied-main chain (and coordinate the discount worker's trusted-allocation changes), then run real public-RPC role/branch, all-branches import, same-name update, rollback/atomicity, reissue and money/stock regression tests. Text assertions and mocked server actions do not prove database behavior or deployment compatibility.

Known retained limitations: historical clinic attribution is unknown, not backfilled; petshop voucher value is an explicitly labelled upper bound because voucher and manual discount remain combined; report detail/export is the displayed filtered set (400-row detail cap), not an unbounded ledger export. No claim of full per-program exactness for those historical/combined values.

Not run: full tsc/build/full Vitest, native PostgreSQL, hosted reads/writes or preflight, migration application, network, push, CI, deployment, authenticated browser UAT. Existing edit-transaksi and bundling candidates were inspected read-only only; their exact findings and executable next steps are recorded in `/opt/data/kamo-backlog-3379-ready.json` and `/opt/data/kamo-pr-plap-3379.md`.
