-- Input penjualan PETSHOP bertanggal mundur (migrasi *_backdate_input_petshop): fictional fixtures in disposable PostgreSQL only; everything rolls back.
-- Aturan yang dibuktikan: tanggal struk (= created_at) membawa jurnal penjualan/omzet/komisi; stok + HPP HARI INI; uang fisik di shift terbuka;
-- izin Owner / peran dicentang; alasan wajib; 31 hari; periode tertutup, bulan digaji, rekonsiliasi bank ditolak; voucher/promo/poin ditolak;
-- gerbang INSERT di database; idempotensi; diskon manual / bawah modal / lantai HPP tetap berlaku; jejak tidak bisa diubah; ACL.
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
create function pg_temp.dba() returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','',true);end$$;
create function pg_temp.today() returns date language sql as $$select (now() at time zone 'Asia/Jakarta')::date$$;

-- ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────
insert into auth.users(id,raw_user_meta_data) values
 ('bd100000-0000-4000-8000-000000000001','{"full_name":"BD owner"}'),('bd100000-0000-4000-8000-000000000002','{"full_name":"BD admin"}'),
 ('bd100000-0000-4000-8000-000000000003','{"full_name":"BD finance"}'),('bd100000-0000-4000-8000-000000000004','{"full_name":"BD cashier"}'),
 ('bd100000-0000-4000-8000-000000000005','{"full_name":"BD admin other branch"}'),('bd100000-0000-4000-8000-000000000006','{"full_name":"BD cashier two"}');
update profiles set role='OWNER',is_active=true where id='bd100000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id in('bd100000-0000-4000-8000-000000000002','bd100000-0000-4000-8000-000000000005');
update profiles set role='FINANCE',is_active=true where id='bd100000-0000-4000-8000-000000000003';
update profiles set role='STAFF',is_active=true where id in('bd100000-0000-4000-8000-000000000004','bd100000-0000-4000-8000-000000000006');
insert into role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,false),('FINANCE',false,false) on conflict(role) do update set all_branches=false;
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('bd200000-0000-4000-8000-000000000001','BDI1','BDI satu','PETSHOP'),('bd200000-0000-4000-8000-000000000002','BDI2','BDI dua','PETSHOP');
insert into user_branches(user_id,branch_id) values
 ('bd100000-0000-4000-8000-000000000001','bd200000-0000-4000-8000-000000000001'),('bd100000-0000-4000-8000-000000000002','bd200000-0000-4000-8000-000000000001'),
 ('bd100000-0000-4000-8000-000000000003','bd200000-0000-4000-8000-000000000001'),('bd100000-0000-4000-8000-000000000004','bd200000-0000-4000-8000-000000000001'),
 ('bd100000-0000-4000-8000-000000000006','bd200000-0000-4000-8000-000000000001'),('bd100000-0000-4000-8000-000000000005','bd200000-0000-4000-8000-000000000002');
insert into warehouses(id,branch_id,code,name,type) values('bd300000-0000-4000-8000-000000000001','bd200000-0000-4000-8000-000000000001','BDIWH','BDI gudang','RETAIL');
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values
 ('bd400000-0000-4000-8000-000000000001','BDISVC','BDI jasa','pcs','Jasa',0,100000),('bd400000-0000-4000-8000-000000000002','BDIGOOD','BDI barang','pcs','Persediaan',3000,17500),
 ('bd400000-0000-4000-8000-000000000003','BDIGOOD2','BDI barang dua','pcs','Persediaan',5000,20000);
insert into stock(warehouse_id,item_id,qty) values('bd300000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-000000000002',100),('bd300000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-000000000003',50);
insert into stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source) values
 ('bd300000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-000000000002',100,100,3000,'manual'),('bd300000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-000000000003',50,50,5000,'manual');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1111','BDI kas','ASET','D',false),('1112','BDI bank transfer','ASET','D',false),('1113','BDI debit','ASET','D',false),('1114','BDI kredit','ASET','D',false),
 ('1115','BDI qris','ASET','D',false),('1116','BDI ewallet','ASET','D',false),('150001','Piutang Usaha','ASET','D',false),('130009','Piutang Marketplace','ASET','D',false),
 ('510001','Pendapatan','PENDAPATAN','K',false),('520002','Diskon','PENDAPATAN','D',false),('312005','PPN','LIABILITAS','K',false),('600001','HPP','BEBAN','D',false),
 ('170001','Persediaan','ASET','D',false),('810004','Pendapatan lain','PENDAPATAN','K',false),('740020','Komisi marketplace','BEBAN','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values
 ('bd500000-0000-4000-8000-000000000001','BDI kas','Kas','1111'),('bd500000-0000-4000-8000-000000000002','BDI transfer','Bank','1112'),('bd500000-0000-4000-8000-000000000005','BDI qris','Bank','1115');
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','bd200000-0000-4000-8000-000000000001','bd500000-0000-4000-8000-000000000001'),('Transfer','bd200000-0000-4000-8000-000000000001','bd500000-0000-4000-8000-000000000002'),
 ('QRIS','bd200000-0000-4000-8000-000000000001','bd500000-0000-4000-8000-000000000005') on conflict do nothing;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;
insert into customers(id,name,phone) values('bd700000-0000-4000-8000-000000000001','BDI pelanggan','0800000001') on conflict do nothing;
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at) values
 ('bd600000-0000-4000-8000-00000000000a','bd200000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000004','petshop',50000,now()-interval '3 hours'),
 ('bd600000-0000-4000-8000-00000000000b','bd200000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000006','petshop',20000,now()-interval '3 hours'),
 ('bd600000-0000-4000-8000-00000000000c','bd200000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000001','petshop',0,now()-interval '3 hours');

-- simulasi aplikasi: izin tanggal (bila mundur) -> INSERT struk -> INSERT baris -> RPC stok atomik. Dijalankan sebagai peran klien.
create function pg_temp.app_sale(ref text,who text,shift uuid,item uuid,qty numeric,price numeric,eff date,reason text default null,plan_method text default 'Tunai',
 cust uuid default null,extra_item jsonb default '{}',earned integer default 0) returns uuid language plpgsql as $$
