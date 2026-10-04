-- One-person shift changes; approval and effective schedule commit together.
begin;
alter table public.employee_schedules add column updated_at timestamptz not null default now();
create function public.hris_schedule_now() returns timestamptz language sql volatile set search_path='' as $$ select statement_timestamp() $$;
revoke all on function public.hris_schedule_now() from public,anon,authenticated;

create function public.hris_read_schedule(e uuid,s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.employees where id=e and profile_id=auth.uid())
 or (public.hris_manage_employee(e) and exists(select 1 from public.work_shifts where id=s and (branch_id is null or public.hris_manage_branch(branch_id))))
$$;
create function public.hris_write_schedule(e uuid,s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.hris_manage_employee(e) and exists(select 1 from public.work_shifts where id=s and (branch_id is null or public.hris_manage_branch(branch_id)))
$$;
create function public.hris_valid_schedule_shift(e uuid,d date,s uuid,b uuid default null) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.work_shifts w where w.id=s and w.is_active and (b is null or w.branch_id is null or w.branch_id=b)
 and exists(select 1 from public.employee_branch_assignments a join public.branches br on br.id=a.branch_id
 where a.employee_id=e and a.effective_date<=d and br.is_active and (b is null or a.branch_id=b) and (w.branch_id is null or w.branch_id=a.branch_id)))
$$;
revoke all on function public.hris_read_schedule(uuid,uuid),public.hris_write_schedule(uuid,uuid),public.hris_valid_schedule_shift(uuid,date,uuid,uuid) from public,anon;
grant execute on function public.hris_read_schedule(uuid,uuid),public.hris_write_schedule(uuid,uuid),public.hris_valid_schedule_shift(uuid,date,uuid,uuid) to authenticated;

-- Close legacy STAFF write bypasses while keeping existing HR board writes.
drop policy employee_schedules_all on public.employee_schedules;
create policy employee_schedules_read on public.employee_schedules for select to authenticated using(public.hris_read_schedule(employee_id,shift_id));
create policy employee_schedules_insert on public.employee_schedules for insert to authenticated with check(public.hris_write_schedule(employee_id,shift_id) and public.hris_valid_schedule_shift(employee_id,tanggal,shift_id));
create policy employee_schedules_update on public.employee_schedules for update to authenticated using(public.hris_write_schedule(employee_id,shift_id)) with check(public.hris_write_schedule(employee_id,shift_id) and public.hris_valid_schedule_shift(employee_id,tanggal,shift_id));
create policy employee_schedules_delete on public.employee_schedules for delete to authenticated using(public.hris_write_schedule(employee_id,shift_id));
drop policy work_shifts_all on public.work_shifts;
create policy work_shifts_read on public.work_shifts for select to authenticated using(true);
create policy work_shifts_write on public.work_shifts for all to authenticated using(public.hris_manage_branch(branch_id)) with check(public.hris_manage_branch(branch_id));

create function public.hris_version_schedule() returns trigger language plpgsql security definer set search_path='' as $$
declare e uuid;d date;v_now timestamptz:=public.hris_schedule_now();
begin
 if tg_op='UPDATE' and (new.id is distinct from old.id or new.employee_id is distinct from old.employee_id or new.tanggal is distinct from old.tanggal) then raise exception 'JADWAL: Identitas sel jadwal tidak boleh dipindahkan';end if;
 if tg_op='DELETE' then e:=old.employee_id;d:=old.tanggal;else e:=new.employee_id;d:=new.tanggal;end if;
 -- Same employee lock as attendance and request approval; final periods protected
 -- for direct existing board writes as well as new RPCs.
 perform 1 from public.employees where id=e for update;
 if exists(select 1 from public.payrolls where employee_id=e and periode=to_char(d,'YYYY-MM') and status='final') then raise exception 'JADWAL: Periode gaji sudah final; jadwal tidak diubah';end if;
 if tg_op='DELETE' then return old;end if;
 if tg_op='UPDATE' then new.updated_at:=greatest(v_now,old.updated_at+interval '1 microsecond');new.created_by:=old.created_by;
 else new.updated_at:=v_now;if auth.uid() is not null then new.created_by:=auth.uid();end if;end if;
 return new;
end $$;
revoke all on function public.hris_version_schedule() from public,anon,authenticated;
create trigger hris_schedule_version before insert or update or delete on public.employee_schedules for each row execute function public.hris_version_schedule();

