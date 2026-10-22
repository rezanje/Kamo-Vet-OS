# P06 / P09: purchase advance cap and lifecycle candidate

Base: `102f3b0555305524611296e29d16affc12553eb7` (latest fetched main). Separate branch `codex/fix-po-advance-cap-20261023`. PR86, PR87, PR89 and their branches are not changed. No target database transaction, migration, merge or production deployment.

## Verified causes and change

- Main's `guard_purchase_advance_parent` checks supplier and Draft/Dipesan status, but no cumulative cap. Isolated main accepted DP 1,000,000 against a PO total of 600,000. Source insertion and journal posting were separate; the source could survive a journal failure.
- Full Diterima/Batal PO rejection already exists in main. This candidate retains it, checks again in the atomic RPC, and blocks a received PO restored from a draft without silently detaching that PO.
- New RPC commits advance, exact whole-rupiah journal and actor/request receipt together. It sums **all active advance amounts**, including their allocated portions, against stored `purchase_orders.total`. The UI shows value, active advances and remaining cap, including complete paginated lists; the server remains authoritative.
- Native concurrency testing found that a PO row lock alone was insufficient under repeatable-read snapshots: two DP60 requests against PO100 both committed. A private per-PO row version now forces a serialization failure for stale snapshots. Read-committed requests serialize and recheck the cap.
- A three-session recovery / pending advance / PO revision race also reproduced a deadlock. Recovery now obtains the same request lock before locking the actor profile; it cannot hold that profile while waiting on creation.
- Creation originally inverted the existing PO revision lock order; a native race reproduced a deadlock. Creation/cancellation now take PO before the actor/profile lock.
- Direct client status cancellation could release cap without returning cash. Client source/status and advance-journal edits are blocked. The existing full, net-unallocated cancellation now reverses the immutable original journal and records status/receipt in one transaction. A payment that was fully corrected back to net-zero allocation remains eligible under the existing cancellation rule. No partial refund semantics were added.
- Historical `batal` status releases capacity only with a unique, branch-consistent exact original/reversal pair and zero net allocation. Missing or ambiguous evidence fails closed for that PO; no historical records are repaired or removed.
- A stable per-user draft key survives failed responses/reload. Read-only recovery waits for the same request and returns its receipt; retries cannot create a second advance. Changed payload under the same key is rejected. No timeout or incomplete RPC result acknowledges success.
- Optional-PO advances remain supported using the selected operational branch, or the explicitly selected bank's branch in all-branch context. Existing cash source, branch and role checks remain in force. Exact original cash account is used for full cancellation, rather than today's method mapping.

## Verification

- RED before implementation: actual excess accepted on isolated main; real component/action regressions failed; repeatable-read cap race, PO revision lock inversion, direct status cap bypass and missing legacy refund proof reproduced. Private debugging logs contain fictional fixtures only and remain outside Git.
- `npx vitest run src/lib/__tests__/purchase-advance-action.test.ts src/components/__tests__/purchase-advance-cap-ui.test.tsx`: **18 passed**.
- `npm test`: **312 files / 2,431 tests passed**.
- `npx tsc --noEmit`: passed.
- Scoped ESLint on changed TypeScript and browser runner: passed.
- `npm run build`: passed, 193 static pages; inherited warnings in unrelated files remain. Build used explicit fictional Supabase URL/key.
- `node scripts/test-purchase-advance-browser.mjs`: passed on Chromium at 390/1280 pixels. Real page/form with fictional source/action boundaries; exact/excess cap, failed submission/reload same identity, read-only recovery, received draft rejection, separate-account draft isolation, matching acknowledgement retirement and failed source read. No document overflow, runtime error, external request or live transaction. [Mobile](advance-390.png), [desktop](advance-1280.png), [results](browser.json). Screenshots visually inspected. This is a local component browser fixture, not an authenticated deployed application smoke test.
- `python3 scripts/test-purchase-advance-postgres.py`: final result recorded in `checks.json`. Replays the full repository migration chain into an owned PostgreSQL16 container with network `none`, fictional auth/storage shims, no published ports, no target URL/credentials. Exercises real RPCs, triggers and journals, including payment allocation/correction compatibility and independent-session races. Its transaction fixtures roll back and its owned container/volumes are removed.
- Bounded read-only review found no additional Critical/Important issue in the cap/cancellation/proof changes. Reviewer inspected source and tests, did not execute tests.

## Remaining decisions and limits

1. **Partial receipt:** existing code leaves a partially received PO `Dipesan`; this candidate preserves its eligibility. If P09 means reject after *any* receipt, that policy needs an explicit decision and a separate receipt-state rule/test. Do not mark all P09 complete.
2. **Fractional PO values:** existing purchase payment/journal logic uses whole rupiah. This candidate explicitly accepts whole-rupiah advances and does not round fractional source values silently. A fractional final PO remainder cannot be paid as an exact fractional advance; precision policy remains open. Existing fractional/mismatched legacy advance journals fail closed on cancellation.
3. **Legacy reconciliation:** missing/duplicate/mismatched original or refund journals block the affected operation. No automated historical correction. A cancelled legacy DP without refund evidence blocks new advances on its PO, even if its status alone says cancelled.
4. Existing broad read policies are unchanged. Private receipt/lock/cancellation tables have RLS enabled and client privileges revoked; new scoped RPC validation does not claim to add whole-application data confidentiality.
5. Local PostgreSQL16 replay is not proof of target Supabase migration parity, hosted API grants, backup/PITR or authenticated runtime behavior. Target project identity and authenticated DB/backup access remain unavailable.

## Rollout gate and rollback bounds

One new migration: `20261023010000_purchase_advance_cap_atomic.sql`, after the existing main chain (including purchase payment corrections and PO lifecycle migrations). It creates private request, capacity-lock and cancellation tables, protects source/advance journals, and installs atomic create/recover/cancel RPCs. No source/backfill/reclassification or permission weakening. Explicit RPC grants; internal table/helper access revoked.

Before release, establish the exact project and read-only migration/function parity, a usable backup/recovery point and the exact reviewed head. Do not blindly push missing historical migrations. Apply the reviewed migration to the confirmed dummy-development target, then deploy its matching application in a coordinated gate; the old application directly writes advances/cancellations and will fail closed once the migration is installed. No such target action was performed here.

Controlled authenticated smoke: choose an OWNER and its already-authorized active branch, a marked fictional supplier/PO600000 and bank. Record before counts/IDs. DP400000 then DP200001 must reject; DP200000 must succeed, same-key retry/recovery must return the original IDs. Reconcile source/journal/cash1303 totals; fully received PO must reject a new request. For a net-unused advance test atomic cancellation and retry, then cap release; a zero-allocation payment correction must preserve eligibility. Record every created advance, receipt and journal ID. Retain the audit trail; do not delete/reset records.

Before any target transactions, migration failure can be rolled back transactionally. After posting, do not drop receipts/tables or restore old direct-write permissions, and do not erase journal history. Pause the feature or roll forward under review. An application-only rollback to the old direct-write action fails closed; database and app versions must be coordinated. Financial cancellation uses the reviewed full-unallocated path, not arbitrary historical rewrites.
