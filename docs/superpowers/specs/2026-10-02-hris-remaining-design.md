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
