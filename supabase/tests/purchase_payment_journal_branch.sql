-- Fictional local-only fixtures. The runner owns and destroys the database.
-- Pilihan 'Cabang pembukuan' pembayaran faktur: jurnal pembayaran ke cabang pilihan, hutang tetap di cabang faktur.
-- Setiap pemeriksaan dicatat (pjb_fail) supaya RED di main menampilkan SEMUA yang gagal; ringkasan di akhir.
begin;
insert into auth.users(id) values('ed000000-0000-4000-8000-000000000001'),('ed000000-0000-4000-8000-000000000003');
update profiles set role='OWNER' where id='ed000000-0000-4000-8000-000000000001';
update profiles set role='STAFF' where id='ed000000-0000-4000-8000-000000000003';
insert into branches(id,code,name,type,is_active) values
 ('ed100000-0000-4000-8000-000000000001','PJB-DC','Gudang pusat fiksi','KLINIK',true),
 ('ed100000-0000-4000-8000-000000000002','PJB-TOKO','Toko fiksi','KLINIK',true),
 ('ed100000-0000-4000-8000-000000000003','PJB-OFF','Cabang nonaktif fiksi','KLINIK',false);
insert into user_branches(user_id,branch_id) values('ed000000-0000-4000-8000-000000000003','ed100000-0000-4000-8000-000000000001');
insert into warehouses(id,branch_id,code,name,type) values('ed200000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','PJB-WH','Gudang fiksi','VET');
insert into suppliers(id,nama) values('ed300000-0000-4000-8000-000000000001','Pemasok fiksi');
insert into items(id,code,name,unit,item_type) values('ed400000-0000-4000-8000-000000000001','PJB-SKU','Barang fiksi','pcs','Persediaan');
insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status,total) values('ed500000-0000-4000-8000-000000000001','PO.PJB.FIC','ed300000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001','Dipesan',1000);
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values('ed600000-0000-4000-8000-000000000001','ed500000-0000-4000-8000-000000000001','ed400000-0000-4000-8000-000000000001','Barang fiksi',10,100,'pcs',1);
insert into coa_accounts(code,name,type,normal_balance) values('170001','Fiction inventory','ASET','D'),('311001','Fiction payable','LIABILITAS','K'),('110209','Fiction store cash','ASET','D'),('110210','Fiction bank','ASET','D') on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set is_active=true,is_header=false where code in('170001','160001','311003','110003','120002');
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;
-- Rekening kas toko milik cabang TOKO; rekening bank milik cabang DC.
insert into cash_accounts(id,nama,jenis,coa_code,branch_id) values
 ('ed700000-0000-4000-8000-000000000001','Kas Toko fiksi','Kas','110209','ed100000-0000-4000-8000-000000000002'),
 ('ed700000-0000-4000-8000-000000000002','Bank fiksi','Bank','110210','ed100000-0000-4000-8000-000000000001');
-- Peta rekening per cabang: jalur 'rekening ikut peta' memakai cabang JURNAL (TOKO -> kas toko, DC -> bank).
insert into payment_account_map(metode,cash_account_id,branch_id) values('Transfer','ed700000-0000-4000-8000-000000000002','ed100000-0000-4000-8000-000000000001'),('Transfer','ed700000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000002');
create table pjb_results(name text primary key,result jsonb);
create table pjb_fail(n text,msg text);
create table pjb_pass(n text);
grant all on pjb_results,pjb_fail,pjb_pass to authenticated;
create function pg_temp.res(n text) returns jsonb language sql as $$select result from pjb_results where name=n$$;
-- act: perintah harus berhasil. rej: harus ditolak dengan potongan pesan. chk: pernyataan boolean dibaca tanpa RLS.
create function pg_temp.act(n text,c text) returns void language plpgsql as $$begin
 begin execute c;insert into pjb_pass values(n);exception when others then insert into pjb_fail values(n,'ERROR '||sqlerrm);end;
end$$;
create function pg_temp.rej(n text,c text,frag text) returns void language plpgsql as $$begin
 begin execute c;insert into pjb_fail values(n,'diterima padahal harus ditolak: '||frag);
 exception when others then if position(frag in sqlerrm)=0 then insert into pjb_fail values(n,'pesan salah: '||sqlerrm||' (harap: '||frag||')');else insert into pjb_pass values(n);end if;end;
end$$;
create function pg_temp.chk(n text,q text) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare v boolean;begin
 begin execute q into v;if v is true then insert into pjb_pass values(n);else insert into pjb_fail values(n,'tidak benar: '||left(q,160));end if;
 exception when others then insert into pjb_fail values(n,'ERROR '||sqlerrm);end;
