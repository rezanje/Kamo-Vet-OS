-- Run only on isolated local Supabase after the clinic/catalog migrations.
-- Fictional rows only; everything is rolled back.
-- Runner: python3 scripts/test-clinic-inpatient-discharge-postgres.py
begin;

insert into auth.users(id, raw_user_meta_data)
values ('fb000000-0000-4000-8000-000000000001', '{}');
update public.profiles set role='OWNER'
where id='fb000000-0000-4000-8000-000000000001';
-- Fixture writes on inpatient_records pass through protect_inpatient_care_staff,
-- which requires an authenticated, active actor even for the database owner.
select 1 from set_config('request.jwt.claim.role','authenticated',true);
select 1 from set_config('request.jwt.claim.sub','fb000000-0000-4000-8000-000000000001',true);
insert into public.branches(id, code, name, type)
values ('fb100000-0000-4000-8000-000000000001','BILL-INPAT','Cabang Uji','KLINIK');
insert into public.user_branches(user_id,branch_id)
values ('fb000000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001');
insert into public.employees(id,nama,jabatan,branch_id,status)
values ('fb900000-0000-4000-8000-000000000001','Dokter Uji','Dokter','fb100000-0000-4000-8000-000000000001','Aktif'),
       ('fb900000-0000-4000-8000-000000000002','Paramedis Uji','Paramedis','fb100000-0000-4000-8000-000000000001','Aktif');
insert into public.items(id,code,name,unit,item_type,is_active,is_compound_material,sell_price)
values ('fb200000-0000-4000-8000-000000000001','BILL-INPAT-BHN','Bahan uji','gram','Persediaan',true,true,15);
insert into public.warehouses(id,branch_id,code,name,type)
values ('fb300000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001','BILL-INPAT-WH','Gudang Uji','VET');
insert into public.stock(warehouse_id,item_id,qty)
values ('fb300000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001',10);
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
values ('fb300000-0000-4000-8000-000000000001','fb200000-0000-4000-8000-000000000001',current_date,10,10,5,'purchase');
insert into public.customers(id,name,phone)
values ('fb400000-0000-4000-8000-000000000001','Pemilik Uji','080000000003');
insert into public.pets(id,customer_id,name)
values ('fb500000-0000-4000-8000-000000000001','fb400000-0000-4000-8000-000000000001','Pasien Uji'),
       ('fb500000-0000-4000-8000-000000000002','fb400000-0000-4000-8000-000000000001','Pasien Uji Dua');
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id,dokter,status,service_started_at)
values ('fb600000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001','fb500000-0000-4000-8000-000000000001',
  'fb900000-0000-4000-8000-000000000001','Dokter Uji','Diperiksa',now()),
       ('fb600000-0000-4000-8000-000000000002','fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001','fb500000-0000-4000-8000-000000000002',
  'fb900000-0000-4000-8000-000000000001','Dokter Uji','Diperiksa',now());
insert into public.medical_records(id,visit_id,diagnosis)
values ('fb700000-0000-4000-8000-000000000001','fb600000-0000-4000-8000-000000000001','Rawat inap'),
       ('fb700000-0000-4000-8000-000000000002','fb600000-0000-4000-8000-000000000002','Rawat inap');
insert into public.inpatient_records(id,branch_id,visit_id,medical_record_id)
values ('fb800000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000001',
  'fb600000-0000-4000-8000-000000000001','fb700000-0000-4000-8000-000000000001');


update public.inpatient_records set admitted_at=now()-interval '49 hours'
  where id='fb800000-0000-4000-8000-000000000001';
insert into public.items(id,code,name,unit,item_type,is_active,tindakan_kategori,sell_price)
values('fb200000-0000-4000-8000-000000000002','BILL-INPAT-FEE','AAA Biaya Rawat Inap','hari','Jasa',true,'Rawat Inap',100000);

create function public.test_fail_inpatient_fee() returns trigger language plpgsql as $$
begin
  if current_setting('test.fail_fee',true)='1' and new.kategori='Rawat Inap' then
    raise exception 'fee insert refused';
  end if;
  return new;
end;
$$;
create trigger test_fail_inpatient_fee before insert on public.prescription_items
  for each row execute function public.test_fail_inpatient_fee();

-- Fixture helper (owner context): move a closed period back in time, as if it had
-- happened earlier, so later periods do not overlap. Rolled back with everything else.
create function public.test_shift_stay(p_id uuid, p_admitted interval, p_discharged interval)
returns void language sql security definer set search_path='' as $$
  update public.inpatient_records set admitted_at=now()-p_admitted, discharged_at=now()-p_discharged
  where id=p_id;
