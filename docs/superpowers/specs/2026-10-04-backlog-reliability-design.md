# Remaining backlog: reliable WhatsApp reads and local acceptance

Date: 4 October 2026. Base: `b84f410`. The user authorized completing all feasible remaining work, selected OWNER/FINANCE for HPP, retained existing payroll rules, and confirmed no separate remote demo is available.

## Outcome

WhatsApp reminders must never be decided from an errored or silently truncated source. Complete all seven existing reminder triggers without changing their dates, wording, current-owner selection, or duplicate/retry policy. All verification uses fictional data and a mocked outbound provider; no real messages are sent.

Read settings with an explicit error check. Read each source in stable ID order, 500 rows per page, with an exact total and a maximum of 50,000 rows per source. A missing/changing total, repeated ID, missing row, cap exceedance, or query error aborts before creating any delivery log. Keep duplicate unique-key behavior, but expose other log insert/update failures instead of claiming success. Manual and cron callers return an actionable failure.

The engine keeps its current one-attempt-per-event behavior: provider failures are recorded; no unapproved automatic resend is introduced. Settings disabled produces no reads or sends. Provider acceptance is distinct from a real phone receipt.

## Acceptance

Exercise seven triggers and WIB midnight; ownership transfer; disabled settings; >1,000-row recent activity preventing a false lapsed reminder; settings/page/count/log errors; duplicate execution; provider failure. Re-run the application suite, lint, TypeScript and build.

Existing sales-unit work is continued in a separate sales worktree; purchase, recurring, reports and HRIS each have separate implementation branches. A local browser performance check may run once the fictional authenticated stack is available; record hardware/data/cold-warm conditions rather than extrapolating to production.

## Boundaries

No production data mutation, secret inspection, external send, invented financial rates, or recurrence extension. Production activation of WhatsApp still requires a configured sender and an approved recipient. Database-dependent feature release requires successful schema migration and deployment together.
