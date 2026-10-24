# I08 partial — atomic existing recipe-production core

## Verified defects and bounded change

The old completion action added finished stock and marked the order completed before its journal call. A synthetic journal failure left those effects committed; the action regression failed before the fix. A separate real PostgreSQL regression proved `production_orders.nilai_bahan` and `production_order_items.hpp` round exact FIFO cost 0.3125 to 0.31 because both were numeric(15,2).

New start/completion actions each call one guarded PostgreSQL transaction. New financial effects require active OWNER/ADMIN, existing POS module and branch/warehouse access, valid period/quantities, eligible source/output items and reconciled material stock/layers. Start freezes recipe/material/output identity and exact cost, issues material, records WIP1302/inventory1301 journal and receipt together. Completion verifies that proof and original journal, receives the frozen output, clears WIP and records its receipt/status together. Existing table ACL/RLS are not broadened. Private receipts and source guards prevent stale mutations. Configuration recipe creation remains the existing separate path.

A distinct per-account/per-job browser posting key supports identical retry and receipt-only recovery; the local draft key is not reused as posting identity. Empty/transport/mismatched receipt responses do not imply success or retire the draft. The form reads the same frozen output name/UOM/plan used by the transaction, rather than a changed live recipe. Unsupported legacy jobs without proof are visibly held for reconciliation, never guessed/replayed. Target read-only preflight found zero legacy running jobs, but this is a point-in-time observation, not permission to repair/delete history.

## Cost representation and method boundary

Future source cost columns become unrestricted numeric; historical rounded values are not restated. For finite-decimal quantity Q, normalize trailing zeros and use quantum e=10^-scale(Q). A high-scale numeric division supplies base u=trunc(C/Q,30); output (Q-e) at u and final quantum e at (C-(Q-e)u)/e preserve exact total consumed cost C. Existing stock helper unit-cost capacity is respected; unsupported amounts reject atomically. Quantity and incoming stock-movement value are checked against Q and C before the WIP journal clears. Sub-cent cost remains visible instead of being shown as zero rupiah.

When output stock starts negative, receipt first covers its deficit; incoming movement value still equals C, but remaining positive FIFO layer value must not be claimed equal to C. No phantom layers are created. Existing FIFO historical negative-stock estimation is not rewritten.

Moving-average valuation has a distinct rounded variance contract; this FIFO production core rejects new effects in average mode rather than falsely asserting FIFO layer equality proves average reconciliation. Already-completed receipt recovery still works. A private settings trigger uses the existing inventory advisory lock to prevent irreversible average activation while proof-backed FIFO production remains running. A separate RED reproduced the stranding risk before this guard. Existing activation function and PR82 branch remain unchanged; no activation was performed on target.

## Verification

- Focused app: 27 tests / 5 files passed, including rollback response, exact decimal input, missing/transport/wrong-date responses, receipt-only recovery, key reload/account/job isolation, storage failure, frozen UI metadata, sub-cent display, existing units/recipe calculations.
- Full app: 355 files / 2,699 tests passed once at stable application code.
- TypeScript and scoped ESLint passed.
- Production build passed using fictional Supabase values; only existing unrelated image/unused-variable warnings.
- Isolated PostgreSQL17.6 with 238 repository migrations and fictional auth/storage shims: start/finish exact cost, one receipt per stage, unchanged/changed retry, selected dates, journal and audit rollback, material shortage, role/branch/period rejection, immutable sources, frozen recipe, fractional output, zero-cost output, negative output, nonfinite stock/layer rejection and fail-closed average mode passed. Exact-head preview outcome is recorded in PR.
- Real two-session checks passed for duplicate start plus uncommitted receipt visibility, activation waiting then rejecting running FIFO WIP, duplicate finish, competing jobs for the last material, and failed completion rollback before a queued retry commits once.
- Narrow independent review initially found the average/WIP stranding P2; the guard was added and re-review confirmed resolved. No other P1/P2 was reported.

No full hosted user simulation, actual target activation, source-data cleanup or target transaction was performed. Repository-schema tests are not a complete target-schema copy. Read-only target: migration history222/latest20261023091210, old cost columns numeric(15,2), new receipt table absent, running legacy production count0.

## Rollout and remaining I08 scope

Base main: `e46f45e97ae2500b3aaade5e8a9e50915f9fcca3`. Only new migration: `20261023145000_production_atomic_core.sql`; SHA256 `9d1d84121b520c4b29970aa2ddec422b776d9551261a6e8b103dc626f6845cd3`; authored/tested locally, **not applied to target**. It has no dependency on PR119 or PR104 and must not replay their migrations. Before rollout verify exact helper/schema/trigger ownership compatibility and backup/recovery evidence, then apply the explicit reviewed migration transactionally before the application. The only production-page overlap with PR113 is the page file; catalog loaders are unchanged here, while request/source display is added. Integration must preserve both candidates.

Keep receipts and exact cost history when rolling back; the old multi-request app path is unsafe and can be blocked by source guards. Prefer disabling production posting/fixing forward, not deleting receipts, narrowing costs to cents, or replaying legacy jobs. Main/deployment remains blocked by the prior PR103 automatic-review denial; it was not retried or bypassed.

**I08 is still partial:** this candidate does not add ad-hoc jobs without a master recipe, per-material source warehouses, separate output warehouse/expense context, or their cross-branch valuation contract. Existing history listing limits also remain outside this financial core. No full-I08 checkbox is justified by this prerequisite alone.
