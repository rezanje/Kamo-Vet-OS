# Readable activity history implementation plan

> Execute inline with systematic debugging and test-first changes; one narrow final review.

**Goal:** Make existing authorized history understandable and let a reader open a supported surviving source transaction.

**Architecture:** Keep the existing immutable audit, server actor and RLS queries. Add presentation helpers and checked source links; register the two already-captured refund entities in the UI. No schema, access, historical backfill or N01 resolver changes.

**Scope supplied and approved:** Human-readable field/entity labels, explicit before/after, refund-specific filtering and supported authorized source routes. Salary/clinical metadata stays redacted. U09 owns user-management files; this branch touches only activity helpers/view/tests.

## Tasks

- [x] Add failing component/helper regressions for quantity/price formatting, metadata privacy, refund filtering, source routes, absent/deleted/denied source and failed source reads. Preserve active OWNER/ADMIN gates and bounded cursor query.
- [x] Implement label/value presentation and refund entity registration. Unknown fields do not gain unrestricted payload display.
- [x] Add fixed route allowlist for existing source details. Query current source existence through the normal session/RLS, batch by supported entity; missing/error/private/deleted sources keep history without a source link. Never infer a document number or guess a child-to-parent relation.
- [ ] Run affected tests, full app suite once stable, scoped lint, build and post-build typecheck; independent review, normal push/PR/merge and exact main deployment verification under supplied authorization.

## Review focus

Payroll metadata must not expose old/new values; revoked/branch-denied source cannot gain a link; refund composite identity must keep its exact filter; unknown/malicious route IDs cannot become URLs; deleted objects retain searchable audit even without a live source. Source lookup failure must not erase log rows or claim missing history.

## Ledger

- Baseline: main `6184bcd45fb751f1e1c61b80bbb0a7ee8d16b863`; no existing open A01 readability candidate found. Reused clean isolated worktree on a new branch; denied N01 branch untouched.
- Installed Next15.5.25 has no bundled `dist/docs`; use existing server page patterns and installed types/build, no dependency change.
- User explicitly requested immediate implementation and main release; no new design/permission round required for this bounded scope.
- Initial focused RED: six failures, four existing privacy/deletion cases passed. Added REDs caught tiny-number display rounding and legacy source SELECT returning a newly inaccessible branch. Format uses exact decimal text, source links also recheck current branch grants.
- Review found code identifiers being formatted as numbers/statuses and online sales linking to retail-only struk. Both reproduced RED, fixed and rechecked at `5d20b89`; no remaining concrete finding in narrow review.
- Final code verification: 77 focused tests, 3,192 full tests in 432 files, build, post-build typecheck, scoped lint and whitespace check passed. Initial build's dynamic SELECT inference error was fixed with runtime record narrowing before final checks. Release evidence follows PR/main status, without another code change.
