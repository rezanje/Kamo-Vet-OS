# I04 — preserve the first locked stock-count snapshot on retry

## Reproduction

The first `kunciBaris` call read live stock -5 and stored physical count 1 (delta +6). After a sale changed stock to -6, retrying the same lock used an updating upsert and replaced the baseline with -6. A newer stale-screen physical input could also replace the stored physical count. That violates the existing rule that changing a locked count requires the explicit Buka action. Separately, stock read errors and invalid numeric inputs were coerced into a zero snapshot/count.

Action regressions reproduced five failures on the old code; two real component cases reproduced display of an unsaved quantity and negative-to-zero conversion. A further RED/GREEN case required an explicit explanation when a stored count differs from the submitted input.

## Change

Use `ignoreDuplicates` on the existing unique `(order_id,item_id)` key, then read back the stored physical quantity. The client displays that authoritative value and explains that Buka is required to change it. Failed/missing readback never confirms a lock. Reject nonfinite/negative physical counts and failed stock reads instead of manufacturing zeros. Auth, order-status checks, direct-write privileges, schema and the existing missing-stock-row convention are unchanged.

The snapshot is still captured at the first lock, not at creation of the order. A later sale does not change that snapshot. The synthetic example's delta stays +6, so applying it to subsequent live stock -6 yields zero, preserving the sale rather than counting it twice. This is an action/component regression and arithmetic check, not a full POS-to-SO hosted simulation. It does not make the legacy multi-step `simpanHasil` posting atomic or resolve I02 accounting policy/reconciliation. No target transactions or migrations were executed.

## Verification

- 28 focused tests across lock retry/confirmation, cancellation action/UI and existing opname calculations passed.
- Full application suite: 354 files / 2695 tests passed.
- TypeScript, scoped ESLint and whitespace checks passed.
- Production build passed with existing unrelated warnings.
- Independent bounded source review: no important blocker, no reviewer edits or broad repeated checks.

No migration is required. Rollback is a code revert; reverting reintroduces snapshot-overwrite behavior but does not delete saved counts. Source branches are preserved. Main merge remains blocked by the previously reported automatic-review denial on PR103, which was not retried or bypassed.
