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
create function pg_temp.age_journal(ref text,days integer) returns void language plpgsql security definer as $$
begin
 perform set_config('session_replication_role','replica',true);
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

-- ── 0. objek baru ──────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.ok(to_regprocedure('public.cancel_pos_sale_receipt(uuid,integer,text,text,date)') is not null and to_regprocedure('public.receive_pos_sale_payment(uuid,integer,text,jsonb,date,text)') is not null
 and to_regprocedure('public.cancel_online_disbursement(uuid,integer,text,text,date)') is not null and to_regprocedure('public.pos_receipt_date_bounds(uuid,text)') is not null
 and to_regprocedure('public.pos_receipt_backdate_allowed(uuid)') is not null and to_regprocedure('public.pos_receipt_date_floor(uuid,text)') is not null,'objek baru ada (3 RPC bertanggal, batas rentang, izin tanggal mundur, batas bawah)');
select pg_temp.ok(to_regprocedure('public.cancel_pos_sale_receipt(uuid,integer,text,text)') is not null and to_regprocedure('public.receive_pos_sale_payment(uuid,integer,text,jsonb)') is not null
 and to_regprocedure('public.cancel_online_disbursement(uuid,integer,text,text)') is not null,'bentuk lama (4 argumen) tetap ada untuk aplikasi lama');
select pg_temp.ok((select count(*)=4 from information_schema.columns where table_schema='public' and ((table_name='pos_receipt_cancellations' and column_name in('effective_date','receive_effective_date','receive_reason')) or (table_name='online_disbursement_cancellations' and column_name='effective_date'))),'4 kolom tanggal efektif/alasan ada');
select pg_temp.ok(exists(select 1 from role_settings_private.action_catalog where id='penjualan.pos_penerimaan.tanggal_mundur' and enforced) and exists(select 1 from role_settings_private.action_modules where id='penjualan.pos_penerimaan.tanggal_mundur' and module_id='penjualan'),'izin khusus Tanggal mundur ada di katalog Akses Grup');

-- ── 1. KASUS UTAMA: struk kemarin, dibatalkan hari ini, diterima ulang dengan tanggal ASLI ──────────────────
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BD.H1','[{"method":"Tunai","amount":100000}]');
select pg_temp.mk('BD.H2','[{"method":"Tunai","amount":100000}]');
select pg_temp.mk('BD.H3','[{"method":"Tunai","amount":100000}]');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('BD.H1',1);select pg_temp.age('BD.H2',1);select pg_temp.age('BD.H3',1);
insert into fz select 'BD.H1',pg_temp.frozen('BD.H1');
select pg_temp.ok(pg_temp.net_on('BD.H1','1111',pg_temp.today()-1)=100000 and pg_temp.net_on('BD.H1','510001',pg_temp.today()-1)=-100000,'awal: struk kemarin tunai: kas +100000 dan pendapatan di tanggal KEMARIN');
select pg_temp.ok(pg_temp.omzet_sales(pg_temp.today()-1)=300000 and pg_temp.omzet_sales(pg_temp.today())=0,'awal (jalur laporan omzet): 300000 di kemarin, 0 hari ini');
-- Tanpa tanggal (aplikasi lama): hari ini, persis perilaku lama (kontrol H2)
select pg_temp.cancel('BD.H2','h2c','Salah metode (jalur lama)');
select pg_temp.ok(pg_temp.jdate('BD.H2','sale-receipt-cancel')=pg_temp.today() and pg_temp.net_on('BD.H2','1111',pg_temp.today())=-100000 and pg_temp.net_on('BD.H2','1111',pg_temp.today()-1)=100000,'KONTROL bentuk lama: pembalik jatuh di HARI INI; kas kemarin tetap +100000 (omzet kas kemarin tampak lebih besar dari kenyataan)');
select pg_temp.ok((select effective_date=pg_temp.today() from pos_receipt_cancellations where sale_id=pg_temp.sid('BD.H2')),'bentuk lama mencatat tanggal efektif = hari ini');
-- H1: tanggal efektif = kemarin
select pg_temp.reject($q$select pg_temp.cancel_d('BD.H1','h1c-x',pg_temp.today()-1,'ab')$q$,'alasan minimal 3 huruf','tanggal mundur tanpa alasan layak ditolak (alasan wajib)');
select pg_temp.ok((pg_temp.cancel_d('BD.H1','h1c',pg_temp.today()-1,'Kasir salah pilih metode, dibatalkan besoknya')->>'effective_date')::date=pg_temp.today()-1,'H1 dibatalkan hari ini dengan tanggal efektif KEMARIN: jawaban memuat tanggal efektif');
select pg_temp.ok(pg_temp.jdate('BD.H1','sale-receipt-cancel')=pg_temp.today()-1 and pg_temp.nj('BD.H1',pg_temp.today())=0,'jurnal pembalik dibukukan tanggal KEMARIN, tidak ada jurnal H1 bertanggal hari ini');
select pg_temp.ok(pg_temp.net_on('BD.H1','1111',pg_temp.today()-1)=0 and pg_temp.net_on('BD.H1','150001',pg_temp.today()-1)=100000 and pg_temp.net_on('BD.H1','510001',pg_temp.today()-1)=-100000,'buku besar KEMARIN: kas 0, Piutang Usaha 100000, pendapatan tetap');
select pg_temp.ok(pg_temp.ledger_day('1111',pg_temp.today()-1)=100000*2 and pg_temp.ledger_day('1111',pg_temp.today())=-100000,'jalur Arus Kas (ledger_account_totals): kemarin H2+H3 saja (200000), hari ini -100000 hanya dari H2 lama');
select pg_temp.ok((select effective_date=pg_temp.today()-1 and created_at>now()-interval '5 minutes' and created_at<=now() and created_by='bb100000-0000-4000-8000-000000000001' from pos_receipt_cancellations where sale_id=pg_temp.sid('BD.H1')),'audit: tanggal pilihan = kemarin, waktu nyata = sekarang, pelaku = Owner');
select pg_temp.ok(pg_temp.frozen('BD.H1')=(select h from fz where ref='BD.H1') and (select (created_at at time zone 'Asia/Jakarta')::date=pg_temp.today()-1 and revision=0 from sales where no_struk='BD.H1'),'riwayat TIDAK ditulis ulang: struk, baris, stok, HPP, jurnal penjualan, poin identik; tanggal struk tetap kemarin');
select pg_temp.ok(pg_temp.omzet_sales(pg_temp.today()-1)=300000 and pg_temp.omzet_sales(pg_temp.today())=0 and pg_temp.day_acc('510001',pg_temp.today()-1)=-300000,'omzet kemarin tetap 300000 (jalur laporan penjualan dan jurnal pendapatan) setelah pembatalan');
select pg_temp.reject($q$select pg_temp.receive_d('BD.H1','h1r-x','[{"method":"QRIS","amount":100000}]',pg_temp.today()-1)$q$,'alasan tanggal efektif mundur','terima ulang bertanggal mundur tanpa alasan ditolak');
select pg_temp.reject($q$select pg_temp.receive_d('BD.H1','h1r-y','[{"method":"QRIS","amount":100000}]',pg_temp.today()-2,'sebelum pembatalan')$q$,'sebelum tanggal pembatalan penerimaan','terima ulang tidak boleh lebih awal dari pembatalannya');
select pg_temp.ok((pg_temp.receive_d('BD.H1','h1r',jsonb_build_array(jsonb_build_object('method','QRIS','amount',100000)),pg_temp.today()-1,'Ternyata pelanggan bayar QRIS')->>'effective_date')::date=pg_temp.today()-1,'H1 diterima ulang (QRIS) dengan tanggal asli kemarin');
select pg_temp.ok(pg_temp.jdate('BD.H1','sale-receipt-repost')=pg_temp.today()-1 and pg_temp.nj('BD.H1',pg_temp.today())=0,'jurnal terima ulang bertanggal KEMARIN; hari ini tidak ada jurnal H1 sama sekali');
select pg_temp.ok(pg_temp.net_on('BD.H1','1111',pg_temp.today()-1)=0 and pg_temp.net_on('BD.H1','1115',pg_temp.today()-1)=100000 and pg_temp.net_on('BD.H1','150001',pg_temp.today()-1)=0,'buku besar KEMARIN setelah terima ulang: kas 0, QRIS 100000, piutang 0 (hari asli menunjukkan penerimaan yang benar)');
select pg_temp.ok(pg_temp.ledger_day('1115',pg_temp.today()-1)=100000 and pg_temp.ledger_day('1115',pg_temp.today())=0,'jalur Arus Kas: QRIS 100000 di KEMARIN, 0 hari ini (hari pembatalan tidak tercemar)');
select pg_temp.ok(pg_temp.omzet_penerimaan(pg_temp.today()-1,'QRIS')=100000 and pg_temp.omzet_penerimaan(pg_temp.today()-1,'Tunai')=200000 and pg_temp.omzet_penerimaan(pg_temp.today(),'QRIS')=0,'jalur penjualan-rinci per metode: QRIS 100000 masuk di kemarin (ikut metode baru), bukan di hari pembatalan');
select pg_temp.ok(pg_temp.omzet_sales(pg_temp.today()-1)=300000 and pg_temp.omzet_sales(pg_temp.today())=0,'omzet kemarin tetap 300000 setelah terima ulang');
select pg_temp.ok((select closed_kind='diterima-ulang' and receive_effective_date=pg_temp.today()-1 and receive_reason='Ternyata pelanggan bayar QRIS' and closed_at>now()-interval '5 minutes' and closed_by='bb100000-0000-4000-8000-000000000001' from pos_receipt_cancellations where sale_id=pg_temp.sid('BD.H1')),'audit terima ulang: tanggal pilihan, alasan, waktu nyata, pelaku');
select pg_temp.ok(pg_temp.bal_by_date(),'neraca saldo nol per cabang per tanggal setelah siklus bertanggal');
select pg_temp.ok(pg_temp.frozen('BD.H1')=(select h from fz where ref='BD.H1') and (select metode_bayar='QRIS' and revision=1 and bayar=100000 and kembali=0 from sales where no_struk='BD.H1'),'terima ulang QRIS: header metode QRIS, revisi 1; stok, HPP, jurnal penjualan, poin tetap identik');
-- laci: efek fisik tetap di shift SA (terbuka, shift asal), tidak ikut tanggal
select pg_temp.ok((select count(*)=2 and bool_and(created_at>now()-interval '5 minutes') and bool_and(shift_id='bb600000-0000-4000-8000-00000000000a') from sale_receipt_shift_effects where sale_id=pg_temp.sid('BD.H1')),'laci: dua efek (batal, terima) di shift SA dengan waktu nyata (BUKAN tanggal mundur)');
select pg_temp.ok(pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000a','BD.H1','Tunai')=0 and pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000a','BD.H1','QRIS')=100000,'laci SA: struk H1 menyumbang tunai 0, QRIS 100000 (tidak dobel, tidak hilang)');
select pg_temp.receive('BD.H2','h2r','[{"method":"Tunai","amount":100000}]');
select pg_temp.ok(pg_temp.jdate('BD.H2','sale-receipt-repost')=pg_temp.today(),'KONTROL bentuk lama: terima ulang tetap hari ini');

