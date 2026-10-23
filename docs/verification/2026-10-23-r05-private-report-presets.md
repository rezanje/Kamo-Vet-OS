# R05 partial — private browser report configurations

## Existing gap and bounded candidate

Reports exposed GET filters but no save/reopen configuration list. This candidate adds a named configuration list to the shared report wrapper and the Laporan landing page. It stores only approved report filter parameters, not report rows, in browser localStorage namespaced by logged-in account. Links reopen the original report with its normal server/middleware authorization; a saved link does not confer access. No database, credentials, permissions or report calculation changed.

Saved defaults come from the server-rendered input/select/textarea props, supplemented by URL parameters for custom controls. Dirty browser edits are not considered applied. An independent review reproduced stale uncontrolled form values after navigation; the DOM/FormData approach was replaced by server defaults and an omitted/reset-parameter regression. Date/month, branch, doctor, search and existing detail-mode parameters are retained; pagination and mutation/acknowledgement/error parameters are excluded. Repeated branch values remain repeated. New column/grouping controls are not invented.

Paths are an explicit internal report allowlist. External/executable/download/non-report destinations, invalid stored data, duplicate IDs and excessive data are rejected. Storage failures never claim success or overwrite unreadable configuration data. Save/delete reread the account's store to avoid dropping other configurations. Each browser/account supports at most 50 named configurations; deletion affects only the chosen preference. Browser-local storage is user convenience, not a confidentiality or authorization boundary against someone controlling that browser.

## Verification

- Missing-feature tests initially failed before implementation.
- 39 focused tests across six files passed, including ten new cases for filters, default capture, account isolation, reset/navigation, reload, corrupt/unavailable storage and safe destinations; existing HPP/payment/operational report regressions passed.
- TypeScript and scoped ESLint passed.
- One production build with fictional Supabase environment values passed; only existing unrelated image/unused-variable warnings. No repeated full-app suite for this bounded preference UI.
- Narrow independent review's stale-filter P2 was fixed and re-review found no remaining blocker.

No authenticated hosted simulation or visual mobile-browser check was performed. Controls wrap and input width is capped by its container, but this is source-level evidence rather than a screenshot claim. Build/preview status in PR identifies the exact tested head.

## Remaining scope and release

**R05 remains partial.** Configurations are private to this account/browser; they do not sync across browsers or share with other users. Existing report filter/detail parameters are saved; reports without column/grouping selection do not gain those features. Custom controls not represented by standard server filter elements are preserved only when present in the URL. Reports outside the shared Laporan wrapper are outside this candidate.

No migration. Main/deploy was not attempted because the previous PR103 automatic-review release denial remains unresolved. Source base main is `e46f45e97ae2500b3aaade5e8a9e50915f9fcca3`. Rollback removes the UI without altering transactions; versioned browser preference records may remain harmlessly stored.
