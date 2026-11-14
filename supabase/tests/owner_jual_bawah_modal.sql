-- Owner jual di bawah modal (migrasi 20261118100000_owner_jual_bawah_modal.sql). Fixture fiktif; semua di-rollback.
-- Dijalankan di rantai penuh SESUDAH migrasi (GREEN) atau tanpa migrasi (RED: gagal di preflight/kasus pertama).
-- Dibuktikan: Owner + alasan menjual Persediaan di bawah HPP (stok, HPP, jurnal benar dan seimbang); peran lain tidak (walau kolom dipalsukan);
-- tanpa alasan, harga neto nol, HPP Rp0 (COST_MISSING), jasa/paket, baris promo-waiver tetap ditolak; izin Akses Grup (bawaan mati);
-- tabel kebijakan hilang -> Owner tetap lolos; ubah transaksi membawa alasan; laporan.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;raise notice 'OB_PASS %',label;end$$;
create function pg_temp.reject(stmt text, expected text, label text) returns void language plpgsql as $$
declare failed boolean:=false;msg text;begin
 begin execute stmt;exception when others then failed:=true;msg:=sqlerrm;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
 if position(expected in msg)=0 then raise exception 'Unexpected rejection for %: %',label,msg;end if;
 raise notice 'OB_PASS %',label;
end$$;
create function pg_temp.as_(uid text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',uid,true);perform set_config('request.jwt.claims','{"role":"authenticated","sub":"'||uid||'"}',true);end$$;
create function pg_temp.u(k text) returns uuid language sql as $$
 select ('ab100000-0000-4000-8000-00000000000'||case $1 when 'OWNER' then '1' when 'ADMIN' then '2' when 'FINANCE' then '3' when 'STAFF' then '4' when 'DOCTOR' then '5' when 'GRANTED' then '6' when 'ADMINGR' then '7' else '9' end)::uuid $$;
create function pg_temp.sh(k text) returns uuid language sql as $$ select ('ab600000-0000-4000-8000-00000000000'||substr(pg_temp.u($1)::text,36,1))::uuid $$;

-- ── fixtures ──
insert into auth.users(id,raw_user_meta_data) select pg_temp.u(k),('{"full_name":"OB '||k||'"}')::jsonb from unnest(array['OWNER','ADMIN','FINANCE','STAFF','DOCTOR','GRANTED','ADMINGR']) k;
update profiles set role='OWNER',is_active=true where id=pg_temp.u('OWNER');
update profiles set role='ADMIN',is_active=true where id=pg_temp.u('ADMIN');
update profiles set role='FINANCE',is_active=true where id=pg_temp.u('FINANCE');
update profiles set role='STAFF',is_active=true where id=pg_temp.u('STAFF');
update profiles set role='DOCTOR',is_active=true where id=pg_temp.u('DOCTOR');
update profiles set role='STAFF',is_active=true where id=pg_temp.u('GRANTED');
update profiles set role='ADMIN',is_active=true where id=pg_temp.u('ADMINGR');
insert into role_modules(role,module_id) values('STAFF','pos'),('FINANCE','penjualan') on conflict do nothing;
insert into branches(id,code,name,type) values('ab200000-0000-4000-8000-000000000001','OBB1','OB satu','PETSHOP');
insert into user_branches(user_id,branch_id) select pg_temp.u(k),'ab200000-0000-4000-8000-000000000001' from unnest(array['OWNER','ADMIN','FINANCE','STAFF','DOCTOR','GRANTED','ADMINGR']) k;
insert into warehouses(id,branch_id,code,name,type) values('ab300000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','OBWH','OB gudang','RETAIL');
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values
 ('ab400000-0000-4000-8000-000000000001','OBGOOD','Crystal Kitty fiktif','pcs','Persediaan',26076,35000),
 ('ab400000-0000-4000-8000-000000000002','OBJASA','OB jasa','x','Jasa',0,20000),
 ('ab400000-0000-4000-8000-000000000003','OBZERO','OB tanpa modal','pcs','Persediaan',0,35000),
 ('ab400000-0000-4000-8000-000000000004','OBGRUP','OB paket','set','Grup',0,40000),
 ('ab400000-0000-4000-8000-000000000005','OBHIGH','OB modal murah','pcs','Persediaan',1000,35000);
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values('ab400000-0000-4000-8000-000000000004','ab400000-0000-4000-8000-000000000001',1,'pcs',1);
insert into stock(warehouse_id,item_id,qty) values
 ('ab300000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000001',60),
 ('ab300000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000003',10),
 ('ab300000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000005',50);
insert into stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source) values
 ('ab300000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000001',60,60,26076,'manual'),
 ('ab300000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000003',10,10,0,'manual'),
 ('ab300000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000005',50,50,1000,'manual');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1191','OB kas','ASET','D',false),('510001','Pendapatan','PENDAPATAN','K',false),('520002','Diskon','PENDAPATAN','D',false),('312005','PPN','LIABILITAS','K',false),
 ('600001','HPP','BEBAN','D',false),('170001','Persediaan','ASET','D',false),('810004','Pendapatan lain','PENDAPATAN','K',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values('ab500000-0000-4000-8000-000000000001','OB kas','Kas','1191');
insert into payment_account_map(metode,branch_id,cash_account_id) values('Tunai','ab200000-0000-4000-8000-000000000001','ab500000-0000-4000-8000-000000000001') on conflict do nothing;
insert into customers(id,name,phone,points) values('ab700000-0000-4000-8000-000000000001','OB pelanggan','0800000099',0);
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance) select pg_temp.sh(k),'ab200000-0000-4000-8000-000000000001',pg_temp.u(k),'petshop',0
 from unnest(array['OWNER','ADMIN','FINANCE','STAFF','DOCTOR','GRANTED','ADMINGR']) k;

