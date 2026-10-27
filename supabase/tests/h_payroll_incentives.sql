-- Append after clinic_invoice_post.sql fixture setup; fictional rows roll back.
-- H05 package origin on clinic lines, H04 commission groups, H06 visit rate config.
create function pg_temp.assert_h(ok boolean, msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',msg;end if;end$$;
insert into public.items (id, code, name, unit, item_type, is_active)
values ('fa000000-0000-4000-8000-000000000001', 'PKG-VAKS', 'Paket vaksin fiktif', 'paket', 'Grup', true),
       ('fa000000-0000-4000-8000-000000000002', 'PKG-OTHER', 'Paket lain fiktif', 'paket', 'Grup', true),
       ('fa000000-0000-4000-8000-000000000003', 'PKG-OFF', 'Paket nonaktif fiktif', 'paket', 'Grup', false);
insert into public.item_group_components (group_item_id, component_item_id, qty, unit, factor)
values ('fa000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', 1, 'pcs', 1),
       ('fa000000-0000-4000-8000-000000000002', 'd8000000-0000-4000-8000-000000000004', 1, 'pcs', 1),
       ('fa000000-0000-4000-8000-000000000003', 'd8000000-0000-4000-8000-000000000001', 1, 'pcs', 1);
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$
declare inv uuid; reissued uuid; lines jsonb; edit_lines jsonb; header jsonb;
begin
 header:=jsonb_build_object('tanggal',current_date::text,'subtotal',80,'discount',0,'tax',0,'total',80,'dp_amount',0,'dp_date',null,
   'paid_status','Belum Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001');
 -- 3 bundles + 1 normal vaccine of the same SKU.
 lines:=jsonb_build_array(
  jsonb_build_object('description','Vaksin (paket)','qty',3,'price',20,'kind','obat','item_id','d8000000-0000-4000-8000-000000000001','unit','pcs','discount_percent',0,
    'package_item_id','fa000000-0000-4000-8000-000000000001','package_qty',3),
  jsonb_build_object('description','Vaksin biasa','qty',1,'price',20,'kind','obat','item_id','d8000000-0000-4000-8000-000000000001','unit','pcs','discount_percent',0));
 inv:=public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','h05.package.1',header,lines);
 perform pg_temp.assert_h((select package_item_id='fa000000-0000-4000-8000-000000000001' and package_qty=3 from public.invoice_items where invoice_id=inv and deskripsi='Vaksin (paket)'),'package component keeps its package origin and package qty');
 perform pg_temp.assert_h((select package_item_id is null and package_qty is null from public.invoice_items where invoice_id=inv and deskripsi='Vaksin biasa'),'normal line stays untagged');
 begin
  perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002','h05.package.wrong',header,
    jsonb_set(lines,'{0,package_item_id}','"fa000000-0000-4000-8000-000000000002"'));
  raise exception 'Expected component outside package rejection';
 exception when others then if sqlerrm not like 'CARE_INVALID:%' then raise;end if;end;
 begin
  perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002','h05.package.zero',header,
    jsonb_set(lines,'{0,package_qty}','0'));
  raise exception 'Expected zero package qty rejection';
 exception when others then if sqlerrm not like 'CARE_INVALID:%' and sqlstate<>'23514' then raise;end if;end;
 begin
  perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002','h05.package.inflated',header,
    jsonb_set(lines,'{0,package_qty}','5'));
  raise exception 'Expected inflated package qty rejection';
 exception when others then if sqlerrm not like 'CARE_INVALID: jumlah komponen harus%' then raise;end if;end;
 -- Correction: the line linked to its source keeps the package origin without resending it.
 -- (Existing correction rule: one SKU appears once per corrected invoice, so the normal line is dropped.)
 select jsonb_agg(jsonb_build_object('source_invoice_item_id',id,'description',deskripsi,'qty',qty,'price',harga,
   'kind',jenis,'item_id',item_id,'unit',satuan,'discount_percent',diskon_persen) order by deskripsi)
   into edit_lines from public.invoice_items where invoice_id=inv and package_item_id is not null;
 perform public.clinic_edit_invoice(inv,'h05.package.edit',header||jsonb_build_object('subtotal',60,'total',60,'reason','Fictional correction keeps package'),edit_lines);
 perform pg_temp.assert_h((select count(*)=1 and min(package_qty)=3 from public.invoice_items where invoice_id=inv and package_item_id is not null),'correction inherits package origin');
 perform public.clinic_receive_invoice_payment(inv,current_date,10,'Tunai','1101',null,'h05.package.payment');
 reissued:=public.clinic_void_reissue_invoice(inv,'h05.package.reissue','Fictional reissue keeps package');
 perform pg_temp.assert_h((select count(*)=1 and min(package_qty)=3 from public.invoice_items where invoice_id=reissued and package_item_id is not null),'reissue inherits package origin');
