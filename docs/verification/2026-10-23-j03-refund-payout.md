# J03 — selected retail refund payout (partial feedback)

Base: main `61376d7736dc1669925f4214f1a978e30a053750` (PR127). N01 document-resolution work is on its separate preserved branch and is not included.

## Problem and resulting behavior

The previous retail form described a cash refund, while SQL reversed the original payment accounts and recorded original-method expenses. This candidate separates immutable original payment allocation from the actual payout. The user explicitly selects cash or transfer.

Cash requires the existing authorized actor, branch, active petshop shift and active mapped cash account. It posts return quantities, source HPP, actual cash payout, balanced journals and customer spending in one transaction. Transfer first creates a pending request with no return, stock, expense or journal. An authorized finance actor claims the source reservation, performs the transfer outside KAMO, then explicitly records its date, source bank and reference. KAMO does not initiate a bank transfer. Completion posts all financial and stock effects once; failed posting rolls back while retaining the processing reservation. Cancellation requires an explicit unpaid confirmation and a reason; it preserves history.

The original source payment allocation continues to cap aggregate refunds. Fee, VAT and discount reversals use original journal snapshots and cumulative cent allocation. Good stock returns restore physical quantity and source HPP; damaged stock uses the existing loss treatment and does not restock. Retrying a committed request returns the same receipt. Recovery is receipt-only, including when the original source has no quantity left. Unknown responses never indicate payment success or advise repeating the transfer. Selected payouts cannot enter the incompatible legacy correction path; an unconfirmed payout lookup also blocks that path.

Private request/payout tables have RLS enabled and no direct application-role grants. Definer entry points retain existing active account, module, branch, period and role checks. The finance queue filters source access before pagination. Global audit captures metadata only; bank destination and private snapshots are not added to its global index. Existing legacy return paths remain available with existing behavior; this candidate does not retroactively repair their historical payouts.

## Deliberate limits

J03 is **partial**, not a completed global checkbox. New selected payouts reject a source with earned, redeemed or recorded loyalty points before writes. No point reversal formula is invented. A point-free source may share a customer with other loyalty transactions and leaves those points unchanged.

Clinical work here is a read-only validated source preview, not a clinical refund UI/posting workflow. It checks original financial/payment/stock/HPP evidence and does not expose medical data, source cost or private snapshots in its DTO. Unsupported corrected/reissued, compound/freeform stock identities or demo administrative/incentive snapshots fail closed. Historic grouped clinic loyalty references do not identify individual invoice allocation; current rates cannot reconstruct that source evidence. The remaining decisions are the partial/full source point reversal rule, and clinical treatment of administrative fees, paid incentives and consumed compound ingredients. Full hosted user simulation remains deferred.

Source-status recovery is bounded to fewer than100 recent source requests and fails closed at that boundary. The finance queue has explicit100-row pages with active filters. No unlimited source-history claim is made.

## Verification

All data are fictional and all SQL writes run in an owned, network-isolated PostgreSQL17.6 container with fictional auth/storage shims. The runner replays246 repository migrations, not an asserted physical clone of target schema.

- RED/GREEN coverage: actual cash vs original bank; pending transfer zero financial writes; receipt recovery and canceled requests; selected-payout detail and failed reads; cross-account/branch denial; source points rejection; original clinical HPP proof; fully-returned source recovery; eligible-branch finance pagination.
- SQL: cash/transfer partial/full, same-receipt retry, source allocation and customer-spending reconciliation; source reservation vs conflicting legacy/new return; two-session request/claim/completion races; late journal failure rollback followed by one successful queued retry. Physical stock fixture sells2units at total HPP251, good cash return restores1unit, damaged transfer restoresnone, ending FIFO9units/value1129.50 and balanced HPP reversal251.
- Full app run:3128 passed and2 obsolete action-mock failures. Those mocks were corrected; all6 tests in the affected file then passed. The final48 focused tests in9files passed, including the corrected mock and both fully-returned page payloads. Do not describe the earlier aggregate run as entirely green.
- Production build passed; post-build typecheck and scoped ESLint passed before the final narrow review corrections. After both review corrections, affected typecheck and scoped ESLint passed. Narrow review found both P2 issues fixed and no new blocker. Production CI must still verify the final published head.

## Rollout and rollback

Only new migration: `20261023193000_sales_refund_payout.sql`. It depends on PR127's already-applied `20261023182000_customer_return_spending.sql` helper and patches exact known return-core insertion points, aborting on drift. At preparation time target history is230; this new migration is **not applied**. Do not replay any prior migrations. Before release compare exact candidate/head and target function/ACL provenance, take current backup/schema evidence, then apply only this migration transactionally with error-stop before deploying its application.

Keep existing owner/ACL/RLS and historical data intact. After new requests/payouts exist, rollback cannot discard proof tables or financial history. Prefer a forward fix; application rollback must preserve reservation enforcement and avoid the old unreserved posting path while requests are processing. No blanket database downgrade, reset or physical restore is part of this candidate. Actual target physical backup restore and authenticated hosted UAT have not been tested.