-- Penjualan satu baris: sebagai pengguna k, header + baris, lalu posting kasir atomik. Hasil 'OK' atau pesan galat (semua dibatalkan).
-- forge = baris ditulis tanpa pengguna login (SQL editor/penyerang dengan hak penuh) lalu diposting oleh k. no_trigger = penjaga kolom dimatikan saat menulis.
create function pg_temp.sell(k text, ref text, item uuid, qty numeric, harga numeric, dtype text default null, dval numeric default 0, reason text default null,
  forge boolean default false, no_trigger boolean default false, as_client boolean default false, waiver boolean default false, by_loss boolean default false) returns text language plpgsql as $$
declare gross numeric:=qty*harga;idisc numeric;doc uuid;lid uuid;begin
 idisc:=least(case when dtype='percent' then round(gross*dval/100,0) else coalesce(dval,0) end,gross);
 begin
  perform set_config('request.jwt.claim.sub',case when forge then '' else pg_temp.u(k)::text end,true);
  perform set_config('request.jwt.claims',case when forge then '{"role":"authenticated"}' else '{"role":"authenticated","sub":"'||pg_temp.u(k)||'"}' end,true);
  if no_trigger then alter table public.sale_items disable trigger guard_sale_item_below_cost; end if;
  if as_client then set local role authenticated; end if;
  insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
   values('ab200000-0000-4000-8000-000000000001',ref,gross,idisc,gross-idisc,'Tunai',gross-idisc,pg_temp.u(k),pg_temp.sh(k),
    case when gross-idisc>0 then jsonb_build_array(jsonb_build_object('method','Tunai','amount',gross-idisc)) else '[]'::jsonb end,'k:'||ref,repeat('b',64)) returning id into doc;
  if by_loss then
   insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value,below_hpp_owner_reason,below_hpp_owner_by,below_hpp_loss,source_position)
    values(doc,item,'Baris obral',qty,harga,'pcs',1,case when (select item_type from public.items where id=item)='Jasa' then null else 0 end,dtype,dval,reason,pg_temp.u('OWNER'),999999,0) returning id into lid;
  else
   insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value,below_hpp_owner_reason,promo_floor_waiver,source_position)
    values(doc,item,'Baris obral',qty,harga,'pcs',1,case when (select item_type from public.items where id=item)='Jasa' then null else 0 end,dtype,dval,reason,waiver,0) returning id into lid;
  end if;
  if (select item_type from public.items where id=item)='Grup' then
   insert into sale_item_group_components(sale_item_id,component_item_id,component_name,item_type,qty_per_group,unit,factor,total_base_qty,hpp)
    values(lid,'ab400000-0000-4000-8000-000000000001','Komponen','Persediaan',1,'pcs',1,qty,0);
  end if;
  reset role;
  if no_trigger then alter table public.sale_items enable trigger guard_sale_item_below_cost; end if;
  perform set_config('request.jwt.claim.sub',pg_temp.u(k)::text,true);
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"'||pg_temp.u(k)||'"}',true);
  set local role authenticated;
  perform public.cashier_post_stock_atomic(doc,'ab300000-0000-4000-8000-000000000001');
  reset role;
  return 'OK';
 exception when others then
  reset role;
  return sqlerrm;
 end;
end$$;
create function pg_temp.sale_n(ref text) returns uuid language sql security definer as $$select id from public.sales where no_struk=$1$$;
create function pg_temp.item1(ref text) returns public.sale_items language sql security definer as $$select i from public.sale_items i join public.sales s on s.id=i.sale_id where s.no_struk=$1 order by i.source_position limit 1$$;
create function pg_temp.stk(item uuid) returns numeric language sql security definer as $$select qty from public.stock where item_id=$1$$;
create function pg_temp.bal(ref text,code text) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
 where a.code=$2 and e.source_ref=$1$$;
create function pg_temp.unbalanced(ref text) returns integer language sql security definer as $$
 select count(*)::integer from (select e.id from public.journal_entries e join public.journal_lines l on l.entry_id=e.id where e.source_ref=$1 group by e.id having sum(l.debit)<>sum(l.credit)) z$$;
