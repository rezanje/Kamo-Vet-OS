# N02 PO Branch Number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New PO numbers identify the authoritative destination branch without rewriting history.
**Architecture:** Append branch code in the existing atomic creator after replay/access checks; reuse its locking and sequence allocation. Settings help/example reflects the PO-only suffix.
**Tech Stack:** Existing Next15.5/React19/TypeScript, PostgreSQL17.6, Vitest and isolated Docker SQL harness.
**Spec:** docs/superpowers/specs/2026-10-23-n02-po-branch-number-design.md

## Global Constraints

- Preserve role/branch checks, atomicity, request identity and stored financial quantities.
- One migration only; no history replay, security weakening, data backfill or permanent deletion.
- Source branches preserved, normal pushes; full operational simulations deferred.

## Review Focus

- Same prefix across two branches must produce distinguishable numbers.
- Replay after branch code edit must return its original receipt.
- Branch-code edit racing creation must wait on the branch share lock.
- Invalid/blank/overlong expanded numbers must fail without header/item/request writes.
- Ordinary document formats and creator authorization/warehouse checks must not change.

### Task 1: Atomic branch-aware PO numbering and truthful help

**Files:** new SQL migration/test and narrow SQL runner; modify settings numbering page; new real-page rendering test; existing PO lifecycle suite unchanged.
**Interfaces:** existing `create_purchase_order_atomic(text,text,integer,uuid,uuid,uuid,date,jsonb)` and its JSON receipt remain unchanged. Number prefix becomes configured/date prefix + locked branch code + `-`.

- [x] Write SQL acceptance for two branches, second same-branch sequence, replay after branch rename, blank/control code, literal punctuation, expanded length/warehouse/access, injected audit failure rollback and unchanged historical number. Write actual-page regression for PO example/help and unchanged non-PO example.
- [x] Run RED against current main in owned network-none PostgreSQL17.6 and Vitest; save exact failures.
- [x] Apply one guarded definition patch to creator; locked branch lookup, code validation and existing expanded-length guard. Update only PO help/example.
- [x] Run GREEN SQL plus existing purchase_order_lifecycle, focused page/numbering tests and one bounded branch-edit/creation race. Then full app suite/typecheck/scoped lint/build once stable.
- [ ] One independent scoped review; fix material findings, record limitations. Commit/normal push one PR, verify exact-head CI; reviewed target preflight/apply and normal main merge only within current explicit release authorization.

The user explicitly chose autonomous efficient implementation and authorized subsequent checked main releases; no repeated design/permission menu is inferred. Native execution, one final reviewer, no parallel implementation workers.
