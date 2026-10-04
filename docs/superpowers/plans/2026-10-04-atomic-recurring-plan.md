# Atomic recurring implementation

1. [x] Add failing application tests for RPC-based retry/error propagation, WIB monthly eligibility and full/legacy identity history mapping; add failing SQL contract assertions.
2. [x] Add a dedicated monthly RPC and widen the source-reference column enough for full identity. Keep schedule and journal transaction boundaries local to this RPC.
3. [x] Route catch-up through the RPC, preserve monthly limits, display actionable failures and adapt recurring history to both reference formats.
4. [x] Verify rollback/retry and real two-session serialization against isolated PostgreSQL, then run the complete Vitest suite, TypeScript and lint. Document limits and commit the reviewable change.

Verification on 4 October 2026: isolated PostgreSQL 16 checks passed, including observing a second session blocked on the schedule lock and returning the same journal after the first commits. All 134 Vitest files / 1,218 tests passed. TypeScript passed with `--noEmit --incremental false`. Full lint passed with zero errors and twelve pre-existing warnings in unrelated clinical image/upload files; changed TypeScript files are clean. `git diff --check` passed.

The database harness applies the actual accounting/core/RLS migration subset with test-only Supabase auth shims. It is not a complete local Supabase reset or production schema verification. No production data, migrations, external messages, remote writes or automatic historical corrections occurred. The existing monthly schedule definitions remain in force; extension rules for BUG-08 remain undecided.