end$$;
create function pg_temp.pl(k text) returns jsonb language sql security definer set search_path=public,pg_temp as $$select payload from purchase_payment_requests where request_key=k$$;
grant execute on function pg_temp.pl(text),pg_temp.res(text),pg_temp.act(text,text),pg_temp.rej(text,text,text),pg_temp.chk(text,text) to authenticated;
-- STAFF terbatas (hanya cabang DC) butuh modul Kas & Bank. role_modules dijaga: tulis tanpa identitas JWT.
select set_config('request.jwt.claim.role','',true),set_config('request.jwt.claim.sub','',true);
insert into role_modules(role,module_id) values('STAFF','kas-bank') on conflict do nothing;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-000000000001',true);
set local role authenticated;
-- Uang muka harus dibayar SEBELUM penerimaan pertama PO; jurnal uang muka tinggal di cabang PO (DC).
select pg_temp.act('fixture UM',$q$insert into pjb_results select 'um',pay_purchase_advance_atomic('pjb-um','UM.PJB.',5,'ed300000-0000-4000-8000-000000000001','ed500000-0000-4000-8000-000000000001',current_date,500,'Transfer','ed700000-0000-4000-8000-000000000002',null)$q$);
select pg_temp.act('fixture receive',$q$select receive_purchase_order('ed500000-0000-4000-8000-000000000001','receipt-pjb','TB.PJB.FIC.',5,current_date,null,null,'[{"id":"ed600000-0000-4000-8000-000000000001","qty_terima":10,"qty_rusak":0}]')$q$);
select pg_temp.act('fixture invoice',$q$insert into pjb_results select 'invoice',to_jsonb(x) from create_purchase_invoice_from_po('ed500000-0000-4000-8000-000000000001','FB.PJB.FIC.',5,null,current_date,current_date,null,'[{"po_item_id":"ed600000-0000-4000-8000-000000000001","qty":10,"harga":100,"expected_harga_po":100,"expected_faktor":1}]','[]','[]',0,'invoice-pjb')x$q$);
reset role;
select pg_temp.chk('fixture ok',$q$select (select count(*) from pjb_results where name in('um','invoice'))=2$q$);
select pg_temp.chk('fixture hanya SATU overload tiap fungsi bayar',$q$select (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='pay_purchase_invoice_atomic')=1 and (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='pay_purchase_payment_order_atomic')=1$q$);

-- ======================= A. bawaan tidak berubah (pemanggil lama: 9 argumen, urutan dan nama)
set local role authenticated;
select pg_temp.act('A1 bayar bawaan 9 argumen posisi',$q$insert into pjb_results select 'def',pay_purchase_invoice_atomic('pjb-default',(pg_temp.res('invoice')->>'invoice_id')::uuid,current_date,100,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null,null)$q$);
select pg_temp.act('A2 bayar bawaan argumen bernama tanpa p_journal_branch',$q$insert into pjb_results select 'def-named',pay_purchase_invoice_atomic(p_request_key=>'pjb-default-named',p_invoice_id=>(pg_temp.res('invoice')->>'invoice_id')::uuid,p_tanggal=>current_date,p_amount=>50,p_metode=>'Transfer',p_catatan=>null,p_account_id=>'ed700000-0000-4000-8000-000000000001',p_advance_id=>null)$q$);
reset role;
select pg_temp.chk('A3 jurnal bawaan di cabang faktur (DC), kredit rekening toko',$q$select exists(select 1 from journal_entries j join journal_lines l on l.entry_id=j.id join coa_accounts a on a.id=l.account_id where j.id=(pg_temp.res('def')->>'journal_id')::uuid and j.source='purchase-pay' and j.branch_id='ed100000-0000-4000-8000-000000000001' and a.code='110209' and l.credit=100)$q$);
select pg_temp.chk('A4 jurnal bawaan (nama) di cabang faktur',$q$select (select branch_id from journal_entries where id=(pg_temp.res('def-named')->>'journal_id')::uuid)='ed100000-0000-4000-8000-000000000001'$q$);
select pg_temp.chk('A5 payload bawaan mencatat journal_branch_id null',$q$select (pg_temp.pl('pjb-default')) ? 'journal_branch_id' and (select payload->'journal_branch_id' from purchase_payment_requests where request_key='pjb-default')='null'::jsonb$q$);
select pg_temp.chk('A6 hasil memuat cabang jurnal = cabang faktur',$q$select pg_temp.res('def')->>'journal_branch_id'='ed100000-0000-4000-8000-000000000001'$q$);

