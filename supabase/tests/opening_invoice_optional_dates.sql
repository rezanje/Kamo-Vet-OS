-- Fictional isolated M05 fixture: invoice date and due date are optional ("bila tersedia"); every row rolls back.
-- Covers both dates, only one date, no date, and invalid dates; no substitute date is ever written;
-- amounts, numbering, party, branch, duplicate prevention, payment per invoice and protection still hold.
-- Checks are scoped to this batch (and 2101/1201 to deltas) so the suite also runs on a database that
-- already holds other committed opening batches (owner-package rehearsal).
begin;
insert into auth.users(id)values(md5('m05d-owner')::uuid),(md5('m05d-finance')::uuid);
insert into profiles(id,full_name,role,is_active)values
 (md5('m05d-owner')::uuid,'Fiction owner','OWNER',true),(md5('m05d-finance')::uuid,'Fiction finance','FINANCE',true)
on conflict(id)do update set full_name=excluded.full_name,role=excluded.role,is_active=excluded.is_active;
insert into branches(id,code,name,type)values(md5('m05d-branch')::uuid,'M05D-A','Fiction M05 dates branch','PETSHOP');
insert into warehouses(id,branch_id,code,name,type)values(md5('m05d-wh')::uuid,md5('m05d-branch')::uuid,'M05D-WH','Fiction M05 dates warehouse','VET');
insert into coa_accounts(code,name,type,normal_balance)values('311001','Fiction trade payables','LIABILITAS','K'),
 ('150001','Fiction trade receivables','ASET','D'),('410001','Fiction owner equity','EKUITAS','K'),('110299','Fiction bank M05D','ASET','D')
 on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
insert into cash_accounts(id,nama,jenis,coa_code,branch_id)values(md5('m05d-bank')::uuid,'Fiction bank M05D','Bank','110299',md5('m05d-branch')::uuid);
insert into suppliers(id,nama)values(md5('m05d-sup-a')::uuid,'PT Fiksi Tanggal'),(md5('m05d-sup-b')::uuid,'PT Fiksi Kosong');
insert into customers(id,name,phone)values(md5('m05d-cus')::uuid,'Toko Fiksi Tanpa Tanggal','0800000015');
create temporary table m05d_payload on commit drop as select
 jsonb_build_object('source_name','Saldo-Awal-Tanpa-Tanggal.xlsx','as_of',((now() at time zone 'Asia/Jakarta')::date-7)::text,'branch_id',md5('m05d-branch')::uuid,
  'control',jsonb_build_object('hutang','1000000','piutang','300000'),
  'rows',jsonb_build_array(
   -- both dates
   jsonb_build_object('baris',2,'jenis','HUTANG','nama_pihak','PT Fiksi Tanggal','no_faktur','A-1','tanggal','2026-08-01','jatuh_tempo','2026-08-31','sisa','100000'),
   -- invoice date only
   jsonb_build_object('baris',3,'jenis','HUTANG','nama_pihak','PT Fiksi Tanggal','no_faktur','A-2','tanggal','2026-09-01','jatuh_tempo','','sisa','200000'),
   -- due date only (whitespace counts as empty)
   jsonb_build_object('baris',4,'jenis','HUTANG','nama_pihak','PT Fiksi Tanggal','no_faktur','A-3','tanggal','   ','jatuh_tempo','2026-12-31','sisa','300000'),
   -- no dates at all (empty strings)
   jsonb_build_object('baris',5,'jenis','HUTANG','nama_pihak','PT Fiksi Kosong','no_faktur','B-1','tanggal','','jatuh_tempo','','sisa','400000','total_asli','450000'),
   -- no dates at all (keys absent)
   jsonb_build_object('baris',6,'jenis','PIUTANG','nama_pihak','Toko Fiksi Tanpa Tanggal','no_faktur','FJ-ND-1','sisa','120000'),
   jsonb_build_object('baris',7,'jenis','PIUTANG','nama_pihak','Toko Fiksi Tanpa Tanggal','no_faktur','FJ-ND-2','tanggal','2026-09-10','jatuh_tempo','2026-10-10','sisa','180000'))) payload;
