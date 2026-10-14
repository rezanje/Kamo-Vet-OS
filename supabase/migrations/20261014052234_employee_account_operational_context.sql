-- No employee/account creation and no historical entitlement/data backfill.
-- A duplicate link stops rollout for explicit review rather than picking a person.
do $$ begin
 if exists(select 1 from public.employees where profile_id is not null group by profile_id having count(*)>1) then
   raise exception 'HRIS_LINK_DUPLICATES: review duplicate employee/profile links before rollout';
 end if;
end $$;
create unique index employees_one_profile on public.employees(profile_id) where profile_id is not null;

-- Profile privileges cannot be self-promoted through the existing own-row policy.
create function public.guard_employee_account_identity() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user in ('postgres','supabase_admin','supabase_auth_admin','service_role') then return new; end if;
 if tg_table_name='profiles' then
   if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
      and not (public.is_admin() and exists(select 1 from public.profiles where id=auth.uid() and is_active)) then raise exception 'ACCOUNT_ADMIN_REQUIRED'; end if;
 elsif ((tg_op='INSERT' and new.profile_id is not null)
    or (tg_op='UPDATE' and new.profile_id is distinct from old.profile_id))
    and not (public.is_admin() and exists(select 1 from public.profiles where id=auth.uid() and is_active)) then raise exception 'ACCOUNT_ADMIN_REQUIRED';
 end if;
 return new;
end $$;
create trigger guard_employee_profile_link before insert or update on public.employees
for each row execute function public.guard_employee_account_identity();
create trigger guard_profile_privileges before update on public.profiles
for each row execute function public.guard_employee_account_identity();

