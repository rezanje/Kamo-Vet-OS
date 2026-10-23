# Recoverable opening inventory candidate (PR86)

Candidate extends the earlier false-success guard; M04 is not marked fully complete. Main102f3b0 (metadata repair script only) was merged normally into this isolated branch. PR84/85 remain present. No A01/82/83 changes, live imports, migrations, merge or deploy commands.

## Behavior and monetary contract

- Master mode still requires actual types. An unchanged all-invalid485-row master upload fails preview and confirmation before writes; mixed valid/rejected masters and master-only completion remain supported.
- Explicit stock-only mode resolves existing active SKU/unit/expiry metadata, requires a selected date, and does not update/invent masters. Unmatched/inactive/ambiguous mappings are held.
- Preparation is one invoker RPC transaction with actor/branch checks, same-hash serialization, atomic run+rows insert and exact persisted replay. Recover exact own batch through URL/database; browser Files are not saved. Unpersisted uploads require reselect. Old responses, including a late progress response body, cannot start a later mutation after file/date/category changes; uncertain outcomes never imply success.
- STRICT is default: fractional-cent source or non-exact base conversion refuses preparation without writes. Opt-in HALF_UP_BATCH_V1 sums original full-precision source qty×cost, rounds the batch once to two decimals, calculates60-place base rates and allocates residual to the first source-order row that can represent it exactly at a bounded finite decimal rate. If no exact representation exists, fail with no writes. Original source lexemes, conversion factors, original values, policy, computed target and residual are retained. This target is explicitly computed, not an invented authoritative Accurate total. OWNER still reviews accounts/values/confirmation.
- Existing native stock/layer/move/journal posting, exact-cent constraint, immutable audit and exact request retry are unchanged. Normalization does not round only the journal or loosen equality tolerances.

## Final verification

- Full repository suite after reviewer fixes: **313 files /2,433 tests passed**. Typecheck, scoped lint and production build passed (existing unrelated lint warnings only). Five native SQL suites passed on PostgreSQL16 with223 migrations. Initial stable suite2428 also passed before the review fix pass.
- Actual private XLSX unchanged:485 rejected masters, no writes. Explicit synthetic inventory metadata/source base units/no expiry and fixture date2026-01-01: STRICT refuses with no writes; selected normalization prepares304, exact retry/recovery finds same batch; another account cannot recover it. Native review/post/retry:one journal, quantities and layer/move value/debit/credit reconcile exactly. File bytes unchanged. Aggregate only: [evidence](../evidence/2026-10-22-recoverable-import/actual-file-aggregate.json).
- Separate fictional mixed-master action import saves one valid INV, rejects one blank type, no new financial writes. Existing continuation/review/master-only/service-picker regressions are included in the full suite.
- A fixture adapter initially decoded a scalar UUID as JSON after preparation had committed. Before retry, exact outcome inspection foundone complete batch, zero moves/journals. Corrected adapter SQL serialization; retry recovered the same committed batch and completed reconciliation. This was a harness response-decoding error, not a product claim of a successful first response.

## Release and rollback

New additive migration20261022190000_recoverable_inventory_preparation.sql is only applied to isolated containers. Candidate code requires this RPC; automatic Vercel preview is a build check until a coordinated target database migration exists. No production runtime acceptance is claimed. No production master/stock/GL metadata was inspected or inferred from the synthetic fixture.

Before release: parent coordinates reviewed migration then app release and controlled target smoke test. On rollback, stop new preparation and roll back app entrypoints; preserve prepared runs, source evidence and any posted receipts/journals. Never delete/reset data or auto-reverse a posted inventory journal. Additive RPC can remain while rollback is reviewed; historical accounting repair is outside scope.

Limit: finite unit-cost representation is required by the existing layer model. Example qty3/value1 cannot have an exact finite decimal rate; unsupported residual allocation is refused rather than changing quantities or weakening reconciliation. Original file still needs real chosen date and validated existing/new master decisions in the target app.

## Independent review and fix pass

One fresh Sol6.1 high reviewer, no Astra/no implementer workers. No Critical finding. Four Important findings were reproduced RED→GREEN: localized numeric/formula text crossing a HALF_UP boundary, ambiguous normalized unit conversions (including base/derived collisions), missing destination selection in stock-only mode, and a stale progress body after generation invalidation. Focused review regressions47/47 passed. Native unit ambiguity now refuses without a run; the exact1.004999... source target remains1.00. Final full suite2433/2433 green. No re-review was substituted for the covering tests.

Rulings: inline implementation followed explicit delegated authorization without another approval loop; exact nonrepresentable rate allocation remains a zero-write refusal rather than changing the layer model; residual allocation may use a source-zero row under the explicit first-eligible/nonnegative policy, with original source, allocation and OWNER confirmation retained. These are chosen computed valuations, not assertions of an authoritative source total. A fixture UUID decoder was corrected only after checking the uncertain committed outcome. No reviewer Minor findings were deferred.

Final source privacy gate: zero actual source code/name/destination literals of8+ characters in newly added code/docs. Header labels and unchanged existing fixtures are not private source rows. No raw workbook or private responses were committed. Tested implementation commit:70081e6; subsequent documentation does not change runtime code.
