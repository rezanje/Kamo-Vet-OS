-- MITIGASI_1111 R2 (migrasi 20261113100000): petshop - efek laci batal/terima ulang jatuh ke shift pelaku; tanpa shift = 'tanpa_shift'.
-- Fixture fiktif di PostgreSQL sekali-pakai; semuanya di-rollback. Header (fixture + pembantu) disalin dari batalkan_penerimaan_petshop.sql.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;raise notice 'MT_PASS %',label;end$$;
create function pg_temp.reject(stmt text, expected text, label text) returns void language plpgsql as $$
declare failed boolean:=false;msg text;begin
 begin execute stmt;exception when others then failed:=true;msg:=sqlerrm;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
 if position(expected in msg)=0 then raise exception 'Unexpected rejection for %: %',label,msg;end if;
 raise notice 'MT_PASS %',label;
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

-- ═══════════════ MITIGASI_1111 R2 (petshop): efek laci jatuh ke shift TERBUKA MILIK PELAKU; tanpa shift = 'tanpa_shift' ═══════════════
-- Fixture di atas: SA (kasir 4, nanti ditutup) dan SB (kasir 6, tetap terbuka). Tambah SC (kasir 4, terbuka) = dua kasir punya laci terbuka.
-- Pelaku: Owner bb..01 (tanpa shift), lalu dengan shift sendiri SO; FINANCE bb..03 diberi izin lewat Akses Grup.
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
select pg_temp.mk('MT.A1','[{"method":"Tunai","amount":100000}]');
select pg_temp.mk('MT.A2','[{"method":"Tunai","amount":60000},{"method":"QRIS","amount":40000}]');
select pg_temp.mk('MT.A3','[{"method":"Tunai","amount":100000}]');
select pg_temp.mk('MT.A4','[{"method":"QRIS","amount":100000}]');
select pg_temp.mk('MT.A6','[{"method":"Tunai","amount":100000}]');
select pg_temp.as_('bb100000-0000-4000-8000-000000000006');
select pg_temp.mk('MT.B1','[{"method":"Tunai","amount":50000}]','bb600000-0000-4000-8000-00000000000b');
select pg_temp.close_shift('bb600000-0000-4000-8000-00000000000a');
select pg_temp.as_('bb100000-0000-4000-8000-000000000004');
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at) values
 ('bb600000-0000-4000-8000-00000000000c','bb200000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000004','petshop',10000,now()-interval '1 hour');
select pg_temp.ok((select count(*)=2 from cashier_shifts where status='open' and shift_type='petshop' and branch_id='bb200000-0000-4000-8000-000000000001'),'dua laci petshop terbuka (SB kasir 6, SC kasir 4); SA tertutup');
create temp table snap(k text primary key,v text); grant all on snap to public;
insert into snap values('SB',pg_temp.shift_row('bb600000-0000-4000-8000-00000000000b')),('SC',pg_temp.shift_row('bb600000-0000-4000-8000-00000000000c')),('SA',pg_temp.shift_row('bb600000-0000-4000-8000-00000000000a'));
create function pg_temp.untouched() returns boolean language sql security definer as $$
 select pg_temp.shift_row('bb600000-0000-4000-8000-00000000000b')=(select v from snap where k='SB')
  and pg_temp.shift_row('bb600000-0000-4000-8000-00000000000c')=(select v from snap where k='SC')
  and pg_temp.shift_row('bb600000-0000-4000-8000-00000000000a')=(select v from snap where k='SA')$$;
create function pg_temp.fx(ref text) returns bigint language sql security definer as $$select count(*) from sale_receipt_shift_effects where sale_id=pg_temp.sid(ref)$$;
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');

-- 1. Owner tanpa shift, shift asal TUTUP, struk Tunai: tetap bisa (tidak terkunci), 'tanpa_shift', laci SB/SC tidak disentuh.
select pg_temp.cancel('MT.A1','mt-a1') as r \gset
select pg_temp.ok((:'r'::jsonb->>'shift_mode')='tanpa_shift' and (:'r'::jsonb->>'effect_shift_id') is null and not (:'r'::jsonb->>'effect_in_other_shift')::boolean,'R2-1 hasil: shift_mode tanpa_shift, tanpa efek laci, bukan "shift lain"');
select pg_temp.ok(pg_temp.fx('MT.A1')=0,'R2-1 tidak ada baris efek laci sama sekali');
select pg_temp.ok(pg_temp.untouched(),'R2-1 laci kasir lain (SB, SC) dan shift tertutup SA tidak berubah');
select pg_temp.ok((select shift_mode='tanpa_shift' and effect_shift_id is null and source_shift_status='closed' from pos_receipt_cancellations where sale_id=pg_temp.sid('MT.A1')),'R2-1 catatan pembatalan menandai tanpa_shift');
select pg_temp.ok(pg_temp.net('MT.A1','1111')=0 and pg_temp.net('MT.A1','150001')=100000 and pg_temp.balanced(),'R2-1 jurnal tidak berubah: kas keluar 100.000, piutang naik, neraca nol');
select pg_temp.ok(pg_temp.counted('bb600000-0000-4000-8000-00000000000b','Tunai')=50000 and pg_temp.counted('bb600000-0000-4000-8000-00000000000c','Tunai')=0,'R2-1 hitungan tunai SB=50.000 SC=0 (tak terpengaruh)');

