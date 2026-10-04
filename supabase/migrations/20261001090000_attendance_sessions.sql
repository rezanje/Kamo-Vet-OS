-- Attendance sessions: no legacy hours are inferred or historical payroll changed.
begin;
alter table public.attendance
  add column checked_in_at timestamptz,
  add column checked_out_at timestamptz,
  add column branch_id uuid references public.branches(id),
  add column updated_at timestamptz not null default now(),
  add column is_void boolean not null default false,
  add constraint attendance_timestamp_order check (checked_out_at is null or (checked_in_at is not null and checked_out_at >= checked_in_at));
create index attendance_open_session on public.attendance(employee_id,tanggal) where jam_masuk is not null and jam_pulang is null and not is_void;
create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendance(id),
  employee_id uuid not null references public.employees(id),
  branch_id uuid references public.branches(id),
  actor_id uuid not null references public.profiles(id),
  reason text not null check (length(trim(reason)) between 3 and 1000),
  old_values jsonb not null, new_values jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.attendance_corrections enable row level security;

-- Operational resolution is separate from historical attendance/payroll data.
-- A finalized legacy open row remains byte-for-byte unchanged.
create table public.attendance_session_resolutions (
 attendance_id uuid primary key references public.attendance(id),
 employee_id uuid not null references public.employees(id),
 branch_id uuid references public.branches(id),
 actor_id uuid not null references public.profiles(id),
 reason text not null check(length(trim(reason)) between 3 and 1000),
 created_at timestamptz not null default now()
);
alter table public.attendance_session_resolutions enable row level security;

create function public.hris_attendance_now() returns timestamptz language sql volatile set search_path='' as $$ select statement_timestamp() $$;
create function public.hris_manage_branch(b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists (select 1 from public.profiles p where p.id=auth.uid() and
   (p.role='OWNER' or (p.role='ADMIN' and exists(select 1 from public.user_branches ub where ub.user_id=p.id and ub.branch_id=b and ub.effective_date <= (statement_timestamp() at time zone 'Asia/Jakarta')::date))))
$$;
create function public.hris_manage_employee(e uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='OWNER') or
 exists(select 1 from public.employees emp where emp.id=e and public.hris_manage_branch(emp.branch_id)
 and exists(select 1 from public.employee_branch_assignments a where a.employee_id=e and a.branch_id=emp.branch_id and a.effective_date <= (statement_timestamp() at time zone 'Asia/Jakarta')::date)
 and not exists(select 1 from public.employee_branch_assignments a where a.employee_id=e and (not public.hris_manage_branch(a.branch_id) or a.effective_date > (statement_timestamp() at time zone 'Asia/Jakarta')::date)))
$$;
create function public.hris_read_attendance(e uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.employees emp where emp.id=e and emp.profile_id=auth.uid())
 or (public.hris_manage_employee(e) and (b is null or public.hris_manage_branch(b)))
$$;
-- Staff cannot rewrite profile_id to impersonate another employee through the
-- legacy authenticated employee master write policy. Read behavior unchanged.
drop policy employees_all on public.employees;
create policy employees_read on public.employees for select to authenticated using(true);
create policy employees_admin_insert on public.employees for insert to authenticated with check(public.hris_manage_branch(branch_id));
create policy employees_admin_update on public.employees for update to authenticated using(public.hris_manage_employee(id)) with check(public.hris_manage_branch(branch_id));
create policy employees_admin_delete on public.employees for delete to authenticated using(public.hris_manage_employee(id));
drop policy attendance_all on public.attendance;
create policy attendance_read on public.attendance for select to authenticated using(public.hris_read_attendance(employee_id,branch_id));
create policy attendance_corrections_read on public.attendance_corrections for select to authenticated using(public.hris_manage_employee(employee_id) and (branch_id is null or public.hris_manage_branch(branch_id)));
create policy attendance_session_resolutions_read on public.attendance_session_resolutions for select to authenticated using(public.hris_read_attendance(employee_id,branch_id));
revoke insert,update,delete on public.attendance,public.attendance_corrections,public.attendance_session_resolutions from authenticated,anon;
grant select on public.attendance_session_resolutions to authenticated;
create view public.hris_open_attendance with (security_invoker=true) as
 select a.* from public.attendance a where a.jam_masuk is not null and a.jam_pulang is null and not a.is_void
 and not exists(select 1 from public.attendance_session_resolutions r where r.attendance_id=a.id);
grant select on public.hris_open_attendance to authenticated;
grant select on public.attendance,public.attendance_corrections to authenticated;

create function public.hris_clock_attendance(p_action text,p_branch_id uuid,p_lat numeric,p_lng numeric)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); v_now timestamptz:=public.hris_attendance_now(); v_today date; v_emp public.employees;
 v_session public.attendance; v_old jsonb; v_branch public.branches; v_count int; v_distance numeric;