-- ── 2. rentang: masa depan, sebelum struk, terima ulang sebelum batal ───────────────────────────────────
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BD.R1','[{"method":"Transfer","amount":100000}]');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('BD.R1',5);
insert into fz select 'BD.R1',pg_temp.frozen('BD.R1');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.R1','r1-fut',pg_temp.today()+1)$q$,'belum tiba','tanggal efektif di masa depan ditolak (Owner pun)');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.R1','r1-pre',pg_temp.today()-6)$q$,'sebelum tanggal penerimaan yang dibatalkan','tanggal sebelum tanggal struk ditolak');
select pg_temp.ok((select count(*)=0 from pos_receipt_cancellations where sale_id=pg_temp.sid('BD.R1')) and pg_temp.frozen('BD.R1')=(select h from fz where ref='BD.R1') and pg_temp.bal_by_date(),'penolakan tidak meninggalkan jejak (tak ada catatan, tak ada jurnal)');
select pg_temp.ok((pg_temp.cancel_d('BD.R1','r1c',pg_temp.today()-5)->>'effective_date')::date=pg_temp.today()-5,'tanggal TEPAT sama dengan tanggal struk diterima (batas bawah termasuk)');
-- terima ulang sebelum tanggal pembatalannya: ditolak; tepat di tanggal pembatalan: boleh
select pg_temp.reject($q$select pg_temp.receive_d('BD.R1','r1r-pre','[{"method":"Transfer","amount":100000}]',pg_temp.today()-6,'cek')$q$,'sebelum tanggal pembatalan penerimaan','terima ulang sebelum tanggal pembatalan ditolak');
select pg_temp.reject($q$select pg_temp.receive_d('BD.R1','r1r-fut','[{"method":"Transfer","amount":100000}]',pg_temp.today()+1,'cek')$q$,'belum tiba','terima ulang di masa depan ditolak');
select pg_temp.ok((pg_temp.receive_d('BD.R1','r1r',jsonb_build_array(jsonb_build_object('method','Transfer','amount',100000)),pg_temp.today()-3,'Dibayar tiga hari lalu')->>'effective_date')::date=pg_temp.today()-3,'terima ulang di tanggal lebih lambat dari pembatalan (tanggal lain) boleh');
select pg_temp.ok(pg_temp.jdate('BD.R1','sale-receipt-cancel')=pg_temp.today()-5 and pg_temp.jdate('BD.R1','sale-receipt-repost')=pg_temp.today()-3 and pg_temp.net_on('BD.R1','150001',pg_temp.today()-5)=100000 and pg_temp.net_on('BD.R1','150001',pg_temp.today()-3)=-100000,'piutang ada selama 2 hari (D-5 sampai D-3), tertutup di tanggal terima ulang');
select pg_temp.ok(pg_temp.bal_by_date(),'neraca saldo nol per cabang per tanggal');
-- siklus kedua: pembatalan tidak boleh mendahului terima ulang sebelumnya
select pg_temp.reject($q$select pg_temp.cancel_d('BD.R1','r1c2',pg_temp.today()-4,'siklus kedua terlalu awal')$q$,'sebelum tanggal penerimaan yang dibatalkan','siklus ke-2: pembatalan tidak boleh lebih awal dari terima ulang sebelumnya');
select pg_temp.ok((pg_temp.cancel_d('BD.R1','r1c3',pg_temp.today()-3,'siklus kedua pas')->>'unpaid')::boolean,'siklus ke-2 di tanggal terima ulang sebelumnya: boleh');
select pg_temp.receive_d('BD.R1','r1r3','[{"method":"Transfer","amount":100000}]',null);
select pg_temp.ok(pg_temp.jdate('BD.R1','sale-receipt-repost')=pg_temp.today() and (select count(*)=2 and bool_and(receive_effective_date is not null) from pos_receipt_cancellations where sale_id=pg_temp.sid('BD.R1') and closed_at is not null),'tanpa tanggal pada terima ulang = hari ini, alasan tidak wajib');