create function public.link_employee_account(p_profile_id uuid,p_employee_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_profile uuid; v_employee public.employees;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN')) then
   raise exception 'ACCOUNT_ADMIN_REQUIRED';
 end if;
 select id into v_profile from public.profiles where id=p_profile_id for update;
 if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
 select * into v_employee from public.employees where id=p_employee_id for update;
 if not found or v_employee.status<>'Aktif' then raise exception 'EMPLOYEE_NOT_AVAILABLE'; end if;
 if (v_employee.profile_id is not null and v_employee.profile_id<>p_profile_id)
   or exists(select 1 from public.employees where profile_id=p_profile_id and id<>p_employee_id) then
   raise exception 'EMPLOYEE_ALREADY_LINKED';
 end if;
 update public.employees set profile_id=p_profile_id where id=p_employee_id;
end $$;
revoke all on function public.link_employee_account(uuid,uuid) from public,anon;
grant execute on function public.link_employee_account(uuid,uuid) to authenticated;

create function public.configure_employee_account(p_profile_id uuid,p_employee_id uuid,p_full_name text,p_role text,p_branch_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 -- This entry point only finishes a new, unconfigured account. Repairs use the
 -- link-only function and do not touch roles/branch access.
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN')) then
   raise exception 'ACCOUNT_ADMIN_REQUIRED';
 end if;
 perform 1 from public.profiles where id=p_profile_id for update;
 if not found or exists(select 1 from public.employees where profile_id=p_profile_id)
   or exists(select 1 from public.user_branches where user_id=p_profile_id) then raise exception 'ACCOUNT_NOT_UNCONFIGURED'; end if;
 if p_profile_id=auth.uid() or p_role is null or p_role not in ('OWNER','ADMIN','FINANCE','STAFF','DOCTOR')
   or nullif(trim(p_full_name),'') is null or p_branch_ids is null or cardinality(p_branch_ids)>50
   or (p_role in ('STAFF','DOCTOR') and cardinality(p_branch_ids)=0)
   or exists(select 1 from unnest(p_branch_ids) b where b is null or not exists(select 1 from public.branches where id=b and is_active)) then
   raise exception 'ACCOUNT_INPUT_INVALID';
 end if;
 perform public.link_employee_account(p_profile_id,p_employee_id);
 update public.profiles set full_name=trim(p_full_name),role=p_role::public.user_role,is_active=true where id=p_profile_id;
 insert into public.user_branches(user_id,branch_id,role)
 select p_profile_id,b,'SECONDARY'::public.branch_assignment_role from (select distinct unnest(p_branch_ids) b) ids;
end $$;
revoke all on function public.configure_employee_account(uuid,uuid,text,text,uuid[]) from public,anon;
grant execute on function public.configure_employee_account(uuid,uuid,text,text,uuid[]) to authenticated;

-- Caller-controlled context only narrows live database grants. It never grants
-- access by itself. No context keeps authorized backoffice multi-branch reports.
create or replace function public.user_can_access_branch(b uuid)
returns boolean language plpgsql security definer stable set search_path='' as $$
declare v_selected text;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active
   and (p.role in ('OWNER','ADMIN','FINANCE') or exists(select 1 from public.user_branches u where u.user_id=p.id and u.branch_id=b))) then return false; end if;
 v_selected := nullif(nullif(current_setting('request.headers',true),'')::jsonb->>'x-kamo-operational-branch','');
 if v_selected is not null then
   if v_selected<>b::text or not exists(select 1 from public.branches where id=b and is_active) then return false; end if;
 end if;
 return true;
end $$;
revoke all on function public.user_can_access_branch(uuid) from public,anon;
grant execute on function public.user_can_access_branch(uuid) to authenticated;

-- Requisition destinations are master references, not access to their stock or
-- transactions. Keep cross-branch/DC requests usable in an isolated workflow.
create function public.operational_request_destinations(p_dc_only boolean default false) returns table(id uuid,name text)
language plpgsql security definer stable set search_path='' as $$
declare selected text;
begin
 selected:=nullif(nullif(current_setting('request.headers',true),'')::jsonb->>'x-kamo-operational-branch','');
 if selected is null or not public.user_can_access_branch(selected::uuid) then raise exception 'ACCESS_DENIED'; end if;
 return query select w.id,w.name::text from public.warehouses w join public.branches b on b.id=w.branch_id
 where w.is_active and b.is_active and (not p_dc_only or w.code ilike 'DC%') order by w.name;
end $$;
revoke all on function public.operational_request_destinations(boolean) from public,anon;
grant execute on function public.operational_request_destinations(boolean) to authenticated;

-- Restrictive policies intersect the old permissive demo policies.
do $$ declare t text; begin
 foreach t in array array['visits','sales','cashier_shifts','expenses','sale_drafts','bookings'] loop
   execute format('create policy operational_branch_isolation on public.%I as restrictive for all to authenticated using(public.user_can_access_branch(branch_id)) with check(public.user_can_access_branch(branch_id))',t);
 end loop;
end $$;
create policy operational_branch_selection on public.branches as restrictive for select to authenticated
using (nullif(nullif(current_setting('request.headers',true),'')::jsonb->>'x-kamo-operational-branch','') is null or public.user_can_access_branch(id));
create policy operational_warehouse_selection on public.warehouses as restrictive for select to authenticated
using (nullif(nullif(current_setting('request.headers',true),'')::jsonb->>'x-kamo-operational-branch','') is null or public.user_can_access_branch(branch_id));
create policy operational_stock_isolation on public.stock as restrictive for all to authenticated
using(exists(select 1 from public.warehouses w where w.id=stock.warehouse_id and public.user_can_access_branch(w.branch_id)))
with check(exists(select 1 from public.warehouses w where w.id=stock.warehouse_id and public.user_can_access_branch(w.branch_id)));
create policy operational_request_isolation on public.stock_requests as restrictive for all to authenticated
using(public.user_can_access_branch(from_branch_id)) with check(public.user_can_access_branch(from_branch_id));

-- Explicit acyclic ownership paths also protect historical permissive children.
-- Parent visibility is checked under the caller's RLS, never SECURITY DEFINER.
do $$ declare r record; predicate text; begin
 for r in select * from (values
 ('sale_items','sale_id','sales'),('sale_item_group_components','sale_item_id','sale_items'),
 ('medical_records','visit_id','visits'),('prescription_items','medical_record_id','medical_records'),
 ('compounding_recipes','medical_record_id','medical_records'),('compounding_ingredients','recipe_id','compounding_recipes'),
 ('invoices','visit_id','visits'),('invoice_items','invoice_id','invoices'),('invoice_payments','invoice_id','invoices'),('invoice_edit_log','invoice_id','invoices'),
 ('consents','visit_id','visits'),('inpatient_records','visit_id','visits'),
 ('inpatient_status_log','inpatient_record_id','inpatient_records'),('inpatient_daily_logs','inpatient_record_id','inpatient_records'),
 ('inpatient_daily_log_edits','log_id','inpatient_daily_logs'),('inpatient_medications','inpatient_record_id','inpatient_records'),('inpatient_med_doses','medication_id','inpatient_medications'),
 ('visit_referrals','visit_id','visits'),('visit_operational_events','visit_id','visits'),
 ('clinic_demo_invoice_snapshots','invoice_id','invoices'),('clinic_demo_incentive_allocations','invoice_id','invoices'),
 ('stock_request_items','request_id','stock_requests')
 ) as paths(child,fk,parent) loop
   -- Fail rollout on schema mismatch instead of silently omitting isolation.
   if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=r.child and column_name=r.fk) then
     raise exception 'OPERATIONAL_SCOPE_SCHEMA_MISMATCH: %.%',r.child,r.fk;
   end if;
   predicate := format('exists(select 1 from public.%I parent where parent.id=%I.%I)',r.parent,r.child,r.fk);
   execute format('create policy operational_parent_isolation on public.%I as restrictive for all to authenticated using(%s) with check(%s)',r.child,predicate,predicate);
 end loop;
