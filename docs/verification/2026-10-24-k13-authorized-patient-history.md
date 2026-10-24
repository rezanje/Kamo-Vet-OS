# K13: clinical history within existing account branch grants

Base main `b85d549fb5314931186d63054a1919e5092cdd34`. Runtime implementation reviewed/tested at `2e9864618814b8f538f5f3365a4acd49693a09d6`; delivery cleanup removes an unused page helper and adds this evidence. U09/PR135 and denied N01 work are not included or retried.

## Diagnosis and bounded fix

Read-only target metadata established one stable pet/owner ID across both reported branches and retained previous medical records. No medical text or contact details was retrieved. The clinical middleware attaches the selected operational branch; the normal Supabase client propagates it, and current `user_can_access_branch` consequently hides all other branches even from an all-branch account. The medical-history query already filtered by pet ID, so removing a nonexistent page branch predicate would not fix it.

Six local synthetic SQL cases using the existing branch function/SELECT-policy mechanism reproduced selected-vs-unselected visibility. An account with only branch B retained only B even when selection was omitted. This was a focused mechanism fixture, not a full target-schema/GoTrue replica.

The new private server reader validates an active account and the current visit through the normal operational client, rechecks the expected pet, then creates a private cookie-session client with the public anon key and no operational selection header. `auth.getUser` must return the same identity. There is no exported unscoped client, service credential, new permission or database change.

Only that exact pet's RLS-visible visits and verified medical-record/prescription children are read. Lists use checked counts/pagination and batches of at most200 parent IDs. Unexpected patient/parent rows, errors or incomplete lists fail closed to an unavailable message. Inactive sessions, inaccessible/stale anchors and session switches cannot disclose the history.

The medical tab shows source branch, recorded findings/therapy and prescription instructions inline as read-only details. It has no cross-branch edit/payment link. Existing financial, inpatient and compound tabs/actions retain the original operational client and visit set; the private history reader never queries invoices, prices, payments or stock.

## Verification

- Initial page RED:5 failed /2 passed before implementation.
- Final focused:59 tests /5 files passed, including the real server page/private session boundary, two-branch positive, single-branch negative, unrelated patient, parent spill, stale anchor, inactive/mismatched session, read error and607-visit pagination fixtures.
- Full app suite:3,205 tests /433 files passed. Production build and post-build typecheck passed. Scoped lint/whitespace checks passed; pre-existing page image warning retained. Unused helper warning removed in delivery cleanup.
- Independent source review found no concrete P1/P2. No live user impersonation, authenticated patient replay, medical save, target migration or data mutation performed.

## Acceptance boundary and rollout

Application-only release/revert. Existing account grants and RLS remain authoritative, including any pre-existing legacy-history exceptions; this change does not create those exceptions or widen them. Original clinical/error hotfix PR136 remains present. Exact candidate/main/deployment status is recorded in the PR.

Covered: clinical history for the same patient across branches already authorized for that account; read-only details with source branch; scoped financial/edit boundaries. Pending: a new policy permitting a single-branch clinician to read another branch's patient records. No such grant is introduced, and broader K13 shared-history acceptance or full user simulation must not be marked complete from this subset. Parent owns the checklist.