-- ── 3. hak: tanggal mundur = Owner, atau peran yang dicentang Owner ──────────────────────────────────────
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BD.P1','[{"method":"QRIS","amount":100000}]');select pg_temp.mk('BD.P2','[{"method":"QRIS","amount":100000}]');select pg_temp.mk('BD.P3','[{"method":"QRIS","amount":100000}]');
select pg_temp.mk('BD.P4','[{"method":"QRIS","amount":100000}]');select pg_temp.mk('BD.P5','[{"method":"QRIS","amount":100000}]');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('BD.P1',4);select pg_temp.age('BD.P2',4);select pg_temp.age('BD.P3',4);select pg_temp.age('BD.P4',4);select pg_temp.age('BD.P5',4);
select pg_temp.ok(exists(select 1 from jsonb_array_elements(get_role_access_config('ADMIN')->'action_catalog') x where x->>'id'='penjualan.pos_penerimaan.tanggal_mundur'),'izin Tanggal mundur muncul di Akses Grup');
select pg_temp.ok(public.pos_receipt_backdate_allowed('bb200000-0000-4000-8000-000000000001'),'Owner: boleh tanggal mundur');
-- ADMIN/FINANCE hanya dengan izin batalkan: boleh hari ini, TIDAK boleh mundur
select pg_temp.grant_roles('["penjualan.pos_penerimaan.batalkan"]'::jsonb,'["penjualan.pos_penerimaan.batalkan"]'::jsonb,'01');
select pg_temp.as_('bb100000-0000-4000-8000-000000000002');
select pg_temp.ok(public.pos_receipt_actor_allowed('bb200000-0000-4000-8000-000000000001') and not public.pos_receipt_backdate_allowed('bb200000-0000-4000-8000-000000000001'),'ADMIN berizin batalkan saja: boleh batalkan, TIDAK boleh tanggal mundur');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.P1','p1-admin',pg_temp.today()-4)$q$,'Hanya Owner','ADMIN tanpa izin tanggal mundur ditolak untuk tanggal sebelum hari ini');
select pg_temp.ok((pg_temp.cancel_d('BD.P1','p1-admin-today',pg_temp.today())->>'effective_date')::date=pg_temp.today(),'ADMIN yang sama: tanggal hari ini (eksplisit) boleh');
select pg_temp.reject($q$select pg_temp.receive_d('BD.P1','p1-admin-r',jsonb_build_array(jsonb_build_object('method','QRIS','amount',100000)),pg_temp.today()-1,'tes')$q$,'Hanya Owner','ADMIN tanpa izin: terima ulang bertanggal mundur juga ditolak');
select pg_temp.ok((pg_temp.receive_d('BD.P1','p1-admin-r2',jsonb_build_array(jsonb_build_object('method','QRIS','amount',100000)),null)->>'unpaid')::boolean=false,'ADMIN: terima ulang tanpa tanggal (hari ini) boleh');
select pg_temp.as_('bb100000-0000-4000-8000-000000000003');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.P2','p2-fin',pg_temp.today()-4)$q$,'Hanya Owner','FINANCE tanpa izin tanggal mundur ditolak');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.grant_roles('["penjualan.pos_penerimaan.batalkan","penjualan.pos_penerimaan.tanggal_mundur"]'::jsonb,'["penjualan.pos_penerimaan.batalkan","penjualan.pos_penerimaan.tanggal_mundur"]'::jsonb,'02');
select pg_temp.as_('bb100000-0000-4000-8000-000000000002');
select pg_temp.ok(public.pos_receipt_backdate_allowed('bb200000-0000-4000-8000-000000000001') and not public.pos_receipt_backdate_allowed('bb200000-0000-4000-8000-000000000002'),'ADMIN yang dicentang Owner: boleh tanggal mundur di cabangnya, tidak di cabang lain');
select pg_temp.ok((pg_temp.cancel_d('BD.P2','p2-admin',pg_temp.today()-4,'Admin berizin tanggal mundur')->>'effective_date')::date=pg_temp.today()-4,'ADMIN berizin: pembatalan bertanggal mundur berhasil');
select pg_temp.ok((pg_temp.receive_d('BD.P2','p2-admin-r',jsonb_build_array(jsonb_build_object('method','QRIS','amount',100000)),pg_temp.today()-4,'Admin berizin: tanggal asli')->>'effective_date')::date=pg_temp.today()-4,'ADMIN berizin: terima ulang bertanggal mundur berhasil');
select pg_temp.ok((select created_by='bb100000-0000-4000-8000-000000000002' and effective_date=pg_temp.today()-4 from pos_receipt_cancellations where sale_id=pg_temp.sid('BD.P2')),'pelaku ADMIN dan tanggal tercatat');
select pg_temp.as_('bb100000-0000-4000-8000-000000000003');
select pg_temp.ok((pg_temp.cancel_d('BD.P3','p3-fin',pg_temp.today()-4,'Finance berizin tanggal mundur')->>'unpaid')::boolean,'FINANCE berizin: boleh');
select pg_temp.reject($q$select pg_temp.receive_d('BD.P3','p3r-long','[{"method":"QRIS","amount":100000}]',null,repeat('x',1001))$q$,'maksimal 1000','alasan lebih dari 1000 huruf ditolak (juga untuk hari ini)');
select pg_temp.as_('bb100000-0000-4000-8000-000000000005');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.P4','p4-other',pg_temp.today()-4)$q$,'tidak diizinkan','ADMIN cabang lain ditolak sama sekali');
-- STAFF dengan kebijakan eksplisit memuat tindakan: tidak pernah boleh
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select save_role_access_config('STAFF',(get_role_access_config('STAFF')->>'revision'),'bb900003-0000-4000-8000-000000000003','custom','["penjualan","kasir","pos"]'::jsonb,'{"all_branches":false,"create_accounts":false}'::jsonb,'Uji STAFF diberi izin','["penjualan.pos_penerimaan.batalkan","penjualan.pos_penerimaan.tanggal_mundur"]'::jsonb);
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.ok(not public.pos_receipt_backdate_allowed('bb200000-0000-4000-8000-000000000001'),'STAFF berkebijakan eksplisit: tetap tidak boleh tanggal mundur');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.P4','p4-staff',pg_temp.today()-4)$q$,'tidak diizinkan','STAFF ditolak');
-- Owner tidak terkunci: tabel kebijakan tidak terbaca -> Owner tetap boleh tanggal mundur; ADMIN gagal tertutup
reset role;
alter table role_settings_private.action_policies rename to action_policies_x;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.ok(public.pos_receipt_backdate_allowed('bb200000-0000-4000-8000-000000000001'),'OWNER tetap boleh tanggal mundur walau tabel kebijakan tidak terbaca');
select pg_temp.ok((pg_temp.cancel_d('BD.P4','p4-owner-nopol',pg_temp.today()-4,'Owner saat kebijakan rusak')->>'effective_date')::date=pg_temp.today()-4,'Owner membatalkan dengan tanggal mundur saat kebijakan rusak');
select pg_temp.as_('bb100000-0000-4000-8000-000000000002');
select pg_temp.ok(not public.pos_receipt_backdate_allowed('bb200000-0000-4000-8000-000000000001'),'ADMIN gagal tertutup saat kebijakan tidak terbaca');
alter table role_settings_private.action_policies_x rename to action_policies;
update profiles set is_active=false where id='bb100000-0000-4000-8000-000000000001';
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.ok(not public.pos_receipt_backdate_allowed('bb200000-0000-4000-8000-000000000001'),'OWNER nonaktif tidak boleh');
update profiles set is_active=true where id='bb100000-0000-4000-8000-000000000001';
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.ok(pg_temp.bal_by_date(),'neraca saldo nol per cabang per tanggal setelah blok hak');

