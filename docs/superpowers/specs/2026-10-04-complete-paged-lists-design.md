# Complete, bounded operational lists

Actual fictional local benchmark: 1,200 customers/pets and stock rows plus 350 medical records exposed silent 1,000/300-row truncation and large rendered customer tables. Existing user authorization is to finish feasible backlog work; this repair keeps current roles, RLS, units, and dates.

Customer summaries and search use all eligible customers; medical summaries/search use all eligible visits with medical records, including existing pet scope; stock matrix uses all eligible stock rows. Read these sources in stable 500-row pages, requiring exact consistent counts, expected page lengths, and unique nonempty IDs. Maximum is 10,000 rows per source; exceeding it or any failed/incomplete read visibly fails rather than presenting partial totals. Equal-count concurrent edits are not a database snapshot, although duplicate/short/changing-count results are detected.

Render at most 50 rows. Customer paging is local, resets when search changes, and keeps summaries based on all customers. Medical GET links preserve q and pet. Selected warehouse stock uses server range reads of 50 with exact count and updated_at/id ordering; matrix GET links preserve wh=all. Invalid/out-of-range pages reset to page 1. Stock quantities stay in existing base units. No database migration, external calls, dependency change, or real-data fixture.

Acceptance: beyond-old-cap records remain searchable, full totals remain truthful, 50-row table pages navigate correctly, and count/read/duplicate/cap failures cannot show a partial list. Browser checks use isolated fictional local Auth/PostgREST and a separate application port.
