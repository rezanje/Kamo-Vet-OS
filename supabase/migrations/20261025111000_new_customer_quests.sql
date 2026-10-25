-- Customer acquisition is a distinct quest target; existing definitions stay intact.
do $$ begin
 if not (select relrowsecurity from pg_class where oid='public.staff_quest_definitions'::regclass)
  or (select count(*) from pg_policies where schemaname='public'
   and tablename='staff_quest_definitions')<>3
  or not exists(select 1 from pg_policies where schemaname='public'
   and tablename='staff_quest_definitions' and policyname='quest_definitions_read'
   and cmd='SELECT' and permissive='PERMISSIVE' and roles=array['authenticated']::name[]
   and qual='true')
  or not exists(select 1 from pg_policies where schemaname='public'
   and tablename='staff_quest_definitions' and policyname='quest_definitions_manager_insert'
   and cmd='INSERT' and permissive='PERMISSIVE' and roles=array['authenticated']::name[]
   and qual is null
   and regexp_replace(with_check,'[[:space:]]+',' ','g')=$manager$(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND p.is_active AND (p.role = ANY (ARRAY['OWNER'::user_role, 'ADMIN'::user_role])))))$manager$)
  or not exists(select 1 from pg_policies where schemaname='public'
   and tablename='staff_quest_definitions' and policyname='quest_definitions_manager_update'
   and cmd='UPDATE' and permissive='PERMISSIVE' and roles=array['authenticated']::name[]
   and regexp_replace(qual,'[[:space:]]+',' ','g')=$manager$(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND p.is_active AND (p.role = ANY (ARRAY['OWNER'::user_role, 'ADMIN'::user_role])))))$manager$
   and regexp_replace(with_check,'[[:space:]]+',' ','g')=$manager$(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND p.is_active AND (p.role = ANY (ARRAY['OWNER'::user_role, 'ADMIN'::user_role])))))$manager$)
  or has_table_privilege('authenticated','public.staff_quest_definitions','TRUNCATE')
  or has_table_privilege('anon','public.staff_quest_definitions','TRUNCATE')
  or exists(select 1 from pg_class c,
    aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    where c.oid='public.staff_quest_definitions'::regclass
     and acl.grantee=0 and acl.privilege_type='TRUNCATE')
  or not exists(select 1 from pg_constraint c
   where c.conrelid='public.staff_quest_definitions'::regclass
    and c.conname='staff_quest_definitions_target_kind_check' and c.contype='c'
    and pg_get_constraintdef(c.oid)=$expected$CHECK ((target_kind = ANY (ARRAY['product_qty'::text, 'category_qty'::text, 'total_sales_amount'::text])))$expected$)
  or not exists(select 1 from pg_proc p
   where p.oid='public.apply_sale_staff_effects(uuid)'::regprocedure
    and p.prosecdef and p.proowner=current_user::regrole
    and p.proconfig @> array['search_path=""']::text[]
    and md5(p.prosrc)='d1f34ba31278fbd6e9ad1a2b2c9fd7d9'
    and has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and not has_function_privilege('service_role',p.oid,'EXECUTE')
    and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where acl.grantee=0 and acl.privilege_type='EXECUTE')) then
  raise exception 'Q01_POLICY_DRIFT: review quest definition access before release';
 end if;
end $$;
alter table public.staff_quest_definitions
 drop constraint staff_quest_definitions_target_kind_check;
alter table public.staff_quest_definitions
 add constraint staff_quest_definitions_target_kind_check
 check (target_kind in ('product_qty','category_qty','total_sales_amount','new_customer'));
alter table public.staff_quest_definitions
 add constraint staff_quest_new_customer_count_check
 check (target_kind<>'new_customer' or
  (target_value::text not in ('NaN','Infinity','-Infinity')
   and target_value>=1 and target_value=trunc(target_value) and target_ref_id is null));

-- This key is deliberately global: formatting and +62/0 cannot create a second customer.
create function public.quest_customer_phone_key(p_phone text) returns text
language plpgsql immutable strict set search_path='' as $$
declare digits text:=regexp_replace(p_phone,'[^0-9]','','g');
begin
 if left(digits,2)='62' and length(digits)>9 then digits:='0'||substr(digits,3);end if;
 if length(digits)<8 or length(replace(digits,left(digits,1),''))=0 then return null;end if;
 return digits;
