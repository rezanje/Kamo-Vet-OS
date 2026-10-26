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

## Next

1. Open PR, wait for Technical checks.
2. Production migration only with legitimate owner access, confirmed target, recent backup, then readback
   per `verification.md`. Not done.
