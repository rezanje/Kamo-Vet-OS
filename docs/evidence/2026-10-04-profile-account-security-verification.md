# Profile account administration verification

Scope: isolated draft migration `20261004160000_profile_account_admin_guard.sql`;
existing profile RLS and self-role-change trigger remain. No application feature,
new role, production migration, or remote database change was made.

## PostgreSQL baseline and fixed behavior

`python3 scripts/test-profile-account-admin-db.py --baseline` failed as expected:
disabled FINANCE successfully enabled itself through the own-profile policy.

`python3 scripts/test-profile-account-admin-db.py` passed on actual PostgreSQL 16.
The curated stack applies actual core/RLS/profile migrations and the exact
existing self-role trigger; auth tables/functions are isolated test shims. It is
not a complete Supabase reset. Rollback fixtures cover disabled FINANCE/OWNER/ADMIN
self-reactivation, combined role/activation changes and edits to others; active
STAFF personal edits and active OWNER/ADMIN account administration; trusted
service-role/direct postgres maintenance; and preserved P0001/ACCESS_DENIED
self-role error behavior. Denied edits leave every profile unchanged.

Real independent sessions observed blocking and proved:

- Account disable and administrator-role revocation committed while an edit
  waited caused denial without changing the target profile.
- A granted authorization holds the caller profile lock until the protected edit
  commits, so a later revocation cannot commit in between.

## Native local authentication and API

The parent applied the migration and coordinated the final trigger rename on the
shared fictional Supabase runtime. After readiness, ran:

```sh
python3 scripts/test-profile-account-admin-api.py \
  --manifest /workspace/hris-local-runtime/local-auth.json
```

The script uses only authorized generated local keys, restricts the URL to
`http://127.0.0.1:55421`, creates six unique fictional GoTrue accounts, and obtains
real password-login JWTs. No key, token or password is logged or committed.

Passed results:

- Disabled FINANCE/OWNER/ADMIN self-activation PATCH returns HTTP 403 / 42501;
  combined self-role/activation PATCH retains HTTP 400 / P0001. Rows stay unchanged.
- Disabled OWNER/ADMIN cannot edit others via the older administrative policy.
- Active STAFF personal-name PATCH succeeds; activation and role changes fail.
- Valid JWTs containing user-controlled `user_metadata.role=service_role` retain
  the authenticated database role and do not bypass the guard. Tampering with a
  JWT's top-level role returns HTTP 401 and leaves the profile unchanged.
- Active ADMIN can enable others and assign another profile's role. The generated
  trusted local service_role token can administer accounts.
- All six created auth accounts are deleted; a scoped query confirms no fixture
  profile remains.

Independent reviewer found no Critical/Important blocker and reran all three
PostgreSQL harness groups on the final trigger-order commit `dff72eb`.

## Repository checks and limits

The full suite passed: 131 files / 1203 tests. TypeScript passed. Full lint had
zero errors and 12 existing unrelated image/upload warnings; diff checks passed.
The native API verification is local evidence, not proof of production deployment
or global disabled-account enforcement on unrelated tables/RPCs. Production
schema package remains a draft requiring the parent's review/release workflow.
