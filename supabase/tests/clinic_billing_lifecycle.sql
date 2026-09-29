-- Run only against local Supabase/PostgreSQL. All fixtures roll back.
begin;

do $$
begin
  if to_regprocedure('public.clinic_post_invoice(uuid,text,jsonb,jsonb)') is null then
    raise exception 'clinic_post_invoice RPC is missing';
  end if;
end;
$$;

create or replace function public.test_clinic_invoice_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'stock', coalesce((select jsonb_agg(jsonb_build_object('item_id', s.item_id, 'qty', s.qty) order by s.item_id)
      from public.stock s where s.warehouse_id = 'e3000000-0000-4000-8000-000000000001'), '[]'::jsonb),
    'layers', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'qty_left', l.qty_left) order by l.id)
      from public.stock_layers l where l.warehouse_id = 'e3000000-0000-4000-8000-000000000001'), '[]'::jsonb),
    'moves', (select count(*) from public.stock_moves where warehouse_id = 'e3000000-0000-4000-8000-000000000001'),
    'invoices', (select count(*) from public.invoices where visit_id between 'e6000000-0000-4000-8000-000000000001' and 'e6000000-0000-4000-8000-000000000004'),
    'items', (select count(*) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
      where i.visit_id between 'e6000000-0000-4000-8000-000000000001' and 'e6000000-0000-4000-8000-000000000004'),
    'journals', (select count(*) from public.journal_entries where source in ('klinik','klinik-hpp')
      and branch_id = 'e2000000-0000-4000-8000-000000000001')
  );
end;
$$;
grant execute on function public.test_clinic_invoice_state() to authenticated;

insert into auth.users (id, raw_user_meta_data) values
  ('e1000000-0000-4000-8000-000000000001', '{"full_name":"Dokter Test"}'),
  ('e1000000-0000-4000-8000-000000000002', '{"full_name":"Pemilik Test"}');
