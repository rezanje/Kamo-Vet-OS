-- Two employees consent, then HR exchanges both published shifts atomically.
begin;
create table public.schedule_swap_requests (
 id uuid primary key default gen_random_uuid(),
 employee_a uuid not null references public.employees(id),employee_b uuid not null references public.employees(id),
 profile_a uuid not null references public.profiles(id),profile_b uuid not null references public.profiles(id),
 name_a text not null,name_b text not null,
 schedule_a uuid not null,schedule_b uuid not null,date_a date not null,date_b date not null,
 branch_id uuid not null references public.branches(id),
 snapshot_a jsonb not null,snapshot_b jsonb not null,shift_a jsonb not null,shift_b jsonb not null,
 reason text not null check(length(trim(reason)) between 3 and 1000),
 status text not null default 'Menunggu rekan' check(status in('Menunggu rekan','Menunggu HR','Disetujui','Ditolak','Dibatalkan')),
 peer_reason text,peer_at timestamptz,decided_by uuid references public.profiles(id),decision_reason text,decided_at timestamptz,
 created_at timestamptz not null default now(),
 check(employee_a<>employee_b and profile_a<>profile_b and schedule_a<>schedule_b),
 check(status not in('Menunggu HR','Disetujui') or (peer_at is not null and length(trim(peer_reason)) between 3 and 1000))
);
create index on public.schedule_swap_requests(employee_a,date_a);
create index on public.schedule_swap_requests(employee_b,date_b);
create table public.schedule_swap_events (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.schedule_swap_requests(id),
 actor_id uuid not null references public.profiles(id),reason text not null,
 old_values jsonb not null,new_values jsonb not null,created_at timestamptz not null default now()
);
alter table public.schedule_swap_requests enable row level security;
alter table public.schedule_swap_events enable row level security;
create policy swap_read on public.schedule_swap_requests for select to authenticated using(
 auth.uid() in(profile_a,profile_b) or(public.hris_manage_employee(employee_a) and public.hris_manage_employee(employee_b) and public.hris_manage_branch(branch_id)));
create policy swap_event_read on public.schedule_swap_events for select to authenticated using(exists(select 1 from public.schedule_swap_requests r where r.id=request_id));
revoke insert,update,delete on public.schedule_swap_requests,public.schedule_swap_events from authenticated,anon;
grant select on public.schedule_swap_requests,public.schedule_swap_events to authenticated;

create function public.hris_swap_actor() returns uuid language plpgsql security definer set search_path='' as $$
declare e uuid;n int;u uuid:=auth.uid();begin
 if u is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'JADWAL: Silakan login kembali';end if;
 perform 1 from public.profiles where id=u for share;
 select count(*),min(id::text)::uuid into n,e from public.employees where profile_id=u and status='Aktif';
 if n<>1 then raise exception 'JADWAL: Akun harus tertaut tepat satu karyawan aktif';end if;
 return e;
end$$;
create function public.hris_swap_pending(e uuid,d date) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.schedule_swap_requests where status in('Menunggu rekan','Menunggu HR') and ((employee_a=e and date_a=d) or(employee_b=e and date_b=d)))
$$;
-- Existing single-change RPC holds this employee lock before inserting.
create function public.hris_single_change_no_swap() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.employees where id=new.employee_id for update;
 if public.hris_swap_pending(new.employee_id,new.tanggal) then raise exception 'JADWAL: Jadwal masih memiliki pengajuan tukar shift';end if;
 return new;
end$$;
create trigger single_change_no_swap before insert on public.schedule_change_requests for each row execute function public.hris_single_change_no_swap();

