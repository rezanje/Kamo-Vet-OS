# VetOS Feedback Stabilization and Accurate Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clinic, HRIS, and accounting workflows safe to use end-to-end, then close the highest-value Accurate parity gaps.

**Architecture:** Deliver five independent releases. First release only repairs access, dates, and accounting safeguards; it does not change accounting history. Later releases add purchase-to-asset linkage, finite recurring transactions, more flexible account codes, and clearer report navigation. Every financial write must either create its journal successfully or leave no transaction behind.

**Tech Stack:** Next.js App Router, TypeScript, Supabase PostgreSQL with RLS, Vercel, Vitest.

---

## Scope and release order

| Release | Outcome | Priority | Risk |
|---|---|---:|---|
| 1 | Doctor sees assigned queue; HRIS employee count and attendance date are correct; new assets cannot silently skip their journal | P0 | Operations and financial-data integrity |
| 2 | Purchase invoice can create fixed assets and link the invoice, asset card, and journal | P1 | New accounting workflow |
| 3 | Recurring transactions support daily/monthly period, fixed repeat count, execution history, and completed status | P1 | New automated posting workflow |
| 4 | COA accepts four to six digits; ledger detail is easy to open and identifies the branch | P2 | Accounting usability |
| 5 | Standardize date presentation in priority operational forms | P3 | Visual consistency |

## Decisions required before implementation

1. **HRIS scope for ADMIN:** choose either company-wide HR access for ADMIN, or access only to explicitly assigned branches. Keep current branch isolation unless the business chooses company-wide access.
2. **Recurring transactions:** support `Harian` and `Bulanan` in the first version. Weekly and yearly stay out of scope until requested. Each recurring template must have a fixed repeat count; no open-ended default.
3. **Fixed-asset purchases:** an asset line represents one physical asset. Quantity above one requires separate lines/names, preventing one asset card from representing multiple devices.
4. **Depreciation:** retain commercial straight-line depreciation in this release. Fiscal categories remain separate; declining-balance commercial depreciation is a later scope item.

## File map

| Area | Files to modify | Responsibility |
|---|---|---|
| Queue visibility | `src/app/(app)/klinik/antrian/page.tsx`, `src/app/(app)/klinik/antrian/LiveRefresh.tsx`, new Supabase migration | show only authorized doctor queue while preserving branch isolation |
| HRIS | `src/app/(app)/hris/absensi/page.tsx`, `src/app/(app)/hris/karyawan/page.tsx`, new Supabase migration, `src/lib/master-guard.ts` if role contract changes | correct date and employee visibility |
| Direct asset entry | `src/app/(app)/keuangan/aset/page.tsx`, `src/app/(app)/keuangan/aset/actions.ts` | force an explicit accounting source and prevent unjournaled current purchases |
| Purchase-to-asset | `src/app/(app)/pembelian/faktur/langsung/FakturLangsungForm.tsx`, `src/app/(app)/pembelian/faktur/langsung/actions.ts`, new asset-line component, new migration | one purchase document creates invoice, asset card, and balanced journal |
| Recurring | `src/app/(app)/keuangan/jurnal-berulang/RecurringForm.tsx`, `src/app/(app)/keuangan/jurnal-berulang/page.tsx`, `src/app/(app)/keuangan/jurnal-berulang/actions.ts`, `src/lib/recurring.ts`, new migration | schedule and track bounded recurring journals |
| COA | `src/app/(app)/keuangan/coa/page.tsx`, `src/app/(app)/keuangan/coa/actions.ts`, `src/lib/coa-sistem.ts`, `src/lib/__tests__/coa-sistem.test.ts` | safely allow user-created codes up to six digits |
| Ledger | `src/app/(app)/keuangan/buku-besar/page.tsx`, `src/lib/ledger.ts` | make existing account detail visible and show its branch |
| Date consistency | priority form components under `src/app/(app)/klinik/` and `src/app/(app)/hris/` | one displayed Indonesian date convention |

### Task 1: Reproduce and repair doctor queue visibility

**Files:**
- Modify: `src/app/(app)/klinik/antrian/page.tsx`
- Modify: `src/app/(app)/klinik/antrian/LiveRefresh.tsx`
- Create: `supabase/migrations/20260916173000_doctor_queue_access.sql`
- Test: `src/lib/__tests__/queue.test.ts`

