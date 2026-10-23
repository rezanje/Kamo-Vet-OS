-- Synthetic identities only. Run solely in the owned isolated PostgreSQL runner.
insert into auth.users(id) values ('d0300000-0000-4000-8000-000000000001');
insert into profiles(id,role,is_active) values ('d0300000-0000-4000-8000-000000000001','OWNER',true) on conflict(id) do update set role='OWNER',is_active=true;
insert into customers(id,name,phone) values ('d0300000-0000-4000-8000-000000000010','Dr. Mira','080000000001'),('d0300000-0000-4000-8000-000000000011','Other fictional owner','080000000001');
insert into pets(id,customer_id,name) values ('d0300000-0000-4000-8000-000000000020','d0300000-0000-4000-8000-000000000010','Fictional cat'),('d0300000-0000-4000-8000-000000000021','d0300000-0000-4000-8000-000000000011','Fictional cat');
set role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='d0300000-0000-4000-8000-000000000001';
begin;
select import_legacy_medical_record_resolved('fictional-old','OLD','2026-10-20T00:00:00+07:00','Dr. Mira','080000000001',null,'Fictional cat',null,null,null,null,null,null,'Old history',null,'Old diagnosis',null,'d0300000-0000-4000-8000-000000000010','d0300000-0000-4000-8000-000000000020');
savepoint reproduce_null_mapping;
-- Real unchanged RPC reproduces the stricter SQL spelling mismatch when the app
-- discards its unique normalized preview match.
select import_legacy_medical_record_resolved('fictional-unmapped','NEW','2026-10-23T00:00:00+07:00','Dr Mira','080000000001',null,'Fictional  cat',null,null,null,null,null,null,'New history',null,'New diagnosis',null);
do $$begin
 if (select count(*) from customers where phone='080000000001') <> 3 then raise exception 'Expected real null-mapping spelling mismatch'; end if;
end$$;
rollback to reproduce_null_mapping;
release savepoint reproduce_null_mapping;
-- The corrected action carries the exact preview IDs, adding a new visit.
select import_legacy_medical_record_resolved('fictional-new','NEW','2026-10-23T00:00:00+07:00','Dr Mira','080000000001',null,'Fictional  cat',null,null,null,null,null,null,'New history',null,'New diagnosis',null,'d0300000-0000-4000-8000-000000000010','d0300000-0000-4000-8000-000000000020');
-- A retry returns the same source visit; altered payload cannot overwrite it.
select import_legacy_medical_record_resolved('fictional-new','NEW','2026-10-23T00:00:00+07:00','Dr Mira','080000000001',null,'Fictional  cat',null,null,null,null,null,null,'Should never overwrite',null,'Should never overwrite',null,'d0300000-0000-4000-8000-000000000010','d0300000-0000-4000-8000-000000000020');
do $$begin
 if (select count(*) from visits where legacy_source_key in ('fictional-old','fictional-new')) <> 2 then raise exception 'Delta lost or duplicated visits'; end if;
 if (select count(*) from medical_records m join visits v on v.id=m.visit_id where v.legacy_source_key in ('fictional-old','fictional-new') and v.customer_id='d0300000-0000-4000-8000-000000000010' and v.pet_id='d0300000-0000-4000-8000-000000000020') <> 2 then raise exception 'Wrong identity or missing records'; end if;
 if not exists(select 1 from medical_records m join visits v on v.id=m.visit_id where v.legacy_source_key='fictional-old' and m.anamnesis='Old history' and m.diagnosis='Old diagnosis') then raise exception 'Old history overwritten'; end if;
 if not exists(select 1 from medical_records m join visits v on v.id=m.visit_id where v.legacy_source_key='fictional-new' and m.anamnesis='New history' and m.diagnosis='New diagnosis') then raise exception 'Retry overwrote new history'; end if;
 if (select count(*) from customers where phone='080000000001') <> 2 then raise exception 'Unexpected duplicate owner'; end if;
 begin
  perform import_legacy_medical_record_resolved('fictional-wrong-pet','BAD','2026-10-23T00:00:00+07:00','Dr Mira','080000000001',null,'Fictional cat',null,null,null,null,null,null,'Wrong mapping',null,null,null,'d0300000-0000-4000-8000-000000000010','d0300000-0000-4000-8000-000000000021');
  raise exception 'Wrong-owner pet was accepted';
 exception when others then
  if sqlerrm not like '%Anabul pilihan tidak cocok%' then raise; end if;
 end;
 if exists(select 1 from visits where legacy_source_key='fictional-wrong-pet') then raise exception 'Failed import left a visit'; end if;
end$$;
rollback;