create function public.hris_assert_swap(r public.schedule_swap_requests) returns void language plpgsql security definer set search_path='' as $$
declare a public.employee_schedules;b public.employee_schedules;w_a public.work_shifts;w_b public.work_shifts;t date:=(public.hris_schedule_now() at time zone 'Asia/Jakarta')::date;
begin
 perform 1 from public.profiles where id in(r.profile_a,r.profile_b) order by id for share;
 perform 1 from public.employees where id in(r.employee_a,r.employee_b) order by id for update;
 if not exists(select 1 from public.employees where id=r.employee_a and profile_id=r.profile_a and status='Aktif')
 or not exists(select 1 from public.employees where id=r.employee_b and profile_id=r.profile_b and status='Aktif')
 or (select count(*) from public.employees where profile_id=r.profile_a and status='Aktif')<>1
 or (select count(*) from public.employees where profile_id=r.profile_b and status='Aktif')<>1 then raise exception 'JADWAL: Identitas karyawan berubah; tolak dan ajukan ulang';end if;
 if r.date_a<t or r.date_b<t then raise exception 'JADWAL: Tanggal tukar sudah lewat';end if;
 if exists(select 1 from public.attendance where not is_void and ((employee_id=r.employee_a and tanggal=r.date_a)or(employee_id=r.employee_b and tanggal=r.date_b))) then raise exception 'JADWAL: Absensi sudah tercatat; jadwal tidak ditukar';end if;
 if exists(select 1 from public.payrolls where status='final' and ((employee_id=r.employee_a and periode=to_char(r.date_a,'YYYY-MM'))or(employee_id=r.employee_b and periode=to_char(r.date_b,'YYYY-MM')))) then raise exception 'JADWAL: Periode gaji sudah final';end if;
 perform 1 from public.employee_schedules where id in(r.schedule_a,r.schedule_b) order by id for update;
 select * into a from public.employee_schedules where id=r.schedule_a;
 select * into b from public.employee_schedules where id=r.schedule_b;
 if to_jsonb(a) is distinct from r.snapshot_a or to_jsonb(b) is distinct from r.snapshot_b then raise exception 'JADWAL: Salah satu jadwal berubah; tolak dan ajukan ulang';end if;
 perform 1 from public.branches where id=r.branch_id for share;
 perform 1 from public.work_shifts where id in(a.shift_id,b.shift_id) order by id for share;
 select * into w_a from public.work_shifts where id=a.shift_id;
 select * into w_b from public.work_shifts where id=b.shift_id;
 if to_jsonb(w_a) is distinct from r.shift_a or to_jsonb(w_b) is distinct from r.shift_b
 or not public.hris_valid_schedule_shift(r.employee_a,r.date_a,b.shift_id,r.branch_id)
 or not public.hris_valid_schedule_shift(r.employee_b,r.date_b,a.shift_id,r.branch_id)
 or not public.hris_valid_schedule_shift(r.employee_a,r.date_a,a.shift_id,r.branch_id)
 or not public.hris_valid_schedule_shift(r.employee_b,r.date_b,b.shift_id,r.branch_id) then raise exception 'JADWAL: Shift atau penugasan berubah/tidak sesuai';end if;
end$$;
create function public.hris_swap_candidates(p_schedule_id uuid,p_branch_id uuid,p_start date,p_end date) returns jsonb language plpgsql security definer set search_path='' as $$
declare e uuid:=public.hris_swap_actor();a public.employee_schedules;result jsonb;
begin
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>61 then raise exception 'JADWAL: Rentang maksimal 62 hari';end if;
 select * into a from public.employee_schedules where id=p_schedule_id and employee_id=e;
 if not found or p_branch_id is null or not public.hris_valid_schedule_shift(e,a.tanggal,a.shift_id,p_branch_id) then raise exception 'JADWAL: Jadwal/cabang sendiri tidak sesuai';end if;
 select coalesce(jsonb_agg(row order by row->>'tanggal',row->>'nama',row->>'id'),'[]'::jsonb) into result from (
 select jsonb_build_object('id',s.id,'employee_id',s.employee_id,'nama',emp.nama,'tanggal',s.tanggal,'updated_at',s.updated_at,'shift',to_jsonb(w))row
 from public.employee_schedules s join public.employees emp on emp.id=s.employee_id join public.work_shifts w on w.id=s.shift_id
 where s.employee_id<>e and s.shift_id<>a.shift_id and emp.status='Aktif' and emp.profile_id is not null and emp.profile_id<>auth.uid()
 and (select count(*) from public.employees x where x.profile_id=emp.profile_id and x.status='Aktif')=1
 and s.tanggal between p_start and p_end and s.tanggal>=(public.hris_schedule_now() at time zone 'Asia/Jakarta')::date
 and public.hris_valid_schedule_shift(s.employee_id,s.tanggal,s.shift_id,p_branch_id)
 and public.hris_valid_schedule_shift(s.employee_id,s.tanggal,a.shift_id,p_branch_id)
 and public.hris_valid_schedule_shift(e,a.tanggal,s.shift_id,p_branch_id)
 and not exists(select 1 from public.attendance where not is_void and employee_id=s.employee_id and tanggal=s.tanggal)
 and not exists(select 1 from public.payrolls where employee_id=s.employee_id and periode=to_char(s.tanggal,'YYYY-MM') and status='final'))q;
 if jsonb_array_length(result)>1000 then raise exception 'JADWAL: Kandidat terlalu banyak; persempit rentang tanggal';end if;
 return result;
