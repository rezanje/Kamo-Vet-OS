# H01 — named fixed allowance editing

Source: canonical Checklist H01: profile stores base salary and fixed allowances1/2/3 with editable names/descriptions and amounts, rather than permanent generic labels. Existing tables already support arbitrary named master components, per-employee assignment, personal amounts and master-default fallback. This change completes their existing UI rather than introducing three hardcoded fields or payroll automation.

Base: PR117 `a4b1ed65234091cd2e75d89e4e5c1aeb4713090f`; latest remote main remains `e46f45e97ae2500b3aaade5e8a9e50915f9fcca3`. PR105/111/113 independent changes are not bundled or overwritten. No purchasing/import/transaction-action ownership overlap.

## Actual behavior

- Employee profile already shows base salary plus named assigned allowances and supports personal amount changes. Assigned components now have a direct master name/default edit link preserving the employee context. Existing assignment upsert continues to avoid duplicate employee/component pairs. Blank personal amount follows master; explicit zero and decimals remain real values.
- Component master now has Edit, stored values, an immutable displayed type while editing, explicit edit/cancel mode and a notice that master name/default affects all assigned employees while personal overrides survive. Creation and activation/deactivation keep their existing action paths. This is a shared named component, not an undisclosed personal-only rename.
- Switching component A to B or back to create remounts the form. Dirty A inputs cannot be submitted under hidden ID B. Validation/database failures retain the edit ID and employee context so retry cannot silently become creation.
- Invalid nonfinite/negative master amounts are rejected server-side before write instead of coercing invalid text to zero. Empty master amount retains the existing zero default. Read failures or unavailable edit targets show a visible error and suppress a misleading edit/create form.
- Existing OWNER/ADMIN master guard and employee-profile gate remain. Authenticated client/RLS unchanged; no service-role client, role, permission or branch access expansion. No employee salary, finalized payslip, incentive formula, rate, attendance, effective-date policy, schema/RPC or payroll automation change.

## Executed verification

- Initial test-first RED:8 failures/3 passes for absent edit UI and invalid nominal behavior. Review found two additional P2 issues; three targeted failing assertions reproduced stale input/ID association and lost edit context before fixes. Logs in [evidence directory](../evidence/2026-10-23-h01/).
- Final focused batch: **52 tests /8 files passed** across named allowance profile/master/actions, stateful same-root form switching, actual invoice/prescription print contracts, existing employee editing, payroll calculations/rules and CRM category/shared multiselect regressions. The fixtures use fictitious employees/products; no live read/write. Tests cover three named allowances, decimal and zero overrides, master fallback, preserved salary, rename/readback, duplicate assignment prevention, invalid numbers, permission denial before mutation, missing/read errors, validation/database failures and safe retry identity.
- Independent review: both P2 fixes verified, **18 tests/3 files passed**, no remaining P1/P2 findings. Reviewer made no edits or target actions.
- Production build passed. Existing Supabase Edge-runtime/img/other-source warnings remain; no gate loosened. A test-only unused React import noticed during build was removed; its one affected test file was rerun and final scoped lint is clean. Standalone typecheck is run after build, never concurrently.
- No repeated full application suite or new full workflow/browser simulation; user deferred simulations. Prior selector evidence is reused explicitly in [U03/U04/U05 closure matrix](2026-10-23-u03-u04-u05-closure.md), not represented as freshly rerun tests.

## Release, rollback and limits

H01 code-complete for the named allowance requirement; pushed/ready candidate, main, deployment and UAT are separate states. Parent owns checkmarks. No migration or target database deployment step is needed. Release coordinator integrates stacked117 dependencies plus independent111/113/105 as appropriate; this executor does not retry the blocked main merge or bypass it.

Rollback: revert this H01 source commit while retaining underlying candidate dependencies. No database rollback/reset. Legitimate named component/amount edits made after deployment stay stored; reverting UI does not silently erase personnel data. Renaming shared master intentionally affects all assigned employees; the edit form explains this. H02–H06 automatic templates/rates/visit/bundle calculations remain outside H01.

Next actionable remaining implementation is S01–S04 service-row performer attribution and separate automatic logged-in cashier. It requires coordinated line model/RPC/transaction-action work with the release lane; current global salesperson cannot safely be reassigned without preserving incentive provenance. This is a real remaining coding gap, not completed by H01 or selectors. Clinical/business decisions are listed precisely in the closure matrix; K01/K09 questions are already pending with the user.
