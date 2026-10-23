# R02 — branch and daily sales drilldown

Base main: `e46f45e97ae2500b3aaade5e8a9e50915f9fcca3`. Extends the existing transaction-per-branch and detailed-sales reports; no new route, migration, authorization or data mutation.

The summary now filters all/one authorized-data branch by ID, separates duplicate branch names and includes daily totals in WIB. Branch links retain period/channel; day links open the existing document report for exactly that day, branch ID and channel. Existing legacy branch-name links remain supported. The detail filter retains its exact branch ID across date/channel resubmission.

Both reports retain the existing total-document basis: after discounts, including taxes/fees present in the bill, less known nonvoid returns attributed to the original sale. Pending POS payments and void clinic invoices remain excluded. The page labels that basis and explains that returns can update an earlier sale date; it is not a daily refund/cash-flow report. Cents remain visible rather than rounded to whole rupiah.

The shared WIB inclusive upper bound now includes PostgreSQL's final microsecond. Previously the detailed report cut off the final fractional second while the summary used milliseconds, so a drilldown could omit transactions in its own control total.

## Checks

- RED: five new page/loader fixtures failed against main; separate fractional-second/microsecond fixtures failed before the date fix. The invalid-channel regression also failed with its guard removed.
- Final focused run: 56 cases across six report/payment/HPP files. Final full suite: 353 files / 2,695 tests passed. Typecheck and scoped ESLint passed.
- Local production build passed before the final unavailable-option, invalid-channel and explanatory-text corrections; the final pushed commit's Vercel build is checked separately. No unnecessary second local build is claimed.
- Real page/loader tests cover duplicate branch labels, exact ID filters, retained branch/channel/day links, unavailable IDs, invalid channel rejection, cent totals/returns, 1,201 sales, unreadable clinic data, and end-of-day fractional/microsecond timestamps.
- Independent review found that a disabled selected unavailable option is omitted from native form submission, silently widening the report. JSDOM misses this behavior. Removing `disabled` preserves the unavailable ID; native Chromium verification confirmed submission of that ID plus the selected channel. Final review found no remaining important blocker.

All fixtures are fictional; no live business transactions or full hosted simulations were run. Main merge/deployment remains subject to the existing release-tool blocker. Rollback is a scoped code revert; no database rollback is required.