end $$;
revoke all on function public.quest_customer_phone_key(text) from public,anon,authenticated,service_role;
-- Expression-index maintenance runs as the customer writer; this pure formatter needs EXECUTE.
grant execute on function public.quest_customer_phone_key(text) to authenticated;
create index customers_quest_phone_key_idx on public.customers
 (public.quest_customer_phone_key(phone));

-- Claim ownership is chosen inside the payment finalizer transaction, not by a later reward hook.
create table public.quest_customer_first_sales (
 phone_key text primary key,
 sale_id uuid not null unique references public.sales(id),
 paid_at timestamptz not null,
 branch_id uuid not null references public.branches(id),
 cashier_id uuid not null references public.profiles(id)
);
alter table public.quest_customer_first_sales enable row level security;
revoke all on public.quest_customer_first_sales from public,anon,authenticated,service_role;

-- Every tracked sale has a durable ordered reward job, even when it has no customer.
create table public.quest_staff_effect_jobs (
 sale_id uuid primary key references public.sales(id),
 staff_id uuid not null references public.profiles(id),
 branch_id uuid not null references public.branches(id),
 paid_at timestamptz not null,
 phone_key text,
 customer_created_at timestamptz,
 eligible_new_identity boolean not null default false,
 queue_order bigint generated always as identity unique,
 definitions_snapshot jsonb not null,
 settings_snapshot jsonb not null,
 status text not null default 'pending' check(status in('pending','applied','voided')),
 attempts integer not null default 0 check(attempts>=0),
 last_attempt_at timestamptz,
 created_at timestamptz not null default now(),
 processed_at timestamptz
);
create index quest_staff_effect_jobs_pending_order on public.quest_staff_effect_jobs(staff_id,queue_order)
 where status='pending';
alter table public.quest_staff_effect_jobs enable row level security;
revoke all on public.quest_staff_effect_jobs from public,anon,authenticated,service_role;
revoke all on sequence public.quest_staff_effect_jobs_queue_order_seq from public,anon,authenticated,service_role;

create function public.quest_capture_first_customer_sale() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_phone_key text;v_customer_created_at timestamptz;
 previous public.quest_customer_first_sales%rowtype;
 v_definitions jsonb;v_settings jsonb;v_first_claim boolean:=false;v_eligible boolean:=false;
begin
 if old.payments_finalized_at is not null or new.payments_finalized_at is null
  or new.channel is not null or not new.quest_effects_tracked
  or new.cashier_id is null or new.shift_id is null then
  return new;
 end if;
 if new.customer_id is not null then
  select public.quest_customer_phone_key(c.phone),c.created_at into v_phone_key,v_customer_created_at
   from public.customers c where c.id=new.customer_id;
 end if;
 if v_phone_key is not null then
  perform pg_advisory_xact_lock(hashtextextended('vetos:q01:'||v_phone_key,0));
  select * into previous from public.quest_customer_first_sales where quest_customer_first_sales.phone_key=v_phone_key for update;
  if not found then
   v_first_claim:=true;
   insert into public.quest_customer_first_sales(phone_key,sale_id,paid_at,branch_id,cashier_id)
    values(v_phone_key,new.id,new.payments_finalized_at,new.branch_id,new.cashier_id);
  end if;
  if v_first_claim then
   v_eligible:=not exists(select 1 from public.customers prior
     where prior.id<>new.customer_id and public.quest_customer_phone_key(prior.phone)=v_phone_key
      and (prior.created_at,prior.id)<(v_customer_created_at,new.customer_id))
    and not exists(select 1 from public.sales prior
     join public.customers identity on identity.id=prior.customer_id
     where prior.id<>new.id and prior.channel is null
      and (prior.payments_finalized_at is not null
       or (prior.payment_plan is null and not prior.quest_effects_tracked))
      and public.quest_customer_phone_key(identity.phone)=v_phone_key);
  end if;
 end if;
 -- This second lock makes queue_order match commit order for one cashier.
 perform pg_advisory_xact_lock(hashtextextended('vetos:quest-staff:'||new.cashier_id::text,0));
 select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb) into v_definitions
  from public.staff_quest_definitions q where q.is_active and (q.branch_id is null or q.branch_id=new.branch_id)
   and q.created_at<=new.payments_finalized_at;
 select coalesce(to_jsonb(settings),'{}'::jsonb) into v_settings
  from public.quest_settings settings where id=1;
 insert into public.quest_staff_effect_jobs(sale_id,staff_id,branch_id,paid_at,phone_key,
  customer_created_at,eligible_new_identity,definitions_snapshot,settings_snapshot)
  values(new.id,new.cashier_id,new.branch_id,new.payments_finalized_at,v_phone_key,
   v_customer_created_at,v_eligible,v_definitions,v_settings);
 return new;
