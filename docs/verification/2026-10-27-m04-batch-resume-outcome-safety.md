# M04: saved batch stays reachable when its read-back fails

Status: partial M04 code fix. Field UAT and the original file's reconciliation remain open.

## Gap reproduced

The prepare step for initial stock is idempotent by source hash and returns a persisted batch ID. The action then reads that batch back. If the read failed (timeout, transient RLS or network error), the action returned `ok: false` with `run_id: null`. The browser showed a plain failure even though a batch existed, and the URL did not point to it, so a reload or a later visit had no direct way back to that batch. PR212 had already fixed the same problem for the optional scope-mapping write. This change covers the read-back failure.

Saved batch lists on the import page and in Persediaan Awal showed the raw database status (`previewed`, `posted`). Users could not tell from the list that a prepared batch was not yet stock or GL.

## Change

- `previewSaldoAwalAccurate`: if the read-back fails after preparation, the action returns the batch ID with `ok: false`. The message says the batch is saved, its rows could not be read, and its posting status is not yet confirmed. An identical file and scope can resolve to a batch that is already posted, so the message does not say "not posted".
- The one-click stage list says review waits for the batch to be readable and that posting is unconfirmed. Master-only ("stok nanti") is no longer offered once a batch is saved, so it cannot relabel that batch as not imported.
- If recovery fails again after reload, the alert names the batch and says not to prepare the file again until the batch can be read.
- Stock-only flow and master one-click flow: whenever a batch ID is returned, the URL is replaced with `?run_id=`, so a reload reopens that exact batch through the existing owner-scoped recovery. In this unreadable case the UI shows "Buka batch tersimpan" (reopen) and does not show the posting-review link. The review link now requires `ok: true`.
- Saved batch list and OWNER posting selector use plain stage labels: prepared and awaiting OWNER review (stock and journal not posted), stock posted, failed, or unknown status. The batch list also states that the browser file is not persisted: only a prepared batch can be reopened after navigation or reload.

No migration, RPC, posting, valuation/rounding, date, permission, master-data, cashier, clinical or payroll change.

## Acceptance coverage (synthetic fixtures only)

| Requirement | Test |
|---|---|
| Ambiguous prepare (saved, read fails) keeps batch ID, makes no posting claim | `initial-stock-scope-recovery.test.ts` (red before, green after) |
| Optional mapping failure still returns prepared batch (PR212) | same file, existing |
| Reload after ambiguous result reopens same batch, no review/posting link (stock-only) | `stock-only-import.test.tsx` (red before) |
| Same for master one-click flow; stage list unconfirmed; no master-only relabel | `accurate-import-continuation.test.tsx` (red before; skip gate mutation-checked) |
| Navigate away/back reopens saved batch with stage label, no re-preparation | `InventoryImportWorkspace.test.tsx` (red before) |
| Posted vs prepared distinguished on recovery; failed recovery shows alert, no review link | `InventoryImportWorkspace.test.tsx` |
| Double click: prepare, Import Sekali, OWNER posting → one request each | `stock-only-import.test.tsx` (existing), `accurate-import-continuation.test.tsx`, `accurate-inventory-accounting-form.test.tsx` |
| Ambiguous posting resolved by reading saved receipt, not re-posting | `accurate-inventory-accounting-form.test.tsx` |
| Exact retry of the same posting request after lost response | `accurate-inventory-accounting-form.test.tsx`, existing; server returns the prior receipt for an identical request |
| Decimal fixture: exact quantity, source value, rounding delta before posting | `stock-only-import.test.tsx`, `initial-stock-decimal-recovery.test.ts`, `accurate-inventory-import-review-link.test.tsx`, existing |
| Preview / master save distinguished from posted result | `accurate-import-continuation.test.tsx` (stage list), `InventoryImportWorkspace.test.tsx` |

New tests that pass before the change (double click on Import Sekali and posting, ambiguous posting resolved through the receipt) lock in existing behaviour. They do not reproduce a bug.

An independent review of the first push found that the wording could claim "not posted" for a batch already posted, and that the checklist could call an unreadable batch ready for review. Both are fixed above, together with two smaller findings: master-only relabel and the unnamed batch after a failed reload.

## Not covered

- Field UAT by OWNER/ADMIN on the real browser and database. A synthetic DB posting path exists (`m04-technical-e2e.test.ts`), but no browser-to-database run.
- The original customer file's authoritative cutoff date, control totals and stock/GL reconciliation (see `2026-10-26-m04-prepared-batch-recovery.md`).
- A browser file cannot survive reload by design. After a reload, an unprepared file must be selected again.
