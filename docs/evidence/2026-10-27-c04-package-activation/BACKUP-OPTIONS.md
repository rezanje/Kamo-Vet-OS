# C04 — fresh backup paths and target identity (27 Oct 2026, read-only)

Nothing below was executed against production except read-only API calls. No paid add-on, no new token or grant,
no data exported off the project.

## Target identity (Vercel → Supabase), without reading secrets

- Vercel keeps `NEXT_PUBLIC_SUPABASE_URL` as *sensitive*; its value is not readable and was not read.
  Integration listing is forbidden for the existing token (not widened).
- Non-secret proof: one request to the public page `https://kamo-vet-os.vercel.app/booking?probe=c04map` at
  **2026-10-27T03:37:41Z**. Supabase project `koaglxcyjqfmgfzxszkj` edge log at **03:37:41.867Z**:
  `GET | 200 | https://koaglxcyjqfmgfzxszkj.supabase.co/rest/v1/branches?select=id%2Cname&is_active=eq.true&type=eq.KLINIK&order=name.asc | node`.
  That is exactly the query in `src/app/booking/page.tsx:23`, issued server-side by the live Production deployment
  (`dpl_ApQb7y1F4qVW7Usg5gG9X1vjtxv9`, `906bc98c`). The project is also the only one visible to the token.
  **Verified:** the live app reads from `koaglxcyjqfmgfzxszkj`.

## Backup facts (Supabase Management API)

| Fact | Value | How verified |
|---|---|---|
| PITR | off | `GET /database/backups` → `pitr_enabled: false` |
| Daily physical backups kept | 7 (2026-10-20 … 2026-10-26) | same call |
| Newest COMPLETED | 2026-10-26T15:20:57Z (before K02 at 17:16:58Z) | same call |
| Past completion times | 15:13:41–15:20:57Z | same call — **history, not a schedule** |
| Next scheduled run | **not verifiable** | `GET /database/backups/schedule` → `entitlement_required` (Enterprise plan feature) |
| On-demand backup | not offered | no create-backup endpoint; `GET /database/backups/restore-point` → "unavailable at the moment" |
| Add-ons selected | none | `GET /billing/addons` |

No completion time is promised: the gate is "a backup newer than 2026-10-26T15:20:57Z shows `COMPLETED` in
`GET /database/backups`", checked again right before apply.

## Paths to a fresh full backup

| Path | Exact action | Where stored / retention | Cost / permission | Status |
|---|---|---|---|---|
| **A. Next daily backup (recommended)** | None. Read `GET /v1/projects/koaglxcyjqfmgfzxszkj/database/backups` (or Dashboard → Database → Backups) until a newer entry is `COMPLETED`. | Supabase-managed physical backup of the whole project, same region (ap-northeast-2); the list keeps the latest 7 daily backups. | Included in the current plan; no new permission. | Waiting; run time not verifiable with this access. |
| B. PITR add-on | Owner enables `pitr_7` in billing; then restore points / point-in-time restore become available. | Supabase WAL archive, 7 days. | **$100/month** (`pitr_7`; 14 d $200, 28 d $400) per `GET /billing/addons`; may also require a compute upgrade (Small ≈ $15/month listed). Billing decision by owner. | Not proposed for C04. Not done. |
| C. Logical dump (`pg_dump`) | — | Would copy real data off the project and needs the DB password. | Excluded by instruction. | Not done. |

## Optional scoped snapshot (`owner-apply/00-…` + `05-…`) — not a replacement for A

- **Scope:** copies `public.promos` and `public.promo_items` only. Not sales, receipts, stock, journals or any other
  table. The `edit_promo` definition is covered separately (`production-preflight-queryC.csv` + `04-rollback…`).
- **Consistency:** both copies in one `repeatable read` transaction, so they reflect one moment. Edits committed
  after that moment are not in it.
- **Location / retention:** same production database, schema `ops_backup` (not exposed: grants revoked from
  public/anon/authenticated/service_role). Kept until someone drops it; no automatic expiry. Lost with the database
  itself, which is why it cannot replace A.
- **Restore proof (rehearsed on PG 17.6 and 16.15, fictional data):** after the snapshot and C04 apply, one promo was
  edited, one deleted, one lost its target, one got an extra target, and a new package promo was created.
  `05-restore-from-snapshot-only-if-decided.sql` returned every snapshot promo and target list to the snapshot
  (`differing|missing|extra = 0|0|0`) and left the new promo untouched; C04 readback still `0 failed`.
- **Limitations:**
  - Restore overwrites edits made after the snapshot on those promos.
  - Promos created after the snapshot are left as they are.
  - Restore stops if the live table columns changed since the snapshot.
  - Restore is a write needing its own decision.
- **Status:** prepared, **not run on production**. Running it would be a production write inside the release
  slot, and needs the coordinator's go.
