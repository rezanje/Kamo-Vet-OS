# VetOS P0/P1/P2 Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship all requested P0/P1/P2 fixes with branch isolation, atomic accounting, inventory separation, recurring-run idempotency, flexible user COA codes, discoverable ledger detail, consistent sales discounts, and production verification.

**Architecture:** Pure TypeScript helpers define access, line partitioning, journal, and schedule behavior. One additive PostgreSQL migration enforces RLS and introduces transactional RPCs so financial documents cannot partially persist. Existing Next.js pages/actions call those narrow interfaces.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Vitest, Supabase/PostgreSQL RLS/RPC, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-16-p0-p1-stabilization-design.md`

## Global Constraints

- Do not change P3 or application-wide date formatting.
- Keep RLS and branch isolation; ADMIN is branch-scoped.
- No journal backfill for historical assets without source evidence.
- Every financial write is all-or-nothing and journal-balanced.
- Use small commits and release only after the full verification gate is green.

---

### Task 1: Clinic and HRIS access scope

**Files:**
- Create: `src/lib/operational-access.ts`
- Create: `src/lib/__tests__/operational-access.test.ts`
- Modify: `src/lib/branch-access.ts`
- Modify: `src/lib/__tests__/branch-access.test.ts`
- Modify: `src/app/(app)/klinik/antrian/page.tsx`
- Modify: `src/app/(app)/hris/karyawan/page.tsx`
- Modify: `src/app/(app)/hris/absensi/page.tsx`
- Modify: `src/app/(app)/hris/karyawan/actions.ts`
- Modify: `src/app/(app)/hris/absensi/actions.ts`
- Create: `supabase/migrations/20260916090000_p0_p1_stabilization.sql`

**Interfaces:**
- Produces: branch/doctor/employee scope helpers and RLS helpers used by all affected pages/actions.

- [ ] Write tests proving ADMIN uses assigned branches, OWNER remains global, doctor scope is assigned-doctor OR assigned-branch, and WIB today is dynamic.
- [ ] Run the targeted tests and confirm the old behavior fails.
- [ ] Implement minimal helpers and page/action filters.
- [ ] Add RLS function/policy replacements to the migration.
- [ ] Run targeted tests, migration contract checks, lint, and commit `fix(access): isolate clinic queue and HRIS by branch`.

### Task 2: Atomic opening balances and new asset purchases

**Files:**
- Create: `src/lib/asset-acquisition.ts`
- Create: `src/lib/__tests__/asset-acquisition.test.ts`
- Modify: `src/app/(app)/keuangan/aset/actions.ts`
- Modify: `src/app/(app)/keuangan/aset/page.tsx`
- Modify: `supabase/migrations/20260916090000_p0_p1_stabilization.sql`

**Interfaces:**
- Produces: `assetPurchaseJournal(...)`, separate opening/purchase actions, and atomic `create_fixed_asset_acquisition(...)` RPC.

- [ ] Write failing tests for Cash/Bank/AP journal balance and rejection of an opening-balance source in a purchase.
- [ ] Implement journal builder and separate forms/actions.
- [ ] Add acquisition metadata and transactional RPC to the migration.
- [ ] Verify tests and commit `fix(assets): separate opening balances from purchases`.

### Task 3: Direct purchase invoices with fixed-asset lines

**Files:**
- Create: `src/lib/direct-purchase-lines.ts`
- Create: `src/lib/__tests__/direct-purchase-lines.test.ts`
- Modify: `src/lib/faktur-beli.ts`
- Modify: `src/lib/__tests__/faktur-beli.test.ts`
- Modify: `src/app/(app)/pembelian/faktur/langsung/FakturLangsungForm.tsx`
- Modify: `src/app/(app)/pembelian/faktur/langsung/page.tsx`
- Modify: `src/app/(app)/pembelian/faktur/langsung/actions.ts`
- Modify: `supabase/migrations/20260916090000_p0_p1_stabilization.sql`

**Interfaces:**
- Produces: discriminated stock/asset line payload, payment-source journal builder, and atomic `create_direct_purchase_invoice(...)` RPC.

- [ ] Write failing tests for asset-only, stock-only, mixed, warehouse rules, one-line-one-asset, stock exclusion, and balanced AP/Cash/Bank journals.
- [ ] Implement pure validation/partitioning and UI payload.
- [ ] Implement transactional invoice RPC including stock, fixed assets, links, and journal.
- [ ] Wire action to RPC and verify source document links.
- [ ] Run targeted tests and commit `feat(purchases): support fixed assets on direct invoices`.

### Task 4: Individual useful life and category cleanup

**Files:**
- Modify: `src/app/(app)/keuangan/kategori-aset/actions.ts`
- Modify: `src/app/(app)/keuangan/kategori-aset/page.tsx`
- Modify: `src/app/(app)/keuangan/aset/KategoriUmur.tsx`
- Modify: `src/app/(app)/keuangan/aset/page.tsx`
- Modify: `supabase/migrations/20260916090000_p0_p1_stabilization.sql`

**Interfaces:**
- Consumes: individual `fixed_assets.umur_bulan` from Tasks 2/3.
- Produces: category classification/account mapping without an economic-life default.

- [ ] Remove useful-life writes and display from category management.
- [ ] Keep useful life required on every individual asset form/invoice line.
- [ ] Relax category schema without overwriting existing asset lives.
- [ ] Verify build/type checks and commit `refactor(assets): keep useful life on individual assets`.

### Task 5: Bounded daily/monthly recurring transactions

**Files:**
- Modify: `src/lib/recurring.ts`
- Modify: `src/lib/__tests__/recurring.test.ts`
- Modify: `src/app/(app)/keuangan/jurnal-berulang/actions.ts`
- Modify: `src/app/(app)/keuangan/jurnal-berulang/RecurringForm.tsx`
- Modify: `src/app/(app)/keuangan/jurnal-berulang/page.tsx`
- Modify: `supabase/migrations/20260916090000_p0_p1_stabilization.sql`

**Interfaces:**
- Produces: `dueRecurringOccurrences(...)`, shared safe runner, run-now action, explicit history/status fields.

- [ ] Write failing tests for daily/monthly dates, required repeat count, completion, catch-up bounds, and duplicate run-now calls.
- [ ] Add schedule/history schema and backfill existing monthly schedules without fabricating runs.
- [ ] Implement shared runner and Jalankan Sekarang.
- [ ] Update form/list/history UI.
- [ ] Run targeted tests and commit `feat(recurring): add bounded daily and monthly schedules`.

### Task 6: User COA codes, ledger drill-down, and sales discounts

**Files:**
- Modify: `src/lib/coa-sistem.ts`
- Modify: `src/lib/__tests__/coa-sistem.test.ts`
- Modify: `src/app/(app)/keuangan/coa/page.tsx`
- Modify: `src/lib/ledger.ts`
- Modify: `src/lib/__tests__/ledger.test.ts`
- Modify: `src/app/(app)/keuangan/buku-besar/page.tsx`
- Modify: `src/lib/penjualan-jurnal.ts`
- Modify: `src/lib/__tests__/penjualan-jurnal.test.ts`
- Modify: `src/app/(app)/klinik/pembayaran/[visitId]/actions.ts`

**Interfaces:**
- Produces: 4–6 digit user codes with unchanged system/reserved protections, branch-aware ledger lines, whole-row ledger links, and a shared separate-discount journal pattern.

- [ ] Write failing tests for 4–6 digit user codes, system/reserved protections, parent/group roll-up, branch origin/filtering, ledger/journal equality, and clinic/petshop discount lines.
- [ ] Implement COA validation/UI without deriving report groups from code length.
- [ ] Make account names/rows open ledger detail and show transaction branch in all-branch mode.
- [ ] Audit every clinic sales-posting path and route missing discounts through the shared journal builder.
- [ ] Avoid historical rewrites unless a separate evidence-based migration is required.
- [ ] Run targeted tests and commit `feat(finance): complete P2 accounting workflows`.

### Task 7: Release verification and production rollout

**Files:**
- Create: `docs/HASIL-P0-P1-P2-VETOS-2026-09-16.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: auditable verification evidence and release identifiers.

- [ ] Run targeted tests, `npm test`, `npm run lint`, `npm run build`, `git diff --check`, and SQL static checks.
- [ ] Review the complete diff for security/accounting regressions and fix all critical/important findings.
- [ ] Apply migration and record its exact version/result.
- [ ] Fast-forward main and push; verify Vercel production deployment.
- [ ] Smoke-test two accounts, HRIS WIB date/counts, opening vs purchase assets, asset-only/mixed invoices, stock exclusion, recurring idempotency/completion, COA 4–6 digits, ledger drill-down/branch display, and clinic/petshop discounts.
- [ ] Reconcile each finance scenario from source document to journal, ledger, and balance sheet.
- [ ] Commit verification evidence and report production URL, commit, migrations, scenarios, and blockers.
