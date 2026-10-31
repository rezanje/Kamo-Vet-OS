-- Fictional fixtures only; disposable PostgreSQL runner (scripts/test-pos-sale-allocation-immutable-postgres.py).
-- pos_sale_allocation_immutable() guards both sale_payments and sale_payment_refunds.
-- The refund table has no sale_id column: its guard must answer with the business
-- message, never with "record old has no field sale_id". The sale_payments path
-- (correction gate, parent move, frozen snapshot) must behave exactly as before.
begin;
create function pg_temp.assert_ok(ok boolean, message text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Assertion failed: %', message;end if;
end$$;
-- Requires the exact rejection text and forbids the field-resolution error.
create function pg_temp.reject(statement text, message text, expected text) returns void language plpgsql as $$declare blocked boolean:=false;begin
 begin execute statement;exception when others then
  blocked:=true;
  if position('has no field' in sqlerrm)>0 or position(expected in sqlerrm)=0 then
   raise exception 'Wrong rejection for %: % (expected %)',message,sqlerrm,expected;end if;
 end;
 if not blocked then raise exception 'Expected rejection: %',message;end if;
end$$;

insert into auth.users(id,raw_user_meta_data) values
 ('e9100000-0000-4000-8000-000000000001','{"full_name":"Immutable owner"}');
update profiles set role='OWNER',is_active=true where id='e9100000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values('e9200000-0000-4000-8000-000000000001','IMMTEST','Immutable test','PETSHOP');
insert into user_branches(user_id,branch_id) values('e9100000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001');
insert into warehouses(id,branch_id,code,name,type) values('e9300000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','IMMWH','Immutable warehouse','RETAIL');
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values('e9400000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000001','petshop');
insert into items(id,code,name,unit,item_type) values('e9500000-0000-4000-8000-000000000001','IMMSERVICE','Immutable service','pcs','Jasa');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1151','Immutable cash','ASET','D',false),('1152','Immutable bank','ASET','D',false),
 ('4101','Sales','PENDAPATAN','K',false),('4102','Discount','PENDAPATAN','D',false),
 ('2201','VAT','LIABILITAS','K',false),('5101','COGS','BEBAN','D',false),('1301','Inventory','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values
 ('e9600000-0000-4000-8000-000000000001','Immutable cash','Kas','1151'),
 ('e9600000-0000-4000-8000-000000000002','Immutable bank','Bank','1152');
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','e9200000-0000-4000-8000-000000000001','e9600000-0000-4000-8000-000000000001'),
 ('Transfer','e9200000-0000-4000-8000-000000000001','e9600000-0000-4000-8000-000000000002');
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;

-- Real writers create every guarded row: checkout, finalization, return, correction.
set local role authenticated;
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
insert into sales(id,branch_id,no_struk,subtotal,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint) values
 ('e9700000-0000-4000-8000-000000000001','e9200000-0000-4000-8000-000000000001','IMM.RETURNED',100000,100000,'Split',100000,
  'e9100000-0000-4000-8000-000000000001','e9400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":20000},{"method":"Transfer","amount":80000}]','imm-returned',repeat('a',64)),
 ('e9700000-0000-4000-8000-000000000002','e9200000-0000-4000-8000-000000000001','IMM.CORRECT',100000,100000,'Tunai',100000,
  'e9100000-0000-4000-8000-000000000001','e9400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":100000}]','imm-correct',repeat('a',64));
insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values
 ('e9800000-0000-4000-8000-000000000001','e9700000-0000-4000-8000-000000000001','e9500000-0000-4000-8000-000000000001','Immutable service',2,50000,'pcs',1,0),
 ('e9800000-0000-4000-8000-000000000002','e9700000-0000-4000-8000-000000000002','e9500000-0000-4000-8000-000000000001','Immutable service',1,100000,'pcs',1,0);
select finalize_pos_sale('e9700000-0000-4000-8000-000000000001');
select finalize_pos_sale('e9700000-0000-4000-8000-000000000002');
select post_unit_return('sales','e9700000-0000-4000-8000-000000000001','imm-return-1',
 jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'dari','kasir'),
 jsonb_build_array(jsonb_build_object('source_line_id','e9800000-0000-4000-8000-000000000001','item_id','e9500000-0000-4000-8000-000000000001',
  'qty',1,'satuan','pcs','kondisi','baik')));
reset role;

select pg_temp.assert_ok((select count(*)=2 and sum(f.amount)=50000 from sale_payment_refunds f
 join sales_returns r on r.id=f.sales_return_id where r.sale_id='e9700000-0000-4000-8000-000000000001'),
 'fixture has two refund allocations on a live sales return');
create temp table imm_refunds_before on commit drop as select * from sale_payment_refunds;
create temp table imm_payments_before on commit drop as select * from sale_payments;

-- sale_payment_refunds: the reported defect. Run as the table owner (as on a local
-- replica), so only the trigger can refuse; RLS/grants already stop API callers.
select pg_temp.reject($q$delete from sale_payment_refunds where sales_return_id in
 (select id from sales_returns where sale_id='e9700000-0000-4000-8000-000000000001')$q$,
 'refund allocation delete while its sales return still exists','Snapshot alokasi pembayaran sudah tetap');
select pg_temp.reject($q$update sale_payment_refunds set amount=amount+1 where sales_return_id in
 (select id from sales_returns where sale_id='e9700000-0000-4000-8000-000000000001')$q$,
 'refund allocation update','Snapshot alokasi pembayaran sudah tetap');
-- Even with an open correction gate for the source sale, refunds stay frozen.
insert into sale_payment_correction_gate(transaction_id,backend_pid,sale_id)
 values(txid_current(),pg_backend_pid(),'e9700000-0000-4000-8000-000000000001');
select pg_temp.reject($q$delete from sale_payment_refunds where sales_return_id in
 (select id from sales_returns where sale_id='e9700000-0000-4000-8000-000000000001')$q$,
 'refund allocation delete under a correction gate','Snapshot alokasi pembayaran sudah tetap');
delete from sale_payment_correction_gate where sale_id='e9700000-0000-4000-8000-000000000001';
select pg_temp.assert_ok((select count(*) from (select * from sale_payment_refunds except select * from imm_refunds_before) d)=0
 and (select count(*) from sale_payment_refunds)=(select count(*) from imm_refunds_before),'refund allocations unchanged');

-- sale_payments without a gate: frozen exactly as before.
select pg_temp.reject($q$update sale_payments set amount=amount where sale_id='e9700000-0000-4000-8000-000000000002'$q$,
 'payment allocation update without gate','Snapshot alokasi pembayaran sudah tetap');
select pg_temp.reject($q$delete from sale_payments where sale_id='e9700000-0000-4000-8000-000000000002'$q$,
 'payment allocation delete without gate','Snapshot alokasi pembayaran sudah tetap');
-- sale_payments with a gate: same row may change, but never move to another sale.
insert into sale_payment_correction_gate(transaction_id,backend_pid,sale_id)
 values(txid_current(),pg_backend_pid(),'e9700000-0000-4000-8000-000000000002');
select pg_temp.reject($q$update sale_payments set sale_id='e9700000-0000-4000-8000-000000000001' where sale_id='e9700000-0000-4000-8000-000000000002'$q$,
 'gated payment allocation cannot change parent sale','Induk alokasi pembayaran tidak boleh dipindah');
-- The gate is per sale: the other sale stays frozen in the same transaction.
select pg_temp.reject($q$update sale_payments set amount=amount where sale_id='e9700000-0000-4000-8000-000000000001'$q$,
 'gate for one sale does not open another','Snapshot alokasi pembayaran sudah tetap');
savepoint gated_update;
update sale_payments set amount=amount where sale_id='e9700000-0000-4000-8000-000000000002';
rollback to savepoint gated_update;
delete from sale_payment_correction_gate where sale_id='e9700000-0000-4000-8000-000000000002';
select pg_temp.assert_ok((select count(*) from (select * from sale_payments except select * from imm_payments_before) d)=0
 and (select count(*) from sale_payments)=(select count(*) from imm_payments_before),'payment allocations unchanged');

-- The real OWNER correction RPC (gate -> delete -> insert) still succeeds end to end.
set local role authenticated;
select correct_pos_sale_payment('e9700000-0000-4000-8000-000000000002',0,'imm-correct-one','Kasir salah pilih metode',0,100000);
reset role;
select pg_temp.assert_ok((select count(*)=1 and min(method)='Transfer' and sum(amount)=100000 from sale_payments
 where sale_id='e9700000-0000-4000-8000-000000000002'),'correction replaced the allocation through the gate');
select pg_temp.assert_ok((select count(*)=0 from sale_payment_correction_gate),'correction gate closed after RPC');
select pg_temp.reject($q$delete from sale_payments where sale_id='e9700000-0000-4000-8000-000000000002'$q$,
 'corrected allocation frozen again after RPC','Snapshot alokasi pembayaran sudah tetap');

-- Parent-gone path unchanged: removing the sales return itself (owner level)
-- cascades to its refund allocations instead of failing on a missing field.
savepoint parent_gone;
delete from sales_returns where sale_id='e9700000-0000-4000-8000-000000000001';
select pg_temp.assert_ok((select count(*)=0 from sale_payment_refunds f join sale_payments p on p.id=f.sale_payment_id
 where p.sale_id='e9700000-0000-4000-8000-000000000001'),'refund allocations released by sales return cascade');
rollback to savepoint parent_gone;
rollback;