$$;
grant execute on function public.test_shift_stay(uuid,interval,interval) to authenticated;
create function public.test_fee_days(p_visit uuid) returns numeric
language sql security definer set search_path='' as $$
  select coalesce(sum(p.qty),0) from public.prescription_items p
  join public.medical_records m on m.id=p.medical_record_id
  where m.visit_id=p_visit and p.item_id='fb200000-0000-4000-8000-000000000002';
$$;
grant execute on function public.test_fee_days(uuid) to authenticated;

do $$
declare failed boolean := false;
begin
  begin
    insert into public.invoices(visit_id,invoice_no)
    values('fb600000-0000-4000-8000-000000000001','BILL-INPAT-EARLY');
  exception when sqlstate 'P0001' then
    failed := position('INPATIENT_OPEN:' in sqlerrm)=1;
  end;
  if not failed then raise exception 'invoice was issued before discharge fee'; end if;
end;
$$;

set local role authenticated;

-- 1. Single period: rounded fee, atomic rollback when the fee insert fails, idempotent retry.
do $$
declare
  log_id uuid;
  failed boolean;
  log jsonb := '{"condition_note":"Pasien membaik","log_kind":"monitoring","paramedic_id":"fb900000-0000-4000-8000-000000000002"}';
begin
  perform set_config('test.fail_fee','1',true);
  failed:=false;
  begin
    perform public.clinic_save_inpatient_log_with_status(
      'fb800000-0000-4000-8000-000000000001',
      'fb700000-0000-4000-8000-000000000001',
      log,'[]'::jsonb,'[]'::jsonb,
      'billing-inpatient-fail','sembuh');
  exception when others then failed:=position('fee insert refused' in sqlerrm)>0; end;
  if not failed or exists(select 1 from public.inpatient_daily_logs
      where inpatient_record_id='fb800000-0000-4000-8000-000000000001')
    or (select condition_status from public.inpatient_records
      where id='fb800000-0000-4000-8000-000000000001')<>'stabil'
    or exists(select 1 from public.prescription_items
      where medical_record_id='fb700000-0000-4000-8000-000000000001') then
    raise exception 'failed fee left a daily log or discharge behind'; end if;
  perform set_config('test.fail_fee','0',true);
  log_id:=public.clinic_save_inpatient_log_with_status(
    'fb800000-0000-4000-8000-000000000001',
    'fb700000-0000-4000-8000-000000000001',
    log,'[]'::jsonb,'[]'::jsonb,
    'billing-inpatient-success','sembuh');
  if public.clinic_save_inpatient_log_with_status(
    'fb800000-0000-4000-8000-000000000001',
    'fb700000-0000-4000-8000-000000000001',
    log,'[]'::jsonb,'[]'::jsonb,
    'billing-inpatient-success','sembuh')<>log_id then
    raise exception 'discharge retry duplicated log'; end if;
  if (select condition_status from public.inpatient_records
      where id='fb800000-0000-4000-8000-000000000001')<>'sembuh'
     or (select qty from public.prescription_items
      where medical_record_id='fb700000-0000-4000-8000-000000000001' and kategori='Rawat Inap')<>3
     or (select aturan_pakai from public.prescription_items
      where medical_record_id='fb700000-0000-4000-8000-000000000001' and kategori='Rawat Inap')
        <>'Otomatis dari lama rawat inap: 3 hari' then
    raise exception 'discharge status or rounded fee was not saved'; end if;
end;
$$;

-- 2. Re-discharge, first period NOT invoiced: 3 days (period 1) + 2 days (period 2) = 5.
--    Before K08 only the last period (2 days) remained.
do $$
begin
  -- Period 1 happened 100h..51h ago (49h = 3 days); period 2 started 25h ago (= 2 days).
  perform public.test_shift_stay('fb800000-0000-4000-8000-000000000001','100 hours','51 hours');
end;
$$;
reset role;
insert into public.inpatient_records(id,branch_id,visit_id,medical_record_id,admitted_at)
values ('fb800000-0000-4000-8000-000000000002','fb100000-0000-4000-8000-000000000001',
  'fb600000-0000-4000-8000-000000000001','fb700000-0000-4000-8000-000000000001',now()-interval '25 hours');
