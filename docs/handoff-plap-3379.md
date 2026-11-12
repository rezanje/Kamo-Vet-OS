# Promo 0415: independently usable Excel master checkpoint (LOCAL ONLY)

## Delivered scope

`/crm/promo` → **Impor daftar promo (banyak barang)** → download the real template → fill one row
per SKU → preview with red errors → inspect same-name/target/value differences →
save the entire valid file through `public.import_promo_master(jsonb)`.

- Active OWNER/ADMIN only; existing central master-management policy is retained.
  Explicit branch targets must be active and accessible (including operational-header
  restrictions). `branch_ids: null` and `[]` mean all branches, as in existing masters.
- One promo can target several products/services, including clinic items. Existing
  main's clinic pricing engine consumes the same `promos`/`promo_items`; no second
  pricing engine is introduced here.
- Same normalized name updates the existing UUID and replaces its target set.
  Repeating an upload does not duplicate master/targets. Ambiguous existing names,
  locked per-SKU imports, unsupported package mode, unknown/inactive catalog entries,
  invalid amounts/dates and invalid batch limits are rejected.
- All-or-nothing transaction: an invalid later master rolls back earlier inserts,
  updates and target deletions. Raw target rows are bounded at 500, not merely unique
  IDs. All batch name locks are acquired in stable order before writes, preventing
  opposite-order overlapping imports from deadlocking.
- Reuses installed expiry-on-access / activation guards. Expired end dates are now
  red in preview too. No cron, invoice, money, inventory or admission change.

## Why attribution/reports are explicitly deferred

The original full candidate at `cb1135bad7f67405074705fe70f1fdef6d85b936` compiled
successfully after the complete supplied-main chain (337 migrations including 0415).
That was NOT sufficient: original public `clinic_post_invoice` calls as STAFF and
DOCTOR each persisted Rp10,000 against an inactive, expired, ineligible 1% promo.
Thus the draft report's “exact” per-program attribution was caller-controlled.

The sibling trusted-discount 0414 source `84f37f9a` was read, NOT integrated. Its
remaining real points/grouped-voucher compatibility failures cannot justify trusting
caller amounts or shipping a new dependency here.

Consequently this checkpoint restores **all billing/action/report source and tests
to supplied main** and installs only the master import portion of unapplied 0415.
No untrusted attribution columns/writers or new report claims are installed. Existing
main reports remain unchanged; the agreed full per-program Excel reports are NOT
complete in this checkpoint.

The full original implementation AND its acceptance cases are preserved byte-for-byte
in `docs/deferred/promo-reporting/full-candidate-cb1135ba.patch`, the original SQL
in `original-unapplied-0415.sql`, and Git history at the immutable SHA above. The
executable `scripts/test-deferred-promo-attribution-postgres.py` retains the two
security assertions as real FAILs, not expected-error successes or skipped tests.
Other pending acceptance remains: trusted item/program value eligibility, public
post/correct/reissue lineage, historical unknown attribution, exact POS voucher/manual
separation, and a complete server export (the old displayed/exported detail had a
400-row cap). No full-report claim is made for that capped output.

## Verification / reproduction

All commands below must wrap their ENTIRE process in the shared OS lock:

```sh
flock -w 120 /opt/data/kamo-heavy-test.lock env NODE_OPTIONS=--max-old-space-size=1024 KAMO_PROMO_NATIVE_ARTIFACTS=/opt/data/kamo-promo-final-native-workbook node node_modules/vitest/vitest.mjs run src/lib/__tests__/promo-master-import.test.ts --pool=forks --maxWorkers=1
flock -w 120 /opt/data/kamo-heavy-test.lock python3 scripts/test-promo-master-import-postgres.py --excel-plans /opt/data/kamo-promo-final-native-workbook.json --json /opt/data/kamo-promo-final-import-native.json
flock -w 120 /opt/data/kamo-heavy-test.lock python3 scripts/test-promo-master-import-postgres.py --lifecycle --json /opt/data/kamo-promo-final-lifecycle-native.json
flock -w 120 /opt/data/kamo-heavy-test.lock env NODE_OPTIONS=--max-old-space-size=1536 node node_modules/typescript/bin/tsc -p tsconfig.promo-checkpoint.json
# Intentionally RED deferred security acceptance, not part of the import readiness claim:
flock -w 120 /opt/data/kamo-heavy-test.lock python3 scripts/test-deferred-promo-attribution-postgres.py --json /opt/data/kamo-promo-final-deferred-red.json
```

Native PG17 uses the complete original chain, exact `hosted_auth_uid.sql`, separate
BEGIN/COMMIT per migration and platform shims ONLY. Money cores, triggers, RLS, stock,
FIFO/HPP and journals are original. Authenticated public calls use only modern
`request.jwt.claims`. Two-session import concurrency requires exact blocking PID,
`wait_event_type=Lock` and non-null wait event; no sleep-only/retry “proof”.
The workbook bridge hands the real template/parser/review output into the public RPC
and reads back its master/targets. It is not a mocked RPC or a browser/PostgREST test.

Final exact-SHA commands/counts/results: `/opt/data/kamo-promo-final-native-results.json`.
Release report: `/opt/data/kamo-pr-promo-final-native.md`. Original RED and failed
fixture attempts remain separate `/opt/data/kamo-promo-final-*` artifacts. Fixture
mistakes (package activation prerequisites, guarded direct status changes, missing
interactive psql newline) were corrected, not relabeled as business failures.

## Integration and release boundary

Normal local merge of supplied main `c3b58ad4f68968937a2518d362dc439f0737a9fd`, merge
commit `cb1135bad7f67405074705fe70f1fdef6d85b936`. Frozen main migrations and actual
shared outpatient/inpatient `PaymentPresentation.tsx`/CSS remain unchanged. Only the
unapplied candidate `20261104150000_promo_atribusi_klinik_dan_impor_daftar.sql` changes
SQL; historical filename retained for queue coordination, narrowed scope explicit.

NOT live, NOT installed, not the full agreed feature. No network, hosted reads/writes
or preflight, credentials, installs, push/PR/deploy, sibling/profile edits, full build,
full-project typecheck or authenticated UAT. Scoped targeted typecheck is not full CI.
Import can be released independently after the remaining hosted backup/preflight,
exact-head CI and installation/readback gates; full attribution/report work stays held.