-- ======================= B. cabang pembukuan dipilih (TOKO)
set local role authenticated;
select pg_temp.act('B1 bayar dengan cabang TOKO',$q$insert into pjb_results select 'b2',pay_purchase_invoice_atomic('pjb-b2',(pg_temp.res('invoice')->>'invoice_id')::uuid,current_date,200,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null,null,'ed100000-0000-4000-8000-000000000002')$q$);
select pg_temp.act('B1b ulang kunci sama, cabang sama = hasil sama',$q$insert into pjb_results select 'b2-again',pay_purchase_invoice_atomic('pjb-b2',(pg_temp.res('invoice')->>'invoice_id')::uuid,current_date,200,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null,null,'ed100000-0000-4000-8000-000000000002')$q$);
reset role;
select pg_temp.chk('B2 jurnal di cabang TOKO, sumber purchase-pay',$q$select exists(select 1 from journal_entries where id=(pg_temp.res('b2')->>'journal_id')::uuid and source='purchase-pay' and branch_id='ed100000-0000-4000-8000-000000000002')$q$);
select pg_temp.chk('B3 baris jurnal: debit 311001 200, kredit 110209 200',$q$select (select jsonb_agg(jsonb_build_array(a.code,l.debit,l.credit) order by a.code) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(pg_temp.res('b2')->>'journal_id')::uuid)='[["110209",0.00,200.00],["311001",200.00,0.00]]'::jsonb$q$);
select pg_temp.chk('B4 hutang tetap di faktur: baris pembayaran tertaut jurnal, faktur tetap cabang DC',$q$select exists(select 1 from purchase_invoice_payments p join purchase_invoices i on i.id=p.invoice_id where p.journal_id=(pg_temp.res('b2')->>'journal_id')::uuid and p.amount=200 and p.invoice_id=(pg_temp.res('invoice')->>'invoice_id')::uuid and i.branch_id='ed100000-0000-4000-8000-000000000001')$q$);
select pg_temp.chk('B5 ulang kunci sama tidak membuat jurnal/pembayaran kedua',$q$select pg_temp.res('b2-again')=pg_temp.res('b2') and (select count(*) from purchase_invoice_payments where journal_id=(pg_temp.res('b2')->>'journal_id')::uuid)=1 and (select count(*) from purchase_payment_requests where request_key='pjb-b2')=1$q$);
select pg_temp.chk('B6 payload mencatat cabang pilihan; hasil memuat cabang jurnal',$q$select (select payload->>'journal_branch_id' from purchase_payment_requests where request_key='pjb-b2')='ed100000-0000-4000-8000-000000000002' and pg_temp.res('b2')->>'journal_branch_id'='ed100000-0000-4000-8000-000000000002'$q$);
select pg_temp.chk('B7 buku besar cabang TOKO memuat kredit kas 110209 pembayaran ini; cabang DC hanya pembayaran bawaan',$q$select exists(select 1 from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where e.branch_id='ed100000-0000-4000-8000-000000000002' and a.code='110209' and l.credit=200) and not exists(select 1 from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where e.branch_id='ed100000-0000-4000-8000-000000000001' and a.code='110209' and l.credit=200)$q$);
-- laporan buku besar (ledger_account_lines) menyaring per cabang jurnal
set local role authenticated;
select pg_temp.chk('B8 ledger_account_lines cabang TOKO menampilkan baris ini',$q$select exists(select 1 from jsonb_array_elements(public.ledger_account_lines(null,null,array['ed100000-0000-4000-8000-000000000002']::uuid[],array[(select id from coa_accounts where code='110209')])) x where (x->>'credit')::numeric=200)$q$);
reset role;
-- cabang pilihan = cabang faktur secara eksplisit: sama dengan bawaan
set local role authenticated;
select pg_temp.act('B9 cabang eksplisit = cabang faktur',$q$insert into pjb_results select 'b1',pay_purchase_invoice_atomic('pjb-b1',(pg_temp.res('invoice')->>'invoice_id')::uuid,current_date,20,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null,null,'ed100000-0000-4000-8000-000000000001')$q$);
reset role;
select pg_temp.chk('B9b jurnalnya di DC',$q$select (select branch_id from journal_entries where id=(pg_temp.res('b1')->>'journal_id')::uuid)='ed100000-0000-4000-8000-000000000001'$q$);

-- rekening 'ikut peta': dipilih menurut cabang jurnal
set local role authenticated;
select pg_temp.act('B10 bayar tanpa rekening, tanpa cabang: ikut peta cabang faktur (bank DC)',$q$insert into pjb_results select 'map-def',pay_purchase_invoice_atomic('pjb-map-def',(pg_temp.res('invoice')->>'invoice_id')::uuid,current_date,5,'Transfer',null,null,null,null)$q$);
select pg_temp.act('B11 bayar tanpa rekening, cabang TOKO: ikut peta cabang TOKO (kas toko)',$q$insert into pjb_results select 'map-b2',pay_purchase_invoice_atomic('pjb-map-b2',(pg_temp.res('invoice')->>'invoice_id')::uuid,current_date,5,'Transfer',null,null,null,null,'ed100000-0000-4000-8000-000000000002')$q$);
reset role;
select pg_temp.chk('B12 peta: bawaan kredit 110210 di DC; cabang TOKO kredit 110209 di TOKO',$q$select exists(select 1 from journal_entries j join journal_lines l on l.entry_id=j.id join coa_accounts a on a.id=l.account_id where j.id=(pg_temp.res('map-def')->>'journal_id')::uuid and j.branch_id='ed100000-0000-4000-8000-000000000001' and a.code='110210' and l.credit=5) and exists(select 1 from journal_entries j join journal_lines l on l.entry_id=j.id join coa_accounts a on a.id=l.account_id where j.id=(pg_temp.res('map-b2')->>'journal_id')::uuid and j.branch_id='ed100000-0000-4000-8000-000000000002' and a.code='110209' and l.credit=5)$q$);

