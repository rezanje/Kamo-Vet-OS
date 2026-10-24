-- Clinical notes only, same submitted record. No service-state, stock or billing writes.
alter table public.medical_records add column clinical_revision integer not null default 0 check(clinical_revision>=0);

create table public.clinic_record_corrections(
 id uuid primary key default gen_random_uuid(),
 medical_record_id uuid not null references public.medical_records(id) on delete restrict,
 expected_revision integer not null check(expected_revision>=0),
 changes jsonb not null,
 reason text not null,
 request_key text not null,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 transaction_id bigint not null,
 before_value jsonb not null,
 after_value jsonb not null,
 unique(created_by,request_key),
 unique(medical_record_id,expected_revision)
);
alter table public.clinic_record_corrections enable row level security;
revoke all on public.clinic_record_corrections from public,anon,authenticated,service_role;
grant select,insert on public.clinic_record_corrections to authenticated;

-- Match current clinic module defaults/overrides, active-profile and operational
-- branch gates. SECURITY INVOKER retains the source tables' own RLS checks.
create function public.clinic_record_correction_actor(p_visit_id uuid)returns boolean
language sql stable security invoker set search_path='' as $$
 select auth.role()='authenticated' and exists(
  select 1 from public.visits v join public.profiles p on p.id=auth.uid()
  where v.id=p_visit_id and p.is_active and public.user_can_access_branch(v.branch_id)
   and(p.role='OWNER' or exists(select 1 from public.role_modules m where m.role=p.role and m.module_id='klinik')
    or(not exists(select 1 from public.role_modules m where m.role=p.role)and p.role in('ADMIN','DOCTOR','STAFF')))
 );
$$;
create function public.clinic_can_correct_record(p_record_id uuid)returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.medical_records m join public.visits v on v.id=m.visit_id
  where m.id=p_record_id and m.submission_key is not null
   and public.clinic_record_correction_actor(v.id) and v.status='Pembayaran'
   and v.service_started_at is not null and v.service_finished_at is not null and v.checked_out_at is null
   -- Even a voided/never-paid posted invoice requires its own correction workflow.
   and not exists(select 1 from public.invoices i where i.visit_id=v.id));
$$;
revoke all on function public.clinic_record_correction_actor(uuid),public.clinic_can_correct_record(uuid)from public,anon,service_role;
grant execute on function public.clinic_record_correction_actor(uuid),public.clinic_can_correct_record(uuid)to authenticated;
create policy clinic_record_correction_read on public.clinic_record_corrections for select to authenticated
 using(exists(select 1 from public.medical_records m where m.id=medical_record_id and public.clinic_record_correction_actor(m.visit_id)));
create policy clinic_record_correction_insert on public.clinic_record_corrections for insert to authenticated
 with check(created_by=auth.uid()and public.clinic_can_correct_record(medical_record_id));

create function public.prepare_clinic_record_correction()returns trigger
language plpgsql security invoker set search_path='' as $$
declare source public.medical_records%rowtype;visit_id uuid;result jsonb;
begin
 select m.visit_id into visit_id from public.medical_records m where m.id=new.medical_record_id;
 if not public.clinic_record_correction_actor(visit_id)then raise exception 'Akses koreksi rekam medis ditolak'using errcode='42501';end if;
 -- Same lock order as clinic invoice posting and initial save. Payment/status is
 -- rechecked after this lock; a stale editor never reopens a paid visit.
 perform 1 from public.visits v where v.id=visit_id for update;
 select * into source from public.medical_records m where m.id=new.medical_record_id for update;
 if not found or not public.clinic_can_correct_record(source.id)then raise exception 'Rekam medis tidak dapat dikoreksi: kunjungan sudah berubah atau memiliki invoice';end if;
 if new.expected_revision is distinct from source.clinical_revision then raise exception 'Rekam medis sudah berubah. Muat ulang sebelum mengoreksi';end if;
 if nullif(btrim(new.request_key),'')is null or length(new.request_key)>100
  or length(btrim(coalesce(new.reason,'')))not between 3 and 1000
  or jsonb_typeof(new.changes)is distinct from 'object' then raise exception 'Data koreksi tidak lengkap';end if;
 if new.changes-array['anamnesis','diagnosis','therapy','suhu','gejala_klinis','hasil_penunjang']<>'{}'::jsonb
  or not(new.changes?&array['anamnesis','diagnosis','therapy','suhu','gejala_klinis','hasil_penunjang'])
  or length(new.changes::text)>100000
  or exists(select 1 from jsonb_each(new.changes)e where e.key<>'suhu'and jsonb_typeof(e.value)not in('string','null'))
  or jsonb_typeof(new.changes->'suhu')not in('number','null') then raise exception 'Hanya catatan klinis yang dapat dikoreksi';end if;
 if new.changes->>'suhu'is not null and((new.changes->>'suhu')::numeric<0 or(new.changes->>'suhu')::numeric>60
  or(new.changes->>'suhu')::numeric<>round((new.changes->>'suhu')::numeric,2))then raise exception 'Suhu tidak valid; maksimal dua angka desimal';end if;
 new.created_by:=auth.uid();new.created_at:=clock_timestamp();new.transaction_id:=txid_current();
 new.reason:=btrim(new.reason);new.request_key:=btrim(new.request_key);
 new.before_value:=to_jsonb(source);
 result:=new.before_value||new.changes||jsonb_build_object('clinical_revision',source.clinical_revision+1);
 new.after_value:=result;
 return new;
