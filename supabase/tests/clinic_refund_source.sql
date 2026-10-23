-- Appended to fictional clinical invoice setup; everything rolls back.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
create temp table j03_clinic_invoice as
 select public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','j03-clinic-source',
 jsonb_build_object('tanggal',(now()at time zone'Asia/Jakarta')::date,'subtotal',300,'discount',10,'tax',20,'total',310,'dp_amount',0,'paid_status','Belum Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001'),
 '[{"description":"Obat Unit","qty":2,"price":100,"kind":"obat","item_id":"d8000000-0000-4000-8000-000000000001","unit":"strip","prescription_item_id":"d9000000-0000-4000-8000-000000000001","discount_percent":0},{"description":"Konsultasi fiktif","qty":1,"price":100,"kind":"jasa","discount_percent":0}]')id;
do $$declare preview jsonb;before_state jsonb;begin
 preview:=preview_clinic_refund_source((select id from j03_clinic_invoice));
 if preview->>'eligible'<>'false' or preview->>'reason' not ilike '%lunas%' then raise exception 'Unpaid clinic invoice was offered for payout';end if;
 perform clinic_receive_invoice_payment((select id from j03_clinic_invoice),(now()at time zone'Asia/Jakarta')::date,310,'Tunai','1101','Fictional full receipt','j03-clinic-payment');
 before_state:=public.test_clinic_invoice_state();preview:=preview_clinic_refund_source((select id from j03_clinic_invoice));
 if preview->>'eligible'<>'true' or (preview->>'paid_total')::numeric<>310 or (preview->>'total')::numeric<>310 or jsonb_array_length(preview->'lines')<>2 then raise exception 'Paid source/line/payment proof not loaded: %',preview;end if;
 if preview->>'invoice_id'<>(select id::text from j03_clinic_invoice) or length(preview->>'source_hash')<>32 then raise exception 'Missing exact immutable source identity';end if;
 if not exists(select 1 from jsonb_array_elements(preview->'lines')x where x->>'item_id'='d8000000-0000-4000-8000-000000000001'and x->>'unit'='strip'and(x->>'factor')::numeric=10 and(x->>'qty')::numeric=2)then raise exception 'Lost original selected unit/quantity';end if;
 if preview::text ilike '%hpp%'or preview::text ilike '%unit_cost%'or preview::text ilike '%medical_records%'then raise exception 'Private cost/medical data exposed in public preview';end if;
 if before_state<>public.test_clinic_invoice_state()then raise exception 'Preview changed stock/invoice/journals';end if;
end$$;
reset role;
insert into auth.users(id,raw_user_meta_data)values('d1000000-0000-4000-8000-000000000003','{"full_name":"Unassigned fictional actor"}');
update profiles set role='STAFF'where id='d1000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000003',true);
do $$begin
 begin perform preview_clinic_refund_source((select id from j03_clinic_invoice));raise exception 'Expected branch denial';exception when insufficient_privilege then null;end;
end$$;
reset role;
savepoint missing_original_stock;
delete from stock_moves where source='klinik'and source_ref=(select invoice_no from invoices where id=(select id from j03_clinic_invoice));
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
do $$declare preview jsonb;begin
 preview:=preview_clinic_refund_source((select id from j03_clinic_invoice));
 if preview->>'eligible'<>'false'or preview->>'reason'not ilike '%stok%'then raise exception 'Missing stock provenance must not be guessed';end if;
end$$;
rollback to savepoint missing_original_stock;

savepoint missing_original_hpp_journal;
reset role;
delete from journal_lines where entry_id in(select id from journal_entries where source='klinik-hpp'and source_ref=(select invoice_no from invoices where id=(select id from j03_clinic_invoice)));
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
do $$declare preview jsonb;begin
 preview:=preview_clinic_refund_source((select id from j03_clinic_invoice));
 if preview->>'eligible'<>'false'or preview->>'reason'not ilike '%HPP%'then raise exception 'Missing original HPP journal offered as verified source';end if;
end$$;
rollback to savepoint missing_original_hpp_journal;
rollback;