create function pg_temp.allowed(k text, claim_role text default 'authenticated') returns boolean language plpgsql as $$
declare r boolean;begin
 perform set_config('request.jwt.claim.sub',case when k is null then '' else pg_temp.u(k)::text end,true);
 perform set_config('request.jwt.claims','{"role":"'||claim_role||'"'||case when k is null then '' else ',"sub":"'||pg_temp.u(k)||'"' end||'}',true);
 set local role authenticated;
 r:=public.below_cost_sale_allowed();reset role;return r;end$$;

-- ── A. preflight: objek baru ada (RED: semuanya hilang) ──
select pg_temp.ok(to_regprocedure('public.below_cost_sale_allowed()') is not null,'A1 pemeriksa izin ada');
select pg_temp.ok((select count(*)=3 from information_schema.columns where table_schema='public' and table_name='sale_items' and column_name in('below_hpp_owner_reason','below_hpp_owner_by','below_hpp_loss')),'A2 tiga kolom sale_items ada');
select pg_temp.ok(exists(select 1 from role_settings_private.action_catalog where id='kasir.jual_bawah_modal' and enforced) and exists(select 1 from role_settings_private.action_modules where id='kasir.jual_bawah_modal' and module_id='kasir'),'A3 izin Akses Grup di katalog (enforced, modul kasir)');
select pg_temp.ok(has_function_privilege('authenticated','public.below_cost_sale_allowed()','EXECUTE') and not has_function_privilege('anon','public.below_cost_sale_allowed()','EXECUTE'),'A4 hanya authenticated yang boleh memanggil pemeriksa');

-- ── B. izin: Owner selalu; bawaan peran lain MATI ──
set local session_replication_role=replica;
delete from role_settings_private.action_policies;
set local session_replication_role=origin;
select pg_temp.ok(pg_temp.allowed('OWNER'),'B1 OWNER boleh');
select pg_temp.ok(not pg_temp.allowed('ADMIN') and not pg_temp.allowed('FINANCE') and not pg_temp.allowed('STAFF') and not pg_temp.allowed('DOCTOR'),'B2 ADMIN/FINANCE/STAFF/DOCTOR tanpa kebijakan: tidak boleh (bawaan mati, beda dari diskon manual)');
select pg_temp.ok(not pg_temp.allowed(null),'B3 tanpa login: tidak boleh');
select pg_temp.ok(not pg_temp.allowed('OWNER','anon'),'B4 klaim peran anon walau sub Owner: tidak boleh');
set local session_replication_role=replica;
insert into role_settings_private.action_policies(role,allowed) values('STAFF',array['kasir.jual_bawah_modal']),('ADMIN',array['kasir.diskon_manual']);
set local session_replication_role=origin;
select pg_temp.ok(pg_temp.allowed('GRANTED') and pg_temp.allowed('STAFF'),'B5 STAFF yang dicentang Owner: boleh');
select pg_temp.ok(not pg_temp.allowed('ADMIN') and not pg_temp.allowed('ADMINGR'),'B6 ADMIN berkebijakan tanpa izin ini: tidak boleh (izin diskon manual bukan izin ini)');
update role_settings_private.action_catalog set enforced=false where id='kasir.jual_bawah_modal';
select pg_temp.ok(not pg_temp.allowed('STAFF') and pg_temp.allowed('OWNER'),'B7 izin tak ditegakkan (enforced=false): peran lain tidak, Owner tetap boleh');
update role_settings_private.action_catalog set enforced=true where id='kasir.jual_bawah_modal';
update profiles set is_active=false where id=pg_temp.u('FINANCE');
set local session_replication_role=replica;
insert into role_settings_private.action_policies(role,allowed) values('FINANCE',array['kasir.jual_bawah_modal']);
set local session_replication_role=origin;
select pg_temp.ok(not pg_temp.allowed('FINANCE'),'B8 akun nonaktif: tidak boleh walau dicentang');
update profiles set is_active=true where id=pg_temp.u('FINANCE');
set local session_replication_role=replica;
delete from role_settings_private.action_policies where role in('FINANCE','ADMIN','STAFF');
set local session_replication_role=origin;

-- ── C. Owner menjual di bawah modal (kasus Andri: harga 35.000 diskon 50% = 17.500 < HPP 26.076) ──
select pg_temp.ok(pg_temp.sell('STAFF','OB-RED1','ab400000-0000-4000-8000-000000000001',1,35000,'percent',50,null)<>'OK' and (select count(*)=0 from sales where no_struk='OB-RED1'),'C0 dasar: tanpa alasan, lantai HPP menolak penjualan 50% (STAFF diskon bawaan ditolak diskon manual atau lantai) dan tidak ada sisa');
select pg_temp.ok(pg_temp.sell('OWNER','OB-O0','ab400000-0000-4000-8000-000000000001',2,35000,'percent',50,null) like 'Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak:%'
  and not exists(select 1 from sales where no_struk='OB-O0'),'C1 Owner tanpa alasan: ditolak dengan pesan lantai HPP, tanpa sisa');
