# Clinic DEMO Finishing Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. No implementer delegation; one independent final review is required. Follow checkbox tasks and keep progress in this file.

**Goal:** Ship MEET-09, MEET-07 and MEET-08 as usable DEMO features, then update their sheet status.
**Architecture:** Extend existing consent/admission and checkout/commission flows. A dedicated checked checkout wrapper stores immutable fee/incentive snapshots atomically while retaining existing posting/RLS primitives.
**Tech Stack:** Next.js 15.5.25, React 19.2.4, TypeScript, Supabase/PostgreSQL, Vitest, Playwright.
**Spec:** `docs/superpowers/specs/2026-10-12-clinic-demo-finishing-design.md`.

## Global Constraints

- DEMO examples authorized; final company policies are not prerequisites for this demo batch.
- Native execution on `codex/clinic-demo-finishing`, based on deployed main 01900682; preserve prior local feedback artifacts.
- Use claims-aware `auth.role()`, active profile, branch/module access and eligible staff checks. No permission broadening.
- No historical data reset/backfill and no messages to other people. Verify receipt/reminder sending disabled for live demos.
- Database migrations and demo configuration precede frontend release; preserve rollback/replay, stocks and journals.

## Review Focus

1. Consent categories cannot be forged by raw authenticated writes; signed documents immutable and branch checked.
2. Version/config changes and retries do not change posted money; admin cannot be counted twice or included in incentive basis.
3. Only selected eligible staff receive one shared pool; reports/payroll must not add the legacy clinic commission too.
4. Every fee charge/expense is balanced to the right account; failure of part two rolls back all part-one effects.
5. Void/reissue and draft recovery preserve the original snapshot/payment identity without duplicate allocation.

## Task 1 — Typed consent and atomic admission

**Files:** `src/lib/consent.ts`, consent/template UI/actions, rawat-inap action/page, payment consent reads; migration `20261012100000_inpatient_consent.sql`; unit/action tests and `supabase/tests/inpatient_consent.sql`.
**Interfaces:** `hasInpatientConsent(rows, requiredTemplateId?) -> boolean`; `clinic_admit_inpatient(p_visit_id uuid,p_treatment_plan text,p_request_key text) -> uuid`; `clinic_inpatient_consent_valid(p_visit_id uuid) -> boolean`.

- [ ] Write failing tests for general consent vs Rawat Inap, wrong template/branch, unsigned, changed snapshot and concurrent signing/admission retry.
- [ ] Add template/snapshot kategori and admission consent_id/request key; checked trigger/RPC guards and atomic status log.
- [ ] Connect existing UI/actions to typed consent and admission; expose specific warning before admission.
- [ ] Run unit/action and real SQL tests; seed typed DEMO template, migrate, deploy and smoke test before closing MEET-09.

## Task 2 — Demo financial policy and pure quote/allocation

**Files:** `src/lib/clinic-demo-policy.ts`, `src/lib/clinic-demo-policy-server.ts`, new `/klinik/aturan-demo` page/actions/form; migration `20261012110000_clinic_demo_financial_policy.sql`; focused tests.
**Interfaces:** `quoteDemoPayments(policy,parts) -> {parts,customerFee,companyFee}`; `allocateDemoIncentive(total,employeeIds) -> {employeeId,amount}[]`; policy rows immutable except active flag, save via checked admin RPC.

- [ ] Tests: known rates, single/split exact rupiah, null/NaN/negative/unknown methods, equal allocation/remainder/duplicates.
- [ ] Implement pure helpers and immutable policy settings with demo defaults from spec, account validation and active OWNER/ADMIN writes.
- [ ] Provide settings page and labels explaining example policy, fee bearer, effective version and prospective updates.

## Task 3 — Atomic checkout, snapshots and commission/payroll

**Files:** checkout form/action/page and invoice/struk; posting helper; `src/lib/komisi-data.ts`; migration `20261012111000_clinic_demo_checkout.sql`; real SQL/browser/action tests.
**Interfaces:** `clinic_post_demo_invoice(p_visit_id,p_request_key,p_invoice,p_lines,p_policy_id,p_payments,p_employee_ids) -> uuid`. Payments supply base amounts and server-resolved kas_code; server computes fees and all posted gross/net amounts.

- [ ] Write failing rollback/replay, fee-bearer, service basis, staff eligibility, allocation, void/reissue and legacy commission exclusion tests.
- [ ] Implement wrapper using existing invoice/split/receipt and journal routines, version snapshots, protected money tables and original request identity.
- [ ] Show prospective fee/gross amounts in UI, persist demo policy/recipients in draft, support initial full single/split checkout, and print fee details.
- [ ] Merge stored allocations into existing commission/payroll totals while excluding legacy contributions for covered invoices.
- [ ] Run real SQL plus browser tests, including paid replay and audit readback after void/reissue.

## Task 4 — Review, release and sheet

- [ ] Full application tests, TypeScript, targeted lint and production build; preserve commands/results.
- [ ] Independent whole-branch review; fix material findings with regression tests.
- [ ] Apply tested migrations and DEMO seeds; merge reviewed PR(s), verify Production deployment(s), smoke-test sample checkout and data readback.
- [ ] Update MEET-07–09 only after features are live and demonstrated. Preserve notes/history/formatting; read back edits.

## Ledger

- Initial release: PR #46 merged; Production 7007030596 successful. Sheet six changed rows read back correctly.
- Ruling: use DEMO example rates/template and execute inline without another data/permission gate, following user's explicit continuation and demo authorization. Wrong assumption cost: revise examples before operational use; posted snapshots remain intact.
- Ruling: keep original DP/correction workflow outside automatic DEMO financial checkout; disclose the initial full-payment scope in UI and sheet rather than silently invent partial-fee policy.
- Next.js bundled docs absent; build/typecheck provide version-specific verification alongside existing repo patterns.
