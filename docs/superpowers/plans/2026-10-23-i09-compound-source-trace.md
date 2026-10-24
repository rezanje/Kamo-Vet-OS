# I09 stored compound source trace — implementation plan

> Use superpowers:executing-plans in this isolated branch; no new implementer lane.

Goal: from existing protected compound reports, open the stored selling parent, recipe, consumed material and exact invoice, without inventing virtual stock or changing accounting.

Files: `hpp-reports-server.ts` (captured parent enrichment), `hpp-reports-export.ts`/`HppReportPage.tsx` (optional per-cell source links), clinic invoice page (explicit stored invoice selector), focused regression fixtures and verification note.

Constraints: separate from PR128/129/130 and denied N01 resolver, no migration/target writes/ACL changes. Keep current report OWNER/FINANCE/module/branch checks. Use `clinic_compound_sales.recipe_id/sale_item_id/visit_id` snapshots only; do not infer parents from names or current formula bindings. Missing legacy binding stays unlinked. Mismatched or unreadable binding fails closed. Keep all financial calculations/CSV cells and physical stock untouched.

- [x] RED: report has stored parent ID but no source link; exact invoice query is ignored by print page and may open a newer invoice for the same visit.
- [x] Enrich only exact visible recipe IDs in checked 100-ID batches; verify binding visit matches invoice. No new financial/medical fields exposed.
- [x] Link stored parent/recipe/material IDs and invoice+visit IDs in existing report views, preserving filters, pagination and plain exported values.
- [x] Explicit invoice ID must match both ID and visit and remain active under existing print-page rules; malformed/missing/voided/foreign source never falls back to the current invoice. Keep unparameterized current-print behavior. Query errors stop printing.
- [x] Focused source/auth/branch/legacy/mismatch/error/page/pagination tests and narrow review. Final candidate verification is recorded separately; no full user simulation. I09 remains partial for full history, production-job genealogy and undefined virtual in/out semantics.
