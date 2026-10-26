# K02 BMHP tindakan — SAVE-ONLY handoff (26 Oct 2026)

Status: **candidate only. NOT live, NOT complete, NOT merged, NO PR, NO migration applied, NO deploy.**
Work stopped by owner instruction ("save only") and moved to Claude Code.

## Branch / commits
- Branch: `fufufafa/k02-procedure-bmhp` (from main `8e0f59a00ec72a5b2ccc2120a753bc9d62dde1a7`).
- Local source commit: `876ac2bc` in worktree `/opt/data/kamo-k03` (local branch `fufufafa/k02-bmhp`).
- Do not merge before the migration gate below; no PR has been opened.

## What exists
- Migration candidate `supabase/migrations/20261026100000_k02_procedure_bmhp.sql` (sha256 `513f9c0937fa74a91e5c84a6bbfcc1fd7763d00686120277e599bd8c5aad9cbd`).
- SQL test `supabase/tests/clinic_procedure_bmhp.sql`, Docker runner `scripts/test-procedure-bmhp-postgres.py`.
- App: `src/lib/procedure-bmhp.ts`, `src/components/ProcedureBmhpField.tsx`, rekam medis + rawat inap form/action wiring, tests.
- Evidence and owner apply runbook: `verification.md`, `*.log` in this folder.

## Caveats (must be resolved before calling K02 done)
1. **Native PostgreSQL never run.** All SQL evidence comes from PGlite (PostgreSQL 18.6 WASM) on a host without Docker/Postgres. `python3 scripts/test-procedure-bmhp-postgres.py` (Docker `postgres:16`) has never been executed anywhere. Supabase runtime is PG 15/16.
2. **Void/reissue:** only the existing `clinic_void_reissue_invoice` path is covered — HPP journal reversed and re-posted on the replacement invoice, BMHP snapshot copied, stock not moved again (same rule as medicines). There is no separate stand-alone void path tested; BMHP stock is not returned on reissue by design.
3. **Refund:** `clinic_refund_source_core` deliberately rejects invoices with BMHP (fail closed to manual reconciliation, like compounds). There is no automatic BMHP restock on refund.
4. **Correction (edit):** kept procedure rows retain BMHP/HPP; removed rows return stock at historical cost; a BMHP procedure cannot be re-added through correction. Verified only in PGlite.
5. Cashier screen / printed invoice do not display BMHP in this candidate.
6. Full vitest on this host: 14 failures in 7 unrelated files, identical to main on the same host; GitHub Technical checks have NOT run on a PR for this branch.
7. Migration apply needs existing Supabase owner access (Reza/Codex); no new token/permission was requested or used.

## Next steps for the new owner (not done here)
1. Review the branch; run Docker runner; open PR; wait for Technical checks.
2. Owner applies migration + readback per `verification.md`.
3. Only then merge to main and verify exact-SHA Production; then UAT.
