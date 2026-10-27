-- Fictional isolated M05 fixture (opening AP/AR per invoice); every row rolls back.
begin;
insert into auth.users(id)values(md5('m05-owner')::uuid),(md5('m05-finance')::uuid),(md5('m05-staff')::uuid),(md5('m05-owner-off')::uuid);
insert into profiles(id,full_name,role,is_active)values
 (md5('m05-owner')::uuid,'Fiction owner','OWNER',true),(md5('m05-finance')::uuid,'Fiction finance','FINANCE',true),
 (md5('m05-staff')::uuid,'Fiction staff','STAFF',true),(md5('m05-owner-off')::uuid,'Fiction inactive owner','OWNER',false)
on conflict(id)do update set full_name=excluded.full_name,role=excluded.role,is_active=excluded.is_active;
insert into branches(id,code,name,type)values(md5('m05-branch')::uuid,'M05-A','Fiction M05 branch','PETSHOP');
insert into user_branches(user_id,branch_id,role)values(md5('m05-staff')::uuid,md5('m05-branch')::uuid,'PRIMARY');
insert into coa_accounts(code,name,type,normal_balance)values('2101','Fiction trade payables','LIABILITAS','K'),
 ('1201','Fiction trade receivables','ASET','D'),('3101','Fiction owner equity','EKUITAS','K') on conflict do nothing;
insert into suppliers(id,nama)values(md5('m05-sup-1')::uuid,'PT Fiksi Satu'),(md5('m05-sup-2')::uuid,'PT Fiksi Dua'),
 (md5('m05-twin-1')::uuid,'CV Kembar'),(md5('m05-twin-2')::uuid,'cv  kembar');
insert into customers(id,name,phone)values(md5('m05-cus-1')::uuid,'Toko Fiksi Sejahtera','0800000005');
create temporary table m05_payload on commit drop as select
 jsonb_build_object('source_name','Saldo-Awal-Fiksi.xlsx','as_of',((now() at time zone 'Asia/Jakarta')::date-7)::text,'branch_id',md5('m05-branch')::uuid,
  'control',jsonb_build_object('hutang','600000','piutang','250000'),
  'rows',jsonb_build_array(
   jsonb_build_object('baris',2,'jenis','HUTANG','kode_pihak','S-001','nama_pihak','  pt fiksi   satu ','no_faktur','INV-1','tanggal','2026-08-01','jatuh_tempo','2026-08-31','sisa','100000','total_asli','150000','keterangan','Sisa sebagian'),
   jsonb_build_object('baris',3,'jenis','HUTANG','kode_pihak','S-001','nama_pihak','PT Fiksi Satu','no_faktur','INV-2','tanggal','2026-09-01','jatuh_tempo','2026-10-01','sisa','200000','total_asli',null,'keterangan',null),
   jsonb_build_object('baris',4,'jenis','hutang','kode_pihak',null,'nama_pihak','PT Fiksi Satu','no_faktur','INV-3','tanggal','2026-09-15','jatuh_tempo','2026-10-15','sisa','300000','total_asli',null,'keterangan',null),
   jsonb_build_object('baris',5,'jenis','PIUTANG','kode_pihak','C-9','nama_pihak','Toko Fiksi Sejahtera','no_faktur','FJ-OLD-77','tanggal','2026-09-10','jatuh_tempo','2026-10-10','sisa','250000','total_asli',null,'keterangan',null))) payload;
grant select on m05_payload to authenticated;
set local role authenticated;set local request.jwt.claim.role='authenticated';