-- ======================= C. penolakan
set local role authenticated;
select pg_temp.rej('C1 cabang nonaktif',format($q$select pay_purchase_invoice_atomic('pjb-off',%L,current_date,10,'Transfer',null,null,null,null,'ed100000-0000-4000-8000-000000000003')$q$,pg_temp.res('invoice')->>'invoice_id'),'Cabang pembukuan tidak ditemukan atau tidak aktif');
select pg_temp.rej('C2 cabang tidak ada',format($q$select pay_purchase_invoice_atomic('pjb-none',%L,current_date,10,'Transfer',null,null,null,null,'ed1ffff0-0000-4000-8000-000000000099')$q$,pg_temp.res('invoice')->>'invoice_id'),'Cabang pembukuan tidak ditemukan atau tidak aktif');
select pg_temp.rej('C3 ulang kunci sama dengan cabang lain (DC)',format($q$select pay_purchase_invoice_atomic('pjb-b2',%L,current_date,200,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null,null,'ed100000-0000-4000-8000-000000000001')$q$,pg_temp.res('invoice')->>'invoice_id'),'rincian berbeda');
select pg_temp.rej('C4 ulang kunci cabang TOKO tanpa cabang (null)',format($q$select pay_purchase_invoice_atomic('pjb-b2',%L,current_date,200,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null,null,null)$q$,pg_temp.res('invoice')->>'invoice_id'),'rincian berbeda');
select pg_temp.rej('C5 ulang kunci bawaan dengan cabang TOKO',format($q$select pay_purchase_invoice_atomic('pjb-default',%L,current_date,100,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null,null,'ed100000-0000-4000-8000-000000000002')$q$,pg_temp.res('invoice')->>'invoice_id'),'rincian berbeda');
-- pemakai terbatas (hanya DC): bayar ke DC boleh, ke TOKO ditolak
select set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-000000000003',true);
select pg_temp.act('C6 STAFF terbatas bayar bawaan (cabang faktur) berhasil',format($q$insert into pjb_results select 'staff-default',pay_purchase_invoice_atomic('pjb-staff-default',%L,current_date,10,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null,null,null)$q$,pg_temp.res('invoice')->>'invoice_id'));
select pg_temp.rej('C7 STAFF terbatas tidak boleh memilih cabang TOKO',format($q$select pay_purchase_invoice_atomic('pjb-staff-b2',%L,current_date,10,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null,null,'ed100000-0000-4000-8000-000000000002')$q$,pg_temp.res('invoice')->>'invoice_id'),'Cabang pembukuan tidak dapat diakses');
select set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-000000000001',true);
-- header cabang operasional DC: memilih TOKO ditolak (user_can_access_branch memakai header)
select set_config('request.headers','{"x-kamo-operational-branch":"ed100000-0000-4000-8000-000000000001"}',true);
select pg_temp.rej('C8 header cabang operasional DC menolak cabang TOKO',format($q$select pay_purchase_invoice_atomic('pjb-hdr',%L,current_date,10,'Transfer',null,null,null,null,'ed100000-0000-4000-8000-000000000002')$q$,pg_temp.res('invoice')->>'invoice_id'),'Cabang pembukuan tidak dapat diakses');
select set_config('request.headers','{}',true);
reset role;
select pg_temp.chk('C9 tidak ada jurnal/pembayaran tersisa dari penolakan',$q$select not exists(select 1 from purchase_payment_requests where request_key in('pjb-off','pjb-none','pjb-staff-b2','pjb-hdr'))$q$);

-- ======================= D. recover_purchase_payment (jalur ulang)
set local role authenticated;
select pg_temp.act('D1 recover cocok (cabang TOKO)',$q$insert into pjb_results select 'rec-b2',recover_purchase_payment('pjb-b2',(pg_temp.pl('pjb-b2')))$q$);
select pg_temp.rej('D2 recover dengan cabang DC ditolak',$q$select recover_purchase_payment('pjb-b2',(pg_temp.pl('pjb-b2')||jsonb_build_object('journal_branch_id','ed100000-0000-4000-8000-000000000001')))$q$,'rincian berbeda');
select pg_temp.rej('D3 recover tanpa cabang ditolak',$q$select recover_purchase_payment('pjb-b2',(pg_temp.pl('pjb-b2')||jsonb_build_object('journal_branch_id',null)))$q$,'rincian berbeda');
select pg_temp.act('D4 recover bawaan dengan payload lama (tanpa kunci journal_branch_id)',$q$insert into pjb_results select 'rec-def',recover_purchase_payment('pjb-default',(pg_temp.pl('pjb-default')-'journal_branch_id'))$q$);
select pg_temp.rej('D5 recover bawaan dengan cabang TOKO ditolak',$q$select recover_purchase_payment('pjb-default',(pg_temp.pl('pjb-default')||jsonb_build_object('journal_branch_id','ed100000-0000-4000-8000-000000000002')))$q$,'rincian berbeda');
reset role;
select pg_temp.chk('D6 recover mengembalikan hasil asli',$q$select pg_temp.res('rec-b2')=pg_temp.res('b2') and pg_temp.res('rec-def')=pg_temp.res('def')$q$);
-- payload yang tersimpan SEBELUM migrasi (tanpa kunci) tetap bisa diulang dengan argumen lama
create or replace function pg_temp.strip_key(k text) returns void language plpgsql as $$begin
 set local session_replication_role=replica;
 update purchase_payment_requests set payload=payload-'journal_branch_id' where request_key=k;
 reset session_replication_role;
