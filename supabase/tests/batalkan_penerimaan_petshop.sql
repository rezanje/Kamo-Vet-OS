-- Batalkan penerimaan PETSHOP (migrasi 20261112300000): fictional fixtures in disposable PostgreSQL only; everything rolls back.
-- Aturan yang dibuktikan: pembatalan penerimaan = jurnal pembalik kas/bank -> Piutang Usaha, catatan tidak pernah dihapus, laci shift ikut,
-- stok/HPP/jurnal penjualan tidak disentuh, terima ulang (semua metode, split), batal penjualan untuk struk belum dibayar, hak Owner tidak terkunci.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;raise notice 'BP_PASS %',label;end$$;
create function pg_temp.reject(stmt text, expected text, label text) returns void language plpgsql as $$
declare failed boolean:=false;msg text;begin
 begin execute stmt;exception when others then failed:=true;msg:=sqlerrm;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
 if position(expected in msg)=0 then raise exception 'Unexpected rejection for %: %',label,msg;end if;
 raise notice 'BP_PASS %',label;
end$$;
create function pg_temp.sv(stmt text) returns text language plpgsql security definer as $$declare r text;begin execute stmt into r;return r;end$$;
create function pg_temp.as_(uid text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',uid,true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);end$$;

-- ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────
insert into auth.users(id,raw_user_meta_data) values
 ('bb100000-0000-4000-8000-000000000001','{"full_name":"BP owner"}'),('bb100000-0000-4000-8000-000000000002','{"full_name":"BP admin"}'),
 ('bb100000-0000-4000-8000-000000000003','{"full_name":"BP finance"}'),('bb100000-0000-4000-8000-000000000004','{"full_name":"BP cashier"}'),
 ('bb100000-0000-4000-8000-000000000005','{"full_name":"BP admin other branch"}'),('bb100000-0000-4000-8000-000000000006','{"full_name":"BP cashier two"}');
update profiles set role='OWNER',is_active=true where id='bb100000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id in('bb100000-0000-4000-8000-000000000002','bb100000-0000-4000-8000-000000000005');
update profiles set role='FINANCE',is_active=true where id='bb100000-0000-4000-8000-000000000003';
update profiles set role='STAFF',is_active=true where id in('bb100000-0000-4000-8000-000000000004','bb100000-0000-4000-8000-000000000006');
insert into role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,false),('FINANCE',false,false) on conflict(role) do update set all_branches=false;
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('bb200000-0000-4000-8000-000000000001','BPB1','BP satu','PETSHOP'),('bb200000-0000-4000-8000-000000000002','BPB2','BP dua','PETSHOP');
insert into user_branches(user_id,branch_id) values
 ('bb100000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001'),('bb100000-0000-4000-8000-000000000002','bb200000-0000-4000-8000-000000000001'),
 ('bb100000-0000-4000-8000-000000000003','bb200000-0000-4000-8000-000000000001'),('bb100000-0000-4000-8000-000000000004','bb200000-0000-4000-8000-000000000001'),
 ('bb100000-0000-4000-8000-000000000006','bb200000-0000-4000-8000-000000000001'),('bb100000-0000-4000-8000-000000000005','bb200000-0000-4000-8000-000000000002');
insert into warehouses(id,branch_id,code,name,type) values
 ('bb300000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001','BPWH','BP gudang','RETAIL'),
 ('bb300000-0000-4000-8000-000000000002','bb200000-0000-4000-8000-000000000001','BPON','BP online','ONLINE');
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values
 ('bb400000-0000-4000-8000-000000000001','BPSVC','BP jasa','pcs','Jasa',0,100000),('bb400000-0000-4000-8000-000000000002','BPGOOD','BP barang','pcs','Persediaan',3000,50000);
insert into item_units(item_id,unit,factor,sell_price,buy_price) values('bb400000-0000-4000-8000-000000000002','box',2,100000,6000);
insert into stock(warehouse_id,item_id,qty) values('bb300000-0000-4000-8000-000000000001','bb400000-0000-4000-8000-000000000002',100),('bb300000-0000-4000-8000-000000000002','bb400000-0000-4000-8000-000000000002',100);
insert into stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source) values
 ('bb300000-0000-4000-8000-000000000001','bb400000-0000-4000-8000-000000000002',100,100,3000,'manual'),('bb300000-0000-4000-8000-000000000002','bb400000-0000-4000-8000-000000000002',100,100,3000,'manual');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1111','BP kas','ASET','D',false),('1112','BP bank transfer','ASET','D',false),('1113','BP debit','ASET','D',false),('1114','BP kredit','ASET','D',false),
 ('1115','BP qris','ASET','D',false),('1116','BP ewallet','ASET','D',false),('150001','Piutang Usaha','ASET','D',false),('130009','Piutang Marketplace','ASET','D',false),
 ('510001','Pendapatan','PENDAPATAN','K',false),('520002','Diskon','PENDAPATAN','D',false),('312005','PPN','LIABILITAS','K',false),('600001','HPP','BEBAN','D',false),
 ('170001','Persediaan','ASET','D',false),('810004','Pendapatan lain','PENDAPATAN','K',false),('740020','Komisi marketplace','BEBAN','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values
 ('bb500000-0000-4000-8000-000000000001','BP kas','Kas','1111'),('bb500000-0000-4000-8000-000000000002','BP transfer','Bank','1112'),('bb500000-0000-4000-8000-000000000003','BP debit','Bank','1113'),
 ('bb500000-0000-4000-8000-000000000004','BP kredit','Bank','1114'),('bb500000-0000-4000-8000-000000000005','BP qris','Bank','1115'),('bb500000-0000-4000-8000-000000000006','BP ewallet','Bank','1116');
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','bb200000-0000-4000-8000-000000000001','bb500000-0000-4000-8000-000000000001'),('Transfer','bb200000-0000-4000-8000-000000000001','bb500000-0000-4000-8000-000000000002'),
 ('Debit','bb200000-0000-4000-8000-000000000001','bb500000-0000-4000-8000-000000000003'),('Kredit','bb200000-0000-4000-8000-000000000001','bb500000-0000-4000-8000-000000000004'),
 ('QRIS','bb200000-0000-4000-8000-000000000001','bb500000-0000-4000-8000-000000000005'),('E-Wallet','bb200000-0000-4000-8000-000000000001','bb500000-0000-4000-8000-000000000006')
 on conflict do nothing;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;
-- Shifts: SA (kasir 4, dibuka dulu, nanti ditutup), SB (kasir 6), SC (kasir 4, dibuka sesudah SA ditutup). opened_at eksplisit agar urutan pasti.
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at) values
 ('bb600000-0000-4000-8000-00000000000a','bb200000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000004','petshop',50000,now()-interval '5 hours'),
 ('bb600000-0000-4000-8000-00000000000b','bb200000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000006','petshop',20000,now()-interval '3 hours');

