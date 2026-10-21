# Existing clinical transaction correction verification

No replacement clinical posting path was added. The existing `clinic_edit_invoice` and `clinic_void_reissue_invoice` flows already support source-authorized corrections and paid-invoice reissue while preserving ledger, stock/HPP and transferred-payment history. Specialized medical-record and inpatient edits remain separate from the approved operational reset.

Source review covered the current clinical payment action, invoice/reissue forms and the production lifecycle migrations, including the later split-payment and demo-policy overrides. Existing SQL verifies unpaid editing, paid direct-edit rejection, journal reversal, repeated reissue, transferred money without duplicate receipts, stock/HPP alignment, branch isolation and retry behavior.

Verification against the current combined local schema:

- `python3 scripts/test-clinic-billing-native-postgres.py`: every production migration plus seven unchanged existing SQL acceptance suites passed: inpatient consent, demo financial policy, invoice posting, billing lifecycle, occupation selection, compound SKU binding and inpatient action categories.
- Twelve focused application test files / 97 tests passed: payment actions/forms, save-result handling, invoice/payment math, split payment, incentive policy/query and inpatient/consent behavior.

The native runner reuses the established full migration bootstrap and sanitized localhost environment. It creates and removes a unique owned database. Test-fixture profile setup uses the existing fixture-only privilege-guard helper; production functions, guards and acceptance assertions remain intact. It enables validation without requiring Docker; the existing Docker runner is unchanged.

These checks establish current local compatibility and avoid duplicating mature accounting behavior. They do not establish final authenticated production UI coverage, branch grant changes or production reset completion. The final release test/build and live acceptance gates remain open.
