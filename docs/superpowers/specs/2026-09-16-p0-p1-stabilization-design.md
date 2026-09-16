# VetOS P0/P1/P2 Stabilization Design

## Goal

Deliver the clinic queue, HRIS, fixed-asset acquisition, direct purchase invoice, recurring-transaction, COA, General Ledger, and sales-discount P0/P1/P2 scope without changing P3 or application-wide date formatting.

## Security model

- `OWNER` remains company-wide. `FINANCE` keeps financial visibility already required by existing reports.
- `ADMIN` is no longer implicitly global in `user_can_access_branch`; it uses `user_branches` like branch staff.
- A doctor may read a visit when the visit is assigned to the employee linked to the doctor's profile or when the doctor has access to the visit branch. Other doctors and inaccessible branches remain hidden.
- Employees and attendance are visible only when their primary/additional employee branch is accessible. OWNER remains global; ADMIN is branch-scoped.
- Server pages also apply the resolved branch/doctor scope, so correctness does not depend only on UI filters or only on RLS.

## HRIS behavior

- Employee list/count queries use an explicit access scope and report query errors instead of silently converting them to zero rows.
- Attendance defaults to `hariIniWIB()`.
- Employee and attendance writes validate that the selected branch/employee is in the caller's scope.

## Fixed assets

- The UI has separate Saldo Awal and Pembelian Baru submissions.
- Opening balances create an asset with `acquisition_kind = opening_balance` and never create historical journals.
- New purchases require Cash, Bank, or Accounts Payable as a credit source.
- A database RPC creates the asset, journal header, and journal lines in one transaction. Any failure rolls back all three.
- Each asset stores its own useful life. Asset categories retain classification and depreciation account mapping only; category useful life becomes nullable/unused and disappears from category forms.

## Direct purchase invoices

- Every invoice line is either `stock` or `fixed_asset`.
- Stock lines require an item and warehouse and update stock/layers/moves. Asset lines require category, individual useful life, location/branch, residual value, and create exactly one fixed asset per line. Asset lines never update stock.
- Asset-only invoices do not require a warehouse; mixed or stock-only invoices do.
- The invoice, lines, assets, stock changes, and balanced journal are created by one database RPC. The credit side is Accounts Payable for terms purchases or the chosen Cash/Bank account for immediate purchases.
- `fixed_assets.purchase_invoice_id` and `purchase_invoice_items.fixed_asset_id` provide source-document traceability.

## Recurring transactions

- Schedules have `daily` or `monthly` frequency, start date, required repeat count, run count, and status `active`, `completed`, or `inactive`.
- Each occurrence has a deterministic date and unique source reference. A dedicated run-history row and the journal uniqueness constraint prevent duplicate runs.
- Automatic catch-up and Jalankan Sekarang use the same runner. The run count advances only after the journal exists. Reaching the repeat count sets status to completed.
- History is displayed per occurrence with date, journal number, and amount.

## COA, General Ledger, and sales discounts

- User-created account codes accept 4–6 digits. Existing system codes remain immutable and reserved bank-account codes remain unavailable. Report grouping continues to follow explicit parent/type/group relationships, never code length.
- The General Ledger account name and row are direct drill-down targets. Detail lines retain their journal identity and expose the originating branch whenever the view spans all branches; branch filtering remains enforced in the query.
- Clinic and petshop sales both record gross service/sales income and a separate debit to Diskon Penjualan (`4102`). Profit and loss therefore reports gross income, discount, and net income consistently. Existing history is not rewritten without source evidence.

## Verification

- Pure scheduling, journal composition, invoice-line partitioning, WIB default, and access-scope helpers use Vitest with observed red/green cycles.
- SQL migration contracts are checked statically; where a database is available, migrations and RLS scenarios run against test users for two branches and two doctors.
- Before release: targeted tests, full tests, lint, production build, migration application, production deployment, two-account queue/HRIS smoke checks, asset-only and mixed invoice checks, recurring idempotency check, COA/ledger/discount smoke checks, and reconciliation of source document → journal → ledger → financial statements.

## Rollback

- Code rollback is a Vercel redeploy of the previous commit.
- The migration is additive except for policy/function replacement and category-life relaxation. Policy/function rollback is a forward migration; posted financial transactions are never deleted to simulate rollback.