-- ── 4. periode akuntansi tertutup: ditolak jelas, tidak ada jalan pintas ─────────────────────────────────
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BD.L1','[{"method":"Transfer","amount":100000}]');select pg_temp.mk('BD.L2','[{"method":"Transfer","amount":100000}]');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('BD.L1',6);select pg_temp.age('BD.L2',6);
update accounting_locks set closed_until=pg_temp.today()-4;
select pg_temp.reject($q$select pg_temp.cancel_d('BD.L1','l1-closed',pg_temp.today()-5,'coba periode tertutup')$q$,'buka kembali periodenya lewat Tutup Buku','tanggal di periode tertutup: ditolak dengan petunjuk Tutup Buku (Owner pun)');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.L1','l1-closed4',pg_temp.today()-4,'coba tepat tanggal tutup')$q$,'sudah ditutup','tanggal TEPAT sama dengan batas tutup: ditolak (tutup sampai tanggal itu)');
select pg_temp.ok((select count(*)=0 from pos_receipt_cancellations where sale_id=pg_temp.sid('BD.L1')) and pg_temp.bal_by_date(),'penolakan periode tertutup tidak meninggalkan jejak');
select pg_temp.ok((pg_temp.cancel_d('BD.L1','l1-open',pg_temp.today()-3,'sehari sesudah batas tutup')->>'effective_date')::date=pg_temp.today()-3,'sehari sesudah batas tutup: boleh');
select pg_temp.ok(pg_temp.bal_by_date(),'neraca nol');
update accounting_locks set closed_until=pg_temp.today()-3;
select pg_temp.reject($q$select pg_temp.receive_d('BD.L1','l1r-closed','[{"method":"Transfer","amount":100000}]',pg_temp.today()-3,'terima di tanggal tertutup')$q$,'buka kembali periodenya lewat Tutup Buku','terima ulang di periode yang tertutup SETELAH pembatalan: ditolak');
select pg_temp.ok((pg_temp.receive_d('BD.L1','l1r-open',jsonb_build_array(jsonb_build_object('method','Transfer','amount',100000)),pg_temp.today()-2,'sehari lebih lambat')->>'effective_date')::date=pg_temp.today()-2,'terima ulang sesudah batas tutup: boleh');
update accounting_locks set closed_until=pg_temp.today();
select pg_temp.reject($q$select pg_temp.cancel_d('BD.L2','l2-today',null,'hari ini tertutup')$q$,'pembatalan penerimaan hari ini tidak bisa dibukukan','periode tertutup sampai hari ini + tanpa tanggal: pesan lama persis (bentuk lama)');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.L2','l2-today-x',pg_temp.today(),'hari ini eksplisit')$q$,'pembatalan penerimaan hari ini tidak bisa dibukukan','tanggal hari ini eksplisit: pesan hari ini');
update accounting_locks set closed_until=null;
select pg_temp.ok((pg_temp.cancel_d('BD.L2','l2-reopen',pg_temp.today()-5,'setelah dibuka lewat Tutup Buku')->>'unpaid')::boolean,'setelah periode dibuka kembali (jalur Tutup Buku), tanggal yang sama berhasil');

