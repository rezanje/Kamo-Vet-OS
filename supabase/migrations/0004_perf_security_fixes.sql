-- Fix auth_rls_initplan: wrap auth.uid() in (select) so PG evaluates once per query, not per row.
DROP POLICY profiles_select ON public.profiles;
DROP POLICY profiles_update ON public.profiles;
DROP POLICY user_branches_select ON public.user_branches;

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR public.is_admin());
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY user_branches_select ON public.user_branches FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

-- Fix multiple permissive policies: replace FOR ALL with explicit verbs
-- so SELECT has exactly one matching policy per table.
DROP POLICY warehouses_write ON public.warehouses;
CREATE POLICY warehouses_insert ON public.warehouses FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_branch(branch_id));
CREATE POLICY warehouses_update ON public.warehouses FOR UPDATE TO authenticated
  USING (public.user_can_access_branch(branch_id))
  WITH CHECK (public.user_can_access_branch(branch_id));
CREATE POLICY warehouses_delete ON public.warehouses FOR DELETE TO authenticated
  USING (public.user_can_access_branch(branch_id));

DROP POLICY user_branches_admin_write ON public.user_branches;
CREATE POLICY user_branches_admin_insert ON public.user_branches FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY user_branches_admin_update ON public.user_branches FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY user_branches_admin_delete ON public.user_branches FOR DELETE TO authenticated
  USING (public.is_admin());

-- Missing FK indexes flagged by performance advisor.
CREATE INDEX ON public.items(category_id);
CREATE INDEX ON public.user_branches(branch_id);