begin
 if v_user is null or coalesce(auth.role(),'') <> 'authenticated' then raise exception 'ATTENDANCE: Silakan login kembali';end if;
 if p_action not in ('in','out') or p_action is null then raise exception 'ATTENDANCE: Aksi tidak valid';end if;
 v_today:=(v_now at time zone 'Asia/Jakarta')::date;
 perform pg_advisory_xact_lock(hashtextextended('hris-attendance:'||v_user::text,0));
 select count(*) into v_count from public.employees where profile_id=v_user and status='Aktif';
 if v_count<>1 then raise exception 'ATTENDANCE: Akun harus tertaut tepat satu karyawan aktif';end if;
 select * into v_emp from public.employees where profile_id=v_user and status='Aktif' for update;
 select count(*) into v_count from public.attendance where employee_id=v_emp.id and jam_masuk is not null and jam_pulang is null and not is_void and not exists(select 1 from public.attendance_session_resolutions r where r.attendance_id=attendance.id);
 if p_action='in' and v_count>0 then raise exception 'ATTENDANCE: Masih ada sesi terbuka. Checkout atau minta koreksi HR';end if;
 if p_action='out' then
   if v_count<>1 then raise exception 'ATTENDANCE: Sesi terbuka tidak ditemukan atau lebih dari satu. Minta koreksi HR';end if;
   select * into v_session from public.attendance where employee_id=v_emp.id and jam_masuk is not null and jam_pulang is null and not is_void and not exists(select 1 from public.attendance_session_resolutions r where r.attendance_id=attendance.id) for update;
   if v_session.checked_in_at is null or v_session.tanggal < v_today-1 or v_session.checked_in_at>v_now then raise exception 'ATTENDANCE: Sesi lama atau waktu tidak lengkap. Minta koreksi HR, jam tidak diisi otomatis';end if;
   if p_branch_id is distinct from v_session.branch_id then raise exception 'ATTENDANCE: Checkout harus pada cabang sesi masuk';end if;
 else
   if not exists(select 1 from public.employee_branch_assignments where employee_id=v_emp.id and branch_id=p_branch_id and effective_date<=v_today) then raise exception 'ATTENDANCE: Cabang tidak sesuai penugasan aktif';end if;
 end if;
 select * into v_branch from public.branches where id=p_branch_id and is_active;
 if not found then raise exception 'ATTENDANCE: Cabang tidak aktif atau tidak ditemukan';end if;
 if v_branch.lat is not null and v_branch.lng is not null then
   if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'ATTENDANCE: Lokasi HP tidak terbaca atau tidak valid. Izinkan GPS';end if;
   v_distance:=power(sin(radians((p_lat-v_branch.lat)::double precision)/2),2)
     +cos(radians(v_branch.lat::double precision))*cos(radians(p_lat::double precision))*power(sin(radians((p_lng-v_branch.lng)::double precision)/2),2);
   v_distance:=6371000*2*asin(least(1,sqrt(v_distance)));
   if v_distance>v_branch.radius_m then raise exception 'ATTENDANCE: Di luar radius cabang';end if;
 end if;
 if exists(select 1 from public.payrolls where employee_id=v_emp.id and periode=to_char(case when p_action='out' then v_session.tanggal else v_today end,'YYYY-MM') and status='final') then raise exception 'ATTENDANCE: Periode gaji sudah disahkan. Hubungi HR';end if;
 if p_action='out' then
   update public.attendance set checked_out_at=v_now,jam_pulang=(v_now at time zone 'Asia/Jakarta')::time,updated_at=greatest(v_now,updated_at+interval '1 microsecond') where id=v_session.id returning * into v_session;
 else
   select * into v_session from public.attendance where employee_id=v_emp.id and tanggal=v_today for update;
   if found and not v_session.is_void then raise exception 'ATTENDANCE: Absensi hari ini sudah tercatat';end if;
   if found then
     v_old:=to_jsonb(v_session);
     update public.attendance set checked_in_at=v_now,checked_out_at=null,jam_masuk=(v_now at time zone 'Asia/Jakarta')::time,jam_pulang=null,status='Hadir',branch_id=p_branch_id,updated_at=greatest(v_now,updated_at+interval '1 microsecond'),is_void=false where id=v_session.id returning * into v_session;
     insert into public.attendance_corrections(attendance_id,employee_id,branch_id,actor_id,reason,old_values,new_values) values(v_session.id,v_emp.id,p_branch_id,v_user,'Mulai sesi baru setelah pembatalan HR',v_old,to_jsonb(v_session));
   else
     insert into public.attendance(employee_id,tanggal,jam_masuk,status,checked_in_at,branch_id,updated_at) values(v_emp.id,v_today,(v_now at time zone 'Asia/Jakarta')::time,'Hadir',v_now,p_branch_id,v_now) returning * into v_session;
   end if;
 end if;
 return v_session;
