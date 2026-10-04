-- The board's delete/fill operations are one transaction with browser CAS.
begin;
create table public.schedule_board_events (
 id uuid primary key default gen_random_uuid(),
 branch_id uuid not null references public.branches(id),
 actor_id uuid not null references public.profiles(id),
 changes jsonb not null check(jsonb_typeof(changes)='array'),
 created_at timestamptz not null default now()
);
alter table public.schedule_board_events enable row level security;
create policy schedule_board_events_hr_read on public.schedule_board_events
 for select to authenticated using(public.hris_manage_branch(branch_id) and not exists(
 select 1 from jsonb_array_elements(changes)c where not public.hris_manage_employee((c->>'employee_id')::uuid)));
revoke all on public.schedule_board_events from public,anon,authenticated;
grant select on public.schedule_board_events to authenticated;
create function public.hris_board_audit_immutable()returns trigger
language plpgsql security definer set search_path=''as $$begin
 raise exception 'JADWAL: Riwayat batch tidak boleh diubah';
end$$;
create trigger schedule_board_event_immutable before update or delete on public.schedule_board_events
 for each row execute function public.hris_board_audit_immutable();
revoke all on function public.hris_board_audit_immutable()from public,anon,authenticated;

create function public.hris_save_schedule_batch(p_branch uuid,p_start date,p_end date,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=''as $$
declare r record;j jsonb;old_r public.employee_schedules;new_r public.employee_schedules;
 changes jsonb:='[]';n int:=0;
begin
 if auth.uid()is null or coalesce(auth.role(),'')<>'authenticated'then
  raise exception 'JADWAL: Silakan login kembali';end if;
 if p_branch is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>61 then
  raise exception 'JADWAL: Cabang/rentang tanggal tidak valid';end if;
 if jsonb_typeof(p_rows)is distinct from 'array'then
  raise exception 'JADWAL: Perubahan harus berupa daftar sel';end if;
 if jsonb_array_length(p_rows)>10000 or octet_length(p_rows::text)>3000000 then
  raise exception 'JADWAL: Maksimal 10.000 sel dalam satu batch';end if;
 for j in select value from jsonb_array_elements(p_rows)loop
  if jsonb_typeof(j)is distinct from 'object'
   or jsonb_typeof(j->'employee_id')is distinct from 'string'
   or jsonb_typeof(j->'tanggal')is distinct from 'string'
   or jsonb_typeof(j->'shift_id')is distinct from 'string'
   or jsonb_typeof(j->'branch_id')is distinct from 'string'
   or not(j?'expected')then raise exception 'JADWAL: Sel/versi browser tidak lengkap';end if;
  if j->'expected'<>'null'::jsonb then
   if jsonb_typeof(j->'expected')is distinct from 'object'
    or jsonb_typeof(j->'expected'->'id')is distinct from 'string'
    or jsonb_typeof(j->'expected'->'updated_at')is distinct from 'string'
    or jsonb_typeof(j->'expected'->'shift_id')is distinct from 'string'then
    raise exception 'JADWAL: Versi browser tidak valid';end if;
  end if;
 end loop;
 -- Source writers take this boundary before row locks; reuse payroll ordering.
 perform pg_advisory_xact_lock(72310402);
 perform 1 from public.profiles where id=auth.uid()for share;
 if not found then raise exception 'JADWAL: Silakan login kembali';end if;
 perform 1 from public.branches where id=p_branch and is_active for share;
 if not found or not public.hris_manage_branch(p_branch)then
  raise exception 'JADWAL: Cabang tidak diizinkan';end if;
 if(select count(*)from(select distinct employee_id,tanggal from jsonb_to_recordset(p_rows)
  as x(employee_id uuid,tanggal date))v)<>jsonb_array_length(p_rows)then
  raise exception 'JADWAL: Duplikat karyawan/tanggal';end if;
 perform 1 from public.employees where id in(select employee_id from jsonb_to_recordset(p_rows)
  as x(employee_id uuid))order by id for update;
 -- Validate ALL cells before writes. Source/employee locks also cover empty cells.
 for r in select * from jsonb_to_recordset(p_rows)
  as x(employee_id uuid,tanggal date,shift_id text,branch_id uuid,expected jsonb)
  order by employee_id,tanggal loop
  if r.branch_id is distinct from p_branch or r.tanggal is null or r.tanggal not between p_start and p_end
   or not public.hris_manage_employee(r.employee_id)
   or not exists(select 1 from public.employees where id=r.employee_id and status='Aktif')
   or not exists(select 1 from public.employee_branch_assignments where employee_id=r.employee_id
     and branch_id=p_branch and effective_date<=r.tanggal)then
   raise exception 'JADWAL: Karyawan/tanggal/penugasan tidak diizinkan';end if;
  if exists(select 1 from public.payrolls where employee_id=r.employee_id
    and periode=to_char(r.tanggal,'YYYY-MM')and status='final')then
   raise exception 'JADWAL: Periode gaji sudah final';end if;
  select * into old_r from public.employee_schedules where employee_id=r.employee_id and tanggal=r.tanggal for update;
  if old_r.id is null then
   if r.expected<>'null'::jsonb then raise exception 'JADWAL: Sel jadwal berubah. Muat ulang papan';end if;
  else
   if r.expected='null'::jsonb or old_r.id is distinct from(r.expected->>'id')::uuid
    or old_r.updated_at is distinct from(r.expected->>'updated_at')::timestamptz
    or old_r.shift_id is distinct from(r.expected->>'shift_id')::uuid then
    raise exception 'JADWAL: Sel jadwal berubah. Muat ulang papan';end if;
   if not public.hris_write_schedule(r.employee_id,old_r.shift_id)then
    raise exception 'JADWAL: Jadwal lama tidak diizinkan';end if;
  end if;
  if r.shift_id<>''and not public.hris_valid_schedule_shift(r.employee_id,r.tanggal,r.shift_id::uuid,p_branch)then
   raise exception 'JADWAL: Shift/penugasan berubah atau tidak aktif';end if;
 end loop;
 for r in select * from jsonb_to_recordset(p_rows)
  as x(employee_id uuid,tanggal date,shift_id text,branch_id uuid,expected jsonb)
  order by employee_id,tanggal loop
  select * into old_r from public.employee_schedules where employee_id=r.employee_id and tanggal=r.tanggal;
  if(old_r.id is null and r.shift_id='')or(old_r.shift_id=nullif(r.shift_id,'')::uuid)then continue;end if;
  new_r:=null;
  if r.shift_id=''then delete from public.employee_schedules where id=old_r.id;
  elsif old_r.id is null then
   insert into public.employee_schedules(employee_id,tanggal,shift_id,created_by)
    values(r.employee_id,r.tanggal,r.shift_id::uuid,auth.uid())returning * into new_r;
  else update public.employee_schedules set shift_id=r.shift_id::uuid where id=old_r.id returning * into new_r;
  end if;
  n:=n+1;
  changes:=changes||jsonb_build_array(jsonb_build_object('employee_id',r.employee_id,'tanggal',r.tanggal,
    'old',case when old_r.id is null then 'null'::jsonb else to_jsonb(old_r)end,
    'new',case when new_r.id is null then 'null'::jsonb else to_jsonb(new_r)end));
 end loop;
 if n>0 then insert into public.schedule_board_events(branch_id,actor_id,changes)values(p_branch,auth.uid(),changes);end if;
 return jsonb_build_object('jumlah',n);
end$$;
revoke all on function public.hris_save_schedule_batch(uuid,date,date,jsonb)from public,anon;
grant execute on function public.hris_save_schedule_batch(uuid,date,date,jsonb)to authenticated;
commit;
