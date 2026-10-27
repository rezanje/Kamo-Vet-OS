# I09: stored racikan source navigation

The checklist asks for a trace from a nonstock racikan parent through its recipe, physical ingredients, source document and sale. Existing invoice and margin-report links covered part of this path. On the recipe detail page, the saved selling SKU was not visible and physical ingredients had no stock-card link. In the stock card, a `racik` movement displayed its recipe UUID as plain text.

This candidate adds read-only links from the recipe detail to its stored selling SKU, medical-record visit, and ingredient stock cards. A `racik` movement with a valid recipe UUID links back to that recipe. The selling SKU is explicitly described as nonstock. Its identity comes only from `clinic_compound_sales` and must match both recipe and visit. A missing, mismatched or unreadable binding is not guessed from names.

No stock quantities, financial postings, RLS/ACLs, migration or production data are changed. Existing access checks still apply at each linked page.

Technical evidence uses fictional fixtures: recipe link/identity/error cases and stock-card source navigation, plus existing source-trace regressions. Full I09 remains partial because the complete production-job genealogy, historical legacy binding reconstruction and virtual in/out accounting semantics are not established here. Field UAT is deferred.
