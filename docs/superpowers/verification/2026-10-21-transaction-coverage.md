# Transaction correction coverage

This matrix records bounded implementation evidence, not universal completion. Production baseline is PR61 / cb687ce. Work after that baseline remains unreleased until exact-project migration, build, deployment and authenticated checks are evidenced.

| Family | Current correction / save evidence | Remaining boundary |
|---|---|---|
| Manual journals | PR61 correction/reversal live; atomic creation + durable identity locally reviewed in c52e96e | Combined release and live acceptance |
| Cash entry | PR61 correction/reversal live | Final combined browser coverage |
| Expense | PR61 posting/reversal fixes live | Complete form/permission coverage across remaining expense surfaces |
| Purchase order | Atomic create, edit-before-dependencies, reasoned cancellation, official transitions; 7ab415b | Live migration and acceptance |
| Bank transfer | Atomic create/edit/void, preserved journal reversal/audit, scoped accounts; e1c4a50 | Live migration and acceptance |
| Opening balance | Full-balance atomic replacement, original retention, Finance/OWNER lost-response recovery; eec3b60 | Live migration and acceptance |
| Retail / online sale | 6ecf18d: exact FIFO, journal and reward reversal; cancellation + reviewed replacement; independent spec and quality approval | Live migration and acceptance; historical/dependent restrictions remain explicit; no external-provider automatic refund |
| Purchase invoice / payment / payment order | Payment milestone independently spec/quality approved: signed payment reversal, advance/order restoration and durable replacement, including real concurrent global-advance ordering | Invoice cancellation, stock valuation/provenance, direct atomic creation, readers and review/release remain open |
| B2B sales order / delivery / invoice | Existing atomic order posting, FIFO delivery allocation, durable recovery, and cancellation before delivery | Posted delivery/invoice correction or cancellation remains open; preserve cross-delivery HPP allocations |
| Sales / purchase return | Existing atomic `post_unit_return` with source locks, quantity ceilings and FIFO/refund journal effects | Return cancellation/replacement remains open; creation alone does not satisfy edit/delete feedback |
| Fixed-asset purchase | Existing atomic purchase and durable recovery | Purchase cancellation/replacement and dependent depreciation verification remain open; asset-opening definitions are master data, not a second financial posting path |
| Stock receipt / request | Existing atomic receive; cashier failed-input recovery reviewed in dee56f8 | Original-source corrections and remaining full form audit |
| Adjustment / transfer / production / opname | Existing family-specific operational flows | Correction/reversal coverage, atomic-save audit and tests remain open |
| Bank reconciliation | c5b0009: atomic dated-book snapshot, audited correction/reversal and durable recovery; independent spec/quality approval | Live migration and acceptance |
| Payroll / finalized payroll | Existing calculation, correction and finalization surfaces | Financial reversal and source-dependency verification remains open |
| Clinical billing / records | Existing specialized `clinic_edit_invoice` and `clinic_void_reissue_invoice`: source-backed correction/reissue, exact payment transfer, stock/HPP journal reversal and audit. Seven acceptance SQL suites on all current migrations and 12 focused application files / 97 tests passed locally. | Final authenticated live UI verification remains open. Ordinary medical-record edits use their existing protected flows; approved medical-history reset is separate. |
| All-branch operational reset | 77b6715: actual isolated restore, 138 cleared tables/65 preserved masters after combined registry rerun, all gates and real concurrent retries independently verified | Exact production migration, backup, isolated restore of production rows, reset and reload verification |

Source-based entry points include `pembelian/faktur/actions.ts`, `pembelian/perintah-bayar/actions.ts`, `keuangan/rekonsiliasi/actions.ts`, `pos/produksi/actions.ts`, `pos/opname/actions.ts`, and `hris/penggajian/actions.ts`. Family-specific detail reports record exact files and tests. Unknown public transaction tables fail closed in the reset registry; every later family adding tables must explicitly register them and rerun the reset suite before live reset.

Read-only source audit confirmed remaining multi-write gaps in inventory adjustment, production, opname, finalized payroll and purchase/employee advances. Transfer/request and PO receipt already have atomic posting/recovery, but post-completion source cancellation still needs compensating reversal rather than raw row edits. See the completion plan for implementation sequencing; these findings do not imply current production verification.

Additional scope classification: budget planning/transfers, tax reports and HR leave/overtime/approval inputs are not independent money/stock postings. Their financial effects are covered by their actual journal/payroll family. Asset disposal/transfer schema alone is not evidence of an active implemented menu; do not add new inactive product features to this feedback task. Online sale correction is already included in 6ecf18d and must not be classified from the older creation-only migration.
