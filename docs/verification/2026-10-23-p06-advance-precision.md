# P06 — exact two-decimal purchase advances

Base main: `e46f45e97ae2500b3aaade5e8a9e50915f9fcca3`. Scope is the remaining P06 precision defect. Existing DP cap, received-PO rejection, request identity, authorization and immutable source proof stay in place. P09 partial-receipt eligibility is unchanged.

## Evidence and change

The DP column is `numeric(15,2)` and the journal writer preserves decimals, but the form floored the remaining cap and the action/RPC rejected nonintegers. Further real SQL regression exposed integer assumptions in advance cancellation, refund proof, invoice allocation and allocation reversal.

The form/action/RPC now accept exact positive values with at most two decimals, reject sub-cent values without rounding, and show the exact available cent cap. One atomic DO statement checks known function anchors before patching five function definitions. Existing function owners, ACL, security-definer/search-path settings and accounting/source checks are preserved.

Invoice payment totals retain the existing whole-rupiah validation. A fractional DP can fund an exact portion: payment 1 uses DP 0.30 plus cash 0.70, with no rounded allocation. This does not introduce new refund, PO revision or partial-receipt policies.

## Verification

- RED: six real UI/action regressions failed against main. Real PostgreSQL first rejected fractional creation, then exposed fractional cancellation and invoice allocation failures.
- GREEN: 25 UI/action cases. Full application suite: 352 files / 2,692 tests. Typecheck, scoped ESLint and Next production build passed; existing unrelated warnings remain. No application source changed after these checks.
- Isolated PostgreSQL 17.6: 238 repository migrations; existing advance acceptance plus exact-cent cap, one-cent excess rejection, retained receipt, exact journal values, cancellation/released capacity, real receipt/invoice creation, 0.30/0.70 allocation, retry and allocation reversal all passed.
- Two-session races: cumulative cap at READ COMMITTED and REPEATABLE READ, identical request, PO revision, cancellation and result recovery passed.
- Independent bounded review identified the downstream assumptions above; final review found no remaining important blocker.
- All fixtures are fictional. No customer workbook or business transactions were used. Hosted workflow simulations are deferred at the user's request.

## Rollout and rollback

Preflight target: `koaglxcyjqfmgfzxszkj`, 222 migration records, latest `20261023091210`. All five targeted function definitions match the previously verified J04 target snapshot. This proves the relevant function baseline, not complete parity of all historical local/target migrations.

Apply only `20261023121500_purchase_advance_cent_precision.sql`; verify its recorded version and the five function owners/ACL/config/definitions afterwards. This migration performs no business data writes and no permission changes. Production application rollout follows required checks and normal main merge.

Application rollback can leave the compatible database precision fix installed. Do not restore the old integer-only database functions after cent advances have been accepted: that would strand their allocation/cancellation. Prefer a reviewed forward fix; never delete financial records to undo the release.