-- Freeze identity, employee assignments, and actor access while a request or
-- approval holds their rows. Privileged configuration writes participate too.
create function public.hris_lock_employee_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where id in(case when tg_op<>'INSERT' then old.profile_id end,case when tg_op<>'DELETE' then new.profile_id end) order by id for update;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger hris_employee_identity_lock before insert or update of profile_id,status or delete on public.employees for each row execute function public.hris_lock_employee_identity();
create function public.hris_lock_scope_assignment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='employee_branch_assignments' then
  perform 1 from public.employees where id in(case when tg_op<>'INSERT' then old.employee_id end,case when tg_op<>'DELETE' then new.employee_id end) order by id for update;
 else
  perform 1 from public.profiles where id in(case when tg_op<>'INSERT' then old.user_id end,case when tg_op<>'DELETE' then new.user_id end) order by id for update;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger hris_employee_assignment_lock before insert or update or delete on public.employee_branch_assignments for each row execute function public.hris_lock_scope_assignment();
create trigger hris_user_assignment_lock before insert or update or delete on public.user_branches for each row execute function public.hris_lock_scope_assignment();
revoke all on function public.hris_lock_employee_identity(),public.hris_lock_scope_assignment() from public,anon,authenticated;

create table public.schedule_change_requests (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id),
 branch_id uuid not null references public.branches(id),
 tanggal date not null,
 -- No FK to the mutable schedule/shift masters: history survives deleted cells.
 schedule_id uuid not null, expected_updated_at timestamptz not null,
 proposed_shift_id uuid not null,
 old_schedule jsonb not null,old_shift jsonb not null,proposed_shift jsonb not null,
 requested_by uuid not null references public.profiles(id),
 reason text not null check(length(trim(reason)) between 3 and 1000),
 status text not null default 'Menunggu' check(status in('Menunggu','Disetujui','Ditolak')),
 created_at timestamptz not null default now(),
 decided_by uuid references public.profiles(id),decided_at timestamptz,decision_reason text,
 check((status='Menunggu' and decided_by is null and decided_at is null and decision_reason is null)
 or (status<>'Menunggu' and decided_by is not null and decided_at is not null and length(trim(decision_reason)) between 3 and 1000))
);
create unique index one_pending_schedule_request on public.schedule_change_requests(employee_id,tanggal) where status='Menunggu';
create table public.schedule_request_events (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.schedule_change_requests(id),
 employee_id uuid not null references public.employees(id),branch_id uuid not null references public.branches(id),
 actor_id uuid not null references public.profiles(id),reason text not null,
 old_values jsonb not null,new_values jsonb not null,created_at timestamptz not null default now()
);
alter table public.schedule_change_requests enable row level security;
alter table public.schedule_request_events enable row level security;
create policy schedule_requests_read on public.schedule_change_requests for select to authenticated using(exists(select 1 from public.employees e where e.id=employee_id and e.profile_id=auth.uid()) or (public.hris_manage_employee(employee_id) and public.hris_manage_branch(branch_id)));
create policy schedule_request_events_read on public.schedule_request_events for select to authenticated using(exists(select 1 from public.employees e where e.id=employee_id and e.profile_id=auth.uid()) or (public.hris_manage_employee(employee_id) and public.hris_manage_branch(branch_id)));
revoke insert,update,delete on public.schedule_change_requests,public.schedule_request_events from authenticated,anon;
grant select on public.schedule_change_requests,public.schedule_request_events to authenticated;

