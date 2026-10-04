-- Fictional local database only; fixtures and helper functions roll back.
begin;
create function public.test_profile_denied(statement text, expected text default 'PROFILE_ACCOUNT_AUTH:')
returns void language plpgsql as $$
declare before_state jsonb;
begin
 before_state:=public.test_profile_state();
 begin
  execute statement;
  raise exception 'Expected account administration denial: %',statement;
 exception when insufficient_privilege then
  if sqlerrm not like expected||'%' then raise; end if;
 end;
 assert before_state=public.test_profile_state(),'denied update must leave every profile unchanged';
end $$;
create function public.test_profile_state()returns jsonb language sql security definer set search_path=''as $$
 select jsonb_agg(to_jsonb(p)order by p.id)from public.profiles p
$$;

insert into auth.users(id)select ('f8100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,8)i;
update profiles set full_name='Fiction profile',role=case right(id::text,1)
 when '1'then 'FINANCE'::user_role when '2'then 'OWNER'::user_role
 when '3'then 'ADMIN'::user_role when '5'then 'ADMIN'::user_role
 when '6'then 'OWNER'::user_role when '8'then 'DOCTOR'::user_role else 'STAFF'::user_role end,
 is_active=right(id::text,1)not in('1','2','3');

set local role authenticated;
do $$ declare i integer; caller uuid; begin
 for i in 1..3 loop
  caller:=('f8100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  perform set_config('request.jwt.claim.sub',caller::text,true);
  -- A valid disabled session retains own-update RLS; neither NEW nor JWT
  -- activation/role claims may grant authority.
  perform set_config('request.jwt.claim.role','service_role',true);
  perform public.test_profile_denied(format('update public.profiles set is_active=true where id=%L',caller));
  perform public.test_profile_denied(format('update public.profiles set is_active=true,role=%L where id=%L','STAFF',caller));
  perform public.test_profile_denied(format('update public.profiles set full_name=%L where id=%L','Fiction disabled edit',caller));
  if i>1 then
   perform public.test_profile_denied('update public.profiles set full_name=''Fiction disabled admin'' where id=''f8100000-0000-4000-8000-000000000007''');
   perform public.test_profile_denied('update public.profiles set is_active=true where id=''f8100000-0000-4000-8000-000000000001''');
   perform public.test_profile_denied('update public.profiles set role=''OWNER'' where id=''f8100000-0000-4000-8000-000000000007''');
  end if;
 end loop;
end $$;

select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000004',true);
update profiles set full_name='Fiction staff personal edit'where id='f8100000-0000-4000-8000-000000000004';
do $$ begin
 assert (select full_name='Fiction staff personal edit'from profiles where id=auth.uid()),'active staff personal edit allowed';
 perform public.test_profile_denied('update public.profiles set is_active=false where id=auth.uid()','PROFILE_ACCOUNT_ADMIN:');
 perform public.test_profile_denied('update public.profiles set role=''OWNER'' where id=auth.uid()','PROFILE_ACCOUNT_ADMIN:');
end $$;

-- Active administrators retain legitimate changes to other accounts.
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000005',true);
update profiles set is_active=true where id='f8100000-0000-4000-8000-000000000001';
update profiles set role='FINANCE',full_name='Fiction administered profile'where id='f8100000-0000-4000-8000-000000000007';
do $$ begin
 assert (select is_active from profiles where id='f8100000-0000-4000-8000-000000000001'),'active admin enables others';
 assert (select role='FINANCE'and full_name='Fiction administered profile'from profiles where id='f8100000-0000-4000-8000-000000000007'),'active admin assigns others role';
 begin
  update profiles set role='OWNER'where id=auth.uid();
  raise exception 'Existing self-role guard was weakened';
 exception when raise_exception then
  if sqlerrm not like 'ACCESS_DENIED:%'then raise; end if;
 end;
end $$;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000006',true);
update profiles set is_active=false where id='f8100000-0000-4000-8000-000000000007';
update profiles set role='DOCTOR'where id='f8100000-0000-4000-8000-000000000007';
do $$ begin
 assert (select not is_active and role='DOCTOR'from profiles where id='f8100000-0000-4000-8000-000000000007'),'active owner manages other account';
 begin
  update profiles set role='ADMIN'where id=auth.uid();
  raise exception 'Existing OWNER self-role guard was weakened';
 exception when raise_exception then
  if sqlerrm not like 'ACCESS_DENIED:%'then raise; end if;
 end;
end $$;

-- Database role is trusted, not a forged claim from an authenticated session.
set local role service_role;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000002',true);
update profiles set is_active=true,role='FINANCE'where id='f8100000-0000-4000-8000-000000000007';
do $$ begin
 assert (select is_active and role='FINANCE'from profiles where id='f8100000-0000-4000-8000-000000000007'),'trusted service account supported';
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update profiles set is_active=true,role='ADMIN'where id='f8100000-0000-4000-8000-000000000002';
do $$ begin
 assert (select is_active and role='ADMIN'from profiles where id='f8100000-0000-4000-8000-000000000002'),'direct postgres bootstrap supported';
end $$;
rollback;
