-- Penerimaan faktur grosir di cabang lain (20261205100000_penerimaan_grosir_cabang.sql). Data fiktif; dijalankan oleh
-- scripts/test-penerimaan-grosir-cabang-postgres.py SESUDAH bagian fixture supabase/tests/wholesale_returns.sql
-- (faktur A/B/C di cabang WRTEST, cabang lain WROTHER). Semua di dalam transaksi yang dibatalkan.
do $$ begin
 if to_regprocedure('public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text,uuid)') is null then
  raise exception 'receive_wholesale_payment versi cabang belum ada';
 end if;
end $$;
create function pg_temp.pc_assert(ok boolean,message text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'ASSERT: %',message;end if;
end$$;
create function pg_temp.pc_as(p_user text) returns void language sql as $$
 select set_config('request.jwt.claim.sub',md5(p_user)::uuid::text,true)$$;
create function pg_temp.pc_reject(command text,fragment text) returns void language plpgsql as $$begin
 begin execute command;exception when others then
  if position(fragment in sqlerrm)=0 then raise exception 'Expected "%", got "%" for %',fragment,sqlerrm,command;end if;return;
 end;raise exception 'Expected rejection: %',command;
end$$;
create temporary table pc_ids(name text primary key,id uuid not null);
insert into pc_ids select o.no_pesanan,si.id from sales_invoices si join sales_orders o on o.id=si.order_id where o.no_pesanan like 'SO.WR.%';
grant select on pc_ids to authenticated;
create function pg_temp.pc_inv(p text) returns uuid language sql as $$select id from pc_ids where name=p$$;
-- Saldo akun (debit − kredit) per cabang, dibaca sebagai pemilik tabel.
create function pg_temp.pc_saldo(p_code text,p_branch text) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  join public.journal_entries e on e.id=l.entry_id where a.code=p_code and e.branch_id=md5(p_branch)::uuid$$;
create function pg_temp.pc_amount(p_journal uuid,p_code text) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=p_journal and a.code=p_code$$;

-- Rekening fiktif: kas toko milik masing-masing cabang + bank umum; peta Tunai per cabang.
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('110098','Kas Toko WR (fiktif)','ASET','D',false),('110099','Kas Toko Other (fiktif)','ASET','D',false),
 ('120002','Bank umum (fiktif)','ASET','D',false),('182010','Rekening Antar Cabang','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code,branch_id) values
 (md5('pc-kas-wr')::uuid,'Kas Toko WR','Kas','110098',md5('wr-branch')::uuid),
 (md5('pc-kas-other')::uuid,'Kas Toko Other','Kas','110099',md5('wr-branch-other')::uuid);
insert into cash_accounts(id,nama,jenis,coa_code,branch_id)
 select md5('pc-bank')::uuid,'Bank umum','Bank','120002',null where not exists(select 1 from cash_accounts where coa_code='120002');
delete from payment_account_map where metode='Tunai' and branch_id in (md5('wr-branch')::uuid,md5('wr-branch-other')::uuid);
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai',md5('wr-branch')::uuid,md5('pc-kas-wr')::uuid),('Tunai',md5('wr-branch-other')::uuid,md5('pc-kas-other')::uuid);
insert into branches(id,code,name,type,is_active) values(md5('pc-branch-off')::uuid,'PCOFF','Fictional closed branch','PETSHOP',false);

set role authenticated;
select pg_temp.pc_as('wr-owner');

-- 1. Cabang = cabang faktur (atau kosong): perilaku lama persis — satu jurnal, payload sama dengan klien 8 argumen.
do $$declare r jsonb;again jsonb;rc sales_receipts%rowtype;begin
 r:=receive_wholesale_payment('pc-same',pg_temp.pc_inv('SO.WR.A'),current_date,50,'Tunai',null,null,null,md5('wr-branch')::uuid);
 again:=receive_wholesale_payment('pc-same',pg_temp.pc_inv('SO.WR.A'),current_date,50,'Tunai',null,null,null);
 perform pg_temp.pc_assert(r=again,'cabang faktur eksplisit = klien lama (replay idempoten) '||r::text||' vs '||again::text);
 select * into rc from sales_receipts where id=(r->>'receipt_id')::uuid;
 perform pg_temp.pc_assert(rc.branch_id=md5('wr-branch')::uuid and rc.cash_journal_id is null,'satu cabang: tanpa jurnal kas kedua');
 perform pg_temp.pc_assert(pg_temp.pc_amount(rc.journal_id,'110098')=50 and pg_temp.pc_amount(rc.journal_id,'150001')=-50
  and pg_temp.pc_amount(rc.journal_id,'182010')=0,'satu cabang: peta Tunai cabang faktur');
 -- Rekening milik cabang lain tanpa memilih cabang itu tetap ditolak (aturan lama).
 perform pg_temp.pc_reject(format('select receive_wholesale_payment(''pc-wrong-acc'',%L,current_date,1,''Tunai'',%L,null,null)',pg_temp.pc_inv('SO.WR.A'),md5('pc-kas-other')::uuid),'berbeda cabang');
end$$;

-- 2. Uang masuk di cabang lain: piutang lunas di cabang faktur, kas bertambah di cabang penerima, 182010 konsolidasi 0.
do $$declare r jsonb;again jsonb;rc sales_receipts%rowtype;j journal_entries%rowtype;k journal_entries%rowtype;begin
 r:=receive_wholesale_payment('pc-cross',pg_temp.pc_inv('SO.WR.A'),current_date,100,'Tunai',null,null,'Dibayar di toko',md5('wr-branch-other')::uuid);
 again:=receive_wholesale_payment('pc-cross',pg_temp.pc_inv('SO.WR.A'),current_date,100,'Tunai',null,null,'Dibayar di toko',md5('wr-branch-other')::uuid);
 perform pg_temp.pc_assert(r=again and r->>'branch_id'=md5('wr-branch-other')::uuid::text and r->>'cash_journal_id' is not null,'replay lintas cabang '||r::text);
 perform pg_temp.pc_reject(format('select receive_wholesale_payment(''pc-cross'',%L,current_date,100,''Tunai'',null,null,''Dibayar di toko'')',pg_temp.pc_inv('SO.WR.A')),'rincian berbeda');
 select * into rc from sales_receipts where id=(r->>'receipt_id')::uuid;
 perform pg_temp.pc_assert(rc.branch_id=md5('wr-branch-other')::uuid and rc.cash_journal_id=(r->>'cash_journal_id')::uuid and rc.account_id=md5('pc-kas-other')::uuid,'baris penerimaan mencatat cabang & rekening penerima');
 reset role;
 select * into j from journal_entries where id=rc.journal_id;
 select * into k from journal_entries where id=rc.cash_journal_id;
 perform pg_temp.pc_assert(j.source='sales-receipt' and j.branch_id=md5('wr-branch')::uuid and k.source='sales-receipt-cabang' and k.source_ref=rc.no_terima
  and k.branch_id=md5('wr-branch-other')::uuid and k.tanggal=current_date,'dua jurnal di cabang masing-masing');
 perform pg_temp.pc_assert(pg_temp.pc_amount(j.id,'182010')=100 and pg_temp.pc_amount(j.id,'150001')=-100,'jurnal cabang faktur: D 182010 / K piutang');
 perform pg_temp.pc_assert(pg_temp.pc_amount(k.id,'110099')=100 and pg_temp.pc_amount(k.id,'182010')=-100,'jurnal cabang penerima: D kas toko / K 182010');
 perform pg_temp.pc_assert(pg_temp.pc_saldo('110099','wr-branch-other')=100 and pg_temp.pc_saldo('110099','wr-branch')=0,'kas toko cabang penerima bertambah');
 perform pg_temp.pc_assert(pg_temp.pc_saldo('182010','wr-branch')+pg_temp.pc_saldo('182010','wr-branch-other')=0,'182010 konsolidasi nol');
 perform pg_temp.pc_assert((select status='berjalan' from sales_invoices where id=pg_temp.pc_inv('SO.WR.A')),'faktur dibayar sebagian');
 -- Jurnal kas cabang dilindungi dari tulis langsung.
 set role authenticated;
 perform pg_temp.pc_as('wr-owner');
 perform pg_temp.pc_reject(format('update journal_entries set deskripsi=''x'' where id=%L',k.id),'proses resmi');
end$$;

-- 3. Rekening dipilih manual: harus milik cabang penerima (atau tanpa cabang). Bank tanpa cabang boleh.
do $$declare r jsonb;begin
 perform pg_temp.pc_reject(format('select receive_wholesale_payment(''pc-acc-mismatch'',%L,current_date,1,''Tunai'',%L,null,null,%L)',
  pg_temp.pc_inv('SO.WR.A'),md5('pc-kas-wr')::uuid,md5('wr-branch-other')::uuid),'berbeda cabang');
 r:=receive_wholesale_payment('pc-bank',pg_temp.pc_inv('SO.WR.B'),current_date,10,'QRIS',(select id from cash_accounts where coa_code='120002' limit 1),null,null,md5('wr-branch-other')::uuid);
 perform pg_temp.pc_assert(pg_temp.pc_amount((r->>'cash_journal_id')::uuid,'120002')=10,'bank umum di cabang penerima');
 perform pg_temp.pc_reject(format('select receive_wholesale_payment(''pc-off'',%L,current_date,1,''Tunai'',null,null,null,%L)',
  pg_temp.pc_inv('SO.WR.B'),md5('pc-branch-off')::uuid),'Cabang penerimaan tidak ditemukan');
end$$;

-- 4. FINANCE yang hanya boleh cabang WRTEST tidak bisa mencatat uang masuk di cabang lain.
select pg_temp.pc_as('wr-finance');
select pg_temp.pc_reject(format('select receive_wholesale_payment(''pc-fin-other'',%L,current_date,1,''Tunai'',null,null,null,%L)',
 pg_temp.pc_inv('SO.WR.C'),md5('wr-branch-other')::uuid),'Cabang penerimaan tidak ditemukan');
select receive_wholesale_payment('pc-fin-own',pg_temp.pc_inv('SO.WR.C'),current_date,5,'Tunai',null,null,null,md5('wr-branch')::uuid);

-- 5. Hapus penerimaan lintas cabang: kedua jurnal dibalik di cabang masing-masing; kas & piutang kembali.
select pg_temp.pc_as('wr-owner');
do $$declare r jsonb;again jsonb;rc sales_receipts%rowtype;rv sales_receipts%rowtype;begin
 select * into rc from sales_receipts where catatan='Dibayar di toko';
 r:=cancel_wholesale_receipt(rc.id,rc.revision,'pc-cancel','Salah cabang');
 again:=cancel_wholesale_receipt(rc.id,rc.revision,'pc-cancel','Salah cabang');
 perform pg_temp.pc_assert(r=again and r->>'cash_reversal_journal_id' is not null,'hapus idempoten + pembalik kas cabang '||r::text);
 select * into rv from sales_receipts where reversal_of=rc.id;
 perform pg_temp.pc_assert(rv.branch_id=md5('wr-branch-other')::uuid and rv.cash_journal_id=(r->>'cash_reversal_journal_id')::uuid and rv.jumlah=-100,'baris pembalik');
 reset role;
 perform pg_temp.pc_assert((select source='sales-receipt-void-cbg' and branch_id=md5('wr-branch-other')::uuid from journal_entries where id=rv.cash_journal_id),'pembalik kas di cabang penerima');
 perform pg_temp.pc_assert(pg_temp.pc_saldo('110099','wr-branch-other')=0,'kas toko cabang penerima kembali nol');
 perform pg_temp.pc_assert(pg_temp.pc_saldo('182010','wr-branch')=10 and pg_temp.pc_saldo('182010','wr-branch-other')=-10,'182010 tinggal penerimaan bank 10 yang masih aktif, konsolidasi nol');
 perform pg_temp.pc_assert(pg_temp.pc_saldo('150001','wr-branch')=(select sum(total) from sales_invoices where id in (pg_temp.pc_inv('SO.WR.A'),pg_temp.pc_inv('SO.WR.B'),pg_temp.pc_inv('SO.WR.C')))-50-10-5,'piutang cabang faktur kembali');
 set role authenticated;
 perform pg_temp.pc_as('wr-owner');
end$$;

-- 6. Koreksi faktur grosir tetap lulus pemeriksa jurnal penerimaan walau ada penerimaan lintas cabang aktif (faktur B).
do $$declare r jsonb;begin
 r:=correct_wholesale_invoice(pg_temp.pc_inv('SO.WR.B'),(select revision from sales_invoices where id=pg_temp.pc_inv('SO.WR.B')),'pc-correct','cancel','Batal tagihan uji',jsonb_build_object('tanggal',current_date));
 perform pg_temp.pc_assert(r ? 'reversal_journal_id' or r ? 'invoice_id','koreksi faktur dengan penerimaan lintas cabang '||r::text);
end$$;
reset role;
select 'PENERIMAAN CABANG PASS';
