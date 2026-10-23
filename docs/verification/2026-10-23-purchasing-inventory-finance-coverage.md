# Terminal coverage: 34 lane items

Point-in-time base main: e46f45e97ae2500b3aaade5e8a9e50915f9fcca3. This is a lane inventory, not a sum against the global74: clinical/reporting work overlaps. G means implemented in main, not preview; hosted simulations are deferred by user instruction. No new G/H is claimed from an open candidate.

| ID | Classification | Evidence or exact remaining scope |
|---|---|---|
| M01 | Partial; source/reconciliation data | Import controls exist in main; actual branch source totals and historical balance-sheet difference still need source/control evidence. |
| M02 | Needs input/data | Future28–31October initial/delta/final files and cutover control totals are not available. |
| M03 | Code-complete candidate | PR115 append identity/delta handling; original histories and unchanged retry covered. |
| M04 | Partial; source metadata/evidence | Main PR92 stage/recovery/normalization guards; real workbook structure diagnosed, authoritative SKU mappings/date/control totals remain user input. Do not call source-file incident reconciled from UI tests alone. |
| M05 | Needs input/data | Agreed Accurate AP/AR invoice export, party mapping and control totals; cannot invent invoice history from party totals. |
| P01 | Partial; role decision | OWNER correction exists; business manager/super-admin role mapping and escalation boundary need explicit alignment. |
| P02 | Partial; correction policy | Safe existing reversal guards remain; consumed/paid/closed transaction correction policy is not permission to rewrite financial history. |
| P03 | Needs decision | Below-cost/zero lock requires exception matrix for roles, free services, discounts/promos/expiry. |
| P04 | Needs decision | Deviation warning needs threshold and comparison base/unit; no threshold invented. |
| P05 | Partial/actionable verification | Draft PO edit and supplier price at invoice already exist; returned/consumed stock paths remain guarded. Verify supported price paths; don't duplicate the existing feature or silently remove guards. |
| P06 | Code-complete candidate | Main cap/atomic lifecycle plus exact-cent PR104; its migration remains unapplied. |
| P07 | Main | PR95 explicit final partial closure then invoice only accepted/uninvoiced quantities. |
| P08 | Partial/actionable | Existing correction families, including unallocated advance cancellation, must be mapped per stage; dependent/refunded advance corrections remain bounded by actual proof. |
| P09 | Partial; lifecycle decision | Main rejects received PO advances; precise eligibility after first/partial receipt needs explicit rule. |
| J01 | Partial/actionable | Existing consolidated report and channel correction families; complete route/coverage matrix and remaining per-channel consistency. |
| J02 | Partial/actionable | Existing authorized payment/source correction paths; verify exact cash/transfer/split coverage without inventing new payment effects. |
| J03 | Partial/actionable | Retail return path is cash-oriented; cross-method cash/transfer refund and office pending/processed lifecycle remain independent coding, with payout/approval/eligibility boundaries explicit. |
| J04 | Main | PR102 source-linked monthly recurring journals, run idempotency and occurrence history. |
| I01 | Needs mapping/decision | Family identity and quota30 expansion behavior; don't infer families from label fragments. |
| I02 | Partial; proof/policy | Atomic SO PR119 fixes verified partial-write defect. Original reported document and expense-vs-retail-invoice policy not established by a synthetic fixture. |
| I03 | Code-complete candidate | PR119 includes unchanged PR110 cashier-to-office reference/history fix. |
| I04 | Code-complete candidate | PR119 includes unchanged PR112 locked baseline/retry fix. |
| I05 | Needs decision | Cost/sale price source, valuation timestamp and agreed export semantics. Report basis must not change stock journals. |
| I06 | Main | PR94 safely cancels unposted SO drafts, preserves posted history. |
| I07 | Main | PR93 sold-SKU unit conversion guards and checkout concurrency protection. |
| I08 | Partial/actionable, in progress | PR123 atomic recipe core; now extending ad hoc and per-material/output warehouses in one branch. Missing policy only for cross-branch ledger/context and average/extra-expense allocation, not for the ad hoc UI itself. |
| I09 | Partial/actionable | Existing compound HPP/source detail is a starting point; add genealogy links for parent/material/job/visit/sale without fake physical stock. Virtual in/out counting semantics need a definition. |
| N01 | Partial/actionable | Main existing document graph plus PR120 stored purchase/sales-return origin; remaining job/compound/refund graph still independent scope. |
| N02 | Main | PR99 branch-aware PO numbering and uniqueness. |
| R01 | Partial; other lane dependency | Per-line performer/reporting semantics coordinated with clinical S01–S04 lane. Do not duplicate their files. |
| R02 | Code-complete candidate | PR107 branch/day reporting and invoice drilldown. |
| R03 | Code-complete candidate | PR109 categorized searchable report catalog with actual availability/gaps. |
| R04 | Partial; historical data | PR121 multi-branch saved closing snapshots. Actual FIFO historical snapshots cannot be reconstructed from nonexistent proof; target last read had no saved snapshots. |
| R05 | Partial/actionable | PR124 private browser applied filters. Private cross-browser persistence and report-column selection are independent work; shared visibility/edit rights need an explicit sharing rule. |

5 main +6 code-complete candidates +9 partial/actionable +14 partial awaiting decision/data/other-lane dependency =34. A partial item can contain both independent work and a later policy boundary. Independent work is not exhausted.

## Minimum decisions/data to bundle

- I08: when stock warehouses and expense context have different branches, which branch owns inventory/WIP postings and which interbranch accounts/allocation apply? Same-branch jobs proceed independently.
- R05: are shared configurations scoped to selected users, a branch or all report-authorized users; who may edit/delete someone else's shared configuration? Private scope proceeds independently.
- I01: authoritative family mapping and whether selecting a family may exceed30 SKUs.
- I05: master-current vs frozen-at-SO cost/sale price source and export basis.
- P03/P04: zero/below-cost exception matrix and purchase-price deviation threshold.
- P01/P02/P09: role mapping; consumed/paid correction/reversal policy; whether any receipt or only final receipt ends advance eligibility.
- M01/M04/I02/R04: exact source/control totals, metadata and reported document/history identifiers; M02/M05 future cutover and invoice files.

Publication remains blocked by the prior PR103 automatic-review merge denial. It was not retried/bypassed; no target migration or transaction is authorized by this inventory itself. PR119 supersedes release application of PR110/112; PR120 supersedes PR116; preserve all source branches.