declare doc uuid;ts timestamptz:=now();tot numeric:=qty*price;prev text:=current_setting('request.jwt.claim.sub',true);
begin
 perform pg_temp.as_(who);
 if eff is not null then
  perform public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:'||ref,eff,reason);
  ts:=public.pos_sale_backdate_stamp(eff);
 end if;
 insert into sales(branch_id,customer_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
  values('bd200000-0000-4000-8000-000000000001',cust,ref,tot,0,tot,plan_method,tot,0,earned,who::uuid,shift,
   jsonb_build_array(jsonb_build_object('method',plan_method,'amount',tot)),'k:'||ref,repeat('a',64),ts) returning id into doc;
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value,below_hpp_owner_reason)
  values(doc,item,'Barang',qty,price,'pcs',1,0,extra_item->>'dtype',coalesce((extra_item->>'dval')::numeric,0),extra_item->>'below');
 perform public.cashier_post_stock_atomic(doc,'bd300000-0000-4000-8000-000000000001');
 perform pg_temp.as_(prev);
 return doc;
end$$;
create function pg_temp.sid(ref text) returns uuid language sql security definer as $$select id from public.sales where no_struk=$1$$;
create function pg_temp.jnet(ref text,src text,code text,d date) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
 where e.source=$2 and e.source_ref=$1 and a.code=$3 and e.tanggal=$4$$;
create function pg_temp.jcount(ref text) returns integer language sql security definer as $$select count(*)::int from public.journal_entries where source_ref=$1$$;
create function pg_temp.bal_by_date() returns boolean language sql security definer as $$
 select not exists(select 1 from public.journal_entries e join public.journal_lines l on l.entry_id=e.id group by e.branch_id,e.tanggal having sum(l.debit-l.credit)<>0)
  and not exists(select 1 from public.journal_lines group by entry_id having sum(debit-credit)<>0)$$;
create function pg_temp.omzet_sales(d date) returns numeric language sql security definer as $$
 select coalesce(sum(total),0) from public.sales where voided_at is null and (payment_plan is null or payments_finalized_at is not null)
  and created_at>=($1::text||'T00:00:00+07:00')::timestamptz and created_at<(($1+1)::text||'T00:00:00+07:00')::timestamptz and no_struk like 'BDI.%'$$;
create function pg_temp.ledger_day(code text,d date) returns numeric language sql as $$
 select coalesce(sum(t.debit-t.credit),0) from jsonb_to_recordset(public.ledger_account_totals($2,$2,null)) as t(account_id uuid,debit numeric,credit numeric)
 join public.coa_accounts a on a.id=t.account_id where a.code=$1$$;
create function pg_temp.stock_qty() returns numeric language sql security definer as $$select coalesce(sum(qty),0) from public.stock where warehouse_id='bd300000-0000-4000-8000-000000000001'$$;
create function pg_temp.layer_value() returns numeric language sql security definer as $$select coalesce(sum(qty_left*unit_cost),0) from public.stock_layers where warehouse_id='bd300000-0000-4000-8000-000000000001'$$;
create function pg_temp.layer_other() returns text language sql security definer as $$
 select coalesce(string_agg(qty_left::text,',' order by id),'') from public.stock_layers where item_id='bd400000-0000-4000-8000-000000000003'$$;
create function pg_temp.counted(sh uuid,m text) returns numeric language sql security definer as $$
 select coalesce(sum(p.amount),0) from public.sale_payments p join public.sales s on s.id=p.sale_id where p.method=$2 and s.voided_at is null and s.shift_id=$1 and s.payments_finalized_at is not null$$;
create function pg_temp.grant_roles(admin_actions jsonb,fin_actions jsonb,tag text) returns void language plpgsql as $$
begin
 perform save_role_access_config('ADMIN',(get_role_access_config('ADMIN')->>'revision'),('bd9000'||tag||'-0000-4000-8000-000000000001')::uuid,'custom','["penjualan","kasir","pos"]'::jsonb,'{"all_branches":false,"create_accounts":false}'::jsonb,'Uji tanggal mundur input',admin_actions);
 perform save_role_access_config('FINANCE',(get_role_access_config('FINANCE')->>'revision'),('bd9000'||tag||'-0000-4000-8000-000000000002')::uuid,'custom','["penjualan","kas-bank","pos"]'::jsonb,'{"all_branches":false,"create_accounts":false}'::jsonb,'Uji tanggal mundur input',fin_actions);
end$$;

-- ── 0. objek baru ────────────────────────────────────────────────────────────────────────────────────
select pg_temp.ok(to_regprocedure('public.pos_sale_backdate_authorize(uuid,text,date,text)') is not null and to_regprocedure('public.pos_sale_backdate_bounds(uuid)') is not null
 and to_regprocedure('public.pos_sale_backdate_allowed(uuid)') is not null and to_regprocedure('public.pos_sale_backdated(uuid)') is not null and to_regprocedure('public.pos_sale_backdate_check(uuid,date,jsonb)') is not null,'objek baru ada (izin-pakai, batas, izin, penanda, pemeriksaan)');
select pg_temp.ok(to_regclass('public.pos_sale_backdates') is not null and exists(select 1 from pg_trigger where tgname='a0_pos_sale_backdate_gate' and tgrelid='public.sales'::regclass) and exists(select 1 from pg_trigger where tgname='pos_sale_backdate_link' and tgrelid='public.sales'::regclass),'tabel jejak + gerbang INSERT + penaut ada di sales');
select pg_temp.ok(exists(select 1 from role_settings_private.action_catalog where id='penjualan.pos_penjualan.tanggal_mundur' and enforced) and exists(select 1 from role_settings_private.action_modules where id='penjualan.pos_penjualan.tanggal_mundur' and module_id='penjualan'),'izin baru "Tanggal mundur - Input penjualan" terdaftar di Akses Grup');
select pg_temp.ok(position('BACKDATE_INPUT' in pg_get_functiondef('public.finalize_pos_sale(uuid)'::regprocedure))>0 and position('BACKDATE_INPUT' in pg_get_functiondef('public.sale_stock_out_fifo(uuid,uuid,numeric,text,text,date,uuid)'::regprocedure))>0,'dua fungsi resmi ditambal berjangkar (finalize_pos_sale, sale_stock_out_fifo)');
select pg_temp.ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name in('effective_date','tanggal_efektif','backdate_reason')),'tidak ada kolom tanggal baru di sales (tanggal = created_at)');

