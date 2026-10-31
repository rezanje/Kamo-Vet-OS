-- Disposable PostgreSQL fixtures only; all changes roll back.
begin;
insert into auth.users(id,raw_user_meta_data) values ('cb100000-0000-4000-8000-000000000001','{}');
update public.profiles set role='OWNER' where id='cb100000-0000-4000-8000-000000000001';
insert into public.branches(id,code,name,type) values ('cb200000-0000-4000-8000-000000000001','DEMO-FIN','DEMO Finance','KLINIK');
insert into public.customers(id,name,phone) values ('cb300000-0000-4000-8000-000000000001','DEMO Owner','080000000099');
insert into public.pets(id,customer_id,name) values ('cb400000-0000-4000-8000-000000000001','cb300000-0000-4000-8000-000000000001','DEMO Pet');
insert into public.employees(id,nama,jabatan,branch_id,status) values
 ('cb500000-0000-4000-8000-000000000001','DEMO Doctor','Dokter','cb200000-0000-4000-8000-000000000001','Aktif'),
 ('cb500000-0000-4000-8000-000000000002','DEMO Groomer','Groomer','cb200000-0000-4000-8000-000000000001','Aktif');
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id,service_provider_id,dokter,status,service_started_at,service_finished_at)
select ('cb600000-0000-4000-8000-00000000000'||n)::uuid,'cb200000-0000-4000-8000-000000000001','cb300000-0000-4000-8000-000000000001','cb400000-0000-4000-8000-000000000001',
 'cb500000-0000-4000-8000-000000000001','cb500000-0000-4000-8000-000000000002','DEMO Doctor','Pembayaran',now(),now() from generate_series(1,3) n;
insert into public.cashier_shifts(id,branch_id,opened_by,shift_type,status) values
 ('cb700000-0000-4000-8000-000000000001','cb200000-0000-4000-8000-000000000001','cb100000-0000-4000-8000-000000000001','klinik','open');
insert into public.coa_accounts(code,name,type,normal_balance,is_active,is_header) values
 ('110003','Test cash','ASET','D',true,false),('120002','Test bank','ASET','D',true,false),('150001','Test AR','ASET','D',true,false),
 ('520002','Test discount','PENDAPATAN','D',true,false),('510002','Test revenue','PENDAPATAN','K',true,false),('312005','Test tax','LIABILITAS','K',true,false),
 ('740010','Test fee expense','BEBAN','D',true,false) on conflict(code) do update set is_active=true,is_header=false;
insert into public.cash_accounts(nama,jenis,coa_code) values ('Test cash','Kas','110003'),('Test bank','Bank','120002') on conflict(coa_code) do update set is_active=true;
create function public.test_age_demo_invoice(p_id uuid) returns void language sql security definer set search_path='' as $$
 update public.clinic_demo_invoice_snapshots set earned_at='2026-08-15T10:00:00+07:00' where invoice_id=p_id;
$$;
grant execute on function public.test_age_demo_invoice(uuid) to authenticated;
create function public.fail_demo_second_payment() returns trigger language plpgsql as $$ begin
 if new.request_key='demo:'||md5('demo-forced-rollback')||':2' then raise exception 'TEST_SECOND_PAYMENT';end if;return new;end $$;
create trigger fail_demo_second_payment before insert on public.invoice_payments for each row execute function public.fail_demo_second_payment();
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"cb100000-0000-4000-8000-000000000001"}',true);
do $$
declare policy uuid;company uuid;inv uuid;retry uuid;replacement uuid;before_count int;row_count int;
  head jsonb:=jsonb_build_object('tanggal',current_date,'subtotal',50000,'discount',0,'tax',0,'total',50000,'paid_status','Lunas','dp_amount',0,'shift_id','cb700000-0000-4000-8000-000000000001','metode_bayar','Tunai');
  lines jsonb:='[{"description":"DEMO consultation","qty":1,"price":50000,"kind":"jasa"}]';
  parts jsonb:='[{"method":"Tunai","amount":25000,"kas_code":"110003"},{"method":"Transfer","amount":25000,"kas_code":"120002"}]';
  staff uuid[]:=array['cb500000-0000-4000-8000-000000000001'::uuid,'cb500000-0000-4000-8000-000000000002'::uuid];
