-- Additive secondary assignments. One call is one transaction; existing primary
-- and unselected secondary branches are preserved.
create function public.assign_employee_secondary_branches(
  p_employee_id uuid, p_branch_ids uuid[], p_effective_date date
) returns integer language plpgsql security invoker set search_path='' as $$
declare
  v_employee public.employees%rowtype;
  v_ids uuid[];
  v_branch public.branches%rowtype;
  v_seen integer := 0;
begin
  if auth.uid() is null or coalesce(auth.role(),'') <> 'authenticated' then
    raise exception using errcode='P0001',message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  perform 1 from public.profiles where id=auth.uid()
    and role in ('OWNER','ADMIN') and is_active=true for share;
  if not found then
    raise exception using errcode='P0001',message='ACCESS_DENIED: hanya pemilik atau admin aktif yang boleh mengubah penugasan';
  end if;
  if p_employee_id is null or p_effective_date is null or p_branch_ids is null
    or array_ndims(p_branch_ids) is distinct from 1
    or cardinality(p_branch_ids) not between 1 and 50
    or array_position(p_branch_ids,null) is not null then
    raise exception using errcode='P0001',message='ASSIGNMENT_INVALID: pilih karyawan, cabang tambahan dan tanggal yang valid';
  end if;
  select array_agg(id order by id) into v_ids from (select distinct unnest(p_branch_ids) id) selected;
  select * into v_employee from public.employees where id=p_employee_id for update;
  if not found or v_employee.status is distinct from 'Aktif' then
    raise exception using errcode='P0001',message='ASSIGNMENT_INVALID: karyawan harus aktif';
  end if;
  if v_employee.branch_id=any(v_ids) or exists (
    select 1 from public.employee_branch_assignments
    where employee_id=p_employee_id and branch_id=any(v_ids) and role='PRIMARY'
  ) then
    raise exception using errcode='P0001',message='ASSIGNMENT_INVALID: cabang utama tidak boleh menjadi cabang tambahan';
  end if;
  for v_branch in select * from public.branches where id=any(v_ids) order by id for share loop
    if not v_branch.is_active then
      raise exception using errcode='P0001',message='ASSIGNMENT_INVALID: ada cabang nonaktif';
    end if;
    if not public.user_can_access_branch(v_branch.id) then
      raise exception using errcode='P0001',message='ACCESS_DENIED: ada cabang yang tidak diizinkan';
    end if;
    v_seen := v_seen+1;
  end loop;
  if v_seen<>cardinality(v_ids) then
    raise exception using errcode='P0001',message='ASSIGNMENT_INVALID: ada cabang yang tidak aktif atau tidak dapat diakses';
  end if;
  insert into public.employee_branch_assignments(employee_id,branch_id,role,effective_date)
    select p_employee_id,id,'SECONDARY'::public.branch_assignment_role,p_effective_date from unnest(v_ids) id
    on conflict(employee_id,branch_id) do update set effective_date=excluded.effective_date
    where public.employee_branch_assignments.role='SECONDARY';
  return cardinality(v_ids);
end;
$$;
revoke all on function public.assign_employee_secondary_branches(uuid,uuid[],date) from public,anon,service_role;
grant execute on function public.assign_employee_secondary_branches(uuid,uuid[],date) to authenticated;
