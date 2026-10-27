-- Append after clinic_invoice_post.sql fixture setup; fictional rows roll back.
-- H05 package origin on clinic lines, H04 commission groups, H06 visit rate config.
create function pg_temp.assert_h(ok boolean, msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',msg;end if;end$$;
insert into public.items (id, code, name, unit, item_type, is_active)
values ('fa000000-0000-4000-8000-000000000001', 'PKG-VAKS', 'Paket vaksin fiktif', 'paket', 'Grup', true),
       ('fa000000-0000-4000-8000-000000000002', 'PKG-OTHER', 'Paket lain fiktif', 'paket', 'Grup', true);
insert into public.item_group_components (group_item_id, component_item_id, qty, unit, factor)
values ('fa000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', 1, 'pcs', 1),
       ('fa000000-0000-4000-8000-000000000002', 'd8000000-0000-4000-8000-000000000004', 1, 'pcs', 1);
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
select 'h_payroll_incentives: all assertions passed';
rollback;
