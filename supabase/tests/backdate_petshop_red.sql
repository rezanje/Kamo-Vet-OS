-- Tanggal efektif (backdate) — Batalkan penerimaan PETSHOP (migrasi *_backdate_petshop): fictional fixtures in disposable PostgreSQL only; everything rolls back.
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

set local check_function_bodies=off;
-- ── helper khusus tanggal efektif ───────────────────────────────────────────────────────────────────
create function pg_temp.today() returns date language sql as $$select (now() at time zone 'Asia/Jakarta')::date$$;
-- Menua struk: tanggal struk dan jurnal penjualannya mundur N hari (fixture saja; riwayat produksi tidak pernah ditulis ulang).
create function pg_temp.age(ref text,days integer) returns void language plpgsql security definer as $$
begin
 perform set_config('session_replication_role','replica',true);
 update public.sales set created_at=created_at-make_interval(days=>days) where no_struk=ref;
 update public.journal_entries set tanggal=tanggal-days where source in('sale','sale-hpp') and source_ref=ref;
 perform set_config('session_replication_role','origin',true);
end$$;
create function pg_temp.cancel_d(ref text,key text,d date,reason text default 'Salah input metode',rev integer default null) returns jsonb language sql as $$
 select cancel_pos_sale_receipt(pg_temp.sid(ref),coalesce(rev,pg_temp.rev(ref)),key,reason,d)$$;
create function pg_temp.receive_d(ref text,key text,plan jsonb,d date,reason text default null,rev integer default null) returns jsonb language sql as $$
 select receive_pos_sale_payment(pg_temp.sid(ref),coalesce(rev,pg_temp.rev(ref)),key,plan,d,reason)$$;
-- Saldo akun pada satu tanggal jurnal untuk rantai satu struk / seluruh buku.
create function pg_temp.net_on(ref text,code text,d date) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
 where a.code=$2 and e.tanggal=$3 and (e.source_ref=$1 or e.source_ref in(select id::text from public.pos_receipt_cancellations where sale_id=(select id from public.sales where no_struk=$1))
  or e.source_ref in(select id::text from public.sale_cancellations where sale_id=(select id from public.sales where no_struk=$1)))$$;
create function pg_temp.day_acc(code text,d date) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id where a.code=$1 and e.tanggal=$2$$;
-- Jalur laporan Arus Kas / Kas-Bank di dashboard: RPC ledger_account_totals per hari (debit-kredit akun).
create function pg_temp.ledger_day(code text,d date) returns numeric language sql as $$
 select coalesce(sum(t.debit-t.credit),0) from jsonb_to_recordset(public.ledger_account_totals($2,$2,null)) as t(account_id uuid,debit numeric,credit numeric)
 join public.coa_accounts a on a.id=t.account_id where a.code=$1$$;
-- Jalur laporan omzet/penjualan (laporan-transaksi, penjualan-rinci, penjualan-kasir): struk selesai, tidak void, batas hari WIB pada sales.created_at.
create function pg_temp.omzet_sales(d date) returns numeric language sql security definer as $$
 select coalesce(sum(total),0) from public.sales where voided_at is null and (payment_plan is null or payments_finalized_at is not null)
  and created_at>=($1::text||'T00:00:00+07:00')::timestamptz and created_at<(($1+1)::text||'T00:00:00+07:00')::timestamptz and no_struk like 'BD.%'$$;
create function pg_temp.omzet_penerimaan(d date,m text) returns numeric language sql security definer as $$
 select coalesce(sum(p.amount),0) from public.sale_payments p join public.sales s on s.id=p.sale_id where s.voided_at is null and p.method=$2 and s.no_struk like 'BD.%'
  and s.created_at>=($1::text||'T00:00:00+07:00')::timestamptz and s.created_at<(($1+1)::text||'T00:00:00+07:00')::timestamptz$$;
create function pg_temp.bal_by_date() returns boolean language sql security definer as $$
 select not exists(select 1 from public.journal_entries e join public.journal_lines l on l.entry_id=e.id group by e.branch_id,e.tanggal having sum(l.debit-l.credit)<>0)
  and not exists(select 1 from public.journal_lines group by entry_id having sum(debit-credit)<>0)$$;
create function pg_temp.jdate(ref text,src text) returns date language sql security definer as $$
 select max(e.tanggal) from public.journal_entries e where e.source=$2 and (e.source_ref in(select id::text from public.pos_receipt_cancellations where sale_id=(select id from public.sales where no_struk=$1)))$$;
create function pg_temp.nj(ref text,d date) returns integer language sql security definer as $$
 select count(*)::int from public.journal_entries e where e.tanggal=$2 and e.source in('sale-receipt-cancel','sale-receipt-repost') and e.source_ref in(select id::text from public.pos_receipt_cancellations where sale_id=(select id from public.sales where no_struk=$1))$$;
create function pg_temp.grant_roles(admin_actions jsonb,fin_actions jsonb,tag text) returns void language plpgsql as $$
begin
 perform save_role_access_config('ADMIN',(get_role_access_config('ADMIN')->>'revision'),('bb9000'||tag||'-0000-4000-8000-000000000001')::uuid,'custom','["penjualan","kasir","pos"]'::jsonb,'{"all_branches":false,"create_accounts":false}'::jsonb,'Uji tanggal mundur ADMIN',admin_actions);
 perform save_role_access_config('FINANCE',(get_role_access_config('FINANCE')->>'revision'),('bb9000'||tag||'-0000-4000-8000-000000000002')::uuid,'custom','["penjualan","kas-bank","pos"]'::jsonb,'{"all_branches":false,"create_accounts":false}'::jsonb,'Uji tanggal mundur FINANCE',fin_actions);
end$$;


-- RED semantik: tanpa kandidat (RPC lama 4 argumen) pembatalan hari ini TIDAK bisa dibukukan di tanggal asli struk.
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BD.H1','[{"method":"Tunai","amount":100000}]');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('BD.H1',1);
select pg_temp.ok(pg_temp.net_on('BD.H1','1111',pg_temp.today()-1)=100000,'awal: struk kemarin tunai: kas +100000 di tanggal kemarin');
select pg_temp.cancel('BD.H1','h1c','Kasir salah pilih metode, dibatalkan besoknya');
select pg_temp.ok(pg_temp.jdate('BD.H1','sale-receipt-cancel')=pg_temp.today()-1,'jurnal pembalik dibukukan tanggal KEMARIN (tanggal asli struk)');
rollback;
