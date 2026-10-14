-- READ ONLY review queries; no names, contact details or compensation amounts.
-- Run only after authorization against the intended environment.
-- Do not infer employee identity from matching names/emails.
select profile_id, array_agg(id order by id) as employee_ids, count(*) as link_count
from public.employees where profile_id is not null group by profile_id having count(*)>1;
select p.id as profile_id,p.role,p.is_active
from public.profiles p where not exists(select 1 from public.employees e where e.profile_id=p.id)
order by p.role,p.id;
select e.id as employee_id,e.profile_id,e.status
from public.employees e where e.profile_id is not null and e.status<>'Aktif';
select p.id as profile_id,p.role
from public.profiles p where p.is_active and p.role in ('STAFF','DOCTOR')
and not exists(select 1 from public.user_branches u join public.branches b on b.id=u.branch_id where u.user_id=p.id and b.is_active);
-- Historical audit attribution must be reviewed separately, never automatically
-- recomputed from today's links or used to change posted payroll/entitlements.
select 'cashier_shifts' as source,count(*) as records from public.cashier_shifts where opened_by is not null
union all select 'sales',count(*) from public.sales where cashier_id is not null
union all select 'expenses',count(*) from public.expenses where created_by is not null;
