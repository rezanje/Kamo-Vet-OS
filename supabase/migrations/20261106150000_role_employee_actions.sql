-- Contact/job editing only. This row-level fence also runs under SECURITY
-- DEFINER callers, which bypass RLS; identity links, lifecycle, salary, branch
-- assignments and clinical SELECT FOR SHARE are deliberately NOT edit actions.
-- No actor profile lock is prepended to any account routine.
--
-- Employee branch scope is an intrinsic ceiling that RLS evaluates in STABLE
-- helpers under the UPDATE statement snapshot. If the statement waited on the
-- employee row, that predicate can be stale. After the action/epoch/current-actor
-- fence (and strictly BEFORE the committed exit) re-derive the exact employee's
-- branch authority from persisted state: all_branches, user_branches, and the
-- secondary employee_branch_assignments basis. Never reads caller flags/headers.
-- Lock order is unchanged: the employee row is already held by the UPDATE, then
-- the existing epoch SHARE -> actor SHARE NOWAIT fence; the scope pins below are
-- FOR SHARE NOWAIT (never wait, fail closed), so no actor-first or downstream wait
-- is added against lifecycle (employee -> actor) or account (employee -> U09 ->
-- user_branches -> profiles) writers.
create function role_settings_private.require_employee_scope(p_employee uuid,p_old_branch uuid,p_new_branch uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare v_role public.user_role; v_all boolean;
begin
 select role into v_role from public.profiles where id=auth.uid() and is_active;
 if v_role is null then raise exception using errcode='42501',message='EMPLOYEE_SCOPE_DENIED: akun tidak aktif'; end if;
 if v_role='OWNER' then return; end if;
 if v_role<>'ADMIN' then raise exception using errcode='42501',message='EMPLOYEE_SCOPE_DENIED: peran'; end if;
 perform 1 from public.user_branches where user_id=auth.uid() order by branch_id for share nowait;
 perform 1 from public.employee_branch_assignments where employee_id=p_employee order by branch_id for share nowait;
 select coalesce((select c.all_branches from public.role_capabilities c where c.role=v_role),true) into v_all;
 if not (
   (p_old_branch is null or v_all or exists(select 1 from public.user_branches u where u.user_id=auth.uid() and u.branch_id=p_old_branch)
    or exists(select 1 from public.employee_branch_assignments a where a.employee_id=p_employee and a.branch_id is not null
        and (v_all or exists(select 1 from public.user_branches u where u.user_id=auth.uid() and u.branch_id=a.branch_id))))
   and (p_new_branch is not distinct from p_old_branch or p_new_branch is null or v_all
    or exists(select 1 from public.user_branches u where u.user_id=auth.uid() and u.branch_id=p_new_branch))
 ) then
  raise exception using errcode='42501',message='EMPLOYEE_SCOPE_DENIED: cabang karyawan di luar cakupan akun';
 end if;
end $$;
revoke all on function role_settings_private.require_employee_scope(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.guard_employee_contact_action() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and
   row(new.nik,new.nama,new.jabatan,new.departemen,new.phone,new.email,new.tgl_masuk)
   is distinct from
   row(old.nik,old.nama,old.jabatan,old.departemen,old.phone,old.email,old.tgl_masuk) then
  perform public.require_role_action('people.editKaryawan');
  perform role_settings_private.require_employee_scope(old.id,old.branch_id,new.branch_id);
 end if;
 return new;
end $$;
revoke all on function public.guard_employee_contact_action() from public,anon,authenticated,service_role;
create trigger people_employee_contact_action before update on public.employees
 for each row execute function public.guard_employee_contact_action();
update role_settings_private.action_catalog set enforced=true where id='people.editKaryawan';