create function pg_temp.mk(ref text,plan jsonb,shift uuid default 'bb600000-0000-4000-8000-00000000000a',stock boolean default false,cust uuid default null) returns uuid language plpgsql as $$
declare doc uuid;tot numeric;prev text:=current_setting('request.jwt.claim.sub',true);issued record;cashier uuid;begin
 select coalesce(sum((x->>'amount')::numeric),0) into tot from jsonb_array_elements(plan) x;
 select opened_by into cashier from public.cashier_shifts where id=shift;
 perform pg_temp.as_(cashier::text);
 insert into sales(branch_id,customer_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
  values('bb200000-0000-4000-8000-000000000001',cust,ref,tot,0,tot,case when jsonb_array_length(plan)>1 then 'Split' else plan->0->>'method' end,tot,0,case when cust is null then 0 else 10 end,cashier,shift,plan,'k:'||ref,repeat('a',64)) returning id into doc;
 if stock then
  select * into issued from sale_stock_out_fifo('bb300000-0000-4000-8000-000000000001','bb400000-0000-4000-8000-000000000002',2,'sale',ref);
  insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(doc,'bb400000-0000-4000-8000-000000000002','Barang',2,tot/2,'pcs',1,issued.cost);
 else insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(doc,'bb400000-0000-4000-8000-000000000001','Jasa',1,tot,'pcs',1,0);end if;
 perform finalize_pos_sale(doc);
 perform pg_temp.as_(prev);
 return doc;end$$;
create function pg_temp.sid(ref text) returns uuid language sql security definer as $$select id from public.sales where no_struk=$1$$;
create function pg_temp.net(ref text,code text) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
 where a.code=$2 and (e.source_ref=$1 or e.source_ref in(select id::text from public.pos_receipt_cancellations where sale_id=(select id from public.sales where no_struk=$1))
  or e.source_ref in(select id::text from public.sale_cancellations where sale_id=(select id from public.sales where no_struk=$1))
  or e.source_ref in(select id::text from public.online_disbursement_cancellations where sale_id=(select id from public.sales where no_struk=$1))
  or e.source_ref in(select id::text from public.sale_payment_corrections where sale_id=(select id from public.sales where no_struk=$1)))$$;
create function pg_temp.chain_zero(ref text) returns boolean language sql security definer as $$
 select not exists(select 1 from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
  where (e.source_ref=$1 or e.source_ref in(select id::text from public.pos_receipt_cancellations where sale_id=(select id from public.sales where no_struk=$1))
   or e.source_ref in(select id::text from public.sale_cancellations where sale_id=(select id from public.sales where no_struk=$1))
   or e.source_ref in(select id::text from public.sale_payment_corrections where sale_id=(select id from public.sales where no_struk=$1)))
  group by a.code having sum(l.debit-l.credit)<>0)$$;
create function pg_temp.frozen(ref text) returns text language sql security definer as $$
 select md5(coalesce((select (to_jsonb(s)-array['payment_plan','metode_bayar','revision','bayar','kembali'])::text from public.sales s where no_struk=$1),'')
  ||coalesce((select jsonb_agg(to_jsonb(i) order by i.id)::text from public.sale_items i join public.sales s on s.id=i.sale_id where s.no_struk=$1),'')
  ||coalesce((select jsonb_agg((to_jsonb(m)-'created_at') order by m.id)::text from public.stock_moves m where m.source_ref=$1),'')
  ||coalesce((select jsonb_agg(jsonb_build_array(e.source,l.debit,l.credit,a.code) order by e.source,a.code,l.debit,l.credit)::text from public.journal_entries e join public.journal_lines l on l.entry_id=e.id join public.coa_accounts a on a.id=l.account_id where e.source in('sale','sale-hpp') and e.source_ref=$1),'')
  ||(select coalesce(string_agg(qty_left::text,',' order by id),'') from public.stock_layers where item_id='bb400000-0000-4000-8000-000000000002')
  ||coalesce((select jsonb_agg(to_jsonb(l)-'created_at' order by l.id)::text from public.point_ledger l where l.ref=$1),''))$$;
create function pg_temp.counted(sh uuid,m text) returns numeric language sql security definer as $$
 select coalesce(sum(a),0) from(select p.amount a from public.sale_payments p join public.sales s on s.id=p.sale_id where p.method=$2 and s.voided_at is null and s.shift_id=$1 and s.payment_plan is not null and s.payments_finalized_at is not null
  union all select e.amount from public.sale_receipt_shift_effects e where e.shift_id=$1 and e.method=$2) z$$;
create function pg_temp.counted_sale(sh uuid,ref text,m text) returns numeric language sql security definer as $$
 select coalesce(sum(a),0) from(select p.amount a from public.sale_payments p join public.sales s on s.id=p.sale_id where p.method=$3 and s.voided_at is null and s.shift_id=$1 and s.no_struk=$2
  union all select e.amount from public.sale_receipt_shift_effects e join public.sales s on s.id=e.sale_id where e.shift_id=$1 and e.method=$3 and s.no_struk=$2) z$$;
create function pg_temp.close_shift(sh uuid) returns void language plpgsql security definer as $$
declare b jsonb;opn numeric;cx numeric;begin
 select jsonb_object_agg(m,pg_temp.counted(sh,m)) into b from unnest(array['Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet']) m;
 select opening_balance into opn from public.cashier_shifts where id=sh;
 select coalesce(sum(jumlah),0) into cx from public.expenses where shift_id=sh and metode_bayar='Tunai';
 update public.cashier_shifts set status='closed',closed_at=now(),expected_cash=round(opn+(b->>'Tunai')::numeric-cx,2),closing_breakdown=b where id=sh;end$$;
create function pg_temp.shift_row(sh uuid) returns text language sql security definer as $$select md5(to_jsonb(c)::text) from public.cashier_shifts c where id=$1$$;
create function pg_temp.balanced() returns boolean language sql security definer as $$
 select coalesce((select sum(debit-credit) from public.journal_lines),0)=0 and not exists(select 1 from public.journal_lines group by entry_id having sum(debit-credit)<>0)$$;
create function pg_temp.rev(ref text) returns integer language sql security definer as $$select revision from public.sales where no_struk=$1$$;
create function pg_temp.cancel(ref text,key text,reason text default 'Salah input harga',rev integer default null) returns jsonb language sql as $$
 select cancel_pos_sale_receipt(pg_temp.sid(ref),coalesce(rev,pg_temp.rev(ref)),key,reason)$$;
create function pg_temp.receive(ref text,key text,plan jsonb,rev integer default null) returns jsonb language sql as $$
 select receive_pos_sale_payment(pg_temp.sid(ref),coalesce(rev,pg_temp.rev(ref)),key,plan)$$;
create temp table fz(ref text primary key,h text);
grant all on fz to public;

-- ── 0. objek baru ────────────────────────────────────────────────────────────────────────────────────
select pg_temp.ok(to_regclass('public.pos_receipt_cancellations') is not null and to_regclass('public.sale_receipt_shift_effects') is not null
 and to_regclass('public.online_disbursement_cancellations') is not null and to_regclass('public.receipt_cancel_requests') is not null
 and to_regprocedure('public.cancel_pos_sale_receipt(uuid,integer,text,text)') is not null and to_regprocedure('public.receive_pos_sale_payment(uuid,integer,text,jsonb)') is not null
 and to_regprocedure('public.cancel_online_disbursement(uuid,integer,text,text)') is not null,'objek baru ada (4 tabel + 3 RPC)');

-- sales for phase 1 (shift SA open, kasir 4)
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BP.A1','[{"method":"Tunai","amount":100000}]');
select pg_temp.mk('BP.B1','[{"method":"Tunai","amount":30000},{"method":"Transfer","amount":50000},{"method":"QRIS","amount":20000}]');
select pg_temp.mk('BP.M1','[{"method":"Tunai","amount":100000}]');select pg_temp.mk('BP.M2','[{"method":"Transfer","amount":100000}]');
select pg_temp.mk('BP.M3','[{"method":"Debit","amount":100000}]');select pg_temp.mk('BP.M4','[{"method":"Kredit","amount":100000}]');
select pg_temp.mk('BP.M5','[{"method":"QRIS","amount":100000}]');select pg_temp.mk('BP.M6','[{"method":"E-Wallet","amount":100000}]');
select pg_temp.mk('BP.C1','[{"method":"Tunai","amount":60000},{"method":"QRIS","amount":40000}]');
select pg_temp.mk('BP.C2','[{"method":"Tunai","amount":100000}]');
select pg_temp.mk('BP.C3','[{"method":"QRIS","amount":100000}]');
insert into customers(id,name,phone,points) values('bb700000-0000-4000-8000-000000000001','BP pelanggan','000-BP-001',0);
select pg_temp.mk('BP.D1','[{"method":"Tunai","amount":100000}]','bb600000-0000-4000-8000-00000000000a',true,'bb700000-0000-4000-8000-000000000001');
select pg_temp.mk('BP.D2','[{"method":"Tunai","amount":100000}]','bb600000-0000-4000-8000-00000000000a',true);
select pg_temp.mk('BP.J1','[{"method":"Tunai","amount":30000},{"method":"Transfer","amount":70000}]');
select pg_temp.mk('BP.R1','[{"method":"Tunai","amount":100000}]','bb600000-0000-4000-8000-00000000000a',true);
-- struk ber-fee merchant (QRIS 1%): total 100000 = barang 99009.90 + fee 990.10
insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,merchant_fee_total)
 values('bb200000-0000-4000-8000-000000000001','BP.FEE',99009.90,0,100000,'QRIS',100000,0,'bb100000-0000-4000-8000-000000000004','bb600000-0000-4000-8000-00000000000a',
 '[{"method":"QRIS","amount":100000,"fee_percent":1,"fee_amount":990.10}]','k:BP.FEE',repeat('a',64),990.10);
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) select id,'bb400000-0000-4000-8000-000000000001','Jasa',1,99009.90,'pcs',1,0 from sales where no_struk='BP.FEE';
select finalize_pos_sale(pg_temp.sid('BP.FEE'));
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.ok(pg_temp.net('BP.A1','1111')=100000 and pg_temp.net('BP.A1','510001')=-100000,'awal: struk tunai mendebit kas dan mengkredit pendapatan');
select pg_temp.ok(pg_temp.balanced(),'awal: neraca saldo nol');

