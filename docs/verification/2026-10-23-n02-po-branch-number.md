# N02 — branch identity on new PO numbers

Initial base main57e5e6a; isolated codex/n02-po-branch-number-20261023. Original report verified: atomic creator used one date/config prefix across all branches. RED SQL returned N02.0001/0002/0003 across two branches, and actual settings page lacked branch-aware help/example.

## Behavior

New numbers append the authoritative destination branch code after the existing configured/date prefix and before the sequence, e.g. PO-20261023-CONTOH-0001. CONTOH in settings is explicitly illustrative. Prefix/date/digit settings remain usable; other document formats and historical numbers stay unchanged. This punctuation/placement is an implementation choice under autonomous authorization.

The existing atomic creator validates branch/warehouse/access, returns exact replay receipts, then reads the active branch code FOR SHARE. Code edits serialize with creation; retries after code edits retain the original number. Per-prefix advisory numbering lock, max-existing sequence, overflow/unique retry, items/valuation, period checks, actor and branch checks remain intact. Blank/unsafe codes and expanded numbers over30 characters fail clearly without source/request writes; no truncation, master rename or inferred code. A code edit starts/reuses a series for new requests; historical branch identity remains the stored FK rather than reverse parsing a mutable code.

One guarded migration20261023063921_po_branch_numbering.sql patches only two exact creator-body anchors. It stops on unknown baseline, preserves function signature/owner/ACL and does not touch settings, roles, policies, tables, existing PO numbers, receipts or journals. No new application permission or client-trusted branch code.

## Verification and limits

- SQL RED then GREEN on owned network-none PostgreSQL17.6/235 local migrations. New acceptance covers branch-specific sequences, same-key replay after prefix/code change, historical number retention, blank/overlong input, warehouse/branch denial and audit failure rollback. A deterministic independent-session branch-edit/create test confirms lock waiting and one PO with the committed authoritative code. Containers/volumes removed.
- Focused real settings page/unchanged formatter:12 tests. Full app341files/2607tests, typecheck, scoped lint and production build pass; existing unrelated build warnings remain. Fixture endpoint/key only for build, configured privileged credentials removed.
- Existing purchase_order_lifecycle.sql fails identically before and after N02 at authenticated SELECT on private purchase_order_requests. Comparison bootstrapped main234 migrations then applied only N02 in the same disposable baseline. No grant weakened or unrelated test rewritten. Later checks in that suite remain unverified; this is not a claim that native legacy suite passed.
- One independent Sol6.1 high review: no P1/P2. Deferred minor: rejection of nonblank unsafe codes has no direct SQL assertion; blank-code path is covered.
- No real-browser/target business transaction or full UAT claimed. Settings page test uses actual SSR. Target migration/main/deployment are separately recorded by release executor.

## Release and rollback

Check current main/exact-head CI, target creator drift/ACL and current backup metadata. Validate actual active-branch code/expanded-format lengths read-only. Apply only this reviewed migration in one error-stop transaction; do not replay history. Verify existing catalog objects/roles unchanged except the intended creator definition and exact ACL retained. Roll application forward/prefer retained numbering logic if needed; do not rename any issued PO or delete request/audit receipts. A future reversal of the creator definition requires separate verified source review. Physical target restore remains untested; app rollback alone does not revert server numbering.

[Checks and sanitized logs](../evidence/2026-10-23-n02/checks.json). Design and execution plan are under docs/superpowers; private continuity ledger retained. Full70 feedback completion, fractional DP policy and clinical scope are not implied by this batch.