end$$;
create function public.hris_request_schedule_swap(p_own_id uuid,p_own_version timestamptz,p_peer_id uuid,p_peer_version timestamptz,p_branch_id uuid,p_reason text) returns public.schedule_swap_requests language plpgsql security definer set search_path='' as $$
declare e uuid:=public.hris_swap_actor();r public.schedule_swap_requests;a public.employee_schedules;b public.employee_schedules;
begin
 if p_reason is null or length(trim(p_reason)) not between 3 and 1000 then raise exception 'JADWAL: Alasan wajib 3–1000 karakter';end if;
 select * into a from public.employee_schedules where id=p_own_id and employee_id=e;
 select * into b from public.employee_schedules where id=p_peer_id;
 if a.id is null or b.id is null or a.employee_id=b.employee_id or a.shift_id=b.shift_id or p_branch_id is null then raise exception 'JADWAL: Pilih dua karyawan dan shift berbeda pada cabang yang sesuai';end if;
 if a.updated_at is distinct from p_own_version or b.updated_at is distinct from p_peer_version then raise exception 'JADWAL: Jadwal berubah. Muat ulang';end if;
 r.employee_a:=e;r.employee_b:=b.employee_id;r.profile_a:=auth.uid();
 select profile_id into r.profile_b from public.employees where id=b.employee_id;
 if r.profile_b is null or r.profile_b=r.profile_a then raise exception 'JADWAL: Akun rekan belum tertaut unik';end if;
 r.schedule_a:=a.id;r.schedule_b:=b.id;r.date_a:=a.tanggal;r.date_b:=b.tanggal;r.branch_id:=p_branch_id;
 r.snapshot_a:=to_jsonb(a);r.snapshot_b:=to_jsonb(b);
 select to_jsonb(w) into r.shift_a from public.work_shifts w where id=a.shift_id;
 select to_jsonb(w) into r.shift_b from public.work_shifts w where id=b.shift_id;
 perform public.hris_assert_swap(r);
 if public.hris_swap_pending(e,a.tanggal) or public.hris_swap_pending(b.employee_id,b.tanggal)
 or exists(select 1 from public.schedule_change_requests where status='Menunggu' and ((employee_id=e and tanggal=a.tanggal)or(employee_id=b.employee_id and tanggal=b.tanggal))) then raise exception 'JADWAL: Salah satu jadwal masih memiliki pengajuan menunggu';end if;
 insert into public.schedule_swap_requests(employee_a,employee_b,profile_a,profile_b,schedule_a,schedule_b,date_a,date_b,branch_id,snapshot_a,snapshot_b,shift_a,shift_b,reason,name_a,name_b)
 values(r.employee_a,r.employee_b,r.profile_a,r.profile_b,r.schedule_a,r.schedule_b,r.date_a,r.date_b,r.branch_id,r.snapshot_a,r.snapshot_b,r.shift_a,r.shift_b,trim(p_reason),(select nama from public.employees where id=r.employee_a),(select nama from public.employees where id=r.employee_b)) returning * into r;
 insert into public.schedule_swap_events(request_id,actor_id,reason,old_values,new_values)values(r.id,auth.uid(),trim(p_reason),'{}',to_jsonb(r));return r;
