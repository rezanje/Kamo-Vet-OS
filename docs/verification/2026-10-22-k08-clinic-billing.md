# K08 — clinic draft, invoice, payment and visit consistency

Candidate branch `codex/k08-clinic-billing-consistency-20261022`, based on main `102f3b0555305524611296e29d16affc12553eb7` (refetched unchanged before final verification). PR83/A01 and PR88/N01 are frozen and excluded. No material-category, purchase-advance, CRM or numbering work is included.

## Evidence boundary and diagnosis

Parent supplied the Part2 00:50:00–01:00:17 and 01:01:09–01:01:23 evidence: frame53:30 shows an old paid415k invoice alongside a new400k draft, not proof of a400k payment; frame59:30 shows a stock failure. This task did not obtain the original recording's database IDs or claim that400k was successfully charged, duplicated, or missing from a report after commit. The controlled reproduction uses fictional visits/invoices and exact IDs, not reconstructed production history.

Four defects were reproduced before their fixes:

1. Payment-page source rows can total305k+95k=400k correctly, but `useClinicDraft` restores an older305k browser cart over the fresh clinical source on remount. Previous recovery refreshes only locked inpatient rows, so new ordinary clinical rows disappear from the recovered cart. Automatically adding rows to a possibly committed retry would also change its sealed payload.
2. The URL `?success=bayar` alone displays successful payment even with no invoice, an unpaid invoice, or DP. Entered cash also labels its calculated state as payment status before persistence. Missing/error financial reads can be treated as an empty draft or incomplete correction.
3. Direct single-method paid creation commits `clinic_post_invoice`, then the application checks out the visit in a second request. A failed/lost follow-up leaves committed money and unfinished status. Split/DEMO already wrap their checkout atomically. A failed invoice-number readback similarly loses the distinction between a confirmed commit and a failed post.
4. Sales → Faktur adds DP and receipt rows to calculate paid money. Initial single-method paid clinic invoices store `paid_status=Lunas` and DP0 without separate receipt rows, so an old415k paid invoice incorrectly shows415k remaining. The existing group reader already treats stored Lunas as fully paid.

RED evidence: [source recovery](../evidence/2026-10-22-k08/source-red.log), [reader](../evidence/2026-10-22-k08/reader-red.log), [posting action](../evidence/2026-10-22-k08/action-red.log), [uncertain outcome](../evidence/2026-10-22-k08/uncertain-red.log), [actual sales balance](../evidence/2026-10-22-k08/sales-reader-red.log), [atomic checkout on222 baseline migrations](../evidence/2026-10-22-k08/atomic-checkout-red.log), [390px overflow](../evidence/2026-10-22-k08/browser-mobile-red.log). The first sales-test harness needed `.gt` added; the retained RED run then fails on the incorrect415k remaining balance, not a missing mock method.

## Result and actual coverage

| Area | Result and evidence |
| --- | --- |
| Fresh clinical additions | New305k service plus95k care prefills400k. Clinical source is fingerprinted from existing billing rows; no raw medical record or new personal payload is stored. |
| Restored browser draft | An older or legacy source fingerprint preserves its original rows/request key and blocks submit. It shows the latest source subtotal. Explicit **Muat tagihan terbaru** resets to current source and a fresh request identity after asking the cashier to inspect stored invoices. Same-source edits and locked rows retain prior behavior. |
| Commit/read state | New drafts are explicitly not yet invoices/payments/sales. Green payment success requires a stored paid invoice and finished visit. Unpaid/DP acknowledgements say invoice stored, not payment complete. Financial source/read errors stop rendering a payable or editable empty invoice. |
| Single paid creation | Existing RPC now calls existing checkout before returning, under its existing visit lock and the same financial transaction. Stock, invoice/items, journals and checkout roll back together on failure. No new endpoint, function grant, role or branch policy. |
| Split/DEMO | Existing atomic outer RPCs retained. Their base call uses Belum Lunas, avoiding premature checkout. Existing allocation, fee, loyalty, salesperson and correction tests retained. |
| Retries/lost responses | Request hash and early existing-invoice return unchanged. The application no longer repeats checkout on single/group successful posts or replays. SQL proves one invoice, one checkout event and no duplicated stock/journal; split retry retains exactly two receipts. |
| Known commit/unconfirmed transport | Confirmed invoice ID with unreadable number says invoice already stored. Unknown transport results say outcome uncertain, preserve draft/key, and ask to inspect the invoice before retrying without receiving money again. Stock shortage still explains insufficient stock; no stock guard is relaxed. |
| Sales reader | Stored Lunas invoice shows zero remaining even without receipt rows. DP+subsequent receipt remains partially owing. Uses same existing RLS query and exact visit route. No cross-branch query expansion. |
| Existing incomplete history | Paid/unfinished visit displays a warning without charging again. No historical repair or historical audit reconstruction. An initially proposed app-only recovery button was removed after independent review reproduced a concurrent inpatient-admission race. |
| Mobile | Existing payment form stacks at760px and contains table scrolling.390px page has no document-width overflow; table columns remain horizontally scrollable. |

