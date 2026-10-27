-- Fictional isolated A02/P01 fixture; every row rolls back.
begin;
insert into auth.users(id)values(md5('a02-owner')::uuid),(md5('a02-admin')::uuid),(md5('a02-staff')::uuid),(md5('a02-staff-b')::uuid),(md5('a02-finance')::uuid),(md5('a02-owner-off')::uuid);
insert into profiles(id,full_name,role,is_active)values
 (md5('a02-owner')::uuid,'Fiction owner','OWNER',true),(md5('a02-admin')::uuid,'Fiction admin','ADMIN',true),
 (md5('a02-staff')::uuid,'Fiction staff A','STAFF',true),(md5('a02-staff-b')::uuid,'Fiction staff B','STAFF',true),
 (md5('a02-finance')::uuid,'Fiction finance','FINANCE',true),(md5('a02-owner-off')::uuid,'Fiction inactive owner','OWNER',false)
on conflict(id)do update set full_name=excluded.full_name,role=excluded.role,is_active=excluded.is_active;
insert into branches(id,code,name,type)values(md5('a02-branch')::uuid,'A02-A','Fiction A02 branch','PETSHOP'),(md5('a02-other')::uuid,'A02-B','Fiction A02 other','PETSHOP');
insert into user_branches(user_id,branch_id,role)values(md5('a02-staff')::uuid,md5('a02-branch')::uuid,'PRIMARY'),(md5('a02-staff-b')::uuid,md5('a02-other')::uuid,'PRIMARY');
-- Staff only reaches Pembelian through an explicit Akses Grup row; FINANCE keeps its default (no Pembelian).
insert into role_modules(role,module_id)values('STAFF','klinik'),('STAFF','pembelian');
insert into warehouses(id,branch_id,code,name,type)values(md5('a02-wh')::uuid,md5('a02-branch')::uuid,'A02-W','Fiction A02 warehouse','RETAIL');
insert into suppliers(id,nama)values(md5('a02-supplier')::uuid,'Fiction A02 supplier');
insert into purchase_orders(id,no_po,branch_id,to_warehouse_id,supplier_id,status,total)values(md5('a02-po')::uuid,'PO.A02',md5('a02-branch')::uuid,md5('a02-wh')::uuid,md5('a02-supplier')::uuid,'Diterima',1000);
insert into purchase_invoices(id,no_faktur,po_id,supplier_id,total)values(md5('a02-invoice')::uuid,'FB.A02',md5('a02-po')::uuid,md5('a02-supplier')::uuid,1000);
create temporary table a02_before on commit drop as
 select (select to_jsonb(o) from purchase_orders o where id=md5('a02-po')::uuid) po,
        (select to_jsonb(i) from purchase_invoices i where id=md5('a02-invoice')::uuid) invoice,
        (select count(*) from journal_entries) journals,(select count(*) from purchase_invoice_payments) payments;
grant select on a02_before to authenticated;
set local role authenticated;set local request.jwt.claim.role='authenticated';