select pg_temp.ok(pg_temp.stk('ab400000-0000-4000-8000-000000000001')=60,'C1b stok utuh setelah penolakan');
select pg_temp.ok(pg_temp.sell('OWNER','OB-O1','ab400000-0000-4000-8000-000000000001',2,35000,'percent',50,'Mau kadaluarsa')='OK','C2 Owner + alasan: penjualan 2 pcs diskon 50% di bawah HPP lolos');
select pg_temp.ok((select (i).below_hpp_owner_reason='Mau kadaluarsa' and (i).below_hpp_owner_by=pg_temp.u('OWNER') and (i).below_hpp_loss=17152 and (i).hpp=52152 from (select pg_temp.item1('OB-O1') i) z),'C3 baris mencatat alasan, pelaku=Owner, rugi=HPP 52.152 - neto 35.000 = 17.152');
select pg_temp.ok(pg_temp.stk('ab400000-0000-4000-8000-000000000001')=58 and (select count(*)=1 and sum(unit_cost*abs(qty))=52152 from stock_moves where source_ref='OB-O1'),'C4 stok turun 2, pergerakan stok memakai HPP FIFO asli 26.076/pcs');
select pg_temp.ok(pg_temp.bal('OB-O1','600001')=52152 and pg_temp.bal('OB-O1','170001')=-52152,'C5 HPP (COGS) jurnal = HPP FIFO asli 52.152, persediaan dikredit sama (tanpa akun khusus)');
select pg_temp.ok(pg_temp.bal('OB-O1','1191')=35000 and pg_temp.unbalanced('OB-O1')=0,'C6 kas masuk = harga neto 35.000 dan semua jurnal struk seimbang');
select pg_temp.ok((select payments_finalized_at is not null from sales where no_struk='OB-O1'),'C7 struk final');
-- alasan ada tapi barang tidak rugi: lolos, tanpa rugi tercatat
select pg_temp.ok(pg_temp.sell('OWNER','OB-O2','ab400000-0000-4000-8000-000000000005',1,35000,null,0,'Cuci gudang')='OK' and (select (i).below_hpp_loss=0 from (select pg_temp.item1('OB-O2') i) z),'C8 alasan pada barang yang tidak di bawah modal: lolos, rugi 0');
-- diskon total tingkat struk juga bisa menurunkan harga neto (lantai dihitung teralokasi)
select pg_temp.ok(pg_temp.sell('OWNER','OB-O3','ab400000-0000-4000-8000-000000000001',1,35000,null,0,'Rusak kemasan')='OK' and (select (i).below_hpp_loss=0 from (select pg_temp.item1('OB-O3') i) z),'C9 harga penuh 35.000 > HPP: lolos tanpa rugi');

-- ── D. yang TETAP ditolak untuk Owner ──
select pg_temp.ok(pg_temp.sell('OWNER','OB-N0','ab400000-0000-4000-8000-000000000001',1,35000,'percent',100,'Mau kadaluarsa') like 'Harga neto Persediaan nol; penjualan ditolak:%','D1 harga neto nol ditolak walau Owner + alasan');
select pg_temp.ok(pg_temp.sell('OWNER','OB-N1','ab400000-0000-4000-8000-000000000001',1,0,null,0,'Mau kadaluarsa') like 'Harga neto Persediaan nol; penjualan ditolak:%','D2 harga 0 ditolak walau Owner + alasan');
select pg_temp.ok(pg_temp.sell('OWNER','OB-A1','ab400000-0000-4000-8000-000000000001',1,35000,'percent',50,'')like 'BAWAH_MODAL_ALASAN%','D3 alasan kosong ditolak (penjaga alasan)');
select pg_temp.ok(pg_temp.sell('OWNER','OB-A2','ab400000-0000-4000-8000-000000000001',1,35000,'percent',50,'ab')like 'BAWAH_MODAL_ALASAN%','D4 alasan 2 huruf ditolak');
select pg_temp.ok(pg_temp.sell('OWNER','OB-A3','ab400000-0000-4000-8000-000000000001',1,35000,'percent',50,repeat('x',201))like 'BAWAH_MODAL_ALASAN%','D5 alasan 201 huruf ditolak');
select pg_temp.ok(pg_temp.sell('OWNER','OB-A4','ab400000-0000-4000-8000-000000000001',1,35000,'percent',50,'   ')like 'BAWAH_MODAL_ALASAN%','D6 alasan hanya spasi ditolak');
select pg_temp.ok(pg_temp.sell('OWNER','OB-Z1','ab400000-0000-4000-8000-000000000003',1,100,null,0,'Mau kadaluarsa') like 'Harga pokok barang%belum tersedia%' and (select count(*)=0 from sales where no_struk='OB-Z1'),'D7 HPP Rp0 (modal tak diketahui): tetap ditolak walau Owner + alasan');
select pg_temp.ok(pg_temp.sell('OWNER','OB-J1','ab400000-0000-4000-8000-000000000002',1,10,null,0,'Mau kadaluarsa') like 'BAWAH_MODAL_JENIS%','D8 jasa dengan alasan: ditolak penjaga (DB)');
select pg_temp.ok(pg_temp.sell('OWNER','OB-G1','ab400000-0000-4000-8000-000000000004',1,10,null,0,'Mau kadaluarsa') like 'BAWAH_MODAL_JENIS%','D10 paket Grup dengan alasan: ditolak penjaga');
select pg_temp.ok(pg_temp.sell('OWNER','OB-G2','ab400000-0000-4000-8000-000000000004',1,10,null,0,'Mau kadaluarsa',no_trigger=>true) like 'Harga neto paket Grup di bawah total HPP FIFO komponen%','D11 paket Grup: penjaga kolom dimatikan pun, lantai posting tetap menolak');
select pg_temp.ok(pg_temp.sell('OWNER','OB-W1','ab400000-0000-4000-8000-000000000001',1,35000,'percent',50,'Mau kadaluarsa',waiver=>true) like 'BAWAH_MODAL_PROMO%','D12 baris promo-waiver + alasan: ditolak penjaga');
select pg_temp.ok(pg_temp.sell('OWNER','OB-W2','ab400000-0000-4000-8000-000000000001',1,35000,'percent',50,'Mau kadaluarsa',no_trigger=>true,waiver=>true) not like 'OK','D13 baris waiver + alasan dengan penjaga mati: batas CHECK/lantai menolak');
select pg_temp.ok(pg_temp.stk('ab400000-0000-4000-8000-000000000001')=57 and pg_temp.stk('ab400000-0000-4000-8000-000000000003')=10,'D14 tidak ada stok yang bergeser oleh penolakan');
select pg_temp.ok(not exists(select 1 from sales where no_struk in('OB-N0','OB-N1','OB-A1','OB-A2','OB-A3','OB-A4','OB-Z1','OB-J1','OB-G1','OB-G2','OB-W1','OB-W2')),'D15 tak ada header sisa');

