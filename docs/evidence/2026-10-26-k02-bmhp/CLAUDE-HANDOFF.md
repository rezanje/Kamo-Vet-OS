# K02 BMHP — Claude Code takeover log

## Stage 0 — reconciliation (26 Oct 2026)

- Remote fetched. `origin/main` = `8e0f59a00ec72a5b2ccc2120a753bc9d62dde1a7` (PR242 K03/S01 merge). No new commits on main since the K02 branch point.
- `origin/fufufafa/k02-procedure-bmhp` = `df3a72ac29dc6fbf75a52093ea44b54d7e4a811c` = checkpoint. 10 commits ahead of main, 0 behind.
- Working branch `claude/k02-bmhp` created at `df3a72ac` in a separate worktree (`../VET_OS-k02`). The original Mac checkout (branch `codex/grup-barang-accurate-import`, 64 uncommitted files, 10 commits not in main, 548 behind main) was left untouched.
- Branch vs HANDOFF.md: all 19 files listed/implied by the handoff are present. Migration sha256 `513f9c09…9cbd` and SQL test sha256 `bca94d31…690e` match `verification.md` exactly. All 7 existing clinic SQL suites and `test-compound-catalog-postgres.py` used by the runner exist on the branch. Nothing missing. Hermes backup not compared (no access, not requested).
- No K02 PR exists yet.
- Existing evidence is PGlite (PostgreSQL 18.6 WASM) only; native PostgreSQL never run.

## Runtime

- Docker: not installed on this Mac, so `scripts/test-procedure-bmhp-postgres.py` cannot run as written.
- Native PostgreSQL 16.14 (Homebrew `postgresql@16`) and 17.11 binaries are available. Plan: run the runner's exact bootstrap/migration/test sequence against a throwaway `initdb` cluster in a temp dir (unix socket only, no network, no DB URL), via a scratch wrapper, without editing the repo runner.

## Sheet

- Read access confirmed (checklist readable). Cell-level write access not confirmed; status will be delivered as paste-ready text unless write is proven.

## Stage 1 — native PostgreSQL + app checks (26 Oct 2026)

Reproduce (from the repo root, macOS with Homebrew `postgresql@16` / `postgresql@17`, no Docker):

```
python3 docs/evidence/2026-10-26-k02-bmhp/run-native-pg.py                                   # PG 16.14
python3 docs/evidence/2026-10-26-k02-bmhp/run-native-pg.py /opt/homebrew/opt/postgresql@17/bin  # PG 17.11
```

`run-native-pg.py` executes `scripts/test-procedure-bmhp-postgres.py` unchanged and only translates its
`docker` calls: `initdb -U postgres -E UTF8 --locale=en_US.UTF-8` into a fresh temp dir, unix socket only
(`listen_addresses=''`), `timezone=Etc/UTC`, `PSQLRC=/dev/null`, inherited `PG*` env cleared, temp dir deleted
at the end. It never accepts a DB URL and never connects to any existing cluster.

Same as the Docker runner: auth/storage shims, roles (`anon`, `authenticated`, `service_role bypassrls`),
default privileges, all 267 migrations in order each in `begin/commit`, pre-0068 COA fixture, the 8 suites in
the same order, and the moving-average rewrite. Only extension used by migrations is `btree_gist` (contrib,
present in both Homebrew builds).

Differences (not assumed equivalent): Homebrew builds instead of the Debian `postgres:16` image; macOS libc
collation instead of glibc (text ordering only); trust auth on a private socket instead of password auth.
Runner's success text says "PostgreSQL 16" even on the PG17 run (hard-coded string). The repo's Supabase
config declares `major_version = 17`, so the PG17 run is the closest match to the target.

Results (logs in this folder):
- `native-pg16.log`, `native-pg17.log`: K02 + 7 clinic suites pass (FIFO), K02 passes (moving average).
- `native-pg16-red.log`: without the K02 migration the K02 suite fails (`bmhp_components` missing).
- `native-pg16-mutation.log`: with the procedure-HPP assignment removed the K02 suite fails (`<NULL>` HPP).
- No temp cluster or server left behind (checked).
- `app-checks-mac.log`: full vitest 502 files / 3635 tests pass, 0 failures (the 14 failures in the earlier
  handoff were host-specific; `origin/main` CI is green too); lint 0 errors (warnings pre-exist on main);
  `tsc --noEmit` and `next build` exit 0.