update public.profiles set role = 'DOCTOR' where id = 'e1000000-0000-4000-8000-000000000001';
update public.profiles set role = 'STAFF' where id = 'e1000000-0000-4000-8000-000000000002';
insert into public.branches (id, code, name, type)
values ('e2000000-0000-4000-8000-000000000001', 'BILTEST', 'Klinik Invoice Test', 'KLINIK');
insert into public.user_branches (user_id, branch_id)
values ('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001');
insert into public.warehouses (id, branch_id, code, name, type)
values ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'BILTEST-WH', 'Gudang Test', 'VET');
insert into public.customers (id, name, phone)
values ('e4000000-0000-4000-8000-000000000001', 'Pelanggan Test', '080000000098');
insert into public.pets (id, customer_id, name)
values ('e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'Pasien Test');
insert into public.visits (id, branch_id, customer_id, pet_id)
values
  ('e6000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001'),
  ('e6000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001'),
  ('e6000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001'),
  ('e6000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001');
insert into public.medical_records (id, visit_id)
values
  ('e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001'),
  ('e7000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000002'),
  ('e7000000-0000-4000-8000-000000000003', 'e6000000-0000-4000-8000-000000000003'),
  ('e7000000-0000-4000-8000-000000000004', 'e6000000-0000-4000-8000-000000000004');

insert into public.items (id, code, name, unit, buy_price, item_type, is_active, is_compound_material)
values
  ('e8000000-0000-4000-8000-000000000001', 'BIL-MED', 'Obat Unit', 'pcs', 2, 'Persediaan', true, false),
  ('e8000000-0000-4000-8000-000000000002', 'BIL-ING-A', 'Bahan Racik A', 'gram', 5, 'Persediaan', true, true),
  ('e8000000-0000-4000-8000-000000000003', 'BIL-ING-B', 'Bahan Racik B', 'gram', 8, 'Persediaan', true, true),
  ('e8000000-0000-4000-8000-000000000004', 'BIL-ZERO', 'Obat Tanpa HPP', 'pcs', 0, 'Persediaan', true, false),
  ('e8000000-0000-4000-8000-000000000005', 'BIL-SHORT', 'Obat Stok Kurang', 'pcs', 5, 'Persediaan', true, false);
insert into public.item_units (item_id, unit, factor, sell_price, buy_price)
values ('e8000000-0000-4000-8000-000000000001', 'strip', 10, 100, 2);
insert into public.stock (warehouse_id, item_id, qty)
values
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 30),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000002', 4),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000003', 4),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000004', 1),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000005', 1);
insert into public.stock_layers (warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source)
values
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', current_date - 1, 10, 10, 2, 'purchase'),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', current_date, 20, 20, 3, 'purchase'),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000002', current_date, 4, 4, 5, 'purchase'),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000003', current_date, 4, 4, 8, 'purchase'),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000004', current_date, 1, 1, 0, 'purchase'),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000005', current_date, 1, 1, 5, 'purchase');
insert into public.prescription_items (id, medical_record_id, nama_obat, qty, harga, satuan, faktor, jenis, item_id)
values ('e9000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001', 'Obat Unit', 2, 100, 'strip', 10, 'obat', 'e8000000-0000-4000-8000-000000000001');
insert into public.cashier_shifts (id, branch_id, opened_by, shift_type, status)
values ('ea000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'klinik', 'open');

insert into public.coa_accounts (code, name, type, normal_balance, is_active, is_header)
values
  ('1101','Kas','ASET','D',true,false), ('1201','Piutang','ASET','D',true,false),
  ('1301','Persediaan','ASET','D',true,false), ('2201','PPN Keluaran','LIABILITAS','K',true,false),
  ('4102','Diskon','PENDAPATAN','D',true,false), ('4201','Pendapatan Klinik','PENDAPATAN','K',true,false),
  ('5101','HPP','BEBAN','D',true,false)
on conflict (code) do update set is_active = true, is_header = false;
insert into public.cash_accounts (nama, jenis, coa_code)
values ('Kas Uji Klinik', 'Kas', '1101') on conflict (coa_code) do update set is_active = true;


set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  inv uuid;
  replacement uuid;
  replacement_again uuid;
  payment uuid;
  dp_invoice uuid;
  removed_invoice uuid;
  fully_paid_invoice uuid;
  original_no text;
  new_no text;
  before_stock numeric;
  failed boolean;
  sale jsonb := jsonb_build_object(
    'tanggal',current_date::text,'subtotal',200,'discount',0,'tax',0,'total',200,
    'dp_amount',0,'dp_date',null,'paid_status','Belum Lunas','metode_bayar','Tunai',
    'shift_id','ea000000-0000-4000-8000-000000000001','voucher_code',null,'salesperson_id',null);
  lines jsonb := jsonb_build_array(jsonb_build_object(
    'description','Obat Unit','qty',2,'price',100,'kind','obat',
    'item_id','e8000000-0000-4000-8000-000000000001','unit','pcs',
    'prescription_item_id',null,'recipe_id',null,'discount_percent',0));
  edit jsonb := jsonb_build_object('subtotal',300,'discount',0,'tax',0,'total',300,
    'dp_amount',0,'paid_status','Belum Lunas','metode_bayar','Tunai',
    'voucher_code',null,'reason','Salah jumlah obat');
  new_lines jsonb := jsonb_build_array(jsonb_build_object(
    'description','Obat Unit','qty',3,'price',100,'kind','obat',
    'item_id','e8000000-0000-4000-8000-000000000001','unit','pcs',
    'prescription_item_id',null,'recipe_id',null,'discount_percent',0));
begin
  inv := public.clinic_post_invoice('e6000000-0000-4000-8000-000000000001','lifecycle-create',sale,lines);
  select invoice_no into original_no from public.invoices where id=inv;
  if (select hpp from public.invoice_items where invoice_id=inv)<>4 then
    raise exception 'starting HPP wrong'; end if;
  if public.clinic_edit_invoice(inv,'lifecycle-edit',edit,new_lines)<>inv
     or public.clinic_edit_invoice(inv,'lifecycle-edit',edit,new_lines)<>inv then
    raise exception 'edit retry changed invoice'; end if;
  if (select qty from public.stock where warehouse_id='e3000000-0000-4000-8000-000000000001'
    and item_id='e8000000-0000-4000-8000-000000000001')<>27
     or (select hpp from public.invoice_items where invoice_id=inv)<>6 then
    raise exception 'edit did not keep stock and HPP aligned'; end if;
  failed:=false;
  begin
    perform public.clinic_edit_invoice(inv,'lifecycle-edit',edit,jsonb_set(new_lines,'{0,qty}','4'::jsonb));
  exception when sqlstate 'P0001' then failed:=position('IDEMPOTENCY_CONFLICT:' in sqlerrm)=1; end;
  if not failed then raise exception 'edit retry accepted changed payload'; end if;

  -- A failed ledger write cannot leave a payment row behind.
  update public.accounting_locks set closed_until=current_date where id=true;
  failed:=false;
  begin
    perform public.clinic_receive_invoice_payment(inv,current_date,10,'Tunai','1101',null,'lifecycle-ledger-fail');
  exception when others then failed:=position('Periode' in sqlerrm)=1; end;
  update public.accounting_locks set closed_until=null where id=true;
  if not failed or exists(select 1 from public.invoice_payments where invoice_id=inv) then
    raise exception 'failed journal retained a payment'; end if;

  -- An authenticated user without the branch must not receive its money.
  perform set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
  if exists(select 1 from public.invoices where id=inv)
     or exists(select 1 from public.invoice_items where invoice_id=inv)
     or exists(select 1 from public.invoice_edit_log where invoice_id=inv)
     or exists(select 1 from public.invoice_payments where invoice_id=inv) then
    raise exception 'cross-branch invoice data was visible'; end if;
  failed:=false;
  begin
    perform public.clinic_receive_invoice_payment(inv,current_date,10,'Tunai','1101',null,'lifecycle-cross-branch');
  exception when sqlstate 'P0001' then failed:=position('ACCESS_DENIED:' in sqlerrm)=1; end;
  perform set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
  if not failed then raise exception 'cross-branch payment was allowed'; end if;
  perform set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
  failed:=false;
  begin
    perform public.clinic_edit_invoice(inv,'lifecycle-cross-edit',edit,new_lines);
  exception when sqlstate 'P0001' then failed:=position('ACCESS_DENIED:' in sqlerrm)=1; end;
  if not failed then raise exception 'cross-branch correction was allowed'; end if;
  failed:=false;
  begin
    perform public.clinic_void_reissue_invoice(inv,'lifecycle-cross-void','Koreksi');
  exception when sqlstate 'P0001' then failed:=position('ACCESS_DENIED:' in sqlerrm)=1; end;
  perform set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
  if not failed then raise exception 'cross-branch void was allowed'; end if;

  payment := public.clinic_receive_invoice_payment(inv,current_date,50,'Tunai','1101',null,'lifecycle-pay1');
  if public.clinic_receive_invoice_payment(inv,current_date,50,'Tunai','1101',null,'lifecycle-pay1')<>payment
     or (select count(*) from public.invoice_payments where invoice_id=inv)<>1 then
    raise exception 'payment retry duplicated cash'; end if;
  perform set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
  if exists(select 1 from public.invoice_payments where invoice_id=inv) then
    raise exception 'cross-branch payment was visible'; end if;
  perform set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
  failed:=false;
  begin
    perform public.clinic_edit_invoice(inv,'lifecycle-edit-late',edit,new_lines);
  exception when sqlstate 'P0001' then failed:=position('INVOICE_INVALID:' in sqlerrm)=1; end;
  if not failed then raise exception 'partially paid invoice accepted direct edit'; end if;
  perform public.clinic_receive_invoice_payment(inv,current_date,25,'Tunai','1101',null,'lifecycle-pay1b');
  failed:=false;
  begin
    perform public.clinic_receive_invoice_payment(inv,current_date,251,'Tunai','1101',null,'lifecycle-overpay');
  exception when sqlstate 'P0001' then failed:=position('PAYMENT_INVALID:' in sqlerrm)=1; end;
  if not failed or (select count(*) from public.invoice_payments where invoice_id=inv)<>2 then
    raise exception 'overpayment was saved'; end if;
  select qty into before_stock from public.stock where warehouse_id='e3000000-0000-4000-8000-000000000001'
    and item_id='e8000000-0000-4000-8000-000000000001';
  replacement := public.clinic_void_reissue_invoice(inv,'lifecycle-void','Koreksi setelah cicilan');
  if public.clinic_void_reissue_invoice(inv,'lifecycle-void','Koreksi setelah cicilan')<>replacement then
    raise exception 'void retry created another invoice'; end if;
  select invoice_no into new_no from public.invoices where id=replacement;
  if new_no=original_no or (select reissued_from from public.invoices where id=replacement)<>inv
     or (select hpp from public.invoice_items where invoice_id=replacement)<>6
     or (select coalesce(sum(amount),0) from public.invoice_payments
       where invoice_id=replacement and transferred_from=inv)<>75
     or (select paid_status from public.invoices where id=replacement)<>'DP'
     or (select qty from public.stock where warehouse_id='e3000000-0000-4000-8000-000000000001'
        and item_id='e8000000-0000-4000-8000-000000000001')<>before_stock then
    raise exception 'reissue lost cost or moved stock'; end if;
  if (select count(*) from public.journal_entries where source='klinik-void' and source_ref=original_no)<>1
     or (select count(*) from public.journal_entries where source='klinik-hpp-void' and source_ref=original_no)<>1
     or (select count(*) from public.journal_entries where source='klinik-reissue' and source_ref=new_no)<>1 then
    raise exception 'void/reissue journal set incomplete'; end if;
  if exists(select 1 from public.journal_entries e join public.journal_lines l on l.entry_id=e.id
    where e.source_ref=original_no and e.source in ('klinik','klinik-edit','klinik-ar','klinik-void')
    group by l.account_id having sum(l.debit-l.credit)<>0
      and (select code from public.coa_accounts where id=l.account_id) not in ('1101','1201')) then
    raise exception 'old sale revenue was not reversed'; end if;
  if exists(select 1 from public.journal_entries e join public.journal_lines l on l.entry_id=e.id
    join public.coa_accounts a on a.id=l.account_id
    where e.source='klinik-void' and e.source_ref=original_no and a.code='1101') then
    raise exception 'void moved received cash'; end if;
  if exists(select 1 from public.journal_entries e join public.journal_lines l on l.entry_id=e.id
    where e.source_ref=original_no and e.source in ('klinik-hpp','klinik-hpp-edit','klinik-hpp-void')
    group by l.account_id having sum(l.debit-l.credit)<>0) then
    raise exception 'old HPP was not fully reversed'; end if;
  -- Correct the replacement while the original 75 remains credited.
  failed:=false;
  begin
    perform public.clinic_receive_invoice_payment(replacement,current_date,10,'Tunai','1101',null,'lifecycle-pay-early');
  exception when sqlstate 'P0001' then failed:=position('PAYMENT_INVALID:' in sqlerrm)=1; end;
  if not failed then raise exception 'replacement accepted money before correction'; end if;
  failed:=false;
  begin
    perform public.clinic_edit_invoice(replacement,'lifecycle-edit-below-credit',
      edit || '{"subtotal":50,"total":50,"paid_status":"DP"}'::jsonb,
      '[{"description":"Jasa koreksi","qty":1,"price":50,"kind":"jasa","discount_percent":0}]'::jsonb);
  exception when sqlstate 'P0001' then failed:=position('INVOICE_INVALID:' in sqlerrm)=1; end;
  if not failed then raise exception 'credit excess was accepted'; end if;
  perform public.clinic_edit_invoice(replacement,'lifecycle-edit-reissue',
    edit || '{"subtotal":250,"total":250,"paid_status":"DP"}'::jsonb,
    jsonb_set(jsonb_set(new_lines,'{0,qty}','2'::jsonb),'{0,price}','125'::jsonb));
  if (select total from public.invoices where id=replacement)<>250
     or (select correction_pending from public.invoices where id=replacement)
     or (select coalesce(sum(amount),0) from public.invoice_payments where invoice_id=replacement)<>75 then
    raise exception 'credit did not survive correction'; end if;
  perform public.clinic_receive_invoice_payment(replacement,current_date,175,'Tunai','1101',null,'lifecycle-pay2');
  if (select paid_status from public.invoices where id=replacement)<>'Lunas' then
    raise exception 'replacement did not close after full payment'; end if;
  replacement_again := public.clinic_void_reissue_invoice(replacement,
    'lifecycle-void-again','Koreksi kedua');
  if (select coalesce(sum(amount),0) from public.invoice_payments
       where invoice_id=replacement_again and transferred_from=replacement)<>250
     or (select shift_cash_carry from public.invoices where id=replacement_again)<>0
     or (select paid_status from public.invoices where id=replacement_again)<>'Lunas' then
    raise exception 'second reissue lost or doubled transferred money'; end if;

  -- DP correction preserves receipt and historical HPP when only price changes.
  dp_invoice := public.clinic_post_invoice('e6000000-0000-4000-8000-000000000002',
    'lifecycle-dp-create',sale || '{"subtotal":100,"total":100,"dp_amount":20,"paid_status":"DP"}'::jsonb,
    jsonb_set(lines,'{0,qty}','1'::jsonb));
  perform public.clinic_edit_invoice(dp_invoice,'lifecycle-dp-edit',
    edit || '{"subtotal":120,"total":120,"dp_amount":20,"paid_status":"DP"}'::jsonb,
    jsonb_set(jsonb_set(new_lines,'{0,qty}','1'::jsonb),'{0,price}','120'::jsonb));
  if (select hpp from public.invoice_items where invoice_id=dp_invoice)<>2
     or (select dp_amount from public.invoices where id=dp_invoice)<>20
     or (select count(*) from public.journal_entries where source='klinik'
       and source_ref=(select invoice_no from public.invoices where id=dp_invoice))<>1 then
    raise exception 'DP edit changed receipt or historical cost'; end if;

  removed_invoice := public.clinic_post_invoice('e6000000-0000-4000-8000-000000000003',
    'lifecycle-remove-create',sale || '{"subtotal":100,"total":100}'::jsonb,
    jsonb_set(lines,'{0,qty}','1'::jsonb));
  select qty into before_stock from public.stock where warehouse_id='e3000000-0000-4000-8000-000000000001'
    and item_id='e8000000-0000-4000-8000-000000000001';
  perform public.clinic_edit_invoice(removed_invoice,'lifecycle-remove-edit',
    edit || '{"subtotal":50,"total":50}'::jsonb,
    '[{"description":"Jasa koreksi","qty":1,"price":50,"kind":"jasa","discount_percent":0}]'::jsonb);
  if (select qty from public.stock where warehouse_id='e3000000-0000-4000-8000-000000000001'
    and item_id='e8000000-0000-4000-8000-000000000001')<>before_stock+1
    or (select coalesce(sum(hpp),0) from public.invoice_items where invoice_id=removed_invoice)<>0 then
    raise exception 'removing medicine did not restore stock and HPP'; end if;

  fully_paid_invoice := public.clinic_post_invoice('e6000000-0000-4000-8000-000000000004',
    'lifecycle-full-create',sale || '{"subtotal":100,"total":100,"paid_status":"Lunas"}'::jsonb,
    jsonb_set(lines,'{0,qty}','1'::jsonb));
  select qty into before_stock from public.stock where warehouse_id='e3000000-0000-4000-8000-000000000001'
    and item_id='e8000000-0000-4000-8000-000000000001';
  replacement := public.clinic_void_reissue_invoice(fully_paid_invoice,
    'lifecycle-full-void','Salah tagih lunas');
  if (select paid_status from public.invoices where id=replacement)<>'Lunas'
     or (select correction_pending from public.invoices where id=replacement) is not true
     or (select coalesce(sum(amount),0) from public.invoice_payments
       where invoice_id=replacement and transferred_from=fully_paid_invoice)<>100
     or (select hpp from public.invoice_items where invoice_id=replacement)<>2
     or (select qty from public.stock where warehouse_id='e3000000-0000-4000-8000-000000000001'
       and item_id='e8000000-0000-4000-8000-000000000001')<>before_stock then
    raise exception 'fully paid void/reissue changed stock or cost'; end if;
  if (select coalesce(sum(l.debit-l.credit),0) from public.journal_entries e
       join public.journal_lines l on l.entry_id=e.id
       join public.coa_accounts a on a.id=l.account_id
       where a.code='1101' and e.source_ref in (
         select invoice_no from public.invoices where id in (fully_paid_invoice,replacement)))<>100 then
    raise exception 'fully paid reissue doubled or refunded cash'; end if;
  perform public.clinic_edit_invoice(replacement,'lifecycle-full-edit',
    edit || '{"subtotal":120,"total":120,"paid_status":"DP"}'::jsonb,
    jsonb_set(jsonb_set(new_lines,'{0,qty}','1'::jsonb),'{0,price}','120'::jsonb));
  if (select total from public.invoices where id=replacement)<>120
     or (select paid_status from public.invoices where id=replacement)<>'DP'
     or (select coalesce(sum(amount),0) from public.invoice_payments where invoice_id=replacement)<>100 then
    raise exception 'fully paid correction lost the transferred credit'; end if;
end;
$$;

rollback;