-- ── E. peran lain tidak boleh (alasan lewat klien, atau dipalsukan) ──
select pg_temp.ok(pg_temp.sell('STAFF','OB-S0','ab400000-0000-4000-8000-000000000001',1,17500,null,0,null) like 'Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak:%','E1 STAFF tanpa alasan: lantai HPP menolak (aturan lama utuh)');
select pg_temp.ok(pg_temp.sell('STAFF','OB-S1','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Mau kadaluarsa') like 'BAWAH_MODAL_IZIN%','E2 STAFF dengan alasan: ditolak penjaga izin');
select pg_temp.ok(pg_temp.sell('ADMIN','OB-S2','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Mau kadaluarsa') like 'BAWAH_MODAL_IZIN%','E3 ADMIN dengan alasan: ditolak');
select pg_temp.ok(pg_temp.sell('FINANCE','OB-S3','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Mau kadaluarsa') like 'BAWAH_MODAL_IZIN%','E4 FINANCE dengan alasan: ditolak');
select pg_temp.ok(pg_temp.sell('DOCTOR','OB-S4','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Mau kadaluarsa') like 'BAWAH_MODAL_IZIN%','E5 DOCTOR dengan alasan: ditolak');
select pg_temp.ok(pg_temp.sell('STAFF','OB-F1','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Mau kadaluarsa',no_trigger=>true) like '%hanya Owner atau peran yang diberi izin Jual di bawah modal%','E6 STAFF: alasan dipalsukan (penjaga kolom dilewati): posting menolak dengan pesan izin');
select pg_temp.ok(pg_temp.sell('ADMIN','OB-F2','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Mau kadaluarsa',no_trigger=>true) like '%hanya Owner atau peran yang diberi izin Jual di bawah modal%','E7 ADMIN dipalsukan: ditolak');
select pg_temp.ok(pg_temp.sell('FINANCE','OB-F3','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Mau kadaluarsa',no_trigger=>true) like '%hanya Owner atau peran yang diberi izin Jual di bawah modal%','E8 FINANCE dipalsukan: ditolak');
select pg_temp.ok(pg_temp.sell('DOCTOR','OB-F4','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Mau kadaluarsa',no_trigger=>true) like '%hanya Owner atau peran yang diberi izin Jual di bawah modal%','E9 DOCTOR dipalsukan: ditolak');
select pg_temp.ok(pg_temp.sell('STAFF','OB-F5','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Mau kadaluarsa',no_trigger=>true) like '%hanya Owner atau peran yang diberi izin Jual di bawah modal%','E10 STAFF dipalsukan (kedua kali, nomor struk lain)');
select pg_temp.ok(pg_temp.sell('ADMIN','OB-F6','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Mau kadaluarsa',no_trigger=>true) like '%hanya Owner atau peran yang diberi izin Jual di bawah modal%','E11 ADMIN penjaga mati: ditolak lantai posting');
select pg_temp.ok(pg_temp.sell('STAFF','OB-F7','ab400000-0000-4000-8000-000000000001',1,17500,null,0,null,as_client=>true,by_loss=>true) like 'Harga neto Persediaan di bawah HPP FIFO%','E12 klien STAFF menulis by/loss palsu tanpa alasan: kolom dikosongkan, lantai menolak');
select pg_temp.ok(not exists(select 1 from sales where no_struk like 'OB-S%' or no_struk like 'OB-F%'),'E13 tak ada header sisa dari penolakan peran lain');
-- Izin dicentang: STAFF boleh (Akses Grup)
set local session_replication_role=replica;
insert into role_settings_private.action_policies(role,allowed) values('STAFF',array['kasir.jual_bawah_modal']);
set local session_replication_role=origin;
select pg_temp.ok(pg_temp.sell('GRANTED','OB-GR1','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Rusak kemasan')='OK' and (select (i).below_hpp_owner_by=pg_temp.u('GRANTED') and (i).below_hpp_loss=8576 from (select pg_temp.item1('OB-GR1') i) z),'E14 STAFF berizin + alasan: lolos, pelaku = STAFF, rugi 26.076-17.500=8.576');
select pg_temp.ok(pg_temp.sell('GRANTED','OB-GR2','ab400000-0000-4000-8000-000000000001',1,17500,null,0,null) like 'Harga neto Persediaan di bawah HPP FIFO%','E15 STAFF berizin tanpa alasan: tetap ditolak');
select pg_temp.ok(pg_temp.sell('GRANTED','OB-GR3','ab400000-0000-4000-8000-000000000002',1,10,null,0,'Rusak kemasan') like 'BAWAH_MODAL_JENIS%','E16 STAFF berizin: jasa tetap ditolak');
set local session_replication_role=replica;
delete from role_settings_private.action_policies where role='STAFF';
set local session_replication_role=origin;
select pg_temp.ok(pg_temp.sell('STAFF','OB-GR4','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Rusak kemasan') like 'BAWAH_MODAL_IZIN%','E17 centang dicabut: STAFF ditolak lagi');