end $$;
reset role;
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claim.sub','',true);
do $$
declare inv uuid;
begin
 select invoice_id into inv from public.invoice_items where package_item_id='fa000000-0000-4000-8000-000000000001' limit 1;
 begin
  insert into public.invoice_items(invoice_id,deskripsi,qty,harga,jenis,item_id) values (inv,'Paket polos',1,0,'obat','fa000000-0000-4000-8000-000000000001');
  raise exception 'Expected plain package line next to its components rejection';
 exception when others then if sqlerrm not like 'CARE_INVALID: paket ini sudah ditagih%' then raise;end if;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$begin
 perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000003','h05.package.inactive',
  jsonb_build_object('tanggal',current_date::text,'subtotal',60,'discount',0,'tax',0,'total',60,'dp_amount',0,'dp_date',null,
   'paid_status','Belum Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001'),
  jsonb_build_array(jsonb_build_object('description','Vaksin (paket)','qty',3,'price',20,'kind','obat','item_id','d8000000-0000-4000-8000-000000000001','unit','pcs','discount_percent',0,
    'package_item_id','fa000000-0000-4000-8000-000000000003','package_qty',3)));
 raise exception 'Expected inactive package rejection';
exception when others then if sqlerrm not like 'CARE_INVALID: barang ini bukan komponen paket aktif%' then raise;end if;
end $$;
reset role;
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claim.sub','',true);
do $$begin
 begin
  update public.invoice_items set package_item_id=null,package_qty=null
   where package_item_id is not null and invoice_id=(select id from public.invoices where request_key='h05.package.1');
  raise exception 'Expected immutable package origin';
 exception when others then if sqlerrm not like 'CARE_INVALID:%' then raise;end if;end;
end $$;
-- H04 groups and H06 visit rate.
do $$
declare base uuid;
begin
 insert into public.employees(id,nama,jabatan,branch_id,status,commission_group) values
  ('fb000000-0000-4000-8000-000000000001','Fictional vet','Dokter','d2000000-0000-4000-8000-000000000001','Aktif','dokter_lama');
 begin
  update public.employees set commission_group='Bad Code!' where id='fb000000-0000-4000-8000-000000000001';
  raise exception 'Expected group format rejection';
 exception when check_violation then null;end;
 insert into public.commission_rules(id,nama,tipe,nominal,sumber,commission_group)
  values (gen_random_uuid(),'Fictional group rule','nominal',1,'klinik','dokter_lama') returning id into base;
 begin
  insert into public.commission_rules(nama,tipe,nominal,sumber,commission_group,override_group_rule_id)
   values ('Bad exception','nominal',1,'klinik','dokter_lama',base);
  raise exception 'Expected exception scope rejection';
 exception when check_violation then null;end;
 insert into public.commission_rules(nama,tipe,nominal,sumber,employee_id,override_group_rule_id)
  values ('Fictional exception','nominal',2,'klinik','fb000000-0000-4000-8000-000000000001',base);
 insert into public.commission_rules(nama,tipe,nominal,sumber) values ('Fictional visit rate','nominal',1,'visit_ranap');
 begin
  insert into public.commission_rules(nama,tipe,persen,sumber) values ('Bad visit percent','persen',1,'visit_ranap');
  raise exception 'Expected visit percent rejection';
 exception when check_violation then null;end;
 begin
  insert into public.commission_rules(nama,tipe,nominal,sumber,item_id) values ('Bad visit item','nominal',1,'visit_ranap','d8000000-0000-4000-8000-000000000001');
  raise exception 'Expected visit item rejection';
 exception when check_violation then null;end;
end $$;
-- H04 exceptions follow their group rule on delete; access is OWNER-only for pay configuration.
do $$begin
 delete from public.commission_rules where nama='Fictional group rule';
 perform pg_temp.assert_h(not exists(select 1 from public.commission_rules where nama='Fictional exception'),'deleting a group rule removes its exceptions');
end $$;
insert into auth.users(id) values ('fc000000-0000-4000-8000-000000000004'),('fc000000-0000-4000-8000-000000000005');
insert into public.profiles(id, full_name, role, is_active) values
 ('fc000000-0000-4000-8000-000000000004','Fiksi Admin G','ADMIN',true),
 ('fc000000-0000-4000-8000-000000000005','Fiksi Staf G','STAFF',true)
