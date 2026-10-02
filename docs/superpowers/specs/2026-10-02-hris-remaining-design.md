# Remaining HRIS delivery

Authority: uploaded cloud roadmap and 2 October instruction to finish all outstanding work. Continue inline on existing isolated branch/draft PR 18, base 08c2b98. No new production release decision or real payments. The original September meeting spec remains unavailable. The older approved salary design remains binding until explicit changed rules arrive.

## Schedule swaps

Extend the published-schedule request workflow. Staff selects own cell and another active linked employee's published cell within one positively assigned active branch, same or different dates. Both shift definitions must be eligible for both employees on the receiving dates. Only today/future dates, no nonvoid attendance, no final payroll. The peer must explicitly accept with reason before HR approval; peer rejection and requester cancellation release pending cells. HR can reject stale requests. Neither participant may have another pending change/swap for either cell. Candidate discovery reveals only employee name and eligible published shift/date/version within the requested assigned branch, never salary/contact/bank fields.

Snapshot both employee identities, cells and shifts. Acquire actor profiles, employee rows and shift rows in stable order; configuration writers share existing locks. Recheck identity/scope after locks. Approval writes both cells, request and immutable event in one transaction. Any second-cell or audit failure rolls everything back. Changed cell/shift/identity, attendance or final period requires rejection/re-request. One winner for concurrent decisions.

## Recap

Replace the old monthly office-hour report with daily rows and monthly summaries derived from effective schedules, nonvoid sessions, approved leave and approved overtime. Preserve overnight timestamp duration and entry-date attribution across months; never invent legacy duration. Unscheduled attendance, unfinished/invalid/unknown legacy duration, attendance/leave conflicts and missing shift times are visible anomalies. Absence is only a past scheduled workday without attendance or approved leave; future dates are upcoming. Raw lateness seconds are report facts, not new monetary rounding policy. Worked duration and approved overtime are separate. UI and Excel share the same dataset and scoped backend, including complete results beyond 1,000 rows.

## Technical payroll/access completion

Restrict own employee, stored payroll, request and component data in the database; maintain authorized HR branch scope. Prevent staff spoofing employee IDs, approved status, installments and paid periods through old direct paths. Route requests/decisions through audited server-owned operations and preserve current business rules. Company payroll remains OWNER-only until a separate branch-wide source/settlement design is provided.

Make payroll calculation, corrections and finalization reviewable snapshots. A finalization must reject changed source/draft inputs and persist final slips, installments, reimbursement markers and a balanced journal together or not at all. Repeating finalization cannot duplicate settlement; financial/accounting locks and employee locks serialize with attendance/schedule mutations. Show source dates/activities and reasoned adjustments; finalized history remains immutable. New settings are effective-dated and existing values/defaults remain preserved.

## Required outside inputs

Changed kasbon/late/overtime/doctor rules and the incentive catalog are requested asynchronously, as is the separate demo identity. Finish all independent technical work while awaiting them. Do not silently activate guessed rates, convert historical debts, invent recipient allocation, or label unverified API/browser/production acceptance complete. Payroll/commission foundations can be configurable and preserve existing behavior; the new business examples require actual signed-off policy. Deferred statutory payroll, continuous tracking, cost allocation and quest scope remain outside the roadmap's delivery.

## Payroll integrity implementation amendment

Use a database-maintained global source revision and transaction advisory lock. BEFORE STATEMENT triggers on every existing payroll/commission input table acquire the same lock and increment the revision; RPCs reject an input revision changed while the server collected complete paginated data. Draft preparation is OWNER-only, validates complete active employee membership, source revision, expected run version, money arithmetic, settlement IDs/sums and reasoned adjustments, then writes all draft snapshots/audit in one transaction. Existing pure JavaScript salary/commission formulas remain the monetary authority; OWNER authorization is the trusted boundary for computed draft input, with raw inputs and outputs persisted for review.

Finalization consumes the saved settlement plan, revision and draft version. It holds the source lock, actor/employee/accounting locks, validates the stored complete company run, then writes installments, debt states, reimburse payment markers, balanced journal, final slips and audit in one transaction. Source writes within settlement legitimately increment the global revision while that transaction owns the source lock. Future unrelated source changes conservatively invalidate every open company draft; cost: owner must recalculate even when a change does not affect the chosen period. Existing operations that obtain row locks before the source lock may deadlock against finalization; PostgreSQL aborts one entire transaction and the UI asks to reload.

Collectors page parent and child source tables separately in stable unique ID order, reject all source errors, duplicates, gaps/limits and changed start/end revisions. Commission remains the confirmed existing percentage/nominal sale-line calculation; no new recipient sharing/rates are assumed. Final slips and final journal/settlement records are immutable; legacy drafts must be recalculated into reviewed snapshots before settlement.

## Independent effective configuration amendment

Implement append-only global/group policy versions using the six currently approved salary fields. No seed group, changed rate, kasbon cap, doctor fee or incentive recipient catalog is invented. A nonoverlapping dated employee group membership selects that group's effective rule; when absent, use the latest effective global rule, then the frozen legacy settings baseline. Existing legacy settings are kept as a fallback with no claim that their historical changes can be reconstructed.

Salary rules apply to each scheduled workday; approved overtime rows use their actual dates, with one final rounding of the weighted amount to preserve existing constant-rate arithmetic. Fixed component master and employee assignments receive append-only effective MONTH versions (monthly amounts, no unapproved daily prorating). Existing current component records are snapshotted as the legacy baseline; new components/bindings start only at their explicit month. Separate signed variable period components are scoped to one employee/month and audited. Settings/master edits are OWNER-only; assignment/variable component edits require scoped HR employee authorization. Financial changes cannot target an affected finalized period; finalized source snapshots stay immutable. All new source tables join the revision/locking boundary.

Current rate tables remain readable for legacy operations, but raw writes move together with their callers to dated audited RPCs. Commission master raw writes are closed to STAFF; global rules are OWNER-only and employee/branch-specific rules require scoped HR. Existing percentage/nominal and recipient semantics remain until the requested catalog arrives.