begin
  policy:=public.save_clinic_demo_policy('DEMO customer',5,'customer','{"Tunai":0,"Transfer":100}','810004','740010');
  inv:=public.clinic_post_demo_invoice('cb600000-0000-4000-8000-000000000001','demo-fee',head,lines,policy,parts,staff);
  retry:=public.clinic_post_demo_invoice('cb600000-0000-4000-8000-000000000001','demo-fee',head,lines,policy,parts,staff);
  if inv is distinct from retry or (select total from public.invoices where id=inv)<>50250
    or (select count(*) from public.invoice_payments where invoice_id=inv)<>2
    or (select sum(amount) from public.invoice_payments where invoice_id=inv)<>50250 then raise exception 'Gross receipts/retry incorrect';end if;
  if (select incentive_pool from public.clinic_demo_invoice_snapshots where invoice_id=inv)<>2500
    or (select sum(amount) from public.clinic_demo_incentive_allocations where invoice_id=inv)<>2500
    or (select count(*) from public.clinic_demo_incentive_allocations where invoice_id=inv and amount=1250)<>2 then raise exception 'Pool duplicated or fee entered basis';end if;
  begin
    perform public.clinic_post_demo_invoice('cb600000-0000-4000-8000-000000000001','demo-fee',head,lines,policy,parts,array[staff[1]]);
    raise exception 'Changed replay accepted';
  exception when raise_exception then if sqlerrm not like 'IDEMPOTENCY_CONFLICT:%' then raise;end if;end;
  company:=public.save_clinic_demo_policy('DEMO company',10,'company','{"Transfer":100}','810004','740010');
  retry:=public.clinic_post_demo_invoice('cb600000-0000-4000-8000-000000000001','demo-fee',head,lines,policy,parts,staff);
  if retry<>inv then raise exception 'New policy changed posted replay';end if;
  before_count:=(select count(*) from public.invoices);
  begin
    perform public.clinic_post_demo_invoice('cb600000-0000-4000-8000-000000000002','demo-rollback',head,lines,company,
      '[{"method":"Tunai","amount":25000,"kas_code":"110003"},{"method":"Transfer","amount":25000,"kas_code":"510002"}]',staff);
    raise exception 'Invalid part accepted';
  exception when raise_exception then if sqlerrm not like 'PAYMENT_INVALID:%' then raise;end if;end;
  if (select count(*) from public.invoices)<>before_count then raise exception 'Failed part left invoice';end if;
  begin
    perform public.clinic_post_demo_invoice('cb600000-0000-4000-8000-000000000002','demo-forced-rollback',head,lines,company,parts,staff);
    raise exception 'Forced second payment failure did not fire';
  exception when raise_exception then if sqlerrm<>'TEST_SECOND_PAYMENT' then raise;end if;end;
  if (select count(*) from public.invoices)<>before_count or (select count(*) from public.invoice_payments)<>2
    or exists(select 1 from public.clinic_demo_invoice_snapshots where request_key='demo-forced-rollback') then raise exception 'Second payment failure left partial effects';end if;
  retry:=public.clinic_post_demo_invoice('cb600000-0000-4000-8000-000000000002','demo-company' ,head,lines,company,
    '[{"method":"Transfer","amount":50000,"kas_code":"120002"}]',staff);
  if (select total from public.invoices where id=retry)<>50000 or (select fee_amount from public.clinic_demo_invoice_snapshots where invoice_id=retry)<>500
    or (select incentive_pool from public.clinic_demo_invoice_snapshots where invoice_id=retry)<>5000 then raise exception 'Company policy snapshot incorrect';end if;
  perform public.test_age_demo_invoice(inv);
  replacement:=public.clinic_void_reissue_invoice(inv,'demo-reissue','DEMO preserved snapshot');
  if replacement<>public.clinic_void_reissue_invoice(inv,'demo-reissue','DEMO preserved snapshot') then raise exception 'Reissue retry changed';end if;
  if (select sum(a.amount) from public.clinic_demo_incentive_allocations a join public.invoices i on i.id=a.invoice_id where i.voided_at is null)<>7500 then raise exception 'Void doubled entitlement';end if;
  if (select earned_at from public.clinic_demo_invoice_snapshots where invoice_id=replacement) is distinct from '2026-08-15T10:00:00+07:00'::timestamptz then raise exception 'Reissue moved previously earned payroll pool into current month';end if;
  if (select total from public.invoices where id=replacement)<>50250 or (select fee_amount from public.clinic_demo_invoice_snapshots where invoice_id=replacement)<>250 then raise exception 'Reissue lost snapshot';end if;
  begin
    perform public.clinic_edit_invoice(replacement,'demo-edit',head,lines);raise exception 'Posted demo money editable';
  exception when raise_exception then if sqlerrm not like 'INVOICE_POSTED:%' then raise;end if;end;
  if exists(select 1 from public.journal_entries e join public.journal_lines l on l.entry_id=e.id
    where e.branch_id='cb200000-0000-4000-8000-000000000001' group by e.id having sum(l.debit)<>sum(l.credit)) then raise exception 'Unbalanced fee journal';end if;
  if (select sum(l.credit-l.debit) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
    where e.branch_id='cb200000-0000-4000-8000-000000000001' and a.code='810004')<>250 then raise exception 'Admin reclassification wrong';end if;
  if (select sum(l.debit-l.credit) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
    where e.branch_id='cb200000-0000-4000-8000-000000000001' and a.code='740010')<>500 then raise exception 'Company expense wrong';end if;
  head:=head||jsonb_build_object('discount',10000,'tax',4400,'total',44400);
  retry:=public.clinic_post_demo_invoice('cb600000-0000-4000-8000-000000000003','demo-tax-discount',head,lines,company,
    '[{"method":"Transfer","amount":44400,"kas_code":"120002"}]',array[staff[1],staff[2],staff[1]]);
  if (select service_basis from public.clinic_demo_invoice_snapshots where invoice_id=retry)<>40000
    or (select incentive_pool from public.clinic_demo_invoice_snapshots where invoice_id=retry)<>4000
    or (select fee_amount from public.clinic_demo_invoice_snapshots where invoice_id=retry)<>444
    or (select count(*) from public.clinic_demo_incentive_allocations where invoice_id=retry)<>2 then raise exception 'Discount/tax/duplicate staff changed shared basis';end if;
end $$;
rollback;
