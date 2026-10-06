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
      from public.stock s where s.warehouse_id = 'd3000000-0000-4000-8000-000000000001'), '[]'::jsonb),
    'layers', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'qty_left', l.qty_left) order by l.id)
      from public.stock_layers l where l.warehouse_id = 'd3000000-0000-4000-8000-000000000001'), '[]'::jsonb),
    'moves', (select count(*) from public.stock_moves where warehouse_id = 'd3000000-0000-4000-8000-000000000001'),
    'invoices', (select count(*) from public.invoices where visit_id between 'd6000000-0000-4000-8000-000000000001' and 'd6000000-0000-4000-8000-000000000004'),
    'items', (select count(*) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
      where i.visit_id between 'd6000000-0000-4000-8000-000000000001' and 'd6000000-0000-4000-8000-000000000004'),
    'journals', (select count(*) from public.journal_entries where source in ('klinik','klinik-hpp')
      and branch_id = 'd2000000-0000-4000-8000-000000000001')
  );
end;
$$;
grant execute on function public.test_clinic_invoice_state() to authenticated;

insert into auth.users (id, raw_user_meta_data) values
  ('d1000000-0000-4000-8000-000000000001', '{"full_name":"Dokter Test"}'),
  ('d1000000-0000-4000-8000-000000000002', '{"full_name":"Pemilik Test"}');