-- ── 5. pagar rekonsiliasi bank memakai tanggal efektif ────────────────────────────────────────────────────
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BD.K1','[{"method":"Transfer","amount":100000}]');select pg_temp.mk('BD.K2','[{"method":"Transfer","amount":100000}]');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('BD.K1',7);select pg_temp.age('BD.K2',7);
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code,created_by) values(pg_temp.today()-5,'bb500000-0000-4000-8000-000000000002','1112','bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.K1','k1-rec',pg_temp.today()-6,'sebelum tanggal rekonsiliasi')$q$,'Rekonsiliasi bank','tanggal efektif di/ sebelum tanggal rekonsiliasi rekening: ditolak');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.K1','k1-rec5',pg_temp.today()-5,'tepat tanggal rekonsiliasi')$q$,'Rekonsiliasi bank','tanggal TEPAT sama dengan tanggal rekonsiliasi: ditolak');
select pg_temp.ok((pg_temp.cancel_d('BD.K1','k1-rec4',pg_temp.today()-4,'sesudah tanggal rekonsiliasi')->>'unpaid')::boolean,'tanggal SESUDAH rekonsiliasi: boleh (fence memakai tanggal efektif, bukan hari ini)');
delete from bank_reconciliations where bank_coa_code='1112';
-- terima ulang: pagar rekonsiliasi memakai tanggal efektif terima ulang
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BD.K3','[{"method":"Transfer","amount":100000}]');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('BD.K3',7);
select pg_temp.cancel_d('BD.K3','k3c',pg_temp.today()-6,'Sebelum rekonsiliasi');
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code,created_by) values(pg_temp.today()-4,'bb500000-0000-4000-8000-000000000002','1112','bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select pg_temp.receive_d('BD.K3','k3r-a','[{"method":"Transfer","amount":100000}]',pg_temp.today()-5,'sebelum tanggal rekonsiliasi')$q$,'Rekonsiliasi bank','terima ulang bertanggal sebelum tanggal rekonsiliasi rekening: ditolak');
select pg_temp.ok((pg_temp.receive_d('BD.K3','k3r-b',jsonb_build_array(jsonb_build_object('method','Transfer','amount',100000)),pg_temp.today()-3,'sesudah tanggal rekonsiliasi')->>'unpaid')::boolean=false,'terima ulang SESUDAH tanggal rekonsiliasi: boleh (pagar memakai tanggal efektif, bukan hari ini)');
delete from bank_reconciliations where bank_coa_code='1112';
-- batas bawah memakai tanggal struk DAN tanggal jurnal penjualan, mana yang lebih lambat
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BD.F1','[{"method":"Transfer","amount":100000}]');select pg_temp.mk('BD.F2','[{"method":"Transfer","amount":100000}]');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('BD.F1',5);select pg_temp.age_journal('BD.F1',3);
select pg_temp.age('BD.F2',5);
update journal_entries set tanggal=tanggal+2 where source in('sale','sale-hpp') and source_ref='BD.F2';
select pg_temp.reject($q$select pg_temp.cancel_d('BD.F1','f1-a',pg_temp.today()-6,'sebelum tanggal struk')$q$,'sebelum tanggal penerimaan yang dibatalkan','jurnal penjualan lebih AWAL dari tanggal struk: batas bawah tetap tanggal struk (D-5); D-6 ditolak');
select pg_temp.ok((pg_temp.cancel_d('BD.F1','f1-b',pg_temp.today()-5,'tepat tanggal struk')->>'unpaid')::boolean,'tanggal struk D-5: boleh');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.F2','f2-a',pg_temp.today()-4,'sebelum jurnal penjualan')$q$,'sebelum tanggal penerimaan yang dibatalkan','jurnal penjualan lebih LAMBAT dari tanggal struk: batas bawah = tanggal jurnal (D-3); D-4 ditolak');
select pg_temp.ok((pg_temp.cancel_d('BD.F2','f2-b',pg_temp.today()-3,'tepat tanggal jurnal')->>'unpaid')::boolean,'tanggal jurnal penjualan D-3: boleh');

-- ── 6. idempotensi dan kunci ───────────────────────────────────────────────────────────────────────────────
create temp table idem(k text primary key,r jsonb);grant all on idem to public;
insert into idem select 'c',pg_temp.cancel_d('BD.K2','k2-a',pg_temp.today()-6,'Idempotensi bertanggal');
select pg_temp.ok(pg_temp.cancel_d('BD.K2','k2-a',pg_temp.today()-6,'Idempotensi bertanggal')=(select r from idem where k='c') and (select count(*)=1 from pos_receipt_cancellations where sale_id=pg_temp.sid('BD.K2')) and pg_temp.nj('BD.K2',pg_temp.today()-6)=1,'kunci sama + tanggal sama: jawaban sama, satu catatan, satu jurnal');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.K2','k2-a',pg_temp.today()-5,'Idempotensi bertanggal')$q$,'Kunci permintaan sudah dipakai','kunci sama + tanggal BERBEDA: ditolak');
select pg_temp.reject($q$select cancel_pos_sale_receipt(pg_temp.sid('BD.K2'),pg_temp.rev('BD.K2'),'k2-a','Idempotensi bertanggal')$q$,'Kunci permintaan sudah dipakai','kunci sama tanpa tanggal (bentuk lama) vs bertanggal: ditolak');
insert into idem select 'r',pg_temp.receive_d('BD.K2','k2-r',jsonb_build_array(jsonb_build_object('method','Transfer','amount',100000)),pg_temp.today()-6,'ulang');
select pg_temp.ok(pg_temp.receive_d('BD.K2','k2-r',jsonb_build_array(jsonb_build_object('method','Transfer','amount',100000)),pg_temp.today()-6,'ulang')=(select r from idem where k='r') and pg_temp.nj('BD.K2',pg_temp.today()-6)=2,'terima ulang: kunci sama menjawab sama, tidak menambah jurnal');
select pg_temp.reject($q$select pg_temp.receive_d('BD.K2','k2-r','[{"method":"Transfer","amount":100000}]',pg_temp.today()-6,'alasan lain')$q$,'Kunci permintaan sudah dipakai','terima ulang: kunci sama + alasan beda ditolak');

-- ── 7. split dan keenam metode, bertanggal mundur ───────────────────────────────────────────────────────────
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BD.S1','[{"method":"Tunai","amount":30000},{"method":"Transfer","amount":50000},{"method":"QRIS","amount":20000}]');
select pg_temp.mk('BD.M1','[{"method":"Tunai","amount":100000}]');select pg_temp.mk('BD.M2','[{"method":"Transfer","amount":100000}]');select pg_temp.mk('BD.M3','[{"method":"Debit","amount":100000}]');
select pg_temp.mk('BD.M4','[{"method":"Kredit","amount":100000}]');select pg_temp.mk('BD.M5','[{"method":"QRIS","amount":100000}]');select pg_temp.mk('BD.M6','[{"method":"E-Wallet","amount":100000}]');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('BD.S1',8);select pg_temp.age('BD.M'||i,8) from generate_series(1,6) i;
select pg_temp.cancel_d('BD.S1','s1c',pg_temp.today()-8,'Split salah');
select pg_temp.ok(pg_temp.net_on('BD.S1','1111',pg_temp.today()-8)=0 and pg_temp.net_on('BD.S1','1112',pg_temp.today()-8)=0 and pg_temp.net_on('BD.S1','1115',pg_temp.today()-8)=0 and pg_temp.net_on('BD.S1','150001',pg_temp.today()-8)=100000,'split: semua bagian dibalik di tanggal asli, piutang 100000');
select pg_temp.receive_d('BD.S1','s1r','[{"method":"Debit","amount":60000},{"method":"E-Wallet","amount":40000}]',pg_temp.today()-8,'Ternyata Debit dan E-Wallet');
select pg_temp.ok(pg_temp.net_on('BD.S1','1113',pg_temp.today()-8)=60000 and pg_temp.net_on('BD.S1','1116',pg_temp.today()-8)=40000 and pg_temp.net_on('BD.S1','150001',pg_temp.today()-8)=0 and pg_temp.net_on('BD.S1','1111',pg_temp.today()-8)=0,'split terima ulang bermetode baru: akun baru di tanggal asli, akun lama 0');
select pg_temp.ok((select metode_bayar='Split' and jsonb_array_length(payment_plan)=2 and revision=1 from sales where no_struk='BD.S1') and pg_temp.omzet_penerimaan(pg_temp.today()-8,'Debit')=160000 and pg_temp.omzet_penerimaan(pg_temp.today()-8,'E-Wallet')=140000 and pg_temp.omzet_penerimaan(pg_temp.today()-8,'Tunai')=100000 and pg_temp.omzet_penerimaan(pg_temp.today()-8,'QRIS')=100000,'jalur penjualan-rinci per metode mengikuti rencana baru di tanggal struk (S1 Debit 60000 + M3 100000; E-Wallet 40000 + M6 100000; Tunai/QRIS dari M1/M5 saja)');
select pg_temp.cancel_d('BD.M'||i,'mc'||i,pg_temp.today()-7) from generate_series(1,6) i;
select pg_temp.ok(pg_temp.net_on('BD.M1','1111',pg_temp.today()-7)=-100000 and pg_temp.net_on('BD.M2','1112',pg_temp.today()-7)=-100000 and pg_temp.net_on('BD.M3','1113',pg_temp.today()-7)=-100000 and pg_temp.net_on('BD.M4','1114',pg_temp.today()-7)=-100000 and pg_temp.net_on('BD.M5','1115',pg_temp.today()-7)=-100000 and pg_temp.net_on('BD.M6','1116',pg_temp.today()-7)=-100000,'enam metode: setiap akun dikredit pada tanggal efektif D-7');
select pg_temp.ok(pg_temp.day_acc('150001',pg_temp.today()-7)=600000 and pg_temp.ledger_day('150001',pg_temp.today()-7)=600000,'enam metode: Piutang Usaha 600000 di D-7 (jalur buku besar dan jalur Arus Kas)');
select pg_temp.receive_d('BD.M'||i,'mr'||i,jsonb_build_array(jsonb_build_object('method',(array['Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet'])[(i % 6)+1],'amount',100000)),pg_temp.today()-7,'Metode digeser') from generate_series(1,6) i;
select pg_temp.ok(pg_temp.day_acc('150001',pg_temp.today()-7)=0 and pg_temp.bal_by_date(),'enam metode: terima ulang menutup piutang, neraca nol per cabang per tanggal');
select pg_temp.ok(pg_temp.net_on('BD.M1','1112',pg_temp.today()-7)=100000 and pg_temp.net_on('BD.M6','1111',pg_temp.today()-7)=100000,'metode bergeser: M1 ke Transfer, M6 ke Tunai');

-- ── 8. pembatalan penjualan sesudah siklus bertanggal: rantai bersih ─────────────────────────────────────────
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BD.V1','[{"method":"Tunai","amount":100000}]','bb600000-0000-4000-8000-00000000000a',true);
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('BD.V1',2);
select pg_temp.cancel_d('BD.V1','v1c',pg_temp.today()-2,'Barang salah, ganti');
select cancel_posted_sale(pg_temp.sid('BD.V1'),0,'void-v1','Batal sekalian ganti barang');
select pg_temp.ok((select voided_at is not null from sales where no_struk='BD.V1') and pg_temp.chain_zero('BD.V1') and pg_temp.bal_by_date(),'batal penjualan sesudah pembatalan bertanggal: SEMUA akun rantai bersih nol, neraca nol per tanggal');
select pg_temp.ok((select closed_kind='penjualan-dibatalkan' from pos_receipt_cancellations where sale_id=pg_temp.sid('BD.V1')) and pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000a','BD.V1','Tunai')=0,'catatan ditutup; laci shift netral');

-- ── 9. shift: efek fisik di shift pelaku / tanpa shift, tutup shift tidak dobel dan tidak hilang ───────────────
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BD.C1','[{"method":"Tunai","amount":60000},{"method":"QRIS","amount":40000}]','bb600000-0000-4000-8000-00000000000a');
select pg_temp.mk('BD.C2','[{"method":"Tunai","amount":100000}]','bb600000-0000-4000-8000-00000000000a');
select pg_temp.mk('BD.C3','[{"method":"QRIS","amount":100000}]','bb600000-0000-4000-8000-00000000000a');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('BD.C1',2);select pg_temp.age('BD.C2',2);select pg_temp.age('BD.C3',2);
select pg_temp.close_shift('bb600000-0000-4000-8000-00000000000a');
insert into fz values('SA',pg_temp.shift_row('bb600000-0000-4000-8000-00000000000a'));
insert into fz select 'BD.C1',pg_temp.frozen('BD.C1');
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at) values('bb600000-0000-4000-8000-00000000000c','bb200000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001','petshop',10000,now()-interval '1 hour');
select pg_temp.ok((pg_temp.cancel_d('BD.C1','c1c',pg_temp.today()-2,'Shift asal tertutup, tanggal asli')->>'effect_in_other_shift')::boolean,'shift asal tertutup: efek laci di shift terbuka PELAKU (SC), tanggal jurnal tetap D-2');
select pg_temp.ok(pg_temp.shift_row('bb600000-0000-4000-8000-00000000000a')=(select h from fz where ref='SA'),'shift tertutup SA: baris (angka tutup, selisih) tidak berubah sama sekali');
select pg_temp.ok((select shift_mode='shift_pelaku' and effect_shift_id='bb600000-0000-4000-8000-00000000000c' and effective_date=pg_temp.today()-2 from pos_receipt_cancellations where sale_id=pg_temp.sid('BD.C1')) and pg_temp.jdate('BD.C1','sale-receipt-cancel')=pg_temp.today()-2,'catatan: shift_pelaku, tanggal efektif D-2, jurnal D-2');
select pg_temp.ok((select count(*)=2 and bool_and(created_at>now()-interval '5 minutes') from sale_receipt_shift_effects where sale_id=pg_temp.sid('BD.C1')),'efek laci memakai waktu nyata (BUKAN tanggal mundur)');
select pg_temp.reject($q$update cashier_shifts set status='closed',expected_cash=10000,closing_breakdown='{"Tunai":0,"Transfer":0,"Debit":0,"Kredit":0,"QRIS":0,"E-Wallet":0}' where id='bb600000-0000-4000-8000-00000000000c'$q$,'Pembayaran shift berubah','tutup shift basi (angka tanpa efek bertanggal mundur) ditolak');
select pg_temp.close_shift('bb600000-0000-4000-8000-00000000000c');
select pg_temp.ok((select status='closed' and expected_cash=10000-60000 and (closing_breakdown->>'QRIS')::numeric=-40000 from cashier_shifts where id='bb600000-0000-4000-8000-00000000000c'),'tutup shift dengan angka yang memuat efek: diterima; efek dihitung SEKALI (tunai -60000, QRIS -40000)');
update cashier_shifts set status='open',closed_at=null where id='bb600000-0000-4000-8000-00000000000c';
select pg_temp.receive_d('BD.C1','c1r','[{"method":"Transfer","amount":100000}]',pg_temp.today()-2,'Terima ulang tanggal asli');
select pg_temp.ok(pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000c','BD.C1','Tunai')=-60000 and pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000c','BD.C1','QRIS')=-40000 and pg_temp.counted_sale('bb600000-0000-4000-8000-00000000000c','BD.C1','Transfer')=100000,'laci SC setelah terima ulang: tunai -60000, QRIS -40000, transfer +100000 (jumlah bersih = 0, tidak dobel, tidak hilang)');
select pg_temp.ok(pg_temp.net_on('BD.C1','1112',pg_temp.today()-2)=100000 and pg_temp.net_on('BD.C1','1111',pg_temp.today()-2)=0 and pg_temp.shift_row('bb600000-0000-4000-8000-00000000000a')=(select h from fz where ref='SA'),'buku besar D-2 mengikuti metode baru; SA tetap tak tersentuh');
-- pelaku tanpa shift terbuka: tetap boleh (Owner tidak dikunci), ditandai tanpa_shift, jurnal tetap di tanggal efektif
select pg_temp.close_shift('bb600000-0000-4000-8000-00000000000c');
select pg_temp.ok((pg_temp.cancel_d('BD.C2','c2c',pg_temp.today()-2,'Tanpa shift terbuka')->>'shift_mode')='tanpa_shift' and (select count(*)=0 from sale_receipt_shift_effects where sale_id=pg_temp.sid('BD.C2')),'tanpa shift terbuka: tanpa_shift, tidak menyentuh laci siapa pun');
select pg_temp.ok(pg_temp.net_on('BD.C2','1111',pg_temp.today()-2)=0 and pg_temp.net_on('BD.C2','150001',pg_temp.today()-2)=100000,'pembukuan tetap tercatat di tanggal efektif walau laci tak tersentuh');
select pg_temp.ok((pg_temp.receive_d('BD.C2','c2r','[{"method":"Tunai","amount":100000}]',pg_temp.today()-2,'Tunai tanpa shift')->>'shift_mode')='tanpa_shift','terima ulang tunai tanpa shift: boleh, tanpa_shift');
select pg_temp.ok((pg_temp.cancel_d('BD.C3','c3c',pg_temp.today()-1,'QRIS tanpa shift')->>'effect_shift_id') is null,'QRIS tanpa shift: boleh tanpa efek laci');
update cashier_shifts set status='open',closed_at=null where id='bb600000-0000-4000-8000-00000000000c';
select pg_temp.receive_d('BD.C3','c3r','[{"method":"QRIS","amount":100000}]',pg_temp.today()-1,'Selesai');
select pg_temp.ok(pg_temp.bal_by_date(),'neraca saldo nol per cabang per tanggal setelah blok shift');

