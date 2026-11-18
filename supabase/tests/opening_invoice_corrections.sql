-- Fictional isolated fixture: Owner corrects an opening AP/AR invoice value
-- (migration 20261124300000_koreksi_saldo_awal_per_faktur.sql). Every row rolls back.
begin;
insert into auth.users(id)values(md5('oic-owner')::uuid),(md5('oic-finance')::uuid),(md5('oic-staff')::uuid),(md5('oic-owner-off')::uuid);
insert into profiles(id,full_name,role,is_active)values
 (md5('oic-owner')::uuid,'Fiction owner','OWNER',true),(md5('oic-finance')::uuid,'Fiction finance','FINANCE',true),
 (md5('oic-staff')::uuid,'Fiction staff','STAFF',true),(md5('oic-owner-off')::uuid,'Fiction inactive owner','OWNER',false)
on conflict(id)do update set full_name=excluded.full_name,role=excluded.role,is_active=excluded.is_active;
insert into branches(id,code,name,type)values(md5('oic-branch')::uuid,'OIC-A','Fiction OIC branch','PETSHOP');
insert into coa_accounts(code,name,type,normal_balance)values('311001','Fiction trade payables','LIABILITAS','K'),
 ('150001','Fiction trade receivables','ASET','D'),('410001','Fiction owner equity','EKUITAS','K') on conflict do nothing;
insert into suppliers(id,nama)values(md5('oic-sup-1')::uuid,'PT Fiksi Hewan');
insert into customers(id,name,phone)values(md5('oic-cus-1')::uuid,'Toko Fiksi Kucing','0800000077');
update accounting_locks set closed_until=null where id;

create temporary table oic_ctx(k text primary key, v text) on commit drop;
grant select, insert, update on oic_ctx to authenticated;

-- Opening batch: two payables, one receivable.
do $$declare p jsonb;report jsonb;res jsonb;begin
 perform set_config('request.jwt.claim.sub',md5('oic-owner')::uuid::text,true);
 p:=jsonb_build_object('source_name','Saldo-Awal-Fiksi-OIC.xlsx','as_of',((now() at time zone 'Asia/Jakarta')::date-7)::text,'branch_id',md5('oic-branch')::uuid,
  'control',jsonb_build_object('hutang','12000000','piutang','3000000'),
  'rows',jsonb_build_array(
   jsonb_build_object('baris',2,'jenis','HUTANG','nama_pihak','PT Fiksi Hewan','no_faktur','PI-OLD-1','tanggal','2026-09-01','jatuh_tempo','2026-09-30','sisa','9939500','total_asli',null),
   jsonb_build_object('baris',3,'jenis','HUTANG','nama_pihak','PT Fiksi Hewan','no_faktur','PI-OLD-2','tanggal','2026-09-02','jatuh_tempo','2026-10-01','sisa','2060500','total_asli','5000000'),
   jsonb_build_object('baris',4,'jenis','PIUTANG','nama_pihak','Toko Fiksi Kucing','no_faktur','FJ-OLD-9','tanggal','2026-09-10','jatuh_tempo','2026-10-10','sisa','3000000','total_asli',null)));
 report:=preview_opening_invoices(p);
 if not (report->>'can_post')::boolean then raise exception 'fixture batch not postable: %',report->'blockers';end if;
 res:=post_opening_invoices(p,report->>'source_hash','Cutover Accurate fiksi OIC');
 insert into oic_ctx values('batch',res->>'batch_id'),('journal',res->>'journal_id'),
  ('ap1',(select l.id::text from opening_invoice_lines l where l.batch_id=(res->>'batch_id')::uuid and l.source_no='PI-OLD-1')),
  ('ap2',(select l.id::text from opening_invoice_lines l where l.batch_id=(res->>'batch_id')::uuid and l.source_no='PI-OLD-2')),
  ('ar1',(select l.id::text from opening_invoice_lines l where l.batch_id=(res->>'batch_id')::uuid and l.source_no='FJ-OLD-9'));
end$$;

-- A partial payment on PI-OLD-2 (1.000.000) and a receipt on FJ-OLD-9 (2.500.000), written directly as fixtures.
insert into purchase_invoice_payments(invoice_id,tanggal,amount,metode)
 select purchase_invoice_id,(now() at time zone 'Asia/Jakarta')::date,1000000,'Transfer' from opening_invoice_lines where id=(select v::uuid from oic_ctx where k='ap2');