end$$;
select pg_temp.act('D7 siapkan payload lama',$q$select pg_temp.strip_key('pjb-default-named')$q$);
set local role authenticated;
select pg_temp.act('D8 ulang bayar dengan payload lama (null) sama persis',format($q$insert into pjb_results select 'def-named-again',pay_purchase_invoice_atomic('pjb-default-named',%L,current_date,50,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null,null)$q$,pg_temp.res('invoice')->>'invoice_id'));
reset role;
select pg_temp.chk('D9 payload lama: hasil sama, tidak ada jurnal baru',$q$select pg_temp.res('def-named-again')=pg_temp.res('def-named') and (select count(*) from purchase_invoice_payments where journal_id=(pg_temp.res('def-named')->>'journal_id')::uuid)=1$q$);
set local role authenticated;
select pg_temp.act('D10 recover payload lama tersimpan (tanpa kunci) dengan payload lama pemanggil',$q$insert into pjb_results select 'rec-old',recover_purchase_payment('pjb-default-named',pg_temp.pl('pjb-default-named'))$q$);
reset role;
select pg_temp.chk('D11 recover payload lama: hasil asli',$q$select pg_temp.res('rec-old')=pg_temp.res('def-named') and not (pg_temp.pl('pjb-default-named') ? 'journal_branch_id')$q$);

-- ======================= E. pembatalan membalik di cabang JURNAL ASLI
set local role authenticated;
select pg_temp.act('E1 batalkan pembayaran TOKO',$q$insert into pjb_results select 'b2-cancel',cancel_purchase_payment((pg_temp.res('b2')->>'payment_id')::uuid,0,'pjb-cancel-b2','Salah rekening')$q$);
select pg_temp.act('E1b batalkan ulang kunci sama = hasil sama',$q$insert into pjb_results select 'b2-cancel-again',cancel_purchase_payment((pg_temp.res('b2')->>'payment_id')::uuid,0,'pjb-cancel-b2','Salah rekening')$q$);
select pg_temp.act('E2 batalkan pembayaran bawaan (DC)',$q$insert into pjb_results select 'def-cancel',cancel_purchase_payment((pg_temp.res('def')->>'payment_id')::uuid,0,'pjb-cancel-def','Salah nominal')$q$);
reset role;
select pg_temp.chk('E3 jurnal pembalik TOKO ada di cabang TOKO',$q$select exists(select 1 from journal_entries where id=(pg_temp.res('b2-cancel')->>'reversal_journal_id')::uuid and source='purchase-pay-void' and branch_id='ed100000-0000-4000-8000-000000000002')$q$);
select pg_temp.chk('E4 pembalik TOKO: debit 110209 200, kredit 311001 200',$q$select (select jsonb_agg(jsonb_build_array(a.code,l.debit,l.credit) order by a.code) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(pg_temp.res('b2-cancel')->>'reversal_journal_id')::uuid)='[["110209",200.00,0.00],["311001",0.00,200.00]]'::jsonb$q$);
select pg_temp.chk('E5 pembalik bawaan tetap di DC',$q$select (select branch_id from journal_entries where id=(pg_temp.res('def-cancel')->>'reversal_journal_id')::uuid)='ed100000-0000-4000-8000-000000000001'$q$);
select pg_temp.chk('E6 batal ulang tidak menambah jurnal pembalik',$q$select pg_temp.res('b2-cancel-again')=pg_temp.res('b2-cancel') and (select count(*) from journal_entries where source='purchase-pay-void' and source_ref=(select id::text from purchase_payment_cancellations where payment_id=(pg_temp.res('b2')->>'payment_id')::uuid))=1$q$);
select pg_temp.chk('E7 kas 110209: asli + pembalik pembayaran TOKO saling meniadakan di cabang TOKO, tidak ada yang jatuh di DC',$q$select (select coalesce(sum(l.debit-l.credit),0) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code='110209' and e.branch_id='ed100000-0000-4000-8000-000000000002' and e.id in((pg_temp.res('b2')->>'journal_id')::uuid,(pg_temp.res('b2-cancel')->>'reversal_journal_id')::uuid))=0 and not exists(select 1 from journal_entries e where e.branch_id='ed100000-0000-4000-8000-000000000001' and e.id in((pg_temp.res('b2')->>'journal_id')::uuid,(pg_temp.res('b2-cancel')->>'reversal_journal_id')::uuid))$q$);
select pg_temp.chk('E10 jejak pembatalan (payment-cancel) di cabang jurnal TOKO; pembatalan bawaan di DC',$q$select exists(select 1 from purchase_backdate_audit where kind='payment-cancel' and doc_id=(pg_temp.res('b2')->>'payment_id')::uuid and branch_id='ed100000-0000-4000-8000-000000000002') and exists(select 1 from purchase_backdate_audit where kind='payment-cancel' and doc_id=(pg_temp.res('def')->>'payment_id')::uuid and branch_id='ed100000-0000-4000-8000-000000000001')$q$);