-- 2. Terima ulang Tunai oleh Owner tanpa shift: tanpa_shift, laci lain tak tersentuh.
select pg_temp.receive('MT.A1','mt-a1-r','[{"method":"Tunai","amount":100000}]') as r2 \gset
select pg_temp.ok((:'r2'::jsonb->>'shift_mode')='tanpa_shift' and (:'r2'::jsonb->>'effect_shift_id') is null,'R2-2 terima ulang tunai tanpa shift pelaku: tanpa_shift (tidak ditolak, tidak masuk laci siapa pun)');
select pg_temp.ok(pg_temp.fx('MT.A1')=0 and pg_temp.untouched(),'R2-2 tanpa efek laci; SB/SC/SA tak berubah');
select pg_temp.ok(pg_temp.net('MT.A1','1111')=100000 and pg_temp.balanced(),'R2-2 jurnal: kas masuk lagi 100.000, neraca nol');

-- 3. Owner membuka shift SENDIRI (SO): shift asal tutup -> efek di SO, bukan di SB/SC.
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at) values
 ('bb600000-0000-4000-8000-00000000000d','bb200000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001','petshop',5000,now()-interval '30 minutes');
select pg_temp.cancel('MT.A2','mt-a2') as r3 \gset
select pg_temp.ok((:'r3'::jsonb->>'shift_mode')='shift_pelaku' and (:'r3'::jsonb->>'effect_shift_id')='bb600000-0000-4000-8000-00000000000d' and (:'r3'::jsonb->>'effect_in_other_shift')::boolean,'R2-3 hasil: shift_pelaku di shift terbuka Owner');
select pg_temp.ok((select count(*)=2 and sum(amount) filter(where method='Tunai')=-60000 and sum(amount) filter(where method='QRIS')=-40000 and bool_and(shift_id='bb600000-0000-4000-8000-00000000000d') from sale_receipt_shift_effects where sale_id=pg_temp.sid('MT.A2')),'R2-3 efek -60.000 Tunai, -40.000 QRIS semuanya di SO');
select pg_temp.ok(pg_temp.untouched(),'R2-3 SB dan SC (kasir lain) tidak tersentuh walau terbuka');
select pg_temp.ok((select shift_mode='shift_pelaku' and effect_shift_id='bb600000-0000-4000-8000-00000000000d' from pos_receipt_cancellations where sale_id=pg_temp.sid('MT.A2')),'R2-3 catatan: shift_pelaku');
select pg_temp.receive('MT.A2','mt-a2-r','[{"method":"Tunai","amount":100000}]') as r4 \gset
select pg_temp.ok((:'r4'::jsonb->>'shift_mode')='shift_pelaku' and (:'r4'::jsonb->>'effect_shift_id')='bb600000-0000-4000-8000-00000000000d','R2-4 terima ulang: efek di shift Owner');
select pg_temp.ok((select coalesce(sum(amount) filter(where kind='terima' and method='Tunai'),0)=100000 and bool_and(shift_id='bb600000-0000-4000-8000-00000000000d') from sale_receipt_shift_effects where sale_id=pg_temp.sid('MT.A2')) and pg_temp.untouched(),'R2-4 +100.000 Tunai di SO; SB/SC tak berubah');

-- 4. Shift asal TERBUKA (SB): efek tetap di shift asal walau pelaku punya shift sendiri.
select pg_temp.cancel('MT.B1','mt-b1') as r5 \gset
select pg_temp.ok((:'r5'::jsonb->>'shift_mode')='shift_asal_terbuka' and (:'r5'::jsonb->>'effect_shift_id')='bb600000-0000-4000-8000-00000000000b' and not (:'r5'::jsonb->>'effect_in_other_shift')::boolean,'R2-5 shift asal terbuka: efek di shift asal');
select pg_temp.ok((select count(*)=1 and min(shift_id::text)='bb600000-0000-4000-8000-00000000000b' from sale_receipt_shift_effects where sale_id=pg_temp.sid('MT.B1')),'R2-5 satu efek di SB, bukan di SO');

