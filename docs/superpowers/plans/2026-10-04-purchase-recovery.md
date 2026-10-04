# Purchase Recovery Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Parent agent owns final independent review.

**Goal:** Atomic receipts and recoverable PO invoice / asset purchases.
**Architecture:** A private transaction-result ledger records canonical business payloads with actor and request key. Authorized RPCs serialize a key, recover matching results, and perform all database writes in one transaction. Existing invoice and asset implementations remain private transactional helpers.
**Tech Stack:** Next.js server actions, Supabase PostgreSQL, Vitest.
**Spec:** ../specs/2026-10-04-purchase-recovery-design.md

## Global Constraints

- Keep current invoice status, amount, funding, branch and Akses Grup policies.
- Work only in this worktree and fictional isolated databases; no remote changes or dependencies.
- No generic draft retention or expiry policy.

## Review Focus

- Missing receipt rows must never silently become full receipts.
- Invoice retry must recover before old invoices change remaining quantity or layer plans.
- Changed payload under an old key must fail before writes.
- Revoke access after commit: recovery must still reject the caller.
- Concurrent distinct receipt keys must not exceed remaining quantity.

### Task 1: Atomic RPCs and recovery

**Files:** Create migration `20261004120000_purchase_recovery.sql`, SQL suite `supabase/tests/purchase_recovery.sql`, isolated runner `scripts/test-purchase-recovery-db.py`.
**Interfaces:** `receive_purchase_order(uuid,text,text,integer,date,text,text,jsonb)` returns receipt JSON; `recover_purchase_operation(text,text,jsonb)` returns prior result or null; invoice and asset RPCs require `p_request_key`.

- [x] Write SQL tests for atomic staged receipt, retry/conflict, unit validation, authorization and failure rollback.
- [x] Run isolated runner; expect missing RPC failure.
- [x] Implement ledger, authorization, receipt transaction and recovery wrappers; revoke former unkeyed public RPCs.
- [x] Run SQL tests and concurrent sessions; expect one effect for duplicate retries and no over-receipts.

### Task 2: Callers and browser keys

**Files:** Update receipt/invoice/asset actions and their forms; add shared request-key components and server-action tests.
**Interfaces:** Form `request_key` is stable across retries; invoice canonical input matches RPC/recovery canonical business payload.

- [x] Write real action tests for no direct receipt writes, key propagation, error handling and invoice recovery before stale reads; run RED.
- [x] Implement shared tab-local request key, clear only the confirmed key on success, and route all receipt effects through RPC.
- [x] Run focused Vitest, full `npm test`, TypeScript and scoped ESLint; inspect every failure.
- [x] Commit verified work and send parent exact evidence / limitations for final review.

## Execution evidence and rulings

- Initial real-action tests failed because receipt writes bypassed the RPC and invoice retry read stale tables; the revised actions pass.
- Baseline PostgreSQL failed on the missing receipt RPC; new SQL tests pass. Nonfinite invoice prices were then reproduced as accepted before their guard was added.
- Added `get_purchase_operation_result(text,text)` and a read-only recovery button because refreshed receipt quantities differ from the original payload. This retains submission identities without imposing draft storage or expiry rules.
- Use `useSyncExternalStore` for browser keys; an explicit confirmed-key event also rotates forms preserved during same-page asset navigation.
- Receipt acceptance requires a linked SKU and a current master unit conversion matching the stored PO factor; ambiguous legacy rows fail closed rather than producing uncertain stock.
- `npm test`: 133 files, 1,215 tests passed. TypeScript, scoped ESLint, SQL suite and seven concurrent/queued permission cases passed.
- Next.js documentation path named in AGENTS.md was absent from the installed Next.js 15.5.25 package; no dependency installation or upgrade was made.
- Parent agent owns independent final review and integration. See `supabase/tests/README.md` for the exact isolated database boundary and remaining browser/PostgREST acceptance.

- Parent review required an explicit `profiles.is_active IS TRUE` authorization check; disabled users with valid JWTs must be rejected for both purchase posting and result recovery.

- Production `npm run build` passed using fictional localhost Supabase settings; the existing Supabase middleware Edge Runtime warning and webpack cache-size warnings remain. Disabled-user SQL regression was observed failing before the active-profile guard and passing afterward.

- Follow-up review: recheck the current fixed-asset branch on both identical RPC retries and read-only result recovery. The SQL regression first reproduced recovery after an asset moved outside the actor's assigned branch, then passed with the current-row authorization check.
