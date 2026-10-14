# Employee account and operational branch context

## Scope and design assessment

Requested from IMG_1242.png: employee accounts should use HRIS identity so incentives, benefits, attendance deductions and uang duduk can connect; clinic/petshop must choose a branch before working. The screenshot confirms the earlier printing fix worked.

Baseline: fresh `origin/main` at `d0308d3` (PR #53); recent PRs #47–53 inspected. Isolated worktree `/workspace/kamo-hris-branch`, branch `fixing/hris-account-branch-context`. The source checkout is untouched. Library screenshot was materialized into this executor at `/workspace/task-evidence/IMG_1242.png`, metadata preserved, and pixels inspected before implementation.

Existing HRIS canonical key is `employees.id` (UUID), with existing unique `nik` for the human identifier. Preserve both. `employees.profile_id` is the existing account link; employee branch assignments and `user_branches` account permissions have different purposes and must not be silently synchronized. Existing clinical provider/incentive/salesperson records already use employee IDs. Existing benefits, payroll and attendance records also use employee IDs. No new compensation calculation is required.

Use the existing flows: require a free active HRIS employee when making an employee account, atomically finish role/grants/link, and offer an explicit link-only repair for existing accounts. Context selection uses separate clinic/petshop cookies bound to the authenticated account, revalidated server-side against current permissions and active branch/type. Open shifts prevent switching. Database policies intersect old permissive demo policies to enforce branch isolation, including child records; context narrows allowed access and never grants it. Backoffice reporting remains multi-branch according to existing roles.

## Changes

- New `/mulai/cabang?mode=klinik|petshop` selection after mode choice; empty access and failed reads have explicit feedback. Direct operational routes require a valid selection; login/logout clear selections.
- Active branch banner with a switch link in clinic and petshop. Clinic and petshop selections are independent. Shift start and clinic registration validate selected branch; shift opening drafts and registration are branch scoped.
- Middleware replaces supplied context headers and validates live profile/module/branch access and existing shift. Server Supabase clients forward the validated branch scope. Disabled profiles fail closed. Failed shift reads cannot masquerade as no open shift.
- Cashier drafts are scoped by authenticated account, branch and shift; old unscoped cached drafts are not restored into a new operational session. New checkout forms carry a shift identifier and stale submitted identifiers are rejected. Historical business records are unchanged.
- Employee account creation requires an existing active, unlinked HRIS employee; account management is OWNER/ADMIN only. UI shows NIK/employee ID and accurately describes STAFF/DOCTOR grants. Link-only repair changes neither role nor branch grants. No account was created by this work.
- Migration `20261014052234_employee_account_operational_context.sql`: duplicate-link preflight, unique non-null employee/profile link, guarded link/configuration RPCs, protection against own-profile privilege escalation and nonadmin link writes; restrictive branch/parent policies; prospective HRIS snapshots on shifts, cashier sales and expenses. Clinic cashier attribution can follow invoice shift to the immutable employee snapshot. Snapshot lookup is performed in the database and ignores supplied employee snapshot IDs.
- A narrowly scoped RPC supplies only active destination warehouse IDs/names for cross-branch/DC requisitions; it does not grant access to destination stock or transactions. Petshop retains its DC-only destination filter.
- Existing print code and monetary policies remain unchanged. Receipt tests mock the new branch-banner dependency. One SQL regression snapshot helper now compares physical data independently of intentionally invalid caller visibility; it is a temporary test function only.

## Rollout and review

1. Review this branch and diff. Do not deploy the application before its migration: old demo policies cannot enforce the new request context.
2. With separate approval, run `scripts/review-employee-account-backfill.sql` read-only against the intended database. Review duplicate employee/profile links, employee-less accounts, inactive employee links and missing grants. No names, contact data or compensation values are selected by this script.
3. Resolve duplicate links only after explicit identity verification; the migration stops with `HRIS_LINK_DUPLICATES` instead of changing existing records. Keep canonical employee IDs and existing posted entitlements. Do not match or relink by name/email automatically.
4. After approval, apply the migration in staging, deploy the application there, and run login/mode/branch/shift/security smoke tests with dedicated accounts. Test active shift recovery and destination requests. Apply production changes only under separately approved release work.
5. Existing unlinked accounts are preserved for review; OWNER/ADMIN can link them explicitly through account management. Historical shift/sale/expense snapshots remain null, and any historical backfill requires separate approval and evidence of the identity at that time. Existing posted payroll and incentives must not be recalculated.
6. Existing open shifts are preserved and can be resumed only in their branch. Revoked branch access requires administrator review; selection never restores access implicitly. Failed signup configuration is reported as incomplete and must be reviewed rather than retrying account creation.

Business decisions still needed: approved benefit components/rates, attendance deduction rules, uang duduk eligibility/amounts, and whether legacy accounts without active HRIS links must eventually be blocked from operations. This change supplies identity and audit structure without guessing those policies. Account branch grants remain explicit security permissions; HRIS employment assignments do not grant access automatically.

No merge, PR publication, push, deployment, actual account creation, live role changes, production reads, or production migration was performed.

## Verification

Verified application suite: 210 files / 1,771 tests passed (`npx vitest run --maxWorkers=2`). TypeScript passed (`npx tsc --noEmit`). ESLint passed with zero errors and 13 existing warnings (`npm run lint`). All 193 migrations passed on disposable PostgreSQL 16, including safe duplicate-link preflight and the new employee-account/context suite plus seven existing clinical suites. The fictional Chromium browser smoke passed 12 checkpoints with zero browser runtime errors and no business writes.

Local evidence is preserved under `/workspace/task-evidence/verification/`. Final `npm run build` passed on Next.js 15.5.25 using a fictional localhost Supabase URL/key. Build emitted the existing ESLint/Supabase Edge Runtime warnings; it did not connect to production. The SQL runner creates a disposable PostgreSQL 16 container, applies all migrations with fictional auth/storage shims and COA fixtures, checks duplicate-link rollout safety, and runs the new isolation/link suite plus seven existing clinical SQL suites. Its database cannot be pointed at production.

Browser smoke uses a localhost fictional auth/data fixture. All business writes are disabled; login sessions are synthetic. It verifies route transitions, branch banners, repeated navigation, switching, active shift locking, revoked/no assignments, read failure/recovery, separate petshop selection and logout. It is not a live Supabase Auth or production smoke test.

Reproduce the browser check with Playwright installed outside the repository, Chromium available, the fictional fixture on port 54390, and Next dev on port 3001 with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54390` and a fictional anon key. Run `node scripts/fixtures/employee-context-server.mjs`, then `KAMO_PLAYWRIGHT_MODULE=<absolute playwright index.mjs> node scripts/test-employee-context-browser.mjs`.

The repository's requested installed Next.js guide directory is absent from its pinned Next.js 15.5.25 package. Before implementation, the relevant official [Next.js 15 cookies guide](https://nextjs.org/docs/15/app/api-reference/functions/cookies) and [Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security) were checked, along with the Supabase changelog. No dependency versions or lockfiles were changed.
