# C04 package-total — activation readiness (27 Oct 2026)

Coordinator note (Wowo, approved by Reza): C04 first, then A02; R05 queued. This file reports readiness only;
**no production database change, flag change or deployment was made.**

## Proven

| Item | Evidence |
|---|---|
| Only one DB change pending for C04 | `supabase/migrations/20261026002100_promo_package_total_mode.sql`. No other C04 database object. |
| App half live and safe without it | PR #223 merge `e7737406`, Production deployment completed 02:45Z; current Production `906bc98c` includes it. Rehearsal: live-app legacy edit payload accepted by the pre-C04 editor; package payload refused. |
| Migration safe to apply out of order on latest main | Rehearsal on all 267 other main versions; before/after/rollback suites pass (`owner-apply/rehearsal-pg16.log`). |
| Security pre-review | `SECURITY-REVIEW.md`: no escalation; one NULL gap found and fixed (red→green). |
| Rollback | `04-rollback-only-if-decided.sql` rehearsed: refuses while a package promo exists; otherwise restores the exact pre-C04 editor body and removes all C04 objects and the history row. |
| Activation switch | `PROMO_PACKAGE_TOTAL_ENABLED=1` (Vercel Production) + redeploy, only after readback passes. |

## Not proven (needs the owner's existing access)

- Production project ref today (last recorded `koaglxcyjqfmgfzxszkj` on 26 Oct), C04 absence in production
  history, production editor fingerprint — all answered by preflight Query A/B.
- Current backup state (PITR was off on 26 Oct).
- PostgreSQL 17 rehearsal.
- Integrator sign-off of the security pre-review.
- Field UAT.

## Release coordination finding (not C04)

Open A02 PR #248 adds `20261027090000_purchase_correction_requests.sql`; main already has
`20261027090000_private_report_promo_history_presets.sql` (R05). Same version number: the second one applied
cannot get a history row under that version (primary key) and `supabase db push` ordering is ambiguous. A02 needs a
new version number before its slot.

## Business decisions still open (not inferred, not changed)

1. **Mixed SKU.** Today one package = one SKU. Options: (A) keep single-SKU only; (B) any mix of listed SKUs counts
   toward the minimum, discount split by each item's gross value; (C) fixed bundle recipe (e.g. 3 of A + 2 of B), new
   configuration screen. A is done; B and C are new work.
2. **P03 below HPP for promos.** Today a promo is capped only by the line's selling value. Options: (A) no floor,
   as today; (B) refuse at checkout when the discounted price would fall below HPP; (C) allow but flag for manager
   approval/report. P03's broader matrix (roles, free services, expiry) stays a separate decision.