end $$;
revoke all on function public.quest_capture_first_customer_sale() from public,anon,authenticated,service_role;
create trigger quest_capture_first_customer_sale before update of payments_finalized_at on public.sales
 for each row execute function public.quest_capture_first_customer_sale();

-- Keep the mature quest snapshot/reversal code intact; change only acquisition contribution.
do $$
declare definition text:=pg_get_functiondef('public.apply_sale_staff_effects(uuid)'::regprocedure);
 old_decl text:=$old$ existing boolean;done boolean;cfg public.quest_settings%rowtype;$old$;
 new_decl text:=$new$ existing boolean;done boolean;cfg public.quest_settings%rowtype;
 sale_day date;job public.quest_staff_effect_jobs%rowtype;defs_snapshot jsonb;service_worker boolean;$new$;
 old_guard text:=$old$ select * into s from public.sales where id=p_sale_id for update;
 if not found or auth.uid() is null or auth.role() is distinct from 'authenticated' or s.cashier_id is distinct from auth.uid() then raise exception 'Penjualan tidak dapat diakses' using errcode='42501';end if;
 perform public.pos_sale_assert_actor(s);
 if s.channel is not null or not s.quest_effects_tracked or s.payments_finalized_at is null then raise exception 'Efek staf memerlukan penjualan kasir baru yang selesai';end if;
 if s.voided_at is not null then raise exception 'Penjualan sudah dibatalkan; hadiah staf tidak diterapkan';end if;
 if exists(select 1 from public.sale_staff_effects where sale_id=s.id) then return jsonb_build_object('applied',true);end if;
 -- All sale effect writers for the same employee share this row lock.
 perform 1 from public.profiles where id=s.cashier_id and is_active and role in('OWNER','ADMIN','FINANCE','STAFF','DOCTOR') for update;
 if not found then raise exception 'Akun staf aktif diperlukan' using errcode='42501';end if;$old$;
 new_guard text:=$new$ select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan' using errcode='42501';end if;
 select * into job from public.quest_staff_effect_jobs where sale_id=s.id for update;
 service_worker:=auth.role()='service_role' and current_setting('role',true)='service_role';
 if not service_worker then
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or s.cashier_id is distinct from auth.uid() then
   raise exception 'Penjualan tidak dapat diakses' using errcode='42501';end if;
  perform public.pos_sale_assert_actor(s);
 elsif not found or job.staff_id is distinct from s.cashier_id or job.branch_id is distinct from s.branch_id
  or job.paid_at is distinct from s.payments_finalized_at then
  raise exception 'Pekerjaan hadiah staf tidak valid' using errcode='42501';
 end if;
 if s.channel is not null or not s.quest_effects_tracked or s.payments_finalized_at is null then raise exception 'Efek staf memerlukan penjualan kasir baru yang selesai';end if;
 if s.voided_at is not null or job.status='voided' then raise exception 'Penjualan sudah dibatalkan; hadiah staf tidak diterapkan';end if;
 if exists(select 1 from public.sale_staff_effects where sale_id=s.id) then
  if job.sale_id is not null then update public.quest_staff_effect_jobs set status='applied',processed_at=now() where sale_id=s.id;end if;
  return jsonb_build_object('applied',true);
 end if;
 -- A later sale cannot overtake an older pending effect for this cashier.
 perform 1 from public.profiles where id=s.cashier_id
  and (service_worker or (is_active and role in('OWNER','ADMIN','FINANCE','STAFF','DOCTOR'))) for update;
 if not found then raise exception 'Akun staf aktif diperlukan' using errcode='42501';end if;
 if job.sale_id is not null then
  if job.status is distinct from 'pending' or exists(select 1 from public.quest_staff_effect_jobs earlier
   where earlier.staff_id=job.staff_id and earlier.queue_order<job.queue_order and earlier.status='pending') then
   raise exception 'Hadiah transaksi sebelumnya masih diproses';end if;
  d:=(job.paid_at at time zone 'Asia/Jakarta')::date;
  defs_snapshot:=job.definitions_snapshot;
 else
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) into defs_snapshot
   from public.staff_quest_definitions x where x.is_active and (x.branch_id is null or x.branch_id=s.branch_id);
 end if;$new$;
 old_loop text:=$old$ for q in select * from public.staff_quest_definitions where is_active and (branch_id is null or branch_id=s.branch_id) order by id for share loop$old$;
 new_loop text:=$new$ for q in select * from jsonb_populate_recordset(null::public.staff_quest_definitions,defs_snapshot) order by id loop$new$;
 old_cfg text:=$old$  select * into cfg from public.quest_settings where id=1 for share;$old$;
 new_cfg text:=$new$  if job.sale_id is not null then cfg:=jsonb_populate_record(null::public.quest_settings,job.settings_snapshot);
  else select * into cfg from public.quest_settings where id=1 for share;end if;$new$;
 old_quest_ledger text:=$old$   insert into public.staff_points_ledger(id,staff_id,points_delta,source_type,source_id,branch_id,notes)
    values(ledger,s.cashier_id,q.points_reward,'quest_completion',q.id,s.branch_id,'Quest selesai ('||key||')');$old$;
 new_quest_ledger text:=$new$   insert into public.staff_points_ledger(id,staff_id,points_delta,source_type,source_id,branch_id,notes,created_at)
    values(ledger,s.cashier_id,q.points_reward,'quest_completion',q.id,s.branch_id,'Quest selesai ('||key||')',coalesce(job.paid_at,now()));$new$;
 old_streak_ledger text:=$old$   insert into public.staff_points_ledger(id,staff_id,points_delta,source_type,branch_id,notes)
    values(ledger,s.cashier_id,cfg.streak_bonus_points,'streak_bonus',s.branch_id,'Bonus streak '||next_streak||' hari');$old$;
 new_streak_ledger text:=$new$   insert into public.staff_points_ledger(id,staff_id,points_delta,source_type,branch_id,notes,created_at)
    values(ledger,s.cashier_id,cfg.streak_bonus_points,'streak_bonus',s.branch_id,'Bonus streak '||next_streak||' hari',coalesce(job.paid_at,now()));$new$;
 old_end text:=$old$  values(s.id,s.cashier_id,jsonb_build_object('progress',before_progress,'streak',before_streak,'points',before_points),jsonb_build_object('progress',after_progress,'streak',after_streak,'points',after_points),ledgers);
 return jsonb_build_object('applied',true);$old$;
 new_end text:=$new$  values(s.id,s.cashier_id,jsonb_build_object('progress',before_progress,'streak',before_streak,'points',before_points),jsonb_build_object('progress',after_progress,'streak',after_streak,'points',after_points),ledgers);
 if job.sale_id is not null then update public.quest_staff_effect_jobs set status='applied',processed_at=now() where sale_id=s.id;end if;
 return jsonb_build_object('applied',true);$new$;
 old_amount text:=$old$  if q.target_kind='total_sales_amount' then amount:=s.total-coalesce(s.merchant_fee_total,0);
  else select coalesce(sum(i.qty),0) into amount from public.sale_items i left join public.items m on m.id=i.item_id
   where i.sale_id=s.id and (q.target_ref_id is null or (q.target_kind='product_qty' and i.item_id=q.target_ref_id) or (q.target_kind='category_qty' and m.category_id=q.target_ref_id));end if;$old$;
 new_amount text:=$new$  if q.target_kind='new_customer' then
   amount:=0;
   if job.sale_id is not null and job.eligible_new_identity and job.phone_key is not null then
     sale_day:=(s.payments_finalized_at at time zone 'Asia/Jakarta')::date;
     if q.created_at<=s.payments_finalized_at
      and job.customer_created_at<=s.payments_finalized_at
      and (case when q.quest_type='daily' then
        (job.customer_created_at at time zone 'Asia/Jakarta')::date=sale_day
       else to_char(job.customer_created_at at time zone 'Asia/Jakarta','YYYY-MM')=to_char(sale_day,'YYYY-MM') end)
      and exists(select 1 from public.quest_customer_first_sales claim
        where claim.phone_key=job.phone_key and claim.sale_id=s.id) then
      amount:=1;
     end if;
   end if;
  elsif q.target_kind='total_sales_amount' then amount:=s.total-coalesce(s.merchant_fee_total,0);
  else select coalesce(sum(i.qty),0) into amount from public.sale_items i left join public.items m on m.id=i.item_id
   where i.sale_id=s.id and (q.target_ref_id is null or (q.target_kind='product_qty' and i.item_id=q.target_ref_id) or (q.target_kind='category_qty' and m.category_id=q.target_ref_id));end if;$new$;
 old_key text:=$old$  key:=case when q.quest_type='daily' then to_char(d,'YYYY-MM-DD') else to_char(d,'YYYY-MM') end;$old$;
 new_key text:=$new$  key:=case when q.quest_type='daily' then to_char(case when q.target_kind='new_customer' then sale_day else d end,'YYYY-MM-DD')
   else to_char(case when q.target_kind='new_customer' then sale_day else d end,'YYYY-MM') end;$new$;
