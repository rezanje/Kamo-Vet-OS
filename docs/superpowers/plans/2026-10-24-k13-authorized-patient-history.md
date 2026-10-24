# K13 existing-grant clinical history plan

Approved scope: same authenticated session, same pet anchored to a currently accessible visit; clinical history across already-granted branches independent of operational selection. No new single-branch rights, persistent permission/RLS changes, financial history expansion, or PR135 retry.

Base main `b85d549fb5314931186d63054a1919e5092cdd34`; isolated branch `codex/k13-authorized-patient-history-20261024` reuses the clean worktree. Bundled Next docs remain absent in installed15.5.25; use current server patterns and build/types.

- [x] RED: server-reader regressions for two-branch access, single-branch denial, unrelated pet, inaccessible/stale anchor, session mismatch and failed/partial reads. UI tests ensure clinical details are read-only with no foreign operational/financial links.
- [x] Add private cookie-session client used only inside patient clinical reader, omitting operational selection but retaining original JWT/anon key and database RLS. Never export a generic unscoped client. Validate active identity and accessible current visit before reading; verify expected pet and matching session.
- [x] Read checked/paged visits for exact pet and clinical children by verified IDs. Exclude invoices/prices/payments. Keep existing operational client for financial, rawat-inap/racikan tabs and actions.
- [x] Render clinical source branch and inline read-only records/prescriptions; unknown/incomplete read is unavailable, not empty history. No guessed relation or write action.
- [ ] Focused tests and narrow review, then stable full tests/build/typecheck/scoped lint; normal PR/merge and exact Production verification if permitted.

Prior diagnosis: actual source uses one stable pet/owner ID in both reported branches, records persist; current header/function mechanism reproduced in six local synthetic SQL cases. Removing selection still denies an ungranted branch. This is not full hosted RLS/session acceptance. Single-branch shared-history policy remains pending.

Implementation evidence: five new page cases failed before implementation, two existing boundaries passed. Extended final set:59 focused tests /5 files and3,205 full tests /433 files passed; build/typecheck passed. Narrow source review of `2e98646` found no P1/P2. Final delivery removes only an unused helper and adds evidence; scoped checks rerun, exact-head hosted build required before merge.
