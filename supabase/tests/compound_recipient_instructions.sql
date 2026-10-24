-- Fictional data only, isolated PostgreSQL. No target record updates.
begin;
set local timezone = 'Asia/Jakarta';
insert into auth.users(id) values ('be000000-0000-4000-8000-000000000001');
update public.profiles set role='OWNER' where id='be000000-0000-4000-8000-000000000001';
insert into public.branches(id,code,name,type) values ('be100000-0000-4000-8000-000000000001','RECIPIENT','Fictional clinic','KLINIK');
insert into public.user_branches(user_id,branch_id) values ('be000000-0000-4000-8000-000000000001','be100000-0000-4000-8000-000000000001');
insert into public.customers(id,name,phone) values ('be200000-0000-4000-8000-000000000001','Fictional owner','080000000099');
insert into public.pets(id,customer_id,name) values ('be300000-0000-4000-8000-000000000001','be200000-0000-4000-8000-000000000001','Fictional pet');
insert into public.visits(id,branch_id,customer_id,pet_id) values ('be400000-0000-4000-8000-000000000001','be100000-0000-4000-8000-000000000001','be200000-0000-4000-8000-000000000001','be300000-0000-4000-8000-000000000001');
insert into public.medical_records(id,visit_id) values ('be500000-0000-4000-8000-000000000001','be400000-0000-4000-8000-000000000001');
insert into public.compounding_recipes(id,medical_record_id,recipe_name,dosage_instruction,compounding_steps,total_volume,dosage_form)
values ('be600000-0000-4000-8000-000000000001','be500000-0000-4000-8000-000000000001','Fictional legacy compound',null,'habiskan, sebelum makan','7','kapsul'),
 ('be600000-0000-4000-8000-000000000002','be500000-0000-4000-8000-000000000001','Fictional new compound',null,null,null,'kapsul');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','be000000-0000-4000-8000-000000000001',true);
