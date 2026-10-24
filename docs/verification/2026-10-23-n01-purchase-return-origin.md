# N01 — preserve PO/return navigation context

The PO's existing related-document link supplied `from`, but the purchase return page discarded it. Return detail also did not link its stored `po_id`, and the safe-back-path validator rejected the existing purchase return route. Three new regression failures reproduced these breaks.

Retain the validated origin on the purchase return page, link the existing stored PO identity from purchase returns, and allow only the exact existing `/pembelian/retur/UUID` route in the contextual back-path whitelist. No invoice allocation, related document or route is guessed from a document number. Existing authentication/read-error guards and sales-return rendering remain unchanged.

Verification: 17 focused navigation/security cases passed; full application suite 353 files / 2691 tests passed; TypeScript, scoped lint, whitespace and bounded independent source review passed. Tests include external/executable URL rejection, query-injection rejection, original PO context, reverse return context, missing stored PO, signed-out access and failed reads. Exact pushed Vercel build is tracked separately; no extra local build was run for this small navigation batch. No migration, business mutation, accounting change or hosted UAT.

N01 global coverage remains partial; this specifically repairs PO/retur navigation. Rollback is a code revert with no source-data effect. Main release remains blocked by the existing automatic-review rejection on PR103, which was not retried or bypassed.