end $$;

create function public.hris_correct_attendance(p_id uuid,p_expected_updated_at timestamptz,p_checked_in_at timestamptz,p_checked_out_at timestamptz,p_reason text,p_void boolean default false)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare v_row public.attendance;v_old jsonb;v_now timestamptz:=public.hris_attendance_now();v_employee uuid;v_uid uuid:=auth.uid();
begin
 if v_uid is null or coalesce(auth.role(),'') <> 'authenticated' then raise exception 'ATTENDANCE: Silakan login kembali';end if;
 if p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'ATTENDANCE: Alasan koreksi wajib 3–1000 karakter';end if;
 select employee_id into v_employee from public.attendance where id=p_id;
 if v_employee is null or not public.hris_manage_employee(v_employee) then raise exception 'ATTENDANCE: Tidak berhak mengoreksi karyawan ini';end if;
 -- Same employee lock as clock RPC; prevents correction/open-session races.
 perform 1 from public.employees where id=v_employee for update;
 select * into v_row from public.attendance where id=p_id for update;
 if v_row.updated_at is distinct from p_expected_updated_at then raise exception 'ATTENDANCE: Catatan berubah. Muat ulang sebelum koreksi';end if;
 if exists(select 1 from public.attendance_session_resolutions where attendance_id=p_id) then raise exception 'ATTENDANCE: Sesi sudah diselesaikan secara operasional; riwayat tidak diubah';end if;
 if v_row.branch_id is not null and not public.hris_manage_branch(v_row.branch_id) then raise exception 'ATTENDANCE: Cabang sesi tidak diizinkan';end if;
 if exists(select 1 from public.payrolls where employee_id=v_employee and periode=to_char(v_row.tanggal,'YYYY-MM') and status='final') then raise exception 'ATTENDANCE: Periode gaji sudah disahkan; catatan tidak diubah';end if;
 if p_void is null then raise exception 'ATTENDANCE: Status koreksi tidak valid';end if;
 if not p_void and (p_checked_in_at is null or (p_checked_in_at at time zone 'Asia/Jakarta')::date<>v_row.tanggal or p_checked_in_at>v_now or p_checked_out_at>v_now or p_checked_out_at<p_checked_in_at) then raise exception 'ATTENDANCE: Waktu koreksi tidak valid; tanggal masuk harus sesuai tanggal catatan';end if;
 if not p_void and p_checked_out_at is null and v_row.branch_id is null then raise exception 'ATTENDANCE: Sesi tanpa cabang harus diisi waktu pulang sebenarnya atau dibatalkan; tidak boleh dibiarkan terbuka';end if;
 if not p_void and p_checked_out_at is null and exists(select 1 from public.attendance where employee_id=v_employee and id<>p_id and jam_masuk is not null and jam_pulang is null and not is_void and not exists(select 1 from public.attendance_session_resolutions r where r.attendance_id=attendance.id)) then raise exception 'ATTENDANCE: Ada sesi terbuka lain';end if;
 v_old:=to_jsonb(v_row);
 update public.attendance set checked_in_at=case when p_void then checked_in_at else p_checked_in_at end,checked_out_at=case when p_void then checked_out_at else p_checked_out_at end,
 jam_masuk=case when p_void then jam_masuk else (p_checked_in_at at time zone 'Asia/Jakarta')::time end,jam_pulang=case when p_void then jam_pulang else (p_checked_out_at at time zone 'Asia/Jakarta')::time end,
 updated_at=greatest(v_now,updated_at+interval '1 microsecond'),is_void=p_void where id=p_id returning * into v_row;
 insert into public.attendance_corrections(attendance_id,employee_id,branch_id,actor_id,reason,old_values,new_values) values(p_id,v_employee,v_row.branch_id,v_uid,trim(p_reason),v_old,to_jsonb(v_row));
 return v_row;