insert into sales_receipts(no_terima,invoice_id,tanggal,jumlah,metode)
 select 'TR-OIC-1',sales_invoice_id,(now() at time zone 'Asia/Jakarta')::date,2500000,'Transfer' from opening_invoice_lines where id=(select v::uuid from oic_ctx where k='ar1');

-- Grants: callable by authenticated only, helpers private.
do $$begin
 if not has_function_privilege('authenticated','public.correct_opening_invoice(uuid,numeric,numeric,text,text)','execute')
  or not has_function_privilege('authenticated','public.opening_invoice_correction_rows()','execute') then raise exception 'RPC not granted';end if;
 if has_function_privilege('anon','public.correct_opening_invoice(uuid,numeric,numeric,text,text)','execute')
  or has_function_privilege('authenticated','public.opening_invoice_paid(text,uuid)','execute') then raise exception 'private function exposed';end if;
 if has_table_privilege('authenticated','public.opening_invoice_corrections','insert') or has_table_privilege('authenticated','public.opening_invoice_correction_requests','select')
  then raise exception 'correction tables writable/readable beyond policy';end if;
end$$;

set local role authenticated;set local request.jwt.claim.role='authenticated';

do $$declare ap1 uuid;ap2 uuid;ar1 uuid;batch uuid;j0 uuid;res jsonb;again jsonb;blocked boolean;rows jsonb;r jsonb;inv uuid;cj uuid;msg text;
begin
 select v::uuid into ap1 from oic_ctx where k='ap1';select v::uuid into ap2 from oic_ctx where k='ap2';
 select v::uuid into ar1 from oic_ctx where k='ar1';select v::uuid into batch from oic_ctx where k='batch';select v::uuid into j0 from oic_ctx where k='journal';

 -- 1. Access: STAFF cannot list; FINANCE lists but cannot correct; inactive OWNER refused.
 perform set_config('request.jwt.claim.sub',md5('oic-staff')::uuid::text,true);
 blocked:=false;begin perform opening_invoice_correction_rows();exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'C1 STAFF listed opening invoices';end if;
 perform set_config('request.jwt.claim.sub',md5('oic-finance')::uuid::text,true);
 rows:=opening_invoice_correction_rows();
 if jsonb_array_length(rows)<>3 then raise exception 'C1 FINANCE list wrong: %',rows;end if;
 select x into r from jsonb_array_elements(rows) x where x->>'line_id'=ap2::text;
 if (r->>'total')::numeric<>2060500 or (r->>'dibayar')::numeric<>1000000 or r->>'pihak'<>'PT Fiksi Hewan' or r->>'no_asal'<>'PI-OLD-2' or (r->>'batal') is distinct from 'false' or (r->>'periode_tutup')::boolean
  then raise exception 'C1 row content wrong: %',r;end if;
 select x into r from jsonb_array_elements(rows) x where x->>'line_id'=ar1::text;
 if (r->>'dibayar')::numeric<>2500000 or r->>'jenis'<>'PIUTANG' then raise exception 'C1 AR paid wrong: %',r;end if;
 blocked:=false;begin perform correct_opening_invoice(ap1,9939500,10101500,'Salah ketik saat impor saldo awal','k-fin');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'C1 FINANCE corrected';end if;
 perform set_config('request.jwt.claim.sub',md5('oic-owner-off')::uuid::text,true);
 blocked:=false;begin perform correct_opening_invoice(ap1,9939500,10101500,'Salah ketik saat impor saldo awal','k-off');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'C1 inactive OWNER corrected';end if;

 -- 2. Input validation.
 perform set_config('request.jwt.claim.sub',md5('oic-owner')::uuid::text,true);
 blocked:=false;begin perform correct_opening_invoice(ap1,9939500,10101500,'pendek','k-v1');exception when others then blocked:=sqlerrm like 'Isi alasan koreksi%';end;
 if not blocked then raise exception 'C2 short reason accepted';end if;
 blocked:=false;begin perform correct_opening_invoice(ap1,9939500,10101500.5,'Salah ketik saat impor saldo awal','k-v2');exception when others then blocked:=sqlerrm like 'Nilai baru harus rupiah bulat%';end;
 if not blocked then raise exception 'C2 fractional value accepted';end if;
 blocked:=false;begin perform correct_opening_invoice(ap1,9939500,0,'Salah ketik saat impor saldo awal','k-v3');exception when others then blocked:=sqlerrm like 'Nilai baru harus rupiah bulat%';end;
 if not blocked then raise exception 'C2 zero accepted';end if;
 blocked:=false;begin perform correct_opening_invoice(ap1,9939500,9939500,'Salah ketik saat impor saldo awal','k-v4');exception when others then blocked:=sqlerrm like 'Nilai baru sama%';end;
 if not blocked then raise exception 'C2 unchanged value accepted';end if;
 blocked:=false;begin perform correct_opening_invoice(ap1,9000000,10101500,'Salah ketik saat impor saldo awal','k-v5');exception when others then blocked:=sqlerrm like '%sudah berubah menjadi 9.939.500%';end;
 if not blocked then raise exception 'C2 stale expected value accepted';end if;
 blocked:=false;begin perform correct_opening_invoice(ap1,9939500,10101500,'Salah ketik saat impor saldo awal','');exception when others then blocked:=sqlerrm like 'Identitas permintaan%';end;
 if not blocked then raise exception 'C2 empty request key accepted';end if;
 if exists(select 1 from opening_invoice_corrections) then raise exception 'C2 refused calls left rows';end if;

 -- 3. Payable up: invoice, import line, batch and a NEW balanced correction journal on the opening date; batch journal untouched.
 res:=correct_opening_invoice(ap1,9939500,11404500,'Salah ketik saat impor saldo awal','k-ap1');
 if (res->>'replayed')::boolean or (res->>'delta')::numeric<>1465000 or (res->>'sisa')::numeric<>11404500 or res->>'no_jurnal' is null then raise exception 'C3 result wrong: %',res;end if;
 cj:=(res->>'journal_id')::uuid;
 rows:=opening_invoice_correction_rows();
 select x into r from jsonb_array_elements(rows) x where x->>'line_id'=ap1::text;
 if (r->>'total')::numeric<>11404500 or (r->>'jumlah_koreksi')::int<>1 then raise exception 'C3 list not updated: %',r;end if;
 insert into oic_ctx values('cj1',cj::text),('res1',res::text);
 -- 4. Idempotent replay; same key with different input refused.
 again:=correct_opening_invoice(ap1,9939500,11404500,'Salah ketik saat impor saldo awal','k-ap1');
 if not (again->>'replayed')::boolean or again->>'correction_id'<>res->>'correction_id' then raise exception 'C4 replay wrong: %',again;end if;
 blocked:=false;begin perform correct_opening_invoice(ap1,9939500,12000000,'Salah ketik saat impor saldo awal','k-ap1');exception when others then blocked:=sqlerrm like 'Identitas permintaan dipakai%';end;
 if not blocked then raise exception 'C4 key reuse with different input accepted';end if;
 -- 5. Second correction down (the "ralat") from the new value.
 res:=correct_opening_invoice(ap1,11404500,10101500,'Ralat: angka yang benar 10.101.500','k-ap1b');
 if (res->>'delta')::numeric<>-1303000 then raise exception 'C5 result wrong: %',res;end if;
 insert into oic_ctx values('cj2',res->>'journal_id');

 -- 6. Never below what was paid; exactly the paid amount is allowed.
 blocked:=false;begin perform correct_opening_invoice(ap2,2060500,999999,'Faktur ternyata lebih kecil','k-ap2a');exception when others then blocked:=sqlerrm like '%lebih kecil dari yang sudah dibayar (1.000.000)%';end;
 if not blocked then raise exception 'C6 below paid accepted';end if;
 res:=correct_opening_invoice(ap2,2060500,1000000,'Faktur ternyata lebih kecil','k-ap2b');
 if (res->>'sisa')::numeric<>0 then raise exception 'C6 sisa wrong: %',res;end if;

 -- 7. Receivable down to the received amount: status lunas; journal D 410001 / K 150001.
 blocked:=false;begin perform correct_opening_invoice(ar1,3000000,2400000,'Piutang ternyata lebih kecil','k-ar1a');exception when others then msg:=sqlerrm;blocked:=sqlerrm like '%lebih kecil dari yang sudah diterima (2.500.000)%';end;
 if not blocked then raise exception 'C7 AR below received accepted: %',msg;end if;
 res:=correct_opening_invoice(ar1,3000000,2500000,'Piutang ternyata lebih kecil','k-ar1b');
 insert into oic_ctx values('cj3',res->>'journal_id');
 res:=correct_opening_invoice(ar1,2500000,2750000,'Piutang naik lagi setelah cek','k-ar1c');
 insert into oic_ctx values('cj4',res->>'journal_id');
