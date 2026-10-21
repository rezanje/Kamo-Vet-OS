# Safe reset UI and retired action

Base: main `d6d9c70`. Branch: `codex/kamo-reset-safe-ui`.

The parent investigation supplied six attempts at 15:02:33–15:07:31 with HTTP 403 / SQLSTATE 42501, permission denied for `reset_simulasi_barang_dan_stok`; the function never ran. Those observations were supplied as task evidence, not re-probed here. Stale foreign-key deletion ordering is a separate latent problem, not the observed cause. This change does not repair or execute that destructive function.

The main-branch legacy SQL targets every branch/warehouse and deletes master items/SKU, stock, related transactions and selected journals. The stock-page warehouse filter is not a reset boundary. The former form obscured that scope and the action told users to retry every error, with an unjustified assurance that all old data remained intact.

## Result

- OWNER sees a read-only maintenance panel explicitly describing global destructive scope, master SKU deletion, and the warehouse-filter limitation. There is no confirmation field, submit button or reset form. Other roles do not see the maintenance panel.
- The existing server-action export is retained for old mounted forms/direct callers, but always blocks after read-only session/profile checks. No RPC, deletion, revalidation or success redirect remains. A future database grant cannot reactivate this action.
- The message explains permission denial (403/42501), requests Owner/system-maintainer review, directs users away from repeated attempts, and requires a separate decision for access changes. It contains no raw backend details or guarantee about an unknown historical outcome.
- The panel links to SKU, stock-card and adjustment-history pages. It describes manual approved maintenance: reviewed scope, dependency/permission checks, backup, isolated restore proof, Owner approval and a recovery plan. Unknown prior outcomes require read-only log/audit inspection.
- The obsolete client-side confirmation/readiness helper and its two tests were replaced by the safe shared message and 16 behavior tests.

## Verification actually performed

1. Red: before implementation, action tests failed on the misleading generic retry/unchanged-data response and confirmation-driven execution. The two UI tests failed on the old limited scope wording and presence of form/input/submit controls. Initial dependency setup lacked jsdom; a clean lockfile install in this isolated worktree resolved that setup error before the UI red/green run.
2. Green: `npm test -- src/lib/__tests__/simulasi-reset-action.test.ts src/components/__tests__/simulasi-reset-guidance.test.tsx` — 16 tests pass. Covers six repeated requests against a backend stub configured to deny 403/42501, zero RPC calls/revalidation, empty confirmation, changed backend permissions still blocked, no success claim or secret leakage, missing session, non-Owner roles, profile-read errors, scope wording, read-only links and UI role access.
3. Full `npm test` — **2,208 pass, 3 fail**, across 264 files. The same three failures reproduce at unchanged main `d6d9c70` in a separate detached worktree (7 pass / 3 fail in the two affected files):
   - `merchant-fee-report-pages.test.tsx`: `shows merchandise, merchant fee and final bill separately on sale detail` — missing auth mock (`getUser`).
   - Same file: `does not invent a fee for historical sales` — same missing auth mock.
   - `remaining-transaction-forms.test.tsx`: `clears acknowledged controlled rows and keeps defaults on later remount` — missing PO `draft_key` input assumption.
4. `npx --no-install tsc --noEmit` passes. Scoped ESLint for changed source/tests and the preview script passes; `git diff --check` passes.
5. Production build passes (exit 0), using **fictional loopback-only** Supabase configuration, never real workspace credentials: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=fictional-preview-only NEXT_TELEMETRY_DISABLED=1 npm run build`. Existing lint warnings and the Supabase Node API/Edge warning remain; no warnings refer to this patch.
6. `node scripts/preview-reset-guidance.mjs` renders the actual component with repository CSS and a fictional wrapper/Owner, then checks Chromium 1280px and 390px. Both have zero overflow, zero submit controls, three review links, a keyboard-focusable first link and zero external requests. Screenshots were visually inspected. These are **component previews, not authenticated application acceptance**.

Offline preview artifacts: [desktop](../../evidence/2026-10-21-reset-safe-ui/desktop.png), [mobile](../../evidence/2026-10-21-reset-safe-ui/mobile.png), [self-contained HTML](../../evidence/2026-10-21-reset-safe-ui/preview.html), [checks](../../evidence/2026-10-21-reset-safe-ui/checks.json). Reproduce after `npm ci` and `npm install --prefix /tmp/kamo-reset-browser playwright`; override `PLAYWRIGHT_MODULE` / `CHROMIUM_PATH` when needed. The script loads HTML in memory; this environment blocks browser file-URL navigation.

## Integration and remaining decisions

Open PRs #68–73 and #62 were inspected. None of #68–73 changes this PR's source/test paths. No stock/financial/GL correction implementation, shared ledger helper or migration is changed here.

PR #62 overlaps `src/app/(app)/pos/stok/ResetSimulasiForm.tsx` and `actions.ts`; its legacy action is also retired, but its form introduces a new recoverable reset capability. **Do not combine that form/capability automatically with this safety-only patch.** Preserve the closed action and read-only guidance until a separately authorized security/maintenance decision. New correction/audit tables from other PRs remain outside any verified reset manifest; this patch intentionally does not modify that manifest.

Parent coordination references: initial GL task `01a15d7f-22f4-7439-993b-83a812e21030`; master-actions task `01a15d7f-4f48-7325-b1a6-71660bae903f`. Direct cross-thread messaging is not exposed in this environment; return the overlap contract to the parent for coordination.

No production DB query/mutation, migration, permission change, service-key use, destructive RPC, reset, merge or production deployment was performed. Database permissions/security and authenticated application acceptance are unverified here. Restoring actual reset capability requires a separate decision about access, approved scope, dependencies, backup/restore proof and maintenance execution. This PR is deliberately incapable of executing reset.