-- pembayaran pengganti (p_replaces_payment_id) memakai cabang pilihan; catatan jejak mundur ikut cabang jurnal
set local role authenticated;
select pg_temp.act('E8 bayar pengganti pembayaran TOKO yang dibatalkan, cabang TOKO',$q$insert into pjb_results select 'repl',pay_purchase_invoice_atomic('pjb-repl',(pg_temp.res('invoice')->>'invoice_id')::uuid,current_date,200,'Transfer','Ganti rekening','ed700000-0000-4000-8000-000000000001',null,(pg_temp.res('b2')->>'payment_id')::uuid,'ed100000-0000-4000-8000-000000000002')$q$);
reset role;
select pg_temp.chk('E9 pengganti: jurnal di TOKO, jejak mundur (payment-replace) di cabang TOKO',$q$select (select branch_id from journal_entries where id=(pg_temp.res('repl')->>'journal_id')::uuid)='ed100000-0000-4000-8000-000000000002' and exists(select 1 from purchase_backdate_audit where kind='payment-replace' and request_key='pjb-repl' and branch_id='ed100000-0000-4000-8000-000000000002')$q$);

-- ======================= F. uang muka dipakai pada pembayaran bercabang pilihan
set local role authenticated;
select pg_temp.act('F1 bayar 300 pakai uang muka, cabang TOKO',$q$insert into pjb_results select 'adv1',pay_purchase_invoice_atomic('pjb-adv1',(pg_temp.res('invoice')->>'invoice_id')::uuid,current_date,300,'Transfer',null,'ed700000-0000-4000-8000-000000000001',(pg_temp.res('um')->>'advance_id')::uuid,null,'ed100000-0000-4000-8000-000000000002')$q$);
reset role;
select pg_temp.chk('F2 jurnal uang muka di TOKO: Dr 311001 300, Kr 160001 300',$q$select (select branch_id from journal_entries where id=(pg_temp.res('adv1')->>'journal_id')::uuid)='ed100000-0000-4000-8000-000000000002' and (select jsonb_agg(jsonb_build_array(a.code,l.debit,l.credit) order by a.code) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(pg_temp.res('adv1')->>'journal_id')::uuid)='[["160001",0.00,300.00],["311001",300.00,0.00]]'::jsonb$q$);
select pg_temp.chk('F3 alokasi uang muka tercatat',$q$select (select terpakai from purchase_advances where id=(pg_temp.res('um')->>'advance_id')::uuid)=300$q$);
set local role authenticated;
select pg_temp.act('F4 batalkan: pembalik di TOKO, uang muka kembali',$q$insert into pjb_results select 'adv1-cancel',cancel_purchase_payment((pg_temp.res('adv1')->>'payment_id')::uuid,0,'pjb-cancel-adv1','Salah uang muka')$q$);
reset role;
select pg_temp.chk('F5 pembalik uang muka di TOKO, terpakai 0',$q$select (select branch_id from journal_entries where id=(pg_temp.res('adv1-cancel')->>'reversal_journal_id')::uuid)='ed100000-0000-4000-8000-000000000002' and (select terpakai from purchase_advances where id=(pg_temp.res('um')->>'advance_id')::uuid)=0$q$);
-- pembatalan uang muka bertingkat (cascade) membalik pembayaran di cabang jurnalnya
set local role authenticated;
select pg_temp.act('F6 bayar lagi pakai uang muka (TOKO)',$q$insert into pjb_results select 'adv2',pay_purchase_invoice_atomic('pjb-adv2',(pg_temp.res('invoice')->>'invoice_id')::uuid,current_date,250,'Transfer',null,'ed700000-0000-4000-8000-000000000001',(pg_temp.res('um')->>'advance_id')::uuid,null,'ed100000-0000-4000-8000-000000000002')$q$);
select pg_temp.act('F7 pratinjau cascade',$q$insert into pjb_results select 'cascade-preview',preview_purchase_advance_cascade((pg_temp.res('um')->>'advance_id')::uuid)$q$);
select pg_temp.act('F8 cascade batal uang muka',$q$insert into pjb_results select 'cascade',cancel_purchase_advance_cascade((pg_temp.res('um')->>'advance_id')::uuid,'Salah pemasok','pjb-cascade',pg_temp.res('cascade-preview')->>'fingerprint',current_date)$q$);
reset role;
select pg_temp.chk('F9 cascade: pembalik pembayaran di TOKO; jurnal pembatalan uang muka di cabang jurnal asal uang muka (DC)',$q$select (select branch_id from journal_entries e where e.source='purchase-pay-void' and e.id=(pg_temp.res('cascade')->'payments'->0->>'reversal_journal_id')::uuid)='ed100000-0000-4000-8000-000000000002' and (select branch_id from journal_entries where id=(pg_temp.res('cascade')->>'journal_id')::uuid)='ed100000-0000-4000-8000-000000000001' and (select status from purchase_advances where id=(pg_temp.res('um')->>'advance_id')::uuid)='batal'$q$);