end$$;

-- 8. Direct writes stay blocked for clients.
do $$declare blocked boolean;begin
 blocked:=false;begin update purchase_invoices set total=1 where id=(select purchase_invoice_id from opening_invoice_lines where id=(select v::uuid from oic_ctx where k='ap1'));
 exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'C8 client edited opening invoice total';end if;
 blocked:=false;begin perform set_config('vetos.opening_invoice_correction',(select purchase_invoice_id::text from opening_invoice_lines where id=(select v::uuid from oic_ctx where k='ap1')),true);
  update purchase_invoices set total=1 where id=(select purchase_invoice_id from opening_invoice_lines where id=(select v::uuid from oic_ctx where k='ap1'));
 exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'C8 client bypassed guard with the setting';end if;
 perform set_config('vetos.opening_invoice_correction','',true);
end$$;

reset role;

-- Verification as the database owner.
do $$declare ap1 uuid;ap2 uuid;ar1 uuid;batch uuid;j0 uuid;cj1 uuid;cj2 uuid;cj3 uuid;cj4 uuid;asof date;blocked boolean;b record;
begin
 select v::uuid into ap1 from oic_ctx where k='ap1';select v::uuid into ap2 from oic_ctx where k='ap2';select v::uuid into ar1 from oic_ctx where k='ar1';
 select v::uuid into batch from oic_ctx where k='batch';select v::uuid into j0 from oic_ctx where k='journal';
 select v::uuid into cj1 from oic_ctx where k='cj1';select v::uuid into cj2 from oic_ctx where k='cj2';
 select v::uuid into cj3 from oic_ctx where k='cj3';select v::uuid into cj4 from oic_ctx where k='cj4';
 select as_of into asof from opening_invoice_batches where id=batch;

 -- C3/C5: final values.
 if (select pi.total from purchase_invoices pi join opening_invoice_lines l on l.purchase_invoice_id=pi.id where l.id=ap1)<>10101500
  or (select outstanding from opening_invoice_lines where id=ap1)<>10101500 or (select original_total from opening_invoice_lines where id=ap1) is not null
  or (select keterangan from opening_invoice_lines where id=ap1) not like '%9.939.500 → 11.404.500%11.404.500 → 10.101.500%'
  then raise exception 'C3 payable values wrong';end if;
 -- original_total above the new outstanding is kept (C6: 5.000.000 total, outstanding 1.000.000).
 if (select outstanding from opening_invoice_lines where id=ap2)<>1000000 or (select original_total from opening_invoice_lines where id=ap2)<>5000000 then raise exception 'C6 line wrong';end if;
 select * into b from opening_invoice_batches where id=batch;
 if b.ap_total<>11101500 or (b.result#>>'{hutang,total}')::numeric<>11101500 or b.ar_total<>2750000 or (b.result#>>'{piutang,total}')::numeric<>2750000
  then raise exception 'C3 batch totals wrong: % %',b.ap_total,b.ar_total;end if;
 -- Batch journal untouched.
 if (select sum(credit-debit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=j0 and a.code='311001')<>12000000
  or (select sum(debit-credit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=j0 and a.code='150001')<>3000000
  then raise exception 'C3 batch journal was modified';end if;
 -- Correction journals: dated at the opening date, protected source, balanced, right sides.
 if exists(select 1 from journal_entries where id in(cj1,cj2,cj3,cj4) and (tanggal<>asof or source<>'opening-invoice' or branch_id<>md5('oic-branch')::uuid))
  or (select count(distinct id) from journal_entries where id in(cj1,cj2,cj3,cj4))<>4 then raise exception 'C3 correction journal header wrong';end if;
 if (select string_agg(a.code||':'||l.debit::bigint||'/'||l.credit::bigint,',' order by a.code) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=cj1)<>'311001:0/1465000,410001:1465000/0'
  or (select string_agg(a.code||':'||l.debit::bigint||'/'||l.credit::bigint,',' order by a.code) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=cj2)<>'311001:1303000/0,410001:0/1303000'
  or (select string_agg(a.code||':'||l.debit::bigint||'/'||l.credit::bigint,',' order by a.code) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=cj3)<>'150001:0/500000,410001:500000/0'
  or (select string_agg(a.code||':'||l.debit::bigint||'/'||l.credit::bigint,',' order by a.code) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=cj4)<>'150001:250000/0,410001:0/250000'
  then raise exception 'C3 correction journal lines wrong';end if;
 -- Ledger: opening journals + corrections = sum of opening invoice totals.
 if (select sum(l.credit-l.debit) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where e.source='opening-invoice' and a.code='311001')
    <>(select sum(total) from purchase_invoices where opening_batch_id=batch)
  or (select sum(l.debit-l.credit) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where e.source='opening-invoice' and a.code='150001')
    <>(select sum(total) from sales_invoices where opening_batch_id=batch)
  or (select sum(debit)-sum(credit) from journal_lines)<>0 then raise exception 'C3 ledger does not reconcile with invoices';end if;
 -- C7: receivable status follows paid vs total.
 if (select si.status from sales_invoices si join opening_invoice_lines l on l.sales_invoice_id=si.id where l.id=ar1)<>'berjalan'
  or (select si.total from sales_invoices si join opening_invoice_lines l on l.sales_invoice_id=si.id where l.id=ar1)<>2750000 then raise exception 'C7 AR final wrong';end if;
 if (select count(*) from opening_invoice_corrections)<>5 or (select count(*) from opening_invoice_correction_requests)<>5
  or exists(select 1 from opening_invoice_corrections where created_by<>md5('oic-owner')::uuid) then raise exception 'C4 audit rows wrong';end if;
 if (select paid_at_correction from opening_invoice_corrections where journal_id=cj3)<>2500000 then raise exception 'C7 paid snapshot wrong';end if;

 -- 8b. Owner-level write without the correction setting is still refused by the guard.
 blocked:=false;begin update purchase_invoices set total=1 where id=(select purchase_invoice_id from opening_invoice_lines where id=ap1);
 exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'C8 guard lets owner-level edits through';end if;
 -- With the setting only total/status/revision may change.
 blocked:=false;begin perform set_config('vetos.opening_invoice_correction',(select purchase_invoice_id::text from opening_invoice_lines where id=ap1),true);
  update purchase_invoices set keterangan='diubah' where id=(select purchase_invoice_id from opening_invoice_lines where id=ap1);
 exception when insufficient_privilege then blocked:=true;end;
 perform set_config('vetos.opening_invoice_correction','',true);
 if not blocked then raise exception 'C8 setting allowed a non-total field';end if;
end$$;

-- 9. Closed period and voided invoice are refused.
update accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date-1 where id;
do $$declare blocked boolean;begin
 perform set_config('request.jwt.claim.sub',md5('oic-owner')::uuid::text,true);
 blocked:=false;begin perform correct_opening_invoice((select v::uuid from oic_ctx where k='ap1'),10101500,10000000,'Koreksi setelah tutup buku','k-lock');
 exception when others then blocked:=sqlerrm like 'Periode sampai % sudah ditutup%';end;
 if not blocked then raise exception 'C9 closed period accepted';end if;
 if (select (x->>'periode_tutup')::boolean from jsonb_array_elements(opening_invoice_correction_rows()) x where x->>'line_id'=(select v from oic_ctx where k='ap1')) is not true
  then raise exception 'C9 list does not flag the closed period';end if;
end$$;
update accounting_locks set closed_until=null where id;
alter table purchase_invoices disable trigger opening_invoice_guard;
update purchase_invoices set voided_at=now() where id=(select purchase_invoice_id from opening_invoice_lines where id=(select v::uuid from oic_ctx where k='ap2'));
alter table purchase_invoices enable trigger opening_invoice_guard;
do $$declare blocked boolean;begin
 perform set_config('request.jwt.claim.sub',md5('oic-owner')::uuid::text,true);
 blocked:=false;begin perform correct_opening_invoice((select v::uuid from oic_ctx where k='ap2'),1000000,1500000,'Koreksi faktur yang sudah batal','k-void');
 exception when others then blocked:=sqlerrm like '%sudah dibatalkan%';end;
 if not blocked then raise exception 'C9 voided invoice accepted';end if;
end$$;

select 'OIC PASS';
rollback;