begin
 if definition is null
  or length(definition)-length(replace(definition,old_decl,''))<>length(old_decl)
  or length(definition)-length(replace(definition,old_guard,''))<>length(old_guard)
  or length(definition)-length(replace(definition,old_loop,''))<>length(old_loop)
  or length(definition)-length(replace(definition,old_cfg,''))<>length(old_cfg)
  or length(definition)-length(replace(definition,old_quest_ledger,''))<>length(old_quest_ledger)
  or length(definition)-length(replace(definition,old_streak_ledger,''))<>length(old_streak_ledger)
  or length(definition)-length(replace(definition,old_end,''))<>length(old_end)
  or length(definition)-length(replace(definition,old_amount,''))<>length(old_amount)
  or length(definition)-length(replace(definition,old_key,''))<>length(old_key) then
  raise exception 'Q01_QUEST_FUNCTION_DRIFT: review current effect/reversal contract';
 end if;
 definition:=replace(definition,old_decl,new_decl);
 definition:=replace(definition,old_guard,new_guard);
 definition:=replace(definition,old_loop,new_loop);
 definition:=replace(definition,old_cfg,new_cfg);
 definition:=replace(definition,old_quest_ledger,new_quest_ledger);
 definition:=replace(definition,old_streak_ledger,new_streak_ledger);
 definition:=replace(definition,old_end,new_end);
 definition:=replace(definition,old_amount,new_amount);
 definition:=replace(definition,old_key,new_key);
 execute definition;
