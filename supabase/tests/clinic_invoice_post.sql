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

insert into auth.users (id, raw_user_meta_data)
values ('d1000000-0000-4000-8000-000000000001', '{"full_name":"Dokter Test"}');
update public.profiles set role = 'DOCTOR' where id = 'd1000000-0000-4000-8000-000000000001';
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
  inv_id uuid;
  retry_id uuid;
  recipe_a uuid;
  recipe_b uuid;
  prescription_b uuid;
  failed boolean;
  state_before jsonb;
  valid_invoice jsonb := jsonb_build_object(
    'tanggal', current_date::text, 'subtotal', 430, 'discount', 10, 'tax', 0, 'total', 420,
    'dp_amount', 0, 'dp_date', null, 'paid_status', 'Lunas', 'metode_bayar', 'Tunai',
    'shift_id', 'da000000-0000-4000-8000-000000000001', 'voucher_code', null,
    'salesperson_id', null
  );
  valid_lines jsonb;
  small_invoice jsonb := jsonb_build_object(
    'tanggal', current_date::text, 'subtotal', 100, 'discount', 0, 'tax', 0, 'total', 100,
    'dp_amount', 0, 'dp_date', null, 'paid_status', 'Lunas', 'metode_bayar', 'Tunai',
    'shift_id', 'da000000-0000-4000-8000-000000000001', 'voucher_code', null,
    'salesperson_id', null
  );
  recipe_invoice jsonb := jsonb_build_object(
    'tanggal', current_date::text, 'subtotal', 80, 'discount', 0, 'tax', 0, 'total', 80,
    'dp_amount', 0, 'dp_date', null, 'paid_status', 'Lunas', 'metode_bayar', 'Tunai',
    'shift_id', 'da000000-0000-4000-8000-000000000001', 'voucher_code', null,
    'salesperson_id', null
  );