-- ── F. penjaga kolom langsung (klien API) ──
select pg_temp.ok(pg_temp.sell('OWNER','OB-C1','ab400000-0000-4000-8000-000000000001',1,35000,'percent',50,'Cuci gudang',as_client=>true,by_loss=>true)='OK'
  and (select (i).below_hpp_owner_by=pg_temp.u('OWNER') and (i).below_hpp_loss=8576 from (select pg_temp.item1('OB-C1') i) z),'F1 klien menulis by/loss palsu: dibuang, diisi database (pelaku Owner, rugi 8.576)');
select pg_temp.ok(pg_temp.sell('OWNER','OB-C2','ab400000-0000-4000-8000-000000000001',1,35000,'percent',50,'Cuci gudang',as_client=>true)='OK','F2 Owner lewat jalur klien (role authenticated) lolos');
-- baris ditulis Owner tanpa posting (jalur /pos/transaksi): pelaku tercatat oleh database
select pg_temp.as_(pg_temp.u('OWNER')::text);
insert into sales(id,branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('ab900000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','OB-BO1',35000,0,35000,'Tunai',35000,pg_temp.u('OWNER'),pg_temp.sh('OWNER'),'[{"method":"Tunai","amount":35000}]','k:bo1',repeat('b',64));
set local role authenticated;
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,below_hpp_owner_reason,below_hpp_owner_by,below_hpp_loss,source_position) values
 ('ab900000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000001','Baris obral',1,35000,'pcs',1,0,'Obral POS',pg_temp.u('ADMIN'),999,0);
reset role;
select pg_temp.ok((select below_hpp_owner_by=pg_temp.u('OWNER') and below_hpp_loss is null from sale_items where sale_id='ab900000-0000-4000-8000-000000000001'),'F3 penulisan alasan tanpa posting lewat klien: pelaku diisi database (Owner login, bukan yang dipalsukan), rugi palsu dibuang');
select pg_temp.reject($q$update sale_items set below_hpp_owner_reason='ab' where sale_id='ab900000-0000-4000-8000-000000000001'$q$,'BAWAH_MODAL_ALASAN','F4 mengubah alasan jadi pendek ditolak');
select pg_temp.reject($q$update sale_items set item_id='ab400000-0000-4000-8000-000000000002' where sale_id='ab900000-0000-4000-8000-000000000001'$q$,'BAWAH_MODAL_JENIS','F5 mengganti barang jadi jasa dengan alasan terpasang ditolak');
update sale_items set below_hpp_owner_reason=null where sale_id='ab900000-0000-4000-8000-000000000001';
select pg_temp.ok((select below_hpp_owner_by is null and below_hpp_loss is null from sale_items where sale_id='ab900000-0000-4000-8000-000000000001'),'F6 alasan dihapus: pelaku dan rugi ikut kosong');
delete from sales where id='ab900000-0000-4000-8000-000000000001';

