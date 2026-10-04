# HRIS fictional local acceptance — 4 October 2026

Branch `codex/hris-local-acceptance`, base PR18 `0f624c8`. User authorized finishing feasible work under existing financial rules, with fictional LOCAL records; a separate remote demo is unavailable. No production database write, actual payment, remote demo mutation, migration-history rewrite or deployment occurred.

## Migration and runtime evidence

All **179 unchanged repository migration sources** applied in filename order on isolated PostgreSQL16.15. An unadapted fresh run first failed at `0068_kas_bank.sql`: FK `cash_accounts_coa_code_fkey` requires COA1101, absent because the normal seed runs later. `scripts/hris-local-stack.py --fresh-prerequisites` explicitly loads fictional COA1101/1102 immediately before0068 and logs that prerequisite. Both historical0106 files apply and are recorded by full filename in a separate LOCAL acceptance ledger; this is not the Supabase migration-history table.

A genuine Supabase CLI2.75 minimal-stack attempt first rejected the newer config's `experimental.pgdelta`; only the scratch config copy was adjusted. The subsequent Supabase PostgreSQL17 image pull failed registering a layer with `no space left on device` under the managed Docker storage driver. The original config and every historical migration remain unchanged.

Fallback evidence uses real **GoTrue2.186**, its actual migrated `auth.users` schema, real **PostgREST14.3**, PostgreSQL16 and a loopback routing gateway. It includes explicit test-only auth helpers, legacy default public-table/sequence/function grants, an empty storage.buckets/objects shim, and a realtime publication without a realtime service. JWT verification and real password login run in GoTrue/PostgREST. **This is an adapted LOCAL integration bootstrap, not a complete Supabase stack, clean CLI reset, storage/realtime acceptance or remote-schema compatibility claim.** Modern restricted default grants must still be verified against the actual eventual target.

Runtime/fictional-auth files live outside git in `/workspace/hris-local-runtime`; keys are locally generated, never derived from managed Supabase configuration and never printed. Nonsecret fixture-manifest records endpoints, fictional identities/branches and dates. LOCAL DB/auth/API/gateway are intentionally left alive for the parent's later benchmark; do not reset after shared benchmark fixtures have been added.

## Existing-policy fictional period

Current global lateness, absence and overtime monetary defaults remain zero; no new global/group rate is activated. Existing variable allowance, approved reimbursement and two-installment debt semantics supply the manual expected example:

| Employee | Salary | Existing period allowance | Approved reimbursement | Debt installment | Expected net |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fiction Alice | 1,000,000 | 100,000 | 25,000 | 50,000 | 1,075,000 |
| Fiction Bob | 2,000,000 | 0 | 0 | 0 | 2,000,000 |
| Fiction Carol | 3,000,000 | 0 | 0 | 0 | 3,000,000 |

Expected company net6,075,000; remaining Alice debt50,000; journal debit/credit6,125,000 (net plus settled debt). Commission source is empty/zero in this fictional example; nonzero and complete-source commission cases remain covered by existing application tests. This is an automated manual-amount comparison, not stakeholder acceptance of actual employee figures or real payment authorization.

## Verification ledger

- Task1 complete: `npm test` →157 files/1,331 pass; all12 existing SQL suites and board/swap/access/payroll/period-close/forced source-lock races pass through the existing disposable curated PostgreSQL runner. These suites retain their documented curated-baseline boundary; they are not falsely labelled full-stack SQL suites.
- Task1 complete: raw179-source chain reproduced0068 failure; explicit fresh prerequisites →179 sources applied on LOCAL PostgreSQL with real GoTrue auth schema. Migration names, source count and prerequisites logged.
- Task2 complete: fresh real authenticated PostgREST own/foreign STAFF, scoped branch ADMIN and OWNER reads; anonymous/company-payroll/GPS missing/outside/cross-branch denials pass. Real browser login/SSR cookies, denied GPS without attendance, clock-in/out and repeated checkout denial, HR correction/stale version audit, weekly Excel round-trip/branch sheet and consent-before-HR swap with approved browser reload pass. Scoped recap and the authenticated Excel export route pass.
- Task2 complete: the actual server-side payroll collector/browser prepare/finalize matches all three manual net amounts above. Exactly one50,000 installment, a paid reimbursement, three immutable final slips and one balanced6,125,000 journal remain. Repeat finalization and subsequent correction of finalized attendance deny; browser reload shows final status.
- Task2 complete: browser saved source details contain historical allowance/reimbursement lines. Actual schedule board save and confirmed Excel import create two future-month cells through real server actions; byte-for-byte final source snapshots remain unchanged. Actual browser GPS outside the assigned branch radius denies without writing attendance.
- Parent benchmark fixture: after acceptance, a separate `QA-PERF` branch/warehouse received1,200 fictional customers/pets/items/stock rows and350 visits/medical records, all dated2010. Counts are independently queried and recorded in the nonsecret manifest; final slip net6,075,000/installment50,000/single journal rechecked afterward. Durable seed: `supabase/tests/hris_local_benchmark_fixture.sql`.

