# P07 — explicit final partial PO receipt

Candidate base: `4a14ca914db85ac49ba32f04eabe774066d33815`. Isolated branch `codex/p07-final-partial-po-20261023`. This candidate has no target migration/write, main merge, deployment or hosted UAT by its implementer. Parent coordinates release. I06/PR94 is a separate executor/release; its migration is already on target according to parent, but its code was not yet in main at this candidate's verification.

## Verified cause and behavior

`receive_purchase_order` keeps a genuine 5-of-10 receipt `Dipesan`; the invoice picker filters only `Diterima`, and the invoice internal RPC rejects other statuses. There is no prior explicit final-partial transition. The isolated reproduction used the real receipt and invoice RPCs, not manually fabricated stock/receipt records. Before implementation the new close acceptance failed at the missing RPC; real PO-page tests failed on missing controls/evidence.

A Super Admin (active OWNER, matching existing PO correction authority) can now explicitly **Tutup sisa penerimaan** from PO detail, with a reason and confirmation that the supplier will not send the remainder. The RPC locks the same PO row as receipt/invoice/DP, compares the displayed quantities/unit/factor with locked source rows, and rejects stale confirmation. It records an immutable proof with ordered, received and closed quantities, unit/factor, actor/name, reason and timestamp, then moves the existing lifecycle to `Diterima`. The detail and invoice option label distinguish **Selesai parsial**. A temporary partial PO remains open until this explicit action.

Ordered10 / received5 / closed5 preserves ordered10, PO value, actual receipts, stock/layers, journals and advances. The existing invoice cap then permits only received/uninvoiced5; the native invoice example totals500 at price100. It creates no new receipt, liability posting, DP allocation or refund. Existing completed-PO advance protection rejects new DP; already recorded advances remain intact. An excess unallocated advance is not erased or automatically returned.

A subtle legacy hazard was `coalesce(qty_terima,qty)`: NULL means never received on open PO lines, but historically meant ordered quantity for old completed PO imports. At explicit short-close only, never-received NULL becomes explicit0 before completion, so invoice/GRNI/return readers cannot invent received quantity. The proof retains `received_was_null`. Existing positive accepted quantities and original ordered quantities are unchanged; no historical receipt is reconstructed.

## Transaction, access and recovery

One additive migration, `20261023022600_po_final_partial_close.sql`, creates the proof and RPCs. New proof readers inherit existing visible-PO/branch scope; column grants exclude internal retry payload/key. Client writes are revoked. A trigger rejects proof update/delete/truncate. Close/get RPCs require active OWNER and existing purchase module/branch checks; no old table grant, policy, role, credential or source writer is changed.

A unique PO proof and unique actor/request key prevent duplicate final closure. Identical confirmed retries return the original proof; changed payload with the same key is rejected. A read-only recovery RPC checks the actor's exact request after an uncertain response. The form uses the shared durable draft/key and in-flight protection, and acknowledges/refreshes candidates only after a complete matching proof is returned. A missing/partial/timeout response is not success. Reading proof failure disables final-closing controls.

The existing A01 PO status-change event records the authenticated actor. The immutable closure proof stores the reason and quantity snapshot and appears on PO detail; generic activity history does not separately embed the reason. An injected activity-log failure rolls back the proof, zero-normalization, PO status and audit effects together. The original179-source/358-trigger audit registry remains intact.

## Executed checks

[Checks](../evidence/2026-10-23-p07/checks.json) and adjacent logs contain only fictional fixtures and sanitized command results.