-- ── G. tabel kebijakan hilang: Owner tetap lolos, peran lain gagal-tertutup ──
alter table role_settings_private.action_policies rename to action_policies_hilang;
alter table role_settings_private.action_catalog rename to action_catalog_hilang;
select pg_temp.ok(pg_temp.allowed('OWNER') and not pg_temp.allowed('ADMIN') and not pg_temp.allowed('STAFF'),'G1 tabel kebijakan/katalog hilang: Owner tetap boleh, peran lain tidak (gagal-tertutup)');
select pg_temp.ok(pg_temp.sell('OWNER','OB-G3','ab400000-0000-4000-8000-000000000001',1,35000,'percent',50,'Mau kadaluarsa')='OK','G2 tabel kebijakan hilang: Owner tetap bisa menjual di bawah modal');
select pg_temp.ok(pg_temp.sell('ADMIN','OB-G4','ab400000-0000-4000-8000-000000000001',1,17500,null,0,'Mau kadaluarsa') like 'BAWAH_MODAL_IZIN%','G3 tabel hilang: ADMIN tetap ditolak');
alter table role_settings_private.action_policies_hilang rename to action_policies;
alter table role_settings_private.action_catalog_hilang rename to action_catalog;

-- ── H. ubah transaksi (edit_posted_pos_sale) membawa alasan ──
create function pg_temp.edit_payload(lines jsonb, subtotal numeric, discount numeric, plan jsonb) returns jsonb language sql as $$
 select jsonb_build_object('header',jsonb_build_object('subtotal',subtotal,'discount',discount,'diskon_kategori',0,
  'total',(select sum((x->>'amount')::numeric) from jsonb_array_elements(plan) x),'merchant_fee_total',0,
  'metode_bayar',plan->0->>'method','bayar',(select sum((x->>'amount')::numeric) from jsonb_array_elements(plan) x),'kembali',0,'payment_plan',plan,'poin_earned',0),'lines',lines)
$$;
create function pg_temp.edit_as(k text, ref text, key text, with_reason boolean) returns text language plpgsql as $$
declare r jsonb;begin
 begin
  perform set_config('request.jwt.claim.sub',pg_temp.u(k)::text,true);
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"'||pg_temp.u(k)||'"}',true);
  set local role authenticated;
  r:=public.edit_posted_pos_sale(pg_temp.sale_n(ref),0,key,'Salah input jumlah',pg_temp.edit_payload(
   jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('item_id','ab400000-0000-4000-8000-000000000001','nama','Crystal Kitty fiktif','qty',2,'harga',35000,'satuan','pcs','faktor',1,
    'item_discount_type','percent','item_discount_value',50,'below_hpp_owner_reason',case when with_reason then 'Mau kadaluarsa' end))),70000,35000,'[{"method":"Tunai","amount":35000}]'));
  reset role;return 'OK:'||(r->>'no_struk');
 exception when others then reset role;return sqlerrm;end;
end$$;
select pg_temp.ok(pg_temp.sell('OWNER','OB-E1','ab400000-0000-4000-8000-000000000001',2,35000,'percent',50,'Mau kadaluarsa')='OK','H0 fixture: struk obral untuk diubah');
select pg_temp.ok(pg_temp.edit_as('OWNER','OB-E1','ob-e1-noreason',false) like 'Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak:%' and (select voided_at is null from sales where no_struk='OB-E1'),'H1 ubah transaksi tanpa membawa alasan: ditolak lantai, struk lama utuh (tidak diam-diam kehilangan)');
select pg_temp.ok(pg_temp.edit_as('OWNER','OB-E1','ob-e1-ok',true) like 'OK:OB-E1-U1','H2 Owner mengubah struk obral dengan alasan terbawa: struk pengganti lolos');
select pg_temp.ok((select (i).below_hpp_owner_reason='Mau kadaluarsa' and (i).below_hpp_owner_by=pg_temp.u('OWNER') and (i).below_hpp_loss=17152 from (select pg_temp.item1('OB-E1-U1') i) z),'H3 struk pengganti memuat alasan, pelaku Owner, rugi 17.152');
select pg_temp.ok((select voided_at is not null from sales where no_struk='OB-E1') and pg_temp.stk('ab400000-0000-4000-8000-000000000001')=pg_temp.stk('ab400000-0000-4000-8000-000000000001'),'H4 struk lama ditutup');
select pg_temp.ok(pg_temp.bal('OB-E1-U1','600001')=52152 and pg_temp.unbalanced('OB-E1-U1')=0,'H5 HPP struk pengganti = HPP asli 52.152, jurnal seimbang');
select pg_temp.ok(pg_temp.sell('OWNER','OB-E2','ab400000-0000-4000-8000-000000000001',2,35000,'percent',50,'Mau kadaluarsa')='OK','H6 fixture kedua');
select pg_temp.ok(pg_temp.edit_as('FINANCE','OB-E2','ob-e2-fin',true) like '%BAWAH_MODAL_IZIN%' and (select voided_at is null from sales where no_struk='OB-E2'),'H7 FINANCE tanpa izin mengubah struk obral: ditolak jelas, struk utuh');
set local session_replication_role=replica;
insert into role_settings_private.action_policies(role,allowed) values('FINANCE',array['kasir.jual_bawah_modal']);
set local session_replication_role=origin;
select pg_temp.ok(pg_temp.edit_as('FINANCE','OB-E2','ob-e2-fin2',true) like 'OK:OB-E2-U1','H8 FINANCE berizin: boleh mengubah struk obral');
set local session_replication_role=replica;
delete from role_settings_private.action_policies where role='FINANCE';
set local session_replication_role=origin;