create function public.hris_request_schedule_change(p_schedule_id uuid,p_expected_updated_at timestamptz,p_shift_id uuid,p_branch_id uuid,p_reason text)
returns public.schedule_change_requests language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_emp uuid;v_count int;v_row public.employee_schedules;v_shift public.work_shifts;v_old public.work_shifts;v_request public.schedule_change_requests;v_now timestamptz:=public.hris_schedule_now();
begin
 if v_uid is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'JADWAL: Silakan login kembali';end if;
 if p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'JADWAL: Alasan wajib 3–1000 karakter';end if;
 perform 1 from public.profiles where id=v_uid for share;
 if not found then raise exception 'JADWAL: Silakan login kembali';end if;
 select count(*),min(id::text)::uuid into v_count,v_emp from public.employees where profile_id=v_uid and status='Aktif';
 if v_count<>1 then raise exception 'JADWAL: Akun harus tertaut tepat satu karyawan aktif';end if;
 select id into v_emp from public.employees where id=v_emp and profile_id=v_uid and status='Aktif' for update;
 if not found then raise exception 'JADWAL: Tautan karyawan berubah. Muat ulang';end if;
 select count(*) into v_count from public.employees where profile_id=v_uid and status='Aktif';
 if v_count<>1 then raise exception 'JADWAL: Akun harus tertaut tepat satu karyawan aktif';end if;
 select * into v_row from public.employee_schedules where id=p_schedule_id and employee_id=v_emp for share;
 if not found then raise exception 'JADWAL: Jadwal sendiri tidak ditemukan';end if;
 if v_row.updated_at is distinct from p_expected_updated_at then raise exception 'JADWAL: Jadwal berubah. Muat ulang sebelum mengajukan';end if;
 if v_row.tanggal<(v_now at time zone 'Asia/Jakarta')::date then raise exception 'JADWAL: Pengajuan hanya untuk hari ini atau berikutnya';end if;
 if exists(select 1 from public.attendance where employee_id=v_emp and tanggal=v_row.tanggal and not is_void) then raise exception 'JADWAL: Absensi sudah tercatat; hubungi HR untuk koreksi';end if;
 if exists(select 1 from public.payrolls where employee_id=v_emp and periode=to_char(v_row.tanggal,'YYYY-MM') and status='final') then raise exception 'JADWAL: Periode gaji sudah final';end if;
 perform 1 from public.branches where id=p_branch_id for share;
 perform 1 from public.work_shifts where id in(v_row.shift_id,p_shift_id) order by id for share;
 select * into v_old from public.work_shifts where id=v_row.shift_id;
 select * into v_shift from public.work_shifts where id=p_shift_id;
 if p_branch_id is null or not public.hris_valid_schedule_shift(v_emp,v_row.tanggal,p_shift_id,p_branch_id) or (v_old.branch_id is not null and v_old.branch_id<>p_branch_id) then raise exception 'JADWAL: Cabang/shift tidak sesuai penugasan pada tanggal jadwal';end if;
 if v_row.shift_id=p_shift_id then raise exception 'JADWAL: Shift usulan sama dengan jadwal saat ini';end if;
 if exists(select 1 from public.schedule_change_requests where employee_id=v_emp and tanggal=v_row.tanggal and status='Menunggu') then raise exception 'JADWAL: Masih ada pengajuan menunggu untuk tanggal ini';end if;
 insert into public.schedule_change_requests(employee_id,branch_id,tanggal,schedule_id,expected_updated_at,proposed_shift_id,old_schedule,old_shift,proposed_shift,requested_by,reason,created_at)
 values(v_emp,p_branch_id,v_row.tanggal,v_row.id,v_row.updated_at,p_shift_id,to_jsonb(v_row),to_jsonb(v_old),to_jsonb(v_shift),v_uid,trim(p_reason),v_now) returning * into v_request;
 insert into public.schedule_request_events(request_id,employee_id,branch_id,actor_id,reason,old_values,new_values,created_at)
 values(v_request.id,v_emp,p_branch_id,v_uid,trim(p_reason),'{}',to_jsonb(v_request),v_now);
 return v_request;
end $$;

create function public.hris_decide_schedule_change(p_request_id uuid,p_approve boolean,p_reason text)
returns public.schedule_change_requests language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_r public.schedule_change_requests;v_row public.employee_schedules;v_before jsonb;v_new jsonb;v_shift public.work_shifts;v_old public.work_shifts;v_now timestamptz:=public.hris_schedule_now();
begin
 if v_uid is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'JADWAL: Silakan login kembali';end if;
 if p_reason is null or length(trim(p_reason)) not between 3 and 1000 or p_approve is null then raise exception 'JADWAL: Keputusan dan alasan wajib diisi';end if;
 perform 1 from public.profiles where id=v_uid for share;
 if not found then raise exception 'JADWAL: Silakan login kembali';end if;
 select * into v_r from public.schedule_change_requests where id=p_request_id for update;
 if not found or not public.hris_manage_employee(v_r.employee_id) or not public.hris_manage_branch(v_r.branch_id) then raise exception 'JADWAL: Pengajuan tidak diizinkan';end if;
 if v_r.status<>'Menunggu' then raise exception 'JADWAL: Pengajuan sudah diputuskan. Muat ulang';end if;
 v_before:=to_jsonb(v_r);
 perform 1 from public.employees where id=v_r.employee_id for update;
 if not public.hris_manage_employee(v_r.employee_id) or not public.hris_manage_branch(v_r.branch_id) then raise exception 'JADWAL: Akses karyawan/cabang berubah. Muat ulang';end if;
 if p_approve then
   if not exists(select 1 from public.employees where id=v_r.employee_id and status='Aktif') then raise exception 'JADWAL: Karyawan tidak aktif';end if;
   if v_r.tanggal<(v_now at time zone 'Asia/Jakarta')::date then raise exception 'JADWAL: Tanggal pengajuan sudah lewat; tolak dan ajukan ulang';end if;
   if exists(select 1 from public.attendance where employee_id=v_r.employee_id and tanggal=v_r.tanggal and not is_void) then raise exception 'JADWAL: Absensi sudah tercatat; jadwal tidak diubah';end if;
   if exists(select 1 from public.payrolls where employee_id=v_r.employee_id and periode=to_char(v_r.tanggal,'YYYY-MM') and status='final') then raise exception 'JADWAL: Periode gaji sudah final';end if;
   select * into v_row from public.employee_schedules where id=v_r.schedule_id and employee_id=v_r.employee_id and tanggal=v_r.tanggal for update;
   if not found or v_row.updated_at is distinct from v_r.expected_updated_at or to_jsonb(v_row)<>v_r.old_schedule then raise exception 'JADWAL: Jadwal berubah sejak diajukan; tolak dan ajukan ulang';end if;
   perform 1 from public.branches where id=v_r.branch_id for share;
   perform 1 from public.work_shifts where id in(v_row.shift_id,v_r.proposed_shift_id) order by id for share;
   select * into v_old from public.work_shifts where id=v_row.shift_id;
   select * into v_shift from public.work_shifts where id=v_r.proposed_shift_id;
   if not public.hris_valid_schedule_shift(v_r.employee_id,v_r.tanggal,v_r.proposed_shift_id,v_r.branch_id) or to_jsonb(v_shift) is distinct from v_r.proposed_shift or to_jsonb(v_old) is distinct from v_r.old_shift then raise exception 'JADWAL: Shift atau penugasan berubah sejak diajukan; tolak dan ajukan ulang';end if;
   update public.employee_schedules set shift_id=v_r.proposed_shift_id where id=v_row.id returning to_jsonb(employee_schedules.*) into v_new;
 end if;
 update public.schedule_change_requests set status=case when p_approve then 'Disetujui' else 'Ditolak' end,decided_by=v_uid,decided_at=v_now,decision_reason=trim(p_reason) where id=v_r.id returning * into v_r;
 insert into public.schedule_request_events(request_id,employee_id,branch_id,actor_id,reason,old_values,new_values,created_at)
 values(v_r.id,v_r.employee_id,v_r.branch_id,v_uid,trim(p_reason),v_before,jsonb_build_object('request',to_jsonb(v_r),'effective_schedule',v_new),v_now);
 return v_r;