set local role authenticated;
do $$
declare failed boolean;
begin
  -- Period 1 cannot be reopened while period 2 is live (one live stay per patient).
  failed:=false;
  begin perform public.clinic_change_inpatient_condition('fb800000-0000-4000-8000-000000000001','stabil','buka lagi');
  exception when sqlstate 'P0001' then failed:=sqlerrm like 'ADMISSION_INVALID:%'; end;
  if not failed then raise exception 'second live stay opened by reopening an old period'; end if;

  if not public.clinic_change_inpatient_condition('fb800000-0000-4000-8000-000000000002','sembuh','pulang lagi') then
    raise exception 're-discharge failed'; end if;
  if public.test_fee_days('fb600000-0000-4000-8000-000000000001')<>5
     or (select count(*) from public.prescription_items
       where medical_record_id='fb700000-0000-4000-8000-000000000001' and kategori='Rawat Inap')<>1
     or (select aturan_pakai from public.prescription_items
       where medical_record_id='fb700000-0000-4000-8000-000000000001' and kategori='Rawat Inap')
        <>'Otomatis dari lama rawat inap: 5 hari (total 5 hari dari 2 periode)' then
    raise exception 're-discharge lost earlier period days: % days',
      public.test_fee_days('fb600000-0000-4000-8000-000000000001'); end if;

  -- Reopening the latest period (no invoice yet) and discharging again is recalculated,
  -- never stacked: still one fee line for 5 days.
  perform public.clinic_change_inpatient_condition('fb800000-0000-4000-8000-000000000002','stabil','kontrol');
  if exists(select 1 from public.inpatient_records where id='fb800000-0000-4000-8000-000000000002'
      and discharged_at is not null) then raise exception 'reopen did not reopen'; end if;
  perform public.clinic_change_inpatient_condition('fb800000-0000-4000-8000-000000000002','sembuh','pulang lagi');
  if public.test_fee_days('fb600000-0000-4000-8000-000000000001')<>5
     or (select count(*) from public.prescription_items
       where medical_record_id='fb700000-0000-4000-8000-000000000001' and kategori='Rawat Inap')<>1 then
    raise exception 'repeated re-discharge stacked or lost fee days'; end if;
end;
$$;

-- 3. Re-discharge, first period ALREADY invoiced (visit 2): nothing billed twice.
reset role;
insert into public.inpatient_records(id,branch_id,visit_id,medical_record_id,admitted_at)
values ('fb800000-0000-4000-8000-000000000003','fb100000-0000-4000-8000-000000000001',
  'fb600000-0000-4000-8000-000000000002','fb700000-0000-4000-8000-000000000002',now()-interval '100 hours');
set local role authenticated;
do $$ begin
  perform public.clinic_change_inpatient_condition('fb800000-0000-4000-8000-000000000003','sembuh','pulang');
  perform public.test_shift_stay('fb800000-0000-4000-8000-000000000003','150 hours','51 hours');
end $$;
reset role;
-- Period 1 (150h..51h ago = 99h = 5 days, as computed at its discharge) is invoiced.
insert into public.invoices(id,visit_id,invoice_no,subtotal,total,paid_status)
values ('fba00000-0000-4000-8000-000000000001','fb600000-0000-4000-8000-000000000002','BILL-INPAT-INV1',500000,500000,'Belum Lunas');
insert into public.invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,prescription_item_id)
select 'fba00000-0000-4000-8000-000000000001',p.nama_obat,p.qty,p.harga,'jasa',p.item_id,p.id
from public.prescription_items p where p.medical_record_id='fb700000-0000-4000-8000-000000000002';
-- Direct second admission on the same visit (path kept by K06 for unpaid invoices).
insert into public.inpatient_records(id,branch_id,visit_id,medical_record_id,admitted_at)
values ('fb800000-0000-4000-8000-000000000004','fb100000-0000-4000-8000-000000000001',
  'fb600000-0000-4000-8000-000000000002','fb700000-0000-4000-8000-000000000002',now()-interval '25 hours');
set local role authenticated;
do $$
declare failed boolean; v_fee uuid; v_qty numeric;
begin
  select id,qty into v_fee,v_qty from public.prescription_items
    where medical_record_id='fb700000-0000-4000-8000-000000000002' and kategori='Rawat Inap';
  if v_qty<>5 then raise exception 'fixture: first period fee should be 5 days, got %',v_qty; end if;

  -- Active invoice: discharge stays refused, invoiced fee line untouched.
  failed:=false;
  begin perform public.clinic_change_inpatient_condition('fb800000-0000-4000-8000-000000000004','sembuh','pulang lagi');
  exception when sqlstate 'P0001' then failed:=sqlerrm like 'INVOICE_EXISTS:%'; end;
  if not failed or (select discharged_at from public.inpatient_records where id='fb800000-0000-4000-8000-000000000004') is not null
     or (select count(*) from public.prescription_items where medical_record_id='fb700000-0000-4000-8000-000000000002')<>1
     or not exists(select 1 from public.prescription_items where id=v_fee and qty=5) then
    raise exception 'discharge with an active invoice changed billing'; end if;
