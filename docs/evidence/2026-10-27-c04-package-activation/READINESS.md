# C04 package-total — activation readiness (27 Oct 2026)

Coordinator note (Wowo, approved by Reza): C04 first, then A02; R05 queued. This file reports readiness only;
**no production database change, flag change or deployment was made.**

## Proven

| Item | Evidence |
|---|---|
| Only one DB change pending for C04 | `supabase/migrations/20261026002100_promo_package_total_mode.sql`. No other C04 database object. |
| App half live and safe without it | PR #223 merge `e7737406`, Production deployment completed 02:45Z; current Production `906bc98c` includes it. Rehearsal: live-app legacy edit payload accepted by the pre-C04 editor; package payload refused. |
| Migration safe to apply out of order on latest main | Rehearsal on all 267 other main versions; before/after/rollback suites pass (`owner-apply/rehearsal-pg17.log`, `rehearsal-pg16.log`). |
| Security pre-review | `SECURITY-REVIEW.md`: no escalation; one NULL gap found and fixed (red→green). |
| Rollback | `04-rollback-only-if-decided.sql` rehearsed: refuses while a package promo exists; otherwise restores the exact pre-C04 editor body and removes all C04 objects and the history row. |
| Activation switch | `PROMO_PACKAGE_TOTAL_ENABLED=1` (Vercel Production) + redeploy, only after readback passes. |
| Production target | `koaglxcyjqfmgfzxszkj`, PostgreSQL 17.6, only project; Vercel alias → `906bc98c` READY (`owner-apply/production-preflight-2026-10-27.md`). |
| Production preflight (read-only) | Query A `0 failed` at 03:32Z; Query B: no C04 row, newest K02, R05 not applied; 0 long transactions. |
| Flag state | `PROMO_PACKAGE_TOTAL_ENABLED` absent in Vercel project env (off). |
| PostgreSQL 17 | Full rehearsal on 17.6 passes; SQL files byte-identical to the 16.15 run. |
| App → database link | Public `/booking` request at 03:37:41Z appears as its exact query in `koaglxcyjqfmgfzxszkj` edge log at 03:37:41.867Z (`BACKUP-OPTIONS.md`). |

## Facts checked, gate not yet met

- **Backup**: PITR off; newest completed daily backup 2026-10-26 15:20:57Z predates K02 (applied 17:16Z). Gate: a
  newer one shows `COMPLETED`. Paths, costs and the optional scoped snapshot (with restore proof): `BACKUP-OPTIONS.md`.

## Real access limits

- Backup schedule / next run: `GET /database/backups/schedule` requires the Enterprise plan → not verifiable; only
  past completion times (15:13–15:21Z) are known. On-demand backup is not offered (restore-point endpoint unavailable).
- Vercel stores `NEXT_PUBLIC_SUPABASE_URL` as sensitive and integration listing is forbidden for the token; neither
  was widened. The link was proven through the edge log instead.
- No production write, add-on or backup action was attempted: not authorised in this phase.

## Gates still open

- Integrator sign-off of `SECURITY-REVIEW.md`; PR #249 merged (it changes the migration file).
- Release slot from Wowo (no A02/R05 migration in the same window); preflight Query A repeated in the slot.
- Field UAT after the flag is on.

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
