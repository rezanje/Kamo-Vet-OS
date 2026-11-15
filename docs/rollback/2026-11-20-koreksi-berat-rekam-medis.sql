-- ROLLBACK of 20261120100000_koreksi_berat_rekam_medis: restore the two trigger functions to their previous bodies.
-- Data already corrected stays as is (audit rows in clinic_record_corrections are immutable and keep before/after values).
-- Afterwards the 'berat' key is rejected again ("Hanya catatan klinis yang dapat dikoreksi").
begin;
set local lock_timeout='5s';
create or replace function public.prepare_clinic_record_correction()returns trigger
language plpgsql security invoker set search_path='' as $function$

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
end$function$;

create or replace function public.apply_clinic_record_correction()returns trigger
language plpgsql security invoker set search_path='' as $function$

begin
 update public.medical_records set anamnesis=new.changes->>'anamnesis',diagnosis=new.changes->>'diagnosis',
  therapy=new.changes->>'therapy',suhu=(new.changes->>'suhu')::numeric,
  gejala_klinis=new.changes->>'gejala_klinis',hasil_penunjang=new.changes->>'hasil_penunjang',
  clinical_revision=new.expected_revision+1
 where id=new.medical_record_id and clinical_revision=new.expected_revision;
 if not found then raise exception 'Koreksi rekam medis gagal; muat ulang';end if;
 return new;
end$function$;
commit;
