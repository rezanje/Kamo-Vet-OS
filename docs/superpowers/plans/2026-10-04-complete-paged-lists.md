# Complete paged lists implementation plan

> For agentic workers: execute inline using superpowers:executing-plans; no additional agents.

**Goal:** Fix silent list truncation while bounding rendered tables to 50 rows.
**Architecture:** Shared checked read helpers; existing page loaders preserve their filters and stable tie-break ordering; existing pagination helper controls local/server table slices.
**Tech Stack:** Existing Next 15, React 19, Supabase JS, Vitest.
**Spec:** docs/superpowers/specs/2026-10-04-complete-paged-lists-design.md

## Constraints

- No migrations, external mutations, dependencies, or changed role/unit/date rules.
- Complete-source cap 10,000, source page 500, rendered table page 50.
- Fail visibly on missing/changing counts, partial rows, duplicate IDs, or read errors.

## Review focus

- Search must find records beyond the former source caps.
- Out-of-range pages and changing customer search must reset safely.
- Equal timestamps need unique ID ordering.
- Pet/warehouse filters must survive page navigation and all source reads.
- Incomplete reads cannot appear as empty/successful summaries.

## Tasks

- [x] Write failing helper/source tests for 1,200-row completeness, error/count/duplicate/cap failures, stable ordering, scoped warehouse pages, and medical search beyond 300.
- [x] Run tests and inspect expected red failures.
- [x] Implement checked complete/page reads and existing scoped source loaders.
- [x] Add 50-row customer, medical and stock table paging with existing pagination semantics.
- [x] Run focused tests, full tests, lint/type/build checks.
- [x] Run fictional local browser checks for row counts, navigation, search resets, beyond-cap results; record actual evidence and limitations.
- [x] Commit isolated change and report to parent for independent review/integration.