-- ── 1. KASUS ANDRI: Owner mencatat barang Rp17.500 untuk KEMARIN ─────────────────────────────────────
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*)=0 from pos_sale_backdates),'awal: belum ada jejak tanggal mundur');
create temp table base(q numeric,v numeric,o text);grant all on base to public;
insert into base select pg_temp.stock_qty(),pg_temp.layer_value(),pg_temp.layer_other();
set local role authenticated;
select pg_temp.app_sale('BDI.M1','bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','bd400000-0000-4000-8000-000000000002',1,17500,pg_temp.today()-1,'Barang lupa diinput kemarin (Andri 18 Nov)');
reset role;
select pg_temp.ok((select (created_at at time zone 'Asia/Jakarta')::date=pg_temp.today()-1 and to_char(created_at at time zone 'Asia/Jakarta','HH24:MI')='23:59' and total=17500 and payments_finalized_at>now()-interval '5 minutes' and voided_at is null from sales where no_struk='BDI.M1'),'struk tanggal KEMARIN pukul 23:59 WIB, total 17500; waktu final nyata = sekarang');
select pg_temp.ok(pg_temp.jnet('BDI.M1','sale','1111',pg_temp.today()-1)=17500 and pg_temp.jnet('BDI.M1','sale','510001',pg_temp.today()-1)=-17500,'jurnal penjualan: Kas +17500 dan Pendapatan -17500 di tanggal KEMARIN');
select pg_temp.ok(pg_temp.jcount('BDI.M1')=2 and (select count(*)=0 from journal_entries where source='sale' and source_ref='BDI.M1' and tanggal=pg_temp.today()),'tidak ada jurnal penjualan bertanggal hari ini');
select pg_temp.ok(pg_temp.jnet('BDI.M1','sale-hpp','600001',pg_temp.today())=3000 and pg_temp.jnet('BDI.M1','sale-hpp','170001',pg_temp.today())=-3000 and pg_temp.jnet('BDI.M1','sale-hpp','600001',pg_temp.today()-1)=0,'jurnal HPP 3000 jatuh HARI INI (keputusan 2A), bukan kemarin');
select pg_temp.ok((select count(*)=1 and min(tanggal)=pg_temp.today() and min(qty)=-1 and min(unit_cost)=3000 from stock_moves where source_ref='BDI.M1'),'kartu stok: satu pergerakan keluar HARI INI, biaya FIFO 3000 (lapisan sekarang)');
select pg_temp.ok((select hpp=3000 from sale_items where sale_id=pg_temp.sid('BDI.M1')),'HPP baris = 3000');
select pg_temp.ok(pg_temp.stock_qty()=(select q from base)-1 and pg_temp.layer_value()=(select v from base)-3000 and pg_temp.layer_other()=(select o from base),'stok -1, nilai persediaan -3000, barang lain tidak tersentuh');
select pg_temp.ok((select shift_id='bd600000-0000-4000-8000-00000000000c' from sales where no_struk='BDI.M1') and pg_temp.counted('bd600000-0000-4000-8000-00000000000c','Tunai')=17500,'uang fisik: ikut shift kasir yang terbuka SEKARANG (17500 tunai di laci shift itu)');
select pg_temp.ok((select b.sale_id=pg_temp.sid('BDI.M1') and b.effective_date=pg_temp.today()-1 and b.reason like 'Barang lupa%' and b.actor_id='bd100000-0000-4000-8000-000000000001'
 and b.authorized_at>now()-interval '5 minutes' and b.linked_at>now()-interval '5 minutes' and b.branch_id='bd200000-0000-4000-8000-000000000001' from pos_sale_backdates b where b.checkout_key='k:BDI.M1'),'jejak: pelaku, tanggal efektif, alasan, waktu nyata, cabang, struk tertaut');
select pg_temp.ok(pg_temp.omzet_sales(pg_temp.today()-1)=17500 and pg_temp.omzet_sales(pg_temp.today())=0,'jalur laporan omzet/penjualan: 17500 masuk KEMARIN, 0 hari ini');
select pg_temp.ok(pg_temp.ledger_day('1111',pg_temp.today()-1)=17500 and pg_temp.ledger_day('1111',pg_temp.today())=0 and pg_temp.ledger_day('600001',pg_temp.today())=3000,'jalur Kas-Bank/Arus Kas per hari: kas kemarin +17500; HPP hari ini 3000');
select pg_temp.ok(pg_temp.bal_by_date(),'neraca saldo nol per cabang per tanggal');
select pg_temp.ok((select count(*)=0 from point_ledger where ref='BDI.M1') and (select poin_earned=0 and poin_digunakan=0 from sales where no_struk='BDI.M1'),'tanpa poin (ledger kosong)');
-- tutup shift: angka laci shift ini memuat struk itu; hanya sekali
select pg_temp.ok((select (pg_temp.counted('bd600000-0000-4000-8000-00000000000c','Tunai')+opening_balance)=17500 from cashier_shifts where id='bd600000-0000-4000-8000-00000000000c'),'ekspektasi kas shift = saldo awal + 17500 (tidak dobel, tidak hilang)');

-- ── 2. kontrol: struk HARI INI persis perilaku lama ──────────────────────────────────────────────────
set local role authenticated;
select pg_temp.app_sale('BDI.T1','bd100000-0000-4000-8000-000000000004','bd600000-0000-4000-8000-00000000000a','bd400000-0000-4000-8000-000000000002',2,17500,null);
reset role;
select pg_temp.ok((select (created_at at time zone 'Asia/Jakarta')::date=pg_temp.today() from sales where no_struk='BDI.T1') and not exists(select 1 from pos_sale_backdates where sale_id=pg_temp.sid('BDI.T1')),'KONTROL kasir biasa: struk hari ini, tanpa jejak mundur');
select pg_temp.ok(pg_temp.jnet('BDI.T1','sale','1111',pg_temp.today())=35000 and pg_temp.jnet('BDI.T1','sale-hpp','600001',pg_temp.today())=6000,'KONTROL: jurnal penjualan dan HPP sama-sama hari ini');
select pg_temp.ok(not pg_temp.sv($$select public.pos_sale_backdated((select id from public.sales where no_struk='BDI.T1'))::text$$)::boolean and pg_temp.sv($$select public.pos_sale_backdated((select id from public.sales where no_struk='BDI.M1'))::text$$)::boolean,'penanda struk mundur: benar hanya untuk struk bertanggal mundur');

