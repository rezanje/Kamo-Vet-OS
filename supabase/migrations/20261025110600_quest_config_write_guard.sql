-- Quest and reward configuration stays readable to staff; only active managers
-- can change it. The prior prototype ALL policies must match before replacement.
do $$
declare baseline record;
begin
  for baseline in select * from (values
    ('staff_quest_definitions','sqd_all'),
    ('staff_reward_catalog','src_all'),
    ('quest_settings','qs_all')
  ) as expected(table_name,policy_name) loop
    if not coalesce((select relrowsecurity from pg_class
      where oid=to_regclass('public.'||baseline.table_name)),false)
      or (select count(*) from pg_policies
        where schemaname='public' and tablename=baseline.table_name)<>1
      or not exists(select 1 from pg_policies
        where schemaname='public' and tablename=baseline.table_name
          and policyname=baseline.policy_name and permissive='PERMISSIVE'
          and cmd='ALL' and roles=array['authenticated']::name[]
          and qual='true' and with_check='true')
      or not has_table_privilege('authenticated',format('public.%I',baseline.table_name),'TRUNCATE')
    then
      raise exception 'QUEST_CONFIG_POLICY_CHANGED: review %',baseline.table_name;
    end if;
  end loop;
end $$;

drop policy sqd_all on public.staff_quest_definitions;
drop policy src_all on public.staff_reward_catalog;
drop policy qs_all on public.quest_settings;

create policy quest_definitions_read on public.staff_quest_definitions
  for select to authenticated using (true);
create policy quest_definitions_manager_insert on public.staff_quest_definitions
  for insert to authenticated with check (exists (
    select 1 from public.profiles p where p.id=auth.uid()
      and p.is_active and p.role in ('OWNER','ADMIN')));
create policy quest_definitions_manager_update on public.staff_quest_definitions
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid()
    and p.is_active and p.role in ('OWNER','ADMIN')))
  with check (exists (select 1 from public.profiles p where p.id=auth.uid()
    and p.is_active and p.role in ('OWNER','ADMIN')));

create policy reward_catalog_read on public.staff_reward_catalog
  for select to authenticated using (true);
create policy reward_catalog_manager_insert on public.staff_reward_catalog
  for insert to authenticated with check (exists (
    select 1 from public.profiles p where p.id=auth.uid()
      and p.is_active and p.role in ('OWNER','ADMIN')));
create policy reward_catalog_manager_update on public.staff_reward_catalog
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid()
    and p.is_active and p.role in ('OWNER','ADMIN')))
  with check (exists (select 1 from public.profiles p where p.id=auth.uid()
    and p.is_active and p.role in ('OWNER','ADMIN')));

create policy quest_settings_read on public.quest_settings
  for select to authenticated using (true);
create policy quest_settings_manager_update on public.quest_settings
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid()
    and p.is_active and p.role in ('OWNER','ADMIN')))
  with check (exists (select 1 from public.profiles p where p.id=auth.uid()
    and p.is_active and p.role in ('OWNER','ADMIN')));

revoke truncate on public.staff_quest_definitions,public.staff_reward_catalog,
  public.quest_settings from public,anon,authenticated;
