-- Fictional fixtures only; never execute on a production database.
-- 20261107030000: order online boleh dari gudang cabang mana pun (RETAIL/VET/DC/ONLINE),
-- kecuali EXPIRED dan TRANSIT; akses cabang tetap diperiksa.
begin;
insert into auth.users(id,raw_user_meta_data) values
('e1000000-0000-4000-8000-000000000001','{"full_name":"Owner online"}'),
('e1000000-0000-4000-8000-000000000002','{"full_name":"Staf online cabang A"}');
update profiles set role='OWNER' where id='e1000000-0000-4000-8000-000000000001';
update profiles set role='STAFF' where id='e1000000-0000-4000-8000-000000000002';
insert into role_modules(role,module_id) values('STAFF','penjualan') on conflict do nothing;
insert into branches(id,code,name,type) values
('e2000000-0000-4000-8000-000000000001','ONLA','Petshop A','PETSHOP'),
('e2000000-0000-4000-8000-000000000002','ONLB','Petshop B','PETSHOP');
insert into user_branches(user_id,branch_id) values
('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001'),
('e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001');
insert into warehouses(id,branch_id,code,name,type,is_active) values
('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','ONLA-RT','Toko A','RETAIL',true),
('e3000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','ONLA-EXP','Expired A','EXPIRED',true),
('e3000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001','ONLA-TR','Transit A','TRANSIT',true),
('e3000000-0000-4000-8000-000000000004','e2000000-0000-4000-8000-000000000001','ONLA-ON','Online A','ONLINE',true),
('e3000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000001','ONLA-OFF','Toko A lama','RETAIL',false),
('e3000000-0000-4000-8000-000000000006','e2000000-0000-4000-8000-000000000002','ONLB-RT','Toko B','RETAIL',true);
insert into items(id,code,name,unit,buy_price,sell_price,item_type) values
('e5000000-0000-4000-8000-000000000001','ONLGOOD','Barang online fiktif','pcs',2,10,'Persediaan');
insert into stock(warehouse_id,item_id,qty)
select w.id,'e5000000-0000-4000-8000-000000000001',20 from warehouses w where w.code like 'ONL%';
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
select w.id,'e5000000-0000-4000-8000-000000000001',current_date,20,20,3,'purchase' from warehouses w where w.code like 'ONL%';
insert into coa_accounts(code,name,type,normal_balance,is_header) values
('510001','Sales','PENDAPATAN','K',false),('600001','COGS','BEBAN','D',false),('312005','VAT','LIABILITAS','K',false)
on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set is_active=true,is_header=false where code in ('110003','120002','130009');
update accounting_locks set closed_until=null;

create temporary table hasil(kasus text primary key, ok boolean, detail text) on commit drop;
grant all on hasil to authenticated;

create function pg_temp.coba(p_kasus text,p_key text,p_wh uuid,p_harus_gagal text) returns void language plpgsql as $$
declare r jsonb; pesan text;
begin
 begin
  r:=public.post_online_order(p_key,jsonb_build_object('tanggal',current_date,'channel','Shopee','warehouse_id',p_wh),
    '[{"item_id":"e5000000-0000-4000-8000-000000000001","qty":2,"satuan":"pcs","harga":10}]'::jsonb);
  insert into hasil values(p_kasus,p_harus_gagal is null,coalesce(r::text,'null'));
 exception when others then
  pesan:=sqlerrm;
  insert into hasil values(p_kasus,p_harus_gagal is not null and position(p_harus_gagal in pesan)>0,pesan);
 end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.coba('owner: gudang toko (RETAIL) diterima','k-retail','e3000000-0000-4000-8000-000000000001',null);
select pg_temp.coba('owner: gudang ONLINE tetap diterima','k-online','e3000000-0000-4000-8000-000000000004',null);
select pg_temp.coba('owner: gudang EXPIRED ditolak','k-exp','e3000000-0000-4000-8000-000000000002','tidak bisa dipakai untuk order online');
select pg_temp.coba('owner: gudang TRANSIT ditolak','k-tr','e3000000-0000-4000-8000-000000000003','tidak bisa dipakai untuk order online');
select pg_temp.coba('owner: gudang nonaktif ditolak','k-off','e3000000-0000-4000-8000-000000000005','tidak bisa dipakai untuk order online');

select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.coba('staf: gudang toko cabangnya sendiri diterima','k-staf-a','e3000000-0000-4000-8000-000000000001',null);
select pg_temp.coba('staf: gudang toko cabang lain ditolak','k-staf-b','e3000000-0000-4000-8000-000000000006','Akses transaksi ditolak');
reset role;

-- Efek: order RETAIL tercatat di cabang gudangnya, stok gudang toko berkurang 2+2, gudang lain utuh,
-- tetap piutang marketplace (Dr 130009).
insert into hasil select 'order RETAIL tercatat di cabang gudang + piutang marketplace',
  count(*)=2 and bool_and(s.branch_id='e2000000-0000-4000-8000-000000000001' and s.marketplace_status='piutang'), count(*)::text
  from sales s join unit_posting_requests u on u.result->>'document_id'=s.id::text
  where u.request_key in ('k-retail','k-staf-a');
insert into hasil select 'stok gudang toko A berkurang 4, gudang lain tidak tersentuh',
  (select qty from stock where warehouse_id='e3000000-0000-4000-8000-000000000001')=16
  and (select qty from stock where warehouse_id='e3000000-0000-4000-8000-000000000002')=20
  and (select qty from stock where warehouse_id='e3000000-0000-4000-8000-000000000003')=20
  and (select qty from stock where warehouse_id='e3000000-0000-4000-8000-000000000006')=20,
  (select string_agg(w.code||'='||s.qty,',' order by w.code) from stock s join warehouses w on w.id=s.warehouse_id where w.code like 'ONL%');
insert into hasil select 'jurnal piutang marketplace untuk order RETAIL',
  exists(select 1 from journal_entries je join journal_lines jl on jl.entry_id=je.id join coa_accounts a on a.id=jl.account_id
    where je.source='sale-online' and je.source_ref=(select result->>'document_no' from unit_posting_requests where request_key='k-retail') and a.code='130009' and jl.debit=20), '';

select kasus||' => '||case when ok then 'PASS' else 'FAIL' end||' :: '||detail from hasil order by kasus;
do $$ begin if exists(select 1 from hasil where not ok) then raise exception 'online_semua_gudang: ada kasus gagal'; end if; end $$;
rollback;