- [ ] Log in as the exact doctor account and the registering admin account; register one patient for that doctor in one branch.
- [ ] Confirm the visit has the expected branch and doctor assignment, then confirm the doctor account has the matching employee and branch assignment.
- [ ] Write a failing access test: assigned doctor can read own visit; unassigned doctor cannot read it; branch staff can only read visits in their branch.
- [ ] Add the smallest RLS change required by the chosen HRIS/branch decision. Do not grant a doctor access to another doctor's queue.
- [ ] Change the queue page to state which filter is active and refresh only after a visit change authorized for the signed-in user.
- [ ] Verify in browser with both accounts: one queue appears immediately for the assigned doctor and remains hidden from an unrelated doctor.
- [ ] Commit: `fix(klinik): restore assigned doctor queue visibility`.

### Task 2: Stabilize HRIS employee visibility and attendance date

**Files:**
- Modify: `src/app/(app)/hris/absensi/page.tsx`
- Modify: `src/app/(app)/hris/karyawan/page.tsx`
- Create: `supabase/migrations/20260916174000_hris_employee_read_access.sql`
- Test: `src/lib/__tests__/tanggal.test.ts`

- [ ] Decide whether ADMIN is company-wide or branch-scoped for HRIS; record the decision in the migration comment.
- [ ] Write a failing date test: the default attendance date equals the current WIB date, never the historical pilot date.
- [ ] Replace the fixed attendance date with the existing WIB date helper.
- [ ] Make the employee-list query surface its failure to the user instead of converting a denied query to a misleading `0` count.
- [ ] Align employee read access with the chosen ADMIN rule and branch assignments; preserve self-only access for staff and doctors.
- [ ] Verify browser results: the saved employee appears in Master Karyawan, count is positive, and the same employee is available for attendance.
- [ ] Commit: `fix(hris): show authorized employees and use current attendance date`.

### Task 3: Make direct fixed-asset input accounting-safe

**Files:**
- Modify: `src/app/(app)/keuangan/aset/page.tsx`
- Modify: `src/app/(app)/keuangan/aset/actions.ts`
- Test: `src/lib/__tests__/aset.test.ts`

- [ ] Write a failing test: a current asset purchase cannot be saved without an explicit payment or payable source and a successful balanced journal.
- [ ] Split the form choice into `Saldo awal` and `Pembelian baru`; do not make `Saldo awal` the default.
- [ ] Require `Kas`, `Bank`, or `Hutang usaha` for `Pembelian baru`; keep `Saldo awal` limited to opening balances and label it as no-journal input.
- [ ] If the journal fails, roll back the newly created asset before returning an error.
- [ ] Reconcile existing assets created as opening balances before changing historical records; do not auto-create historical journals.
- [ ] Verify a test asset: debit Aset Tetap and credit selected source appear in the ledger and balance sheet; a monthly straight-line depreciation entry appears only after its eligible period.
- [ ] Commit: `fix(aset): require accounting source for new asset purchases`.

### Task 4: Add asset lines to direct purchase invoices

**Files:**
- Create: `supabase/migrations/20260916175000_purchase_invoice_asset_lines.sql`
- Create: `src/app/(app)/pembelian/faktur/langsung/AssetPurchaseLine.tsx`
- Modify: `src/app/(app)/pembelian/faktur/langsung/FakturLangsungForm.tsx`
- Modify: `src/app/(app)/pembelian/faktur/langsung/actions.ts`
- Modify: `src/app/(app)/keuangan/aset/page.tsx`
- Test: `src/lib/__tests__/aset.test.ts`

- [ ] Write failing tests for an asset-only invoice and a mixed stock-plus-asset invoice, including discount and input tax.
- [ ] Add an `Asset` line type with asset name, category, unit price, tax, and one-unit limit.
- [ ] Store each asset line with its purchase invoice and create exactly one fixed-asset card from each asset line.
- [ ] Keep inventory lines flowing to stock and account `1301`; route asset lines to account `1501` without changing stock.
- [ ] Generate one balanced purchase journal: debit inventory plus fixed assets plus input tax; credit accounts payable.
- [ ] Link invoice, journal, and asset detail in both directions.
- [ ] Verify in browser: one supplier invoice, one asset card, one payable balance, one journal, and no inventory movement for the asset line.
- [ ] Commit: `feat(pembelian): link fixed asset purchases to invoices`.

