-- Fictional RLS regression: opname invoices also serve POS actors without sales.
begin;
insert into auth.users(id,raw_user_meta_data) values
('ed100000-0000-4000-8000-000000000001','{"full_name":"Fiction POS admin"}'),
('ed100000-0000-4000-8000-000000000002','{"full_name":"Fiction cashier"}'),
('ed100000-0000-4000-8000-000000000003','{"full_name":"Fiction other"}');
update profiles set role='ADMIN',is_active=true where id='ed100000-0000-4000-8000-000000000001';
update profiles set role='STAFF',is_active=true where id in ('ed100000-0000-4000-8000-000000000002','ed100000-0000-4000-8000-000000000003');
delete from role_modules where role in ('ADMIN','STAFF');
insert into role_modules(role,module_id) values('ADMIN','pos');
insert into branches(id,code,name,type) values
('ed200000-0000-4000-8000-000000000001','OPNAME-A','Fiction A','PETSHOP'),
('ed200000-0000-4000-8000-000000000002','OPNAME-B','Fiction B','PETSHOP');
insert into user_branches(user_id,branch_id) values('ed100000-0000-4000-8000-000000000002','ed200000-0000-4000-8000-000000000001');
insert into cashier_shifts(branch_id,opened_by,status,shift_type) values
('ed200000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000002','open','petshop');
set local role authenticated;
select set_config('request.jwt.claim.sub','ed100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"ed100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare v_id uuid; v_count integer; begin
 insert into sales_invoices(no_faktur,branch_id,kategori,dpp,total,created_by)
 values('FJS.POS.ADMIN','ed200000-0000-4000-8000-000000000001','selisih_stok',20,20,auth.uid()) returning id into v_id;
 insert into sales_invoice_items(invoice_id,nama,qty,harga) values(v_id,'Fiction shortage',1,20);
 if not exists(select 1 from sales_invoice_items where invoice_id=v_id)then raise exception 'POS invoice lines missing';end if;
 begin
  insert into sales_invoices(no_faktur,branch_id,total,created_by) values('FJ.POS.DENIED','ed200000-0000-4000-8000-000000000001',20,auth.uid());
  raise exception 'POS-only actor created ordinary sales invoice';
 exception when insufficient_privilege then null;end;
 begin
  insert into sales_invoices(no_faktur,branch_id,kategori,total,created_by) values('FJS.FORGED','ed200000-0000-4000-8000-000000000001','selisih_stok',20,'ed100000-0000-4000-8000-000000000003');
  raise exception 'POS actor forged invoice creator';
 exception when insufficient_privilege then null;end;
 update sales_invoices set total=99 where id=v_id;
 get diagnostics v_count=row_count;
 if v_count<>0 then raise exception 'POS-only actor changed an issued invoice';end if;
end $$;
select set_config('request.jwt.claim.sub','ed100000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"ed100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ declare v_id uuid; begin
 insert into sales_invoices(no_faktur,branch_id,kategori,total,created_by)
 values('FJS.OWN.SHIFT','ed200000-0000-4000-8000-000000000001','selisih_stok',20,auth.uid())returning id into v_id;
 insert into sales_invoice_items(invoice_id,nama,qty,harga)values(v_id,'Fiction cashier shortage',1,20);
 begin
  insert into sales_invoices(no_faktur,branch_id,kategori,total,created_by)values('FJS.FOREIGN','ed200000-0000-4000-8000-000000000002','selisih_stok',20,auth.uid());
  raise exception 'Cashier wrote another branch';
 exception when insufficient_privilege then null;end;
 begin
  insert into sales_invoice_items(invoice_id,nama,qty,harga)select id,'Forged line',1,20 from sales_invoices where no_faktur='FJS.POS.ADMIN';
  raise exception 'Cashier appended lines to another actor invoice';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
update cashier_shifts set status='closed'where opened_by='ed100000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ begin
 begin
  insert into sales_invoices(no_faktur,branch_id,kategori,total,created_by)values('FJS.CLOSED','ed200000-0000-4000-8000-000000000001','selisih_stok',20,auth.uid());
  raise exception 'Closed shift could write opname invoice';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
update cashier_shifts set status='open',shift_type='klinik'where opened_by='ed100000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ begin
 begin
  insert into sales_invoices(no_faktur,branch_id,kategori,total,created_by)values('FJS.CLINIC.SHIFT','ed200000-0000-4000-8000-000000000001','selisih_stok',20,auth.uid());
  raise exception 'Clinic shift granted petshop opname write';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
update cashier_shifts set shift_type='petshop'where opened_by='ed100000-0000-4000-8000-000000000002';
update profiles set is_active=false where id='ed100000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ begin
 begin
  insert into sales_invoices(no_faktur,branch_id,kategori,total,created_by)values('FJS.DISABLED','ed200000-0000-4000-8000-000000000001','selisih_stok',20,auth.uid());
  raise exception 'Disabled cashier created invoice';
 exception when insufficient_privilege then null;end;
end $$;
rollback;