-- ── 10. pratinjau rentang (layar) ─────────────────────────────────────────────────────────────────────────
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('BD.B1','[{"method":"Transfer","amount":100000}]','bb600000-0000-4000-8000-00000000000c');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.age('BD.B1',9);
select pg_temp.ok((select (b->>'min_date')::date=pg_temp.today()-9 and (b->>'max_date')::date=pg_temp.today() and (b->>'can_backdate')::boolean and b->>'closed_until' is null and (b->>'effective_min')::date=pg_temp.today()-9 from (select public.pos_receipt_date_bounds(pg_temp.sid('BD.B1'),'cancel') b) x),'rentang (batal): tanggal struk .. hari ini, Owner boleh mundur, tak ada periode tertutup');
update accounting_locks set closed_until=pg_temp.today()-7;
select pg_temp.ok((select (b->>'effective_min')::date=pg_temp.today()-6 and (b->>'closed_until')::date=pg_temp.today()-7 from (select public.pos_receipt_date_bounds(pg_temp.sid('BD.B1'),'cancel') b) x),'rentang: periode tertutup menggeser tanggal terawal yang boleh');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.B1','b1-below',pg_temp.today()-7,'tepat batas tutup')$q$,'sudah ditutup','tanggal di bawah effective_min ditolak oleh database (layar hanya pratinjau)');
update accounting_locks set closed_until=null;
select pg_temp.cancel_d('BD.B1','b1c',pg_temp.today()-4,'Rentang terima ulang');
select pg_temp.ok((select (b->>'min_date')::date=pg_temp.today()-4 from (select public.pos_receipt_date_bounds(pg_temp.sid('BD.B1'),'receive') b) x),'rentang (terima ulang): dimulai dari tanggal pembatalan yang terbuka');
select pg_temp.as_('bb100000-0000-4000-8000-000000000002');
select pg_temp.ok((select (b->>'can_backdate')::boolean and (b->>'min_date')::date=pg_temp.today()-4 from (select public.pos_receipt_date_bounds(pg_temp.sid('BD.B1'),'receive') b) x),'rentang dibaca ADMIN berizin: boleh mundur, tanggal terendah sama');
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$select public.pos_receipt_date_bounds(pg_temp.sid('BD.B1'),'receive')$q$,'tidak diizinkan','STAFF tidak bisa membaca rentang');
select pg_temp.reject($q$select public.pos_receipt_date_bounds(pg_temp.sid('BD.B1'),'xx')$q$,'tidak dikenal','jenis tindakan tak dikenal ditolak');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.receive_d('BD.B1','b1r','[{"method":"Transfer","amount":100000}]',null);