-- ── 3. izin: Owner, peran dicentang; peran lain/izin lama tidak cukup ─────────────────────────────────
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(get_role_access_config('ADMIN')->'action_catalog') x where x->>'id'='penjualan.pos_penjualan.tanggal_mundur'),'izin muncul di Akses Grup (ADMIN)');
select pg_temp.ok(public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'Owner boleh');
select pg_temp.as_('bd100000-0000-4000-8000-000000000002');
select pg_temp.ok(not public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'ADMIN tanpa centang: TIDAK boleh');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:adm1',pg_temp.today()-1,'alasan cukup')$q$,'tidak punya izin','ADMIN tanpa centang ditolak oleh izin-pakai (42501)');
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
-- izin LAMA (#502 batal/terima mundur) TIDAK memberi hak membuat penjualan baru
select pg_temp.grant_roles('["penjualan.pos_penerimaan.batalkan","penjualan.pos_penerimaan.tanggal_mundur"]'::jsonb,'["penjualan.pos_penerimaan.batalkan","penjualan.pos_penerimaan.tanggal_mundur"]'::jsonb,'01');
select pg_temp.as_('bd100000-0000-4000-8000-000000000002');
select pg_temp.ok(public.pos_receipt_backdate_allowed('bd200000-0000-4000-8000-000000000001') and not public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'izin Tanggal mundur lama (batal penerimaan) tidak memberi hak input penjualan mundur');
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.grant_roles('["penjualan.pos_penjualan.tanggal_mundur"]'::jsonb,'["penjualan.pos_penjualan.tanggal_mundur"]'::jsonb,'02');
select pg_temp.as_('bd100000-0000-4000-8000-000000000002');
select pg_temp.ok(public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'ADMIN dicentang Owner: boleh');
select pg_temp.as_('bd100000-0000-4000-8000-000000000003');
select pg_temp.ok(public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'FINANCE dicentang Owner: boleh');
select pg_temp.as_('bd100000-0000-4000-8000-000000000005');
select pg_temp.ok(not public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'ADMIN cabang lain: tidak boleh di cabang ini');
select pg_temp.as_('bd100000-0000-4000-8000-000000000004');
select pg_temp.ok(not public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'kasir (STAFF): tidak boleh');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:stf1',pg_temp.today()-1,'alasan cukup')$q$,'tidak punya izin','kasir ditolak oleh izin-pakai');
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.grant_roles('[]'::jsonb,'[]'::jsonb,'03');
select pg_temp.as_('bd100000-0000-4000-8000-000000000002');
select pg_temp.ok(not public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'centang dicabut Owner: ADMIN langsung tidak boleh lagi');
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.ok(public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'Owner tidak terkunci walau tak ada kebijakan sama sekali');
select pg_temp.ok(pg_temp.sv($$select (public.pos_sale_backdate_bounds('bd200000-0000-4000-8000-000000000001')->>'can_backdate')$$)::boolean,'batas untuk layar: Owner can_backdate = true');
select pg_temp.as_('bd100000-0000-4000-8000-000000000004');
select pg_temp.ok(not pg_temp.sv($$select (public.pos_sale_backdate_bounds('bd200000-0000-4000-8000-000000000001')->>'can_backdate')$$)::boolean,'batas untuk layar: kasir can_backdate = false (layar tidak menampilkan apa pun)');
select pg_temp.as_('bd100000-0000-4000-8000-000000000005');
select pg_temp.reject($q$select public.pos_sale_backdate_bounds('bd200000-0000-4000-8000-000000000001')$q$,'tidak diizinkan','batas untuk cabang yang bukan miliknya ditolak');

-- ── 4. rentang, alasan, periode, gaji, bank ──────────────────────────────────────────────────────────
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:r0',pg_temp.today(),'alasan cukup')$q$,'sebelum hari ini','hari ini bukan tanggal mundur: ditolak (pakai jalur biasa)');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:r1',pg_temp.today()+1,'alasan cukup')$q$,'sebelum hari ini','masa depan ditolak');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:r2',pg_temp.today()-32,'alasan cukup')$q$,'31 hari','32 hari ke belakang ditolak');
select pg_temp.ok((public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:r3',pg_temp.today()-31,'alasan cukup')->>'authorized')::boolean,'tepat 31 hari ke belakang boleh');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:r4',pg_temp.today()-1,'')$q$,'Alasan','alasan kosong ditolak');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:r5',pg_temp.today()-1,'ab')$q$,'Alasan','alasan 2 huruf ditolak');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:r6',pg_temp.today()-1,repeat('x',201))$q$,'Alasan','alasan 201 huruf ditolak');
select pg_temp.ok((public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:r7',pg_temp.today()-1,'abc')->>'authorized')::boolean,'alasan 3 huruf (batas bawah) boleh');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize(null,'k:r8',pg_temp.today()-1,'alasan cukup')$q$,'tidak valid','cabang kosong ditolak');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:r9',null,'alasan cukup')$q$,'tidak valid','tanggal kosong ditolak');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','','2026-01-01','alasan cukup')$q$,'tidak valid','kunci checkout kosong ditolak');
-- periode tertutup
update accounting_locks set closed_until=pg_temp.today()-2;
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:c1',pg_temp.today()-2,'alasan cukup')$q$,'ditutup buku','tepat di tanggal tutup buku ditolak');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:c2',pg_temp.today()-5,'alasan cukup')$q$,'ditutup buku','sebelum tanggal tutup buku ditolak');
select pg_temp.ok((public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:c3',pg_temp.today()-1,'alasan cukup')->>'authorized')::boolean,'sehari setelah tutup buku boleh');
select pg_temp.ok((select (b->>'effective_min')::date=pg_temp.today()-1 and (b->>'closed_until')::date=pg_temp.today()-2 and (b->>'max_date')::date=pg_temp.today()-1 from (select public.pos_sale_backdate_bounds('bd200000-0000-4000-8000-000000000001') b) z),'batas untuk layar: min = sesudah tutup buku, maks = kemarin');
-- struk bertanggal di periode tertutup juga ditolak oleh jalur resmi (pagar DB lama) bila izin dipalsukan: INSERT langsung sebagai pemilik
update accounting_locks set closed_until=null;
-- penggajian
insert into employees(id,nama) values('bd800000-0000-4000-8000-000000000001','BDI karyawan') on conflict do nothing;
insert into payrolls(periode,employee_id) values(to_char(pg_temp.today()-3,'YYYY-MM'),'bd800000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:g1',pg_temp.today()-3,'alasan cukup')$q$,'Penggajian','bulan yang sudah digaji ditolak');
delete from payrolls where employee_id='bd800000-0000-4000-8000-000000000001';
select pg_temp.ok((public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:g2',pg_temp.today()-3,'alasan cukup')->>'authorized')::boolean,'bulan belum digaji: boleh');
-- rekonsiliasi bank (metode non-tunai pada rekening yang direkonsiliasi) diperiksa saat INSERT struk
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code) values(pg_temp.today()-1,'bd500000-0000-4000-8000-000000000005','1115');
select pg_temp.ok(pg_temp.sv($$select public.pos_sale_backdate_check('bd200000-0000-4000-8000-000000000001',current_date-2,'[{"method":"QRIS","amount":1}]'::jsonb) like 'Rekonsiliasi bank%'$$)::boolean,'pemeriksaan: QRIS pada rekening yang sudah direkonsiliasi sesudah tanggal itu ditolak');
select pg_temp.ok(pg_temp.sv($$select (public.pos_sale_backdate_check('bd200000-0000-4000-8000-000000000001',current_date-2,'[{"method":"Tunai","amount":1}]'::jsonb) is null)::text$$)::boolean,'pemeriksaan: Tunai (rekening lain) tidak terhalang rekonsiliasi QRIS');
select pg_temp.ok(pg_temp.sv($$select (public.pos_sale_backdate_check('bd200000-0000-4000-8000-000000000001',current_date-2,null) is null)::text$$)::boolean,'pemeriksaan pratinjau (tanpa rencana bayar) tidak menolak karena bank');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.app_sale('BDI.B1','bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','bd400000-0000-4000-8000-000000000002',1,17500,pg_temp.today()-2,'qris mundur','QRIS')$q$,'Rekonsiliasi bank','INSERT struk QRIS mundur ditolak database karena rekonsiliasi bank');
reset role;
select pg_temp.ok((select count(*)=0 from sales where no_struk='BDI.B1') and pg_temp.stock_qty()=(select q from base)-3,'penolakan bank tidak meninggalkan struk dan tidak memotong stok');
delete from bank_reconciliations;

-- ── 5. gerbang INSERT di database (peran klien tidak bisa memasang tanggal sendiri) ───────────────────
set local role authenticated;
select pg_temp.as_('bd100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('bd200000-0000-4000-8000-000000000001','BDI.G1',100,0,100,'Tunai',100,0,0,'bd100000-0000-4000-8000-000000000004','bd600000-0000-4000-8000-00000000000a','[{"method":"Tunai","amount":100}]','k:G1',repeat('a',64),now()-interval '2 days')$q$,'Tanggal struk mundur tidak diizinkan','kasir biasa: INSERT langsung struk bertanggal kemarin ditolak (lubang lama tertutup)');
select pg_temp.reject($q$insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('bd200000-0000-4000-8000-000000000001','BDI.G2',100,0,100,'Tunai',100,0,0,'bd100000-0000-4000-8000-000000000004','bd600000-0000-4000-8000-00000000000a','[{"method":"Tunai","amount":100}]','k:G2',repeat('a',64),now()+interval '2 days')$q$,'masa depan','INSERT langsung struk bertanggal masa depan ditolak');
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('bd200000-0000-4000-8000-000000000001','BDI.G3',100,0,100,'Tunai',100,0,0,'bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','[{"method":"Tunai","amount":100}]','k:G3-none',repeat('a',64),public.pos_sale_backdate_stamp(pg_temp.today()-1))$q$,'Tanggal struk mundur tidak diizinkan','Owner pun: tanpa izin-pakai, INSERT bertanggal mundur ditolak');
select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:G4',pg_temp.today()-1,'uji gerbang');
select pg_temp.reject($q$insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('bd200000-0000-4000-8000-000000000001','BDI.G4',100,0,100,'Tunai',100,0,0,'bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','[{"method":"Tunai","amount":100}]','k:G4',repeat('a',64),public.pos_sale_backdate_stamp(pg_temp.today()-2))$q$,'Tanggal struk mundur tidak diizinkan','izin untuk kemarin tidak berlaku untuk tanggal lain (2 hari lalu)');
select pg_temp.reject($q$insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('bd200000-0000-4000-8000-000000000001','BDI.G4',100,0,100,'Tunai',100,0,0,'bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','[{"method":"Tunai","amount":100}]','k:G4',repeat('a',64),public.pos_sale_backdate_stamp(pg_temp.today()-1)-interval '2 hours')$q$,'Tanggal struk mundur tidak diizinkan','jam struk harus persis jam izin (23:59), tidak boleh bebas');
select pg_temp.reject($q$insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('bd200000-0000-4000-8000-000000000001','BDI.G4',100,0,100,'Tunai',100,0,0,'bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','[{"method":"Tunai","amount":100}]','k:lain',repeat('a',64),public.pos_sale_backdate_stamp(pg_temp.today()-1))$q$,'Tanggal struk mundur tidak diizinkan','kunci checkout lain tidak memakai izin itu');
select pg_temp.reject($q$insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('bd200000-0000-4000-8000-000000000002','BDI.G4',100,0,100,'Tunai',100,0,0,'bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','[{"method":"Tunai","amount":100}]','k:G4',repeat('a',64),public.pos_sale_backdate_stamp(pg_temp.today()-1))$q$,'izin tanggal mundur tidak ditemukan','izin cabang A tidak berlaku untuk cabang B');
select pg_temp.reject($q$insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('bd200000-0000-4000-8000-000000000001','BDI.G4',100,0,100,'Tunai',100,0,0,'bd100000-0000-4000-8000-000000000004','bd600000-0000-4000-8000-00000000000a','[{"method":"Tunai","amount":100}]','k:G4',repeat('a',64),public.pos_sale_backdate_stamp(pg_temp.today()-1))$q$,'Tanggal struk mundur tidak diizinkan.','izin Owner tidak bisa dipakai membuat struk atas nama kasir lain');
reset role;
-- poin/voucher/kampanye pada header mundur ditolak di INSERT (peran klien)
set local role authenticated;
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select pg_temp.app_sale('BDI.P1','bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','bd400000-0000-4000-8000-000000000002',1,17500,pg_temp.today()-1,'uji poin','Tunai','bd700000-0000-4000-8000-000000000001','{}',17)$q$,'dan poin tidak berlaku','poin didapat pada struk mundur ditolak di INSERT (gerbang header)');
reset role;
select pg_temp.ok((select count(*)=0 from sales where no_struk='BDI.P1') and (select count(*)=0 from point_ledger where ref='BDI.P1'),'penolakan poin: tak ada struk, tak ada ledger poin');
-- izin dicabut antara izin-pakai dan INSERT (kedaluwarsa dan pencabutan)
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.grant_roles('["penjualan.pos_penjualan.tanggal_mundur"]'::jsonb,'[]'::jsonb,'04');
select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:E1',pg_temp.today()-1,'uji kedaluwarsa');
update pos_sale_backdates set authorized_at=now()-interval '16 minutes' where checkout_key='k:E1';
set local role authenticated;
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('bd200000-0000-4000-8000-000000000001','BDI.E1',100,0,100,'Tunai',100,0,0,'bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','[{"method":"Tunai","amount":100}]','k:E1',repeat('a',64),public.pos_sale_backdate_stamp(pg_temp.today()-1))$q$,'kedaluwarsa','izin-pakai > 15 menit kedaluwarsa');
reset role;
-- ADMIN dicentang lalu dicabut sebelum INSERT: ditolak saat INSERT (bukan hanya saat izin-pakai)
select pg_temp.as_('bd100000-0000-4000-8000-000000000002');
select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:E2',pg_temp.today()-1,'uji cabut');
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.grant_roles('[]'::jsonb,'[]'::jsonb,'05');
set local role authenticated;
select pg_temp.as_('bd100000-0000-4000-8000-000000000002');
select pg_temp.reject($q$insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('bd200000-0000-4000-8000-000000000001','BDI.E2',100,0,100,'Tunai',100,0,0,'bd100000-0000-4000-8000-000000000002',null,'[{"method":"Tunai","amount":100}]','k:E2',repeat('a',64),public.pos_sale_backdate_stamp(pg_temp.today()-1))$q$,'tidak punya izin','izin dicabut setelah izin-pakai: INSERT tetap ditolak');
reset role;

