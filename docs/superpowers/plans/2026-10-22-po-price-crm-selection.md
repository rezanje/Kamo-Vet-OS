# U01 and CRM U05 UI feedback batch

Authorized inline implementation on a separate branch from main `102f3b0`. PR86 remains unchanged. No migrations, financial policy, clinic selectors or promo category policy.

- Reproduce PO price zero reinsertion using the real POForm. Keep temporary editing text separate from the finite numeric row payload. Empty still submits zero under existing rules; retain unit autofill and purchase draft recovery. Test clear, typing, paste, decimals, blur/refocus, reload and transport failure.
- Replace CRM promo item/branch checkbox lists with a compact searchable multiselect using the existing repeated `item_ids`/`branch_ids` contract. Preserve selections across filters and selectors, distinguish duplicate labels by code, and restrict bulk actions to matching results. Reuse the complete-list loader with active/RLS predicates and stable pagination. No item category selector exists here; do not add one.
- Reuse LocalTransactionDraft/PreservedForm for account-scoped recovery and exact success acknowledgement. Keep unavailable draft selections visible and block submission until explicitly reviewed. Key the whole form by account so retained UI state cannot become another account's draft.
- Write failing real component regressions before implementation. Iterate with focused tests, obtain one bounded review, then run full tests, typecheck, scoped lint and build. Use loopback Chromium with fictional data at 390 and 1280 pixels for screenshots, keyboard and overflow checks. No live submission.
- Push normally and create one candidate PR; stop before merge/deploy. This CRM slice does not complete all of U05.
