# C05 follow-up: transaction voucher usage limit

Source: supplied Checklist C05, CSV gid 831947777, read 26 October 2026. This branch starts from `origin/main` at `bd3f06c`, separate from voucher paging draft PR #218.

The existing voucher code is a transaction-level discount in POS and clinic checkout. This change adds an **optional maximum number of documents bearing that code**. Null preserves every existing voucher and checkout. A POS sale or clinical invoice bearing the code consumes one use when the document is written; a later void does not restore that use. This is stated in the configuration form. Both channels count against the same cap. The same document retaining its code during an update does not consume a second use. The existing discount formula, target customer/category, date and stacking rules are unchanged.

An isolated database trigger locks the voucher row, counts existing POS and clinic documents and rejects the next document at the configured cap. The cap field is restricted to OWNER/ADMIN at the database boundary as well as the existing voucher server action. This prevents parallel checkouts from exceeding the cap and prevents ordinary authenticated API clients from changing the cap. The failure is explained to the POS/clinic operator.

## Security migration approval gate

`20261026001920_c05_voucher_usage_limit.sql` adds `vouchers.max_uses`, one manager-only field guard and one SECURITY DEFINER usage guard attached to `sales` and `invoices`. Trigger function direct EXECUTE is revoked. **Do not apply to Production until the integrator receives explicit approval of this scope and verifies migration ordering and current privileges.** No production DB, role, RLS or deployment change was made by this worker. Apply the migration before deploying the application reader/writer; rollback requires coordinated app revert first, then migration rollback review. Existing vouchers default to null and are not backfilled.

## Remaining C05 boundary

This does not bind a product-targeted promotion to a campaign code. Product promotions and transaction vouchers still have separate calculations. The UI explains the distinction. A rule for whether a code triggers the linked product promo, replaces an automatic promo or uses voucher value on eligible products must be chosen before combining them. Group checkout counting, source reissue and void semantics also need review against a representative intended campaign; the cap defined here counts one stored document, including voided ones. Full authenticated transaction/UAT is deferred. C05 overall remains partial.
