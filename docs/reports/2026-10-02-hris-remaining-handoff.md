# HRIS remaining delivery — 2 October 2026

## Result and scope

Continuation of the supplied cloud roadmap, authorized to complete outstanding independent work. Base `08c2b98`, original clean checkout `b218041` untouched; isolated branch `codex/hris-meeting-followup`, existing draft PR 18. All changes are prepared source and migrations; no remote database write, production deployment, real payroll settlement, payment or merge was performed.

| Requirement | Delivered behavior / boundary |
| --- | --- |
| Two-person schedule swaps | Staff chooses published cells within one assigned branch; peer consent precedes HR approval. Both cells/status/audit commit together. Stale definitions/identity, started attendance, final periods and conflicting single/swap requests deny. |
| Daily/monthly recap and Excel | Complete scoped source, approved effective schedule, explicit overnight duration attributed to entry date, raw late duration, approved leave/overtime, anomaly flags, same-source Excel. Unknown legacy hours and ambiguous historical branch are explicit. |
| Sensitive privacy and requests | Employee/payroll/request/component reads scoped in DB. Audited request submission/decision rejects spoofed identities/raw approvals. Minimal operational directories replace broad employee reads. |
| Closed cashier shortage | Audited employee debt + balanced journal atomic and unique per closed shift. Failure is visible with scoped HR retry queue; cashier closure remains an earlier separate transaction. |
| Payroll source integrity | Complete stable paginated parent/child sources with hard error/count/gap checks, void exclusion and WIB attribution. Draft source snapshot, version and reasoned correction persist together. Global revision serializes all identified monetary inputs. |
| Payroll settlement | OWNER-only RPC consumes saved draft settlement plan; source/version/accounting checks, installments, reimbursement paid markers, balanced journal and immutable final slips commit together. Duplicate/concurrent settlement yields one winner. |
| Effective configuration | Global/custom-group six existing rules selected per work/overtime date; dated memberships; monthly master/employee fixed versions and audited employee/month variable components. No changed meeting rates seeded. Final source history remains immutable. |
| Existing commissions | Retained existing percentage/nominal and recipients; complete source collection and itemized snapshot, staff master-write closure and scoped HR rules. New catalog/group eligibility/multiple-recipient expansion awaits supplied rules. |

The original September meeting requirements file remains unavailable; the uploaded roadmap and older approved design bound the implementation. Prior profile/week/Excel/overnight/single-change work and earlier review limits are documented in the three 1 October handoff reports; this delivery resolves their sensitive-access and nontransactional settlement blockers for the implemented local contracts.

## Verification

Latest source tree after the Excel reference follow-up: 156 Vitest files / 1,327 tests pass. `npm run build` exits 0 (Next15.5.25); `npx tsc --noEmit` after build exits0; `npm run lint` exits0 with12 preexisting warnings and no errors; `git diff --check` clean.

`python3 scripts/test-hris-completion-db.py hris_review_privacy.sql hris_payroll_effective.sql hris_payroll_settlement.sql hris_sensitive_access.sql hris_schedule_swaps.sql hris_attendance_recap.sql hris_schedule_requests.sql hris_attendance_sessions.sql hris_attendance_json_claims.sql hris_attendance_final_resolution.sql hris_attendance_legacy_correction.sql` passes all eleven suites. It applies actual relevant baseline and prepared migrations inside its own disposable PostgreSQL16 container with network disabled, no exposed ports/volumes, fictional identities/data, and cleanup in finally. It does not read Supabase credentials.

Meaningful regressions include missing-RPC/module RED→GREEN, real action/collector errors, 1,102-row parent/child completeness, privacy/forged write denials, injected journal/audit/second-cell failures, adjusted saved installment50 versus old recomputed100, immutable final slips/journals, and independent connections racing swap submission/approval, draft preparation/finalization and actual accounting period close. Atomic failure leaves the corresponding documents/financial records unchanged.