end$$;
create function public.hris_transition_schedule_swap(p_id uuid,p_action text,p_accept boolean,p_reason text) returns public.schedule_swap_requests language plpgsql security definer set search_path='' as $$
declare r public.schedule_swap_requests;old_r jsonb;new_a jsonb;new_b jsonb;u uuid:=auth.uid();
begin
 if u is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'JADWAL: Silakan login kembali';end if;
 if p_reason is null or length(trim(p_reason)) not between 3 and 1000 or p_accept is null then raise exception 'JADWAL: Keputusan dan alasan wajib diisi';end if;
 perform 1 from public.profiles where id=u for share;
 select * into r from public.schedule_swap_requests where id=p_id for update;
 if not found then raise exception 'JADWAL: Pengajuan tidak diizinkan';end if;
 old_r:=to_jsonb(r);
 if p_action='peer' then
  if u<>r.profile_b or r.status<>'Menunggu rekan' then raise exception 'JADWAL: Hanya rekan yang diminta dapat menjawab pengajuan menunggu';end if;
  if p_accept then perform public.hris_assert_swap(r);end if;
  r.status:=case when p_accept then 'Menunggu HR' else 'Ditolak' end;r.peer_reason:=trim(p_reason);r.peer_at:=public.hris_schedule_now();
 elsif p_action='cancel' then
  if u<>r.profile_a or r.status not in('Menunggu rekan','Menunggu HR') then raise exception 'JADWAL: Pengajuan tidak dapat dibatalkan';end if;
  r.status:='Dibatalkan';
 elsif p_action='hr' then
  perform 1 from public.employees where id in(r.employee_a,r.employee_b) order by id for update;
  if not public.hris_manage_employee(r.employee_a) or not public.hris_manage_employee(r.employee_b) or not public.hris_manage_branch(r.branch_id) then raise exception 'JADWAL: Pengajuan cabang/karyawan tidak diizinkan';end if;
  if r.status not in('Menunggu rekan','Menunggu HR') then raise exception 'JADWAL: Pengajuan sudah diputuskan';end if;
  if p_accept then
   if r.status<>'Menunggu HR' then raise exception 'JADWAL: Tunggu persetujuan rekan';end if;
   perform public.hris_assert_swap(r);
   update public.employee_schedules set shift_id=(r.shift_b->>'id')::uuid where id=r.schedule_a returning to_jsonb(employee_schedules.*)into new_a;
   update public.employee_schedules set shift_id=(r.shift_a->>'id')::uuid where id=r.schedule_b returning to_jsonb(employee_schedules.*)into new_b;
  end if;
  r.status:=case when p_accept then 'Disetujui' else 'Ditolak' end;
 else raise exception 'JADWAL: Tindakan tidak valid';end if;
 if r.status in('Disetujui','Ditolak','Dibatalkan') then r.decided_by:=u;r.decision_reason:=trim(p_reason);r.decided_at:=public.hris_schedule_now();end if;
 update public.schedule_swap_requests set status=r.status,peer_at=r.peer_at,peer_reason=r.peer_reason,decided_by=r.decided_by,decided_at=r.decided_at,decision_reason=r.decision_reason where id=r.id returning * into r;
 insert into public.schedule_swap_events(request_id,actor_id,reason,old_values,new_values)values(r.id,u,trim(p_reason),old_r,jsonb_build_object('request',to_jsonb(r),'schedule_a',new_a,'schedule_b',new_b));return r;
end$$;
create function public.hris_respond_schedule_swap(p_id uuid,p_accept boolean,p_reason text)returns public.schedule_swap_requests language sql security definer set search_path='' as $$select public.hris_transition_schedule_swap(p_id,'peer',p_accept,p_reason)$$;
create function public.hris_cancel_schedule_swap(p_id uuid,p_reason text)returns public.schedule_swap_requests language sql security definer set search_path='' as $$select public.hris_transition_schedule_swap(p_id,'cancel',false,p_reason)$$;
create function public.hris_decide_schedule_swap(p_id uuid,p_approve boolean,p_reason text)returns public.schedule_swap_requests language sql security definer set search_path='' as $$select public.hris_transition_schedule_swap(p_id,'hr',p_approve,p_reason)$$;
create function public.hris_my_schedule_swaps(p_start date,p_end date)returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'JADWAL: Silakan login kembali';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>61 then raise exception 'JADWAL: Rentang maksimal 62 hari';end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id) from(
 select * from public.schedule_swap_requests where auth.uid() in(profile_a,profile_b) and (date_a between p_start and p_end or date_b between p_start and p_end)
 union select * from(select * from public.schedule_swap_requests where auth.uid() in(profile_a,profile_b) order by created_at desc,id limit 50)recent)r),'[]'::jsonb);
end$$;
revoke all on function public.hris_my_schedule_swaps(date,date) from public,anon;
grant execute on function public.hris_my_schedule_swaps(date,date) to authenticated;
revoke all on function public.hris_swap_actor(),public.hris_swap_pending(uuid,date),public.hris_single_change_no_swap(),public.hris_assert_swap(public.schedule_swap_requests),public.hris_transition_schedule_swap(uuid,text,boolean,text) from public,anon,authenticated;
revoke all on function public.hris_swap_candidates(uuid,uuid,date,date),public.hris_request_schedule_swap(uuid,timestamptz,uuid,timestamptz,uuid,text),public.hris_respond_schedule_swap(uuid,boolean,text),public.hris_cancel_schedule_swap(uuid,text),public.hris_decide_schedule_swap(uuid,boolean,text) from public,anon;
grant execute on function public.hris_swap_candidates(uuid,uuid,date,date),public.hris_request_schedule_swap(uuid,timestamptz,uuid,timestamptz,uuid,text),public.hris_respond_schedule_swap(uuid,boolean,text),public.hris_cancel_schedule_swap(uuid,text),public.hris_decide_schedule_swap(uuid,boolean,text) to authenticated;
commit;
