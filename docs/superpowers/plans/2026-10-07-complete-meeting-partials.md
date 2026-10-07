# Complete meeting partials — 7 October 2026

The user authorized completing technical partials in the meeting tracker, production release, and direct tracker updates. Original scope is the recorded meeting and Report sheet, not speculative additions.

## Implementation and verification

1. Finish transaction draft preservation across purchasing, sales, assets, finance, cashier, stock and clinic forms. Isolate user/scope/key; preserve controlled rows and valid attachment references; never replay submissions or store file/signature bytes. Clear only exact acknowledged success. Unkeyed multi-call financial actions retain uncertain work and require inspecting existing transactions before manual resubmission.
2. Complete official unit conversion in online sales, source-linked returns, transfers and request receipts. Reject missing units. Use atomic SQL posting, source ceilings, branch authorization and request identity checks. Verify FIFO, journal failures, rollback and concurrent attempts in disposable PostgreSQL.
3. Complete filtered CSV, Excel and native print-to-PDF report downloads. Page all source rows or report failure explicitly. Separate missing historical compound costs for reconciliation without invented amounts.
4. Bind official compound formulas explicitly to selling items through OWNER/ADMIN configuration. Offer native doctor, paramedic and groomer occupations independently from login roles. Preserve existing employee data.
5. Run independent code review, complete application tests, types, lint and build after shared edits settle. Apply exact reviewed migrations with guarded migration history, deploy matching application commit, verify production without posting business fixtures, then update only grounded tracker cells.

## Production cutover

Old application versions directly write returns, purchase invoice payments, transfers and receipts. Snapshot exact original authenticated table grants and original policies before migrations. Old request receipts move stock before document writes, so compatibility policies alone are insufficient. Guard legacy authenticated stock_out_fifo calls with source transfer/terima-permintaan before any effects while checked atomic definer RPCs continue to work. Install this guard before the remaining schema migrations, drain old in-flight operations, then apply the remaining four migrations together with final policies and exact history. Old posting actions fail safely until the new app is live. Preserve other FIFO callers, routine signature, invoker behavior and ACL. Do not broaden access, run broad database push, or apply local test fixtures in production. Review actual production helper definitions and ACL before changing routines.

## Data boundaries

The menu for asset purchases and cash/bank payment fulfills the original asset requirement; direct invoice asset integration is separate scope. Historical negative stock and missing HPP still require reconciliation with actual records. Official company formulas, selling-item mappings and real paramedic assignments require company-provided facts. PCA has no established meaning in the meeting. No invented formulas, staff assignments, costs or historical corrections.

## Evidence

Release evidence, independent review findings, final test results, production schema/commit checks and exact tracker readback will be recorded in the pull request and release notes.
