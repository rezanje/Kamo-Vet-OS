# C04 package-total promo — production activation package for the owner

Ringkas (ID): paket ini untuk pemegang akses Supabase dan Vercel production. Isinya: cek awal (hanya baca), satu
file pasang (menulis), cek baca-balik (hanya baca), rencana mundur, lalu cara menyalakan fitur. **Belum ada yang
dijalankan ke production.** Jalankan hanya pada giliran rilis dari Wowo (jangan bersamaan dengan migrasi A02/R05),
dengan akses owner yang sudah ada (tidak perlu token/akses baru), dan berhenti di langkah mana pun yang hasilnya
tidak sesuai.

The app half of C04 is already live (PR #223, merge `e7737406`, Production deployment completed 2026-10-27
02:45Z; current Production `906bc98c` includes it). Package-total is hidden and refused until the flag below is
set, so nothing in this package changes day-to-day behaviour until Step 5.

Rehearsed end to end on a throwaway native PostgreSQL 16.15 cluster with every migration on main except C04
(production-like history table), fictional data only: before-tests → preflight → apply → readback → after-tests →
second apply refused → rollback refused while a package promo exists → rollback → preflight → after-rollback tests
→ re-apply → readback → tests. Log: `rehearsal-pg16.log`. Reproduce:
`python3 docs/evidence/2026-10-27-c04-package-activation/owner-apply/build-and-verify.py [pg bin dir]`
(regenerates the four SQL files). **Production runs PostgreSQL 17.6; a PG17 rehearsal was not possible in this
session** (no PG17 binaries reachable). Running the script once with a PG17 bin dir before Step 3 closes that gap.

## Files

| File | Writes? | sha256 |
|---|---|---|
| `supabase/migrations/20261026002100_promo_package_total_mode.sql` | yes (the migration) | `5aa9cae66fdc02f79fdac57e067a951b95b0cf0b09cd039edb8810a0ff8f0a7e` |
| `01-preflight-readonly.sql` | no | `3bce4309d17bb31de7faa06b62bee09d8cba84a6e80cbf9b04ecba7dc5d56064` |
| `02-apply-writes.sql` | **yes** — migration + history row, one transaction, `lock_timeout 5s` | `616cf5ed48e09a8d4a1b718fb6ec8ebbf7d81fc110c237ea6ca883ad6201aff7` |
| `03-readback-readonly.sql` | no | `1fde55fe1ba777dc5ad4d8931575342c67015868177c31665776c305e7358182` |
| `04-rollback-only-if-decided.sql` | **yes** — only on a rollback decision | `19b1c711212eec038b30b24124dfba348dad536b61792b857a800ac32f27b9a0` |

The migration hash above is the version on this package's branch (it closes a NULL gap found in security review,
see `SECURITY-REVIEW.md`). Use these files only after that branch is merged to main.

## Step 0 — target, slot and backup (dashboard, no SQL)

1. Supabase project serving Vercel `kamo-group/kamo-vet-os` Production. Last recorded on 2026-10-26 as
   `koaglxcyjqfmgfzxszkj` (only project on the account, PostgreSQL 17.6). Confirm the ref again; do not use any
   other project.
2. Database → Backups: write down the newest **completed** backup time (PITR was off on 26 Oct). Take an
   on-demand backup if the plan allows.
3. Release slot from Wowo; no other migration (A02, R05) in the same window. Quiet time: the migration briefly
   locks `promos`/`promo_items` (constraint + triggers); with `lock_timeout 5s` it gives up instead of queueing
   checkout reads.

## Step 1 — the exact file

`shasum -a 256` of the five files must match the table. Anything else: stop.

## Step 2 — preflight (read-only): `01-preflight-readonly.sql`

SQL Editor, each query separately.

- **Query A**: every row with an expected value shows `ok = true`; `SUMMARY` = `0 failed`. Confirms C04 is not
  applied, `edit_promo` is byte-identical to the repository (`fingerprint f4a53d51…`), keeps SECURITY DEFINER,
  empty search_path and its grants (authenticated only), is owned by the role you are running as, all four
  anchors the migration replaces occur exactly once, and no promo already stores `discount_mode`.
- **Query B**: no row `20261026002100`. Several newer versions are expected (e.g. `20261026100000`); C04 is
  applied out of order on purpose. Note whether `20261027090000` is present (R05) — informational only.
- **Query C**: export as CSV and keep with the backup note (pre-C04 editor body; fallback rollback only).

Stop and send the output to the developer if any `ok = false`, the fingerprint differs, Query B already has
`20261026002100`, or the history table does not exist.

## Step 3 — apply (writes): `02-apply-writes.sql`

Paste the whole file into a new SQL Editor query and run once. Success = no error. On any error (for example
`C04_PROMO_EDITOR_GUARD_DRIFT`, `C04_PROMO_EDITOR_VALIDATION_DRIFT`, or a lock timeout) the transaction is rolled
back and **nothing changed**; do not retry blindly, send the message to the developer (a lock timeout may simply
be retried later in a quieter moment). Do not use `supabase db push`: the version is older than applied ones.

## Step 4 — readback (read-only): `03-readback-readonly.sql`

- **Query A**: `SUMMARY` = `0 failed`; `data: package promos` = 0. Confirms constraint (not validated), guard
  function (SECURITY DEFINER, empty search_path, no EXECUTE for anon/authenticated/service_role), both triggers
  enabled + deferrable + initially deferred, `edit_promo` fingerprint `bb4be6aa…` with unchanged grants, all four
  patches present once.
- **Query B**: exactly one row `20261026002100 promo_package_total_mode`.

## Step 5 — turn the feature on (Vercel, owner)

Only after Step 4 passes: Vercel → `kamo-vet-os` → Settings → Environment Variables → Production:
`PROMO_PACKAGE_TOTAL_ENABLED` = `1`, then redeploy the current Production deployment (env changes need a new
deployment). Check: `/crm/promo` shows **Cara hitung diskon nominal**. **Never set the flag before Step 4**: the
database guard is what keeps an active package promo from running without its one target.

Optional smoke test (writes one promo row — owner's call): create a package promo for one SKU with *Berlaku dari*
far in the future (not applied at checkout), confirm the list shows `Rp…/paket min N`, then deactivate and delete it.
Field UAT with a real campaign remains a separate step.

## Rollback plan

- **Turn off only**: unset the flag and redeploy. This hides the option for new promos; **package promos that
  already exist keep being priced at checkout** until they are deactivated. Deactivate them in `/crm/promo` if the
  goal is to stop package pricing.
- **Database rollback, before any package promo exists** (Query A `data: package promos` = 0 and no promo stores
  `discount_mode`): flag off + redeploy first, then run `04-rollback-only-if-decided.sql` once. One transaction: it
  refuses while any promo stores `discount_mode`, drops the two triggers, the guard function and the constraint,
  reverses the four editor patches, verifies the editor is back to `f4a53d51…`, removes the history row. Then
  preflight Query A must show `0 failed` again. Rehearsed, including the refusal case.
- **If the rollback refuses on a patch** (editor changed after apply): nothing changed. The developer restores the
  editor from the Query C export and drops the C04 objects by hand.
- **After package promos were used**: no database rollback; sales already carry their saved line discount (history
  is never recalculated). Deactivate the promos and fix forward. Restoring the backup is a last resort that discards
  every transaction since the backup; owner's call only.