Evidence logs in this execution workspace: `/workspace/hris-review-final-test.log`, `/workspace/hris-review-final-db.log`, `/workspace/hris-review-final-build.log`, `/workspace/hris-review-final-tsc.log`, `/workspace/hris-review-final-lint.log`. They are session artifacts; durable commands/results and review findings are recorded here, not dependent on future availability of those logs.

## Release and acceptance checklist

- [x] Independent implementation tasks and local automated contracts.
- [x] Final independent whole-delivery review and one Important/Critical RED→GREEN fix pass; final full checks green.
- [ ] Confirm changed money policy: effective date/eligible employees for monthly kasbon and repayment; lateness interval/seconds/cap basis; overtime groups/partial units/caps; actual doctor fee basis/rates/exceptions. Defaults and historical debts stay under existing rules.
- [ ] Supply incentive catalog: source items/services/categories/brands, eligibility groups/effective dates, amount or percentage and multiple-recipient split versus full award. New catalog-specific examples remain unimplemented until supplied.
- [ ] Identify a separate Supabase demo project and fictional staff/admin/owner accounts through the approved secret mechanism. Runtime reports configured public variable names ready; that does not establish target identity. No unknown remote target was probed.
- [ ] Validate the full deployed migration chain in that disposable demo database. Release application and schema together: attendance20261001090000, single changes20261001100000, swaps20261002090000, recap20261002100000, sensitive access20261002110000, settlement20261002120000, effective configuration20261002130000, review fixes20261002140000 (requires existing20260930030129 employee import baseline), after applicable existing baseline migrations. Version/config/settlement RPC changes intentionally remove raw legacy write paths.
- [ ] Authenticated API/browser acceptance: own/foreign staff; own/other branch ADMIN; OWNER; cookies and GPS; profile and weekly Excel round-trip; swap consent/approval; recap/export; source inspection; dated rules; prepare/correct/finalize and reload failures; shortage recovery.
- [ ] Run signed-off fictional pay/incentive examples and one parallel payroll period against agreed manual amounts; confirm rounding/account mapping and all residual debt before any real adoption.
- [ ] Separate production release decision, backup and migration/deployment procedure. This draft PR is not a production-readiness claim.

Deferred original roadmap scope: franchise/clinic cost allocation, continuous location tracking, quest linkage, statutory payroll/PPh21/BPJS/face verification and full product parity. The previously deferred Excel-template branch-reference sheet was completed in the follow-up below.

## Final review

One fresh independent reviewer examined `b218041..69f75e5` (concentrating on the continuation since08c2b98), inspected actual callers/SQL, and independently reproduced SQL and collector cases. Initial verdict: changes requested, four Important findings and no Critical. Author performed one regression fix pass; no second review/claim of reviewer approval at the patched head. Tested implementation commit `227010f` follows task commits8dda36c,1ae140a,6c98ee0,98528b9,69f75e5.

| Finding | Verified disposition |
| --- | --- |
| Imported employee JSON bypassed branch privacy | Actual legacy import migration added to runner. Foreign ADMIN bank/NIK read RED→GREEN; scoped read/insert plus actor/employee write locks. Controlled scoped import bootstraps employee/assignment before private details; STAFF and foreign ADMIN denied, permitted ADMIN import verified. |
| Extending membership crossed a finalized month | Locked prior row, guard earliest changed day after earlier inclusive end. Cross-final extension RED→GREEN; rejected edits preserve membership/audit/revision. Shortening protected and future extension/shortening permitted. |
| Restricted employee mapping silently lost operational commissions | Minimal identifier directory, complete paging and safe name selectors replace sensitive-row reads. Real cash/reseller collector regressions RED→GREEN restore10 instead of0. DB keeps sensitive row hidden and does not expose salary or anonymous directory access. |
| Source page explained effective/group pay with legacy baseline | Saved dated policy and approved overtime input/rates rendered from snapshot. Boundary render RED→GREEN; no current configuration query can rewrite the explanation. |

The reviewer suggested saved component/reimbursement lines as Minor. Author regraded Important against the roadmap's source-dispute requirement and included it in the same pass: saved fixed/period component amounts and dated reimburse claims render RED→GREEN. Final whole suite156files/1,326 tests, eleven SQL suites and races, build, subsequent TypeScript, lint and diff checks pass.