end $$;
revoke all on function public.hris_attendance_now() from public,anon,authenticated;
revoke all on function public.hris_clock_attendance(text,uuid,numeric,numeric),public.hris_correct_attendance(uuid,timestamptz,timestamptz,timestamptz,text,boolean) from public,anon;
grant execute on function public.hris_clock_attendance(text,uuid,numeric,numeric),public.hris_correct_attendance(uuid,timestamptz,timestamptz,timestamptz,text,boolean) to authenticated;
-- RLS helpers accept only object IDs and do not expose row contents.
revoke all on function public.hris_manage_branch(uuid),public.hris_manage_employee(uuid),public.hris_read_attendance(uuid,uuid) from public,anon;
grant execute on function public.hris_manage_branch(uuid),public.hris_manage_employee(uuid),public.hris_read_attendance(uuid,uuid) to authenticated;

create function public.hris_my_attendance() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_employee uuid;v_count int;v_today date:=(public.hris_attendance_now() at time zone 'Asia/Jakarta')::date;
begin
 if v_user is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'ATTENDANCE: Silakan login kembali';end if;
 select count(*),min(id::text)::uuid into v_count,v_employee from public.employees where profile_id=v_user and status='Aktif';
 if v_count<>1 then raise exception 'ATTENDANCE: Akun harus tertaut tepat satu karyawan aktif';end if;
 return jsonb_build_object(
  'open_sessions',coalesce((select jsonb_agg(to_jsonb(s)) from (select * from public.attendance where employee_id=v_employee and jam_masuk is not null and jam_pulang is null and not is_void and not exists(select 1 from public.attendance_session_resolutions r where r.attendance_id=attendance.id) order by tanggal desc limit 2)s),'[]'::jsonb),
  'today',(select to_jsonb(a) from public.attendance a where employee_id=v_employee and tanggal=v_today),
  'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name)) from public.employee_branch_assignments a join public.branches b on b.id=a.branch_id where a.employee_id=v_employee and a.effective_date<=v_today and b.is_active),'[]'::jsonb));
end $$;
revoke all on function public.hris_my_attendance() from public,anon;
grant execute on function public.hris_my_attendance() to authenticated;

create function public.hris_record_attendance(p_employee_id uuid,p_tanggal date,p_checked_in_at timestamptz,p_checked_out_at timestamptz,p_status text,p_reason text)
returns public.attendance language plpgsql security definer set search_path='' as $$
declare v_row public.attendance;v_branch uuid;v_now timestamptz:=public.hris_attendance_now();v_uid uuid:=auth.uid();
begin
 if v_uid is null or coalesce(auth.role(),'')<>'authenticated' or not public.hris_manage_employee(p_employee_id) then raise exception 'ATTENDANCE: Karyawan tidak diizinkan';end if;
 if p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'ATTENDANCE: Alasan catatan wajib 3–1000 karakter';end if;
 if p_tanggal is null or p_tanggal>(v_now at time zone 'Asia/Jakarta')::date or p_status is null or p_status not in('Hadir','Izin','Sakit','Alpha','Cuti') then raise exception 'ATTENDANCE: Tanggal atau status tidak valid';end if;
 if (p_status='Hadir' and (p_checked_in_at is null or (p_checked_in_at at time zone 'Asia/Jakarta')::date<>p_tanggal)) or (p_status<>'Hadir' and (p_checked_in_at is not null or p_checked_out_at is not null)) or p_checked_in_at>v_now or p_checked_out_at>v_now or p_checked_out_at<p_checked_in_at then raise exception 'ATTENDANCE: Waktu catatan tidak valid';end if;
 select branch_id into v_branch from public.employees where id=p_employee_id for update;
 if not exists(select 1 from public.employee_branch_assignments where employee_id=p_employee_id and branch_id=v_branch and effective_date<=p_tanggal) then raise exception 'ATTENDANCE: Penugasan belum berlaku pada tanggal catatan';end if;
 if exists(select 1 from public.payrolls where employee_id=p_employee_id and periode=to_char(p_tanggal,'YYYY-MM') and status='final') then raise exception 'ATTENDANCE: Periode gaji sudah disahkan';end if;
 if exists(select 1 from public.attendance where employee_id=p_employee_id and tanggal=p_tanggal) then raise exception 'ATTENDANCE: Catatan sudah ada. Gunakan koreksi berjejak';end if;
 if p_status='Hadir' and p_checked_out_at is null and exists(select 1 from public.attendance where employee_id=p_employee_id and jam_masuk is not null and jam_pulang is null and not is_void and not exists(select 1 from public.attendance_session_resolutions r where r.attendance_id=attendance.id)) then raise exception 'ATTENDANCE: Ada sesi terbuka lain';end if;
 insert into public.attendance(employee_id,tanggal,jam_masuk,jam_pulang,status,checked_in_at,checked_out_at,branch_id,updated_at,keterangan) values(p_employee_id,p_tanggal,(p_checked_in_at at time zone 'Asia/Jakarta')::time,(p_checked_out_at at time zone 'Asia/Jakarta')::time,p_status,p_checked_in_at,p_checked_out_at,v_branch,v_now,trim(p_reason)) returning * into v_row;
 insert into public.attendance_corrections(attendance_id,employee_id,branch_id,actor_id,reason,old_values,new_values) values(v_row.id,p_employee_id,v_branch,v_uid,trim(p_reason),'{}'::jsonb,to_jsonb(v_row));
 return v_row;
end $$;
revoke all on function public.hris_record_attendance(uuid,date,timestamptz,timestamptz,text,text) from public,anon;
grant execute on function public.hris_record_attendance(uuid,date,timestamptz,timestamptz,text,text) to authenticated;
-- Authorized escape from a finalized historical open session. Does not complete,
-- void, exclude from payroll, or mutate that historical attendance row.
create function public.hris_resolve_final_attendance(p_id uuid,p_expected_updated_at timestamptz,p_reason text)
returns public.attendance_session_resolutions language plpgsql security definer set search_path='' as $$
declare v_row public.attendance;v_employee uuid;v_uid uuid:=auth.uid();v_now timestamptz:=public.hris_attendance_now();v_resolution public.attendance_session_resolutions;
begin
 if v_uid is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'ATTENDANCE: Silakan login kembali';end if;
 if p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'ATTENDANCE: Alasan penyelesaian wajib 3–1000 karakter';end if;
 select employee_id into v_employee from public.attendance where id=p_id;
 if v_employee is null or not public.hris_manage_employee(v_employee) then raise exception 'ATTENDANCE: Tidak berhak menyelesaikan sesi karyawan ini';end if;
 perform 1 from public.employees where id=v_employee for update;
 select * into v_row from public.attendance where id=p_id for update;
 if v_row.updated_at is distinct from p_expected_updated_at then raise exception 'ATTENDANCE: Catatan berubah. Muat ulang sebelum penyelesaian';end if;
 if v_row.branch_id is not null and not public.hris_manage_branch(v_row.branch_id) then raise exception 'ATTENDANCE: Cabang sesi tidak diizinkan';end if;
 if v_row.jam_masuk is null or v_row.jam_pulang is not null or v_row.is_void or v_row.tanggal >= (v_now at time zone 'Asia/Jakarta')::date
 or not exists(select 1 from public.payrolls where employee_id=v_employee and periode=to_char(v_row.tanggal,'YYYY-MM') and status='final') then raise exception 'ATTENDANCE: Penyelesaian ini hanya untuk sesi terbuka hari sebelumnya pada periode gaji final';end if;
 if exists(select 1 from public.attendance_session_resolutions where attendance_id=p_id) then raise exception 'ATTENDANCE: Sesi sudah diselesaikan secara operasional';end if;
 insert into public.attendance_session_resolutions(attendance_id,employee_id,branch_id,actor_id,reason,created_at)
 values(p_id,v_employee,v_row.branch_id,v_uid,trim(p_reason),v_now) returning * into v_resolution;
 insert into public.attendance_corrections(attendance_id,employee_id,branch_id,actor_id,reason,old_values,new_values)
 values(p_id,v_employee,v_row.branch_id,v_uid,trim(p_reason),to_jsonb(v_row),jsonb_build_object('attendance',to_jsonb(v_row),'operational_resolution',to_jsonb(v_resolution)));
 return v_resolution;
end $$;
revoke all on function public.hris_resolve_final_attendance(uuid,timestamptz,text) from public,anon;
grant execute on function public.hris_resolve_final_attendance(uuid,timestamptz,text) to authenticated;
commit;
