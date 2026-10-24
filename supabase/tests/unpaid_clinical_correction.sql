begin;
do $$begin if to_regprocedure('public.clinic_correct_unpaid_record(uuid,uuid,integer,jsonb,text,text)')is null then raise exception 'Missing audited unpaid correction RPC';end if;end$$;
insert into profiles(id,role)values('f0000000-0000-4000-8000-000000000001','DOCTOR'),('f0000000-0000-4000-8000-000000000002','STAFF');
insert into branches(id)values('f1000000-0000-4000-8000-000000000001'),('f1000000-0000-4000-8000-000000000002');
insert into user_branches values('f0000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001');
insert into visits(id,pet_id,branch_id,status,checked_in_at,service_started_at,service_finished_at,keluhan,dokter)values('f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Pembayaran','2026-10-24 02:21Z','2026-10-24 06:16Z','2026-10-24 06:23Z','Diare','Dokter Fiktif');
insert into medical_records(id,visit_id,anamnesis,diagnosis,therapy,suhu,berat,follow_up,catatan_resep,penunjang_urls,submission_key,submission_hash,submitted_by)values('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','Catatan awal',null,'Terapi awal',0,3,'Kontrol','Resep awal',array['preserved/file'],'initial-key','original-hash','f0000000-0000-4000-8000-000000000001');
insert into prescription_items values('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001','Obat asli',2);
insert into compounding_recipes values('f6000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001','ready');
create temporary table invariant_snapshot as select to_jsonb(v) visit,(select jsonb_agg(to_jsonb(p))from prescription_items p)rx,(select jsonb_agg(to_jsonb(c))from compounding_recipes c)compound from visits v;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
do $$declare mr uuid:='f4000000-0000-4000-8000-000000000001';v uuid:='f2000000-0000-4000-8000-000000000001';r uuid;bad boolean;fields jsonb:='{"anamnesis":"Diperbaiki","diagnosis":"Diagnosis baru","therapy":null,"suhu":0,"gejala_klinis":null,"hasil_penunjang":"Hasil baru"}';begin
 if not public.clinic_can_correct_record(mr)then raise exception 'unpaid source not eligible';end if;
 r:=public.clinic_correct_unpaid_record(v,mr,0,fields,'Koreksi catatan','edit-1');
 if r<>mr or(select count(*)from medical_records)<>1 or(select diagnosis from medical_records where id=mr)<>'Diagnosis baru' then raise exception 'wrong source identity or values';end if;
 if public.clinic_correct_unpaid_record(v,mr,0,fields,'Koreksi catatan','edit-1')<>mr or(select count(*)from clinic_record_corrections)<>1 then raise exception 'retry duplicated correction';end if;
 bad:=false;begin perform public.clinic_correct_unpaid_record(v,mr,0,fields||'{"diagnosis":"Different"}','Koreksi catatan','edit-1');exception when sqlstate 'P0001'then bad:=true;end;if not bad then raise exception 'conflicting retry accepted';end if;
 bad:=false;begin perform public.clinic_correct_unpaid_record(v,mr,0,fields,'Koreksi lagi','edit-stale');exception when sqlstate 'P0001'then bad:=true;end;if not bad then raise exception 'stale save accepted';end if;
 perform public.clinic_correct_unpaid_record(v,mr,1,fields||'{"therapy":"Terapi kedua","suhu":38.25}','Koreksi terapi','edit-2');
 if(select clinical_revision from medical_records where id=mr)<>2 or(select count(*)from clinic_record_corrections)<>2 then raise exception 'second edit missing';end if;
 bad:=false;begin update medical_records set diagnosis='Unaudited'where id=mr;exception when sqlstate 'P0001'then bad:=true;end;if not bad then raise exception 'direct edit bypass';end if;
 bad:=false;begin delete from medical_records where id=mr;exception when sqlstate 'P0001'then bad:=true;end;if not bad then raise exception 'delete bypass';end if;
 bad:=false;begin perform public.clinic_correct_unpaid_record(v,mr,2,fields||'{"berat":9}','Unsafe field','edit-weight');exception when sqlstate 'P0001'then bad:=true;end;if not bad then raise exception 'weight mutation allowed';end if;
 bad:=false;begin perform public.clinic_correct_unpaid_record(v,mr,2,fields||'{"suhu":38.333}','Bad precision','edit-precision');exception when sqlstate 'P0001'then bad:=true;end;if not bad then raise exception 'temperature precision lost';end if;
 bad:=false;begin update clinic_record_corrections set reason='Forged';exception when insufficient_privilege then bad:=true;end;if not bad then raise exception 'audit editable';end if;
 perform set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',true);
 if public.clinic_can_correct_record(mr)then raise exception 'unassigned ready';end if;
 bad:=false;begin perform public.clinic_correct_unpaid_record(v,mr,2,fields,'Wrong actor','edit-denied');exception when insufficient_privilege then bad:=true;end;if not bad then raise exception 'unassigned write';end if;
 if exists(select 1 from clinic_record_corrections)then raise exception 'audit leaked';end if;
 perform set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
 perform set_config('request.headers','{"x-kamo-operational-branch":"f1000000-0000-4000-8000-000000000002"}',true);
 if public.clinic_can_correct_record(mr)then raise exception 'wrong operational branch ready';end if;
 bad:=false;begin perform public.clinic_correct_unpaid_record(v,mr,2,fields,'Wrong branch','edit-branch');exception when insufficient_privilege then bad:=true;end;if not bad then raise exception 'wrong branch write';end if;
 perform set_config('request.headers','{}',true);
 bad:=false;begin perform public.clinic_correct_unpaid_record('f2000000-0000-4000-8000-000000000099',mr,2,fields,'Wrong visit','edit-foreign');exception when insufficient_privilege then bad:=true;end;if not bad then raise exception 'wrong visit accepted';end if;
