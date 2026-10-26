-- K02 BMHP on clinical procedures. Fictional fixtures only; everything rolls back.
-- Verifies: validation, single issue at invoice posting (FIFO), cost on the procedure
-- line HPP + 5101/1301 journal, revenue unchanged, idempotent retry, rollback on
-- shortage, correction keeps/returns BMHP, void/reissue keeps posted usage, refund
-- source fails closed, and direct writes are rejected.
begin;

insert into auth.users (id, raw_user_meta_data) values
  ('e1000000-0000-4000-8000-000000000001', '{"full_name":"Dokter K02"}'),
  ('e1000000-0000-4000-8000-000000000002', '{"full_name":"Pemilik K02"}');
update public.profiles set role = 'DOCTOR' where id = 'e1000000-0000-4000-8000-000000000001';
update public.profiles set role = 'OWNER' where id = 'e1000000-0000-4000-8000-000000000002';
insert into public.branches (id, code, name, type) values ('e2000000-0000-4000-8000-000000000001', 'K02T', 'Klinik K02 Test', 'KLINIK');
insert into public.user_branches (user_id, branch_id) values ('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001');
insert into public.warehouses (id, branch_id, code, name, type) values ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'K02T-WH', 'Gudang K02', 'VET');
insert into public.customers (id, name, phone) values ('e4000000-0000-4000-8000-000000000001', 'Pelanggan K02', '080000000201');
insert into public.pets (id, customer_id, name) values ('e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'Pasien K02');
insert into public.visits (id, branch_id, customer_id, pet_id) select ('e6000000-0000-4000-8000-00000000000' || n)::uuid,
  'e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001' from generate_series(1, 4) n;
insert into public.medical_records (id, visit_id) select ('e7000000-0000-4000-8000-00000000000' || n)::uuid, ('e6000000-0000-4000-8000-00000000000' || n)::uuid from generate_series(1, 4) n;
insert into public.items (id, code, name, unit, buy_price, item_type, is_active, is_compound_material, tindakan_kategori) values
  ('e8000000-0000-4000-8000-000000000001', 'K02-VAK', 'Tindakan Vaksin', 'jasa', 0, 'Jasa', true, false, 'Vaksinasi'),
  ('e8000000-0000-4000-8000-000000000002', 'K02-SYR', 'Syringe 3ml', 'pcs', 1, 'Persediaan', true, false, null),
  ('e8000000-0000-4000-8000-000000000003', 'K02-KASA', 'Kasa steril', 'lembar', 1, 'Persediaan', true, false, null),
  ('e8000000-0000-4000-8000-000000000004', 'K02-MED', 'Obat K02', 'pcs', 1, 'Persediaan', true, false, null);
insert into public.item_units (item_id, unit, factor, sell_price, buy_price) values ('e8000000-0000-4000-8000-000000000003', 'pak', 10, 0, 10);
insert into public.stock (warehouse_id, item_id, qty) values
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000002', 5),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000003', 30),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000004', 10);
insert into public.stock_layers (warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source) values
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000002', current_date - 1, 2, 2, 1000, 'purchase'),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000002', current_date, 3, 3, 1500, 'purchase'),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000003', current_date, 30, 30, 200, 'purchase'),
  ('e3000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000004', current_date, 10, 10, 50, 'purchase');
