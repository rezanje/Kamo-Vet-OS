-- Customer acquisition is a distinct quest target; existing definitions stay intact.
do $$ begin
 if not (select relrowsecurity from pg_class where oid='public.staff_quest_definitions'::regclass)
  or not exists(select 1 from pg_policies where schemaname='public'
   and tablename='staff_quest_definitions' and policyname='sqd_all'
   and permissive='PERMISSIVE' and cmd='ALL' and 'authenticated'=any(roles)
   and qual='true' and with_check='true')
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

-- The old permissive policy remains for reading. Only active managers may change rewards.
create policy quest_definitions_manager_insert on public.staff_quest_definitions
 as restrictive for insert to authenticated
 with check (exists(select 1 from public.profiles p where p.id=auth.uid()
  and p.is_active and p.role in('OWNER','ADMIN')));
create policy quest_definitions_manager_update on public.staff_quest_definitions
 as restrictive for update to authenticated
 using (exists(select 1 from public.profiles p where p.id=auth.uid()
  and p.is_active and p.role in('OWNER','ADMIN')))
 with check (exists(select 1 from public.profiles p where p.id=auth.uid()
  and p.is_active and p.role in('OWNER','ADMIN')));
create policy quest_definitions_manager_delete on public.staff_quest_definitions
 as restrictive for delete to authenticated
 using (exists(select 1 from public.profiles p where p.id=auth.uid()
  and p.is_active and p.role in('OWNER','ADMIN')));

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

-- Keep the mature quest snapshot/reversal code intact; change only acquisition contribution.
do $$
declare definition text:=pg_get_functiondef('public.apply_sale_staff_effects(uuid)'::regprocedure);
 old_decl text:=$old$ existing boolean;done boolean;cfg public.quest_settings%rowtype;$old$;
 new_decl text:=$new$ existing boolean;done boolean;cfg public.quest_settings%rowtype;
 customer public.customers%rowtype;phone_key text;sale_day date;$new$;
 old_amount text:=$old$  if q.target_kind='total_sales_amount' then amount:=s.total-coalesce(s.merchant_fee_total,0);
  else select coalesce(sum(i.qty),0) into amount from public.sale_items i left join public.items m on m.id=i.item_id
   where i.sale_id=s.id and (q.target_ref_id is null or (q.target_kind='product_qty' and i.item_id=q.target_ref_id) or (q.target_kind='category_qty' and m.category_id=q.target_ref_id));end if;$old$;
 new_amount text:=$new$  if q.target_kind='new_customer' then
   amount:=0;
   if s.customer_id is not null then
    select * into customer from public.customers where id=s.customer_id for share;
    phone_key:=public.quest_customer_phone_key(customer.phone);
    if phone_key is not null then
     perform pg_advisory_xact_lock(hashtextextended('vetos:q01:'||phone_key,0));
     sale_day:=(s.payments_finalized_at at time zone 'Asia/Jakarta')::date;
     if q.created_at<=s.payments_finalized_at
      and customer.created_at<=s.payments_finalized_at
      and (case when q.quest_type='daily' then
        (customer.created_at at time zone 'Asia/Jakarta')::date=sale_day
       else to_char(customer.created_at at time zone 'Asia/Jakarta','YYYY-MM')=to_char(sale_day,'YYYY-MM') end)
      and not exists(select 1 from public.customers prior
        where prior.id<>customer.id and public.quest_customer_phone_key(prior.phone)=phone_key
         and (prior.created_at,prior.id)<(customer.created_at,customer.id))
      and not exists(select 1 from public.sales prior
        join public.customers identity on identity.id=prior.customer_id
        where prior.id<>s.id and prior.channel is null and prior.payments_finalized_at is not null
         and prior.voided_at is null and public.quest_customer_phone_key(identity.phone)=phone_key
         and (prior.payments_finalized_at,prior.id)<(s.payments_finalized_at,s.id))
      and not exists(select 1 from public.sale_staff_effects effect
        join public.sales posted on posted.id=effect.sale_id
        join public.customers identity on identity.id=posted.customer_id
        where effect.sale_id<>s.id and effect.reversed_at is null and posted.voided_at is null
         and public.quest_customer_phone_key(identity.phone)=phone_key
         and exists(select 1 from jsonb_array_elements(effect.after_value->'progress') contributed
           where contributed->>'quest_definition_id'=q.id::text
            and contributed->>'period_key'=case when q.quest_type='daily' then to_char(sale_day,'YYYY-MM-DD') else to_char(sale_day,'YYYY-MM') end)) then
      amount:=1;
     end if;
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
  or length(definition)-length(replace(definition,old_amount,''))<>length(old_amount)
  or length(definition)-length(replace(definition,old_key,''))<>length(old_key) then
  raise exception 'Q01_QUEST_FUNCTION_DRIFT: review current effect/reversal contract';
 end if;
 definition:=replace(definition,old_decl,new_decl);
 definition:=replace(definition,old_amount,new_amount);
 definition:=replace(definition,old_key,new_key);
 execute definition;
end $$;