### Task 5: Build bounded recurring transactions

**Files:**
- Create: `supabase/migrations/20260916180000_bounded_recurring_journals.sql`
- Modify: `src/app/(app)/keuangan/jurnal-berulang/RecurringForm.tsx`
- Modify: `src/app/(app)/keuangan/jurnal-berulang/page.tsx`
- Modify: `src/app/(app)/keuangan/jurnal-berulang/actions.ts`
- Modify: `src/lib/recurring.ts`
- Test: `src/lib/__tests__/akhir-bulan.test.ts`

- [ ] Write failing tests for five daily executions, twelve monthly executions, a completed template, and a repeat run that must not duplicate a journal.
- [ ] Add fields for period (`Harian` or `Bulanan`), start date, repeat count, execution count, and status (`Aktif`, `Selesai`, `Nonaktif`).
- [ ] Generate due occurrences from start date through repeat count; each occurrence must have an idempotent source reference.
- [ ] Stop posting after the final occurrence and display `Selesai` instead of `Aktif`.
- [ ] Add an authorized `Jalankan sekarang` action that posts only due occurrences; preserve automatic catch-up for the scheduled process.
- [ ] Show a transaction history with scheduled date, journal number, amount, and execution status.
- [ ] Verify five-run daily and twelve-run monthly examples with no duplicate journals after repeated clicks.
- [ ] Commit: `feat(keuangan): add finite recurring transaction schedules`.

### Task 6: Extend COA and make ledger detail discoverable

**Files:**
- Modify: `src/app/(app)/keuangan/coa/page.tsx`
- Modify: `src/app/(app)/keuangan/coa/actions.ts`
- Modify: `src/lib/coa-sistem.ts`
- Modify: `src/lib/__tests__/coa-sistem.test.ts`
- Modify: `src/app/(app)/keuangan/buku-besar/page.tsx`
- Modify: `src/lib/ledger.ts`

- [ ] Write failing tests for valid four-, five-, and six-digit user account codes; retain rejection of wrong leading account group and reserved system codes.
- [ ] Change only user-created account validation from exactly four digits to four through six digits. Existing system codes remain unchanged.
- [ ] Replace the four-digit-only form help text and input limit.
- [ ] Make account name and row open the existing mutation view, not only the small eye icon.
- [ ] Add a branch column to account mutation rows when viewing all branches; retain branch filter behavior.
- [ ] Verify a six-digit account appears under the correct parent/type and its per-branch detail matches the corresponding journal.
- [ ] Commit: `feat(keuangan): support six digit COA and clearer ledger detail`.

### Task 7: Standardize operational date display

**Files:**
- Create: `src/components/TanggalInput.tsx`
- Modify: `src/app/(app)/klinik/antrian/page.tsx`
- Modify: `src/app/(app)/hris/absensi/page.tsx`
- Test: `src/lib/__tests__/tanggal.test.ts`

- [ ] Write a formatting test for `16/09/2026` and parsing back to `2026-09-16`.
- [ ] Replace priority native date inputs with one controlled Indonesian date input and calendar trigger.
- [ ] Keep storage and URLs in ISO date format while displaying `DD/MM/YYYY` to every account.
- [ ] Verify the admin and doctor accounts see the same date convention and filter the same visit date.
- [ ] Commit: `fix(ui): standardize operational date display`.

## Closed or verify-only earlier feedback

- Medical-record folder import: deployed with file-by-file progress and a visible file-size rule; perform one real customer-folder smoke test before marking operationally accepted.
- Sidebar collapse: deployed and browser-tested.
- Request-item search: current form supports typing item name/code; verify with an item beginning after `H` in production.
- POS failure recovery: cart draft is saved during checkout flow; run one failed-payment test and confirm all entries remain.
- HPP per invoice: existing ledger view links account `5101` to per-item HPP detail; make that link more visible in Task 6 if users still miss it.

## Verification gate before each release

- Run targeted tests, full test suite, and production build in a clean worktree.
- Review migration against branch-isolation rules before production execution.
- Deploy one release at a time.
- Smoke test with the actual affected role/account and one disposable test transaction.
- For financial work, reconcile the journal, ledger, balance sheet, and source document before saying the release is ready.