Application source/dependencies are unchanged in this continuation. Fresh full app verification exits0: **157 files/1,331 tests**, followed by `npx tsc --noEmit` with no errors. Fresh lint exits0 with the same12 prior warnings; JS/Python syntax and whitespace checks pass. No fresh build is claimed here while the parent benchmarks the shared dev `.next` tree; the final combined-branch build is owned by the parent. Vercel's successful PR18 preview and earlier build evidence remain separate, historical evidence.

Session evidence logs: `/workspace/hris-local-{app-tests-final,curated-sql,chain-red,chain-green,browser-final,browser-followup,lint,tsc,benchmark-seed}.log`. Durable commands/results here do not depend on later retention of those workspace logs.

## Reproduction

The scripts deliberately accept only the named fictional loopback/container target. Docker must use the managed local socket; they clear inherited daemon selectors and preserve registry/proxy configuration. Browser checks require installed `playwright` and Chromium; this environment supplies them globally. Use a fresh empty local target for the main run:

```sh
python3 scripts/hris-local-services.py --reset
node scripts/hris-local-gateway.mjs
# In another shell, once real auth/API are healthy:
python3 scripts/hris-local-stack.py --fresh-prerequisites
node scripts/test-hris-local-browser.mjs --keep-app
# After the successful one-period run, on the same fictional fixture:
node scripts/test-hris-local-browser.mjs --resume-fixture --followups --keep-app
```

`--reset` discards only the three explicitly named LOCAL containers and their fictional data; never run it while the parent's shared benchmark uses this fixture. The applier resumes by full source filename. `--resume-fixture` is only a development/followup option for this exact known fixture, not a substitute for the fresh main acceptance run.

## Independent launcher and interrupted benchmark

After successful HRIS acceptance, the parent's repeated dev-server tab benchmark stopped with `ERR_CONNECTION_RESET`. The saved Next log ends with successful request timings and no fatal heap/crash message. Linux `/proc/92603/stat` retained raw exit status9 (SIGKILL); the cgroup reported zero OOM kills. The host loopback gateway also disappeared while Docker GoTrue/PostgREST/PostgreSQL stayed alive, and the original acceptance tool session was no longer registered. This establishes SIGKILL termination; its source is unknown. The benchmark script only closes its browsers and does not kill Next. Its partial dev timings are fixture observations, not completed production performance evidence.

`scripts/hris-local-launcher.py` independently supervises the gateway and app, with optional detached sessions and atomic runtime state files recording observed child exits/signals. Detached sessions remove the acceptance script lifetime dependency; environment-wide SIGKILL can still terminate them, and killing the supervisor itself prevents it recording the child's final status. Readiness must be checked separately. No3108 restart was performed during diagnosis.

Production browser bundles embed public Supabase settings at build time. The launcher therefore overrides inherited URL/anon/service keys with the generated fictional config during both build and startup, and requires a matching local build ID/config stamp before `start`. It never prints key values. Use the same app-root for build/start; no concurrent dev/build against that app-root's `.next` directory:

```sh
python3 scripts/hris-local-launcher.py --mode gateway --detach
python3 scripts/hris-local-launcher.py --mode build --app-root /workspace/vetos-completion
python3 scripts/hris-local-launcher.py --mode start --app-root /workspace/vetos-completion --port 3110 --detach
python3 scripts/test-hris-local-launcher.py
```

Foreground mode omits `--detach`; dev mode uses `--mode dev`. Logs/state live in `/workspace/hris-local-runtime/<mode>-<port>.log` and `.state.json`; build stamps live inside ignored `.next`. Seven targeted regressions pass: remote API rejection, inherited credential overrides, missing-key rejection, unverified/stale build rejection, changed-key rebuild requirement, SIGKILL exit recording and detached startup with credential-free output. These tests use fictional keys and a fake executable, and do not restart or mutate the shared app/database.

## Rulings and limits

- Ruling: user's existing-financial-rules clarification removes the need to invent or await new money policy for local completion — preserve current semantics/defaults — cost: new eligibility/catalog/split/doctor/monthly-kasbon policy is still a separate future feature.
- Ruling: Supabase database image could not fit; use real auth/API services with a clearly labelled adapted foundational bootstrap — cost: actual full-stack reset/storage/realtime/default-grant compatibility remains unverified.
- Ruling: preserve duplicate0106 and recorded migrations; explicitly satisfy0068's fresh prerequisite in the disposable runner — cost: future clean CLI provisioning still needs its own reviewed migration-history/seed procedure.
- Ruling: keep fictional LOCAL services alive for parent's broader benchmark/combined-migration verification — cost: later source mutations prevent rerunning the pristine period test without resetting the exact local fixture.
- Ruling: delegate fresh build to the parent's final combined branch while its benchmark needs this dev server alive — cost: this harness-only continuation does not independently refresh build evidence.
- Harness-only repairs: PostgreSQL readiness must use TCP to exclude its temporary initialization server; accessible button names include decorative icon glyphs; Next streaming transitions need a rendered-text wait after URL changes; swap RPC returns a row, and approved status lives in a composite summary. Same-URL schedule import must wait for its actual POST response rather than an already matching success URL. These are harness/setup corrections, not application fixes or production-readiness evidence.

Remaining acceptance: eventual deployment target identity/schema/grants, clean full Supabase provisioning, actual stakeholder business comparison and separate production release/real payment decision. Local permission evidence does not prove every deployment's grant/schema drift or arbitrary system-wide deadlock freedom.