insert into public.cashier_shifts (id, branch_id, opened_by, shift_type, status) values
  ('ea000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'klinik', 'open');
insert into public.coa_accounts (code, name, type, normal_balance, is_active, is_header) values
  ('1101','Kas','ASET','D',true,false), ('1201','Piutang','ASET','D',true,false), ('1301','Persediaan','ASET','D',true,false),
  ('2201','PPN Keluaran','LIABILITAS','K',true,false), ('4102','Diskon','PENDAPATAN','D',true,false),
  ('4201','Pendapatan Klinik','PENDAPATAN','K',true,false), ('5101','HPP','BEBAN','D',true,false)
on conflict (code) do update set is_active = true, is_header = false;
insert into public.cash_accounts (nama, jenis, coa_code) values ('Kas Uji K02', 'Kas', '1101') on conflict (coa_code) do update set is_active = true;

-- Normalisation and validation of the doctor's actual usage (clinical save rows).
insert into public.prescription_items (id, medical_record_id, nama_obat, qty, harga, satuan, faktor, jenis, item_id, bmhp_components) values
  ('e9000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001', 'Tindakan Vaksin', 1, 100000, 'jasa', 1, 'jasa', 'e8000000-0000-4000-8000-000000000001',
   '[{"item_id":"e8000000-0000-4000-8000-000000000002","qty":3,"name":"Forged","cost":1},{"item_id":"e8000000-0000-4000-8000-000000000003","qty":1,"unit":"pak"}]'),
  ('e9000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000002', 'Tindakan Vaksin', 1, 100000, 'jasa', 1, 'jasa', 'e8000000-0000-4000-8000-000000000001',
   '[{"item_id":"e8000000-0000-4000-8000-000000000003","qty":2}]'),
  ('e9000000-0000-4000-8000-000000000003', 'e7000000-0000-4000-8000-000000000003', 'Tindakan Vaksin', 1, 100000, 'jasa', 1, 'jasa', 'e8000000-0000-4000-8000-000000000001',
   '[{"item_id":"e8000000-0000-4000-8000-000000000002","qty":1}]'),
  ('e9000000-0000-4000-8000-000000000004', 'e7000000-0000-4000-8000-000000000004', 'Tindakan Vaksin', 1, 100000, 'jasa', 1, 'jasa', 'e8000000-0000-4000-8000-000000000001',
   '[{"item_id":"e8000000-0000-4000-8000-000000000002","qty":99}]'),
  ('e9000000-0000-4000-8000-000000000005', 'e7000000-0000-4000-8000-000000000002', 'Obat K02', 1, 5000, 'pcs', 1, 'obat', 'e8000000-0000-4000-8000-000000000004', null);

do $$
declare v jsonb; failed boolean;
begin
  select bmhp_components into v from public.prescription_items where id = 'e9000000-0000-4000-8000-000000000001';
  if v->0->>'name' is distinct from 'Syringe 3ml' or v->0 ? 'cost' or (v->0->>'base_qty')::numeric is distinct from 3
     or v->1->>'unit' is distinct from 'pak' or (v->1->>'base_qty')::numeric is distinct from 10 then
    raise exception 'BMHP was not normalised from master data: %', v;
  end if;
  if (select bmhp_components from public.prescription_items where id = 'e9000000-0000-4000-8000-000000000005') is not null then
    raise exception 'medicine row unexpectedly carries BMHP'; end if;
  -- medicine rows, non-inventory components, bad units, duplicates and edits are rejected
  foreach v in array array[
    '{"jenis":"obat","item":"e8000000-0000-4000-8000-000000000004","c":[{"item_id":"e8000000-0000-4000-8000-000000000002","qty":1}]}'::jsonb,
    '{"jenis":"jasa","item":"e8000000-0000-4000-8000-000000000001","c":[{"item_id":"e8000000-0000-4000-8000-000000000001","qty":1}]}'::jsonb,
    '{"jenis":"jasa","item":"e8000000-0000-4000-8000-000000000001","c":[{"item_id":"e8000000-0000-4000-8000-000000000002","qty":1,"unit":"box"}]}'::jsonb,
    '{"jenis":"jasa","item":"e8000000-0000-4000-8000-000000000001","c":[{"item_id":"e8000000-0000-4000-8000-000000000002","qty":0}]}'::jsonb,
    '{"jenis":"jasa","item":"e8000000-0000-4000-8000-000000000001","c":[{"item_id":"e8000000-0000-4000-8000-000000000002","qty":1},{"item_id":"e8000000-0000-4000-8000-000000000002","qty":1}]}'::jsonb
  ] loop
    failed := false;
    begin
      insert into public.prescription_items (medical_record_id, nama_obat, qty, harga, satuan, faktor, jenis, item_id, bmhp_components)
      values ('e7000000-0000-4000-8000-000000000003', 'Uji', 1, 1, 'pcs', 1, v->>'jenis', (v->>'item')::uuid, v->'c');
    exception when sqlstate 'P0001' then failed := position('BMHP_INVALID:' in sqlerrm) = 1; end;
    if not failed then raise exception 'invalid BMHP accepted: %', v; end if;
  end loop;
  failed := false;
  begin
    update public.prescription_items set bmhp_components = '[]' where id = 'e9000000-0000-4000-8000-000000000001';
  exception when sqlstate 'P0001' then failed := position('BMHP_INVALID:' in sqlerrm) = 1; end;
  if not failed then raise exception 'saved BMHP could be rewritten directly'; end if;
  -- clinical save RPCs carry the field
  if position('bmhp_components' in pg_get_functiondef('public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)'::regprocedure)) = 0
     or position('bmhp_components' in pg_get_functiondef('public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)'::regprocedure)) = 0 then
    raise exception 'clinical save RPCs do not persist BMHP'; end if;
  if has_function_privilege('authenticated', 'clinic_private.bmhp_issue(uuid,uuid,text,date)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.clinic_bmhp_supported()', 'EXECUTE') then
    raise exception 'BMHP helper grants are wrong'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  wh constant uuid := 'e3000000-0000-4000-8000-000000000001';
  syr constant uuid := 'e8000000-0000-4000-8000-000000000002';
  kasa constant uuid := 'e8000000-0000-4000-8000-000000000003';
  hdr jsonb := jsonb_build_object('tanggal', current_date::text, 'subtotal', 100000, 'discount', 0, 'tax', 0, 'total', 100000,
    'dp_amount', 0, 'dp_date', null, 'paid_status', 'Lunas', 'metode_bayar', 'Tunai',
    'shift_id', 'ea000000-0000-4000-8000-000000000001', 'voucher_code', null, 'salesperson_id', null);
  line jsonb := jsonb_build_object('description','Tindakan Vaksin','qty',1,'price',100000,'kind','jasa',
    'item_id','e8000000-0000-4000-8000-000000000001','unit','jasa','prescription_item_id','e9000000-0000-4000-8000-000000000001','recipe_id',null,'discount_percent',0);
  inv uuid; inv2 uuid; no text; failed boolean; v_hpp numeric; reissued uuid;
  stock_before numeric; layers_before numeric;
begin
  -- 1) shortage rolls back everything
  select qty into stock_before from public.stock where warehouse_id = wh and item_id = syr;
  failed := false;
  begin
    perform public.clinic_post_invoice('e6000000-0000-4000-8000-000000000004', 'k02-short', hdr,
      jsonb_build_array(line || jsonb_build_object('prescription_item_id','e9000000-0000-4000-8000-000000000004')));
  exception when sqlstate 'P0001' then failed := position('STOCK_SHORT:' in sqlerrm) = 1; end;
  if not failed or exists(select 1 from public.invoices where request_key = 'k02-short')
     or (select qty from public.stock where warehouse_id = wh and item_id = syr) is distinct from stock_before then
    raise exception 'BMHP shortage did not roll back'; end if;

  -- 2) post: FIFO 2x1000 + 1x1500 = 3500; kasa 1 pak = 10 lembar x 200 = 2000; total 5500
  inv := public.clinic_post_invoice('e6000000-0000-4000-8000-000000000001', 'k02-post', hdr, jsonb_build_array(line));
  if public.clinic_post_invoice('e6000000-0000-4000-8000-000000000001', 'k02-post', hdr, jsonb_build_array(line)) is distinct from inv then
    raise exception 'idempotent retry returned another invoice'; end if;
  select invoice_no into no from public.invoices where id = inv;
  select hpp into v_hpp from public.invoice_items where invoice_id = inv;
  if v_hpp is distinct from 5500 then raise exception 'procedure HPP is not FIFO BMHP cost: %', v_hpp; end if;
  if (select (bmhp_components->>'cost')::numeric from public.invoice_items where invoice_id = inv) is distinct from 5500
     or (select jsonb_array_length(bmhp_components->'components') from public.invoice_items where invoice_id = inv) is distinct from 2 then
    raise exception 'posted BMHP snapshot missing'; end if;
  if (select qty from public.stock where warehouse_id = wh and item_id = syr) is distinct from 2
     or (select qty from public.stock where warehouse_id = wh and item_id = kasa) is distinct from 20 then
    raise exception 'BMHP stock not issued once in base units'; end if;
  if (select count(*) from public.stock_moves where source = 'klinik-bmhp' and source_ref = no) is distinct from 2
     or (select round(-sum(qty * unit_cost), 2) from public.stock_moves where source = 'klinik-bmhp' and source_ref = no) is distinct from 5500 then
    raise exception 'BMHP stock moves missing, duplicated or mis-valued: %', (select jsonb_agg(jsonb_build_object('src',source,'ref',source_ref,'qty',qty,'cost',unit_cost)) from public.stock_moves where item_id in (syr,kasa)); end if;
  if (select sum(l.debit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.coa_accounts a on a.id = l.account_id
      where e.source = 'klinik-hpp' and e.source_ref = no and a.code = '5101') is distinct from 5500
     or (select sum(l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.coa_accounts a on a.id = l.account_id
      where e.source = 'klinik-hpp' and e.source_ref = no and a.code = '1301') is distinct from 5500 then
    raise exception 'BMHP cost not journaled 5101/1301'; end if;
  if (select sum(l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.coa_accounts a on a.id = l.account_id
      where e.source = 'klinik' and e.source_ref = no and a.code = '4201') is distinct from 100000
     or (select count(*) from public.invoice_items where invoice_id = inv) is distinct from 1 then
    raise exception 'revenue changed or BMHP became a billed line'; end if;

  -- 3) direct writes rejected
  failed := false;
  begin
    insert into public.invoice_items(invoice_id, deskripsi, qty, harga, jenis, bmhp_components) values (inv, 'x', 1, 0, 'jasa', '{"cost":0}');
  exception when sqlstate 'P0001' then failed := true; when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'BMHP snapshot can be inserted directly'; end if;
  failed := false;
  begin
    perform clinic_private.bmhp_issue('e9000000-0000-4000-8000-000000000001', wh, 'x', current_date);
  exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'private BMHP issue is callable'; end if;
  -- no void without reissue: a direct void or delete of the posted invoice is refused,
  -- so BMHP stock, HPP and journal can only be reversed through clinic_void_reissue_invoice
  failed := false;
  begin
    update public.invoices set voided_at = now() where id = inv;
  exception when sqlstate 'P0001' then failed := position('INVOICE_POSTED:' in sqlerrm) = 1;
    when insufficient_privilege then failed := true; end;
  if not failed or (select voided_at from public.invoices where id = inv) is not null then
    raise exception 'BMHP invoice voided without reissue'; end if;
  failed := false;
  begin
    delete from public.invoices where id = inv;
  exception when sqlstate 'P0001' then failed := position('INVOICE_POSTED:' in sqlerrm) = 1;
    when insufficient_privilege then failed := true; end;
  if not failed or not exists(select 1 from public.invoices where id = inv) then
    raise exception 'BMHP invoice deleted without reversal'; end if;

  -- 4) refund source fails closed (no BMHP restock path there)
  if (public.preview_clinic_refund_source(inv)->>'eligible')::boolean
     or position('racikan/obat' in public.preview_clinic_refund_source(inv)->>'reason') = 0 then
    raise exception 'refund source accepted a BMHP invoice'; end if;

  -- 5) void/reissue: HPP journal reversed and re-posted on the new invoice, stock not moved twice
  reissued := public.clinic_void_reissue_invoice(inv, 'k02-reissue', 'Uji pembatalan fiktif');
  if (select hpp from public.invoice_items where invoice_id = reissued) is distinct from 5500
     or (select bmhp_components->>'cost' from public.invoice_items where invoice_id = reissued)::numeric is distinct from 5500 then
    raise exception 'reissue lost BMHP usage'; end if;
  if (select qty from public.stock where warehouse_id = wh and item_id = syr) is distinct from 2 then
    raise exception 'reissue moved BMHP stock'; end if;
  if (select coalesce(sum(l.credit),0) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.coa_accounts a on a.id = l.account_id
      where e.source = 'klinik-hpp-void' and e.source_ref = no and a.code = '5101') is distinct from 5500 then
    raise exception 'void did not reverse BMHP HPP'; end if;

  -- 6) correction: unpaid invoice; removing the procedure row returns BMHP at historical cost
  inv2 := public.clinic_post_invoice('e6000000-0000-4000-8000-000000000002', 'k02-unpaid',
    hdr || jsonb_build_object('subtotal',105000,'total',105000,'paid_status','Belum Lunas'),
    jsonb_build_array(
      line || jsonb_build_object('prescription_item_id','e9000000-0000-4000-8000-000000000002'),
      jsonb_build_object('description','Obat K02','qty',1,'price',5000,'kind','obat','item_id','e8000000-0000-4000-8000-000000000004','unit','pcs','prescription_item_id','e9000000-0000-4000-8000-000000000005','recipe_id',null,'discount_percent',0)));
  select invoice_no into no from public.invoices where id = inv2;
  if (select qty from public.stock where warehouse_id = wh and item_id = kasa) is distinct from 18 then raise exception 'second BMHP issue wrong'; end if;
  -- keep the procedure (price change only): BMHP and HPP retained, no stock movement
  perform public.clinic_edit_invoice(inv2, 'k02-edit-keep',
    jsonb_build_object('subtotal',95000,'discount',0,'tax',0,'total',95000,'dp_amount',0,'paid_status','Belum Lunas','metode_bayar','Tunai','reason','Uji koreksi fiktif'),
    jsonb_build_array(
      line || jsonb_build_object('price',90000,'prescription_item_id','e9000000-0000-4000-8000-000000000002'),
      jsonb_build_object('description','Obat K02','qty',1,'price',5000,'kind','obat','item_id','e8000000-0000-4000-8000-000000000004','unit','pcs','prescription_item_id','e9000000-0000-4000-8000-000000000005','recipe_id',null,'discount_percent',0)));
  if (select hpp from public.invoice_items where invoice_id = inv2 and jenis = 'jasa') is distinct from 400
     or (select qty from public.stock where warehouse_id = wh and item_id = kasa) is distinct from 18 then
    raise exception 'correction did not retain BMHP of a kept procedure'; end if;
  if (select sum(l.debit) - sum(l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.coa_accounts a on a.id = l.account_id
      where e.source in ('klinik-hpp','klinik-hpp-edit') and e.source_ref = no and a.code = '5101') is distinct from 450 then
    raise exception 'net HPP after keep-correction is not medicine 50 + BMHP 400'; end if;
  -- remove the procedure: BMHP returns to stock, net HPP = medicine only
  perform public.clinic_edit_invoice(inv2, 'k02-edit-remove',
    jsonb_build_object('subtotal',5000,'discount',0,'tax',0,'total',5000,'dp_amount',0,'paid_status','Belum Lunas','metode_bayar','Tunai','reason','Uji hapus tindakan fiktif'),
    jsonb_build_array(jsonb_build_object('description','Obat K02','qty',1,'price',5000,'kind','obat','item_id','e8000000-0000-4000-8000-000000000004','unit','pcs','prescription_item_id','e9000000-0000-4000-8000-000000000005','recipe_id',null,'discount_percent',0)));
  if (select qty from public.stock where warehouse_id = wh and item_id = kasa) is distinct from 20 then
    raise exception 'removed procedure BMHP was not returned to stock'; end if;
  if (select sum(l.debit) - sum(l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.coa_accounts a on a.id = l.account_id
      where e.source in ('klinik-hpp','klinik-hpp-edit') and e.source_ref = no and a.code = '5101') is distinct from 50 then
    raise exception 'net HPP after removal still includes BMHP'; end if;
  -- the removed procedure cannot come back through correction (would skip issue)
  failed := false;
  begin
    perform public.clinic_edit_invoice(inv2, 'k02-edit-readd',
      jsonb_build_object('subtotal',105000,'discount',0,'tax',0,'total',105000,'dp_amount',0,'paid_status','Belum Lunas','metode_bayar','Tunai','reason','Uji tambah lagi'),
      jsonb_build_array(line || jsonb_build_object('prescription_item_id','e9000000-0000-4000-8000-000000000002'),
        jsonb_build_object('description','Obat K02','qty',1,'price',5000,'kind','obat','item_id','e8000000-0000-4000-8000-000000000004','unit','pcs','prescription_item_id','e9000000-0000-4000-8000-000000000005','recipe_id',null,'discount_percent',0)));
  exception when sqlstate 'P0001' then failed := position('BMHP_INVALID:' in sqlerrm) = 1; end;
  if not failed then raise exception 'BMHP procedure re-added through correction without stock issue'; end if;
end $$;

rollback;