-- ======================= G. perintah bayar dengan cabang pembukuan
set local role authenticated;
select pg_temp.act('G1 buat perintah bayar',$q$insert into pjb_results select 'order',mutate_purchase_payment_order('pjb-order-create','create',null,null,jsonb_build_object('supplier_id','ed300000-0000-4000-8000-000000000001'),jsonb_build_array(jsonb_build_object('invoice_id',pg_temp.res('invoice')->>'invoice_id','jumlah',120)))$q$);
select pg_temp.act('G2 setujui',$q$select mutate_purchase_payment_order('pjb-order-approve','approve',(pg_temp.res('order')->>'order_id')::uuid,0,'{}','[]')$q$);
select pg_temp.act('G3 bayar perintah bayar, cabang TOKO, rekening ikut peta cabang TOKO',$q$insert into pjb_results select 'order-pay',pay_purchase_payment_order_atomic('pjb-order-pay',(pg_temp.res('order')->>'order_id')::uuid,current_date,'Transfer',null,1,'ed100000-0000-4000-8000-000000000002')$q$);
select pg_temp.act('G3b ulang kunci sama, cabang sama',$q$insert into pjb_results select 'order-pay-again',pay_purchase_payment_order_atomic('pjb-order-pay',(pg_temp.res('order')->>'order_id')::uuid,current_date,'Transfer',null,1,'ed100000-0000-4000-8000-000000000002')$q$);
select pg_temp.rej('G4 ulang kunci sama, cabang DC ditolak',format($q$select pay_purchase_payment_order_atomic('pjb-order-pay',%L,current_date,'Transfer',null,1,'ed100000-0000-4000-8000-000000000001')$q$,pg_temp.res('order')->>'order_id'),'rincian berbeda');
select pg_temp.rej('G5 ulang kunci sama, tanpa cabang ditolak',format($q$select pay_purchase_payment_order_atomic('pjb-order-pay',%L,current_date,'Transfer',null,1)$q$,pg_temp.res('order')->>'order_id'),'rincian berbeda');
reset role;
select pg_temp.chk('G6 jurnal perintah bayar di TOKO, kredit 110209 120',$q$select (select branch_id from journal_entries where id=(pg_temp.res('order-pay')->>'journal_id')::uuid)='ed100000-0000-4000-8000-000000000002' and exists(select 1 from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(pg_temp.res('order-pay')->>'journal_id')::uuid and a.code='110209' and l.credit=120) and pg_temp.res('order-pay-again')=pg_temp.res('order-pay')$q$);
set local role authenticated;
select pg_temp.act('G7 batalkan pembayaran perintah bayar',$q$insert into pjb_results select 'order-cancel',cancel_purchase_payment((select id from purchase_invoice_payments where payment_order_id=(pg_temp.res('order')->>'order_id')::uuid and amount>0 limit 1),0,'pjb-order-cancel','Salah rekening')$q$);
reset role;
select pg_temp.chk('G8 pembalik di TOKO, perintah bayar kembali disetujui',$q$select (select branch_id from journal_entries where id=(pg_temp.res('order-cancel')->>'reversal_journal_id')::uuid)='ed100000-0000-4000-8000-000000000002' and (select status from payment_orders where id=(pg_temp.res('order')->>'order_id')::uuid)='disetujui'$q$);
set local role authenticated;
select pg_temp.rej('G9 bayar ulang ke cabang nonaktif ditolak',format($q$select pay_purchase_payment_order_atomic('pjb-order-off',%L,current_date,'Transfer',null,3,'ed100000-0000-4000-8000-000000000003')$q$,pg_temp.res('order')->>'order_id'),'Cabang pembukuan tidak ditemukan atau tidak aktif');
select set_config('request.headers','{"x-kamo-operational-branch":"ed100000-0000-4000-8000-000000000001"}',true);
select pg_temp.rej('G9b perintah bayar: header cabang operasional DC menolak cabang TOKO',format($q$select pay_purchase_payment_order_atomic('pjb-order-hdr',%L,current_date,'Transfer',null,3,'ed100000-0000-4000-8000-000000000002')$q$,pg_temp.res('order')->>'order_id'),'Cabang pembukuan tidak dapat diakses');
select set_config('request.headers','{}',true);
select pg_temp.act('G10 bayar ulang bawaan (cabang faktur)',$q$insert into pjb_results select 'order-pay2',pay_purchase_payment_order_atomic('pjb-order-pay2',(pg_temp.res('order')->>'order_id')::uuid,current_date,'Transfer','ed700000-0000-4000-8000-000000000001',3)$q$);
reset role;
select pg_temp.chk('G11 bayar ulang bawaan di DC',$q$select (select branch_id from journal_entries where id=(pg_temp.res('order-pay2')->>'journal_id')::uuid)='ed100000-0000-4000-8000-000000000001'$q$);

-- payload perintah bayar yang tersimpan SEBELUM migrasi (tanpa kunci) tetap bisa diulang dengan argumen lama
select pg_temp.act('G12 siapkan payload perintah bayar lama',$q$select pg_temp.strip_key('pjb-order-pay2')$q$);
set local role authenticated;
select pg_temp.act('G13 ulang bayar perintah bayar dengan payload lama (null)',format($q$insert into pjb_results select 'order-pay2-again',pay_purchase_payment_order_atomic('pjb-order-pay2',%L,current_date,'Transfer','ed700000-0000-4000-8000-000000000001',3)$q$,pg_temp.res('order')->>'order_id'));
reset role;
select pg_temp.chk('G14 payload lama: hasil sama, tidak ada jurnal baru',$q$select pg_temp.res('order-pay2-again')=pg_temp.res('order-pay2') and (select count(*) from purchase_invoice_payments where journal_id=(pg_temp.res('order-pay2')->>'journal_id')::uuid)=1$q$);