-- ── 6. promo, voucher, poin: pagar terakhir di finalize_pos_sale (jalur pemilik fungsi, tanpa gerbang INSERT) ──
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
create function pg_temp.fin_sale(ref text,mut text) returns text language plpgsql as $$
declare doc uuid;msg text:=null;
begin
 perform pg_temp.as_('bd100000-0000-4000-8000-000000000001');
 insert into public.pos_sale_backdates(actor_id,branch_id,checkout_key,effective_date,reason) values('bd100000-0000-4000-8000-000000000001','bd200000-0000-4000-8000-000000000001','k:'||ref,pg_temp.today()-1,'uji finalisasi');
 insert into sales(branch_id,customer_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
  values('bd200000-0000-4000-8000-000000000001','bd700000-0000-4000-8000-000000000001',ref,17500,case when mut='promo' then 1000 else 0 end,case when mut='promo' then 16500 else 17500 end,'Tunai',case when mut='promo' then 16500 else 17500 end,0,case when mut='poin' then 5 else 0 end,
   'bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c',
   jsonb_build_array(jsonb_build_object('method','Tunai','amount',case when mut='promo' then 16500 else 17500 end)),'k:'||ref,repeat('a',64),public.pos_sale_backdate_stamp(pg_temp.today()-1)) returning id into doc;
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,promo_discount)
  values(doc,'bd400000-0000-4000-8000-000000000002','Barang',1,17500,'pcs',1,0,case when mut='promo' then 1000 else 0 end);
 begin perform public.cashier_post_stock_atomic(doc,'bd300000-0000-4000-8000-000000000001');exception when others then msg:=sqlerrm;end;
 return coalesce(msg,'OK');