do $$declare p jsonb;bad jsonb;report jsonb;res jsonb;again jsonb;blocked boolean;row_errors text;j uuid;inv2 uuid;ar uuid;pay jsonb;rc jsonb;remaining numeric;
begin
 select payload into p from m05_payload;
 -- Access: STAFF cannot even preview; FINANCE previews but cannot post; inactive OWNER refused.
 perform set_config('request.jwt.claim.sub',md5('m05-staff')::uuid::text,true);
 blocked:=false;begin perform preview_opening_invoices(p);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'STAFF preview accepted';end if;
 perform set_config('request.jwt.claim.sub',md5('m05-finance')::uuid::text,true);
 report:=preview_opening_invoices(p);
 if not (report->>'can_post')::boolean then raise exception 'Valid file not postable: %',report;end if;
 blocked:=false;begin perform post_opening_invoices(p,report->>'source_hash','Cutover Accurate 31 Oktober');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'FINANCE post accepted';end if;
 perform set_config('request.jwt.claim.sub',md5('m05-owner-off')::uuid::text,true);
 blocked:=false;begin perform post_opening_invoices(p,report->>'source_hash','Cutover Accurate 31 Oktober');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Inactive OWNER post accepted';end if;

 -- Preview: one supplier with three invoices, matched by normalized name; totals reconcile.
 perform set_config('request.jwt.claim.sub',md5('m05-owner')::uuid::text,true);
 report:=preview_opening_invoices(p);
 if (report->'totals'->'hutang'->>'jumlah_faktur')::int<>3 or (report->'totals'->'hutang'->>'total')::numeric<>600000
  or (report->'totals'->'piutang'->>'total')::numeric<>250000 then raise exception 'Totals wrong: %',report->'totals';end if;
 if not exists(select 1 from jsonb_array_elements(report->'parties') x where x->>'party_id'=md5('m05-sup-1')::uuid::text and (x->>'jumlah_faktur')::int=3 and (x->>'total')::numeric=600000)
  then raise exception 'Per-party total wrong: %',report->'parties';end if;
 if exists(select 1 from jsonb_array_elements(report->'rows') x where x->>'matched_by' is distinct from 'nama') then raise exception 'Match basis missing';end if;

 -- Validation before posting: every bad row is reported, nothing postable.
 bad:=jsonb_set(p,'{rows}',(p->'rows')||jsonb_build_array(
  jsonb_build_object('baris',6,'jenis','HUTANG','nama_pihak','PT Tidak Ada','no_faktur','X-1','tanggal','2026-09-01','jatuh_tempo','2026-09-30','sisa','10'),
  jsonb_build_object('baris',7,'jenis','HUTANG','nama_pihak','PT Fiksi Satu','no_faktur','inv-2','tanggal','2026-09-01','jatuh_tempo','2026-09-30','sisa','10'),
  jsonb_build_object('baris',8,'jenis','HUTANG','nama_pihak','PT Fiksi Dua','no_faktur','D-1','tanggal','2026-02-30','jatuh_tempo','2026-09-30','sisa','0'),
  jsonb_build_object('baris',9,'jenis','HUTANG','nama_pihak','PT Fiksi Dua','no_faktur','D-2','tanggal','2026-09-30','jatuh_tempo','2026-09-01','sisa','10.5'),
  jsonb_build_object('baris',10,'jenis','HUTANG','nama_pihak','CV Kembar','no_faktur','K-1','tanggal','2026-09-01','jatuh_tempo','2026-09-30','sisa','10'),
  jsonb_build_object('baris',11,'jenis','LAIN','nama_pihak','PT Fiksi Dua','no_faktur','D-3','tanggal','2099-01-01','jatuh_tempo','2099-01-01','sisa','10')));
 report:=preview_opening_invoices(bad);
 select string_agg((x->>'baris')||':'||(x->'errors')::text,' | ' order by (x->>'baris')::int) into row_errors from jsonb_array_elements(report->'rows') x where jsonb_array_length(x->'errors')>0;
 if (report->>'can_post')::boolean or (report->>'error_rows')::int<>7 then raise exception 'Bad rows not caught: %',row_errors;end if;
 if row_errors not like '%6:%Pemasok belum ada%' or row_errors not like '%3:%muncul lebih dari sekali%' or row_errors not like '%7:%muncul lebih dari sekali%'
  or row_errors not like '%8:%Tanggal faktur tidak valid%' or row_errors not like '%8:%Sisa tagihan%' or row_errors not like '%9:%Jatuh tempo sebelum%'
  or row_errors not like '%9:%Sisa tagihan%' or row_errors not like '%10:%2 data master%' or row_errors not like '%11:%Jenis harus%'
  then raise exception 'Unexpected row errors: %',row_errors;end if;
 if not exists(select 1 from jsonb_array_elements_text(report->'blockers') b where b like 'Total kontrol hutang%') then raise exception 'Control total mismatch not blocking: %',report->'blockers';end if;
 blocked:=false;begin perform post_opening_invoices(bad,report->>'source_hash','Cutover Accurate 31 Oktober');exception when others then blocked:=sqlerrm like 'Batch belum dapat diposting%';end;
 if not blocked then raise exception 'Invalid batch posted';end if;
 -- Missing control total blocks too.
 report:=preview_opening_invoices(p-'control');
 if (report->>'can_post')::boolean then raise exception 'Missing control total accepted';end if;

 -- Fail closed on double counting when the account-level opening already carries 1201 (scenario rolled back).
 begin
  perform create_opening_balance_atomic('m05-saldo-1',((now() at time zone 'Asia/Jakarta')::date-30),jsonb_build_array(jsonb_build_object('code','1201','nilai',5000,'sisi','D')));
  report:=preview_opening_invoices(p);
  if (report->>'can_post')::boolean or not exists(select 1 from jsonb_array_elements_text(report->'blockers') b where b like 'Piutang Usaha (1201) sudah diisi%') then raise exception 'Double count not blocked: %',report->'blockers';end if;
  report:=preview_opening_invoices(jsonb_set(jsonb_set(p,'{rows}',jsonb_path_query_array(p->'rows','$[*] ? (@.jenis != "PIUTANG")')),'{control,piutang}','null'));
  if not (report->>'can_post')::boolean then raise exception 'AP-only batch wrongly blocked by AR opening: %',report->'blockers';end if;
  raise exception 'M05_ROLLBACK_SCENARIO';
 exception when others then if sqlerrm<>'M05_ROLLBACK_SCENARIO' then raise;end if;end;

 -- Post: atomic, balanced, idempotent.
 report:=preview_opening_invoices(p);
 blocked:=false;begin perform post_opening_invoices(p,repeat('0',64),'Cutover Accurate 31 Oktober');exception when others then blocked:=sqlerrm like 'Isi file berubah%';end;
 if not blocked then raise exception 'Stale preview hash accepted';end if;
 res:=post_opening_invoices(p,report->>'source_hash','Cutover Accurate 31 Oktober');
 if (res->>'replayed')::boolean or (res->'hutang'->>'jumlah_faktur')::int<>3 or (res->'piutang'->>'jumlah_faktur')::int<>1 then raise exception 'Post result wrong: %',res;end if;
 j:=(res->>'journal_id')::uuid;
 if (select count(*) from purchase_invoices where opening_batch_id=(res->>'batch_id')::uuid and supplier_id=md5('m05-sup-1')::uuid and branch_id=md5('m05-branch')::uuid)<>3
  or (select sum(total) from purchase_invoices where opening_batch_id=(res->>'batch_id')::uuid)<>600000
  or (select count(*) from sales_invoices where opening_batch_id=(res->>'batch_id')::uuid and customer_id=md5('m05-cus-1')::uuid and status='berjalan' and dpp=0 and ppn=0)<>1
  then raise exception 'Opening invoices not stored as expected';end if;
 if exists(select 1 from purchase_invoices where opening_batch_id is not null and (po_id is not null or warehouse_id is not null))
  or (select no_faktur_pemasok from purchase_invoices where opening_batch_id is not null and total=200000)<>'INV-2'
  or (select tanggal from purchase_invoices where opening_batch_id is not null and total=200000)<>'2026-09-01'
  or (select catatan from sales_invoices where opening_batch_id is not null) not like 'Saldo awal Accurate · No. FJ-OLD-77%' then raise exception 'Invoice identity wrong';end if;
 if (select sum(debit) from journal_lines where entry_id=j)<>(select sum(credit) from journal_lines where entry_id=j)
  or (select sum(credit-debit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=j and a.code='2101')<>600000
  or (select sum(debit-credit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=j and a.code='1201')<>250000
  or (select sum(credit-debit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=j and a.code='3101')<>-350000
  or (select count(*) from journal_lines where entry_id=j)<>4
  or (select tanggal::text from journal_entries where id=j)<>p->>'as_of' or (select source from journal_entries where id=j)<>'opening-invoice'
  then raise exception 'Opening journal not balanced as expected';end if;
 if (select count(*) from journal_entries where source in ('purchase-invoice','sales-invoice'))<>0 or exists(select 1 from stock_moves) or exists(select 1 from stock_layers)
  then raise exception 'Opening invoices must not create purchase/revenue journals or stock';end if;
 again:=post_opening_invoices(p,report->>'source_hash','Cutover Accurate 31 Oktober (ulang)');
 if not (again->>'replayed')::boolean or again->>'batch_id'<>res->>'batch_id' or (select count(*) from opening_invoice_batches)<>1
  or (select count(*) from purchase_invoices where opening_batch_id is not null)<>3 or (select count(*) from journal_entries where source='opening-invoice')<>1
  then raise exception 'Re-post duplicated the batch';end if;
 report:=preview_opening_invoices(p);
 if report->>'status'<>'posted' or (report->>'can_post')::boolean then raise exception 'Posted batch still postable';end if;
 -- Same invoices in a different file are refused as duplicates against the database.
 report:=preview_opening_invoices(jsonb_set(p,'{source_name}','"Lain.xlsx"')||jsonb_build_object('as_of',((now() at time zone 'Asia/Jakarta')::date-6)::text));
 if (report->>'error_rows')::int<>4 or not exists(select 1 from jsonb_array_elements(report->'rows') x where (x->'errors')::text like '%sudah tercatat di VetOS%') then raise exception 'DB duplicates not caught: %',report->'rows';end if;

 -- Account-level opening may no longer carry 2101/1201; other accounts are still fine.
 blocked:=false;begin perform create_opening_balance_atomic('m05-saldo-2',((now() at time zone 'Asia/Jakarta')::date-30),jsonb_build_array(jsonb_build_object('code','2101','nilai',5000,'sisi','K'),jsonb_build_object('code','1101','nilai',5000,'sisi','D')));
 exception when others then blocked:=sqlerrm like 'Akun 2101 sudah diisi per faktur%';end;
 if not blocked then raise exception 'Account-level 2101 opening accepted after per-invoice import';end if;

 -- Existing payment flows allocate against a specific opening invoice and reduce only its outstanding.
 select id into inv2 from purchase_invoices where opening_batch_id is not null and no_faktur_pemasok='INV-2';
 pay:=pay_purchase_invoice_atomic('m05-pay-1',inv2,(now() at time zone 'Asia/Jakarta')::date,75000,'Tunai','Cicilan faktur lama',null,null);
 select total-(select coalesce(sum(amount),0) from purchase_invoice_payments where invoice_id=inv2) into remaining from purchase_invoices where id=inv2;
 if remaining<>125000 or exists(select 1 from purchase_invoice_payments pp join purchase_invoices pi on pi.id=pp.invoice_id where pi.opening_batch_id is not null and pi.id<>inv2)
  then raise exception 'Payment not allocated to the chosen opening invoice';end if;
 if (select sum(debit-credit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=(pay->>'journal_id')::uuid and a.code='2101')<>75000 then raise exception 'Payment journal does not reduce 2101';end if;
 blocked:=false;begin perform pay_purchase_invoice_atomic('m05-pay-2',inv2,(now() at time zone 'Asia/Jakarta')::date,125001,'Tunai',null,null,null);exception when others then blocked:=sqlerrm like 'Nominal melebihi%';end;
 if not blocked then raise exception 'Overpayment of opening invoice accepted';end if;
 if (select sum(credit-debit) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='2101')<>525000 then raise exception '2101 balance does not match open invoices';end if;
 select id into ar from sales_invoices where opening_batch_id is not null;
 rc:=receive_wholesale_payment('m05-rc-1',ar,(now() at time zone 'Asia/Jakarta')::date,250000,'Transfer',null,null,'Pelunasan faktur lama');
 if (select status from sales_invoices where id=ar)<>'lunas' or (select sum(jumlah) from sales_receipts where invoice_id=ar)<>250000
  or (select sum(debit-credit) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='1201')<>0 then raise exception 'Receipt not applied to opening receivable';end if;

 -- Opening invoices cannot be voided, edited, deleted or given lines; their journal is protected.
 blocked:=false;begin perform cancel_purchase_invoice(inv2,(select revision from purchase_invoices where id=inv2),'m05-cancel','Coba batalkan faktur saldo awal',(now() at time zone 'Asia/Jakarta')::date);
 exception when others then blocked:=sqlerrm like 'Bukti asal nilai faktur%' or sqlerrm like 'Faktur saldo awal%';end;
 if not blocked then raise exception 'Opening purchase invoice was voided';end if;
 blocked:=false;begin update sales_invoices set total=1 where id=ar;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Direct edit of opening sales invoice accepted';end if;
 blocked:=false;begin delete from sales_invoices where id=ar;exception when insufficient_privilege then blocked:=true;end;
 if not blocked or not exists(select 1 from sales_invoices where id=ar) then raise exception 'Opening sales invoice deleted';end if;
 blocked:=false;begin insert into sales_invoice_items(invoice_id,nama,qty,harga)values(ar,'Fiksi',1,1);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Line added to opening sales invoice';end if;
 blocked:=false;begin insert into sales_invoices(no_faktur,customer_id,branch_id,total,opening_batch_id)values('FJ.FAKE',md5('m05-cus-1')::uuid,md5('m05-branch')::uuid,1,(res->>'batch_id')::uuid);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Forged opening sales invoice accepted';end if;
 blocked:=false;begin update journal_entries set deskripsi='ubah' where id=j;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Opening journal editable';end if;
 if (select count(*) from opening_invoice_lines where batch_id=(res->>'batch_id')::uuid)<>4 then raise exception 'Batch lines missing or unreadable for OWNER';end if;
 perform set_config('request.jwt.claim.sub',md5('m05-staff')::uuid::text,true);
 if exists(select 1 from opening_invoice_batches) or exists(select 1 from opening_invoice_lines) then raise exception 'STAFF can read opening batches';end if;
end$$;
-- Privileged code paths (SECURITY DEFINER RPCs) still cannot void or rewrite an opening invoice.
reset role;
do $$declare blocked boolean:=false;begin
 begin update purchase_invoices set voided_at=now(),void_reason='uji' where opening_batch_id is not null and no_faktur_pemasok='INV-1';
 exception when insufficient_privilege then blocked:=sqlerrm like 'Faktur saldo awal hanya berubah%';end;
 if not blocked then raise exception 'Privileged void of opening purchase invoice accepted';end if;
 blocked:=false;begin update sales_invoices set status='batal' where opening_batch_id is not null;
 exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Privileged cancel of opening sales invoice accepted';end if;
 blocked:=false;begin delete from opening_invoice_batches;exception when others then blocked:=true;end;
 if not blocked then raise exception 'Batch with invoices deleted';end if;
end$$;
rollback;