on conflict (id) do update set role=excluded.role,is_active=true;
insert into public.user_branches(user_id,branch_id) values ('fc000000-0000-4000-8000-000000000004','d2000000-0000-4000-8000-000000000001');
insert into public.commission_rules(nama,tipe,nominal,sumber,employee_id) values ('Fictional personal','nominal',1,'klinik','fb000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','fc000000-0000-4000-8000-000000000004',true);
do $$begin
 begin
  update public.employees set commission_group='naik_sendiri' where id='fb000000-0000-4000-8000-000000000001';
  raise exception 'Expected ADMIN group change rejection';
 exception when insufficient_privilege then null;end;
 begin
  insert into public.commission_rules(nama,tipe,nominal,sumber,employee_id) values ('Self raise','nominal',1,'klinik','fb000000-0000-4000-8000-000000000001');
  raise exception 'Expected ADMIN personal rule rejection';
 exception when insufficient_privilege then null;end;
 begin
  insert into public.commission_rules(nama,tipe,nominal,sumber,commission_group) values ('Group raise','nominal',1,'klinik','dokter_lama');
  raise exception 'Expected ADMIN group rule rejection';
 exception when insufficient_privilege then null;end;
 insert into public.commission_rules(nama,tipe,nominal,sumber) values ('Fictional general by admin','nominal',1,'klinik');
 perform pg_temp.assert_h((select count(*)=0 from public.commission_rules where nama='Fictional personal' and nominal=1) is false,'ADMIN still reads personal rules');
 update public.commission_rules set nominal=99 where nama='Fictional personal';
 perform pg_temp.assert_h(not exists(select 1 from public.commission_rules where nominal=99),'ADMIN cannot change personal rule');
end $$;
select set_config('request.jwt.claim.sub','fc000000-0000-4000-8000-000000000005',true);
do $$begin
 perform pg_temp.assert_h(not exists(select 1 from public.commission_rules where employee_id is not null or commission_group is not null),'STAFF cannot read personal/group rules');
 perform pg_temp.assert_h(exists(select 1 from public.commission_rules where nama='Fictional general by admin'),'STAFF still reads general rules');
end $$;
reset role;
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claim.sub','',true);
-- H03 turnover components and H02 templates/history/access.
insert into auth.users(id) values ('fc000000-0000-4000-8000-000000000001'),('fc000000-0000-4000-8000-000000000002'),('fc000000-0000-4000-8000-000000000003');
insert into public.profiles(id, full_name, role, is_active) values
 ('fc000000-0000-4000-8000-000000000001','Fiksi Owner H','OWNER',true),
 ('fc000000-0000-4000-8000-000000000002','Fiksi Admin H','ADMIN',true),
 ('fc000000-0000-4000-8000-000000000003','Fiksi Finance H','FINANCE',true)
on conflict (id) do update set role=excluded.role,is_active=true;
do $$
begin
 begin
  insert into public.salary_components(nama,tipe,calculation_basis,rate_percent) values ('Bad turnover','tunjangan','net_turnover',0);
  raise exception 'Expected zero turnover rate rejection';
 exception when check_violation then null;end;
 insert into public.salary_components(id,nama,tipe,nominal) values ('fd000000-0000-4000-8000-000000000001','Fiksi makan','tunjangan',1);
 insert into public.salary_components(id,nama,tipe,calculation_basis,sales_source,sales_scope,rate_percent)
  values ('fd000000-0000-4000-8000-000000000002','Fiksi omzet','tunjangan','net_turnover','klinik','own_branch',1);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','fc000000-0000-4000-8000-000000000001',true);
insert into public.payslip_templates(id,kode,nama) values ('fe000000-0000-4000-8000-000000000001','groomer','Fiksi groomer');
insert into public.payslip_template_components(template_id,component_id,nominal) values ('fe000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',2);
insert into public.employee_payslip_templates(employee_id,template_id) values ('fb000000-0000-4000-8000-000000000001','fe000000-0000-4000-8000-000000000001');
insert into public.employee_salary_components(employee_id,component_id,nominal,override_reason)
 values ('fb000000-0000-4000-8000-000000000001','fd000000-0000-4000-8000-000000000001',3,'Fiksi senioritas');