-- ── 1. Owner membatalkan penerimaan struk tunai (shift terbuka) ───────────────────────────────────────
insert into fz select 'BP.A1',pg_temp.frozen('BP.A1');
select pg_temp.cancel('BP.A1','k-a1');
select pg_temp.ok((select unpaid from (select (pg_temp.cancel('BP.A1','k-a1')->>'unpaid')::boolean unpaid) x),'pembatalan menjawab: belum dibayar');
select pg_temp.ok(pg_temp.frozen('BP.A1')=(select h from fz where ref='BP.A1'),'stok, HPP, jurnal penjualan, baris struk, poin TIDAK berubah oleh pembatalan penerimaan');
select pg_temp.ok(pg_temp.net('BP.A1','1111')=0 and pg_temp.net('BP.A1','150001')=100000 and pg_temp.net('BP.A1','510001')=-100000,'uang hilang dari kas: kas 0, Piutang Usaha 100000, pendapatan tetap');
select pg_temp.ok((select revision=0 and voided_at is null and payments_finalized_at is not null from sales where no_struk='BP.A1'),'header struk tidak diubah (revisi 0, tidak void)');
select pg_temp.ok((select count(*)=1 and min(reason)='Salah input harga' and min(created_by::text)='bb100000-0000-4000-8000-000000000001' and bool_and(closed_at is null)
   and min(source_shift_status)='open' and bool_and(effect_shift_id='bb600000-0000-4000-8000-00000000000a') from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.A1')),'catatan: alasan, pelaku, status shift asal, shift efek');
select pg_temp.ok((select (before_sale->>'total')::numeric=100000 and jsonb_array_length(before_payments)=1 and before_payments->0->>'method'='Tunai' from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.A1')),'catatan memuat foto struk dan penerimaan lama');
select pg_temp.ok((select count(*)=1 and sum(amount)=-100000 and min(method)='Tunai' and min(kind)='batal' and min(shift_id::text)='bb600000-0000-4000-8000-00000000000a' from sale_receipt_shift_effects where sale_id=pg_temp.sid('BP.A1')),'laci shift terbuka: efek -100000 tunai di shift asal');
select pg_temp.ok(pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000a','BP.A1','Tunai')=0,'laci: struk ini kini menyumbang 0 tunai di shift');
select pg_temp.ok((select count(*)=1 from journal_entries where source='sale-receipt-cancel' and source_ref in(select id::text from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.A1'))),'satu jurnal pembalik, ulangan kunci sama tidak menambah');
select pg_temp.reject($q$select pg_temp.cancel('BP.A1','k-a1','alasan lain')$q$,'Kunci permintaan sudah dipakai','kunci sama isian beda ditolak');
select pg_temp.reject($q$select pg_temp.cancel('BP.A1','k-a1b')$q$,'sudah dibatalkan','pembatalan ganda (kunci baru) ditolak dengan petunjuk');
select pg_temp.reject($q$select pg_temp.cancel('BP.M1','k-short','ab')$q$,'alasan minimal 3 huruf','alasan wajib');
select pg_temp.reject($q$select pg_temp.cancel('BP.M1','k-rev','Salah',5)$q$,'sudah berubah','revisi basi ditolak');
select pg_temp.ok(pg_temp.balanced(),'neraca saldo nol setelah pembatalan');

-- ── 2. terima pembayaran lagi (rencana sama) ───────────────────────────────────────────────────────────
select pg_temp.receive('BP.A1','k-a1r','[{"method":"Tunai","amount":100000}]');
select pg_temp.ok((pg_temp.receive('BP.A1','k-a1r','[{"method":"Tunai","amount":100000}]')->>'unpaid')::boolean=false,'ulangan kunci sama menjawab sama');
select pg_temp.ok(pg_temp.net('BP.A1','1111')=100000 and pg_temp.net('BP.A1','150001')=0,'terima ulang: kas kembali, Piutang Usaha 0');
select pg_temp.ok((select revision=0 from sales where no_struk='BP.A1') and pg_temp.frozen('BP.A1')=(select h from fz where ref='BP.A1'),'rencana sama: header, stok, HPP tetap persis');
select pg_temp.ok(pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000a','BP.A1','Tunai')=100000,'laci: setelah terima ulang struk kembali menyumbang 100000 tunai');
select pg_temp.ok((select closed_kind='diterima-ulang' and closed_by is not null and receive_journal_id is not null from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.A1')),'catatan ditutup: diterima ulang');
select pg_temp.reject($q$select pg_temp.receive('BP.A1','k-a1r2','[{"method":"Tunai","amount":100000}]')$q$,'sudah dibayar','terima ulang ganda ditolak');
select pg_temp.ok(pg_temp.balanced(),'neraca saldo nol setelah terima ulang');
-- siklus kedua + ganti metode ke QRIS
select pg_temp.cancel('BP.A1','k-a1c2','Pelanggan bayar QRIS');
select pg_temp.receive('BP.A1','k-a1r3','[{"method":"QRIS","amount":100000}]');
select pg_temp.ok((select metode_bayar='QRIS' and revision=1 and bayar=100000 and kembali=0 and payment_plan->0->>'method'='QRIS' from sales where no_struk='BP.A1'),'ganti metode: header metode, rencana, revisi+1');
select pg_temp.ok((select count(*)=1 and min(method)='QRIS' and min(coa_code)='1115' and min(amount)=100000 from sale_payments where sale_id=pg_temp.sid('BP.A1')),'alokasi baru QRIS ke akun peta 1115');
select pg_temp.ok(pg_temp.net('BP.A1','1111')=0 and pg_temp.net('BP.A1','1115')=100000 and pg_temp.net('BP.A1','150001')=0,'buku besar: kas 0, QRIS 100000, piutang 0');
select pg_temp.ok(pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000a','BP.A1','Tunai')=0 and pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000a','BP.A1','QRIS')=100000,'laci: tunai 0, QRIS 100000');
select pg_temp.ok((select count(*)=2 from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.A1') and closed_at is not null),'dua siklus tercatat, tidak ada baris dihapus');
-- siklus ketiga: split Tunai+Transfer
select pg_temp.cancel('BP.A1','k-a1c3','Dipisah dua metode');
select pg_temp.ok(pg_temp.net('BP.A1','1115')=0 and pg_temp.net('BP.A1','150001')=100000,'batal ke-3: QRIS dibalik');
-- validasi terima ulang (struk tetap belum dibayar sesudah tiap penolakan)
select pg_temp.reject($q$select pg_temp.receive('BP.A1','v1','[{"method":"Tunai","amount":50000}]')$q$,'jumlahnya sama dengan total','kurang dari total ditolak');
select pg_temp.reject($q$select pg_temp.receive('BP.A1','v2','[{"method":"Tunai","amount":60000},{"method":"Transfer","amount":60000}]')$q$,'jumlahnya sama dengan total','lebih dari total ditolak');
select pg_temp.reject($q$select pg_temp.receive('BP.A1','v3','[{"method":"Tunai","amount":50000},{"method":"Tunai","amount":50000}]')$q$,'metode berbeda','metode ganda ditolak');
select pg_temp.reject($q$select pg_temp.receive('BP.A1','v4','[{"method":"Tunai","amount":0},{"method":"Transfer","amount":100000}]')$q$,'positif','jumlah nol ditolak');
select pg_temp.reject($q$select pg_temp.receive('BP.A1','v5','[{"method":"Tunai","amount":-1},{"method":"Transfer","amount":100001}]')$q$,'positif','jumlah negatif ditolak');
select pg_temp.reject($q$select pg_temp.receive('BP.A1','v6','[{"method":"Bitcoin","amount":100000}]')$q$,'metode berbeda','metode tak dikenal ditolak');
select pg_temp.reject($q$select pg_temp.receive('BP.A1','v7','[{"method":"Tunai","amount":33333.333},{"method":"Transfer","amount":66666.667}]')$q$,'positif','sub-sen ditolak');
select pg_temp.reject($q$select pg_temp.receive('BP.A1','v8','[{"method":"Tunai","amount":10000},{"method":"Transfer","amount":10000},{"method":"Debit","amount":10000},{"method":"Kredit","amount":10000},{"method":"QRIS","amount":10000},{"method":"E-Wallet","amount":10000},{"method":"Tunai","amount":40000}]')$q$,'1 sampai 6 metode','7 bagian ditolak');
select pg_temp.reject($q$select pg_temp.receive('BP.A1','v9','{"method":"Tunai"}'::jsonb)$q$,'tidak valid','bukan array ditolak');
select pg_temp.reject($q$select pg_temp.receive('BP.A1','v10','[{"method":"Tunai","amount":"100000"}]')$q$,'tidak valid','jumlah bukan angka ditolak');
select pg_temp.ok((select count(*)=1 from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.A1') and closed_at is null) and pg_temp.net('BP.A1','150001')=100000,'sesudah semua penolakan: tetap belum dibayar, tidak ada jurnal tambahan');
select pg_temp.receive('BP.A1','k-a1r4','[{"method":"Tunai","amount":25000},{"method":"Transfer","amount":75000}]');
select pg_temp.ok((select metode_bayar='Split' and revision=2 and jsonb_array_length(payment_plan)=2 from sales where no_struk='BP.A1')
   and (select count(*)=2 and sum(amount)=100000 from sale_payments where sale_id=pg_temp.sid('BP.A1')),'split baru: dua alokasi, metode Split, revisi 2');
select pg_temp.ok(pg_temp.net('BP.A1','1111')=25000 and pg_temp.net('BP.A1','1112')=75000 and pg_temp.net('BP.A1','150001')=0,'buku besar split baru');
select pg_temp.ok(pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000a','BP.A1','Tunai')=25000 and pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000a','BP.A1','Transfer')=75000 and pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000a','BP.A1','QRIS')=0,'laci: persis rencana baru');
select pg_temp.ok(pg_temp.frozen('BP.A1')=(select h from fz where ref='BP.A1'),'tiga siklus: stok, HPP, jurnal penjualan tetap persis');

-- ── 3. split dibatalkan sebagai satu set ────────────────────────────────────────────────────────────
select pg_temp.cancel('BP.B1','k-b1','Salah hitung');
select pg_temp.ok(pg_temp.net('BP.B1','1111')=0 and pg_temp.net('BP.B1','1112')=0 and pg_temp.net('BP.B1','1115')=0 and pg_temp.net('BP.B1','150001')=100000,'split: semua bagian dibalik sekaligus ke Piutang Usaha 100000');
select pg_temp.ok((select count(*)=3 and sum(amount)=-100000 from sale_receipt_shift_effects where sale_id=pg_temp.sid('BP.B1')),'split: tiga efek laci (satu per metode)');
select pg_temp.ok((select jsonb_array_length(before_payments)=3 from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.B1')),'split: foto penerimaan lama memuat 3 bagian');
select pg_temp.receive('BP.B1','k-b1r','[{"method":"Tunai","amount":30000},{"method":"Transfer","amount":50000},{"method":"QRIS","amount":20000}]');
select pg_temp.ok(pg_temp.net('BP.B1','1111')=30000 and pg_temp.net('BP.B1','1112')=50000 and pg_temp.net('BP.B1','1115')=20000 and pg_temp.net('BP.B1','150001')=0,'split terima ulang sama: buku besar persis');

-- ── 4. keenam metode ─────────────────────────────────────────────────────────────────────────────────
select pg_temp.cancel('BP.M'||i,'k-m'||i) from generate_series(1,6) i;
select pg_temp.ok((select count(*)=6 from pos_receipt_cancellations where sale_id in(select id from sales where no_struk like 'BP.M_')),'enam metode: semua dapat dibatalkan');
select pg_temp.ok(pg_temp.net('BP.M1','1111')=0 and pg_temp.net('BP.M2','1112')=0 and pg_temp.net('BP.M3','1113')=0 and pg_temp.net('BP.M4','1114')=0 and pg_temp.net('BP.M5','1115')=0 and pg_temp.net('BP.M6','1116')=0,'enam metode: akun masing-masing kembali 0');
select pg_temp.ok((select sum(net) from(select pg_temp.net('BP.M'||i,'150001') net from generate_series(1,6) i) x)=600000,'enam metode: Piutang Usaha 600000');
select pg_temp.receive('BP.M'||i,'k-mr'||i,jsonb_build_array(jsonb_build_object('method',(array['Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet'])[i],'amount',100000))) from generate_series(1,6) i;
select pg_temp.ok((select sum(net) from(select pg_temp.net('BP.M'||i,'150001') net from generate_series(1,6) i) x)=0 and pg_temp.balanced(),'enam metode: terima ulang menutup piutang, neraca nol');

-- ── 5. penolakan sebelum pembatalan (petunjuk jelas) ───────────────────────────────────────────────────
select pg_temp.reject($q$select pg_temp.cancel('BP.FEE','k-fee')$q$,'fee merchant','struk ber-fee ditolak dengan petunjuk');
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select post_unit_return('sales',pg_temp.sid('BP.R1'),'ret-r1',jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'dari','kasir'),
 jsonb_build_array(jsonb_build_object('source_line_id',(select i.id from sale_items i where i.sale_id=pg_temp.sid('BP.R1')),'item_id','bb400000-0000-4000-8000-000000000002','qty',2,'satuan','pcs','kondisi','baik')));
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select pg_temp.cancel('BP.R1','k-r1')$q$,'retur/refund','struk yang sudah diretur ditolak: batalkan retur dulu');
select pg_temp.reject($q$select cancel_pos_sale_receipt(gen_random_uuid(),0,'k-none','alasan jelas')$q$,'tidak ditemukan','struk tak ada ditolak');

-- ── 6. struk belum dibayar tidak boleh diretur / dikoreksi metode ─────────────────────────────────────────
select pg_temp.cancel('BP.J1','k-j1','Tes koreksi');
select pg_temp.reject($q$select correct_pos_sale_payment(pg_temp.sid('BP.J1'),0,'j02-x','Koreksi metode',50000,50000)$q$,'sedang dibatalkan','koreksi metode J02 ditolak saat belum dibayar');
select pg_temp.reject($q$insert into sales_returns(no_retur,sale_id,tanggal,total) values('RET-BP-X',pg_temp.sid('BP.J1'),current_date,1)$q$,'sedang dibatalkan','retur ditolak saat belum dibayar');
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$select post_unit_return('sales',pg_temp.sid('BP.J1'),'ret-j1',jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'dari','kasir'),jsonb_build_array(jsonb_build_object('source_line_id',(select i.id from sale_items i where i.sale_id=pg_temp.sid('BP.J1')),'item_id','bb400000-0000-4000-8000-000000000001','qty',1,'satuan','pcs','kondisi','baik')))$q$,'sedang dibatalkan','retur lewat kasir ditolak saat belum dibayar');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.receive('BP.J1','k-j1r','[{"method":"Tunai","amount":30000},{"method":"Transfer","amount":70000}]');
select pg_temp.ok((select count(*)=0 from sale_payment_corrections where sale_id=pg_temp.sid('BP.J1')),'koreksi J02 gagal tidak meninggalkan jejak');
-- J02 tetap berjalan untuk struk biasa yang belum pernah dibatalkan (tak berubah) lalu penerimaan boleh dibatalkan sesudahnya

-- ── 7. struk belum dibayar boleh dibatalkan sebagai penjualan (shift terbuka) ───────────────────────────
insert into fz select 'BP.D1',pg_temp.frozen('BP.D1');
select pg_temp.ok((select points=10 from customers where id='bb700000-0000-4000-8000-000000000001'),'poin pelanggan awal 10');
select pg_temp.cancel('BP.D1','k-d1','Barang salah');
select pg_temp.ok(pg_temp.frozen('BP.D1')=(select h from fz where ref='BP.D1'),'D1: stok/HPP/poin tak berubah oleh pembatalan penerimaan');
select cancel_posted_sale(pg_temp.sid('BP.D1'),0,'void-d1','Batal sekalian ganti barang');
select pg_temp.ok((select voided_at is not null from sales where no_struk='BP.D1') and pg_temp.chain_zero('BP.D1'),'D1: batal penjualan struk belum dibayar: SEMUA akun rantai jurnal bersih nol');
select pg_temp.ok((select count(*)=1 from journal_entries where source='sale-void-receipt') and (select count(*)=1 from journal_entries where source='sale-void'),'D1: pembalik penerimaan dan pembalik penjualan tercatat');
select pg_temp.ok((select closed_kind='penjualan-dibatalkan' from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.D1')),'D1: catatan ditutup sebagai penjualan dibatalkan');
select pg_temp.ok(pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000a','BP.D1','Tunai')=0,'D1: laci shift terbuka netral setelah batal (efek +/-)');
select pg_temp.ok((select points=0 from customers where id='bb700000-0000-4000-8000-000000000001'),'D1: poin kembali 0');
select pg_temp.ok((cancel_posted_sale(pg_temp.sid('BP.D1'),0,'void-d1','Batal sekalian ganti barang')->>'voided')::boolean,'D1: ulangan kunci batal penjualan menjawab sama');
select pg_temp.reject($q$select pg_temp.receive('BP.D1','k-d1r','[{"method":"Tunai","amount":100000}]')$q$,'sudah dibatalkan','struk yang sudah dibatalkan tak bisa diterima ulang');
select pg_temp.ok(pg_temp.balanced(),'neraca saldo nol setelah batal struk belum dibayar');

-- ── 8. shift tertutup: angka tutup tidak disentuh, koreksi di shift terbuka ───────────────────────────────
select pg_temp.close_shift('bb600000-0000-4000-8000-00000000000a');
-- MITIGASI_1111 R2: SC dibuka oleh PELAKU (Owner): efek struk bershift-tutup hanya jatuh di shift terbuka milik pelaku.
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at) values
 ('bb600000-0000-4000-8000-00000000000c','bb200000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001','petshop',10000,now()-interval '1 hour');
select pg_temp.ok((select status='closed' from cashier_shifts where id='bb600000-0000-4000-8000-00000000000a'),'SA ditutup');
select pg_temp.ok((select (before_sale->>'shift_id')::text='bb600000-0000-4000-8000-00000000000a' from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.A1') limit 1),'foto sebelumnya memuat shift asal SA');
insert into fz values('SA',pg_temp.shift_row('bb600000-0000-4000-8000-00000000000a'));
insert into fz select 'BP.C1',pg_temp.frozen('BP.C1');
select pg_temp.ok((pg_temp.cancel('BP.C1','k-c1','Salah nominal')->>'effect_in_other_shift')::boolean,'C1 (shift tertutup): efek dicatat di shift LAIN dan dilaporkan');
select pg_temp.ok(pg_temp.shift_row('bb600000-0000-4000-8000-00000000000a')=(select h from fz where ref='SA'),'shift tertutup SA: baris (angka tutup, selisih, status) tidak berubah sama sekali');
select pg_temp.ok((select source_shift_status='closed' and effect_shift_id='bb600000-0000-4000-8000-00000000000c' from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.C1')),'catatan: status shift asal closed, efek di shift terbuka terbaru SC');
select pg_temp.ok((select sum(amount) filter(where method='Tunai')=-60000 and sum(amount) filter(where method='QRIS')=-40000 and count(*)=2 and bool_and(shift_id='bb600000-0000-4000-8000-00000000000c') from sale_receipt_shift_effects where sale_id=pg_temp.sid('BP.C1')),'efek laci SC: tunai -60000, QRIS -40000');
select pg_temp.ok(pg_temp.frozen('BP.C1')=(select h from fz where ref='BP.C1'),'C1: stok/HPP/jurnal penjualan tetap');
-- tutup SC dengan angka yang mengabaikan efek ditolak; dengan efek diterima
select pg_temp.reject($q$update cashier_shifts set status='closed',expected_cash=10000,closing_breakdown='{"Tunai":0,"Transfer":0,"Debit":0,"Kredit":0,"QRIS":0,"E-Wallet":0}' where id='bb600000-0000-4000-8000-00000000000c'$q$,'Pembayaran shift berubah','tutup shift dengan angka basi (tanpa efek) ditolak');
select pg_temp.close_shift('bb600000-0000-4000-8000-00000000000c');
select pg_temp.ok((select status='closed' and expected_cash=10000-60000 and (closing_breakdown->>'QRIS')::numeric=-40000 from cashier_shifts where id='bb600000-0000-4000-8000-00000000000c'),'SC ditutup dengan efek (tunai -60000 dikembalikan dari laci hari itu)');
update cashier_shifts set status='open',closed_at=null where id='bb600000-0000-4000-8000-00000000000c';
-- terima ulang (struk SA tertutup): uang baru masuk shift terbuka
select pg_temp.receive('BP.C1','k-c1r','[{"method":"Transfer","amount":100000}]');
select pg_temp.ok((select sum(amount) filter(where kind='terima')=100000 and bool_and(shift_id='bb600000-0000-4000-8000-00000000000c') from sale_receipt_shift_effects where sale_id=pg_temp.sid('BP.C1') and kind='terima'),'C1 terima ulang: +100000 transfer di shift terbuka SC');
select pg_temp.ok(pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000c','BP.C1','Tunai')=-60000 and pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000c','BP.C1','Transfer')=100000 and pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000c','BP.C1','QRIS')=-40000,'C1: laci SC mencerminkan uang nyata (tunai dikembalikan, QRIS dikembalikan, transfer diterima)');
select pg_temp.ok(pg_temp.shift_row('bb600000-0000-4000-8000-00000000000a')=(select h from fz where ref='SA'),'SA masih tidak tersentuh setelah terima ulang');
select pg_temp.ok(pg_temp.net('BP.C1','1112')=100000 and pg_temp.net('BP.C1','1111')=0 and pg_temp.net('BP.C1','1115')=0 and pg_temp.net('BP.C1','150001')=0,'C1: buku besar mengikuti metode baru');
-- tanpa shift terbuka: tunai ditolak, non-tunai boleh tanpa efek laci
select pg_temp.close_shift('bb600000-0000-4000-8000-00000000000b'),pg_temp.close_shift('bb600000-0000-4000-8000-00000000000c');
-- MITIGASI_1111 R2: pelaku tanpa shift terbuka TIDAK ditolak lagi (Owner tidak dikunci): ditandai tanpa_shift, tidak menyentuh laci siapa pun.
select pg_temp.ok((pg_temp.cancel('BP.C2','k-c2')->>'shift_mode')='tanpa_shift','tunai tanpa shift terbuka pelaku: boleh, ditandai tanpa_shift (tidak ditolak)');
select pg_temp.ok((select count(*)=1 and min(shift_mode)='tanpa_shift' and min(effect_shift_id::text) is null from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.C2')) and (select count(*)=0 from sale_receipt_shift_effects where sale_id=pg_temp.sid('BP.C2')) and pg_temp.balanced(),'tanpa_shift: catatan ada, tidak ada efek laci, neraca nol');
select pg_temp.ok((pg_temp.cancel('BP.C3','k-c3')->>'effect_shift_id') is null,'QRIS saja tanpa shift terbuka: boleh, tanpa efek laci');
select pg_temp.ok((select count(*)=0 from sale_receipt_shift_effects where sale_id=pg_temp.sid('BP.C3')),'tanpa efek laci tercatat');
-- MITIGASI_1111 R2: terima ulang TUNAI tanpa shift pelaku: ditandai tanpa_shift (struk C2 yang tadi dibatalkan tanpa shift), laci tak tersentuh.
select pg_temp.ok((pg_temp.receive('BP.C2','k-c2-cash','[{"method":"Tunai","amount":100000}]')->>'shift_mode')='tanpa_shift','terima ulang TUNAI tanpa shift pelaku: boleh, ditandai tanpa_shift');
select pg_temp.ok((select closed_kind='diterima-ulang' and receive_effect_shift_id is null from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.C2')) and (select count(*)=0 from sale_receipt_shift_effects where sale_id=pg_temp.sid('BP.C2')) and pg_temp.balanced(),'C2 dibayar lagi tanpa efek laci, neraca nol');
update cashier_shifts set status='open',closed_at=null where id in('bb600000-0000-4000-8000-00000000000b','bb600000-0000-4000-8000-00000000000c');
select pg_temp.receive('BP.C3','k-c3r','[{"method":"QRIS","amount":100000}]');
select pg_temp.ok(pg_temp.net('BP.C3','150001')=0 and pg_temp.balanced(),'C3 terima ulang menutup piutang');
-- batal penjualan struk belum dibayar di shift TERTUTUP (D2): diizinkan karena uang sudah dikembalikan
select pg_temp.cancel('BP.D2','k-d2','Pelanggan batal beli');
select pg_temp.reject($q$select cancel_posted_sale(pg_temp.sid('BP.A1'),pg_temp.rev('BP.A1'),'void-a1-paid','coba tertutup')$q$,'Shift penjualan sudah ditutup','struk TERBAYAR di shift tertutup tetap ditolak seperti dulu (perilaku lama)');
select cancel_posted_sale(pg_temp.sid('BP.D2'),0,'void-d2','Batal total');
select pg_temp.ok((select voided_at is not null from sales where no_struk='BP.D2') and pg_temp.chain_zero('BP.D2'),'D2 (shift tertutup, belum dibayar): batal penjualan berhasil, rantai jurnal bersih');
select pg_temp.ok(pg_temp.shift_row('bb600000-0000-4000-8000-00000000000a')=(select h from fz where ref='SA'),'SA tetap tak tersentuh setelah batal D2');
select pg_temp.ok((select sum(amount)=-100000 from sale_receipt_shift_effects where sale_id=pg_temp.sid('BP.D2')),'D2: pengembalian tunai Rp100.000 di laci SC tetap tercatat (uang nyata)');

-- ── 9. struk terbayar setelah siklus (ganti metode) lalu dibatalkan biasa (rantai penuh dibalik) ───────────
select pg_temp.mk('BP.F1','[{"method":"Tunai","amount":100000}]','bb600000-0000-4000-8000-00000000000c',true);
select pg_temp.cancel('BP.F1','k-f1','Ganti ke transfer');
select pg_temp.receive('BP.F1','k-f1r','[{"method":"Transfer","amount":100000}]');
select pg_temp.ok(pg_temp.net('BP.F1','1112')=100000 and pg_temp.net('BP.F1','1111')=0,'F1: sekarang dibayar transfer');
select cancel_posted_sale(pg_temp.sid('BP.F1'),pg_temp.rev('BP.F1'),'void-f1','Batal biasa setelah ganti metode');
select pg_temp.ok((select voided_at is not null from sales where no_struk='BP.F1') and pg_temp.chain_zero('BP.F1'),'F1: batal biasa setelah siklus: kas lama, bank baru, piutang, pendapatan, HPP SEMUA nol');
select pg_temp.ok(pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000c','BP.F1','Tunai')=0 and pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000c','BP.F1','Transfer')=0,'F1: laci SC nol');
select pg_temp.mk('BP.H1','[{"method":"Tunai","amount":100000}]','bb600000-0000-4000-8000-00000000000c',true);
select cancel_posted_sale(pg_temp.sid('BP.H1'),0,'void-h1','Batal biasa tanpa siklus');
select pg_temp.ok(pg_temp.chain_zero('BP.H1') and (select count(*)=0 from journal_entries where source='sale-void-receipt' and source_ref in(select id::text from sale_cancellations where sale_id=pg_temp.sid('BP.H1'))),'H1: batal biasa tanpa siklus berperilaku seperti dulu (tanpa jurnal penerimaan)');

-- ── 10. koreksi J02 lama tetap berjalan; sesudahnya pembatalan penerimaan memakai alokasi terkoreksi ───────────
select pg_temp.mk('BP.J2','[{"method":"Tunai","amount":30000},{"method":"Transfer","amount":70000}]','bb600000-0000-4000-8000-00000000000c');
select correct_pos_sale_payment(pg_temp.sid('BP.J2'),0,'j02-ok','Koreksi metode',50000,50000);
select pg_temp.ok((select count(*)=1 from sale_payment_corrections where sale_id=pg_temp.sid('BP.J2')),'J02 lama masih berjalan untuk struk biasa');
select pg_temp.cancel('BP.J2','k-j2','Batalkan setelah koreksi');
select pg_temp.ok(pg_temp.net('BP.J2','1111')=0 and pg_temp.net('BP.J2','1112')=0 and pg_temp.net('BP.J2','150001')=100000,'J2: pembatalan memakai alokasi hasil koreksi (50000/50000)');
select pg_temp.reject($q$select cancel_posted_sale(pg_temp.sid('BP.J2'),pg_temp.rev('BP.J2'),'void-j2','coba')$q$,'perlu rekonsiliasi','struk yang pernah dikoreksi metode tetap tidak bisa dibatalkan sebagai penjualan (aturan lama)');
select pg_temp.receive('BP.J2','k-j2r','[{"method":"Tunai","amount":100000}]');
select pg_temp.reject($q$select correct_pos_sale_payment(pg_temp.sid('BP.J2'),pg_temp.rev('BP.J2'),'j02-after','Koreksi lagi',50000,50000)$q$,'','J02 sesudah siklus gagal tertutup (jalur lama tidak dilonggarkan)');

-- ── 11. hak akses ─────────────────────────────────────────────────────────────────────────────────────
select pg_temp.mk('BP.G1','[{"method":"QRIS","amount":100000}]','bb600000-0000-4000-8000-00000000000c');
select pg_temp.mk('BP.G2','[{"method":"QRIS","amount":100000}]','bb600000-0000-4000-8000-00000000000c');
select pg_temp.mk('BP.G3','[{"method":"QRIS","amount":100000}]','bb600000-0000-4000-8000-00000000000c');
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$select pg_temp.cancel('BP.G1','k-g-staff')$q$,'tidak diizinkan','kasir (STAFF) ditolak');
select pg_temp.as_('bb100000-0000-4000-8000-000000000002');
select pg_temp.reject($q$select pg_temp.cancel('BP.G1','k-g-admin')$q$,'tidak diizinkan','ADMIN ditolak bawaan (mati)');
select pg_temp.as_('bb100000-0000-4000-8000-000000000003');
select pg_temp.reject($q$select pg_temp.cancel('BP.G1','k-g-fin')$q$,'tidak diizinkan','FINANCE ditolak bawaan');
select pg_temp.reject($q$select pg_temp.receive('BP.G1','k-g-fin2','[{"method":"QRIS","amount":100000}]')$q$,'tidak diizinkan','FINANCE ditolak menerima ulang');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(get_role_access_config('ADMIN')->'action_catalog') x where x->>'id'='penjualan.pos_penerimaan.batalkan'),'tindakan baru muncul di katalog Akses Grup (bisa dicentang Owner)');
select save_role_access_config('ADMIN',(get_role_access_config('ADMIN')->>'revision'),'bb900000-0000-4000-8000-000000000001','custom','["penjualan","kasir","pos"]'::jsonb,'{"all_branches":false,"create_accounts":false}'::jsonb,'Beri izin batalkan penerimaan','["penjualan.pos_penerimaan.batalkan"]'::jsonb);
select save_role_access_config('FINANCE',(get_role_access_config('FINANCE')->>'revision'),'bb900000-0000-4000-8000-000000000002','custom','["penjualan","kas-bank","pos"]'::jsonb,'{"all_branches":false,"create_accounts":false}'::jsonb,'Finance tanpa izin ini','["people.editKaryawan"]'::jsonb);
-- peran selain ADMIN/FINANCE (STAFF) tidak pernah boleh, sekalipun kebijakannya memuat tindakan ini secara eksplisit
select save_role_access_config('STAFF',(get_role_access_config('STAFF')->>'revision'),'bb900000-0000-4000-8000-000000000003','custom','["penjualan","kasir","pos"]'::jsonb,'{"all_branches":false,"create_accounts":false}'::jsonb,'Uji: STAFF diberi tindakan','["penjualan.pos_penerimaan.batalkan"]'::jsonb);
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$select pg_temp.cancel('BP.G1','k-g-staff2')$q$,'tidak diizinkan','STAFF dengan kebijakan eksplisit tetap ditolak (hanya Owner/ADMIN/FINANCE berizin)');
select pg_temp.ok(not public.pos_receipt_actor_allowed('bb200000-0000-4000-8000-000000000001') and public.role_action_allowed('penjualan.pos_penerimaan.batalkan'),'pos_receipt_actor_allowed: STAFF berkebijakan eksplisit = false padahal kebijakan umum mengizinkan (peran dikunci di fungsi ini)');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.as_('bb100000-0000-4000-8000-000000000002');
select pg_temp.ok((public.pos_receipt_actor_allowed('bb200000-0000-4000-8000-000000000001')),'ADMIN dengan kebijakan dicentang Owner: diizinkan di cabangnya');
select pg_temp.ok(not public.pos_receipt_actor_allowed('bb200000-0000-4000-8000-000000000002'),'ADMIN yang sama: ditolak di cabang lain (bukan miliknya)');
select pg_temp.as_('bb100000-0000-4000-8000-000000000005');
select pg_temp.reject($q$select pg_temp.cancel('BP.G1','k-g-admin2')$q$,'tidak diizinkan','ADMIN cabang lain ditolak');
select pg_temp.as_('bb100000-0000-4000-8000-000000000003');
select pg_temp.reject($q$select pg_temp.cancel('BP.G1','k-g-fin3')$q$,'tidak diizinkan','FINANCE dengan kebijakan tanpa tindakan ini ditolak');
select pg_temp.as_('bb100000-0000-4000-8000-000000000002');
select pg_temp.cancel('BP.G1','k-g-admin-ok','Admin dengan izin');
select pg_temp.ok((select created_by::text='bb100000-0000-4000-8000-000000000002' from pos_receipt_cancellations where sale_id=pg_temp.sid('BP.G1')),'ADMIN berizin: berhasil, pelaku tercatat');
select pg_temp.receive('BP.G1','k-g-admin-r','[{"method":"QRIS","amount":100000}]');
-- Owner tidak pernah terkunci: tabel kebijakan hilang/error -> Owner tetap boleh, ADMIN gagal tertutup
reset role;
alter table role_settings_private.action_policies rename to action_policies_x;
set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.ok(public.pos_receipt_actor_allowed('bb200000-0000-4000-8000-000000000001'),'OWNER tetap diizinkan walau tabel kebijakan tidak terbaca');
select pg_temp.cancel('BP.G2','k-g-owner-nopolicy');
select pg_temp.receive('BP.G2','k-g-owner-nopolicy-r','[{"method":"QRIS","amount":100000}]');
select pg_temp.as_('bb100000-0000-4000-8000-000000000002');
select pg_temp.ok(not public.pos_receipt_actor_allowed('bb200000-0000-4000-8000-000000000001'),'ADMIN gagal tertutup saat kebijakan tidak terbaca');
reset role;
alter table role_settings_private.action_policies_x rename to action_policies;
update profiles set is_active=false where id='bb100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select pg_temp.cancel('BP.G3','k-g-inactive')$q$,'tidak diizinkan','OWNER nonaktif ditolak');
reset role;update profiles set is_active=true where id='bb100000-0000-4000-8000-000000000001';set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');

-- ── 12. periode terkunci dan rekonsiliasi bank ───────────────────────────────────────────────────────────
reset role;update accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date;set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select pg_temp.cancel('BP.G3','k-lock')$q$,'pembatalan penerimaan hari ini tidak bisa dibukukan','periode akuntansi terkunci: pembatalan hari ini ditolak (pagar milik fungsi ini, bukan pagar hilir)');
reset role;update accounting_locks set closed_until=null;set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.cancel('BP.G3','k-lock2');
reset role;update accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date;set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select pg_temp.receive('BP.G3','k-lock-r','[{"method":"QRIS","amount":100000}]')$q$,'sudah ditutup; penerimaan hari ini tidak bisa dibukukan','periode terkunci: terima ulang hari ini ditolak (pagar milik fungsi ini)');
reset role;update accounting_locks set closed_until=null;set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.receive('BP.G3','k-lock-r2','[{"method":"QRIS","amount":100000}]');
select pg_temp.mk('BP.K1','[{"method":"Transfer","amount":100000}]','bb600000-0000-4000-8000-00000000000c');
reset role;
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code,created_by) values((now() at time zone 'Asia/Jakarta')::date,'bb500000-0000-4000-8000-000000000002','1112','bb100000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select pg_temp.cancel('BP.K1','k-rec')$q$,'Rekonsiliasi bank','rekonsiliasi bank yang mencakup rekening: ditolak');
reset role;delete from bank_reconciliations where bank_coa_code='1112';set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');

-- ── 13. audit dan kekekalan ─────────────────────────────────────────────────────────────────────────────
select pg_temp.ok((select count(*)>=10 from pos_receipt_cancellations),'catatan pembatalan terkumpul');
select pg_temp.reject($q$update pos_receipt_cancellations set reason='diubah' where true$q$,'permission denied','catatan tak bisa diubah (klien: tanpa hak tulis)');
reset role;
select pg_temp.reject($q$update pos_receipt_cancellations set reason='diubah'$q$,'tidak dapat diubah','catatan tak bisa diubah (bahkan pemilik basis data)');
select pg_temp.reject($q$delete from pos_receipt_cancellations$q$,'tidak dapat diubah','catatan tak bisa dihapus');
select pg_temp.reject($q$update pos_receipt_cancellations set closed_at=now(),closed_kind='diterima-ulang' where closed_at is not null$q$,'tidak dapat diubah','catatan yang sudah ditutup tak bisa diubah lagi');
select pg_temp.reject($q$delete from sale_receipt_shift_effects$q$,'tidak dapat diubah','efek laci tak bisa dihapus');
select pg_temp.reject($q$update sale_receipt_shift_effects set amount=1$q$,'tidak dapat diubah','efek laci tak bisa diubah');
select pg_temp.reject($q$update receipt_cancel_requests set op='cancel'$q$,'tidak dapat diubah','jejak kunci tak bisa diubah');
set local role authenticated;
select pg_temp.reject($q$insert into pos_receipt_cancellations(id,sale_id,branch_id,reason,before_sale,before_payments,reversal_journal_id,created_by) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'xxx','{}','[]',gen_random_uuid(),gen_random_uuid())$q$,'permission denied','klien tak bisa menulis langsung ke catatan');
select pg_temp.reject($q$insert into receipt_cancel_requests(actor_id,request_key,op,sale_id,payload,result) values(gen_random_uuid(),'x','cancel',gen_random_uuid(),'{}','{}')$q$,'permission denied','klien tak bisa menulis kunci permintaan');
select pg_temp.reject($q$select count(*) from receipt_cancel_requests$q$,'permission denied','klien tak bisa membaca tabel permintaan');
select pg_temp.reject($q$update journal_entries set deskripsi='diubah klien' where source='sale-receipt-cancel'$q$,'Jurnal pembayaran POS sudah tetap','jurnal pembatalan penerimaan dilindungi dari tulisan klien (pembayaran POS sudah tetap)');
select pg_temp.reject($q$delete from journal_lines where entry_id in(select id from journal_entries where source='sale-receipt-repost')$q$,'Jurnal pembayaran POS sudah tetap','jurnal terima ulang dilindungi dari penghapusan klien');
select pg_temp.as_('bb100000-0000-4000-8000-000000000005');
select pg_temp.ok((select count(*)=0 from pos_receipt_cancellations),'ADMIN cabang lain tidak melihat catatan cabang ini (RLS)');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*)>=10 from pos_receipt_cancellations) and (select count(*)>=10 from sale_receipt_shift_effects),'Owner melihat catatan dan efek');

-- ── 14. marketplace: batalkan pencairan ─────────────────────────────────────────────────────────────────
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select post_online_order('on-1',jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'channel','Shopee','warehouse_id','bb300000-0000-4000-8000-000000000002'),
 '[{"item_id":"bb400000-0000-4000-8000-000000000002","qty":2,"harga":50000,"satuan":"pcs"}]');
select post_online_order('on-2',jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'channel','Shopee','warehouse_id','bb300000-0000-4000-8000-000000000002'),
 '[{"item_id":"bb400000-0000-4000-8000-000000000002","qty":1,"harga":70000,"satuan":"pcs"}]');
select post_online_order('on-3',jsonb_build_object('tanggal',(now() at time zone 'Asia/Jakarta')::date,'channel','Shopee','warehouse_id','bb300000-0000-4000-8000-000000000002'),
 '[{"item_id":"bb400000-0000-4000-8000-000000000002","qty":1,"harga":40000,"satuan":"pcs"}]');
create temp table onl as select id,no_struk,total,revision from sales where channel='Shopee' order by total desc;
grant all on onl to public;
select pg_temp.ok((select count(*)=3 and min(marketplace_status)='piutang' from sales where channel='Shopee'),'tiga order marketplace berstatus piutang');
select pg_temp.reject($q$select cancel_online_disbursement((select id from onl where total=100000),0,'o-x','belum dicairkan ya')$q$,'belum dicairkan','order yang belum dicairkan ditolak');
-- pencairan gabungan 2 order (100000 + 70000) dana masuk 160000 -> komisi 10000
select online_disburse_batch('cair-a',(select array_agg(id) from onl where total in(100000,70000)),160000,(now() at time zone 'Asia/Jakarta')::date,null);
select pg_temp.ok((select count(*)=2 and bool_and(marketplace_status='cair') and sum(komisi)=10000 from sales where channel='Shopee' and total in(100000,70000)),'batch: dua order cair, komisi 10000');
insert into fz select 'ON.100',pg_temp.frozen((select no_struk from onl where total=100000));
select cancel_online_disbursement((select id from onl where total=100000),0,'o-1','Salah nominal pencairan');
select pg_temp.ok((select marketplace_status='piutang' and komisi=0 and disbursed_at is null from sales where id=(select id from onl where total=100000)),'order dikembalikan ke piutang (komisi 0, tanggal cair kosong)');
select pg_temp.ok((select marketplace_status='cair' and komisi>0 from sales where id=(select id from onl where total=70000)),'order lain dalam batch yang sama tak tersentuh');
select pg_temp.ok((select amount_bank+amount_fee=100000 and bank_code='1112' and amount_fee between 5800 and 5900 from online_disbursement_cancellations),'catatan: nilai bank dan komisi (komisi proporsional 5882)');
select pg_temp.ok((select count(*)=1 and min(reason)='Salah nominal pencairan' from online_disbursement_cancellations),'catatan pembatalan pencairan: alasan');
select pg_temp.ok((select count(*)=1 from journal_entries where source='sale-online-cair-void') and (select sum(l.debit-l.credit)=0 from journal_lines l join journal_entries e on e.id=l.entry_id where e.source='sale-online-cair-void'),'jurnal pembalik pencairan seimbang');
select pg_temp.ok((select (select sum(l.debit-l.credit) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code='130009' and (e.source='sale-online-cair-void'))=100000),'piutang marketplace didebit kembali 100000');
select pg_temp.reject($q$update journal_entries set deskripsi='diubah klien' where source='sale-online-cair-void'$q$,'Jurnal pembayaran POS sudah tetap','jurnal pembalik pencairan dilindungi');
select pg_temp.ok((cancel_online_disbursement((select id from onl where total=100000),0,'o-1','Salah nominal pencairan')->>'status')='piutang','ulangan kunci sama menjawab sama');
select pg_temp.reject($q$select cancel_online_disbursement((select id from onl where total=100000),0,'o-1b','Salah lagi')$q$,'belum dicairkan','pembatalan pencairan ganda ditolak');
select pg_temp.reject($q$select cancel_online_disbursement((select id from onl where total=100000),0,'o-1','alasan lain sekali')$q$,'Kunci permintaan','kunci sama isian beda ditolak');
select online_disburse_batch('cair-b',array[(select id from onl where total=100000)],95000,(now() at time zone 'Asia/Jakarta')::date,null);
select pg_temp.ok((select marketplace_status='cair' and komisi=5000 from sales where id=(select id from onl where total=100000)),'dicairkan ulang lewat alur lama: komisi baru 5000');
select cancel_online_disbursement((select id from onl where total=100000),0,'o-1c','Batalkan lagi untuk dibatalkan ordernya');
select pg_temp.ok((select count(*)=2 from online_disbursement_cancellations where sale_id=(select id from onl where total=100000)),'dua pembatalan pencairan tercatat untuk order yang sama');
select cancel_posted_sale((select id from onl where total=100000),0,'void-on1','Order batal setelah pencairan dibalik');
select pg_temp.ok((select voided_at is not null from sales where id=(select id from onl where total=100000)),'order marketplace bisa dibatalkan setelah pencairan dibalik (jalur lama ditambal)');
select pg_temp.reject($q$select cancel_posted_sale((select id from onl where total=70000),0,'void-on2','coba saat cair')$q$,'Dana marketplace sudah dicairkan','order yang MASIH cair tetap tidak bisa dibatalkan (aturan lama)');
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$select cancel_online_disbursement((select id from onl where total=70000),0,'o-staff','kasir mencoba ya')$q$,'tidak diizinkan','kasir ditolak membatalkan pencairan');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select cancel_pos_sale_receipt((select id from onl where total=70000),0,'o-pos','pakai jalur kasir ya')$q$,'PENCAIRAN','order marketplace ditolak lewat jalur kasir dengan petunjuk');
-- pencairan satuan (gaya aplikasi lama: jurnal source_ref = no struk)
select pg_temp.sv($q$select sales_write_journal((now() at time zone 'Asia/Jakarta')::date,'bb200000-0000-4000-8000-000000000001','sale-online-cair',(select no_struk from onl where total=40000),'Pencairan satuan',
 jsonb_build_array(jsonb_build_object('code','1112','debit',36000,'credit',0),jsonb_build_object('code','740020','debit',4000,'credit',0),jsonb_build_object('code','130009','debit',0,'credit',40000)))::text$q$);
reset role;update sales set marketplace_status='cair',komisi=4000,disbursed_at=now() where id=(select id from onl where total=40000);set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select cancel_online_disbursement((select id from onl where total=40000),0,'o-3','Pencairan satuan salah');
select pg_temp.ok((select marketplace_status='piutang' from sales where id=(select id from onl where total=40000)),'pencairan satuan dibalik (jurnal dikenali lewat nomor struk)');
select pg_temp.ok(pg_temp.net((select no_struk from onl where total=40000),'1112')=0 and pg_temp.net((select no_struk from onl where total=40000),'130009')=40000,'satuan: bank kembali 0 dan Piutang Marketplace kembali 40000 (nilai order)');
-- jurnal pencairan baru (alur lama) tanpa pembatalan baru: jurnal 2 > pembatalan 1 -> batal penjualan harus ditolak walau status belum 'cair'
select pg_temp.sv($q$select sales_write_journal((now() at time zone 'Asia/Jakarta')::date,'bb200000-0000-4000-8000-000000000001','sale-online-cair',(select no_struk from onl where total=40000),'Pencairan satuan ulang',
 jsonb_build_array(jsonb_build_object('code','1112','debit',36000,'credit',0),jsonb_build_object('code','740020','debit',4000,'credit',0),jsonb_build_object('code','130009','debit',0,'credit',40000)))::text$q$);
select pg_temp.reject($q$select cancel_posted_sale((select id from onl where total=40000),0,'void-on3','coba saat jurnal pencairan lebih banyak dari pembatalan')$q$,'Dana marketplace sudah dicairkan','jumlah jurnal pencairan > jumlah pembatalan: batal penjualan ditolak');
select pg_temp.ok(pg_temp.balanced(),'neraca saldo nol setelah semua uji');
rollback;
