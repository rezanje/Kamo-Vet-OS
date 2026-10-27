-- I08/I09 acceptance on fictional fixtures; owned isolated PostgreSQL only.
-- Runs after production_atomic.sql (reuses its fictional owner/staff, branch,
-- warehouse, material/output items and COA rows).
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'ASSERT %',label;end if;end$$;
create function pg_temp.reject(q text,fragment text) returns void language plpgsql as $$begin begin execute q;exception when others then if position(fragment in sqlerrm)=0 then raise exception 'Wrong rejection: %',sqlerrm;end if;return;end;raise exception 'Expected rejection: %',fragment;end$$;

-- I08 (FIFO): 5 units of material -> 5 units of output; job and completion are
-- linked, material cost passes to output without loss or duplication.
begin;
select stock_in_fifo(md5('i08-wh')::uuid,md5('i08-material')::uuid,2,1,'fixture','I08-TRACE-A',current_date-1,null);
select stock_in_fifo(md5('i08-wh')::uuid,md5('i08-material')::uuid,3,3,'fixture','I08-TRACE-B',current_date-1,null);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare a jsonb;b jsonb;src jsonb;oid uuid;ref text;begin
 a:=post_production_adhoc_atomic('start','i08-trace-start',jsonb_build_object('mode','adhoc','nama','Fictional 5 to 5','branch_id',md5('i08-branch')::uuid,'warehouse_id',md5('i08-wh')::uuid,'output_item_id',md5('i08-output')::uuid,'output_qty',5,'output_unit','PCS','tanggal',current_date-1,
  'bahan',jsonb_build_array(jsonb_build_object('item_id',md5('i08-material')::uuid,'warehouse_id',md5('i08-wh')::uuid,'qty',5,'satuan','PCS'))));
 oid:=(a->>'order_id')::uuid;ref:=a->>'no_produksi';
 perform pg_temp.ok((a->>'value')::numeric=11,'FIFO job freezes 2x1 + 3x3 = 11');
 perform pg_temp.ok((select qty=0 from stock where warehouse_id=md5('i08-wh')::uuid and item_id=md5('i08-material')::uuid),'5 material units leave the source warehouse');
 b:=post_production_atomic('finish','i08-trace-finish',jsonb_build_object('id',oid,'qty_jadi',5,'tanggal_selesai',current_date));
 perform pg_temp.ok((b->>'value')::numeric=11 and b->>'no_produksi'=ref,'completion carries the job number and full cost');
 perform pg_temp.ok((select qty=5 from stock where warehouse_id=md5('i08-wh')::uuid and item_id=md5('i08-output')::uuid),'5 output units received');
 perform pg_temp.ok((select sum(qty)=5 and sum(qty*unit_cost)=11 from stock_moves where source='produksi' and source_ref=ref and item_id=md5('i08-output')::uuid and qty>0),'output movement value equals material cost');
 perform pg_temp.ok((select sum(-qty*unit_cost)=11 from stock_moves where source='produksi' and source_ref=ref and qty<0),'material movement value equals job cost');
 perform pg_temp.ok((select sum(l.debit-l.credit)=0 from journal_lines l join coa_accounts c on c.id=l.account_id join journal_entries j on j.id=l.entry_id where c.code='1302' and j.source='produksi' and j.source_ref=ref),'WIP closes to zero');
 perform pg_temp.ok((select sum(l.debit-l.credit)=0 from journal_lines l join coa_accounts c on c.id=l.account_id join journal_entries j on j.id=l.entry_id where c.code='1301' and j.source='produksi' and j.source_ref=ref),'inventory value neither lost nor duplicated');
 src:=read_production_atomic_sources(array[oid])->(oid::text);
 perform pg_temp.ok(src->>'start_journal' is not null and src#>>'{completion,journal}' is not null and src->>'start_journal'<>src#>>'{completion,journal}','job and completion journals are both linked');
 perform pg_temp.ok((src#>>'{completion,qty}')::numeric=5 and (src#>>'{completion,received_qty}')::numeric=5 and (src#>>'{completion,received_value}')::numeric=11,'completion receipt readable from the job');
 perform pg_temp.ok(src->>'branch_name'='Fictional branch','branch cost context shown');
 perform pg_temp.ok((select count(*)=2 from journal_entries where source='produksi' and source_ref=ref),'exactly two stage journals');
end$$;
-- A running job has no completion yet.
reset role;
rollback;

begin;
select stock_in_fifo(md5('i08-wh')::uuid,md5('i08-material')::uuid,1,2,'fixture','I08-TRACE-RUN',current_date-1,null);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$declare a jsonb;src jsonb;begin
 a:=post_production_atomic('start','i08-trace-running',jsonb_build_object('recipe_id',md5('i08-recipe')::uuid,'warehouse_id',md5('i08-wh')::uuid,'batch',1,'tanggal',current_date-1));
 src:=read_production_atomic_sources(array[(a->>'order_id')::uuid])->(a->>'order_id');
 perform pg_temp.ok(src->'completion'='null'::jsonb and src->>'start_journal' is not null,'running job shows start journal and no completion');
end$$;
rollback;

-- I09: a clinic racikan whose material layer came from a completed production
-- job. The parent has no stock; materials are deducted once; trace is read-only.
begin;
insert into auth.users(id) values(md5('i09-doctor')::uuid),(md5('i09-outsider')::uuid);
update profiles set role='DOCTOR',is_active=true where id=md5('i09-doctor')::uuid;
update profiles set role='STAFF',is_active=true where id=md5('i09-outsider')::uuid;
insert into branches(id,code,name,type) values(md5('i09-branch')::uuid,'I09K','Fictional clinic','KLINIK');
insert into user_branches(user_id,branch_id) values(md5('i09-doctor')::uuid,md5('i09-branch')::uuid),(md5('i09-outsider')::uuid,md5('i08-other')::uuid);
insert into warehouses(id,branch_id,code,name,type) values(md5('i09-vet')::uuid,md5('i09-branch')::uuid,'I09V','Fictional vet store','VET');
insert into items(id,code,name,unit,item_type,buy_price,sell_price,is_compound_material) values
 (md5('i09-raw')::uuid,'I09R','Fictional raw powder','gram','Persediaan',1,2,false),
 (md5('i09-base')::uuid,'I09B','Fictional produced base','gram','Persediaan',1,2,true),
 (md5('i09-parent')::uuid,'I09P','Fictional racikan parent','pcs','Non-Persediaan',0,50,false);
insert into customers(id,name,phone) values(md5('i09-customer')::uuid,'Fictional owner','080000009009');
insert into pets(id,customer_id,name) values(md5('i09-pet')::uuid,md5('i09-customer')::uuid,'Fictional pet');
insert into visits(id,branch_id,customer_id,pet_id) values(md5('i09-visit')::uuid,md5('i09-branch')::uuid,md5('i09-customer')::uuid,md5('i09-pet')::uuid);
insert into medical_records(id,visit_id) values(md5('i09-record')::uuid,md5('i09-visit')::uuid);
select stock_in_fifo(md5('i09-vet')::uuid,md5('i09-raw')::uuid,5,4,'fixture','I09-RAW',current_date-1,null);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
create temp table i09_ctx as select post_production_adhoc_atomic('start','i09-job',jsonb_build_object('mode','adhoc','nama','Fictional base','branch_id',md5('i09-branch')::uuid,'warehouse_id',md5('i09-vet')::uuid,'output_item_id',md5('i09-base')::uuid,'output_qty',5,'output_unit','gram','tanggal',current_date-1,
  'bahan',jsonb_build_array(jsonb_build_object('item_id',md5('i09-raw')::uuid,'warehouse_id',md5('i09-vet')::uuid,'qty',5,'satuan','gram')))) job;
select post_production_atomic('finish','i09-job-finish',jsonb_build_object('id',(select job->>'order_id' from i09_ctx),'qty_jadi',5,'tanggal_selesai',current_date-1));
alter table i09_ctx add column recipe uuid;
update i09_ctx set recipe=clinic_issue_compound(md5('i09-record')::uuid,md5('i09-visit')::uuid,
 jsonb_build_object('recipe_name','Fictional racikan','dosage_form','puyer','ingredients',jsonb_build_array(jsonb_build_object('item_id',md5('i09-base')::uuid,'quantity',2,'unit','gram','unit_price',10))),'i09-issue');
reset role;
-- Destination transaction: an invoice line consuming the issue (fixture).
insert into invoices(id,visit_id,invoice_no,subtotal,total,paid_status) values(md5('i09-invoice')::uuid,md5('i09-visit')::uuid,'INV.I09.00001',50,50,'lunas');
insert into invoice_items(id,invoice_id,deskripsi,qty,harga,hpp,compound_recipe_id) values(md5('i09-line')::uuid,md5('i09-invoice')::uuid,'Fictional racikan',1,50,8,(select recipe from i09_ctx));
update compound_issues set posted_invoice_item_id=md5('i09-line')::uuid where recipe_id=(select recipe from i09_ctx);
grant select on i09_ctx to authenticated;
select pg_temp.ok((select qty=3 from stock where warehouse_id=md5('i09-vet')::uuid and item_id=md5('i09-base')::uuid),'material deducted exactly once (5 produced - 2 used)');
select pg_temp.ok(not exists(select 1 from stock where item_id=md5('i09-parent')::uuid) and not exists(select 1 from stock_moves where item_id=md5('i09-parent')::uuid),'non-stock parent never gets stock');
create temp table i09_before as select (select count(*) from stock_moves) moves,(select count(*) from stock_layers) layers,(select coalesce(sum(qty),0) from stock) qty;
grant select on i09_before to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
do $$declare t jsonb;m jsonb;begin
 t:=read_compound_trace((select recipe from i09_ctx));
 perform pg_temp.ok(t->>'visit_id'=md5('i09-visit')::uuid::text and t->>'recipe_name'='Fictional racikan','source document and compound result returned');
 -- The produced output is received as two FIFO layers (exact residual unit),
 -- so the clinic take may span both; every take must point to the same job.
 perform pg_temp.ok(jsonb_array_length(t->'materials') between 1 and 2
  and (select sum((x->>'qty')::numeric) from jsonb_array_elements(t->'materials')x)=2,'FIFO takes total the 2 units used');
 for m in select value from jsonb_array_elements(t->'materials') loop
  perform pg_temp.ok(m->>'item_name'='Fictional produced base' and m->>'warehouse_name'='Fictional vet store' and not (m->>'restored')::boolean,'consumed material detail');
  perform pg_temp.ok(m#>>'{origin,source}'='produksi' and m#>>'{origin,no_produksi}'=(select job->>'no_produksi' from i09_ctx) and m#>>'{origin,production_order_id}'=(select job->>'order_id' from i09_ctx),'owner sees the production job behind the consumed layer');
  perform pg_temp.ok(m#>>'{invoice,invoice_no}'='INV.I09.00001' and m#>>'{invoice,visit_id}'=md5('i09-visit')::uuid::text,'destination invoice returned');
 end loop;
 perform pg_temp.ok(jsonb_array_length(t->'moves')=1 and (t->'moves'->0->>'qty')::numeric=-2,'material stock move for the racikan');
 perform pg_temp.ok(position('cost' in t::text)=0 and position('hpp' in t::text)=0,'no private cost exposed');
end$$;
select pg_temp.ok((select moves from i09_before)=(select count(*) from stock_moves) and (select layers from i09_before)=(select count(*) from stock_layers) and (select qty from i09_before)=(select coalesce(sum(qty),0) from stock),'trace writes nothing');
-- A clinic doctor sees the trace, but not the back-office production number.
select set_config('request.jwt.claim.sub',md5('i09-doctor')::uuid::text,true);
select pg_temp.ok((select read_compound_trace((select recipe from i09_ctx))#>'{materials,0,origin}'->>'source')='produksi','doctor sees production origin');
select pg_temp.ok((select read_compound_trace((select recipe from i09_ctx))#>'{materials,0,origin}'->'no_produksi')='null'::jsonb,'doctor does not get production number');
-- Another branch's staff and anonymous callers are denied.
select set_config('request.jwt.claim.sub',md5('i09-outsider')::uuid::text,true);
select pg_temp.reject('select read_compound_trace((select recipe from i09_ctx))','Akses jejak racikan ditolak');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.reject('select read_compound_trace((select recipe from i09_ctx))','Akses jejak racikan ditolak');
reset role;
-- After a void the restore is visible and stock is back; still no parent stock.
update compound_issues set posted_invoice_item_id=null where recipe_id=(select recipe from i09_ctx);
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('i08-owner')::uuid::text,true);
select clinic_void_compound((select recipe from i09_ctx));
do $$declare t jsonb;begin
 t:=read_compound_trace((select recipe from i09_ctx));
 perform pg_temp.ok((select bool_and((x->>'restored')::boolean) from jsonb_array_elements(t->'materials')x),'restored flag after void');
 perform pg_temp.ok(jsonb_array_length(t->'moves')>=2 and (select sum((x->>'qty')::numeric) from jsonb_array_elements(t->'moves')x)=0,'issue and restore net to zero');
end$$;
reset role;
select pg_temp.ok((select qty=5 from stock where warehouse_id=md5('i09-vet')::uuid and item_id=md5('i09-base')::uuid),'void restores the produced material once');
rollback;