end$$;
create trigger prepare_clinic_record_correction before insert on public.clinic_record_corrections for each row execute function public.prepare_clinic_record_correction();

-- Abort on guard drift rather than overwrite a newer protection.
do $check$begin
 if btrim((select prosrc from pg_proc where oid='public.protect_submitted_clinic_record()'::regprocedure))
  is distinct from btrim($expected$
begin
  if old.submission_key is not null then
    raise exception using errcode='P0001', message='RECORD_POSTED: pemeriksaan tersimpan tidak dapat diubah atau dihapus';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$expected$)then
  raise exception 'Submitted clinic guard changed; review the correction migration against the current definition';
 end if;
end$check$;

-- The existing guard retains its default denial. The sole exception is the
-- exact row image just authored by the validated, RLS-checked correction insert.
-- A client GUC, direct UPDATE, forged images or a previous receipt is insufficient.
create or replace function public.protect_submitted_clinic_record()returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.submission_key is not null then
  if tg_op='UPDATE'and pg_trigger_depth()=2 and exists(
   select 1 from public.clinic_record_corrections c where c.medical_record_id=old.id
    and c.created_by=auth.uid()and c.transaction_id=txid_current()
    and c.expected_revision=old.clinical_revision
    and c.before_value=to_jsonb(old)and c.after_value=to_jsonb(new)
  )then return new;end if;
  raise exception using errcode='P0001',message='RECORD_POSTED: pemeriksaan tersimpan tidak dapat diubah atau dihapus';
 end if;
 return case when tg_op='DELETE'then old else new end;
end$$;
create function public.apply_clinic_record_correction()returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 update public.medical_records set anamnesis=new.changes->>'anamnesis',diagnosis=new.changes->>'diagnosis',
  therapy=new.changes->>'therapy',suhu=(new.changes->>'suhu')::numeric,
  gejala_klinis=new.changes->>'gejala_klinis',hasil_penunjang=new.changes->>'hasil_penunjang',
  clinical_revision=new.expected_revision+1
 where id=new.medical_record_id and clinical_revision=new.expected_revision;
 if not found then raise exception 'Koreksi rekam medis gagal; muat ulang';end if;
 return new;
end$$;
create trigger apply_clinic_record_correction after insert on public.clinic_record_corrections for each row execute function public.apply_clinic_record_correction();
create function public.clinic_record_correction_immutable()returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Riwayat koreksi rekam medis tidak dapat diubah atau dihapus'using errcode='42501';end$$;
create trigger clinic_record_correction_immutable before update or delete on public.clinic_record_corrections for each row execute function public.clinic_record_correction_immutable();
create trigger clinic_record_correction_no_truncate before truncate on public.clinic_record_corrections for each statement execute function public.clinic_record_correction_immutable();
revoke all on function public.prepare_clinic_record_correction(),public.apply_clinic_record_correction(),public.clinic_record_correction_immutable(),public.protect_submitted_clinic_record()from public,anon,authenticated,service_role;

create function public.clinic_correct_unpaid_record(p_visit_id uuid,p_record_id uuid,p_expected_revision integer,p_changes jsonb,p_reason text,p_request_key text)returns uuid
language plpgsql security invoker set search_path='' set lock_timeout='8s' as $$
declare prior public.clinic_record_corrections%rowtype;
begin
 if not public.clinic_record_correction_actor(p_visit_id)then raise exception 'Akses koreksi rekam medis ditolak'using errcode='42501';end if;
 if nullif(btrim(p_request_key),'')is null or length(p_request_key)>100 then raise exception 'Kunci koreksi tidak valid';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinic-record-correction:'||auth.uid()::text||':'||p_request_key,0));
 perform 1 from public.visits where id=p_visit_id for update;
 if not exists(select 1 from public.medical_records where id=p_record_id and visit_id=p_visit_id)then raise exception 'Rekam medis tidak sesuai kunjungan';end if;
 select * into prior from public.clinic_record_corrections where created_by=auth.uid()and request_key=btrim(p_request_key);
 if found then
  if prior.medical_record_id is distinct from p_record_id or prior.expected_revision is distinct from p_expected_revision
   or prior.changes is distinct from p_changes or prior.reason is distinct from btrim(p_reason)then raise exception 'Kunci koreksi telah dipakai untuk data berbeda';end if;
  return p_record_id; -- Acknowledge an exact prior outcome, including a lost response.
 end if;
 insert into public.clinic_record_corrections(medical_record_id,expected_revision,changes,reason,request_key,created_by,transaction_id,before_value,after_value)
 values(p_record_id,p_expected_revision,p_changes,p_reason,p_request_key,auth.uid(),txid_current(),'{}','{}');
 return p_record_id;
end$$;
revoke all on function public.clinic_correct_unpaid_record(uuid,uuid,integer,jsonb,text,text)from public,anon,service_role;
grant execute on function public.clinic_correct_unpaid_record(uuid,uuid,integer,jsonb,text,text)to authenticated;