end$$;
select pg_temp.ok(pg_temp.fin_sale('BDI.F0','none')='OK','kontrol finalisasi: struk mundur polos lolos lewat jalur pemilik');
select pg_temp.ok(pg_temp.fin_sale('BDI.F1','poin') like '%tidak berlaku%','finalisasi menolak poin didapat pada struk mundur');
select pg_temp.ok(pg_temp.fin_sale('BDI.F2','promo') like '%tidak berlaku%','finalisasi menolak potongan promo pada baris struk mundur');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref in('BDI.F1','BDI.F2')) and (select count(*)=0 from journal_entries where source_ref in('BDI.F1','BDI.F2')),'penolakan finalisasi: tak ada stok keluar dan tak ada jurnal');
select pg_temp.ok((select payments_finalized_at is null from sales where no_struk='BDI.F2'),'struk yang ditolak tetap belum final (aplikasi menghapusnya)');

-- ── 7. diskon manual, bawah modal, lantai HPP tetap berlaku ──────────────────────────────────────────
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.grant_roles('["penjualan.pos_penjualan.tanggal_mundur"]'::jsonb,'[]'::jsonb,'06');
set local role authenticated;
-- lantai HPP: harga 1000 < HPP 3000 tanpa alasan/izin: ditolak (Owner sekalipun tanpa alasan obral)
select pg_temp.reject($q$select pg_temp.app_sale('BDI.L1','bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','bd400000-0000-4000-8000-000000000002',1,1000,pg_temp.today()-1,'uji lantai')$q$,'di bawah HPP','lantai HPP FIFO tetap berlaku di struk mundur (harga 1000 < HPP 3000)');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='BDI.L1') and (select count(*)=0 from sales where no_struk='BDI.L1'),'penolakan lantai: tak ada stok keluar, struk dibatalkan (savepoint)');
-- obral di bawah modal: Owner + alasan -> boleh dan tercatat
select pg_temp.app_sale('BDI.L2','bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','bd400000-0000-4000-8000-000000000002',1,1000,pg_temp.today()-1,'uji obral','Tunai',null,'{"below":"Obral cuci gudang"}');
reset role;
select pg_temp.ok((select below_hpp_owner_by='bd100000-0000-4000-8000-000000000001' and below_hpp_loss=2000 from sale_items where sale_id=pg_temp.sid('BDI.L2')),'obral Owner (alasan) di struk mundur: tercatat pelaku dan rugi 2000 (aturan #524 utuh)');
select pg_temp.ok(pg_temp.jnet('BDI.L2','sale','510001',pg_temp.today()-1)=-1000 and pg_temp.jnet('BDI.L2','sale-hpp','600001',pg_temp.today())=3000,'obral mundur: pendapatan 1000 kemarin, HPP 3000 hari ini');
-- diskon manual (#512): ADMIN dicentang mundur TANPA izin diskon manual ditolak; Owner boleh
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.ok(not pg_temp.sv($$select public.manual_discount_allowed()::text$$)::boolean=false,'Owner memegang izin diskon manual (kontrol)');
select pg_temp.as_('bd100000-0000-4000-8000-000000000002');
select pg_temp.ok(not coalesce(pg_temp.sv($$select public.manual_discount_allowed()::text$$)::boolean,false),'ADMIN dicentang mundur tidak otomatis boleh diskon manual (kontrol)');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.app_sale('BDI.D1','bd100000-0000-4000-8000-000000000002',null,'bd400000-0000-4000-8000-000000000003',1,20000,pg_temp.today()-1,'uji diskon','Tunai',null,'{"dtype":"nominal","dval":1000}')$q$,'','diskon manual ADMIN tanpa izin ditolak walau tanggal mundur diizinkan');
reset role;
select pg_temp.ok((select count(*)=0 from sales where no_struk='BDI.D1'),'penolakan diskon: tak ada struk');

