# Clinical/UI/CRM/HR lane — terminal inventory, 23 October 2026

Read-only source: canonical Checklist!A1:N75, live read on 23 October after PR122 publication, spreadsheet `1opWVBMSQ3RHdtwrDefsSBM4Quc9H5zJg1RUNkr0zTFQ`. Parent owns Sheet writes/checkmarks. This inventory covers 35 IDs in this lane; it does not claim all 74 items or the finance/import/inventory release lane complete. Earlier checkpoint documents remain historical evidence, superseded only by the specific newer candidates below.

Main last verified `e46f45e97ae2500b3aaade5e8a9e50915f9fcca3`. No target migration, merge, deployment or new full workflow simulation is performed here. Prior automatic-review denial of PR103 main integration remains parent/release-lane owned; it is not retried or bypassed.

## Released code, user simulation deferred — 8 IDs

| IDs | Current supported scope / evidence | Remaining |
| --- | --- | --- |
| U01, U02 | Released numerical input behavior and directly typed quantity | User workflow verification remains deferred; no new reported code defect reproduced in this pass. |
| U06 | Existing CRM category hierarchy/subcategories preserved by PR96 and clinical material controls PR101 | Preservation/validation requirement, not a request to invent a parent-only mapping. Real target master-data validation remains separate. |
| C01, C02 | PR100 authorized audited promotion editing; PR96 promotion category information/filter | C03 bulk import and new campaign/package semantics are separate. |
| K04, K05, K08 | Released clinical materials, admission readiness PR98 and draft/invoice/payment consistency fixes | No blanket UAT or paid/closed-to-inpatient policy claim. |

## Code-complete candidates awaiting integration — 10 IDs

| IDs | Candidate / exact scope | Dependency |
| --- | --- | --- |
| U03, U04, U05 | Bounded menu matrix in PR117/118 plus independent PR111/113: separate item names/codes, checked complete source lists, searchable/filter-preserving multi-selection | Integrate the documented independent sources as well as the main candidate spine. This is not an unlimited global-selector rewrite. |
| H01 | PR118 `2ab944dfa8f4f3cfb0fdc69414a5d9aedeb72b01`: edit named fixed allowance master without losing employee context | No schema change or H02–H06 automation. Exact-head preview SUCCESS. |
| K10, K11, K12 | PR105 `94f89eb7bea0d4d3156750a222ecf0882c9c1d92`: saved usage instructions, visit-linked prescription print, therapy field below diagnosis | Its therapy-note migration must precede its app reader/writer; no target application here. |
| S01, S02, S03 | PR122 `7440af9087e7841984c560007054b71e42da5e73`: independent service-row doctor/non-doctor slots, separate repeated services, blank-only bulk fill, logged-in cashier distinct from PIC/performer | New local-tested migration; source snapshots and replay integrity documented in PR122. No historical attribution backfill. |

PR122 exact-head preview reached **SUCCESS**: https://vercel.com/kamo-group/kamo-vet-os/4ENwwab7phF9iQrnbpRBUTL5aF5j . PR118 exact-head preview is also **SUCCESS**: https://vercel.com/kamo-group/kamo-vet-os/7f8FJksRQ1bmSMCXsxKZtcTBsndP . Neither means main deployment. PR122 passed 301 affected tests/35 files, lint/build/post-build typecheck and 4 isolated SQL suites across 238 repository migrations. Independent final review had no outstanding P1/P2; its 37/3 tests overlap root tests.

## Implemented slices with explicit remaining decisions — 3 IDs

| ID | Already available | Exact uncompleted requirement |
| --- | --- | --- |
| S04 | PR122 saved names on receipts/history and source-line commission evidence; one recorded actor uses existing rules; branch revenue counted once; fixed DEMO pool unchanged | **Blocked on two-person ordinary commission policy.** Decide whether a general rule pays each fully, uses only explicit personal rules, or splits one amount under a supplied formula. No answer assumed. Pending rows are visible and incomplete ordinary payroll is prevented before writes. |
| K01 | PR103 same-visit RM navigation, PR105 therapy persistence | Existing posted/paid examination correction requires permitted role/status, scope of fields and stock/billing consequences. Navigation does not enable unrestricted editing. Parent already owns this question. |
| K07 | Released PR97 initial consultation/billing/pharmacy handoff; PR103 complete protocol/dose history; PR122 saved row actors | Ordinary medicine delivery versus actual administration needs stored provenance and agreed action; paid inpatient duration needs bill-to-period mapping/day cutoff. Prescription, paid, handed over and administered remain separate. No inferred history/duration. |

## Business/input decisions prevent a safe completion claim — 13 IDs

