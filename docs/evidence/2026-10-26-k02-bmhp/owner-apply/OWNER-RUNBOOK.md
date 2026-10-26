# K02 BMHP — production migration package for the owner

Ringkas (ID): paket ini untuk pemilik akses Supabase production. Isinya: cek awal (hanya baca), cara
menerapkan satu file migrasi K02, cek baca-balik (hanya baca), dan rencana mundur. **Belum ada yang
dijalankan ke production.** Jalankan hanya setelah keputusan rilis, dengan akses owner yang sudah ada
(tidak perlu token/akses baru), dan berhenti di langkah mana pun yang hasilnya tidak sesuai.

Everything below was rehearsed end to end on throwaway native PostgreSQL 16.14 and 17.11 clusters
(all 266 earlier repository migrations, then preflight → apply → readback → refused rollback →
rollback → preflight → re-apply → readback → K02 SQL suite). Logs: `rehearsal-pg16.log`, `rehearsal-pg17.log`.
Reproduce: `python3 docs/evidence/2026-10-26-k02-bmhp/owner-apply/build-and-verify.py [pg bin dir]`
(it regenerates the three SQL files; both PG versions produce byte-identical files).

## Files

| File | Writes? | sha256 |
|---|---|---|
| `supabase/migrations/20261026100000_k02_procedure_bmhp.sql` | yes (the migration) | `513f9c0937fa74a91e5c84a6bbfcc1fd7763d00686120277e599bd8c5aad9cbd` |
| `01-preflight-readonly.sql` | no | `e52954919696f835b822fc4ecee15cb2374a327c0273f462bd778bfec14174fd` |
| `03-readback-readonly.sql` | no | `8264ee1f77cf31b463361f65d3bca0692f08d165e79654da862a62728034d7e2` |
| `04-rollback-only-if-decided.sql` | **yes** — only on a rollback decision | `ec818c870d16cc5daa66a0dc559524742217a1008f076e41421cf96572ed8f7a` |

## Step 0 — target and backup (dashboard, no SQL)

1. Open the Supabase project that serves the production app (the one Vercel `kamo-group/kamo-vet-os`
   production points at). Write down the project ref and name. Do not use a staging/branch project.
2. Database → Backups: write down the time of the newest **completed** backup (or confirm PITR is on).
   If the plan allows an on-demand backup, take one now and wait for it to complete.
3. Pick a quiet window (no clinic checkout in progress). The migration briefly locks
   `prescription_items` and `invoice_items` (adding a nullable column is metadata-only) and replaces six
   clinic billing functions; it runs in one transaction and normally finishes in well under a second.

## Step 1 — the exact file

From a checkout of PR #243 head (record the commit SHA):

```
shasum -a 256 supabase/migrations/20261026100000_k02_procedure_bmhp.sql
```

must print `513f9c0937fa74a91e5c84a6bbfcc1fd7763d00686120277e599bd8c5aad9cbd`. Anything else: stop.

## Step 2 — preflight (read-only): `01-preflight-readonly.sql`

SQL Editor on the production project; run each query separately (select its text, then Run).

- **Query A** (40 checks): every row with an expected value shows `ok = true`; the last row `SUMMARY`
  says `0 failed`. It confirms: the previous migration (`20261026090000_inpatient_rx_evidence`) is live;
  K02 is not applied yet; the helpers K02 relies on exist; the six functions K02 patches are
  byte-identical to the repository (`fingerprint` rows) and keep their security mode; and each of the 18
  text anchors the migration replaces is found exactly once (a dry run of the migration's own drift check).
- **Query B**: newest history row is `20261026090000 inpatient_rx_evidence`, and there is no `20261026100000`.
- **Query C**: export the result as CSV and keep it next to the backup note (pre-K02 definitions of the six
  functions; used only by the fallback rollback).

Stop and send the result to the developer if: any `ok = false`; a `fingerprint` row differs (production
has a function version the tests never saw); Query B shows a different newest row or K02 already present;
or Query B errors because the history table does not exist (then use Path 1 without the history line).

## Step 3 — apply (writes)

**Path 1 — SQL Editor (recommended; this is exactly what was rehearsed).** New query, paste in this order:

```
begin;
-- paste the full content of supabase/migrations/20261026100000_k02_procedure_bmhp.sql here
insert into supabase_migrations.schema_migrations(version, name) values ('20261026100000', 'k02_procedure_bmhp');
commit;
```

Run once. Success = no error. If it fails (for example `K02 expected exactly one anchor ...` or
`K02 missing required RPC ...`), the transaction is rolled back and **nothing changed**; do not retry,
send the message to the developer.

**Path 2 — Supabase CLI**, only if `supabase migration list --linked` shows local and remote identical up to
`20261026090000` and `supabase db push --dry-run` lists exactly one file, `20261026100000_k02_procedure_bmhp.sql`.
Then `supabase db push`. Note: the repository has two migrations sharing version `0106`
(`0106_audit_keuangan.sql`, `0106_monitoring_rawat_inap.sql`), so CLI history comparison may report a
mismatch that has nothing to do with K02; if anything other than the single K02 file is listed, use Path 1.

## Step 4 — readback (read-only): `03-readback-readonly.sql`

- **Query A** (53 checks): `SUMMARY` = `0 failed`. Confirms the probe function, both columns, both triggers
  enabled, the six patched functions and five new functions byte-identical to the tested build, unchanged
  security mode, grants (authenticated may call only `clinic_bmhp_supported()`; helpers are private), each
  of the 18 patches present exactly once. The two `info: rows with BMHP` lines are 0 right after apply.
- **Query B**: exactly one row `20261026100000 k02_procedure_bmhp`.

Only after both pass: merge PR #243 (separate decision), wait for the Production deployment of the exact merge
SHA, then smoke test: open a clinic medical record, add a `Jasa` procedure, the `BMHP dipakai` picker appears.
Until the merge, the live app does not send BMHP at all, so applying the migration alone changes no
day-to-day behaviour.

## Rollback plan

- **Before any BMHP has been recorded** (both `info: rows with BMHP` = 0): run
  `04-rollback-only-if-decided.sql` once, in the SQL Editor. It is one transaction; it first refuses if any
  BMHP data exists, then reverses the 18 patches in reverse order, drops the two triggers, five functions and
  two columns (schema `clinic_private` existed before and is kept), and removes the history row. Then run
  preflight Query A again: it must show `0 failed` (functions are back to the pre-K02 fingerprints).
  Rehearsed, including the refusal case. If the K02 app code is already deployed, revert that merge too;
  until then the app simply refuses BMHP entry with a message (it checks `clinic_bmhp_supported()`), it does
  not break other saves or checkout.
- **If the rollback script itself refuses on a patch** (production functions changed after K02 was applied):
  nothing changed (one transaction). The developer restores the six definitions from the Query C export and
  drops the K02 objects by hand; do not improvise.
- **After real BMHP use**: no rollback. Stock, HPP and journals already reflect BMHP; removing the columns
  would lose that history. Fix forward with a new migration. Restoring the backup is a last resort that also
  discards every transaction since the backup; it is the owner's call only.