-- (ADMIN sedang dicentang dari langkah 7)
-- galat membaca kebijakan: gagal-tertutup untuk peran lain, Owner tetap boleh
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
create temp table fdef as select pg_get_functiondef('public.role_action_allowed(text)'::regprocedure) d;
create or replace function public.role_action_allowed(p_action text) returns boolean language plpgsql security definer set search_path='' as $$begin raise exception 'boom';end$$;
select pg_temp.as_('bd100000-0000-4000-8000-000000000002');
select pg_temp.ok(not public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'galat membaca kebijakan: ADMIN dicentang tetap TIDAK boleh (gagal-tertutup)');
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.ok(public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'galat membaca kebijakan: Owner tetap boleh');
do $r$ begin execute (select d from fdef); end $r$;
-- peran bukan ADMIN/FINANCE tidak pernah boleh, walau ada baris kebijakan untuknya
select pg_temp.dba();
insert into role_settings_private.action_policies(role,allowed) values('STAFF',array['penjualan.pos_penjualan.tanggal_mundur']) on conflict(role) do update set allowed=excluded.allowed;
select pg_temp.as_('bd100000-0000-4000-8000-000000000004');
select pg_temp.ok(not public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'kasir (STAFF) tidak boleh walau ada baris kebijakan berisi izin ini');
select pg_temp.dba();
delete from role_settings_private.action_policies where role='STAFF';
-- tanpa baris kebijakan sama sekali: role_action_allowed memberi lolos-lama; izin baru harus tetap MATI
select pg_temp.dba();
create temp table polbak as select * from role_settings_private.action_policies where role='ADMIN';
delete from role_settings_private.action_policies where role='ADMIN';
select pg_temp.as_('bd100000-0000-4000-8000-000000000002');
select pg_temp.ok(not public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'ADMIN tanpa baris kebijakan: izin baru tetap MATI (bukan lolos-lama)');
select pg_temp.dba();
insert into role_settings_private.action_policies select * from polbak;
select pg_temp.as_('bd100000-0000-4000-8000-000000000002');
select pg_temp.ok(public.pos_sale_backdate_allowed('bd200000-0000-4000-8000-000000000001'),'kebijakan ADMIN dipulihkan: boleh lagi (kontrol)');