-- 5. Struk non-tunai, pelaku tanpa shift terbuka: nonkas, tanpa efek.
select pg_temp.close_shift('bb600000-0000-4000-8000-00000000000d');
select pg_temp.cancel('MT.A4','mt-a4') as r6 \gset
select pg_temp.ok((:'r6'::jsonb->>'shift_mode')='nonkas' and (:'r6'::jsonb->>'effect_shift_id') is null and pg_temp.fx('MT.A4')=0,'R2-6 QRIS saja, pelaku tanpa shift: nonkas, tanpa efek di laci lain');

-- 6. FINANCE yang diberi izin lewat Akses Grup: tanpa shift = tanpa_shift; dengan shift sendiri = shift_pelaku. Tidak ke laci kasir lain.
select pg_temp.as_('bb100000-0000-4000-8000-000000000001');
select save_role_access_config('FINANCE',(get_role_access_config('FINANCE')->>'revision'),'bb900000-0000-4000-8000-0000000000f1','custom','["penjualan","kas-bank","pos"]'::jsonb,'{"all_branches":false,"create_accounts":false}'::jsonb,'Uji R2: izin batalkan penerimaan','["penjualan.pos_penerimaan.batalkan"]'::jsonb);
select pg_temp.as_('bb100000-0000-4000-8000-000000000003');
select pg_temp.cancel('MT.A3','mt-a3-fin') as r7 \gset
select pg_temp.ok((:'r7'::jsonb->>'shift_mode')='tanpa_shift' and (:'r7'::jsonb->>'effect_shift_id') is null,'R2-7 FINANCE berizin, tanpa shift: tanpa_shift (tidak ke SB/SC)');
select pg_temp.ok(pg_temp.untouched(),'R2-7 SA/SB/SC tak berubah');
select pg_temp.ok(pg_temp.shift_row('bb600000-0000-4000-8000-00000000000c')=(select v from snap where k='SC') and pg_temp.counted('bb600000-0000-4000-8000-00000000000c','Tunai')=0,'R2-7 SC (kasir 4) tak berubah');
select pg_temp.as_('bb100000-0000-4000-8000-000000000003');
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at) values
 ('bb600000-0000-4000-8000-00000000000e','bb200000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000003','petshop',0,now()-interval '10 minutes');
select pg_temp.receive('MT.A3','mt-a3-r','[{"method":"Transfer","amount":100000}]') as r8 \gset
select pg_temp.ok((:'r8'::jsonb->>'shift_mode')='shift_pelaku' and (:'r8'::jsonb->>'effect_shift_id')='bb600000-0000-4000-8000-00000000000e','R2-8 FINANCE punya shift: terima ulang Transfer jatuh di shift FINANCE sendiri');
select pg_temp.ok((select count(*)=1 and min(shift_id::text)='bb600000-0000-4000-8000-00000000000e' and min(method)='Transfer' from sale_receipt_shift_effects where sale_id=pg_temp.sid('MT.A3') and kind='terima'),'R2-8 efek terima hanya di shift FINANCE');

-- 7. Penutupan laci tetap konsisten: SB ditutup dengan angka yang dihitung dari efek di laci itu diterima; angka basi ditolak (penjaga lama utuh).
select pg_temp.as_('bb100000-0000-4000-8000-000000000006');
select pg_temp.ok((select counted_ok from (select pg_temp.counted('bb600000-0000-4000-8000-00000000000b','Tunai')=0 as counted_ok) z),'R2-9 SB: tunai dihitung 0 (struk B1 dibatalkan di shift asal)');
select pg_temp.reject($q$update cashier_shifts set status='closed',expected_cash=70000,closing_breakdown='{"Tunai":50000,"Transfer":0,"Debit":0,"Kredit":0,"QRIS":0,"E-Wallet":0}' where id='bb600000-0000-4000-8000-00000000000b'$q$,'Hitung ulang','R2-9 penutupan SB dengan angka basi (belum memuat pembatalan) ditolak');
select pg_temp.close_shift('bb600000-0000-4000-8000-00000000000b');
select pg_temp.ok((select status='closed' from cashier_shifts where id='bb600000-0000-4000-8000-00000000000b'),'R2-9 SB tertutup dengan angka yang benar');
select pg_temp.ok(pg_temp.balanced(),'R2 akhir: neraca saldo nol');
rollback;
