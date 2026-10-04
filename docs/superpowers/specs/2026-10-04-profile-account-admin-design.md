# Active profile administration

The own-profile UPDATE policy from `0004` permits disabled accounts to enable
themselves. The administrative UPDATE policy from `0060` trusts `is_admin()`,
which ignores activation, so disabled OWNER/ADMIN accounts can edit others.
The existing official-catalog trigger only protects self role changes.

Add one BEFORE UPDATE trigger, leaving existing policies and the self-role guard
unchanged. An authenticated caller must have a stored active profile. Role or
activation changes, and any changes to another profile, require its stored
OWNER/ADMIN role. Active STAFF retain personal own-profile edits. Lock the caller
profile while checking authority so revocation committed while a request waits
is observed. Never derive administration privileges from NEW values or JWT role
claims. An empty search path and qualified references prevent object shadowing.

Trusted database `service_role` and direct postgres maintenance remain supported.
The actual database role determines this exception; a claimed JWT role does not.
This guard does not change profile read policies, other RLS helpers, roles, or UI.

Verify with real PostgreSQL 16, real core/profile RLS migrations and the existing
self-role trigger, using fictional rollback fixtures. Include disabled FINANCE,
OWNER and ADMIN attempts, normal STAFF personal changes, active administrators,
trusted service/postgres, and revocation during a real row-lock wait. The bounded
harness is not a full Supabase reset. A direct local PostgREST PATCH with valid JWT
is a separate integration check before release; production changes need review.
