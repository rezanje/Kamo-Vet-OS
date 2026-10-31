# Pemindahan Barang — cetak/simpan PDF 2 atau 3 rangkap

## Scope
Andri clarified that this is delivery to the company's own shops from Pemindahan Barang, not a sale. Output must contain 2 or 3 copies of the SAME saved shipment, not another transfer, invoice, receivable or stock issue.

Worktree `/opt/data/kamo-wt-transfer-document-copies`, branch `hermes/transfer-document-copies`, base `2e92f5cdf897ce85c2044d1c52c307f18718fc0e`. Other workers' application worktrees are not edited. Dependencies are a separate writable copy, not a symlink into a parent.

## Implemented behavior
- Existing saved **Kirim Barang** detail gains **Cetak / Simpan PDF** linking to `/pos/pemindahan/[id]/cetak`.
- The read-only print route defaults to three copies: Gudang, Pengantar, Toko. Select two copies for Gudang and Toko. Changing the selector is GET-only.
- Each copy retains the saved document number/date, source/destination, item code/name, original selected quantity/unit, and base-unit equivalent when applicable. Legacy rows without selected quantity print the base quantity in its base unit, not mislabeled boxes.
- Blank signature spaces for sender, carrier and recipient. No fabricated signatures or new document numbers. This is explicitly not a sales invoice and contains no price/HPP query or monetary total.
- A4 layout, page break before each copy, repeated table headings on long documents. Each cancelled copy is prominently marked DIBATALKAN / not an active delivery proof.
- The PDF already contains the selected copies; the screen instructs one printer/PDF-dialog copy to avoid multiplying them.
- Existing authenticated Supabase client and RLS are reused. Missing/inaccessible shipments, receiving-only records, failed or incomplete item reads do not print. Checked pagination rejects incomplete/duplicate lists; no stock/money/clinical writer or schema/ACL is changed.

## TDD and local verification
Evidence folder: `/opt/data/kamo-transfer-print-evidence/`.
- Preserved original REDs: entry, missing print route, two-copy selection, item relation array, cancelled output, failed item read and incomplete/invalid line output. Each slice went GREEN before proceeding.
- Tests exercise actual original detail + new server page, with explicit Next/Supabase transport doubles. Mutation/RPC methods in the print fixture throw. This is not native PG/PostgREST/Auth proof.
- Final frozen-source verification: full regression 5750 passed, 0 failed, 10 skipped; full TypeScript, changed-file ESLint and production Next build all exited 0. Before/after hashes for all five code/test files are identical (`final-local-checks.json`). The 31 focused tests are included in the full count.
- Real Chromium printed four fictional fixtures from actual rendered page markup + matching stylesheet: 2-copy short = 2 A4 pages; 3-copy short = 3 pages; 3-copy 100-item long = 15 pages; cancelled = 3 pages. Last item survives all long copies, original number repeats exactly per copy, no print controls appear in PDFs. `pdf-verification.json` has hashes. Short and final long-page images were visually inspected for clipping/overlap.
- Initial fixture generation omitted CSS-module mapping because the test CSS proxy had no enumerable entries. Its unstyled PDFs/HTML are retained under `pre-css-fixture-fix/`, not counted as passing layout proofs. A failing fixture assertion was added, fixed by mapping actual CSS selectors to module names, then PDF generation was repeated with computed-font verification.

## Quantity-fidelity review follow-up
The first independent review found a P2 quantity-fidelity defect: six-decimal formatting could round a valid small stored quantity to zero. The original table and posting source permit more precision. Five rendered cases were reproduced RED, then a separate fix agent changed only the print page: `qty::text` and `selected_qty::text` preserve the database decimal through PostgREST; `decimal.js` validates positive finite values and emits plain decimal-comma text with no decimal-place cap or JS Number conversion of quantities. Legacy base-unit behavior remains.

Current print-page SHA-256: `cd63a76cc8b3d7de72f0cf60f22114a221638592820e70b1d2cc5f44fd732b28`. Parent focused verification after extra read/auth/cancellation regressions: 31 passed, 0 failed, 0 skipped. Independent closure found no remaining security concerns or logic errors for these exact production hashes; the parent verified the hashes. This closes the specific local blocker, not release/UAT gates. The earlier full-suite pass is preserved under `review-round-1/` and does not certify these corrected bytes; the old in-flight build was deliberately stopped (143), not counted as a successful build. Final full-suite/types/lint/build runs are captured separately in `final-local-checks.json` and `final-*` logs.

Final fictional PDFs have also been regenerated with the same shared AppLayout wrapper classes and real global print CSS; synthetic sidebar/topbar/tabs are verified absent from PDFs. This exercises shared layout styles, not an authenticated application session. A single oversized browser transport message failed while adding global CSS; document HTML was subsequently written in bounded chunks and all four fixtures were regenerated and reverified.

Text-cast syntax is documented by PostgREST (https://docs.postgrest.org/en/v10/api.html#casting-columns). A direct anonymous zero-row projection probe was not executed because the published/public client key was not available; no service-role or user credentials were obtained to bypass this boundary. Hosted authenticated query/route UAT remains unverified.

## Release status and boundaries
LOCAL VERIFIED, NOT LIVE at checkpoint creation. Independent staged-diff finding closure and all final local gates are complete. Publication, required CI and release remain separate; their outcomes belong in the PR and final external evidence rather than a self-claimed approval. No production stock or sale was created to test printing. No authenticated browser UAT or physical printer was available; renderer proof uses fictional data, not a user's actual transfer. No reset, login/email/password modification, or permission expansion is included.

Remaining delivery gates: normal commit, normal PR/required CI, serialized integration, Production READY + alias readback, then user acceptance of an existing authorized shipment. Existing queue/reset ownership must remain separate.