do $$declare blocked boolean;first jsonb;retry jsonb;inv jsonb;admin_req jsonb;processed jsonb;fin_req jsonb;
begin
 -- Requester with Pembelian access and branch access creates an origin-bound pending request.
 perform set_config('request.jwt.claim.sub',md5('a02-staff')::uuid::text,true);
 first:=create_purchase_correction_request('purchase_order',md5('a02-po')::uuid,'a02-key-0001','Harga baris 1 seharusnya 90, bukan 100');
 retry:=create_purchase_correction_request('purchase_order',md5('a02-po')::uuid,'a02-key-0001','Harga baris 1 seharusnya 90, bukan 100');
 if first is distinct from retry or first->>'status'<>'pending' or first->>'source_id'<>md5('a02-po')::uuid::text then raise exception 'Double submit was not idempotent or origin missing';end if;
 if (select count(*) from purchase_correction_requests)<>1 then raise exception 'Requester should see exactly own request';end if;
 if (select source_label from purchase_correction_requests)<>'PO.A02' then raise exception 'Source label snapshot missing';end if;
 blocked:=false;begin perform create_purchase_correction_request('purchase_order',md5('a02-po')::uuid,'a02-key-0001','Isi berbeda untuk kunci yang sama');exception when others then blocked:=sqlerrm like '%isi berbeda%';end;
 if not blocked then raise exception 'Reused request key with different content accepted';end if;
 inv:=create_purchase_correction_request('purchase_invoice',md5('a02-invoice')::uuid,'a02-key-0002','Satuan faktur seharusnya box isi 10');
 if inv->>'source_kind'<>'purchase_invoice' then raise exception 'Invoice origin missing';end if;
 blocked:=false;begin perform create_purchase_correction_request('purchase_order',md5('a02-po')::uuid,'a02-key-0003','short');exception when others then blocked:=true;end;
 if not blocked then raise exception 'Too-short detail accepted';end if;
 blocked:=false;begin perform create_purchase_correction_request('purchase_order',gen_random_uuid(),'a02-key-0004','Dokumen fiktif tidak ada');exception when others then blocked:=sqlerrm like '%tidak ditemukan%';end;
 if not blocked then raise exception 'Missing source accepted';end if;
 -- A request is not edit permission: direct table writes and processing stay denied.
 blocked:=false;begin update purchase_correction_requests set status='selesai';exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Requester updated a request directly';end if;
 blocked:=false;begin insert into purchase_correction_requests(source_kind,po_id,source_label,detail,requested_by,request_key)values('purchase_order',md5('a02-po')::uuid,'x','direct insert row',auth.uid(),'a02-direct-01');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Requester inserted a request directly';end if;
 blocked:=false;begin perform process_purchase_correction_request((first->>'id')::uuid,'Saya proses sendiri');exception when others then blocked:=sqlerrm like '%Super Admin%';end;
 if not blocked then raise exception 'Staff processed a request';end if;

 -- Staff of another branch cannot request or see branch A documents.
 perform set_config('request.jwt.claim.sub',md5('a02-staff-b')::uuid::text,true);
 blocked:=false;begin perform create_purchase_correction_request('purchase_order',md5('a02-po')::uuid,'a02-key-0005','Cabang lain mencoba meminta');exception when others then blocked:=sqlerrm like '%tidak dapat diakses%';end;
 if not blocked then raise exception 'Other-branch staff requested correction';end if;
 if (select count(*) from purchase_correction_requests)<>0 then raise exception 'Other-branch staff sees requests';end if;

 -- P01: FINANCE default modules exclude Pembelian, but it can open the invoice (Hutang),
 -- so it may file a request and trace its own request; never other people's, never process.
 perform set_config('request.jwt.claim.sub',md5('a02-finance')::uuid::text,true);
 if (select count(*) from purchase_correction_requests)<>0 then raise exception 'Finance sees other people''s requests';end if;
 fin_req:=create_purchase_correction_request('purchase_invoice',md5('a02-invoice')::uuid,'a02-key-0006','Finance: total faktur seharusnya 900');
 if fin_req->>'status'<>'pending' then raise exception 'Finance request not pending';end if;
 if (select count(*) from purchase_correction_requests)<>1 or not exists(select 1 from purchase_correction_requests where id=(fin_req->>'id')::uuid)
  then raise exception 'Finance cannot trace exactly its own request';end if;
 blocked:=false;begin perform process_purchase_correction_request((fin_req->>'id')::uuid,'Finance proses sendiri');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Finance processed a request';end if;

 -- ADMIN may request but only sees own requests and cannot process.
 perform set_config('request.jwt.claim.sub',md5('a02-admin')::uuid::text,true);
 admin_req:=create_purchase_correction_request('purchase_order',md5('a02-po')::uuid,'a02-key-0007','Admin melihat qty diterima salah');
 if (select count(*) from purchase_correction_requests)<>1 then raise exception 'Admin sees others requests';end if;
 blocked:=false;begin perform process_purchase_correction_request((admin_req->>'id')::uuid,'Admin proses');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Admin processed a request';end if;

 -- Owner does not file requests; inactive owner cannot process.
 perform set_config('request.jwt.claim.sub',md5('a02-owner')::uuid::text,true);
 blocked:=false;begin perform create_purchase_correction_request('purchase_order',md5('a02-po')::uuid,'a02-key-0008','Owner tidak perlu meminta');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Owner filed a request';end if;
 if (select count(*) from purchase_correction_requests where status='pending')<>4 then raise exception 'Owner queue incomplete';end if;
 perform set_config('request.jwt.claim.sub',md5('a02-owner-off')::uuid::text,true);
 blocked:=false;begin perform process_purchase_correction_request((first->>'id')::uuid,'Owner nonaktif');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Inactive owner processed a request';end if;

 -- Owner processes: pending -> processed with resolution; idempotent retry; no second decision.
 perform set_config('request.jwt.claim.sub',md5('a02-owner')::uuid::text,true);
 blocked:=false;begin perform process_purchase_correction_request((first->>'id')::uuid,'  ');exception when others then blocked:=true;end;
 if not blocked then raise exception 'Empty resolution accepted';end if;
 processed:=process_purchase_correction_request((first->>'id')::uuid,'Faktur FB.A02 dibatalkan dan diganti');
 if processed->>'status'<>'selesai' or processed is distinct from process_purchase_correction_request((first->>'id')::uuid,'Faktur FB.A02 dibatalkan dan diganti') then raise exception 'Processing not idempotent';end if;
 blocked:=false;begin perform process_purchase_correction_request((first->>'id')::uuid,'Keputusan berbeda');exception when others then blocked:=sqlerrm like '%sudah diproses%';end;
 if not blocked then raise exception 'Processed request was decided twice';end if;
 if not exists(select 1 from purchase_correction_requests where id=(first->>'id')::uuid and processed_by=auth.uid() and processed_at is not null and resolution='Faktur FB.A02 dibatalkan dan diganti') then raise exception 'Processed trace missing';end if;
 if (select count(*) from purchase_correction_requests where status='pending')<>3 then raise exception 'Pending count wrong after processing';end if;

 -- Requester sees the processed status and resolution of own request.
 perform set_config('request.jwt.claim.sub',md5('a02-staff')::uuid::text,true);
 if (select status from purchase_correction_requests where id=(first->>'id')::uuid)<>'selesai' then raise exception 'Requester cannot trace processed status';end if;

 -- Neither creating nor processing changed the source documents or financial records.
 if (select po from a02_before) is distinct from (select to_jsonb(o) from purchase_orders o where id=md5('a02-po')::uuid)
  or (select invoice from a02_before) is distinct from (select to_jsonb(i) from purchase_invoices i where id=md5('a02-invoice')::uuid)
  or (select journals from a02_before)<>(select count(*) from journal_entries)
  or (select payments from a02_before)<>(select count(*) from purchase_invoice_payments) then
  raise exception 'Correction request changed a source/financial record';
 end if;