-- ── 8. idempotensi izin-pakai dan jejak ──────────────────────────────────────────────────────────────
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.ok((select (public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:BDI.M1',pg_temp.today()-1,'apa pun')->>'reused')::boolean and (public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:BDI.M1',pg_temp.today()-1,'apa pun')->>'sale_id')::uuid=pg_temp.sid('BDI.M1')),'kunci sama + tanggal sama setelah struk jadi: jawaban sama, menunjuk struk yang sama (tidak ada baris baru)');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:BDI.M1',pg_temp.today()-2,'tanggal lain')$q$,'sudah dipakai untuk struk tanggal','kunci sama + tanggal beda setelah struk jadi: ditolak');
select pg_temp.ok((select count(*)=1 from pos_sale_backdates where checkout_key='k:BDI.M1'),'tetap satu baris jejak per kunci');
select pg_temp.ok((public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:Z1',pg_temp.today()-1,'pertama')->>'reused')::boolean=false,'draft baru: izin-pakai dibuat (reused=false)');
select pg_temp.ok((public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:Z1',pg_temp.today()-2,'ganti tanggal')->>'authorized')::boolean,'sebelum ada struk: tanggal/alasan boleh diganti pada draft yang sama');
select pg_temp.ok((select effective_date=pg_temp.today()-2 and reason='ganti tanggal' from pos_sale_backdates where checkout_key='k:Z1'),'penggantian tercatat (tanggal dan alasan baru)');
select pg_temp.ok((select count(*)=1 from pos_sale_backdates where checkout_key='k:Z1'),'penggantian tidak menggandakan baris');
-- struk gagal dihapus (aplikasi membersihkan): jejak dilepas, bisa dicoba ulang dengan kunci sama
delete from sales where no_struk='BDI.F2';
select pg_temp.ok((select sale_id is null and linked_at is not null from pos_sale_backdates where checkout_key='k:BDI.F2'),'struk gagal dihapus: baris jejak tetap ada, tertaut dilepas (sale_id null)');
select pg_temp.reject($q$delete from pos_sale_backdates where checkout_key='k:BDI.M1'$q$,'tidak dapat dihapus','jejak tidak bisa dihapus (pemilik pun)');
select pg_temp.reject($q$update pos_sale_backdates set reason='diubah diam-diam' where checkout_key='k:BDI.M1'$q$,'tidak dapat diubah','jejak yang sudah dipakai tidak bisa diubah');
select pg_temp.reject($q$update pos_sale_backdates set effective_date=effective_date-1 where checkout_key='k:BDI.M1'$q$,'tidak dapat diubah','tanggal jejak tidak bisa diubah');
select pg_temp.reject($q$update pos_sale_backdates set actor_id='bd100000-0000-4000-8000-000000000002' where checkout_key='k:Z1'$q$,'tidak dapat diubah','pelaku jejak tidak bisa diganti');
select pg_temp.reject($q$insert into pos_sale_backdates(actor_id,branch_id,checkout_key,effective_date,reason) values('bd100000-0000-4000-8000-000000000001','bd200000-0000-4000-8000-000000000001','k:BDI.M1',pg_temp.today()-3,'dobel')$q$,'','kunci (pelaku, kunci checkout) unik');
select pg_temp.reject($q$insert into pos_sale_backdates(actor_id,branch_id,checkout_key,effective_date,reason) values('bd100000-0000-4000-8000-000000000001','bd200000-0000-4000-8000-000000000001','k:Q1',pg_temp.today(),'hari ini')$q$,'','tanggal jejak hari ini ditolak (check)') ;
-- pengulangan checkout dengan kunci sama (double klik): tidak ada struk kedua
set local role authenticated;
select pg_temp.app_sale('BDI.M1b','bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','bd400000-0000-4000-8000-000000000002',1,17500,pg_temp.today()-1,'pertama');
select pg_temp.reject($q$insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,created_at)
 values('bd200000-0000-4000-8000-000000000001','BDI.M1c',100,0,100,'Tunai',100,0,0,'bd100000-0000-4000-8000-000000000001','bd600000-0000-4000-8000-00000000000c','[{"method":"Tunai","amount":100}]','k:BDI.M1b',repeat('a',64),public.pos_sale_backdate_stamp(pg_temp.today()-1))$q$,'','kunci checkout yang sama tidak bisa membuat struk kedua (izin sudah terpakai / unik per kasir)');
reset role;
select pg_temp.ok((select count(*)=1 from sales where checkout_key='k:BDI.M1b') and (select count(*)=0 from sales where no_struk='BDI.M1c'),'double klik: tepat satu struk');

-- ── 9. struk mundur dibatalkan / penerimaan dibatalkan: rantai tetap seimbang ─────────────────────────
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.ok((select (public.pos_receipt_date_bounds(pg_temp.sid('BDI.M1'),'cancel')->>'min_date')::date=pg_temp.today()-1),'Batalkan penerimaan #502 pada struk mundur: batas bawah tanggal = tanggal mundur (kemarin)');
select pg_temp.ok((public.cancel_pos_sale_receipt(pg_temp.sid('BDI.M1'),(select revision from sales where no_struk='BDI.M1'),'bm1-c','Pelanggan batal bayar',pg_temp.today()-1)->>'effective_date')::date=pg_temp.today()-1,'Batalkan penerimaan struk mundur dengan tanggal efektif kemarin: berhasil');
select pg_temp.ok(pg_temp.jnet('BDI.M1','sale','1111',pg_temp.today()-1)=17500 and pg_temp.bal_by_date(),'jurnal penjualan kemarin tidak ditulis ulang; neraca saldo tetap seimbang per tanggal');
select pg_temp.ok((public.cancel_posted_sale(pg_temp.sid('BDI.L2'),(select revision from sales where no_struk='BDI.L2'),'bl2-c','Salah catat obral')->>'voided')::boolean,'Batalkan penjualan (Owner) struk mundur: berhasil walau jurnal HPP-nya hari ini');
select pg_temp.ok(pg_temp.bal_by_date() and (select coalesce(sum(l.debit-l.credit),0)=0 from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where e.source_ref='BDI.L2' or e.source_ref in(select id::text from sale_cancellations where sale_id=pg_temp.sid('BDI.L2'))),'rantai struk mundur yang dibatalkan nol (semua akun) dan stok kembali');
select pg_temp.ok((select count(*)=2 from stock_moves where source_ref='BDI.L2' or sale_line_id in(select id from sale_items where sale_id=pg_temp.sid('BDI.L2')) or source_ref in(select id::text from sale_cancellations where sale_id=pg_temp.sid('BDI.L2')) or source_ref='BDI.L2'),'stok: satu keluar + satu kembali tercatat untuk struk yang dibatalkan');

-- ── 10. ACL ──────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.ok(not has_function_privilege('anon','public.pos_sale_backdate_authorize(uuid,text,date,text)','EXECUTE') and has_function_privilege('authenticated','public.pos_sale_backdate_authorize(uuid,text,date,text)','EXECUTE'),'izin-pakai: anon tidak, authenticated ya');
select pg_temp.ok(not has_function_privilege('authenticated','public.pos_sale_backdated(uuid)','EXECUTE') and not has_function_privilege('authenticated','public.pos_sale_backdate_check(uuid,date,jsonb)','EXECUTE') and not has_function_privilege('anon','public.pos_sale_backdate_allowed(uuid)','EXECUTE'),'fungsi internal (penanda, pemeriksaan) tidak bisa dipanggil klien; izin tidak untuk anon');
select pg_temp.ok(not has_table_privilege('authenticated','public.pos_sale_backdates','INSERT') and not has_table_privilege('authenticated','public.pos_sale_backdates','UPDATE') and not has_table_privilege('authenticated','public.pos_sale_backdates','DELETE') and has_table_privilege('authenticated','public.pos_sale_backdates','SELECT') and not has_table_privilege('anon','public.pos_sale_backdates','SELECT'),'tabel jejak: klien hanya membaca (RLS), tidak menulis; anon tidak');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.pos_sale_backdates'::regclass),'RLS aktif pada tabel jejak');
set local role authenticated;
select pg_temp.as_('bd100000-0000-4000-8000-000000000005');
select pg_temp.ok((select count(*)=0 from pos_sale_backdates),'jejak cabang lain tidak terbaca oleh ADMIN cabang 2');
select pg_temp.as_('bd100000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*)>=3 from pos_sale_backdates),'Owner membaca jejak');
select pg_temp.reject($q$insert into pos_sale_backdates(actor_id,branch_id,checkout_key,effective_date,reason) values('bd100000-0000-4000-8000-000000000001','bd200000-0000-4000-8000-000000000001','k:acl',pg_temp.today()-1,'langsung')$q$,'','klien tidak bisa menulis jejak langsung');
reset role;

-- ── 11. Admin Online (#549): pagar baca/tulis dan penjaga fungsi ikut ke objek baru ───────────────────────────
select pg_temp.ok((select count(*)=1 from pg_trigger where tgrelid='public.pos_sale_backdates'::regclass and tgname='zz_admin_online_write_fence') and (select count(*)=1 from pg_policy where polrelid='public.pos_sale_backdates'::regclass and polname='admin_online_fence_r'),'tabel jejak: pagar tulis + pagar baca Admin Online terpasang');
select pg_temp.ok((select count(*)=0 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in('pos_sale_backdate_authorize','pos_sale_backdate_bounds','pos_sale_backdate_allowed','pos_sale_backdate_stamp','pos_sale_backdate_gate_check') and p.prosecdef and p.prosrc !~ 'deny_admin_online'),'fungsi klien SECURITY DEFINER baru: penjaga Admin Online terpasang');
select pg_temp.ok(position('deny_admin_online' in pg_get_functiondef('public.finalize_pos_sale(uuid)'::regprocedure))>0 and position('BACKDATE_INPUT' in pg_get_functiondef('public.finalize_pos_sale(uuid)'::regprocedure))>0,'finalize_pos_sale: penjaga Admin Online lama tetap ada bersama tambalan tanggal mundur');
insert into auth.users(id,raw_user_meta_data) values('bd100000-0000-4000-8000-0000000000a1','{"full_name":"BD admin online"}');
update profiles set role='ADMIN_ONLINE',is_active=true where id='bd100000-0000-4000-8000-0000000000a1';
insert into user_branches(user_id,branch_id) values('bd100000-0000-4000-8000-0000000000a1','bd200000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.as_('bd100000-0000-4000-8000-0000000000a1');
select pg_temp.reject($q$select public.pos_sale_backdate_authorize('bd200000-0000-4000-8000-000000000001','k:ao',pg_temp.today()-1,'coba admin online')$q$,'ADMIN_ONLINE_FUNCTION_DENIED','Admin Online tidak bisa membuka izin tanggal mundur');
select pg_temp.ok((select count(*)=0 from pos_sale_backdates),'Admin Online tidak bisa membaca jejak tanggal mundur');
reset role;
select pg_temp.ok(pg_temp.bal_by_date(),'akhir: neraca saldo nol per cabang per tanggal untuk seluruh uji');
rollback;
