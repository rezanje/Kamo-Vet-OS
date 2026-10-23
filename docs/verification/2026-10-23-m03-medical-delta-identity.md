# M03 — preserve identity and history during medical delta imports

## Verified cause

The preview normalized punctuation/whitespace in owner and pet names, but both save routes discarded unique matched IDs. The unchanged SQL fallback uses stricter spelling. A synthetic owner whose name differs only by punctuation therefore appeared matched in preview but was duplicated at import. The batch route also trusted a missing/stale clarification decision without rechecking current identities, and same-owner same-name pets could be picked arbitrarily.

Four action regressions failed on the previous code. Separate RED/GREEN checks protected skip decisions, already-imported receipt recovery and distinguishable same-name patient options, including whitespace variants. The original file-confirmation route is covered using a synthetic generated workbook, not a customer file.

## Change

Use one normalized unique identity match for preview and save, carry its exact customer/pet IDs into the existing RPC, and revalidate ambiguous decisions before writing new rows. Same-name pets require an explicit current choice; duplicate-looking options show stable references. Identity metadata and existing source keys use stable, counted pagination. Already imported sources recover before changed identity decisions; explicit skips remain skips.

The existing RPC still appends visits and medical records; no update/overwrite path or migration was introduced. Same-phone/different-owner cases still require clarification. New phone equivalence, cross-owner automatic merging, arbitrary historical deduplication, source-key redesign and cutover operations are outside this batch. Truly indistinguishable records still require the user to inspect the stable references and choose or skip; the app never guesses.

## Verification

- 38 focused parser/action/component cases passed, including original workbook confirmation and metadata beyond 1000 owners.
- Full stable application suite: 354 files / 2696 tests passed. An earlier full run caught the option-whitespace regression while review was ongoing; it was fixed and the final full run is green.
- TypeScript and scoped lint passed. Local production build passed before the final one-line option-comparison refinement; exact pushed Vercel build is checked separately.
- PostgreSQL 17.6 owned network-none runner applied 237 repository migrations using synthetic auth/storage shims. The actual unchanged RPC reproduced null-mapping owner duplication, then verified mapped delta append, original/new notes unchanged, same-source retry without duplication, correct owner/pet links, and wrong-owner-pet rejection with no partial visit.
- Independent bounded source review: duplicate option-label issues resolved; no remaining important blocker.

The isolated full repository baseline is not a claim of target schema equivalence or hosted UAT. No target transactions, migration or permission changes were performed. Run `python scripts/test-medical-delta-postgres.py` with cached `postgres:17.6`; it removes only its owned disposable container/volumes. Rollback is a code revert, without deleting imported history.