end$$;

reset role;
do $$begin
 if (select count(*) from activity_log where row_entity='purchase_correction_requests')<4 then raise exception 'Request lifecycle missing from activity log';end if;
 if not exists(select 1 from activity_log where row_entity='purchase_correction_requests' and action='update' and after_state->>'status'='selesai' and actor_id=md5('a02-owner')::uuid) then raise exception 'Processing actor missing from activity log';end if;
 if exists(select 1 from activity_log where row_entity='purchase_correction_requests' and (after_state ? 'detail' or after_state ? 'resolution')) then raise exception 'Free text copied into activity log values';end if;
 if not exists(select 1 from activity_log where row_entity='purchase_correction_requests' and branch_ids @> array[md5('a02-branch')::uuid]) then raise exception 'Request log not scoped to source branch';end if;
end$$;

-- Activity history follows the queue rule: only Super Admin reads other people's requests.
set local role authenticated;
do $$begin
 perform set_config('request.jwt.claim.sub',md5('a02-admin')::uuid::text,true);
 if exists(select 1 from activity_log where row_entity='purchase_correction_requests') then raise exception 'ADMIN reads correction request activity';end if;
 perform set_config('request.jwt.claim.sub',md5('a02-owner')::uuid::text,true);
 if not exists(select 1 from activity_log where row_entity='purchase_correction_requests') then raise exception 'Super Admin cannot read correction request activity';end if;
end$$;

-- A no-branch invoice stays hidden from branch-restricted users (existing invoice RLS),
-- so they cannot file a request on it either; branch-wide roles still can.
reset role;
insert into purchase_orders(id,no_po,branch_id,to_warehouse_id,supplier_id,status,total)values(md5('a02-po-nobranch')::uuid,'PO.A02.NB',null,md5('a02-wh')::uuid,md5('a02-supplier')::uuid,'Diterima',10);
insert into purchase_invoices(id,no_faktur,po_id,supplier_id,total,branch_id)values(md5('a02-invoice-nobranch')::uuid,'FB.A02.NB',md5('a02-po-nobranch')::uuid,md5('a02-supplier')::uuid,10,null);
set local role authenticated;
do $$declare blocked boolean:=false;begin
 perform set_config('request.jwt.claim.sub',md5('a02-staff')::uuid::text,true);
 if exists(select 1 from purchase_invoices where id=md5('a02-invoice-nobranch')::uuid) then raise exception 'Fixture: staff should not see the no-branch invoice';end if;
 begin perform create_purchase_correction_request('purchase_invoice',md5('a02-invoice-nobranch')::uuid,'a02-key-0009','Faktur tanpa cabang yang tidak terlihat');
 exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Staff filed a request on an invoice hidden by RLS';end if;
 perform set_config('request.jwt.claim.sub',md5('a02-admin')::uuid::text,true);
 perform create_purchase_correction_request('purchase_invoice',md5('a02-invoice-nobranch')::uuid,'a02-key-0010','Admin melihat faktur tanpa cabang');
end$$;
rollback;