update public.profiles set role = 'DOCTOR' where id = 'd1000000-0000-4000-8000-000000000001';
update public.profiles set role = 'OWNER' where id = 'd1000000-0000-4000-8000-000000000002';
insert into public.branches (id, code, name, type)
values ('d2000000-0000-4000-8000-000000000001', 'INVTEST', 'Klinik Invoice Test', 'KLINIK');
insert into public.user_branches (user_id, branch_id)
values ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001');
insert into public.warehouses (id, branch_id, code, name, type)
values ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'INVTEST-WH', 'Gudang Test', 'VET');
insert into public.customers (id, name, phone)
values ('d4000000-0000-4000-8000-000000000001', 'Pelanggan Test', '080000000099');
insert into public.pets (id, customer_id, name)
values ('d5000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 'Pasien Test');
insert into public.visits (id, branch_id, customer_id, pet_id)
values
  ('d6000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001'),
  ('d6000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001'),
  ('d6000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001'),
  ('d6000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001');
insert into public.medical_records (id, visit_id)
values
  ('d7000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001'),
  ('d7000000-0000-4000-8000-000000000002', 'd6000000-0000-4000-8000-000000000002'),
  ('d7000000-0000-4000-8000-000000000003', 'd6000000-0000-4000-8000-000000000003'),
  ('d7000000-0000-4000-8000-000000000004', 'd6000000-0000-4000-8000-000000000004');

insert into public.items (id, code, name, unit, buy_price, item_type, is_active, is_compound_material)
values
  ('d8000000-0000-4000-8000-000000000001', 'INV-MED', 'Obat Unit', 'pcs', 2, 'Persediaan', true, false),
  ('d8000000-0000-4000-8000-000000000002', 'INV-ING-A', 'Bahan Racik A', 'gram', 5, 'Persediaan', true, true),
  ('d8000000-0000-4000-8000-000000000003', 'INV-ING-B', 'Bahan Racik B', 'gram', 8, 'Persediaan', true, true),
  ('d8000000-0000-4000-8000-000000000004', 'INV-ZERO', 'Obat Tanpa HPP', 'pcs', 0, 'Persediaan', true, false),
  ('d8000000-0000-4000-8000-000000000005', 'INV-SHORT', 'Obat Stok Kurang', 'pcs', 5, 'Persediaan', true, false);
insert into public.item_units (item_id, unit, factor, sell_price, buy_price)
values ('d8000000-0000-4000-8000-000000000001', 'strip', 10, 100, 2);
insert into public.stock (warehouse_id, item_id, qty)
values
  ('d3000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', 30),
  ('d3000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000002', 4),
  ('d3000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000003', 4),
  ('d3000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000004', 1),
  ('d3000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000005', 1);
insert into public.stock_layers (warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source)
values
  ('d3000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', current_date - 1, 10, 10, 2, 'purchase'),
  ('d3000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', current_date, 20, 20, 3, 'purchase'),
  ('d3000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000002', current_date, 4, 4, 5, 'purchase'),
  ('d3000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000003', current_date, 4, 4, 8, 'purchase'),
  ('d3000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000004', current_date, 1, 1, 0, 'purchase'),
  ('d3000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000005', current_date, 1, 1, 5, 'purchase');
insert into public.prescription_items (id, medical_record_id, nama_obat, qty, harga, satuan, faktor, jenis, item_id)
values ('d9000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000001', 'Obat Unit', 2, 100, 'strip', 10, 'obat', 'd8000000-0000-4000-8000-000000000001');
insert into public.cashier_shifts (id, branch_id, opened_by, shift_type, status)
values ('da000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'klinik', 'open');

insert into public.coa_accounts (code, name, type, normal_balance, is_active, is_header)
values
  ('1101','Kas','ASET','D',true,false), ('1201','Piutang','ASET','D',true,false),
  ('1301','Persediaan','ASET','D',true,false), ('2201','PPN Keluaran','LIABILITAS','K',true,false),
  ('4102','Diskon','PENDAPATAN','D',true,false), ('4201','Pendapatan Klinik','PENDAPATAN','K',true,false),
  ('5101','HPP','BEBAN','D',true,false)
on conflict (code) do update set is_active = true, is_header = false;
insert into public.cash_accounts (nama, jenis, coa_code)
values ('Kas Uji Klinik', 'Kas', '1101') on conflict (coa_code) do update set is_active = true;

do $$
begin
  if not has_function_privilege('authenticated', 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'authenticated cannot invoke the invoice RPC';
  end if;
  if has_function_privilege('service_role', 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'service_role must not invoke the invoice RPC';
  end if;
  if has_function_privilege('authenticated', 'public.clinic_write_journal(date,text,text,text,uuid,jsonb)', 'EXECUTE') then
    raise exception 'authenticated can invoke the internal journal writer';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
 inv uuid; replay uuid; state_before jsonb; edit jsonb; edited_lines jsonb;
 sale jsonb := jsonb_build_object('tanggal',current_date::text,'subtotal',200,'discount',0,'tax',0,'total',200,
  'dp_amount',0,'dp_date',null,'paid_status','Belum Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001','voucher_code',null,'salesperson_id',null);
 lines jsonb := '[{"description":"Obat Unit","qty":2,"price":100,"kind":"obat","item_id":"d8000000-0000-4000-8000-000000000001","unit":"strip","prescription_item_id":null,"recipe_id":null,"discount_percent":0}]';
begin
 state_before := public.test_clinic_invoice_state();
 -- Unknown units fail before any partial stock/invoice writes.
 begin
  perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002','manual-unit-invalid',sale,jsonb_set(lines,'{0,unit}','"unknown"'));
  raise exception 'Expected invalid unit rejection';
 exception when sqlstate 'P0001' then if sqlerrm not like 'UNIT_INVALID:%' then raise;end if;end;
 assert state_before=public.test_clinic_invoice_state(),'Invalid unit must roll back';
 -- Existing clinical prescriptions remain sealed to their recorded unit.
 begin
  perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','prescription-unit-changed',sale,
    jsonb_set(jsonb_set(lines,'{0,unit}','"pcs"'),'{0,prescription_item_id}','"d9000000-0000-4000-8000-000000000001"'));
  raise exception 'Expected sealed prescription unit rejection';
 exception when sqlstate 'P0001' then if sqlerrm not like 'UNIT_INVALID:%' then raise;end if;end;
 assert state_before=public.test_clinic_invoice_state(),'Prescription changes must roll back';
 inv := public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002','manual-unit-valid',sale,lines);
 replay := public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002','manual-unit-valid',sale,lines);
 assert inv=replay,'Retry reuses invoice';
 assert (select qty=10 from public.stock where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000001'),'Two strips deduct twenty base units once';
 assert (select qty=2 and satuan='strip' and faktor=10 and hpp=50 from public.invoice_items where invoice_id=inv),'Invoice retains chosen unit and FIFO HPP';
 assert (select sum(qty_left)=10 from public.stock_layers where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000001'),'FIFO deductions use base quantities';
 assert (select sum(l.debit)=50 from public.journal_entries e join public.journal_lines l on l.entry_id=e.id where e.source='klinik-hpp' and e.source_ref=(select invoice_no from public.invoices where id=inv)),'HPP journal reflects conversion';
 -- A discount-only correction must retain the manual alternate UOM and cost.
 edit := jsonb_build_object('subtotal',200,'discount',20,'tax',0,'total',180,'dp_amount',0,'paid_status','Belum Lunas','metode_bayar','Tunai','voucher_code',null,'reason','Fiction discount correction');
 perform public.clinic_edit_invoice(inv,'manual-unit-discount',edit,lines);
 assert (select qty=10 from public.stock where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000001'),'Discount correction must not redispense';
 assert (select satuan='strip' and faktor=10 and hpp=50 from public.invoice_items where invoice_id=inv),'Discount edit retains sealed UOM and HPP';
 state_before := public.test_clinic_invoice_state();
 begin
  perform public.clinic_edit_invoice(inv,'manual-unit-edit-invalid',edit,jsonb_set(lines,'{0,unit}','"unknown"'));
  raise exception 'Expected invalid edited unit rejection';
 exception when sqlstate 'P0001' then if sqlerrm not like 'UNIT_INVALID:%' then raise;end if;end;
 assert state_before=public.test_clinic_invoice_state(),'Invalid correction rolls back';
 -- Increasing two strips to three consumes only ten additional base units.
 edited_lines := jsonb_set(lines,'{0,qty}','3');
 edit := jsonb_set(jsonb_set(edit,'{subtotal}','300'),'{total}','280');
 perform public.clinic_edit_invoice(inv,'manual-unit-edit-more',edit,edited_lines);
 perform public.clinic_edit_invoice(inv,'manual-unit-edit-more',edit,edited_lines);
 assert (select qty=0 from public.stock where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000001'),'Edit quantity delta consumes ten base units once';
 assert (select qty=3 and satuan='strip' and faktor=10 and hpp=80 from public.invoice_items where invoice_id=inv),'Edit adds actual FIFO cost only for additional units';
end $$;
reset role;
rollback;
