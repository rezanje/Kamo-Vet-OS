# P05 PO price correction after advance — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this existing isolated workspace. No new implementer lane.

**Goal:** Let an active OWNER correct supplier prices before receipt/invoice even when a PO has advances, preserving source line identities and existing DP cap.
**Architecture:** Separate price-only RPC/form; retain the full-edit/cancel child guards. Serialize on the existing PO and advance-capacity locks, compare revision, preserve all quantities/units/parents, retain audit and idempotent receipt.
**Tech Stack:** Existing Next15/React19, Supabase PostgreSQL, Vitest and isolated PostgreSQL17.6.
**Spec:** Canonical74-item feedback P05, with P06 cap and P08 dependency constraints; no refund/posted-document policy inferred.

## Constraints and review focus
- PR128 and N01 remain preserved; no denied merge/publication retry or target migration.
- Existing OWNER/module/branch/closed-period checks remain; no ACL/RLS changes to existing objects.
- New total must be positive, finite, two-decimal and at least active DP. Canceled DP needs existing refund proof; consumed/unreconciled advances reject.
- Received/invoiced/legacy-paid/returned/short-closed PO stays on existing correction route.
- Reject missing/duplicate/foreign lines, forged quantities, stale revisions, changed retry payload, non-cent money; audit failure rolls back.
- Concurrent DP/receipt/correction must serialize; repeatable-read snapshots use existing capacity epoch conflict.

## Task1 — atomic price-only correction
Files: new migration `20261023200000_po_price_after_advance.sql`, `supabase/tests/po_price_after_advance.sql`, `scripts/test-po-price-after-advance-postgres.py`.
Interface: `revise_purchase_order_prices(text,uuid,integer,jsonb,text) -> jsonb` using existing request/revision storage; item payload contains exact source `id,harga_beli` only. Result: `po_id,revision,action,mode,revision_id,total`.
- [x] RED: real DP + existing revise_purchase_order rejects full edit; desired price-only RPC absent, no bypass.
- [x] Implement price-only update/audit/receipt in one transaction; no item delete/reinsert, no DP/journal mutation.
- [x] GREEN: exact cap, stale/retry/validation/auth/period/children/rollback and two-session ordering.

## Task2 — explicit UI/action
Files: new `POPriceCorrectionForm.tsx`, PO detail page, purchase actions and focused component/action tests.
- [x] RED: a DP-only PO offers price-only correction, received/invoiced/unauthorized PO does not.
- [x] Add explicit original/new totals and existing DP display; blank editable price states, exact source IDs, reason, existing draft/submit guard.
- [x] Validate action response before success; timeout/undefined retains draft, no false success.
- [x] GREEN affected components/actions; full app3114 passed, typecheck/scoped lint/build and narrow independent review passed.
- [ ] Publish the separate candidate and verify exact-head preview if allowed. No target rollout while blocked release is pending.