-- ── 11. audit: kekekalan kolom baru dan batasan tanggal ───────────────────────────────────────────────────────
reset role;
select pg_temp.reject($q$update pos_receipt_cancellations set effective_date=effective_date-1 where sale_id=pg_temp.sid('BD.H1')$q$,'tidak dapat diubah','tanggal efektif tersimpan tidak bisa diubah (catatan sudah ditutup)');
select pg_temp.reject($q$delete from pos_receipt_cancellations where sale_id=pg_temp.sid('BD.H1')$q$,'tidak dapat diubah','catatan bertanggal tidak bisa dihapus');
select pg_temp.ok(exists(select 1 from pg_constraint where conname='pos_receipt_cancellations_effective_date_check') and exists(select 1 from pg_constraint where conname='pos_receipt_cancellations_receive_date_check') and exists(select 1 from pg_constraint where conname='online_disbursement_cancellations_effective_date_check'),'batasan basis data: tanggal efektif tidak melewati tanggal catat, terima ulang tidak lebih awal dari pembatalan');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.mk('BD.X1','[{"method":"Transfer","amount":100000}]','bb600000-0000-4000-8000-00000000000c');
select pg_temp.age('BD.X1',3);
select pg_temp.cancel_d('BD.X1','x1c',pg_temp.today()-3,'Uji batasan');
select pg_temp.reject($q$update pos_receipt_cancellations set closed_at=now(),closed_by='bb100000-0000-4000-8000-000000000001',closed_kind='diterima-ulang',receive_effective_date=pg_temp.today()-9 where sale_id=pg_temp.sid('BD.X1') and closed_at is null$q$,'receive_date_check','batasan: terima ulang tidak bisa lebih awal dari pembatalan (bahkan oleh pemilik basis data)');
select pg_temp.reject($q$update pos_receipt_cancellations set closed_at=now(),closed_by='bb100000-0000-4000-8000-000000000001',closed_kind='diterima-ulang',receive_effective_date=pg_temp.today()+1 where sale_id=pg_temp.sid('BD.X1') and closed_at is null$q$,'receive_date_check','batasan: tanggal terima ulang di masa depan ditolak');
select pg_temp.reject($q$update pos_receipt_cancellations set closed_at=now(),closed_by='bb100000-0000-4000-8000-000000000001',closed_kind='diterima-ulang',receive_effective_date=pg_temp.today()-3,receive_reason='ab' where sale_id=pg_temp.sid('BD.X1') and closed_at is null$q$,'receive_reason_check','batasan: alasan terima ulang terlalu pendek ditolak');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.receive_d('BD.X1','x1r','[{"method":"Transfer","amount":100000}]',null);
set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$update pos_receipt_cancellations set effective_date=null$q$,'permission denied','klien tidak bisa mengubah tanggal efektif');

-- ── 12. marketplace: tanggal efektif pembalikan pencairan ──────────────────────────────────────────────────────
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select post_online_order('bdon-1',jsonb_build_object('tanggal',pg_temp.today()-6,'channel','Shopee','warehouse_id','bb300000-0000-4000-8000-000000000002'),'[{"item_id":"bb400000-0000-4000-8000-000000000002","qty":2,"harga":50000,"satuan":"pcs"}]');
select post_online_order('bdon-2',jsonb_build_object('tanggal',pg_temp.today()-6,'channel','Shopee','warehouse_id','bb300000-0000-4000-8000-000000000002'),'[{"item_id":"bb400000-0000-4000-8000-000000000002","qty":1,"harga":70000,"satuan":"pcs"}]');
select post_online_order('bdon-3',jsonb_build_object('tanggal',pg_temp.today()-6,'channel','Shopee','warehouse_id','bb300000-0000-4000-8000-000000000002'),'[{"item_id":"bb400000-0000-4000-8000-000000000002","qty":1,"harga":40000,"satuan":"pcs"}]');
create temp table onl as select id,no_struk,total,revision from sales where channel='Shopee' order by total desc;
grant all on onl to public;
select online_disburse_batch('bdcair-a',(select array_agg(id) from onl where total in(100000,70000)),160000,pg_temp.today()-4,null);
-- pencairan satuan (gaya aplikasi lama: jurnal source_ref = no struk) bertanggal D-3
select pg_temp.sv($q$select sales_write_journal(pg_temp.today()-3,'bb200000-0000-4000-8000-000000000001','sale-online-cair',(select no_struk from onl where total=40000),'Pencairan satuan',
 jsonb_build_array(jsonb_build_object('code','1112','debit',36000,'credit',0),jsonb_build_object('code','740020','debit',4000,'credit',0),jsonb_build_object('code','130009','debit',0,'credit',40000)))::text$q$);