Deferred current-review Minor: compressed SQL/pages impede future authorization review. The prior Excel-template branch-reference sheet Minor was subsequently completed in the follow-up below. The component/reimbursement suggestion is resolved, not deferred.

Declined-to-judge items were explicitly ruled on: unanswered policy/catalog/demo identity, production/live acceptance, trusted OWNER computation, conservative revision/date guards, monthly fixed components, unknown legacy baseline and separate cashier-close recovery. Their costs and remaining gates are below.


## Rulings and costs

Every implementation ruling, in order, preserved from this plan's ledger:

- Ruling: user instructed completing all unfinished work; supplied roadmap authorizes phased implementation and existing inline execution. No repeated brainstorming/artifact approval gates — cost: missing meeting spec may need later adjustments.
- Ruling: three financial/catalog/demo questions requested early; continue all independent technical work. No guessed changed money policy or unknown remote writes — cost: dependent examples/live acceptance remain blocked until answers.
- Ruling: extend swaps with explicit peer consent and same assigned branch, permits different dates — both people's obligations require informed consent — cost: cross-branch swaps require separate design.
- Ruling: skill shell helpers unavailable in cloud package; use manual equivalent ledger/task briefs — cost: tool helper bookkeeping unavailable.
- Ruling: pending cells shared across swap/single requests using employee locks and single-request insertion trigger — preserves existing RPC contract — cost: configuration deadlocks fail with reload rather than partial success.
- Ruling: recap exposes raw lateness seconds and known worked minutes, separately approved overtime; never invent legacy hours or apply unconfirmed monetary rounding — cost: report facts may differ from existing minute-floored pay calculation until policy confirmation.
- Ruling: unknown historical branch on global multi-assigned unclocked schedule is flagged and cannot count as branch absence; foreign hidden historical sources fail whole affected report for ADMIN and require OWNER — cost: HR may need owner help to resolve older cross-branch history.
- Ruling: financial/treasury roles retain established OWNER/ADMIN/FINANCE rights but STAFF raw configuration is closed — cost: legacy staff API treasury edits now denied.
- Ruling: safe operational directories expose only names/jobs/published schedules/assigned branches, never salary/contact/bank/NIK — cost: callers must use directory views for other employees' names.
- Ruling: cashier closing remains an existing separate transaction; audited shortage debt+journal are atomic with explicit HR recovery queue on failure — cost: closure can succeed before financial posting; user sees failure and pending recovery instead of silently converting employee debt into company expense.
- Ruling: global payroll journals restricted to OWNER, scoped stored slips still readable by HR/FINANCE — cost: whole-company salary journal visibility cannot be given to branch staff/finance without separate allocation design.
- Ruling: global source revision and BEFORE STATEMENT lock preserve current trusted OWNER-computed pure formulas and reject interleaved/truncated/error reads — cost: unrelated input changes invalidate drafts and some old lock orders may abort/reload on deadlock.
- Ruling: legacy drafts require recalculation into source snapshots; all raw paid/installment/final and private financial journal mutations are removed together with caller migration — cost: old direct API paths now denied.
- Ruling: existing exact salary/commission arithmetic is retained, with actual entry timestamps fixing midnight lateness and voided-paid invoice exclusion/WIB source dates — cost: correcting previously erroneous source attribution may change newly calculated draft money; final history stays untouched.
- Ruling: prior final-payroll test fixtures now use savepoint rollback instead of deleting final payroll, preserving actual immutable final contract — cost: fixture cleanup must respect strengthened history rules.
- Ruling: fixed monetary components are monthly effective versions, not daily prorated guesses — cost: midmonth fixed-benefit changes must be represented as a reasoned one-period variable adjustment.
- Ruling: legacy configuration is explicitly an unknown-history baseline; future versions append even for same effective date and latest planned master metadata is labelled — cost: old changes cannot be reconstructed, master list is not the payable historical amount.
- Ruling: global final-period guard conservatively protects dates for all groups/master components — cost: a new unrelated rule may require a future month after an existing company final.
- Ruling: unavailable code-reviewer cloud reference is replaced by the skill-required implementation/requirements/base/head brief — cost: reference-specific optional formatting is unavailable; one fresh whole-delivery review is still required.
- Final: Ruling: reviewer suggested component/reimbursement source lines as Minor; regrade Important because source disputes require historical item amounts/activities promised by roadmap — include saved details in same fix pass — cost: longer source page.
- Final: Ruling: unanswered monetary/catalog/demo inputs remain gates; implementation stands under existing approved policy, no invented activation — cost: signed-off examples and live acceptance cannot finish until inputs arrive.
- Final: Ruling: production/API/browser/payment judgments set aside; local SQL and real functions prove only tested contracts — no production-readiness claim — cost: separate demo and release validation still necessary.
- Final: Ruling: trusted OWNER computation boundary, global revision/date conservatism, monthly components, unknown legacy baseline and separate cashier closure remain explicitly accepted implementation tradeoffs — cost: owner review/recalculation, unknown old configurations and possible shortage recovery remain necessary.
- Final: Ruling: scoped employee import requires controlled definer bootstrap because fresh employee has no readable assignment yet; shared actor/source locks and explicit HR branch checks precede insertion, assignment before locked scoped details — cost: import implementation must retain all authorization checks if extended.
- Final: Ruling: minimal profile attribution uses operational directory/authorized historical transaction branches and returns only employee/profile IDs — cost: authorized operational users see those identifiers; existing wider transaction permissions are not a new company-wide HR-data grant.