end;
$$;
reset role;
-- The invoice is voided (finance correction) so the visit can be billed again.
update public.invoices set voided_at=now() where id='fba00000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
declare v_fee uuid;
begin
  select id into v_fee from public.prescription_items
    where medical_record_id='fb700000-0000-4000-8000-000000000002' and kategori='Rawat Inap';
  -- The fee line referenced by the voided invoice cannot be deleted (FK); before K08 this
  -- re-discharge failed with a raw foreign-key error.
  if not public.clinic_change_inpatient_condition('fb800000-0000-4000-8000-000000000004','sembuh','pulang lagi') then
    raise exception 're-discharge after void failed'; end if;
  -- Period 1 = 5 days (as billed), period 2 = 2 days → total 7: kept line 5 + new line 2.
  if not exists(select 1 from public.prescription_items where id=v_fee and qty=5)
     or public.test_fee_days('fb600000-0000-4000-8000-000000000002')<>7
     or (select qty from public.prescription_items
       where medical_record_id='fb700000-0000-4000-8000-000000000002' and kategori='Rawat Inap' and id<>v_fee)<>2 then
    raise exception 'invoiced period billed twice or second period lost: % days',
      public.test_fee_days('fb600000-0000-4000-8000-000000000002'); end if;
end;
$$;
reset role;
-- New active invoice covering both lines; reopening a discharged period is then refused.
insert into public.invoices(id,visit_id,invoice_no,subtotal,total,paid_status,paid_at)
values ('fba00000-0000-4000-8000-000000000002','fb600000-0000-4000-8000-000000000002','BILL-INPAT-INV2',700000,700000,'Lunas',now());
insert into public.invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id,prescription_item_id)
select 'fba00000-0000-4000-8000-000000000002',p.nama_obat,p.qty,p.harga,'jasa',p.item_id,p.id
from public.prescription_items p where p.medical_record_id='fb700000-0000-4000-8000-000000000002';
set local role authenticated;
do $$
declare failed boolean;
begin
  failed:=false;
  begin perform public.clinic_change_inpatient_condition('fb800000-0000-4000-8000-000000000004','stabil','buka lagi');
  exception when sqlstate 'P0001' then failed:=sqlerrm like 'INVOICE_EXISTS:%'; end;
  if not failed or (select discharged_at from public.inpatient_records where id='fb800000-0000-4000-8000-000000000004') is null then
    raise exception 'invoiced stay was reopened into an undischargeable state'; end if;
  if public.test_fee_days('fb600000-0000-4000-8000-000000000002')<>7
     or (select sum(ii.qty) from public.invoice_items ii
       where ii.invoice_id='fba00000-0000-4000-8000-000000000002')<>7 then
    raise exception 'billed days changed after refused reopen'; end if;
end;
$$;

-- 4. K14 separate daily tariff: a sick period and a pet hotel period on one visit are billed as
--    two lines (Rawat Inap tariff vs Pet Hotel tariff); without an active Pet Hotel service the
--    pet hotel days fall back to the Rawat Inap price and the line carries a warning.
reset role;
insert into public.items(id,code,name,unit,item_type,is_active,tindakan_kategori,sell_price)
values('fb200000-0000-4000-8000-000000000003','BILL-HOTEL-FEE','AAA Biaya Pet Hotel','malam','Jasa',true,'Pet Hotel',60000);
insert into public.pets(id,customer_id,name)
values ('fb500000-0000-4000-8000-000000000003','fb400000-0000-4000-8000-000000000001','Pasien Uji Tiga'),
       ('fb500000-0000-4000-8000-000000000004','fb400000-0000-4000-8000-000000000001','Pasien Uji Empat');
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id,dokter,status,service_started_at)
values ('fb600000-0000-4000-8000-000000000003','fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001','fb500000-0000-4000-8000-000000000003',
  'fb900000-0000-4000-8000-000000000001','Dokter Uji','Pembayaran',now()),
       ('fb600000-0000-4000-8000-000000000004','fb100000-0000-4000-8000-000000000001',
  'fb400000-0000-4000-8000-000000000001','fb500000-0000-4000-8000-000000000004',
  null,null,'Pembayaran',now());
insert into public.medical_records(id,visit_id,diagnosis)
values ('fb700000-0000-4000-8000-000000000003','fb600000-0000-4000-8000-000000000003','Rawat inap lalu titip'),
       ('fb700000-0000-4000-8000-000000000004','fb600000-0000-4000-8000-000000000004',null);