update public.employee_salary_components set nominal=4,override_reason='Fiksi naik' where employee_id='fb000000-0000-4000-8000-000000000001';
do $$begin
 perform pg_temp.assert_h((select count(*)=3 from public.payslip_override_history where employee_id='fb000000-0000-4000-8000-000000000001'),'template link and two exception changes are recorded');
 perform pg_temp.assert_h((select reason='Fiksi naik' and (old_value->>'nominal')::numeric=3 and (new_value->>'nominal')::numeric=4 and changed_by='fc000000-0000-4000-8000-000000000001'
   from public.payslip_override_history where action='component_set' order by changed_at desc, (new_value->>'nominal') desc limit 1),'exception history keeps before/after, reason and actor');
 begin
  insert into public.payslip_override_history(employee_id,action) values ('fb000000-0000-4000-8000-000000000001','template_set');
  raise exception 'Expected history to be trigger-only';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','fc000000-0000-4000-8000-000000000002',true);
do $$begin
 perform pg_temp.assert_h((select count(*)=0 from public.payslip_templates),'ADMIN cannot read pay templates');
 perform pg_temp.assert_h((select count(*)=0 from public.payslip_override_history),'ADMIN cannot read pay history');
 begin
  insert into public.payslip_templates(kode,nama) values ('admin','Admin forged');
  raise exception 'Expected ADMIN template write rejection';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','fc000000-0000-4000-8000-000000000003',true);
do $$begin
 perform pg_temp.assert_h((select count(*)=1 from public.payslip_templates),'FINANCE reads pay templates');
 perform pg_temp.assert_h((select count(*)=3 from public.payslip_override_history),'FINANCE reads pay history');
 begin
  update public.payslip_template_components set nominal=9;
  perform pg_temp.assert_h((select min(nominal)=2 from public.payslip_template_components),'FINANCE cannot change template');
 exception when insufficient_privilege then null;end;
end $$;
reset role;
-- H06: a doctor visit's time is server-set; only OWNER/ADMIN may move its time/doctor/kind.
reset role;
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claim.sub','',true);
update public.visits set doctor_id='fb000000-0000-4000-8000-000000000001' where id='d6000000-0000-4000-8000-000000000004';
insert into public.user_branches(user_id,branch_id) values ('d1000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001') on conflict do nothing;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
-- Admission itself goes through the consent RPC in the app; the fixture inserts it directly.
insert into public.inpatient_records(id,branch_id,visit_id) values ('ff000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000004');
set local role authenticated;
insert into public.inpatient_daily_logs(id,inpatient_record_id,condition_note,log_kind,visit_doctor_id,created_at,log_date)
 values ('ff000000-0000-4000-8000-000000000002','ff000000-0000-4000-8000-000000000001','Fiksi visit','doctor_visit','fb000000-0000-4000-8000-000000000001','2020-01-01T00:00:00Z','2020-01-01');
do $$begin
 perform pg_temp.assert_h((select created_at > now() - interval '1 minute' and log_date=(now() at time zone 'Asia/Jakarta')::date
   from public.inpatient_daily_logs where id='ff000000-0000-4000-8000-000000000002'),'visit time is server-set on save');
 begin
  perform public.clinic_update_inpatient_log('ff000000-0000-4000-8000-000000000001','ff000000-0000-4000-8000-000000000002',
   jsonb_build_object('created_at','2026-01-01T00:00:00Z'),'Fiksi geser');
  raise exception 'Expected non-admin visit time change rejection';
 exception when others then if sqlerrm not like 'ACCESS_DENIED: waktu, dokter, atau jenis visit%' then raise;end if;end;
 perform public.clinic_update_inpatient_log('ff000000-0000-4000-8000-000000000001','ff000000-0000-4000-8000-000000000002',
   jsonb_build_object('condition_note','Fiksi visit dikoreksi'),'Fiksi catatan');
 perform pg_temp.assert_h((select condition_note='Fiksi visit dikoreksi' from public.inpatient_daily_logs where id='ff000000-0000-4000-8000-000000000002'),'non-admin can still correct the note');
end $$;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
do $$begin
 perform public.clinic_update_inpatient_log('ff000000-0000-4000-8000-000000000001','ff000000-0000-4000-8000-000000000002',
   jsonb_build_object('created_at','2026-01-01T03:00:00Z','log_date','2026-01-01'),'Fiksi koreksi owner');
 perform pg_temp.assert_h((select created_at='2026-01-01T03:00:00Z'::timestamptz from public.inpatient_daily_logs where id='ff000000-0000-4000-8000-000000000002'),'OWNER can correct visit time');
end $$;
reset role;
select 'h_payroll_incentives: all assertions passed';
rollback;
