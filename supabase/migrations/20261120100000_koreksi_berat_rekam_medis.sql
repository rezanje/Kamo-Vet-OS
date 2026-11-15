-- Koreksi rekam medis sebelum tagihan: Berat Badan boleh dikoreksi (OWNER/DOKTER, gerbang lama tidak berubah).
-- Memakai jejak audit yang sudah ada (clinic_record_corrections: changes/before_value/after_value + alasan wajib);
-- tidak ada tabel log baru. Hanya dua fungsi pemicu yang diganti; RPC, RLS, grant, dan penjaga RECORD_POSTED tetap.
-- Berat profil (pets.weight) ikut hanya bila rekam ini catatan berat terbaru hewan itu dan profil masih = nilai lama.
-- Tidak ada jalur harga/stok/tagihan yang membaca berat (diperiksa: 5 fungsi DB menyebut berat/weight, semuanya penyimpanan/arsip).
do $guard$ begin
 if md5((select prosrc from pg_proc where oid='public.prepare_clinic_record_correction()'::regprocedure))<>'825b572e137fe5c7472ea5bfefb96247'
  or md5((select prosrc from pg_proc where oid='public.apply_clinic_record_correction()'::regprocedure))<>'e628a740133e5964ab18a531e222ddf2'
 then raise exception 'KB_DRIFT: fungsi koreksi rekam medis berubah; tinjau ulang migrasi koreksi berat terhadap definisi saat ini';end if;
end $guard$;

create or replace function public.prepare_clinic_record_correction()returns trigger
language plpgsql security invoker set search_path='' as $function$

declare source public.medical_records%rowtype;visit_id uuid;result jsonb;v_berat numeric;v_cap numeric;v_species text;
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
 if new.changes-array['anamnesis','diagnosis','therapy','suhu','berat','gejala_klinis','hasil_penunjang']<>'{}'::jsonb
  or not(new.changes?&array['anamnesis','diagnosis','therapy','suhu','gejala_klinis','hasil_penunjang'])
  or length(new.changes::text)>100000
  or exists(select 1 from jsonb_each(new.changes)e where e.key not in('suhu','berat')and jsonb_typeof(e.value)not in('string','null'))
  or jsonb_typeof(new.changes->'suhu')not in('number','null')
  or jsonb_typeof(new.changes->'berat')not in('number','null') then raise exception 'Hanya catatan klinis yang dapat dikoreksi';end if;
 if new.changes->>'suhu'is not null and((new.changes->>'suhu')::numeric<0 or(new.changes->>'suhu')::numeric>60
  or(new.changes->>'suhu')::numeric<>round((new.changes->>'suhu')::numeric,2))then raise exception 'Suhu tidak valid; maksimal dua angka desimal';end if;
 -- Berat badan (opsional di payload; kunci tidak ada = berat tidak berubah). Nilai baru wajib > 0,
 -- <= 2 desimal (kolom numeric(6,2): tanpa pembulatan diam-diam) dan, bila diubah, tidak melewati
 -- batas wajar spesies yang sama dengan layar (src/lib/anabul.ts BATAS_BERAT_WAJAR). Mengosongkan berat
 -- yang sudah terisi ditolak. Nilai lama tetap ada di before_value baris audit ini.
 if new.changes?'berat' then
  if jsonb_typeof(new.changes->'berat')='null' then
   if source.berat is not null then raise exception 'Berat badan tidak boleh dikosongkan; isi berat yang benar';end if;
  else
   v_berat:=(new.changes->>'berat')::numeric;
   if v_berat<=0 or v_berat>=10000 or v_berat<>round(v_berat,2) then raise exception 'Berat badan tidak valid; harus lebih dari 0 kg dan maksimal dua angka desimal';end if;
   if v_berat is distinct from source.berat then
    select pt.species into v_species from public.visits vs join public.pets pt on pt.id=vs.pet_id where vs.id=visit_id;
    v_cap:=case btrim(coalesce(v_species,'')) when 'Kucing' then 15 when 'Anjing' then 100 when 'Kelinci' then 10 when 'Burung' then 5 end;
    if v_cap is not null and v_berat>v_cap then raise exception 'Berat % kg tidak wajar untuk %; periksa lagi sebelum menyimpan',v_berat,lower(btrim(v_species));end if;
   end if;
  end if;
 end if;
 new.created_by:=auth.uid();new.created_at:=clock_timestamp();new.transaction_id:=txid_current();
 new.reason:=btrim(new.reason);new.request_key:=btrim(new.request_key);
 new.before_value:=to_jsonb(source);
 result:=new.before_value||new.changes||jsonb_build_object('clinical_revision',source.clinical_revision+1);
 new.after_value:=result;
 return new;
end$function$;

create or replace function public.apply_clinic_record_correction()returns trigger
language plpgsql security invoker set search_path='' as $function$
declare v_old numeric;v_new numeric;v_pet uuid;v_at timestamptz;
begin
 select m.berat into v_old from public.medical_records m where m.id=new.medical_record_id;
 update public.medical_records set anamnesis=new.changes->>'anamnesis',diagnosis=new.changes->>'diagnosis',
  therapy=new.changes->>'therapy',suhu=(new.changes->>'suhu')::numeric,
  berat=case when new.changes?'berat' then(new.changes->>'berat')::numeric else berat end,
  gejala_klinis=new.changes->>'gejala_klinis',hasil_penunjang=new.changes->>'hasil_penunjang',
  clinical_revision=new.expected_revision+1
 where id=new.medical_record_id and clinical_revision=new.expected_revision;
 if not found then raise exception 'Koreksi rekam medis gagal; muat ulang';end if;
 -- Berat profil anabul (pets.weight) hanya ikut bila rekam ini adalah catatan berat TERBARU hewan itu
 -- DAN profil memang masih memuat nilai lama rekam ini. Rekam yang lebih baru atau berat profil yang
 -- sudah diubah orang lain tidak pernah ditimpa oleh koreksi rekam yang lebih lama.
 v_new:=(new.changes->>'berat')::numeric;
 if new.changes?'berat' and v_new is not null and v_new is distinct from v_old then
  select v.pet_id,m.created_at into v_pet,v_at from public.medical_records m join public.visits v on v.id=m.visit_id where m.id=new.medical_record_id;
  if v_pet is not null then
   perform 1 from public.pets where id=v_pet for update;
   if not exists(select 1 from public.medical_records m2 join public.visits v2 on v2.id=m2.visit_id
     where v2.pet_id=v_pet and m2.id<>new.medical_record_id and m2.berat is not null and(m2.created_at,m2.id)>(v_at,new.medical_record_id))then
    update public.pets set weight=v_new where id=v_pet and weight is not distinct from v_old;
   end if;
  end if;
 end if;
 return new;
end$function$;