- RED: real partial receipt remained open and was rejected by invoice; missing close RPC; two missing-control/evidence page regressions; invoice final-partial label regression. These were observed before their respective changes.
- Final application: **336 files /2591 tests passed** after the confirmation follow-up. Initial focused five files /35 tests and follow-up six files /30 tests passed. Typecheck, scoped ESLint, production build and whitespace checks passed. Build used fictional public endpoint/key and removed configured Supabase privileged credentials. Existing unrelated image/unused-variable warnings remain; scoped changed-file lint is clean.
- Owned network-none **PostgreSQL17.6**, main232 + this one migration =233 local files: `purchase_short_close.sql`, `purchase_short_close_guards.sql`, original `purchase_advance_atomic.sql` and `purchase_invoice_lifecycle.sql` passed.
- Actual independent-session races passed: close-first blocks further receipt while invoice bills only5; receipt-first makes close's displayed5 stale and invoice remains ineligible; same-key close retries yield one immutable proof and one completion status event.
- Checks include exact request replay/recovery, changed request rejection, missing confirmation/duplicate/stale rows, ordinary-role and selected-branch denial, private payload exclusion, immutable proof, audit failure rollback, never-received rows unbillable, existing DP preservation/lifecycle guard and native invoice quantity/journal behavior.
- One independent read-only **Sol6.1 high** source/test review found no substantiated P1/P2/Critical/Important regression. Higher-isolation/different-key races were reasoned from existing PO serialization/unique guards, not independently executed. No full transaction/UAT campaign, real-browser interaction or target rehearsal is claimed; view tests use actual server-rendered pages and fictional query boundaries. Follow-up confirmation tests mount the actual client form and draft restorer in jsdom, reload stored drafts and click controls.

Initial harness failures were corrected without weakening product guards: explicit fictional active COA prerequisites; an original invoice regression commits its settings, so suites now run in separate cloned databases; PostgreSQL numeric display5.000 is compared as Decimal. The final isolated container and volumes were removed.

## Rollout and bounded rollback — not executed

1. Sync latest main normally if PR94 lands before this release. Do not reapply I06 or PR92 migrations. Recheck exact-head CI, compatibility/current target history and recovery metadata immediately before rollout; local233 files are not the same as target218 history records.
2. Apply **only** `20261023022600_po_final_partial_close.sql`, checksum in checks.json, in one error-stop transaction. Verify expected new proof table/column ACLs/RLS, immutable triggers, intended authenticated RPC execution and unchanged old permissions/functions. Do not blanket replay history or normalize any existing PO during migration: business writes occur only on a later explicit close.
3. Release matching application through parent's gate. No source transaction should be resubmitted just to verify deployment. Defer controlled OWNER/branch hosted acceptance to the user's later UAT phase.
4. Prefer disabling new close submissions/rolling application forward if an issue arises. Retain DB proof/RPCs and all receipts/stock/journal/DP evidence on an app rollback. Existing old invoice code safely reads the persisted explicit received quantities. Do not delete proofs, reopen finalized quantities, weaken guards or run a reset to make a new receipt fit. Reopening/correcting already posted PO/receipt/refund semantics requires a separate decision.

Actual physical target restore remains untested. Native auth/storage shims and bootstrap postgres ownership do not establish full managed-platform/real-data equivalence. No target data or auth secrets were copied into fixtures/evidence.

## Rulings and limits

- Use existing completed lifecycle plus immutable final-partial proof, preserving ordered quantities/value. Cost if wrong: status-only consumers cannot distinguish fully received from explicitly closed; detail/invoice labels and explicit0 accepted quantities carry that distinction safely.
- Normalize only never-received NULL to0 inside explicit close, retaining the original NULL marker. Cost if wrong: a legacy reader treating NULL as receipt is stopped; no stock receipt is fabricated.
- OWNER-only close matches existing PO correction privilege; ordinary receipt roles retain temporary receiving. Cost if wrong: another role needs an explicit future business authorization, not a silent access expansion.
- Use existing A01 PO event plus immutable closure proof rather than a new generic registry source. Cost if wrong: readers must open PO detail for the reason/snapshot; generic history shows the status event only.
- Follow existing autonomous user authorization for this bounded candidate; no new design permission gate or target release was inferred. Private durable ledger retained for parent continuity; no cloud helper scripts were available locally.

Resolved review minor: the shared draft restorer imperatively restored checked DOM after the form reset its React confirmation state. Two actual client regressions reproduced the mismatch before the fix. A narrow `data-draft-ignore` opt-out now excludes P07 confirmation from both saving and restoring, including legacy drafts containing checked=true. Reason and durable request key survive; reload starts visibly unchecked with submit disabled, and one fresh click enables submit with the current source snapshot. Three new tests cover legacy stored confirmation, reload/reconfirmation and unchanged ordinary checkbox restoration. Server confirmation and stale-snapshot guards are unchanged; SQL simulations were not repeated for this UI-only follow-up. Other best-effort metadata/import policies, I06, posted PO correction/reopening, automatic refunds and reconstructed legacy receipts remain outside P07.
