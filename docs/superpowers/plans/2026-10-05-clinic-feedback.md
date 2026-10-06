# Clinic Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline in this chat; do not dispatch agents unless the user requests delegation.

**Goal:** Mengirim Batch 1 berupa split payment manual yang atomik serta validasi dokter/keluhan, lalu mengerjakan batch berikutnya sesuai desain yang sudah diperiksa.

**Architecture:** Pertahankan jalur invoice satu metode. Tambahkan RPC komposisi untuk invoice campuran yang memanggil posting invoice existing sebagai piutang lalu mencatat seluruh bagian melalui penerimaan existing dalam satu transaksi. Dokter/keluhan divalidasi pada form, action, dan RPC pemeriksaan; aturan tidak otomatis diterapkan pada grooming.

**Tech Stack:** Next.js 15.5.25, React 19.2.4, TypeScript, Supabase/PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-clinic-feedback-design.md`

## Global Constraints

- Satu invoice untuk seluruh tagihan; payment gateway bukan prasyarat.
- Pembayaran campuran Batch 1 harus tepat menutup tagihan; kembalian campuran belum didukung.
- Server menghitung ulang diskon/pajak; UI bukan sumber nilai uang.
- Tidak memodifikasi data historis atau memigrasikan database remote selama implementasi lokal.
- Role, cabang, periode buku, shift, consent, stok, dan idempotensi existing harus tetap ditegakkan.
- Kebijakan biaya admin dan insentif yang belum disepakati tidak di-hardcode.

## Review Focus

1. Respons invoice hilang: replay tidak menggandakan bagian pembayaran atau poin (Task 2 dan 3).
2. Rekening bagian kedua salah: seluruh invoice/stok/jurnal rollback (Task 2).
3. Dua kasir untuk visit yang sama: satu invoice aktif tanpa deadlock akibat urutan lock berbeda (Task 2).
4. Nilai total berubah karena voucher/poin: bagian campuran dibandingkan dengan total server (Task 1 dan 3).
5. Grooming dan draft belum lengkap: validasi dokter medis tidak memblokir layanan nonmedis atau sekadar menyimpan draft (Task 4).

## Task 1 — kontrak pembayaran campuran

**Files:** Create `src/lib/clinic-split-payment.ts`, `src/lib/__tests__/clinic-split-payment.test.ts`; modify `src/lib/klinik-posting.ts`.

**Interfaces:**
- `ClinicSplitPayment = { method: string; amount: number; kas_code: string }` adalah bentuk yang dikirim server ke RPC; rekening tidak dipercaya dari JSON klien.
- `parseSplitPaymentDraft(raw: string): { method: string; amount: number }[]` memvalidasi array 2–6 bagian, metode existing, nominal positif dan rupiah utuh; malformed input menimbulkan error.
- `validateSplitPaymentTotal(parts: readonly { amount: number }[], total: number): void` menolak total yang tidak tepat sama dengan tagihan server. Tolak nominal total yang tidak valid.

- [ ] Tambahkan tests dengan assertions: 500000 + 500000 diterima untuk total 1000000; 499999 + 500000 dan 500001 + 500000 ditolak; array kosong, satu bagian, lebih dari enam, angka negatif/nonfinite/pecahan, metode palsu, dan JSON objek ditolak.
- [ ] Jalankan `npm test -- src/lib/__tests__/clinic-split-payment.test.ts`; pastikan kegagalan karena kontrak belum diimplementasikan.
- [ ] Implementasikan kontrak dan error yang dapat dibaca kasir; jangan menerima kode rekening dari JSON pembayaran klien.
- [ ] Jalankan test yang sama sampai PASS.

## Task 2 — posting campuran dalam satu transaksi

**Files:** Create `supabase/migrations/20261005090000_clinic_split_payment.sql`, `supabase/tests/clinic_split_payment.sql`. Read existing posting, payment, guard, and void/reissue functions before adding wrapper.

**Interfaces:**
- `public.clinic_post_split_invoice(p_visit_id uuid, p_request_key text, p_invoice jsonb, p_lines jsonb, p_payments jsonb) returns uuid`.
- Consumes existing `clinic_post_invoice(uuid,text,jsonb,jsonb)` and `clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)`.
- Produces invoice + all `invoice_payments` + accounting records, committed together. Existing single-method RPC stays callable.

- [ ] Add local SQL assertions for the seven Batch 1 payment scenarios in the spec, including simultaneous requests through the existing concurrency harness where applicable. Run before implementing; verify new function is missing.
- [ ] Add a dedicated split request ledger with a unique request key, visit/invoice reference, complete immutable request hash including every payment part, and restricted access. Validate authentication/cabang before looking up a replay result; lock the request and visit in an order consistent with existing posting.
- [ ] Validate complete split payload before creating invoice. Create the underlying invoice with zero DP and status Belum Lunas; invoke each existing receipt RPC inside this function. Derive bounded, deterministic per-part request keys from the split request key; do not exceed the existing 100-character limit.
- [ ] Preserve the outer hash as the authority for replay: changed lines, payment methods, amounts, accounts, or visit with the same key are conflicts. Return an identical already-committed result only after access checks. Failure in any receipt rolls back the ledger and all underlying operations.
- [ ] Follow existing privilege restrictions: authenticated may execute; public/anon/service_role may not execute. No raw authenticated writes to payment/ledger tables.
- [ ] Run local SQL assertions and existing clinic invoice/billing lifecycle tests using the setup documented in `supabase/tests/README.md`. Do not use remote credentials as a substitute for the local fixture.

## Task 3 — checkout form, draft, receipt, and action

**Files:** Modify `src/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm.tsx`, `actions.ts`, `invoice/page.tsx`, `struk/page.tsx`, `src/lib/__tests__/clinic-payment-action.test.ts`, `src/lib/__tests__/clinic-payment-form.test.tsx`, `scripts/test-clinic-payment-draft-browser.mjs`.

**Interfaces:**
- Form sends `split_payments` JSON containing method/amount only when mixed mode is selected; `requestKey` remains stable across draft recovery/retry.
- Action computes total using existing tax/discount/poin logic, resolves each account through `kodeAkunBayar`, and calls the split RPC once. Existing correction/DP path remains separate.
- Invoice/struk reads payment history, shows payment methods/amounts, and retains the full original invoice total.

- [ ] Add action tests: valid split invokes exactly one split RPC; mismatched server total and malformed payload never post; creation replay invokes the same split RPC; correction cannot silently change payment parts; loyalty is not awarded twice after replay.
- [ ] Add form/browser assertions: mode switch, two editable method/amount parts, add/remove up to six, calculated remainder, submit blocked when mismatch, no split editing during invoice correction, draft recovery retains every part.
- [ ] Inspect the existing `useClinicDraft` contract and its actual backing files before changing snapshot/schema; recover old single-method drafts without losing data. Add mixed-payment UI and hidden payload. Keep user copy about payment, not database/RPC internals.
- [ ] Integrate split action only for new/replayed mixed invoices. Respect existing shift/consent/period checks and revalidate affected payment/piutang pages.
- [ ] Print both payment rows with correct methods/amounts; transferred credit and DP must not be counted twice.
- [ ] Run targeted Vitest and draft browser script against a local app with fixture data. A static markup test does not replace interaction verification.

## Task 4 — mandatory clinical data

**Files:** Modify `src/app/(app)/klinik/rekam-medis/[visitId]/RekamForm.tsx`, `actions.ts`; create `supabase/migrations/20261005091000_clinic_required_fields.sql`; extend `supabase/tests/atomic_initial_clinic_record.sql`. Inspect `src/app/(app)/klinik/registrasi/RegistrasiForm.tsx`, `actions.ts` and the current initial-record RPC first.

**Interfaces:** Existing medical-record save action/RPC signature remains; medical completion requires eligible doctor ID and trimmed complaint. Registration/draft behavior follows the decision in the spec until clarified.

- [ ] Add tests for medical completion without doctor, with blank/whitespace complaint, invalid/ineligible doctor, valid clinical completion, and grooming. Verify failures before adding guards.
- [ ] Add form required indicators and validation; action validates before write; update existing atomic record RPC without replacing its rollback/access/idempotency checks. Return field-specific error text where practical.
- [ ] Run local record tests; ensure rejected submissions leave no record, prescription, compound issue, or service-state write.

## Task 5 — verification and handoff

- [ ] Run `npm test`; run `npx tsc --noEmit`, targeted lint, and `npm run build`. Record output and separate pre-existing failures from regressions. Install locked dependencies if missing after reading cloud networking requirements.
- [ ] Run local SQL and browser checks from Tasks 2–4. If local database tooling is unavailable, report which database behaviors remain unverified; do not call the batch production-ready.
- [ ] Review the full diff for single-method regressions, accounting balance, access checks, race/retry behavior, points, and migration reversibility.
- [ ] Present files changed, test evidence, and migration/deployment steps. Production deployment is a subsequent action after the concrete changes are reviewed.

## Subsequent batches

Batch 2 and Batch 3 in the spec are the complete remaining roadmap, not execution-ready tasks. Before implementing each, inspect its schema/flows and write a separate plan with exact interfaces and tests. Start Batch 2 with multi-cabang + role mapping, then unified racikan + status rekam medis. Start Batch 3 with rawat inap staffing/logs; implement insentif and admin fees after the listed policy decisions are answered.

## Status

User approved immediate inline Batch 1 execution on 2026-10-05. Implementation is on `codex/urgent-clinic-batch1`.

- Task 1: complete locally; parsing and total validation tests passed.
- Task 2: implemented; isolated PGlite checks passed for real split wrapper, receipt and clinical-save functions. Core invoice/stock/service-state routines are fixture doubles. Full Supabase stack, real stock integration and two-session races are not verified in this environment.
- Task 3: implemented; browser interaction passed for mixed amounts, disabled underpayment, reload, stable request keys, old drafts and single-method recovery; invoice/receipt show payment parts.
- Task 4: implemented; form/action/SQL guards added, medical doctor eligibility checked in SQL, grooming/boarding exempt; claims-only authentication tested.
- Task 5: full suite 1,407 tests passed; TypeScript passed; browser and isolated SQL checks passed. Initial and final production builds passed. Targeted lint has zero errors and one existing image warning. No production mutations or deployment.

### Rulings and review fixes

- Reuse the existing invoice request hash with embedded split parts instead of a second request ledger. This preserves the complete payload/replay check with fewer schema changes; a mismatch would incorrectly accept changed payment parts, covered by SQL rejection tests.
- Work in the dedicated managed cloud checkout on a new feature branch, preserving the original branch and existing plan files. No worktree creation or remote integration was performed.
- Next.js 15.5.25 does not contain the AGENTS.md-referenced `node_modules/next/dist/docs/` directory. Changes follow existing App Router/server-action patterns and were build/type checked; version-specific runtime behavior still requires normal deployment smoke checks.
- Final reviewer found auth fallback and shift reconciliation regressions. Both were reproduced and fixed: use `auth.role()` and retain `checkout_payment` provenance per receipt, including when reissuing. Shift regression tests pass; full void/reissue SQL integration remains unverified.
- Local SQL verification uses PGlite with explicit core routine doubles because Supabase CLI, Docker and local PostgreSQL binaries are unavailable. Do not describe this as full production stock/accounting verification.

### Delivery order

Apply both new migrations to a verified staging database before deploying the frontend: `20261005090000_clinic_split_payment.sql`, then `20261005091000_clinic_required_fields.sql`. Existing shift queries require the new `checkout_payment` column. Smoke-test split checkout, stock, journals, shift, void/reissue, eligible doctors and clinical completion with staging data. Only then release to production; no remote changes have been made here.

