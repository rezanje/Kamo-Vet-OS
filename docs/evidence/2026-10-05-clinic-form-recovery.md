# Clinic medicine completeness and form recovery — 5 October 2026

This change builds on PR #25's compound master-SKU fix. It does not modify clinic SQL, production records, HPP reports, or SKU masters.

## Findings and changes

- Initial exams fetched only 400 active master items; inpatient notes fetched 200. Both now use the existing checked, counted, stable-ID pagination helper, failing visibly if a complete source cannot be verified. Enrichment remains the PR #25 batched branch-stock/unit/price loader.
- Ordinary medicine search results stopped at 40 visible rows. Both pickers now expose previous/next pages and matching counts.
- Inpatient's ordinary picker also included raw compound ingredients and services. It now separates them from ordinary medicines while retaining the ingredient-builder source.
- Printed prescriptions omitted the chosen unit. They now render quantity and saved unit, such as `2 btl`.
- Error redirects remounted empty React state and native fields; inpatient errors also navigated away from the note editor. Both forms now keep session-only drafts scoped to the actual signed-in server user, encounter, and form type. The original RPC request key survives recovery. Drafts expire after 12 hours, can be discarded, and clear only after the server confirms its atomic save.
- Recovery includes submitted clinical/native fields, prescription cart and unit/price/factor, compound builder state, added follow-up rows, and already-uploaded document/photo references. Raw file bytes and browser blob-preview URLs are not persisted.
- Transport failures display a retry message while retaining inputs. React's automatic native reset is cancelled until success or explicit discard.
- Existing recorded-visit form gating and SQL posting/idempotency guards are retained. Successful actions invalidate the relevant clinic pages before returning their navigation destination, including the same-page initial-record flow.

## Verification

- Regression tests first reproduced the 400/200 item limits, missing printed unit, old success/error action contract, raw-material inclusion, and failed reload recovery.
- `npm test`: 144 files, 1,326 tests passed.
- `npx tsc --noEmit`: passed.
- Changed-file ESLint: no errors; three existing warnings (two inpatient image warnings and the uploader's unused destructured variable).
- `node scripts/test-clinic-draft-browser.mjs`: real React forms in a loopback Vite fixture passed both forms' ordinary pagination, unit/factor/price, reload, failed-save redirect, network failure, original request key, account isolation, discard, confirmed-success cleanup, added follow-ups, multi-file uploaded references, inpatient photo reference, expiry, malformed storage, and disabled storage. External requests are blocked. No production mutations.
- Independent read-only code review found no remaining critical/important issues after page invalidation was added.

The browser fixture replaces the server-action and storage boundaries; it does not prove a deployed Next server-action transport round trip or production SQL behavior. Parent integration performs the aggregate Next build and production read-only smoke checks.
