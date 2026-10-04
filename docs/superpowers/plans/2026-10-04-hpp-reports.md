# HPP reports implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; no additional agents. User authorized implementation and OWNER/FINANCE access.

**Goal:** Current FIFO valuation/reconciliation and historical compound billed-sales profitability with complete CSV exports.

**Architecture:** Pure calculations in `src/lib/hpp-reports.ts`; authenticated scope and paginated collectors in `src/lib/hpp-reports-server.ts`; shared server report renderer and CSV handler used by two thin routes. Existing authenticated Supabase client, module rules and branch RPC.

**Tech Stack:** Next.js 15, TypeScript, Supabase, Vitest, existing CSV exporter.

**Spec:** `docs/superpowers/specs/2026-10-04-hpp-reports-design.md`

## Global constraints

- Active OWNER/FINANCE only, preserve role_modules and private ledger grants.
- Read only; no production migrations/backfill/deployment or dependency changes.
- Current inventory only; posted total HPP only; disclose partial cost coverage.

## Review focus

- Inactive holdings and hidden historical formula metadata must not disappear.
- Duplicate names never substitute explicit recipe/version identity.
- Missing HPP must not create fictitious profit.
- Failed, capped or denied reads must not expose partial financial rows.
- HTML pagination and CSV retain identical filters and full-set totals.

### Task 1: Dashboard mapping correction

- [x] Extend `operation-sales-server.test.ts` fixture layers, assert collector value for fractional quantities at two costs; run red (0 instead of 900).
- [x] Map snake-case source layers to camel-case `stockValue` interface; run green and commit separately (`ecaa391`).

### Task 2: Report calculations and server boundary

Files: create `hpp-reports.ts`, `hpp-reports-server.ts` and focused tests.
Interfaces: `valueInventory(stock, layers)`, `compoundSales(lines)`, `reportScope(client, path, branch)`, `loadInventoryReport(client, filters)`, `loadCompoundReport(client, filters)`.

- [x] Write failing calculations tests for weighted costs, stock/layer union, missing costs, exact identity, discount rounding, total HPP, and zero/unknown margins.
- [x] Implement pure calculations; verify green, including finite-value and small-dose precision regressions.
- [x] Write failing server tests for denied roles/module/branch, full paginated reads/errors/caps, WIB scope, hidden version enrichment and complete exports.
- [x] Implement gated, paginated collectors with optional enrichment; verify green.

### Task 3: Screens, CSV, discovery and verification

Files: routes `/laporan/nilai-persediaan`, `/laporan/margin-racikan` with `/unduh`, shared renderer/export utility, report home.

- [x] Render filtered full-set summaries and paginated tables; exports use identical loaders; add OWNER/FINANCE-only report links without global access changes.
- [x] Run focused and full Vitest, lint, TypeScript and build in this worktree; document limits.
- [x] Commit reports, hand off for parent-coordinated independent review.

## Verification receipt

- `npm test`: 136 files / 1,245 tests passed after calculation, active-account and completeness changes.
- Focused ESLint on all changed report, shared component, fixture and test files: no errors or warnings.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed after final precision changes; existing image, Edge runtime and webpack-cache warnings remain.
- `git diff --check`: passed.

No production reads/writes, dependencies, migration or private ledger access changed. Browser/real PostgREST checks are delegated to the parent release review. Current inventory uses multiple current reads rather than a transaction snapshot; visible reconciliation warnings describe concurrent-change risk. Compound lines without explicit historical recipe links are excluded; invoice-wide discounts/taxes are unallocated and doctor attribution follows the current visit. FINANCE may see an exact historical version ID without inactive catalogue metadata.

Parent review additionally required the shared loader/export gate to enforce `profiles.is_active === true` because API routes bypass the page layout. Three regressions first demonstrated inactive OWNER/FINANCE reads and a direct CSV returning 200; the shared gate and navigation now reject them before financial reads. No `employees` query is used for doctor metadata, preserving HRIS privacy restrictions.

Independent review then reproduced silent truncation under a 200-row server cap and skipped/duplicated rows after an insertion/deletion between offset pages. The reader now requests exact counts, validates stable counts and expected page lengths, and rejects duplicate/missing primary or composite identities. The fixture sorts before applying ranges, returns filtered counts before server caps, and can mutate the dataset between queries. Loader and CSV regressions cover both reports, absent counts, cap200, count changes, and a count-preserving insertion that repeats an identity. These are observed-change checks, not a transaction snapshot; same-count value changes across sources remain subject to the visible caveat.
