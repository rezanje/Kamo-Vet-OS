-- Revoke EXECUTE on internal functions from roles that don't need direct access.
-- handle_new_user is trigger-only; RLS helpers are called by policies (not clients).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_can_access_branch(uuid) FROM anon;
