# Public login information and issuing-branch print headings

Base: `0909a575cea47f7bf8be68f047370e4b437e08dc`.
Request: Andri asks whether demo role/account information was removed from login and requests invoice/receipt headings use their issuing branch rather than the generic brand.

## Scope
- Delete the public demo-account table, shared-password hints and their definitions from `src/app/login/page.tsx`; retain original login form/action/error escaping/admin help.
- No account credentials, login emails, roles, status, HRIS linkage or authentication actions change. Removing a hint is not password rotation; centrally changing email/reset remains a separately authorized capability.
- Seven existing outputs use the document-linked branch name, then branch code if blank, otherwise explicit missing-branch text: cashier58mm, backofficePOS80mm, clinicalA4invoice, clinical80mmreceipt, groupreceipt, inpatientreceipt, wholesale detail/browser-print output.
- Sales/wholesale/receipts use their own stored branch relation. Clinical invoices have no direct branch_id: their exact invoice→visit→branch relation supplies the heading, not the active selector or independent context-visit read. No new snapshot columns or schemas.
- Supplier purchase identity, tax/legal data, document numbers, values/discounts/payments and all business writers remain unchanged. No SQL migration or live data mutation.

## Tests and review
- Login renderer/source tests were observed RED before removing hints/definitions, then GREEN. Original form and escaped errors remain exercised. Credential values are not reproduced in reports or used to log in.
- Seven sequential print-page RED→GREEN cycles and real-page render tests cover branch names/codes, object/array relations, selected-context/visit-context mismatch, numbers/customer/totals and tax.
- Independent review found a group-receipt query-error/partial-read fallback. Eight RED cases reproduced misleading printable output; a third context added exact deduplicated requested-invoice-set validation. Errors, null/empty/partial/unexpected/duplicate reads withhold printing; only genuinely zero requested invoices may use context-visit fallback. A confirmed invoice with null branch retains explicit missing-branch text.
- Final gate/review totals and source hashes live in `/opt/data/kamo-login-branch-print-evidence`, not inferred from intermediate logs. Focused test totals overlap fullsuite and are never added.
- Read-only live metadata proves each newly embedded invoice→visit→branch and wholesale→branch relationship is singular; no ambiguity introduced. All23 existing branches have distinct nonblank names at check time.

## Delivery and limitations
Ship only the staged read-only presentation changes through required Technical checks and a normal protected PR, then confirm Production READY/alias and public login HTML. Read canonical login and cache-busted login, assert old hints and old comparison values absent without printing/using them, and verify inputs remain.

Exact merged print-source provenance is not authenticated printer acceptance. Physical58/80mm/A4 printing and real-user UAT remain unverified unless separately recorded. Wholesale has no new dedicated print workflow; its existing detail output was updated. Clinical branch labels follow the saved visit relation/current branch master, not an independently frozen historical invoice-name snapshot.

No user credentials, live patients, customers, transactions, stock, totals or account access are changed to produce QA evidence.
