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

## Next

1. Native PG16 isolated run of the K02 + 7 existing clinic suites (FIFO + moving average).
2. Review migration (stock, FIFO/avg, journal, input validation, capability gate) and app diff.
3. vitest (relevant + full, baseline vs main), tsc, eslint, build.
4. Open PR, wait for Technical checks. Migration apply only with owner access + backup + readback.