Fictional SQL trace: visit `d600…0001` → old415k paid invoice; visit `d600…0002` → clinical source305k+95k, failed stock post has no invoice, replenished test stock → exact400k invoice; visit `d600…0003` →400k split with150k+250k receipts; visit `d600…0004` is moved to an inaccessible fictional branch to assert posting denial. UI/action tests assert exact visit/medical-record/invoice IDs rather than number/name matching.

## Verification actually executed

- `npm test`: **312 files /2440 tests pass**. [Full output](../evidence/2026-10-22-k08/full-tests.log).
- Focused draft/reader/action/posting/report suites: **64 tests /5 files pass**. [Output](../evidence/2026-10-22-k08/focused.log).
- `npx tsc --noEmit`: pass. Scoped ESLint:0 errors,1 existing `<img>` performance warning in payment form. [Types](../evidence/2026-10-22-k08/typecheck.log), [lint](../evidence/2026-10-22-k08/lint.log).
- Local PostgreSQL16 runner: **223 migrations applied;5/5 suites pass** (`clinic_billing_consistency`, `clinic_invoice_post`, `clinic_billing_lifecycle`, `inpatient_consent`, `clinic_demo_financial_policy`). Includes unauthenticated/cross-branch denials, session-derived checkout actor, stock failure, injected checkout failure after financial work, rollback snapshots, old/new identity separation, split receipts and idempotent retries. [SQL output](../evidence/2026-10-22-k08/sql.log).
- Guarded migration rollback/reapply reproduces the exact candidate function definition, owner, security mode, search path and ACL. No credentials/URL/target arguments exist in this owned, network-none test runner; container and volumes removed.
- Existing raw `clinic_inpatient_discharge.sql` still fails during unauthenticated fixture setup at `protect_inpatient_care_staff`, before its application assertions. The runner reproduces that exact failure on the restored222-main function and223-candidate function. It is an explicit baseline fixture gap, not a passing discharge test; no guard or test expectation was weakened. Modern authenticated `inpatient_consent.sql` passes. This does not establish target parity or all unrelated SQL suites passing.
- Actual React payment-form/hook Chromium fixture:305→400 source review, same-key recovery, stock-failure redirect, uncertain transport, success cleanup, split recovery, identity isolation,390px. [Browser output](../evidence/2026-10-22-k08/browser.log).
- Existing exam/inpatient draft Chromium fixture: both forms pass reload, errors, units, uploaded references, followups, identity, discard and acknowledged cleanup. Its fixture was missing the required `tindakanItems` prop after released service-picker changes; only the fixture gained `[]`. [Regression output](../evidence/2026-10-22-k08/clinical-draft-regression-browser.log).
- Browser saves are simulated action responses. SQL fixtures execute actual functions with fictional authenticated claims in local PostgreSQL; these are not a full authenticated Next/Supabase session on a shared target. No live patient, invoice, report or data writes occurred.
- Independent **Sol6.1 high** read-only review: identified the removed recovery race; final revised implementation has no remaining P1/P2 findings. Reviewer independently observed2440 passing tests and40 focused passes. Final SQL output was confirmed by implementer after reviewer completed.
- `git diff --check`: pass. `npm run build` with fictional local Supabase settings: pass,193 static pages generated; existing image/unused-variable and Supabase Edge-runtime warnings remain. Production build result is recorded in [build output](../evidence/2026-10-22-k08/build.log) and [checks](../evidence/2026-10-22-k08/checks.json).

