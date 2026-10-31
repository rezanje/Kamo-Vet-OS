# Promo Bolt / Cat Choize — scoped quantity pool

## Approved behavior
Andri explicitly requested implementation and activation before **1 November 2026 07.00 WIB**, after confirming that variants may mix within a brand, but Bolt must never combine with Cat Choize. Two separate named groups:
- Bolt Ikan, Ikan Salmon and Donat **800gr**.
- Cat Choize Adult Salmon and Tuna.

Each group: **2 PCS Rp38.000; 6 PCS Rp110.000**, repeated six-packs then two-packs, leftover PCS at normal price. Example eight PCS = Rp148.000. Automatic all branches, **2026-11-01–2026-12-31 inclusive**. Only official PCS/factor1/normal Rp20.000 qualifies; SAK bulk remains separately priced. No item master price/brand changes.

## Design and integrity
- Opt-in `quantity_pool` v1; explicit immutable reviewed code scopes `bolt_800gr` and `cat_choize_adult` prevent cross-brand targets despite missing legacy brand metadata.
- Shared client/server whole-pool selection and exact integer largest-remainder allocation, ties on original source position. Duplicate SKU rows retain their own identity; manually discounted quantities do not subsidize a pool.
- Original stock/FIFO/HPP/payment/actor/finalization RPCs retained. New finalization guard independently checks current masters, targets, dates, branch, official unit/price, exact allocations and stock/HPP provenance.
- Backoffice potentially covered receipts use invoker-only atomic original stock+finalization, even when a legacy promotion wins or the pool was not active at quote time. Rejected stale pricing cannot leave orphan stock.
- New receipts retain immutable source-line paid-net snapshots; original refund quote and posting expressions consume the same entitlement. Historical no-snapshot behavior remains unchanged.
- Existing full cancellation refusal for promo/voucher receipts remains; no new cancellation permission. Partial/full returns and payment replay were exercised.
- Legacy CRM editing of saved pool configuration is refused authoritatively in its locked DB writer. Header activation/deactivation remains separately supported. One active master per named scope is unique even across concurrent transactions.

## Evidence
Base `b70c1629a583dfa01acabd2149fb7979cfb9bcac`. New forward migration `20261105020000_quantity_pool_pricing.sql` SHA256 `8b795fa26db16b8c9ab36cb900768b9ee393daeba9e58d8b05c2e01928b60973`; original installed migration files remain byte-identical.

Evidence lives outside repo at `/opt/data/kamo-promo-bolt-cat-choize/evidence`:
- Initial original deployed-calculator probe reproduced missing mixed-variant discount.
- Incremental TDD frontend/backend logs, 91 native SQL assertions on PostgreSQL17.11 with 355 original migrations plus forward last; real original public-role RPCs with fictional data.
- Four independent review findings reproduced RED and fixed in a third context. `independent-closure.json` binds final production sources; no remaining material concerns/errors. Separate two-session proof demonstrates activation waits and rejects a second active scope.
- Parent final full Vitest: **5932 PASS / 0 FAIL / 10 skipped**; focused results overlap, never sum. Final full TypeScript and changed-file ESLint passed. Production-build and complete source-hash status are recorded in `final-local-checks.json`, not inferred from this note.
- Six actual rendered client fixtures, kasir/backoffice 2/6/8, checked in Chromium. These are fictional static UI proofs, not an authenticated production checkout.
- Hosted rollback-only compile and actual two-master activation using the real five NULL-brand target rows succeeded; no lasting masters, table, tracking, sales or stock were created. Original function definitions read back unchanged after rollback.

## Release order
Exact-head CI → only forward DB migration/tracking → exact definitions/ACL/readback → normal protected PR merge → exact Production READY+alias → create inactive masters with complete targets and activate both atomically → read back every target/rule/date/branch and recheck live pricing. No early master activation or unrelated branch/migration included.

## Rollback and limitations
First deactivate these two masters before reverting app code. Keep snapshots and correct refund compatibility for any versioned receipts already posted; never delete financial history or return to gross-ratio pricing for those receipts. No resets, imports, account changes or money/stock data repairs are part of this release.

Authenticated browser/PostgREST and Andri's real staff acceptance remain distinct from source, native SQL, deployed identity and master readback. Refresh the kasir page before use; stale quotes must be rejected/refreshed rather than silently under/overcharged. Legacy CRM summary may show supporting nominal metadata; the named packages and authoritative rules determine actual pricing.
