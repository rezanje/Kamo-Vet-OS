# Unified compound editor

Approved meeting scope: requirements 10–12 in docs/superpowers/specs/2026-10-05-clinic-feedback-design.md. User authorized implementation and staged production releases.

Goal: one editor selects a finished-medicine master SKU/name/selling price, then composition. Composition consumes ingredients; the finished SKU is not consumed for a freshly prepared compound. Imported ready-made SKU stock remains available through an explicit “Ambil stok obat jadi” button in the same editor. Never infer ingredients from imported SKU names.

Preserve official immutable formula revisions and existing custom OWNER/ADMIN restrictions. One issued recipe still represents one result, matching current posting invariants; do not introduce variable batch outputs. Custom composition keeps existing patient-specific rules. Official recipes retain their original name/formula/pricing snapshots; a separate immutable sale snapshot supplies the selected SKU name and authoritative branch/base selling price to the prescription during creation. This avoids changing official snapshots or ingredient-cost history. Older drafts/API payloads without SKU binding continue through existing RPCs.

- [x] Add master sale snapshot table/RLS and atomic issue wrapper; link prescription name/price at insertion before official usage is frozen. Keep item_id null for new compounds to prevent double stock issue.
- [x] Extend existing atomic medical/inpatient compound loops to call new wrapper when sale_item_id is present; preserve legacy and retry behavior.
- [x] Shared editor in initial exam, inpatient notes, and saved-record inline flow; searchable SKU/material choices, material stock/units without prices, one chosen master item and one compound cart row. Recover selection in existing drafts.
- [x] Validate master price authority, old snapshots, rollback/retry, ingredient stock, official/custom roles, invoice/receipt name-only printing and absence of double stock issues using isolated local PostgreSQL engine and fictional data.
- [x] Run browser, full tests, TypeScript, lint, production build, fresh review. Migration and production smoke remain pending until release below.

Local PostgreSQL engine is adapted PGlite; concurrent sessions/full Supabase runtime remain outside verification. No production business transactions for testing.

Verification: 156 files / 1,433 tests passed; TypeScript, targeted lint (three existing image warnings), production build, shared editor/browser draft regression passed. Isolated SQL suite covers branch master price/name authority, immutable invoice price with separate discount, active role checks, official doctor permissions, custom restrictions, full initial/inpatient rollback, stable retries, FIFO HPP and balanced journals without double stock deduction. Fresh reviewer found one price-authority gap at invoice posting; reproduced RED, fixed with database trigger and read-only cashier price, then SQL GREEN. No production business transactions used for tests.