begin
  -- Same displayed name, distinct recipe IDs and costs.
  recipe_a := public.clinic_issue_compound('d7000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001',
    '{"recipe_name":"Racikan Kembar","dosage_form":"puyer","ingredients":[{"item_id":"d8000000-0000-4000-8000-000000000002","quantity":1,"unit":"gram","unit_price":80}]}', 'invoice-test-recipe-a');
  recipe_b := public.clinic_issue_compound('d7000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001',
    '{"recipe_name":"Racikan Kembar","dosage_form":"puyer","ingredients":[{"item_id":"d8000000-0000-4000-8000-000000000003","quantity":2,"unit":"gram","unit_price":80}]}', 'invoice-test-recipe-b');
  if recipe_a = recipe_b then raise exception 'duplicate names collapsed to one recipe'; end if;
  select id into prescription_b from public.prescription_items where compound_recipe_id = recipe_b;
  if prescription_b is null then raise exception 'compound was not linked to its prescription line'; end if;
  valid_lines := jsonb_build_array(
    jsonb_build_object('description','Obat Unit','qty',2,'price',100,'kind','obat','item_id','d8000000-0000-4000-8000-000000000001','unit','strip','prescription_item_id','d9000000-0000-4000-8000-000000000001','recipe_id',null,'discount_percent',0),
    jsonb_build_object('description','Jasa Konsultasi','qty',1,'price',100,'kind','jasa','item_id',null,'unit',null,'prescription_item_id',null,'recipe_id',null,'discount_percent',0),
    jsonb_build_object('description','Baris bebas','qty',1,'price',50,'kind','obat','item_id',null,'unit',null,'prescription_item_id',null,'recipe_id',null,'discount_percent',0),
    jsonb_build_object('description','Racikan Kembar','qty',1,'price',80,'kind','obat','item_id',null,'unit','racikan','prescription_item_id',prescription_b,'recipe_id',recipe_b,'discount_percent',0)
  );

  state_before := public.test_clinic_invoice_state();
  inv_id := public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001', 'invoice-test-valid', valid_invoice, valid_lines);
  retry_id := public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001', 'invoice-test-valid', valid_invoice, valid_lines);
  if inv_id <> retry_id then raise exception 'idempotent retry returned a different invoice'; end if;
  if (select count(*) from public.invoice_items where invoice_id = inv_id) <> 4 then raise exception 'mixed invoice lines were not saved'; end if;
  if (select hpp from public.invoice_items where invoice_id = inv_id and deskripsi = 'Obat Unit') <> 50 then raise exception 'medicine HPP did not use selected-unit factor and FIFO layers; got %', (select hpp from public.invoice_items where invoice_id = inv_id and deskripsi = 'Obat Unit'); end if;
  if (select hpp from public.invoice_items where invoice_id = inv_id and compound_recipe_id = recipe_b) <> 16 then raise exception 'compound HPP was not attached by recipe ID'; end if;
  if exists (select 1 from public.invoice_items where invoice_id = inv_id and deskripsi in ('Jasa Konsultasi','Baris bebas') and hpp is not null) then raise exception 'service/free-text line received an HPP'; end if;
  if (select qty from public.stock where warehouse_id = 'd3000000-0000-4000-8000-000000000001' and item_id = 'd8000000-0000-4000-8000-000000000001') <> 10 then raise exception 'medicine balance did not decrement by base-unit factor'; end if;
  if (select qty from public.stock where warehouse_id = 'd3000000-0000-4000-8000-000000000001' and item_id = 'd8000000-0000-4000-8000-000000000003') <> 2 then raise exception 'compound ingredients were debited twice at invoice time'; end if;
  if (select count(*) from public.stock_moves where source = 'klinik' and source_ref = (select invoice_no from public.invoices where id = inv_id)) <> 1 then raise exception 'invoice stock move missing or duplicated'; end if;
  if (select count(*) from public.journal_entries where source = 'klinik' and source_ref = (select invoice_no from public.invoices where id = inv_id)) <> 1 then raise exception 'revenue journal missing or duplicated'; end if;
  if (select count(*) from public.journal_entries where source = 'klinik-hpp' and source_ref = (select invoice_no from public.invoices where id = inv_id)) <> 1 then raise exception 'HPP journal missing or duplicated'; end if;
  if (select sum(jl.debit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id where je.source = 'klinik' and je.source_ref = (select invoice_no from public.invoices where id = inv_id))
     <> (select sum(jl.credit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id where je.source = 'klinik' and je.source_ref = (select invoice_no from public.invoices where id = inv_id)) then raise exception 'revenue journal is not balanced'; end if;
  if (select sum(jl.debit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id where je.source = 'klinik-hpp' and je.source_ref = (select invoice_no from public.invoices where id = inv_id) and jl.account_id = (select id from public.coa_accounts where code = '5101')) <> 66 then raise exception 'HPP journal debit is not the exact invoice HPP total'; end if;
  if (select sum(jl.credit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id where je.source = 'klinik-hpp' and je.source_ref = (select invoice_no from public.invoices where id = inv_id) and jl.account_id = (select id from public.coa_accounts where code = '1301')) <> 66 then raise exception 'HPP journal credit is not balanced'; end if;
  if (select count(*) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id where je.source = 'klinik-hpp' and je.source_ref = (select invoice_no from public.invoices where id = inv_id) and jl.account_id = (select id from public.coa_accounts where code = '5101') and jl.debit > 0) <> 1
     or (select count(*) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id where je.source = 'klinik-hpp' and je.source_ref = (select invoice_no from public.invoices where id = inv_id) and jl.account_id = (select id from public.coa_accounts where code = '1301') and jl.credit > 0) <> 1 then raise exception 'HPP journal must contain one 5101 debit and one 1301 credit'; end if;
  if public.test_clinic_invoice_state() = state_before then raise exception 'valid invoice made no changes'; end if;

  failed := false;
  begin
    perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001', 'invoice-test-valid', valid_invoice,
      jsonb_set(valid_lines, '{0,price}', '101'::jsonb));
  exception when sqlstate 'P0001' then failed := position('IDEMPOTENCY_CONFLICT:' in sqlerrm) = 1; end;
  if not failed then raise exception 'changed payload reused the same request key'; end if;

  insert into public.prescription_items (medical_record_id, nama_obat, qty, harga, satuan, faktor, jenis)
  values ('d7000000-0000-4000-8000-000000000002', 'Racikan Kembar', 1, 80, 'racikan', 1, 'obat');
  failed := false;
  begin
    perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002', 'invoice-test-unlinked-recipe',
      recipe_invoice,
      jsonb_build_array(jsonb_build_object('description','Racikan Kembar','qty',1,'price',80,'kind','obat','item_id',null,'unit',null,'prescription_item_id',null,'recipe_id',null,'discount_percent',0)));
  exception when sqlstate 'P0001' then failed := position('RECIPE_ID_MISSING:' in sqlerrm) = 1; end;
  if not failed then raise exception 'compound with an ambiguous or missing recipe link was billed without HPP'; end if;

  -- Shortage and zero cost must fail before any partial invoice, layer, move or journal is retained.
  state_before := public.test_clinic_invoice_state();
  failed := false;
  begin
    perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002', 'invoice-test-short',
      small_invoice,
      jsonb_build_array(jsonb_build_object('description','Obat Stok Kurang','qty',2,'price',50,'kind','obat','item_id','d8000000-0000-4000-8000-000000000005','discount_percent',0)));
  exception when sqlstate 'P0001' then failed := position('STOCK_SHORT:' in sqlerrm) = 1; end;
  if not failed or public.test_clinic_invoice_state() <> state_before then raise exception 'stock shortage did not roll back completely'; end if;

  failed := false;
  begin
    perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000003', 'invoice-test-zero',
      small_invoice,
      jsonb_build_array(jsonb_build_object('description','Obat Tanpa HPP','qty',1,'price',100,'kind','obat','item_id','d8000000-0000-4000-8000-000000000004','discount_percent',0)));
  exception when sqlstate 'P0001' then failed := position('COST_MISSING:' in sqlerrm) = 1; end;
  if not failed then raise exception 'zero-cost stock layer was accepted'; end if;

  -- Missing accounts also roll back after stock allocation attempts.
  state_before := public.test_clinic_invoice_state();
  update public.coa_accounts set is_active = false where code = '5101';
  failed := false;
  begin
    perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000004', 'invoice-test-no-account',
      small_invoice,
      jsonb_build_array(jsonb_build_object('description','Obat Unit','qty',1,'price',100,'kind','obat','item_id','d8000000-0000-4000-8000-000000000001','unit','pcs','discount_percent',0)));
  exception when sqlstate 'P0001' then failed := position('ACCOUNT_INVALID:' in sqlerrm) = 1; end;
  update public.coa_accounts set is_active = true where code = '5101';
  if not failed or public.test_clinic_invoice_state() <> state_before then raise exception 'missing HPP account did not roll back invoice posting'; end if;

  state_before := public.test_clinic_invoice_state();
  update public.warehouses set is_active = false where id = 'd3000000-0000-4000-8000-000000000001';
  failed := false;
  begin
    perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002', 'invoice-test-no-warehouse',
      small_invoice,
      jsonb_build_array(jsonb_build_object('description','Obat Unit','qty',1,'price',100,'kind','obat','item_id','d8000000-0000-4000-8000-000000000001','unit','pcs','discount_percent',0)));
  exception when sqlstate 'P0001' then failed := position('WAREHOUSE_MISSING:' in sqlerrm) = 1; end;
  update public.warehouses set is_active = true where id = 'd3000000-0000-4000-8000-000000000001';
  if not failed or public.test_clinic_invoice_state() <> state_before then raise exception 'missing warehouse did not roll back invoice posting'; end if;
end;
$$;

rollback;