grant select on m05d_payload to authenticated;
set local role authenticated;set local request.jwt.claim.role='authenticated';

do $$declare p jsonb;bad jsonb;report jsonb;res jsonb;again jsonb;blocked boolean;row_errors text;j uuid;b1 uuid;a3 uuid;ar uuid;pay jsonb;ord jsonb;remaining numeric;v_as_of date;
 ap0 numeric;ar0 numeric;
begin
 select payload into p from m05d_payload;
 v_as_of:=(p->>'as_of')::date;

 -- Preview: every combination of present/absent dates is accepted, nothing is filled in.
 perform set_config('request.jwt.claim.sub',md5('m05d-finance')::uuid::text,true);
 report:=preview_opening_invoices(p);
 if not (report->>'can_post')::boolean or (report->>'error_rows')::int<>0 then raise exception 'Undated rows not accepted: % %',report->'blockers',report->'rows';end if;
 if (select string_agg((x->>'baris')||'='||coalesce(x->>'tanggal','∅')||'/'||coalesce(x->>'jatuh_tempo','∅'),' ' order by (x->>'baris')::int) from jsonb_array_elements(report->'rows') x)
   <>'2=2026-08-01/2026-08-31 3=2026-09-01/∅ 4=∅/2026-12-31 5=∅/∅ 6=∅/∅ 7=2026-09-10/2026-10-10'
  then raise exception 'Preview dates wrong: %',report->'rows';end if;
 if (report->'totals'->'hutang'->>'total')::numeric<>1000000 or (report->'totals'->'hutang'->>'jumlah_faktur')::int<>4
  or (report->'totals'->'piutang'->>'total')::numeric<>300000 or (report->'totals'->'piutang'->>'jumlah_faktur')::int<>2
  then raise exception 'Totals wrong: %',report->'totals';end if;

 -- A filled date must still be valid: bad text, impossible day, non-ISO text that reached the database,
 -- invoice date after cutover, due date before invoice date. An empty partner date never hides the error.
 bad:=jsonb_set(p,'{rows}',(p->'rows')||jsonb_build_array(
  jsonb_build_object('baris',8,'jenis','HUTANG','nama_pihak','PT Fiksi Kosong','no_faktur','X-1','tanggal','2026-02-30','jatuh_tempo','','sisa','10'),
  jsonb_build_object('baris',9,'jenis','HUTANG','nama_pihak','PT Fiksi Kosong','no_faktur','X-2','tanggal','','jatuh_tempo','besok','sisa','10'),
  jsonb_build_object('baris',10,'jenis','HUTANG','nama_pihak','PT Fiksi Kosong','no_faktur','X-3','tanggal','31/10/2026','jatuh_tempo','2026-13-01','sisa','10'),
  jsonb_build_object('baris',11,'jenis','PIUTANG','nama_pihak','Toko Fiksi Tanpa Tanggal','no_faktur','X-4','tanggal','2099-01-01','sisa','10'),
  jsonb_build_object('baris',12,'jenis','PIUTANG','nama_pihak','Toko Fiksi Tanpa Tanggal','no_faktur','X-5','tanggal','2026-09-30','jatuh_tempo','2026-09-01','sisa','10'),
  -- an undated row is still a duplicate when its number repeats in the file
  jsonb_build_object('baris',13,'jenis','HUTANG','nama_pihak','PT Fiksi Kosong','no_faktur','b-1','sisa','10')));
 report:=preview_opening_invoices(bad);
 select string_agg((x->>'baris')||':'||(x->'errors')::text,' | ' order by (x->>'baris')::int) into row_errors from jsonb_array_elements(report->'rows') x where jsonb_array_length(x->'errors')>0;
 if (report->>'can_post')::boolean or (report->>'error_rows')::int<>7 then raise exception 'Bad rows not caught: %',row_errors;end if;
 if row_errors not like '%8:["Tanggal faktur tidak valid"]%' or row_errors not like '%9:["Jatuh tempo tidak valid"]%'
  or row_errors not like '%10:["Tanggal faktur tidak valid", "Jatuh tempo tidak valid"]%'
  or row_errors not like '%11:["Tanggal faktur sesudah tanggal saldo awal"]%' or row_errors not like '%12:["Jatuh tempo sebelum tanggal faktur"]%'
  or row_errors not like '%5:["No faktur muncul lebih dari sekali di file ini"]%' or row_errors not like '%13:["No faktur muncul lebih dari sekali di file ini"]%'
  then raise exception 'Unexpected row errors: %',row_errors;end if;

 -- Post (OWNER): one invoice per row, empty dates stay empty on the invoice and the batch line.
 perform set_config('request.jwt.claim.sub',md5('m05d-owner')::uuid::text,true);
 -- 2101/1201 balances before this batch, read as OWNER (journal RLS), so later checks are deltas.
 select coalesce(sum(credit-debit) filter (where a.code='311001'),0),coalesce(sum(debit-credit) filter (where a.code='150001'),0) into ap0,ar0
  from journal_lines l join coa_accounts a on a.id=l.account_id;
 report:=preview_opening_invoices(p);
 res:=post_opening_invoices(p,report->>'source_hash','Cutover Accurate tanpa tanggal fiksi');
 if (res->'hutang'->>'jumlah_faktur')::int<>4 or (res->'piutang'->>'jumlah_faktur')::int<>2 then raise exception 'Post result wrong: %',res;end if;
 if (select string_agg(no_faktur_pemasok||'='||coalesce(tanggal::text,'∅')||'/'||coalesce(jatuh_tempo::text,'∅')||'/'||total,' ' order by no_faktur_pemasok)
     from purchase_invoices where opening_batch_id=(res->>'batch_id')::uuid)
   <>'A-1=2026-08-01/2026-08-31/100000 A-2=2026-09-01/∅/200000 A-3=∅/2026-12-31/300000 B-1=∅/∅/400000'
  then raise exception 'Purchase invoice dates/amounts wrong';end if;
 if (select string_agg(coalesce(tanggal::text,'∅')||'/'||coalesce(jatuh_tempo::text,'∅')||'/'||round(total),' ' order by total)
     from sales_invoices where opening_batch_id=(res->>'batch_id')::uuid and customer_id=md5('m05d-cus')::uuid and branch_id=md5('m05d-branch')::uuid)
   <>'∅/∅/120000 2026-09-10/2026-10-10/180000'
  then raise exception 'Sales invoice dates/amounts wrong';end if;
 -- No substitute date anywhere: not the cutover date, not today, not today+30 (the column defaults).
 if exists(select 1 from purchase_invoices where opening_batch_id=(res->>'batch_id')::uuid and (tanggal in (v_as_of,current_date) or jatuh_tempo in (v_as_of,current_date,current_date+30)))
  or exists(select 1 from sales_invoices where opening_batch_id=(res->>'batch_id')::uuid and (tanggal in (v_as_of,current_date) or jatuh_tempo in (v_as_of,current_date,current_date+30)))
  then raise exception 'A substitute date was written';end if;
 if (select count(*) filter (where tanggal is null) from opening_invoice_lines where batch_id=(res->>'batch_id')::uuid)<>3
  or (select count(*) filter (where jatuh_tempo is null) from opening_invoice_lines where batch_id=(res->>'batch_id')::uuid)<>3
  or (select original_total from opening_invoice_lines where batch_id=(res->>'batch_id')::uuid and source_no='B-1')<>450000
  then raise exception 'Batch lines do not keep the empty dates';end if;
 -- Supplier, numbering and the balanced journal are unchanged by missing dates.
 if (select count(*) from purchase_invoices where opening_batch_id=(res->>'batch_id')::uuid and supplier_id=md5('m05d-sup-b')::uuid)<>1
  or (select count(*) from purchase_invoices where opening_batch_id=(res->>'batch_id')::uuid and branch_id=md5('m05d-branch')::uuid and no_faktur like 'FB.%')<>4
  or (select count(*) from sales_invoices where opening_batch_id=(res->>'batch_id')::uuid and no_faktur like 'FJ%' and status='berjalan')<>2
  then raise exception 'Invoice identity wrong';end if;
 j:=(res->>'journal_id')::uuid;
 if (select tanggal from journal_entries where id=j)<>v_as_of
  or (select sum(credit-debit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=j and a.code='311001')<>1000000
  or (select sum(debit-credit) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=j and a.code='150001')<>300000
  or (select sum(debit) from journal_lines where entry_id=j)<>(select sum(credit) from journal_lines where entry_id=j)
  then raise exception 'Opening journal wrong';end if;

 -- Idempotent and duplicate-proof without dates.
 again:=post_opening_invoices(p,report->>'source_hash','Cutover Accurate tanpa tanggal fiksi (ulang)');
 if not (again->>'replayed')::boolean or again->>'batch_id'<>res->>'batch_id' or (select count(*) from purchase_invoices where opening_batch_id=(res->>'batch_id')::uuid)<>4
  or (select count(*) from journal_entries where source='opening-invoice' and source_ref=res->>'batch_id')<>1 then raise exception 'Re-post duplicated';end if;
 report:=preview_opening_invoices(jsonb_set(p,'{source_name}','"Lain.xlsx"')||jsonb_build_object('as_of',(v_as_of+1)::text));
 if (report->>'error_rows')::int<>6 or exists(select 1 from jsonb_array_elements(report->'rows') x where (x->'errors')::text not like '%sudah tercatat di VetOS%')
  then raise exception 'Undated duplicates against the database not caught: %',report->'rows';end if;

 -- Payment per invoice works on undated invoices through the existing flows.
 select id into b1 from purchase_invoices where opening_batch_id=(res->>'batch_id')::uuid and no_faktur_pemasok='B-1';
 pay:=pay_purchase_invoice_atomic('m05d-pay-1',b1,(now() at time zone 'Asia/Jakarta')::date,150000,'Tunai','Cicilan faktur tanpa tanggal',null,null);
 select total-(select coalesce(sum(amount),0) from purchase_invoice_payments where invoice_id=b1) into remaining from purchase_invoices where id=b1;
 if remaining<>250000 or exists(select 1 from purchase_invoice_payments pp join purchase_invoices pi on pi.id=pp.invoice_id where pi.opening_batch_id=(res->>'batch_id')::uuid and pi.id<>b1)
  then raise exception 'Payment not allocated to the undated invoice';end if;
 blocked:=false;begin perform pay_purchase_invoice_atomic('m05d-pay-2',b1,(now() at time zone 'Asia/Jakarta')::date,250001,'Tunai',null,null,null);exception when others then blocked:=sqlerrm like 'Nominal melebihi%';end;
 if not blocked then raise exception 'Overpayment of undated invoice accepted';end if;
 -- Payment order (perintah bayar) on an invoice with no invoice date.
 select id into a3 from purchase_invoices where opening_batch_id=(res->>'batch_id')::uuid and no_faktur_pemasok='A-3';
 ord:=mutate_purchase_payment_order('m05d-po-create','create',null,null,jsonb_build_object('supplier_id',md5('m05d-sup-a')::uuid),jsonb_build_array(jsonb_build_object('invoice_id',a3,'jumlah',300000)));
 perform mutate_purchase_payment_order('m05d-po-approve','approve',(ord->>'order_id')::uuid,0,'{}','[]');
 perform pay_purchase_payment_order_atomic('m05d-po-pay',(ord->>'order_id')::uuid,(now() at time zone 'Asia/Jakarta')::date,'Transfer',md5('m05d-bank')::uuid,1);
 if (select coalesce(sum(amount),0) from purchase_invoice_payments where invoice_id=a3)<>300000 then raise exception 'Payment order did not settle the undated invoice';end if;
 if (select sum(credit-debit) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='311001')-ap0<>550000 then raise exception '2101 does not match open invoices';end if;
 select id into ar from sales_invoices where opening_batch_id=(res->>'batch_id')::uuid and tanggal is null;
 perform receive_wholesale_payment('m05d-rc-1',ar,(now() at time zone 'Asia/Jakarta')::date,120000,'Transfer',null,null,'Pelunasan faktur tanpa tanggal');
 if (select status from sales_invoices where id=ar)<>'lunas' or (select sum(debit-credit) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='150001')-ar0<>180000
  then raise exception 'Receipt not applied to the undated receivable';end if;

 -- Undated opening invoices stay protected: no void, no date added later, no forged undated invoice.
 blocked:=false;begin perform cancel_purchase_invoice(b1,(select revision from purchase_invoices where id=b1),'m05d-cancel','Coba batalkan faktur tanpa tanggal',(now() at time zone 'Asia/Jakarta')::date);
 exception when others then blocked:=true;end;
 if not blocked or (select voided_at from purchase_invoices where id=b1) is not null then raise exception 'Undated opening invoice was voided';end if;
 blocked:=false;begin update sales_invoices set tanggal=v_as_of where id=ar;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Date written into an undated opening invoice';end if;
 blocked:=false;begin insert into sales_invoices(no_faktur,customer_id,branch_id,tanggal,jatuh_tempo,total,opening_batch_id)values('FJ.FAKE.ND',md5('m05d-cus')::uuid,md5('m05d-branch')::uuid,null,null,1,(res->>'batch_id')::uuid);
 exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Forged undated opening invoice accepted';end if;
end$$;

-- Privileged paths: every NON-opening invoice still needs both dates; opening invoices cannot gain or lose a date.
reset role;
do $$declare blocked boolean;begin
 blocked:=false;begin insert into purchase_invoices(no_faktur,supplier_id,warehouse_id,tanggal,jatuh_tempo,total)
  values('FB.FAKE.ND',md5('m05d-sup-a')::uuid,md5('m05d-wh')::uuid,null,'2026-10-01',1);
 exception when check_violation then blocked:=sqlerrm like '%purchase_invoices_tanggal_wajib_check%';end;
 if not blocked then raise exception 'Regular purchase invoice without invoice date accepted';end if;
 blocked:=false;begin insert into purchase_invoices(no_faktur,supplier_id,warehouse_id,tanggal,jatuh_tempo,total)
  values('FB.FAKE.ND2',md5('m05d-sup-a')::uuid,md5('m05d-wh')::uuid,'2026-10-01',null,1);
 exception when check_violation then blocked:=sqlerrm like '%purchase_invoices_tanggal_wajib_check%';end;
 if not blocked then raise exception 'Regular purchase invoice without due date accepted';end if;
 blocked:=false;begin insert into sales_invoices(no_faktur,customer_id,branch_id,tanggal,jatuh_tempo,total)values('FJ.FAKE.ND2',md5('m05d-cus')::uuid,md5('m05d-branch')::uuid,'2026-10-01',null,1);
 exception when check_violation then blocked:=sqlerrm like '%sales_invoices_tanggal_wajib_check%';end;
 if not blocked then raise exception 'Regular sales invoice without due date accepted';end if;
 blocked:=false;begin insert into sales_invoices(no_faktur,customer_id,branch_id,tanggal,jatuh_tempo,total)values('FJ.FAKE.ND3',md5('m05d-cus')::uuid,md5('m05d-branch')::uuid,null,'2026-10-01',1);
 exception when check_violation then blocked:=sqlerrm like '%sales_invoices_tanggal_wajib_check%';end;
 if not blocked then raise exception 'Regular sales invoice without invoice date accepted';end if;
 -- Omitting the dates on a regular invoice still takes the column defaults, exactly as before.
 insert into sales_invoices(no_faktur,customer_id,branch_id,total)values('FJ.FAKE.DEFAULT',md5('m05d-cus')::uuid,md5('m05d-branch')::uuid,1);
 if (select tanggal is null or jatuh_tempo is null from sales_invoices where no_faktur='FJ.FAKE.DEFAULT') then raise exception 'Regular invoice lost its default dates';end if;
 blocked:=false;begin update purchase_invoices set jatuh_tempo='2026-12-31' where opening_batch_id is not null and no_faktur_pemasok='B-1';
 exception when insufficient_privilege then blocked:=sqlerrm like 'Faktur saldo awal hanya berubah%';end;
 if not blocked then raise exception 'Privileged date edit of undated opening invoice accepted';end if;
 blocked:=false;begin update purchase_invoices set tanggal=null where opening_batch_id is not null and no_faktur_pemasok='A-1';
 exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Privileged date removal of dated opening invoice accepted';end if;
end$$;
rollback;
