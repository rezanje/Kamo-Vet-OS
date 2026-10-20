# Bank transfer date validation follow-up

Local-only extension to the previously reviewed transfer lifecycle. The unreleased production migration now rejects non-finite posting dates and rejects correction/cancellation of legacy sources whose dates are non-finite or after the current Jakarta business day. Existing exact-request replay remains a read-only return of its original confirmed result; closed-period behavior is unchanged.

Review surface: this document, `supabase/migrations/20261020170538_atomic_bank_transfers.sql`, and `supabase/tests/bank-transfer-lifecycle.sql`. The application action and RPC argument contract are unchanged.

`python3 scripts/test-feedback-expense-postgres.py` passed all 26 required migrations, six financial acceptance SQL suites, and real concurrent transfer/opening-balance retries. New regressions exercise negative-infinity creation, future and negative-infinity legacy-source cancellation, and absence of durable request records after rejection. The future-date test uses Jakarta tomorrow rather than relying on the database session timezone. The native runner uses a reduced financial dependency fixture; this result is not the full combined release suite.

Independent specification and quality reviewers approved the two-file change after inspecting the implementation and test evidence. Neither reviewer reran the database suite. No production migration or deployment occurred.