## Per-task evidence

- Task 1: complete; absent swap RPC RED→GREEN; six real action tests RED→GREEN; full suite 147 files/1,276 pass; tsc and diff check pass. New swaps + old single requests + all four attendance SQL contracts pass. Two simultaneous submissions one pending pair; approvals one winner, both cells exchanged, exactly three events. Second-write/audit injection rolls both cells and status back; final, started attendance, stale shift/identity/foreign HR deny. Commit recorded in git. Reviewer deferred until whole remaining delivery per inline skill.
- Task 2: complete; absent recap source/helper/export RED→GREEN; 13 new actual helper/export tests pass. Full suite149 files/1,289 tests, tsc/diff pass. SQL own/HR/foreign/anonymous, hidden historical source fail-closed, minimal non-salary payload, 1,102 employees retained; all prior suites and swap concurrency pass. Commit recorded in git.
- Task 3: complete; sensitive full-row/global salary journal and forged request RED→GREEN; nine real request actions and cashier failure regression pass; full app150files/1,299 tests and tsc/diff pass. All eight SQL contracts plus two independent swap races pass. Missing account and injected decision/shortage audit failures roll back documents+journal; closed shortage remains discoverable and retry creates one debt/journal. Existing identity-overwrite test now checks hidden row as database owner after also asserting staff cannot read it.
- Task 4: complete; raw OWNER installment/final bypass and five actual source failures RED→GREEN; real final action failure/stale/ADMIN gates RED→GREEN; explicit midnight lateness RED→GREEN while preserving legacy-minute fallback. Complete 1,102 parent and child source regressions, paid-void exclusion and WIB attribution pass. Full app154files/1,314 tests; build exits0 and artifacts include new routes; tsc rerun after build passes (parallel build/tsc previously raced generated .next types; no source error). All nine SQL suites pass; journal/audit failure rollback, saved 50-capacity settlement instead of old recomputed100, immutable slips/journal/employee history pass. Two preparation and finalization transactions yield exactly one winner; real close writer acquires shared serialization boundary first and rejects entire competing payroll with every draft/debt unchanged.
- Task 5: complete; effective-date/module and real SQL missing-RPC RED→GREEN; daily absence and weighted overtime RED→GREEN. All 155 files/1,322 tests pass, all ten SQL suites plus real swap/payroll/period-close races pass; build exits0 with 12 existing warnings, subsequent tsc exits0, diff check clean. New money/catalog inputs remain gated.