-- ── I. laporan ──
create function pg_temp.lap(k text) returns jsonb language plpgsql as $$
declare r jsonb;begin
 perform set_config('request.jwt.claim.sub',pg_temp.u(k)::text,true);
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"'||pg_temp.u(k)||'"}',true);
 set local role authenticated;
 r:=public.laporan_jual_bawah_modal(current_date-1,current_date+1,null);reset role;return r;end$$;
select pg_temp.ok(jsonb_array_length(pg_temp.lap('OWNER')->'baris')=jsonb_array_length(pg_temp.lap('ADMIN')->'baris') and jsonb_array_length(pg_temp.lap('OWNER')->'baris')=jsonb_array_length(pg_temp.lap('FINANCE')->'baris'),'I1 Owner/Admin/Finance melihat laporan yang sama');
select pg_temp.reject($q$select pg_temp.lap('STAFF')$q$,'Hanya Owner, Admin, atau Finance','I2 STAFF ditolak');
select pg_temp.reject($q$select pg_temp.lap('DOCTOR')$q$,'Hanya Owner, Admin, atau Finance','I3 DOCTOR ditolak');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.lap('OWNER')->'baris') b where b->>'no_struk'='OB-E1'),'I4 struk lama yang diubah (dibatalkan) tidak ikut dihitung dua kali');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.lap('OWNER')->'baris') b where b->>'no_struk' in('OB-O2','OB-O3')),'I5 baris beralasan yang tidak rugi tidak tampil');
select pg_temp.ok((select (b->>'rugi')::numeric=17152 and (b->>'hpp')::numeric=52152 and (b->>'harga_neto')::numeric=35000 and b->>'alasan'='Mau kadaluarsa' and b->>'oleh'='OB OWNER'
  and b->>'cabang'='OB satu' and b->>'kode'='OBGOOD' and (b->>'qty')::numeric=2 from jsonb_array_elements(pg_temp.lap('OWNER')->'baris') b where b->>'no_struk'='OB-O1'),'I6 baris laporan: tanggal/cabang/struk/barang/qty/HPP 52.152/neto 35.000/rugi 17.152/alasan/oleh');
select pg_temp.ok((select count(*)=1 from jsonb_array_elements(pg_temp.lap('OWNER')->'baris') b where b->>'no_struk'='OB-E1-U1'),'I7 struk pengganti muncul tepat sekali');
select pg_temp.ok((select (b->>'rugi')::numeric=8576 and b->>'oleh'='OB GRANTED' from jsonb_array_elements(pg_temp.lap('OWNER')->'baris') b where b->>'no_struk'='OB-GR1'),'I8 baris STAFF berizin tampil dengan pelakunya');
select pg_temp.ok((select (b->>'harga_neto')::numeric=17500 from jsonb_array_elements(pg_temp.lap('OWNER')->'baris') b where b->>'no_struk'='OB-GR1'),'I9 harga neto laporan memakai alokasi yang sama dengan lantai');
select pg_temp.as_(pg_temp.u('OWNER')::text);
select pg_temp.ok((select count(*)=0 from jsonb_array_elements(public.laporan_jual_bawah_modal(current_date-30,current_date-20,null)->'baris')),'I10 rentang kosong: tanpa baris') ;

select pg_temp.ok(jsonb_array_length(public.laporan_jual_bawah_modal(current_date-1,current_date+1,'ab200000-0000-4000-8000-000000000002')->'baris')=0,'I11 filter cabang lain: tanpa baris');
select pg_temp.ok(jsonb_array_length(public.laporan_jual_bawah_modal(current_date-1,current_date+1,'ab200000-0000-4000-8000-000000000001')->'baris')>3,'I12 filter cabang yang benar: baris tampil');

-- ── J. regresi: jalur promo/biasa tidak berubah ──
select pg_temp.ok(pg_temp.sell('STAFF','OB-R1','ab400000-0000-4000-8000-000000000005',2,35000)='OK' and pg_temp.bal('OB-R1','600001')=2000,'J1 penjualan biasa di atas modal tetap lolos, HPP 2.000');
select pg_temp.ok((select (i).below_hpp_owner_reason is null and (i).below_hpp_owner_by is null and (i).below_hpp_loss is null from (select pg_temp.item1('OB-R1') i) z),'J2 baris biasa tidak berkolom obral');
select pg_temp.ok(pg_temp.unbalanced('OB-O1')+pg_temp.unbalanced('OB-R1')=0,'J3 jurnal seimbang');
rollback;
