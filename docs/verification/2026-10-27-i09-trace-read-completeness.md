# I09: racikan trace links and fail-closed source reads (partial)

Base: main `4a36212` (includes PR #251). Branch: `claude/zen-euler-slxuo1`.
Ownership check: PRs #160/#161/#211 merged; open draft #224 (production FIFO genealogy, awaiting security
approval, idle since 2026-10-26) shares the racikan detail file but not the regions changed here.

## Findings against the bounded acceptance

| Case | Before | After |
| --- | --- | --- |
| Valid sale → visit → invoice → ingredient | Parent SKU, visit and invoice already linked by stored IDs. Ingredient link opened the stock card for the **current month**, so a racikan saved earlier did not show its `racik` movement. | Ingredient link carries `dari=<recipe saved date, UTC>`; the issue movement (same transaction, `tanggal = current_date`) is in range. |
| Same-name distinct records | Material links used item IDs; sibling racikan with the same name could not be opened. | Sibling racikan link to their own recipe ID; each ingredient link uses its own recipe date. |
| Missing/deleted visit or record | No parent, visit or invoice link (already correct). | Unchanged; now regression-tested. |
| Wrong branch (row hidden by RLS) | Not found (already correct). | Unchanged; regression-tested. |
| Recipe read error | Shown as "not found". | Error is raised; never presented as a deleted document. |
| Composition read error | Empty table, as if the racikan had no ingredients. | Alert, no rows, no ledger links. |
| Stock card read error | Error ignored: balance 0 and "Tidak ada mutasi". | Alert only; no balances, no empty-ledger claim. |
| Stock card > 1,000 movements | Unpaged reads stop at the API row cap, so opening balance, per-warehouse balance and the movement list could be silently incomplete. | All three reads use `readCompleteList` (count-verified pages, ordered by unique ID). |
| Stock card for an inactive/missing material | Silent empty picker. | Explicit notice that the linked material is not available. |

No migration, RLS/ACL, permission, stock posting, costing, pricing or clinical form/composition change. No
virtual parent stock or synthesized movement is created.

## Verification (fictional fixtures only)

- RED: 4/7 new racikan trace tests and 5/5 new stock card tests failed on the base code.
- GREEN: focused 27/27; full Vitest 3,724 passed / 1 skipped (512 files).
- `npx tsc --noEmit`, scoped ESLint (0 errors; existing `<img>` warning), production build with fictional
  public Supabase configuration: pass.

## Remaining (I09 stays partial)

- The trace shows the material ledger for the recipe's material, not the private per-recipe issue rows
  (`compound_issues` is not readable by app users); exact FIFO/production origin is draft PR #224 and needs
  security approval.
- Stock card completeness now pages through every movement; very high-volume items load more slowly. A
  server-side balance aggregate would need a migration and is not included.
- Legacy racikan without a stored selling binding stay unlinked (not reconstructed from names).
- Meaning of virtual nonstock in/out movements is a business decision; none are synthesized.
- Field UAT, preview and production verification not performed.