end $$;

-- Snapshot canonical HRIS identity prospectively. Preserve all historical rows.
alter table public.cashier_shifts add column employee_id uuid references public.employees(id);
alter table public.sales add column cashier_employee_id uuid references public.employees(id);
alter table public.expenses add column created_by_employee_id uuid references public.employees(id);
create index on public.cashier_shifts(employee_id);
create index on public.sales(cashier_employee_id);
create index on public.expenses(created_by_employee_id);
create function public.snapshot_operational_employee() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_employee uuid; v_old jsonb; v_new jsonb;
begin
 v_new:=to_jsonb(new); v_actor:=(v_new->>tg_argv[0])::uuid;
 if tg_op='INSERT' and auth.role()='authenticated' and v_actor is distinct from auth.uid() and not public.is_admin() then
   raise exception 'OPERATIONAL_ACTOR_INVALID';
 end if;
 if tg_op='UPDATE' then
   v_old:=to_jsonb(old);
   -- Deleting an auth account can null its profile FK; keep the HRIS snapshot.
   if (v_actor is not null or auth.role()='authenticated') and (v_new->>tg_argv[0]) is distinct from (v_old->>tg_argv[0]) then raise exception 'OPERATIONAL_ACTOR_IMMUTABLE'; end if;
   v_employee:=(v_old->>tg_argv[1])::uuid;
 else
   select id into v_employee from public.employees where profile_id=v_actor and status='Aktif';
 end if;
 new:=jsonb_populate_record(new,jsonb_build_object(tg_argv[1],v_employee));
 return new;
end $$;
revoke all on function public.snapshot_operational_employee() from public,anon,authenticated;
create trigger snapshot_shift_employee before insert or update on public.cashier_shifts for each row execute function public.snapshot_operational_employee('opened_by','employee_id');
create trigger snapshot_sale_employee before insert or update on public.sales for each row execute function public.snapshot_operational_employee('cashier_id','cashier_employee_id');
create trigger snapshot_expense_employee before insert or update on public.expenses for each row execute function public.snapshot_operational_employee('created_by','created_by_employee_id');
