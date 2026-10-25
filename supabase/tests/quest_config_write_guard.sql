-- Fictional roles only; run against disposable PostgreSQL.
begin;
insert into auth.users(id) values
 ('a4110000-0000-4000-8000-000000000001'),
 ('a4110000-0000-4000-8000-000000000002'),
 ('a4110000-0000-4000-8000-000000000003'),
 ('a4110000-0000-4000-8000-000000000004');
update public.profiles set role='OWNER' where id='a4110000-0000-4000-8000-000000000001';
update public.profiles set role='ADMIN' where id='a4110000-0000-4000-8000-000000000002';
update public.profiles set role='STAFF' where id='a4110000-0000-4000-8000-000000000003';
update public.profiles set role='OWNER',is_active=false where id='a4110000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a4110000-0000-4000-8000-000000000003"}',true);
do $$ declare changed integer; begin
 if (select count(*) from public.staff_quest_definitions)=0
  or (select count(*) from public.staff_reward_catalog)=0
  or (select count(*) from public.quest_settings)<>1 then
  raise exception 'Staff lost configuration read access';end if;
 if has_table_privilege('authenticated','public.staff_quest_definitions','TRUNCATE')
  or has_table_privilege('authenticated','public.staff_reward_catalog','TRUNCATE')
  or has_table_privilege('authenticated','public.quest_settings','TRUNCATE') then
  raise exception 'Authenticated can truncate configuration';end if;
 begin
  insert into public.staff_quest_definitions(quest_type,title,target_kind,target_value,points_reward)
   values('daily','Staff injection','product_qty',1,999);
  raise exception 'Staff created quest';
 exception when insufficient_privilege then null;end;
 begin
  insert into public.staff_reward_catalog(reward_name,reward_type,points_cost)
   values('Staff injection','free_shipping',1);
  raise exception 'Staff created reward';
 exception when insufficient_privilege then null;end;
 update public.staff_quest_definitions set points_reward=999 where title like 'Total Penjualan%';
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Staff changed quest';end if;
 delete from public.staff_quest_definitions where title like 'Total Penjualan%';
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Staff deleted quest';end if;
 update public.staff_reward_catalog set points_cost=1 where reward_name='Gratis Ongkir';
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Staff changed reward';end if;
 delete from public.staff_reward_catalog where reward_name='Gratis Ongkir';
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Staff deleted reward';end if;
 update public.quest_settings set streak_bonus_points=999 where id=1;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Staff changed settings';end if;
end $$;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"a4110000-0000-4000-8000-000000000001"}',true);
do $$ declare changed integer; begin
 insert into public.staff_quest_definitions(id,quest_type,title,target_kind,target_value,points_reward)
  values('a4120000-0000-4000-8000-000000000001','daily','Owner fixture quest','product_qty',1,3);
 insert into public.staff_reward_catalog(id,reward_name,reward_type,points_cost)
  values('a4130000-0000-4000-8000-000000000001','Owner fixture reward','free_shipping',3);
 update public.staff_quest_definitions set points_reward=4 where id='a4120000-0000-4000-8000-000000000001';
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Owner quest update blocked';end if;
 update public.staff_reward_catalog set points_cost=4 where id='a4130000-0000-4000-8000-000000000001';
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Owner reward update blocked';end if;
 update public.quest_settings set streak_bonus_points=51 where id=1;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Owner settings update blocked';end if;
 begin
  insert into public.quest_settings(id) values(1);
  raise exception 'Owner inserted settings';
 exception when insufficient_privilege then null;end;
 delete from public.quest_settings where id=1;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Owner deleted settings';end if;
end $$;

reset role;
insert into public.staff_quest_progress(staff_id,quest_definition_id,period_key)
 values('a4110000-0000-4000-8000-000000000003','a4120000-0000-4000-8000-000000000001','2026-10-25');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a4110000-0000-4000-8000-000000000001"}',true);
do $$ declare changed integer; begin
 delete from public.staff_quest_definitions where id='a4120000-0000-4000-8000-000000000001';
 get diagnostics changed=row_count;
 if changed<>0 or not exists(select 1 from public.staff_quest_progress
   where quest_definition_id='a4120000-0000-4000-8000-000000000001') then
  raise exception 'Manager delete removed quest history';end if;
 delete from public.staff_reward_catalog where id='a4130000-0000-4000-8000-000000000001';
 get diagnostics changed=row_count;
 if changed<>0 or not exists(select 1 from public.staff_reward_catalog
   where id='a4130000-0000-4000-8000-000000000001') then
  raise exception 'Manager deleted reward catalog row';end if;
end $$;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"a4110000-0000-4000-8000-000000000002"}',true);
do $$ declare changed integer; begin
 update public.quest_settings set streak_bonus_points=52 where id=1;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'Active Admin settings update blocked';end if;
end $$;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"a4110000-0000-4000-8000-000000000004"}',true);
do $$ declare changed integer; begin
 begin
  insert into public.staff_reward_catalog(reward_name,reward_type,points_cost)
   values('Inactive owner injection','free_shipping',1);
  raise exception 'Inactive owner created reward';
 exception when insufficient_privilege then null;end;
 update public.quest_settings set streak_bonus_points=999 where id=1;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Inactive owner changed settings';end if;
end $$;

reset role;
do $$ begin
 if has_table_privilege('anon','public.staff_quest_definitions','TRUNCATE')
  or has_table_privilege('anon','public.staff_reward_catalog','TRUNCATE')
  or has_table_privilege('anon','public.quest_settings','TRUNCATE') then
  raise exception 'Anonymous can truncate configuration';end if;
end $$;
rollback;