do $$
declare v_before jsonb; v_after jsonb; v_lines jsonb;
begin
  select to_jsonb(r)-'dosage_instruction'-'total_volume' into v_before from public.compounding_recipes r where id='be600000-0000-4000-8000-000000000001';
  select jsonb_agg(to_jsonb(p)-'aturan_pakai') into v_lines from public.prescription_items p where compound_recipe_id='be600000-0000-4000-8000-000000000001';
  if (select dosage_instruction from public.compounding_recipes where id='be600000-0000-4000-8000-000000000001') is not null then
    raise exception 'Legacy mixed text was automatically reinterpreted';
  end if;
  update public.compounding_recipes set dosage_instruction=E'Explicitly reviewed fictional instruction\nSecond line',total_volume='8'
    where id='be600000-0000-4000-8000-000000000001' and status in ('pending','ready');
  if (select aturan_pakai from public.prescription_items where compound_recipe_id='be600000-0000-4000-8000-000000000001') is distinct from E'Explicitly reviewed fictional instruction\nSecond line' then
    raise exception 'Saved recipient instruction did not reach the printed prescription';
  end if;
  select to_jsonb(r)-'dosage_instruction'-'total_volume' into v_after from public.compounding_recipes r where id='be600000-0000-4000-8000-000000000001';
  if v_after is distinct from v_before or (select jsonb_agg(to_jsonb(p)-'aturan_pakai') from public.prescription_items p where compound_recipe_id='be600000-0000-4000-8000-000000000001') is distinct from v_lines then
    raise exception 'Usage edit changed internal preparation, recipe or billing fields';
  end if;
  update public.compounding_recipes set dosage_instruction=null where id='be600000-0000-4000-8000-000000000001';
  if (select aturan_pakai from public.prescription_items where compound_recipe_id='be600000-0000-4000-8000-000000000001') is not null then raise exception 'Blank usage not preserved'; end if;
  update public.prescription_items set aturan_pakai='Fictional historic mismatch' where compound_recipe_id='be600000-0000-4000-8000-000000000001';
  update public.compounding_recipes set dosage_instruction=null where id='be600000-0000-4000-8000-000000000001';
  if (select aturan_pakai from public.prescription_items where compound_recipe_id='be600000-0000-4000-8000-000000000001') is not null then raise exception 'Explicit unchanged usage save did not reconcile print'; end if;
  begin
    delete from public.prescription_items where compound_recipe_id='be600000-0000-4000-8000-000000000001';
    update public.compounding_recipes set dosage_instruction='Must not save without linked prescription' where id='be600000-0000-4000-8000-000000000001';
    raise exception 'Orphan usage save succeeded';
  exception when raise_exception then if sqlerrm not like 'USAGE_LINK_MISSING:%' then raise;end if;end;
  if (select dosage_instruction from public.compounding_recipes where id='be600000-0000-4000-8000-000000000001') is not null then raise exception 'Orphan usage was partially saved';end if;
  update public.compounding_recipes set compounding_steps='Internal technical preparation' where id='be600000-0000-4000-8000-000000000002';
  if (select dosage_instruction from public.compounding_recipes where id='be600000-0000-4000-8000-000000000002') is not null
    or (select aturan_pakai from public.prescription_items where compound_recipe_id='be600000-0000-4000-8000-000000000002') is not null then raise exception 'Internal steps leaked into usage'; end if;
  update public.compounding_recipes set status='handed_over' where id='be600000-0000-4000-8000-000000000002';
  update public.compounding_recipes set dosage_instruction='Must not save' where id='be600000-0000-4000-8000-000000000002' and status in ('pending','ready');
  if found then raise exception 'Handed-over recipe accepted recipient save';end if;
  update public.compounding_recipes set status='void' where id='be600000-0000-4000-8000-000000000002';
  update public.compounding_recipes set dosage_instruction='Must not save' where id='be600000-0000-4000-8000-000000000002' and status in ('pending','ready');
  if found then raise exception 'Void recipe accepted recipient save';end if;
  perform set_config('request.headers','{"x-kamo-operational-branch":"be100000-0000-4000-8000-000000000099"}',true);
  update public.compounding_recipes set dosage_instruction='Forbidden branch' where id='be600000-0000-4000-8000-000000000001' and status in ('pending','ready');
  if found then raise exception 'Recipient action bypassed selected-branch RLS';end if;
  perform set_config('request.headers','{}',true);
end $$;

-- Failure in linked prescription write must roll back recipient usage too.
reset role;
create function public.fictional_reject_recipient_sync() returns trigger language plpgsql as $$begin raise exception 'FICTIONAL_REJECT';end$$;
create trigger fictional_reject_recipient_sync before update on public.prescription_items for each row execute function public.fictional_reject_recipient_sync();
set local role authenticated;
do $$begin
  begin
    update public.compounding_recipes set dosage_instruction='Must roll back' where id='be600000-0000-4000-8000-000000000001';
    raise exception 'Sync failure did not abort';
  exception when raise_exception then if sqlerrm <> 'FICTIONAL_REJECT' then raise; end if; end;
  if (select dosage_instruction from public.compounding_recipes where id='be600000-0000-4000-8000-000000000001') is not null then raise exception 'Partial usage save survived';end if;
end $$;
reset role;
drop trigger fictional_reject_recipient_sync on public.prescription_items;
drop function public.fictional_reject_recipient_sync();
do $$begin
  if (select prosecdef from pg_proc where oid='public.sync_compound_recipient_instruction()'::regprocedure) then raise exception 'Sync bypasses caller RLS';end if;
  if has_function_privilege('anon','public.sync_compound_recipient_instruction()','EXECUTE') or has_function_privilege('authenticated','public.sync_compound_recipient_instruction()','EXECUTE') then raise exception 'Internal trigger function exposed';end if;
end $$;
rollback;
