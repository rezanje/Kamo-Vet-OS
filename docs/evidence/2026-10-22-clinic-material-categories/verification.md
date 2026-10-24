# K04 — clinic compound-material category consistency

Source feedback: checklist row 64, meeting Part 2 00:00:00–00:02:40, screen Klinik > Bahan baku klinik > Bahan Baku Racikan. Categories and subcategories should match the catalog; valid anesthesia/sedation candidates should be discoverable; removed categories should not linger as choices.

This candidate is independent of PR86 and PR87, based on main `102f3b0555305524611296e29d16affc12553eb7`. Changes are limited to the existing compound-material page loader, category filters and client snapshot state. The existing isolated worktree was switched to a new branch; the PR87 branch reference remains unchanged.

## Verified local causes

1. The page fetched eligible items once without pagination. A fictional selected inventory material at index 1,204 was absent from the real page. The existing catalog filters use category IDs and the master hierarchy, while this clinic page derived flat category names only from the truncated item results. Parent categories and categories without currently loaded candidates disappeared; equal names could merge unrelated branches.
2. The clinic query selected only the related category name, ignoring its active status and parent. Nonactive category names could become selectable choices. The replacement reads complete master categories and uses the existing `flatOptions`/`buildTree`/`labelPath` semantics for active choices and hierarchical labels.
3. `useState(items)` retained the initial list after refreshed item/category props. A regression reproduced old rows after reassignment/refresh. The new optimistic flags are scoped to the exact server snapshot, so refreshed data is authoritative and late rollback/messages from an older snapshot do not replace it.
4. Query errors became `data ?? []`, presenting an editable empty/partial list. The existing checked-list loader now verifies complete pages/counts/IDs and the page displays a retryable load error without material controls when either source is incomplete.

These are code/fixture reproductions, not a diagnosis of specific live rows. A category physically deleted through the existing master RPC cannot be proved to remain in the current database from this environment. Stale client snapshots and inactive category choices explain locally reproducible versions of the report; current target category IDs/statuses and item types remain unverified.

## Resulting behavior and preserved boundaries

The default still shows saved selected materials, including historical inactive/missing category associations. New category choices show active roots/subcategories by ID and omit inactive or missing ancestor branches. Choosing a parent resets the child/search; choosing a child filters that exact category. An invalidated parent falls back to saved materials. The all-items view keeps existing eligible inventory with uncategorized/legacy associations reachable; it offers no global bulk-add shortcut. Bulk changes remain limited to displayed category/search results.

Only active, nontrashed `Persediaan` items are loaded. `Jasa`, inactive items and trash are not promoted to clinical eligibility. An anesthesia/sedation catalog item of another type will require a separate explicit policy/data decision; this candidate does not reclassify it. No missing category is invented. Historical category IDs, saved flags, prices, stock, master actions and server authorization/RLS are not changed.

## Tests and browser evidence

Observed RED before implementation: loader omitted the selected material beyond 1,000 and failed to expose source errors (3 failures, role/anonymous cases passed); the client lacked master ID hierarchy selectors and retained stale rows (6 failures). Existing material filter tests passed before editing. Focused GREEN after implementation: 4 files, 31 tests, including 14 new cases.

New tests cover complete item and category catalogs, valid anesthesia/sedation inventory, unchanged anonymous/role gates, item/category load errors, active/inactive/deleted parents and children, duplicate child names, saved missing/inactive associations, switching parents, exact bulk IDs, failed optimistic rollback, refreshed rows, obsolete responses and empty catalogs. Existing shared category/filter tests remain green.

Run `node scripts/test-clinic-material-categories-browser.mjs`. It renders the real page/components with synthetic data and fake actions, including more than 1,000 items/categories. Only loopback requests are allowed. At 390px and 1280px it verified hierarchy/status/history, eligible sedation beyond the default page limit, keyboard select/Space, filtered bulk IDs, returned-error rollback, parent switching, empty/error states and no document overflow/runtime errors/external requests/live master writes. The narrow table retains its existing internal horizontal scroll; the two mobile screenshots show its left and action columns. No deployed authenticated acceptance is claimed.

A bounded independent review found no substantiated Critical/Important issue. Full verification results follow below.

## Full verification

All final checks passed on the stable candidate code before commit:

- `npm test`: 312 files, 2,427 tests passed, no failures.
- `npx tsc --noEmit`: passed.
- Scoped ESLint on all changed production/test TypeScript and the browser harness: passed with no warnings/errors.
- `npm run build` with loopback Supabase URL and a fictional anon key: passed. Build emitted existing warnings outside changed files, including Supabase Edge Runtime/cache warnings, image optimization warnings and existing unused variables; no build failure.
- Browser harness at 390px and 1280px: passed; see `browser.json` and the PNGs.
- `git diff --check`: passed.

No product code changed after these final checks. The candidate does not include PR86/PR87 code or tests, so full-suite file/test counts differ from those branches.

## Release limits and rollback

No migration, master mutation, reclassification, stock/journal write, security change, real clinical action, merge or manual deployment was performed. No live anesthesia/sedation record or category deletion has been inspected. Target acceptance remains required once an existing authorized preview/app session is available; prior preview access stopped at Vercel login.

Reverting this code restores the previous loader/filter UI and requires no database rollback. This change does not make the existing material bulk action atomic or change its transaction semantics. PR86 remains at `cdc96ddb5e16d280618ba1cf5c016a1b9031cf58`; PR87 remains at `b5bbb6344b82986de5c05fd46b0fc905f6dfe390`. Their release gates remain separate. U05 CRM and N01 are not included.
