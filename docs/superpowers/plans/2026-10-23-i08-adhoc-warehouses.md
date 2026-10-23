# I08 ad hoc warehouse jobs implementation plan

Goal: start a one-off material-to-output job without creating a master recipe, choosing source warehouse per material and a separate output warehouse within one authorized branch.

Architecture: extend the unmerged PR123 candidate with one additional migration and a separate atomic ad-hoc start RPC; retain its existing guarded finish, receipt recovery, source fences and exact FIFO/WIP reconciliation. Recipe production remains supported. Standard existing OWNER/ADMIN and branch/module checks apply to every warehouse. No target writes or main retry.

Ruling: same-branch multi-warehouse jobs are independent work; no policy question blocks them. Reject source/output/context branches that differ until an interbranch ledger/allocation policy is supplied. No extra labour/expense allocation is invented; transfer only actual consumed material cost. UI states this boundary.

- [x] SQL RED: missing ad hoc RPC, then exact cost/warehouse/unit/retry cases. Journal/audit rollback and legacy-proof compatibility covered.
- [x] Minimal SQL: nullable recipe FK plus explicit output/source warehouse FKs, canonical payload, unit factors, sorted stock locks, existing FIFO/helpers and private proof. Finish reuses frozen output and exact WIP checks.
- [x] Action/component RED/GREEN: exact quantities/warehouses, separate durable ad hoc scope, account-scoped draft restore, explicit branch reset and searchable items without permanent recipe writes.
- [x] Form/page plus frozen material identity in running and completed history. PR113 production reference pagination carried forward; other clinical files untouched.
- [x] 20 focused tests, 356files/2705 full app tests, typecheck/lint/build, isolated239 migrations, SQL core/ad hoc and six race checks passed. Reviewer history P2 fixed/rechecked. Normal PR123 update; no target or main mutation.

Remaining I08: cross-branch expense context, average-mode valuation contract and any non-material expense input need an explicit policy; do not call the whole row complete from same-branch support.