Screenshots use fictional fixtures and were visually inspected: [stale source review](../evidence/2026-10-22-k08/stale-source-review.png), [refreshed400k](../evidence/2026-10-22-k08/reviewed-source-400-desktop.png), [uncertain payment390px](../evidence/2026-10-22-k08/payment-unconfirmed-mobile.png), [split](../evidence/2026-10-22-k08/split-payment-desktop.png).

## Migration, release and rollback (instructions only)

New migration: `supabase/migrations/20261022232107_clinic_paid_checkout_atomic.sql` (created through discovered CLI `migration new`). It patches the deployed function's exact final return anchor, preserving later moving-average/auth fixes. It aborts if the expected anchor is missing or already patched. No tables, columns, schemas, policies, grants, accounts or settings change.

Parent/release owner must first obtain target parity, backup and approval. Review actual function definition and migration history against the candidate; run controlled test-environment migration and authenticated smoke/UAT. Apply the reviewed migration **before enabling the new application actions**, then deploy this exact candidate. The old app's redundant checkout remains idempotent during this ordering; the new app depends on atomic checkout being present. Do not deploy the application alone against a database missing this migration.

Rollback application to parent build before removing the atomic patch; alternatively leave the migration in place while rolling back the app (old extra checkout is idempotent). If DB rollback is required, use [guarded reverse patch](../rollback/2026-10-22-k08-paid-checkout.sql) only after review/approval; test proves roundtrip function/security identity. Do not restore a whole old function body that discards intervening average/auth fixes. Financial records/history are not deleted or rewritten; do not reset migration history blindly. Stop for inspection if anchors differ.

Local CLI2.75 supports migration-file creation but not current advisors; this network-none plain PostgreSQL harness has no Supabase control-plane advisor service. No target advisors/migrations were run or implied. Existing RPC API was checked against [official RPC docs](https://supabase.com/docs/reference/javascript/rpc) and current changelog before changes. The checkout has Next15.5.25 without the `node_modules/next/dist/docs` directory mentioned in AGENTS; existing APIs/types/build/browser were used without framework upgrades.

## Remaining scope and status

- **Code candidate**: implemented and locally tested; push/PR and exact preview status are reported separately.
- **Target migration/deploy/merge**: not performed. No production/shared database or external data changes. PR83/PR88 remain unchanged. Google Sheet not edited.
- **UAT**: pending approved target parity and authenticated end-to-end checkout, report and medical-reader smoke.
- No proof of a400k charge or double charge in the supplied meeting evidence; do not mark that hypothetical incident fixed or manufacture payment history.
- Existing paid invoices do not automatically absorb new clinical additions; use existing supported correction workflow. K06 paid→inpatient policy is unchanged. Historical paid/unfinished rows require a separate guarded reconciliation decision, not another payment.
- Source comparison occurs when the payment page loads/refetches/remounts; this adds no realtime subscription for a cashier tab left open while another user edits the source.
- Group checkout remains sequential per visit, not one all-pets financial transaction; known per-visit failures remain partial and clearly listed. Existing loyalty/WA side effects are outside the invoice transaction and are not redesigned here.
- The existing generic handler for some edit/reissue errors and broader report readers are not comprehensively redesigned; this candidate fixes demonstrated new-posting/draft/status and sales-balance defects only.
- No claim of full K08 business acceptance until target migration and UAT establish those boundaries.