end$$;
reset role;
insert into role_modules values('DOCTOR','crm');set local role authenticated;
do $$begin if public.clinic_can_correct_record('f4000000-0000-4000-8000-000000000001')then raise exception 'module-denied ready';end if;end$$;
do $$declare denied boolean:=false;begin
 begin perform public.clinic_correct_unpaid_record('f2000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',2,'{}','Denied module','edit-module');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'module denied write accepted';end if;
end$$;
reset role;delete from role_modules;
insert into invoices values('f7000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',now(),'Belum Lunas');set local role authenticated;
do $$declare bad boolean:=false;begin
 if public.clinic_can_correct_record('f4000000-0000-4000-8000-000000000001')then raise exception 'invoice history ready';end if;
 begin perform public.clinic_correct_unpaid_record('f2000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',2,'{}','Invoice denial','edit-invoice');exception when sqlstate 'P0001'then bad:=true;end;if not bad then raise exception 'invoiced record changed';end if;
end$$;
reset role;delete from invoices;
-- Assert all nonclinical source state and source submission evidence survived.
do $$begin
 if exists(select 1 from visits v,invariant_snapshot s where to_jsonb(v)<>s.visit)or(select jsonb_agg(to_jsonb(p))from prescription_items p)is distinct from(select rx from invariant_snapshot)or(select jsonb_agg(to_jsonb(c))from compounding_recipes c)is distinct from(select compound from invariant_snapshot)then raise exception 'downstream or timestamps changed';end if;
 if exists(select 1 from medical_records where submission_key<>'initial-key'or submission_hash<>'original-hash'or berat<>3 or follow_up<>'Kontrol'or catatan_resep<>'Resep awal'or penunjang_urls<>array['preserved/file'])then raise exception 'immutable clinical context changed';end if;
 if exists(select 1 from clinic_record_corrections where created_by<>'f0000000-0000-4000-8000-000000000001'or transaction_id<>txid_current()or before_value->>'id'<>after_value->>'id')then raise exception 'audit identity wrong';end if;
end$$;
update visits set status='Selesai',checked_out_at=now();set local role authenticated;
do $$begin if public.clinic_can_correct_record('f4000000-0000-4000-8000-000000000001')then raise exception 'paid ready';end if;end$$;
do $$declare denied boolean:=false;begin
 begin perform public.clinic_correct_unpaid_record('f2000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',2,'{}','Paid denial','edit-paid');exception when sqlstate 'P0001'then denied:=true;end;
 if not denied then raise exception 'paid write accepted';end if;
end$$;
reset role;update visits set status='Pembayaran';set local role authenticated;
do $$declare denied boolean:=false;begin
 if public.clinic_can_correct_record('f4000000-0000-4000-8000-000000000001')then raise exception 'checkout ready';end if;
 begin perform public.clinic_correct_unpaid_record('f2000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',2,'{}','Checkout denial','edit-checkout');exception when sqlstate 'P0001'then denied:=true;end;
 if not denied then raise exception 'checkout write accepted';end if;
end$$;
reset role;update visits set checked_out_at=null;set local role authenticated;
-- Direct insert is held to the exact same checks; client audit attributes cannot be spoofed.
insert into clinic_record_corrections(id,medical_record_id,expected_revision,changes,reason,request_key,created_by,created_at,transaction_id,before_value,after_value)
values(gen_random_uuid(),'f4000000-0000-4000-8000-000000000001',2,'{"anamnesis":null,"diagnosis":"Direct audited correction","therapy":null,"suhu":null,"gejala_klinis":null,"hasil_penunjang":null}','Audit canonicalization','direct-audit','f0000000-0000-4000-8000-000000000002','1900-01-01',0,'{"forged":true}','{"forged":true}');
do $$declare denied boolean:=false;begin
 if exists(select 1 from clinic_record_corrections where request_key='direct-audit'and(created_by<>auth.uid()or transaction_id<>txid_current()or before_value?'forged'or after_value?'forged'or created_at<'2026-01-01'))then raise exception 'audit attributes spoofed';end if;
 begin update medical_records set diagnosis='Direct unaudited replay'where id='f4000000-0000-4000-8000-000000000001';exception when sqlstate 'P0001'then denied:=true;end;if not denied then raise exception 'receipt reusable at top level';end if;
end$$;
reset role;update profiles set is_active=false where id='f0000000-0000-4000-8000-000000000001';set local role authenticated;
do $$begin if public.clinic_can_correct_record('f4000000-0000-4000-8000-000000000001')then raise exception 'inactive ready';end if;end$$;
set local role anon;
do $$declare denied boolean:=false;begin begin perform public.clinic_can_correct_record('f4000000-0000-4000-8000-000000000001');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'anonymous execute';end if;end$$;
rollback;