end $$;

create function public.hris_my_schedule(p_start date,p_end date) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_emp uuid;v_count int;
begin
 if v_uid is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'JADWAL: Silakan login kembali';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>61 then raise exception 'JADWAL: Rentang maksimal 62 hari';end if;
 select count(*),min(id::text)::uuid into v_count,v_emp from public.employees where profile_id=v_uid and status='Aktif';
 if v_count<>1 then raise exception 'JADWAL: Akun harus tertaut tepat satu karyawan aktif';end if;
 return jsonb_build_object(
 'schedules',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('shift',to_jsonb(w)) order by a.tanggal) from public.employee_schedules a join public.work_shifts w on w.id=a.shift_id where a.employee_id=v_emp and a.tanggal between p_start and p_end),'[]'::jsonb),
 'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'effective_date',a.effective_date)) from public.employee_branch_assignments a join public.branches b on b.id=a.branch_id where a.employee_id=v_emp and a.effective_date<=p_end and b.is_active),'[]'::jsonb),
 'shifts',coalesce((select jsonb_agg(to_jsonb(w) order by w.nama) from public.work_shifts w where w.is_active and (w.branch_id is null or exists(select 1 from public.employee_branch_assignments a where a.employee_id=v_emp and a.branch_id=w.branch_id and a.effective_date<=p_end))),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from public.schedule_change_requests where employee_id=v_emp and tanggal between p_start and p_end union select * from (select * from public.schedule_change_requests where employee_id=v_emp order by created_at desc,id limit 50)recent)r),'[]'::jsonb));
end $$;
revoke all on function public.hris_request_schedule_change(uuid,timestamptz,uuid,uuid,text),public.hris_decide_schedule_change(uuid,boolean,text),public.hris_my_schedule(date,date) from public,anon;
grant execute on function public.hris_request_schedule_change(uuid,timestamptz,uuid,uuid,text),public.hris_decide_schedule_change(uuid,boolean,text),public.hris_my_schedule(date,date) to authenticated;
-- Legacy payroll actions calculate/finalize the whole company. Scoped RLS must
-- never turn a hidden schedule/attendance source into zero work in that batch.
create function public.hris_assert_payroll_scope() returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER') then raise exception 'HRIS: Data gaji seluruh perusahaan hanya boleh dihitung OWNER sampai alur payroll per cabang tersedia';end if;
 if exists(select 1 from public.employees e where not public.hris_manage_employee(e.id)) then raise exception 'HRIS: Data gaji lintas cabang tidak diizinkan. Gunakan OWNER untuk penggajian seluruh perusahaan';end if;
 return true;
end $$;
revoke all on function public.hris_assert_payroll_scope() from public,anon;
grant execute on function public.hris_assert_payroll_scope() to authenticated;
commit;