## Cancellation semantics (exact, as implemented and tested)

- Posting: BMHP stock leaves once, when the clinic invoice posts; its cost is the procedure line HPP,
  journaled 5101/1301 under `klinik-hpp`. Revenue lines and selling price unchanged.
- Void + reissue (`clinic_void_reissue_invoice`): HPP journal is reversed on the voided invoice and re-posted
  on the replacement; the BMHP snapshot is copied; **stock does not move** (it stays issued). A stand-alone
  void without reissue is not covered by a K02 test.
- Correction (`clinic_edit_invoice`): kept procedure rows keep their BMHP and HPP; removed procedure rows
  **return BMHP stock** at historical cost (`klinik-edit`) and their HPP leaves the journal; a BMHP procedure
  cannot be re-added through correction.
- Refund: invoices with BMHP are **rejected** by the refund source check (manual reconciliation, same as
  compounds). No automatic restock on refund.
- Not in scope: cashier screen and printed invoice do not show BMHP.

## Stage 2 — PR243 checks, void-without-reissue, owner package (26 Oct 2026)

PR243: https://github.com/rezanje/Kamo-Vet-OS/pull/243 (draft, open, mergeable). Technical checks on head
`0855d0888929e83d7012f475ee91ae40486460d1`: **SUCCESS** (run 40334856596, job 121613574503, completed
2026-10-26T14:01:49Z); it was the only required check. Result for this stage's head commit: see the PR.

Void without reissue — does a path exist? **No.** Checked all migrations and app code:
- The only clinic invoice void is `clinic_void_reissue_invoice` → `clinic_void_reissue_invoice_core`; it always
  sets `voided_at` on the old invoice and inserts the replacement in the same transaction. No RPC voids alone.
- `authenticated` has no INSERT/UPDATE/DELETE on `public.invoices`
  (`20260929120000_clinic_billing_lifecycle.sql`: `revoke insert, update, delete on public.invoices from authenticated`),
  and the `guard_posted_clinic_invoice` trigger additionally rejects any change to a posted invoice by that role.
- App code only reads `invoices` (filters `voided_at is null`); the cashier's cancel button calls the reissue RPC.
- Refund of a BMHP invoice is refused (fails closed to manual reconciliation), as before.
- Only a database owner / service role (SQL Editor, outside the app) could bypass this; not an app path.

Added to `supabase/tests/clinic_procedure_bmhp.sql` (step 3, as the doctor role after a BMHP invoice posts):
a direct `update invoices set voided_at` and a direct `delete` are both refused (`permission denied`), and the
invoice stays active — so BMHP stock, HPP and journal can only be reversed through void+reissue. Behaviour
reported as is; no business rule changed. Test sha256 now `638147821d45eb934b6cc851ff6721ac6e944fa5c23997f3ba3f2c459cbd5582`.
Re-ran `run-native-pg.py` on PG 16.14 and 17.11: K02 + 7 clinic suites pass (FIFO), K02 passes (moving
average); logs `native-pg16.log`, `native-pg17.log` (content unchanged apart from the run).

Owner package: `owner-apply/OWNER-RUNBOOK.md` with `01-preflight-readonly.sql` (40 checks incl. per-function
fingerprints and a dry run of all 18 anchors), `03-readback-readonly.sql` (53 checks),
`04-rollback-only-if-decided.sql` (one transaction, refuses once BMHP data exists, reverses the 18 patches).
Generated and rehearsed by `owner-apply/build-and-verify.py` on PG 16.14 and 17.11 (byte-identical output):
preflight 0 failed → apply → readback 0 failed → rollback refused with BMHP data → rollback → preflight 0 failed
→ re-apply → readback 0 failed → K02 suite passes. Logs `owner-apply/rehearsal-pg16.log`, `rehearsal-pg17.log`.
Nothing was run against production or any remote database.

Finding for the owner: two repository migrations share version `0106` (`0106_audit_keuangan.sql`,
`0106_monitoring_rawat_inap.sql`), so Supabase CLI history comparison can be noisy; the runbook prefers the
SQL Editor path, which is the one rehearsed.

## Next

1. Owner decision on the production window; then run the owner package (Step 0–4). Not done.
2. Merge PR243 only after the readback passes; verify the exact-SHA Production deployment and the BMHP picker.