## Final fix evidence

- Final: fixed imported JSON privacy — hris_review_privacy.sql foreign ADMIN bank/NIK read fails RED then GREEN; foreign/staff insert/read deny, scoped ADMIN import+assignment/details and OWNER reads pass. Baseline actual import migration now included in runner.
- Final: fixed membership end historical gap — hris_payroll_effective.sql cross-final extension RED→GREEN; shortening denies with unchanged audit/revision; future extension/shortening passes. Earliest changed day derived from locked existing inclusive end.
- Final: fixed hidden operational seller mapping — real komisiPeriode cash/reseller source cases RED→GREEN (0 to10); DB minimal view preserves hidden sensitive row while exposing authorized identifier mapping, no salary field or anonymous access. Name callers use safe directory.
- Final: fixed applied-rate explanation and source details — real saved-page render RED→GREEN for saved boundary/group rates and dated approved hours; fixed/period components and dated reimburse claims shown from snapshot only, no current-config reads.
- Final: whole one-pass fix verification: npm test156files/1,326 PASS; eleven actual SQL suites plus swap/preparation/finalization/period-close races PASS; npm run build exits0; subsequent tsc exits0; lint exits0 with12oldwarnings; diff check PASS. No second reviewer under executing-plans.

## Existing-goal continuation: Excel branch reference

The continuing objective was to finish remaining authorized work. Completed the blank-template branch-reference minor: template and export now include one Cabang sheet with the selected authorized branch ID/name supplied by the server, and UI instructions reference that sheet. The same Jadwal parser and server import validation remain in use. No financial rule, database migration or production action was added.

The actual blank-workbook regression failed first because the Cabang worksheet was absent, then passed with its selected ID/name and empty Jadwal round-trip. Targeted14tests and full156files/1,327tests pass; fresh build, subsequent TypeScript, lint (0errors/12existingwarnings) and diff check pass. No SQL changed in this follow-up; the earlier eleven SQL contracts/races remain the recorded DB evidence and were not needlessly repeated. New logs: /workspace/hris-branch-reference-{red,green,full-test,build,lint,tsc}.log.

Ruling: include only the selected authorized branch in Excel references, deriving its name from the existing server-resolved permitted list — gives HR the ID needed for a blank template without expanding branch exposure — cost: future multi-branch imports need a separately scoped reference design.

Remaining objective is blocked on outside inputs: final monetary policy/effective dates/eligible groups/caps, incentive catalog and recipient allocation, and separately identified demo with fictional roles. Three concise input questions were issued again during this continuation. The uploaded roadmap explicitly forbids inventing unresolved payroll policy. Current configured public variables do not prove a separate demo identity. Production release and real-payment adoption retain the original separate decision requirement. SQL readability remains a nonfunctional deferred Minor; it does not authorize guessing policy or writing an unknown remote target.


## Independent board integrity follow-up (2026-10-02)

While policy/catalog/demo inputs wait, the known nontransactional HR board save
was replaced with one audited batch transaction and original browser cell
compare-and-swap. Stale cells and any later write/audit failure reject or roll
back the whole batch; semantic no-ops preserve versions. Fresh scope/action
regressions, twelve SQL suites and real board/approval/access-revocation races
extend the earlier evidence. See `2026-10-02-hris-board-atomic-handoff.md` for
current verification, the independent review and its one fix pass, migration
`20261002150000`, the retry limitation, and unchanged demo/release gates.


## Schedule source-order follow-up (2026-10-02)

Migration `20261002160000` resolves the documented board-versus-approval source
lock inversion for single/swap mutations. The latest definitions also improve
the readability of these four RPC implementations; broader legacy SQL/page
readability remains deferred. All twelve SQL suites, prior races and eight
new forced lock interleavings pass; fresh application suite157files/1331tests
passes. A fresh independent review found no actionable issues. Detailed
scope, costs, reproduction and release gates are recorded in
`2026-10-02-hris-schedule-lock-order-handoff.md`.
