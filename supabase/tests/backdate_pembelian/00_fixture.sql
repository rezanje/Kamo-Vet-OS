-- Fixture fiktif untuk suite batal_pembelian (dijalankan SEKALI, ditulis ke template; tiap seksi berjalan di transaksi yang di-rollback).
insert into auth.users(id) values
 ('bd000000-0000-4000-8000-000000000001'),('bd000000-0000-4000-8000-000000000002'),('bd000000-0000-4000-8000-000000000003'),('bd000000-0000-4000-8000-000000000004');
update profiles set role='OWNER',is_active=true where id='bd000000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id='bd000000-0000-4000-8000-000000000002';
update profiles set role='FINANCE',is_active=true where id='bd000000-0000-4000-8000-000000000003';
update profiles set role='STAFF',is_active=true where id='bd000000-0000-4000-8000-000000000004';
insert into branches(id,code,name,type) values('bd100000-0000-4000-8000-000000000001','BP-B1','BP cabang satu','KLINIK'),('bd100000-0000-4000-8000-000000000002','BP-B2','BP cabang dua','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values
 ('bd200000-0000-4000-8000-000000000001','bd100000-0000-4000-8000-000000000001','BP-W1','BP gudang satu','VET'),
 ('bd200000-0000-4000-8000-000000000002','bd100000-0000-4000-8000-000000000002','BP-W2','BP gudang dua','VET');
insert into suppliers(id,nama) values('bd300000-0000-4000-8000-000000000001','BP pemasok satu'),('bd300000-0000-4000-8000-000000000002','BP pemasok dua');
insert into items(id,code,name,unit,item_type) values
 ('bd400000-0000-4000-8000-00000000000a','BP-A','BP barang A','pcs','Persediaan'),
 ('bd400000-0000-4000-8000-00000000000b','BP-B','BP barang B','pcs','Persediaan'),
 ('bd400000-0000-4000-8000-00000000000c','BP-C','BP barang C','pcs','Persediaan'),
 ('bd400000-0000-4000-8000-00000000000d','BP-D','BP barang D','pcs','Persediaan'),
 ('bd400000-0000-4000-8000-00000000000e','BP-S','BP jasa','pcs','Jasa');
insert into item_units(item_id,unit,factor) values('bd400000-0000-4000-8000-00000000000a','box',10);
insert into coa_accounts(code,name,type,normal_balance) values('170001','Fiction inventory','ASET','D'),('311001','Fiction payable','LIABILITAS','K'),('110209','Fiction bank','ASET','D')
 on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set is_active=true,is_header=false where code in('170001','160001','311003','110003','120002');
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;
insert into cash_accounts(id,nama,jenis,coa_code,branch_id) values('bd700000-0000-4000-8000-000000000001','BP bank','Bank','110209','bd100000-0000-4000-8000-000000000001');
