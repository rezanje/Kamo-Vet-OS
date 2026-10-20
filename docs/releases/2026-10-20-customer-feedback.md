# KAMO customer feedback — 20 October 2026

## Delivered scope

- Complete, stable catalogue pagination in direct purchasing, quotations, sales orders, online sales, POS and cashier stock receipt. The live catalogue contains 3,300 active items.
- Accessible code/name item search in direct purchase and cashier stock requests; POS search also includes codes.
- Self-service password change after active-account and current-password verification. Profile/password links are available in admin, clinic staff and cashier navigation.
- Super Admin manual-journal and cash-entry correction. Cancellation preserves originals and posts exact reversing journals, with audit history, request identity, stale-revision protection and closed-period checks. Existing Finance/Admin cancellation permissions remain.
- Durable correction request identities survive draft expiry; failed responses retain inputs. Normal cash creation now preserves its draft and confirms complete journal lines before clearing it.
- Backoffice expense creation uses the existing atomic expense workflow, preserving the selected cash account, attachments and retry identity. Cancelled expenses are excluded from active totals and remain available for inspection.
- Dashboard date boundaries use UTC consistently, fixing the existing WIB-dependent regression.

## Verification

- Full application suite: 247 files / 2,082 tests passed.
- Production build passed, including type checking. Existing unrelated image/unused-variable lint warnings remain.
- Financial acceptance: three SQL suites passed in a unique disposable local PostgreSQL database; 22 required migrations and exact production helper/trigger definitions were loaded with error-stop enabled. The fixture grants no access to private request/audit writes.
- Browser: searched and selected a W item beyond the previous H cutoff; invoice number, quantity and price survived reload. No purchase was saved. Password form was inspected without changing any credential.
- Independent final review: no remaining P1/P2 findings in the reviewed diff.

## Production database

The three migrations dated 20261020112110, 20261020112715 and 20261020130000 were applied atomically and recorded in migration history. The prior expense function definition was saved privately before replacement. Post-check confirmed 104 journal entries, zero cash entries and seven expenses, unchanged from preflight. Private request-table reads remain revoked. No business transaction was corrected, cancelled, deleted or reset during rollout.

## Accounts and remaining scope

The workbook contains 86 complete account rows. Initial reconciliation found 66 candidate matches, one existing linked account and 19 identity/branch issues requiring review. These are preflight counts, not a claim that accounts were created. User selected permissions according to job and branch, without Admin/Super Admin elevation. Employee personal data and passwords remain outside Git.

Full correction coverage across POS sales, online sales, purchase invoice/receipt/payment and sales-document bodies remains outside this release. Existing returns/status/cancellation flows were inspected; they do not establish full edit/delete coverage. Changes affecting stock, settlement or tax need a separate defined correction flow before a delivery promise.

Transaction reset remains deferred until preserved/deleted data is agreed and a persistent rollback is verified. COA/master-data preservation is the current boundary.

## Application release

Deployment evidence will be added after the verified commit is live.
