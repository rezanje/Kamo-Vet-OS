# PO price and CRM promo selection verification

Scope: U01 in the new PO form and the item/branch selection portion of CRM U05. Based on main `102f3b0555305524611296e29d16affc12553eb7`; independent of PR86.

## Reproduced causes and changes

The numeric PO field immediately converted an empty editing value into numeric zero, so clearing or replacing the default value could reinsert zero during editing. The replacement keeps editing text separately while retaining finite numeric row payloads and existing server rules. Zero is blank on entry/refocus; clear, decimal input, paste, draft reload and failed submission are covered.

CRM promo rendered long checkbox lists and loaded only a single default-limited catalog response. The new control searches code/name, displays selected chips, distinguishes duplicate names by code, and preserves IDs outside the current filter. Bulk actions explicitly affect all matching results, including results beyond the initial 50 visible choices. Active catalogs load in stable pages through the existing complete-list helper; a 1,205-item fixture verifies the final page. Repeated hidden IDs preserve existing form payloads. Unavailable saved IDs remain visible and block native submission until reviewed.

The form now uses existing draft/failure recovery and acknowledges only the exact saved draft on successful server completion. Bounded review found that changing authenticated accounts without unmounting could retain old fields and selections. A regression reproduced that behavior before the form was keyed by account; switching back recovers the original account's draft.

## Browser evidence

Run `node scripts/test-po-price-crm-browser.mjs`. The harness renders the real POForm and CRM page/components with fictional catalogs and fake failing actions, allows only loopback requests, and captures the attached PNGs. It does not authenticate to or submit transactions against KAMO.

Both 390 and 1280 pixel viewports passed: typing/paste/clear/decimal/refocus, PO reload/failure recovery, CRM lookup beyond 1,000, filtered select/deselect-all, keyboard Enter/Escape without accidental submit, branch toggles preserving items, and CRM reload/failure recovery. Both reported no document overflow, no runtime errors, no external requests and no live transactions. Results are in `browser.json`.

## Scope and rollback

No migrations, database mutations, credentials, permissions, pricing validation or category policy changes. Empty versus zero retains existing PO rules. CRM targeting still uses the existing IDs and active/access filters. Full U05, clinic selectors, PO editing and live authenticated acceptance remain outside this batch. Drafts retain the existing browser storage/expiry limits. Reverting this code restores the previous UI without a schema rollback. PR86 remains at `cdc96ddb5e16d280618ba1cf5c016a1b9031cf58`; its separate release gate remains unchanged.

## Final checks

All checks passed on the final candidate code before commit:

- Focused final regressions: 5 files, 12 tests passed. The account-switch regression failed with retained `Owner draft` before the keyed-form fix, then passed including switch-back recovery.
- Full `npm test`: 315 files, 2,425 tests passed. This branch is based on main and deliberately does not include PR86's additional tests/code.
- `npx tsc --noEmit`: passed.
- ESLint on all changed TypeScript/TSX production and test files: passed.
- `npm run build` with loopback Supabase fixture URL and a fictional anon key: passed. Existing Supabase Edge Runtime `process.version` and webpack cache serialization warnings were emitted; no build failure.
- Browser script at both requested viewports: passed; see the fictional screenshots and JSON.
- `git diff --check`: passed.

One bounded independent review identified the account-switch issue described above; it was reproduced and fixed. No other Important/Critical finding was reported. No real authenticated application acceptance, live submission, migration, merge or deployment was run.