| ID | Minimum missing decision/input | Code boundary already checked |
| --- | --- | --- |
| C03 | Actual referenced monthly-promo Excel template, including SKU/unit/discount representation | Repo contains item import templates, not this promo template; prior available Drive template searches found no example. Parent owns the question. Do not invent import columns. |
| C04 | Remaining package/total-discount representation beyond the existing per-eligible-unit model | Existing engine supports no minimum, min/max and multiples. This pass fixes demonstrated source-read incompleteness and clarifies nominal-per-unit labeling, with4/5/6/10 fixtures. It does not define a new package-total policy or close all C04. |
| C05 | Relationship between campaign code and existing voucher, permitted creator and usage limits; representative intended campaign | Existing voucher redemption and automatic promotion paths are separate. Do not add a second code/redeem system without the linkage decision. |
| Q01 | New customer counted globally or per branch, identity/deduplication rule and employee/reward attribution | Quest target union currently contains product_qty/category_qty/total_sales_amount. Customer creation alone does not prove an eligible first paid transaction. No guessed points. |
| K02 | Per-service BMHP obligation/default versus actual usage, deduction event and reversal/costing treatment | Existing composition/stock paths are not silently attached to every priced service. |
| K03 | Exact clinical scope in which the existing finished-stock/pre-mixed shortcut must be removed or blocked | Existing shortcut exists; its global removal would decide an explicitly unresolved pre-mixed workflow. No shortcut removed from unrelated scope. |
| K06 | Whether/how a paid closed visit can reopen/admit, consent and separation of prior/new billing | Existing admission guards unchanged. Parent/user decision pending, not conflated with successful admission of a fresh visit. |
| K09 | Required Pulang Paksa form/template, signer, blocking transition and relationship to discharge | Parent already asked. No legal text, signature or financial rule fabricated. |
| H02 | Official groups/grades, employee-template mapping, effective date and individual overrides | Named fixed allowance editing H01 exists; automatic group policy remains deferred. |
| H03 | Actual lateness brackets, branch/individual net-sales scope and official rates | Existing configurable calculations are not replaced with meeting example amounts. |
| H04 | Official per-SKU/action/grade rates, overrides and coexistence with sales-percent rules | Existing individual/item/category/branch commission model plus PR122 source evidence retained. No invented rates or blanket payroll completion. |
| H05 | Package/component eligibility and incentive basis/rates | Existing group stock-component snapshots are not proof of the requested package-versus-normal incentive policy. Revenue/component duplication must be assessed under that rule. |
| H06 | What constitutes a valid countable visit, completion, source/time categories and official incentive basis | Clinical visit/log/performer records are available; no zero-price SKU or manual entry is treated as a verified incentive visit by default. |

H02–H06 automatic payroll was explicitly postponed in the source meeting; this pass does not start it merely to reduce unchecked count. A02 pending approval notifications is likewise explicitly after migration and belongs to a separately agreed request/role workflow. O01 billing choices need owner/prices/decision, O02 additional recordings and full workflow simulations are operational follow-up, not hidden coding completion.

## Runtime diagnosis outstanding — 1 ID

**U07 remains unverified, not code-complete.** Existing SubmitButton uses pending/disabled state; examination and admission use existing request keys/atomic RPCs. Those prevent duplicate submission but do not prove latency improved. K05 recorded no frontend/network/backend timing baseline; PR122 retry tests are not performance measurements. Source inspection in this pass found no new reproduced latency cause or legitimate duration threshold. Target workflow timing/full user simulation is deferred, and candidate deployment is blocked. Collect an actual slow request with frontend/network/backend durations after coordinated integration; only then fix the demonstrated bottleneck. This is a runtime evidence dependency, not a reason to request a made-up SLA or add unrequested telemetry.

## Release order / independent source preservation

1. Keep frozen source heads. The linear spine is103 →106 →108 →114 →117 →118 →122; latest122 contains those source changes. Do not cherry-pick/merge each constituent twice.
2. Independent PR105, PR111 and PR113 must also be reconciled normally. PR111 adds shared formula completeness/clinical code projections; PR113 adds production/SKU source completeness. They are not present just because122 contains the spine. The independent promo-read-integrity follow-up in this branch starts directly from main and has no schema dependency on122.
3. Only the release lane may coordinate target migration history/parity/backups and app integration after the existing block is resolved. New clinical schema candidates are `20261023121700_clinic_therapy_note.sql` (105) and `20261023143000_service_line_performers.sql` (122). Apply only reviewed missing migrations in chronological order and inspect counted RPC anchors against the combined current definitions; do not bypass drift failures. This lane has not tested or applied the target's combined release set.
4. Deploy readers/writers only after their additive schema succeeds. Keep independent financial/import migrations owned by the release lane separate; no reapplication of released history.
5. App rollback is a normal source revert retaining saved additive metadata. Do not erase actor snapshots/therapy/history or recalculate final payslips. PR122 documents captured-core/ACL requirements if a full schema rollback is later needed.

G/main stays false for unintegrated candidates; H/UAT stays false until requested verification. S04, K01, K07, C04 and the decision/runtime rows must not receive blanket completion. This lane has no other demonstrated small unambiguous code gap after the bounded promo-read fix; it is ready for parent decisions/integration rather than an endless cosmetic selector loop.
