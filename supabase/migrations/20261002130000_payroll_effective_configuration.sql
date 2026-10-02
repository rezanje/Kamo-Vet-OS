begin;
create table public.payroll_policy_groups(id uuid primary key default gen_random_uuid(),nama text not null unique check(length(trim(nama))between 3 and 60),created_at timestamptz not null default now());
create table public.payroll_policy_versions(id uuid primary key default gen_random_uuid(),sequence bigint generated always as identity unique,group_id uuid references public.payroll_policy_groups(id),effective_date date not null,settings jsonb not null,reason text not null,actor_id uuid references public.profiles(id),created_at timestamptz not null default now());
create table public.employee_pay_group_memberships(id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.employees(id),group_id uuid not null references public.payroll_policy_groups(id),valid_from date not null,valid_to date,reason text not null,actor_id uuid not null references public.profiles(id),check(valid_to is null or valid_to>=valid_from));
create table public.salary_component_versions(id uuid primary key default gen_random_uuid(),sequence bigint generated always as identity unique,component_id uuid not null references public.salary_components(id),effective_period varchar(7)not null,nama text not null,tipe text not null check(tipe in('tunjangan','potongan')),nominal numeric(15,2)not null check(nominal>=0),is_active boolean not null,reason text not null,actor_id uuid references public.profiles(id));
create table public.employee_salary_component_versions(id uuid primary key default gen_random_uuid(),sequence bigint generated always as identity unique,employee_id uuid not null references public.employees(id),component_id uuid not null references public.salary_components(id),effective_period varchar(7)not null,nominal numeric(15,2)check(nominal>=0),is_active boolean not null,reason text not null,actor_id uuid references public.profiles(id));
create table public.payroll_period_components(id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.employees(id),periode varchar(7)not null,nama text not null,tipe text not null check(tipe in('tunjangan','potongan')),nominal numeric(15,2)not null check(nominal>=0),is_active boolean not null default true,reason text not null,actor_id uuid not null references public.profiles(id),unique(employee_id,periode,nama));
create table public.hris_payroll_config_events(id uuid primary key default gen_random_uuid(),employee_id uuid references public.employees(id),actor_id uuid not null references public.profiles(id),kind text not null,reason text not null,old_values jsonb not null,new_values jsonb not null,created_at timestamptz not null default now());
-- Frozen current records preserve legacy calculation behavior; this is not a reconstructed history.
insert into public.salary_component_versions(component_id,effective_period,nama,tipe,nominal,is_active,reason)select id,'0001-01',nama,tipe,nominal,is_active,'Captured legacy baseline; prior changes unknown'from public.salary_components;
insert into public.employee_salary_component_versions(employee_id,component_id,effective_period,nominal,is_active,reason)select employee_id,component_id,'0001-01',nominal,true,'Captured legacy baseline; prior changes unknown'from public.employee_salary_components;
do $$declare t text;begin foreach t in array array['payroll_policy_groups','payroll_policy_versions','employee_pay_group_memberships','salary_component_versions','employee_salary_component_versions','payroll_period_components','hris_payroll_config_events']loop
 execute format('alter table public.%I enable row level security',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('revoke insert,update,delete on public.%I from authenticated,anon',t);
 if t in('employee_pay_group_memberships','employee_salary_component_versions','payroll_period_components')then execute format('create policy scoped_config_read on public.%I for select to authenticated using(public.hris_read_employee(employee_id))',t);
 elsif t='hris_payroll_config_events'then execute format('create policy scoped_config_read on public.%I for select to authenticated using(public.hris_owner()or(employee_id is not null and public.hris_read_employee(employee_id)))',t);
 else execute format('create policy scoped_config_read on public.%I for select to authenticated using(public.hris_treasury_role())',t);end if;
 if t<>'hris_payroll_config_events'then execute format('create trigger hris_payroll_source_revision before insert or update or delete on public.%I for each statement execute function public.hris_payroll_source_changed()',t);end if;
 end loop;end$$;
revoke insert,update,delete on public.payroll_settings,public.salary_components,public.employee_salary_components from authenticated,anon;

create function public.hris_config_actor()returns void language plpgsql security definer set search_path=''as $$begin
 perform pg_advisory_xact_lock(72310402);
 perform 1 from public.profiles where id=auth.uid()for share;
 if auth.uid()is null or coalesce(auth.role(),'')<>'authenticated'then raise exception 'HRIS: Silakan login kembali';end if;
end$$;
create function public.hris_config_employee(p_employee uuid,p_from text,p_reason text)returns void language plpgsql security definer set search_path=''as $$begin
 perform public.hris_config_actor();
 perform 1 from public.employees where id=p_employee for update;
 if not public.hris_manage_employee(p_employee)then raise exception 'HRIS: Karyawan tidak diizinkan';end if;
 if p_from is null or p_from!~'^[0-9]{4}-(0[1-9]|1[0-2])$'or p_reason is null or length(trim(p_reason))not between 3 and 1000 then raise exception 'HRIS: Bulan mulai/alasan wajib diisi';end if;
 if exists(select 1 from public.payrolls where employee_id=p_employee and status='final'and periode>=p_from)then raise exception 'HRIS: Perubahan harus dimulai setelah periode gaji final';end if;
end$$;
create function public.hris_config_audit(p_kind text,p_employee uuid,p_reason text,p_old jsonb,p_new jsonb)returns void language sql security definer set search_path=''as $$insert into public.hris_payroll_config_events(kind,employee_id,actor_id,reason,old_values,new_values)values(p_kind,p_employee,auth.uid(),trim(p_reason),p_old,p_new)$$;
create function public.hris_create_pay_group(p_name text,p_reason text)returns uuid language plpgsql security definer set search_path=''as $$declare v uuid;begin
 perform public.hris_payroll_owner_lock();
 if p_reason is null or length(trim(p_reason))not between 3 and 1000 then raise exception 'HRIS: Alasan wajib diisi';end if;
 insert into public.payroll_policy_groups(nama)values(trim(p_name))returning id into v;
 perform public.hris_config_audit('group',null,p_reason,'{}',jsonb_build_object('id',v,'nama',trim(p_name)));return v;
end$$;
create function public.hris_save_payroll_policy(p_group uuid,p_from date,p_settings jsonb,p_reason text)returns uuid language plpgsql security definer set search_path=''as $$declare k text;v uuid;begin
 perform public.hris_payroll_owner_lock();
 if p_from is null or p_reason is null or length(trim(p_reason))not between 3 and 1000 or jsonb_typeof(p_settings)<>'object'or (select count(*)from jsonb_object_keys(p_settings))<>6 then raise exception 'HRIS: Tanggal/alasan/aturan tidak lengkap';end if;
 foreach k in array array['telat_mulai_menit','telat_blok_menit','telat_nominal_per_blok','telat_maks','bolos_per_hari','lembur_per_jam']loop
 if jsonb_typeof(p_settings->k)is distinct from 'number'or(p_settings->>k)::numeric<0 or(p_settings->>k)::numeric>9999999999999.99 then raise exception 'HRIS: Nilai aturan tidak valid';end if;
 end loop;
 if(p_settings->>'telat_blok_menit')::numeric<=0 or(p_settings->>'telat_blok_menit')::numeric<>floor((p_settings->>'telat_blok_menit')::numeric)or(p_settings->>'telat_mulai_menit')::numeric<>floor((p_settings->>'telat_mulai_menit')::numeric)then raise exception 'HRIS: Menit blok/batas harus bilangan bulat valid';end if;
 if exists(select 1 from public.payrolls where status='final'and periode>=to_char(p_from,'YYYY-MM'))then raise exception 'HRIS: Aturan harus dimulai setelah periode gaji final perusahaan';end if;
 insert into public.payroll_policy_versions(group_id,effective_date,settings,reason,actor_id)values(p_group,p_from,p_settings,trim(p_reason),auth.uid())returning id into v;
 perform public.hris_config_audit('policy',null,p_reason,'{}',jsonb_build_object('id',v,'group',p_group,'from',p_from,'settings',p_settings));return v;
end$$;
create function public.hris_add_pay_group_member(p_employee uuid,p_group uuid,p_from date,p_to date,p_reason text)returns uuid language plpgsql security definer set search_path=''as $$declare v uuid;begin
 perform public.hris_config_employee(p_employee,to_char(p_from,'YYYY-MM'),p_reason);
 if p_from is null or(p_to is not null and p_to<p_from)then raise exception 'HRIS: Rentang tanggal kelompok tidak valid';end if;
 if exists(select 1 from public.employee_pay_group_memberships where employee_id=p_employee and valid_from<=coalesce(p_to,'infinity'::date)and coalesce(valid_to,'infinity'::date)>=p_from)then raise exception 'HRIS: Kelompok karyawan bertumpang tindih; akhiri kelompok lama dahulu';end if;
 insert into public.employee_pay_group_memberships(employee_id,group_id,valid_from,valid_to,reason,actor_id)values(p_employee,p_group,p_from,p_to,trim(p_reason),auth.uid())returning id into v;
 perform public.hris_config_audit('membership',p_employee,p_reason,'{}',jsonb_build_object('id',v,'group',p_group,'from',p_from,'to',p_to));return v;
end$$;
create function public.hris_end_pay_group_member(p_id uuid,p_to date,p_reason text)returns void language plpgsql security definer set search_path=''as $$declare old_r public.employee_pay_group_memberships;begin
 perform public.hris_config_actor();select * into old_r from public.employee_pay_group_memberships where id=p_id for update;
 -- The first changed day is after the earlier old/new inclusive end.
 perform public.hris_config_employee(old_r.employee_id,to_char(least(old_r.valid_to,p_to)+1,'YYYY-MM'),p_reason);
 if old_r.id is null or p_to is null or p_to<old_r.valid_from then raise exception 'HRIS: Akhir keanggotaan tidak valid';end if;
 if exists(select 1 from public.employee_pay_group_memberships where employee_id=old_r.employee_id and id<>p_id and valid_from<=p_to and coalesce(valid_to,'infinity'::date)>=old_r.valid_from)then raise exception 'HRIS: Akhir kelompok bertumpang tindih';end if;
 update public.employee_pay_group_memberships set valid_to=p_to where id=p_id;
 perform public.hris_config_audit('membership_end',old_r.employee_id,p_reason,to_jsonb(old_r),jsonb_build_object('id',p_id,'to',p_to));
end$$;
create function public.hris_save_salary_component(p_component uuid,p_month text,p_name text,p_type text,p_amount numeric,p_active boolean,p_reason text)returns uuid language plpgsql security definer set search_path=''as $$declare v uuid:=p_component;old_r jsonb;begin
 perform public.hris_payroll_owner_lock();
 if p_month is null or p_month!~'^[0-9]{4}-(0[1-9]|1[0-2])$'or p_amount is null or p_amount<0 or p_active is null or p_reason is null or length(trim(p_reason))not between 3 and 1000 or length(trim(coalesce(p_name,'')))not between 1 and 60 or p_type is null or p_type not in('tunjangan','potongan')then raise exception 'HRIS: Komponen/bulan/alasan tidak valid';end if;
 if exists(select 1 from public.payrolls where status='final'and periode>=p_month)then raise exception 'HRIS: Komponen harus dimulai setelah periode gaji final perusahaan';end if;
 if v is null then insert into public.salary_components(nama,tipe,nominal,is_active)values(trim(p_name),p_type,p_amount,p_active)returning id into v;
 else select to_jsonb(c)into old_r from public.salary_components c where id=v for update;if not found then raise exception 'HRIS: Komponen tidak ditemukan';end if;update public.salary_components set nama=trim(p_name),tipe=p_type,nominal=p_amount,is_active=p_active where id=v;end if;
 insert into public.salary_component_versions(component_id,effective_period,nama,tipe,nominal,is_active,reason,actor_id)values(v,p_month,trim(p_name),p_type,p_amount,p_active,trim(p_reason),auth.uid());
 perform public.hris_config_audit('component_master',null,p_reason,coalesce(old_r,'{}'),jsonb_build_object('id',v,'month',p_month,'amount',p_amount,'active',p_active));return v;
end$$;
create function public.hris_set_employee_component(p_employee uuid,p_component uuid,p_month text,p_amount numeric,p_active boolean,p_reason text)returns uuid language plpgsql security definer set search_path=''as $$declare v uuid;old_r jsonb;begin
 perform public.hris_config_employee(p_employee,p_month,p_reason);
 if p_active is null or(p_amount is not null and p_amount<0)then raise exception 'HRIS: Nominal/status komponen tidak valid';end if;
 if not exists(select 1 from public.salary_components where id=p_component)then raise exception 'HRIS: Komponen tidak tersedia';end if;
 select to_jsonb(c)into old_r from public.employee_salary_components c where employee_id=p_employee and component_id=p_component;
 -- Keep the legacy selector row as latest planned metadata; historical amounts use versions.
 insert into public.employee_salary_components(employee_id,component_id,nominal)values(p_employee,p_component,p_amount)on conflict(employee_id,component_id)do update set nominal=excluded.nominal returning id into v;
 insert into public.employee_salary_component_versions(employee_id,component_id,effective_period,nominal,is_active,reason,actor_id)values(p_employee,p_component,p_month,p_amount,p_active,trim(p_reason),auth.uid());
 perform public.hris_config_audit('component_assignment',p_employee,p_reason,coalesce(old_r,'{}'),jsonb_build_object('id',v,'month',p_month,'component',p_component,'amount',p_amount,'active',p_active));return v;
end$$;
create function public.hris_save_period_component(p_employee uuid,p_month text,p_name text,p_type text,p_amount numeric,p_reason text)returns uuid language plpgsql security definer set search_path=''as $$declare v uuid;old_r jsonb;begin
 perform public.hris_config_employee(p_employee,p_month,p_reason);
 if p_amount is null or p_amount<0 or length(trim(coalesce(p_name,'')))not between 1 and 60 or p_type is null or p_type is null or p_type not in('tunjangan','potongan')then raise exception 'HRIS: Komponen periode tidak valid';end if;
 select to_jsonb(c)into old_r from public.payroll_period_components c where employee_id=p_employee and periode=p_month and nama=trim(p_name);
 insert into public.payroll_period_components(employee_id,periode,nama,tipe,nominal,reason,actor_id)values(p_employee,p_month,trim(p_name),p_type,p_amount,trim(p_reason),auth.uid())on conflict(employee_id,periode,nama)do update set tipe=excluded.tipe,nominal=excluded.nominal,reason=excluded.reason,actor_id=excluded.actor_id,is_active=true returning id into v;
 perform public.hris_config_audit('period_component',p_employee,p_reason,coalesce(old_r,'{}'),jsonb_build_object('id',v,'month',p_month,'amount',p_amount,'type',p_type));return v;
end$$;
create function public.hris_remove_period_component(p_id uuid,p_reason text)returns void language plpgsql security definer set search_path=''as $$declare old_r public.payroll_period_components;begin
 perform public.hris_config_actor();select * into old_r from public.payroll_period_components where id=p_id;
 perform public.hris_config_employee(old_r.employee_id,old_r.periode,p_reason);
 select * into old_r from public.payroll_period_components where id=p_id for update;
 if old_r.id is null then raise exception 'HRIS: Komponen periode tidak tersedia';end if;
 update public.payroll_period_components set is_active=false where id=p_id;
 perform public.hris_config_audit('period_component_remove',old_r.employee_id,p_reason,to_jsonb(old_r),jsonb_build_object('id',p_id,'active',false));
end$$;
-- Display the effective GLOBAL policy; employee/date calculation uses complete source versions.
create function public.hris_global_payroll_policy(p_date date default(statement_timestamp()at time zone'Asia/Jakarta')::date)returns jsonb language plpgsql security definer set search_path=''as $$declare result jsonb;begin
 if not public.hris_treasury_role()or p_date is null then raise exception 'HRIS: Aturan gaji tidak diizinkan';end if;
 select settings into result from public.payroll_policy_versions where group_id is null and effective_date<=p_date order by effective_date desc,sequence desc limit 1;
 if result is null then select to_jsonb(x)-'id'-'updated_at'-'updated_by'into result from public.payroll_settings x where id;end if;
 if result is null then raise exception 'HRIS: Aturan gaji tidak tersedia';end if;return result;
end$$;
-- Financial master fields cannot be raised by staff through the raw API.
create policy commission_rules_hr_insert on public.commission_rules as restrictive for insert to authenticated with check(public.hris_owner()or((employee_id is not null or branch_id is not null)and(employee_id is null or public.hris_manage_employee(employee_id))and(branch_id is null or public.hris_manage_branch(branch_id))));
create policy commission_rules_hr_update on public.commission_rules as restrictive for update to authenticated using(public.hris_owner()or((employee_id is not null or branch_id is not null)and(employee_id is null or public.hris_manage_employee(employee_id))and(branch_id is null or public.hris_manage_branch(branch_id))))with check(public.hris_owner()or((employee_id is not null or branch_id is not null)and(employee_id is null or public.hris_manage_employee(employee_id))and(branch_id is null or public.hris_manage_branch(branch_id))));
create policy commission_rules_hr_delete on public.commission_rules as restrictive for delete to authenticated using(public.hris_owner()or((employee_id is not null or branch_id is not null)and(employee_id is null or public.hris_manage_employee(employee_id))and(branch_id is null or public.hris_manage_branch(branch_id))));
create function public.hris_guard_commission_rule()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if coalesce(auth.role(),'')='authenticated'and current_setting('role',true)='authenticated'then
  perform 1 from public.profiles where id=auth.uid()for share;
  perform 1 from public.employees where id in(case when tg_op<>'INSERT'then old.employee_id end,case when tg_op<>'DELETE'then new.employee_id end)order by id for update;
  if not public.hris_owner()then
   if tg_op<>'INSERT'and not((old.employee_id is not null or old.branch_id is not null)and(old.employee_id is null or public.hris_manage_employee(old.employee_id))and(old.branch_id is null or public.hris_manage_branch(old.branch_id)))then raise exception 'HRIS: Cakupan komisi berubah/tidak diizinkan';end if;
   if tg_op<>'DELETE'and not((new.employee_id is not null or new.branch_id is not null)and(new.employee_id is null or public.hris_manage_employee(new.employee_id))and(new.branch_id is null or public.hris_manage_branch(new.branch_id)))then raise exception 'HRIS: Cakupan komisi berubah/tidak diizinkan';end if;
  end if;
 end if;
 if tg_op='DELETE'then return old;else return new;end if;
end$$;
create trigger hris_guard_commission_rule before insert or update or delete on public.commission_rules for each row execute function public.hris_guard_commission_rule();
revoke all on function public.hris_guard_commission_rule()from public,anon,authenticated;
revoke all on function public.hris_config_actor(),public.hris_config_employee(uuid,text,text),public.hris_config_audit(text,uuid,text,jsonb,jsonb)from public,anon,authenticated;
revoke all on function public.hris_create_pay_group(text,text),public.hris_save_payroll_policy(uuid,date,jsonb,text),public.hris_add_pay_group_member(uuid,uuid,date,date,text),public.hris_end_pay_group_member(uuid,date,text),public.hris_save_salary_component(uuid,text,text,text,numeric,boolean,text),public.hris_set_employee_component(uuid,uuid,text,numeric,boolean,text),public.hris_save_period_component(uuid,text,text,text,numeric,text),public.hris_remove_period_component(uuid,text),public.hris_global_payroll_policy(date)from public,anon;
grant execute on function public.hris_create_pay_group(text,text),public.hris_save_payroll_policy(uuid,date,jsonb,text),public.hris_add_pay_group_member(uuid,uuid,date,date,text),public.hris_end_pay_group_member(uuid,date,text),public.hris_save_salary_component(uuid,text,text,text,numeric,boolean,text),public.hris_set_employee_component(uuid,uuid,text,numeric,boolean,text),public.hris_save_period_component(uuid,text,text,text,numeric,text),public.hris_remove_period_component(uuid,text),public.hris_global_payroll_policy(date)to authenticated;
commit;
