# U04 — master references and production choices

Base PR108 `8286584673fbd93ccb15218ce418f13f8456b0b0`, with PR103 and PR106 dependencies. Independent of PR105 therapy migration and PR111 clinical catalogue fix. Existing candidate heads unchanged. No main merge, target migration, deployment or retry of the denied PR103 merge.

## Proven code scope

- New/edit SKU form: category, brand, unit and supplier references now use complete exact-count pages and a unique ID tiebreaker. Categories retain inactive rows for existing hierarchy/status logic; brands, units and suppliers retain active-only filters. Active OWNER/ADMIN gate remains before these reads. Same session/RLS; no service client or permission expansion. Group/substitute item loaders were already complete and are unchanged.
- Production: permitted active inventory products, active recipe headers and active warehouse choices use complete checked pages. Product type/status, recipe ordering, warehouse visibility and exact hidden reference IDs remain existing. Late products still load their units through the existing helper. Failures/truncated pages stop the load rather than allowing actions against apparently empty or partial choices.
- No changes to create/update actions, production stock movements, quantities, unit conversion, cost, pricing, branch eligibility, schema, RPC, grants or authentication. Embedded recipe ingredient display and the existing last50 production-order history remain outside the completeness claim. This does not claim U04 globally complete or prove authenticated RLS integration.

## Executed evidence

- RED: **9 failures / 4 passes** before source fixes. Both metadata and production fixtures contained 1,205 rows; the old sources returned 1,000 and ignored later-page failures. [Summary](../evidence/2026-10-23-reference-catalogs/red-summary.log).
- GREEN: **28 tests / 5 files passed**, including complete metadata/production choices, active/status/type filtering, late units, failed/truncated pages, current role/status guards, unavailable master reference preservation, duplicate IDs and group units/quantities. Existing 6,001-component coverage retained. [Focused log](../evidence/2026-10-23-reference-catalogs/focused.log).
- Independent reviewer ran **28 tests / 5 files**, no P1/P2 findings; filters, ordering, types, current active OWNER/ADMIN guard and unchanged actions verified.
- Final build, scoped lint and separate post-build typecheck recorded with this batch. No repeated full suite, live writes, new workflow simulations or browser UAT.

Release after PR103/106/108 through parent release lane. No migration step. Rollback by source revert. Pushed/ready/preview remains distinct from main/deployed/UAT.

## Remaining menu inventory delta

The detailed matrix is in PR111 `docs/verification/2026-10-23-clinic-catalog-completeness.md`. This candidate closes its two actionable rows: production choice sources and SKU metadata sources. It does not repeatedly change already-correct selector visuals.

Still actionable within the UI/catalogue lane: cashier receiving parent-check ordering and separately checked request children, cashier request stock hints, existing quest product choices. Price-list broad-result pagination and commission catalogues overlap the finance/master-pricing lane; purchasing PO/direct-invoice and minimum-stock reorder remain the purchasing lane's handoff. Embedded variant members and production ingredients are explicitly unproven at large scale. Historical free-text invoice/prescription snapshots are not heuristically rewritten. U03/U04/U05 stay globally partial; K01/K09 policy questions are already with the user, and other clinical/CRM policy decisions remain as documented in PR111.
