# P05 — correct PO prices after an advance

Base main: `61376d7736dc1669925f4214f1a978e30a053750`. This candidate is independent of the blocked PR128 retail refund and N01 publication. It does not contain their source changes or repeat their migrations.

## Verified gap and behavior

Full PO edit/cancel correctly reject any dependent document, including DP. That left a pre-receipt PO with DP unable to accept a supplier price change. Removing that guard would also permit supplier/quantity/unit replacement underneath DP and receipt history.

A separate OWNER-only price correction now appears on a DP-only Draft/Dipesan PO. The user sees original total, active DP, proposed total and unchanged source quantities/units. The request contains exact existing source line IDs and prices only, plus expected revision, reason and a durable key. No item is deleted/reinserted. The RPC updates prices, PO total/revision, before/after audit and one receipt atomically; it does not modify DP, stock, liability or payment journals. Existing whole-PO correction guards remain unchanged.

New total must be finite, positive, exactly two-decimal and at least active DP. Existing per-unit price bound is retained; no new aggregate PO ceiling or rounding rule is introduced. Multiple fractional DPs use Decimal in the preview (`0.10 + 0.20 = 0.30`). A canceled DP needs the existing proven-refund check; consumed/unreconciled DP fails closed. There is no automatic DP refund or reallocation.

Any received/damaged quantity, receipt, invoice (including preserved canceled history), legacy payment, return or explicit receipt closure rejects direct price correction. Existing received/invoiced correction routes remain. Active OWNER, module, branch, active warehouse and closed-period checks are enforced server-side. Same-key retries return the stored receipt before checking stale revision; changed payload or stale new requests reject. Unknown responses never acknowledge the draft.

## Evidence

- RED: actual dummy DP plus old full-edit rejection; new price-only RPC absent. UI lacked the price-only entry point; action export absent. No guards were relaxed to turn these tests green.
- Real isolated PostgreSQL17.6 replayed246 repository migrations on fictional auth/storage. Positive paths preserve source identities and all parent metadata except total/revision, exact cap allowed, and DP/journal/stock snapshots unchanged. Invalid/missing/duplicate/foreign/extra-field inputs, non-cent/nonfinite money, stale revisions, changed retries, non-owner/branch/closed-period, invoice/receipt and unproven canceled DP reject; an injected audit failure leaves no partial price or receipt.
- Real DP0.10 +0.20 permits new total0.30. Review caught the corresponding JavaScript summation error; a failing page regression now passes using Decimal.
- Two-session tests: DP-first and price-first ordering at Read Committed and Repeatable Read, concurrent identical retry with one audit, and a real partial goods receipt blocking queued price correction. The existing PO lock plus advance-capacity epoch prevents a stale RR aggregate from breaching DP capacity.
- Focused components/actions:18 tests passed, including blank/zero editing, cents, exact cap, source payload, draft reload and unknown response. Baseline7 tests passed before changes. Final full app verification3114 tests in419 files passed; exact-head CI is recorded with the PR. Typecheck initially reported stale generated `.next/types` referencing the other preserved branch's refund route; rebuilding generated types resolved it. Production build passed with existing unrelated warnings; scoped ESLint and post-build typecheck passed again after review fixes.
- Independent narrow review: fractional-DP issue fixed/re-reviewed; no remaining P1/P2 found. Full hosted user simulation and authenticated browser UAT remain deferred.

## Release bounds

Only new migration: `20261023200000_po_price_after_advance.sql`; authored/tested locally, **not applied to target**. It adds one RPC using existing purchase request/revision and DP-capacity storage. No existing function, ACL, RLS or security setting is changed. It depends on main's lifecycle/cap/cent-precision helpers, independently of PR128. Apply only this reviewed migration before deploying its UI after release is unblocked; do not blanket replay history or reapply PR128's already-committed migration193000.

Rollback may hide the new form/RPC while preserving recorded price revisions and existing DP. Never reset PO prices or delete audit/request/payment history to roll back. This closes the specific DP-only price gap; it does not define arbitrary posted PO quantity/unit rewrites, supplier changes after payment, automatic refunds, or all P08/J01/J02 workflows. Checklist status remains separate from main/deployment and postponed simulation.