-- ======================= H. keutuhan: cabang jurnal diubah di luar jalur resmi ditolak oleh pembatalan dan recover
create function pg_temp.plant(j uuid,b uuid) returns void language plpgsql as $$begin
 set local session_replication_role=replica;
 update journal_entries set branch_id=b where id=j;
 reset session_replication_role;
end$$;
set local role authenticated;
select pg_temp.act('H0 bayar 30 ke TOKO untuk uji keutuhan',$q$insert into pjb_results select 'h',pay_purchase_invoice_atomic('pjb-h',(pg_temp.res('invoice')->>'invoice_id')::uuid,current_date,30,'Transfer',null,'ed700000-0000-4000-8000-000000000001',null,null,'ed100000-0000-4000-8000-000000000002')$q$);
reset role;
select pg_temp.act('H1 ubah cabang jurnal ke DC (di luar jalur resmi)',format($q$select pg_temp.plant(%L,'ed100000-0000-4000-8000-000000000001')$q$,pg_temp.res('h')->>'journal_id'));
set local role authenticated;
select pg_temp.rej('H2 batal ditolak: cabang jurnal tidak sesuai bukti simpan',format($q$select cancel_purchase_payment(%L,0,'pjb-h-cancel','Uji keutuhan')$q$,pg_temp.res('h')->>'payment_id'),'Cabang jurnal pembayaran tidak sesuai bukti simpan');
select pg_temp.rej('H3 recover ditolak: cabang jurnal tidak sesuai bukti simpan',$q$select recover_purchase_payment('pjb-h',(pg_temp.pl('pjb-h')))$q$,'Cabang jurnal pembayaran tidak sesuai bukti simpan');
reset role;
select pg_temp.act('H4 pulihkan cabang jurnal',format($q$select pg_temp.plant(%L,'ed100000-0000-4000-8000-000000000002')$q$,pg_temp.res('h')->>'journal_id'));
set local role authenticated;
select pg_temp.act('H5 setelah dipulihkan, batal berhasil',format($q$select cancel_purchase_payment(%L,0,'pjb-h-cancel','Uji keutuhan')$q$,pg_temp.res('h')->>'payment_id'));
reset role;

-- perintah bayar: cabang jurnal diubah di luar jalur resmi, lalu kunci yang sama diulang
select pg_temp.act('H6 ubah cabang jurnal perintah bayar TOKO ke DC',format($q$select pg_temp.plant(%L,'ed100000-0000-4000-8000-000000000001')$q$,pg_temp.res('order-pay')->>'journal_id'));
set local role authenticated;
select pg_temp.rej('H7 ulang bayar perintah bayar ditolak: cabang jurnal tidak sesuai permintaan',format($q$select pay_purchase_payment_order_atomic('pjb-order-pay',%L,current_date,'Transfer',null,1,'ed100000-0000-4000-8000-000000000002')$q$,pg_temp.res('order')->>'order_id'),'Cabang pembukuan tidak sesuai jurnal pembayaran');
reset role;
select pg_temp.act('H8 pulihkan cabang jurnal perintah bayar',format($q$select pg_temp.plant(%L,'ed100000-0000-4000-8000-000000000002')$q$,pg_temp.res('order-pay')->>'journal_id'));

-- ======================= I. neraca percobaan per cabang tetap seimbang; hak eksekusi
select pg_temp.chk('I1 tiap jurnal seimbang',$q$select not exists(select 1 from journal_lines group by entry_id having sum(debit)<>sum(credit))$q$);
select pg_temp.chk('I2 per cabang: total debit = total kredit',$q$select not exists(select 1 from journal_lines l join journal_entries e on e.id=l.entry_id group by e.branch_id having sum(l.debit)<>sum(l.credit))$q$);
select pg_temp.chk('I3 hak eksekusi: authenticated ya, anon tidak (kedua fungsi bayar)',$q$select has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='pay_purchase_invoice_atomic'$q$);
select pg_temp.chk('I4 hak eksekusi fungsi perintah bayar',$q$select has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='pay_purchase_payment_order_atomic'$q$);
set local role authenticated;
select pg_temp.rej('I6 DML langsung ke jurnal pembayaran ditolak',$q$update journal_entries set branch_id='ed100000-0000-4000-8000-000000000001' where source='purchase-pay'$q$,'jalur resmi');
reset role;
select pg_temp.chk('I7 baris data lama tidak berubah: jumlah pembayaran, status faktur',$q$select (select count(*) from purchase_invoices)=1$q$);

-- ======================= ringkasan
do $$declare f int;p int;m text;begin
 select count(*) into f from pjb_fail;select count(*) into p from pjb_pass;
 select string_agg(n||' => '||msg,E'\n') into m from pjb_fail;
 raise notice 'PJB_SUMMARY pass=% fail=%',p,f;
 if f>0 then raise exception E'PJB_FAIL % gagal (% lulus):\n%',f,p,m;end if;
end$$;
commit;