end $$;

-- Cron may retry after a shift closes. It can only drain finalizer-created jobs.
create function public.process_pending_quest_jobs(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record;done_count integer:=0;void_count integer:=0;fail_count integer:=0;remaining integer;
begin
 if auth.role() is distinct from 'service_role' or current_setting('role',true) is distinct from 'service_role' then
  raise exception 'Akses pekerja hadiah ditolak' using errcode='42501';end if;
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'Batas pekerjaan tidak valid' using errcode='22023';end if;
 for candidate in select sale_id from public.quest_staff_effect_jobs
  where status='pending' order by last_attempt_at nulls first,queue_order limit p_limit loop
  begin
   if exists(select 1 from public.sales s where s.id=candidate.sale_id and s.voided_at is not null) then
    update public.quest_staff_effect_jobs set status='voided',processed_at=now()
     where sale_id=candidate.sale_id and status='pending';
    void_count:=void_count+1;
   else
    perform public.apply_sale_staff_effects(candidate.sale_id);
    done_count:=done_count+1;
   end if;
  exception when others then
   update public.quest_staff_effect_jobs set attempts=attempts+1,last_attempt_at=now()
    where sale_id=candidate.sale_id and status='pending';
   fail_count:=fail_count+1;
  end;
 end loop;
 select count(*) into remaining from public.quest_staff_effect_jobs where status='pending';
 return jsonb_build_object('applied',done_count,'voided',void_count,'failed',fail_count,'remaining',remaining);
end $$;
revoke all on function public.process_pending_quest_jobs(integer) from public,anon,authenticated,service_role;
grant execute on function public.process_pending_quest_jobs(integer) to service_role;

create function public.quest_void_effect_job() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.voided_at is null and new.voided_at is not null then
  update public.quest_staff_effect_jobs set status='voided',processed_at=now()
   where sale_id=new.id and status in('pending','applied');
 end if;
 return new;
end $$;
revoke all on function public.quest_void_effect_job() from public,anon,authenticated,service_role;
create trigger quest_void_effect_job after update of voided_at on public.sales
 for each row execute function public.quest_void_effect_job();