insert into public.inpatient_records(id,branch_id,visit_id,medical_record_id,admitted_at)
values ('fb800000-0000-4000-8000-000000000005','fb100000-0000-4000-8000-000000000001',
  'fb600000-0000-4000-8000-000000000003','fb700000-0000-4000-8000-000000000003',now()-interval '49 hours');
set local role authenticated;
do $$ begin
  perform public.clinic_change_inpatient_condition('fb800000-0000-4000-8000-000000000005','sembuh','sembuh, lanjut titip');
  perform public.test_shift_stay('fb800000-0000-4000-8000-000000000005','100 hours','51 hours');
end $$;
reset role;
-- Healthy boarding after recovery on the same visit; the second visit never had a doctor.
insert into public.inpatient_records(id,branch_id,visit_id,medical_record_id,admitted_at,stay_type)
values ('fb800000-0000-4000-8000-000000000006','fb100000-0000-4000-8000-000000000001',
  'fb600000-0000-4000-8000-000000000003','fb700000-0000-4000-8000-000000000003',now()-interval '25 hours','pet_hotel'),
       ('fb800000-0000-4000-8000-000000000007','fb100000-0000-4000-8000-000000000001',
  'fb600000-0000-4000-8000-000000000004','fb700000-0000-4000-8000-000000000004',now()-interval '2 hours','pet_hotel');
set local role authenticated;
do $$
begin
  if (select doctor_id from public.inpatient_records where id='fb800000-0000-4000-8000-000000000007') is not null then
    raise exception 'pet hotel stay bound a doctor'; end if;
  perform public.clinic_change_inpatient_condition('fb800000-0000-4000-8000-000000000006','sembuh','dijemput');
  if (select count(*) from public.prescription_items where medical_record_id='fb700000-0000-4000-8000-000000000003')<>2
     or not exists(select 1 from public.prescription_items where medical_record_id='fb700000-0000-4000-8000-000000000003'
       and item_id='fb200000-0000-4000-8000-000000000002' and kategori='Rawat Inap' and qty=3 and harga=100000
       and aturan_pakai='Otomatis dari lama rawat inap: 3 hari')
     or not exists(select 1 from public.prescription_items where medical_record_id='fb700000-0000-4000-8000-000000000003'
       and item_id='fb200000-0000-4000-8000-000000000003' and kategori='Pet Hotel' and qty=2 and harga=60000
       and satuan='malam' and aturan_pakai='Otomatis dari lama pet hotel: 2 hari') then
    raise exception 'sick and pet hotel periods not billed with separate tariffs: %',
      (select jsonb_agg(jsonb_build_object('item',item_id,'kat',kategori,'qty',qty,'harga',harga,'note',aturan_pakai))
       from public.prescription_items where medical_record_id='fb700000-0000-4000-8000-000000000003'); end if;
end $$;
reset role;
-- Fixture (owner): deactivate every Pet Hotel service, including the one seeded by the migration.
do $$ declare v uuid; begin
  for v in select id from public.items where tindakan_kategori='Pet Hotel' loop
    perform set_config('kamo.master_lifecycle','items:'||v::text,true);
    update public.items set is_active=false where id=v;
  end loop;
  perform set_config('kamo.master_lifecycle','',true);
end $$;
set local role authenticated;
do $$
begin
  perform public.clinic_change_inpatient_condition('fb800000-0000-4000-8000-000000000007','sembuh','dijemput');
  if (select count(*) from public.prescription_items where medical_record_id='fb700000-0000-4000-8000-000000000004')<>1
     or not exists(select 1 from public.prescription_items where medical_record_id='fb700000-0000-4000-8000-000000000004'
       and item_id='fb200000-0000-4000-8000-000000000002' and kategori='Pet Hotel' and qty=1 and harga=100000
       and aturan_pakai='Otomatis dari lama pet hotel: 1 hari; tarif Pet Hotel belum diatur, memakai tarif Rawat Inap') then
    raise exception 'pet hotel without its own tariff did not fall back to the Rawat Inap price with a warning: %',
      (select jsonb_agg(jsonb_build_object('item',item_id,'kat',kategori,'qty',qty,'harga',harga,'note',aturan_pakai))
       from public.prescription_items where medical_record_id='fb700000-0000-4000-8000-000000000004'); end if;
  -- The first visit's sick-only lines are unaffected by the second visit's discharge.
  if public.test_fee_days('fb600000-0000-4000-8000-000000000001')<>5 then
    raise exception 'other visit fee changed'; end if;
end $$;

select 'PASS clinic_inpatient_discharge: single period, re-discharge not invoiced (3+2=5), invoiced period not billed twice (5+2=7), reopen guards, separate pet hotel tariff + fallback';
rollback;