reset role;update sales set marketplace_status='cair',komisi=4000,disbursed_at=now() where id=(select id from onl where total=40000);set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.ok((select (b->>'min_date')::date=pg_temp.today()-4 and (b->>'can_backdate')::boolean from (select public.pos_receipt_date_bounds((select id from onl where total=100000),'online') b) x),'rentang (pencairan): mulai dari tanggal jurnal pencairan (D-4), bukan tanggal order');
select pg_temp.reject($q$select cancel_online_disbursement((select id from onl where total=100000),0,'on-pre','Sebelum pencairan',pg_temp.today()-5)$q$,'sebelum tanggal pencairan','pembalikan pencairan tidak boleh sebelum tanggal pencairan');
select pg_temp.reject($q$select cancel_online_disbursement((select id from onl where total=100000),0,'on-fut','Masa depan',pg_temp.today()+1)$q$,'belum tiba','pembalikan pencairan di masa depan ditolak');
reset role;update accounting_locks set closed_until=pg_temp.today()-4;set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select cancel_online_disbursement((select id from onl where total=100000),0,'on-closed','Periode tertutup',pg_temp.today()-4)$q$,'Tutup Buku','pencairan: periode tertutup ditolak dengan petunjuk');
reset role;update accounting_locks set closed_until=null;set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.grant_roles('["penjualan.pos_penerimaan.batalkan"]'::jsonb,'["penjualan.pos_penerimaan.batalkan"]'::jsonb,'03');
select pg_temp.as_('bb100000-0000-4000-8000-000000000002');
select pg_temp.ok((select not (b->>'can_backdate')::boolean from (select public.pos_receipt_date_bounds((select id from onl where total=100000),'online') b) x),'rentang (pencairan) dibaca ADMIN tanpa izin mundur: can_backdate = false');
select pg_temp.reject($q$select cancel_online_disbursement((select id from onl where total=100000),0,'on-admin','ADMIN tanpa izin mundur',pg_temp.today()-4)$q$,'Hanya Owner','ADMIN tanpa izin tanggal mundur: pembalikan pencairan bertanggal mundur ditolak');
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
reset role;insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code,created_by) values(pg_temp.today()-3,'bb500000-0000-4000-8000-000000000002','1112','bb100000-0000-4000-8000-000000000001');set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select cancel_online_disbursement((select id from onl where total=100000),0,'on-rec','Rekonsiliasi lebih lambat dari tanggal efektif',pg_temp.today()-4)$q$,'Rekonsiliasi bank','pembalikan pencairan bertanggal sebelum tanggal rekonsiliasi rekening: ditolak');
reset role;delete from bank_reconciliations where bank_coa_code='1112';set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
insert into fz select 'ON.100',pg_temp.frozen((select no_struk from onl where total=100000));
select pg_temp.ok((cancel_online_disbursement((select id from onl where total=100000),0,'on-1','Salah nominal pencairan',pg_temp.today()-4)->>'effective_date')::date=pg_temp.today()-4,'pembalikan pencairan bertanggal D-4 (tanggal pencairan) berhasil');
select pg_temp.ok((select e.tanggal=pg_temp.today()-4 from journal_entries e where e.source='sale-online-cair-void' and e.source_ref in(select id::text from online_disbursement_cancellations where sale_id=(select id from onl where total=100000))),'jurnal pembalik pencairan bertanggal D-4');
select pg_temp.ok((select effective_date=pg_temp.today()-4 and created_at>now()-interval '5 minutes' from online_disbursement_cancellations where sale_id=(select id from onl where total=100000)),'audit pencairan: tanggal pilihan dan waktu nyata');
select pg_temp.ok((select sum(l.debit-l.credit)=100000 from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code='130009' and e.source='sale-online-cair-void' and e.tanggal=pg_temp.today()-4),'piutang marketplace didebit kembali 100000 pada D-4 (jurnal pembalik)');
select pg_temp.ok((select marketplace_status='piutang' and komisi=0 and disbursed_at is null from sales where id=(select id from onl where total=100000)) and (select marketplace_status='cair' from sales where id=(select id from onl where total=70000)),'order dikembalikan ke piutang; order lain dalam batch tak tersentuh');
select pg_temp.ok((cancel_online_disbursement((select id from onl where total=100000),0,'on-1','Salah nominal pencairan',pg_temp.today()-4)->>'status')='piutang','kunci sama + tanggal sama menjawab sama');
select pg_temp.reject($q$select cancel_online_disbursement((select id from onl where total=100000),0,'on-1','Salah nominal pencairan',pg_temp.today()-3)$q$,'Kunci permintaan sudah dipakai','kunci sama + tanggal beda ditolak');
-- order tunggal (pencairan D-3) dibatalkan tanpa tanggal: bentuk lama = hari ini
insert into idem select 'o',cancel_online_disbursement((select id from onl where total=40000),0,'on-3','Pencairan salah');
select pg_temp.ok((select r->>'status'='piutang' from idem where k='o') and (select e.tanggal=pg_temp.today() from journal_entries e where e.source='sale-online-cair-void' and e.source_ref in(select id::text from online_disbursement_cancellations where sale_id=(select id from onl where total=40000))),'bentuk lama (tanpa tanggal): pembalikan pencairan tetap hari ini');
select pg_temp.ok(pg_temp.bal_by_date(),'neraca saldo nol per cabang per tanggal setelah marketplace');
-- fee merchant tetap ditolak walau bertanggal
reset role;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,merchant_fee_total)
 values('bb200000-0000-4000-8000-000000000001','BD.FEE',99009.90,0,100000,'QRIS',100000,0,'bb100000-0000-4000-8000-000000000001','bb600000-0000-4000-8000-00000000000c',
 '[{"method":"QRIS","amount":100000,"fee_percent":1,"fee_amount":990.10}]','k:BD.FEE',repeat('a',64),990.10);
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) select id,'bb400000-0000-4000-8000-000000000001','Jasa',1,99009.90,'pcs',1,0 from sales where no_struk='BD.FEE';
select finalize_pos_sale(pg_temp.sid('BD.FEE'));
set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.FEE','fee-1',pg_temp.today(),'Struk berbiaya')$q$,'fee merchant','struk ber-fee merchant tetap ditolak (aturan lama tidak berubah)');
-- sudah diretur tetap ditolak walau bertanggal
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.mk('BD.RT','[{"method":"Tunai","amount":100000}]','bb600000-0000-4000-8000-00000000000c',true);
select post_unit_return('sales',pg_temp.sid('BD.RT'),'ret-bdrt',jsonb_build_object('tanggal',pg_temp.today(),'dari','kasir'),
 jsonb_build_array(jsonb_build_object('source_line_id',(select i.id from sale_items i where i.sale_id=pg_temp.sid('BD.RT')),'item_id','bb400000-0000-4000-8000-000000000002','qty',2,'satuan','pcs','kondisi','baik')));
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select pg_temp.cancel_d('BD.RT','rt-1',pg_temp.today(),'Sudah diretur')$q$,'retur/refund','struk yang sudah diretur tetap ditolak (aturan lama tidak berubah)');

reset role;
select pg_temp.reject($q$update online_disbursement_cancellations set effective_date=null$q$,'tidak dapat diubah','tanggal efektif pembatalan pencairan tidak bisa diubah (pemilik basis data pun)');
select pg_temp.reject($q$delete from online_disbursement_cancellations$q$,'tidak dapat diubah','catatan pembatalan pencairan tidak bisa dihapus');
set local role authenticated;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');

-- ── 13. neraca akhir ───────────────────────────────────────────────────────────────────────────────────────
select pg_temp.ok(pg_temp.bal_by_date(),'neraca saldo nol per cabang per tanggal di akhir seluruh uji');
select pg_temp.ok((select count(*)>=20 from pos_receipt_cancellations where effective_date is not null) and not exists(select 1 from pos_receipt_cancellations where effective_date is null),'semua catatan baru memuat tanggal efektif');
rollback;
