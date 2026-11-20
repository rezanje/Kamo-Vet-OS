-- Transfer Kas dua cabang (20261119092446_transfer_kas_dua_cabang). Data fiktif saja.
-- Dijalankan setelah internal_transfer_corrections.sql (memakai fungsi bantu dan pengguna fiktifnya).
reset role;
insert into branches(id,name,code,type) values
 ('f7200000-0000-4000-8000-0000000000a1','Cabang asal fiktif','TFA','OFFICE'),
 ('f7200000-0000-4000-8000-0000000000b2','Cabang tujuan fiktif','TFB','OFFICE');
insert into coa_accounts(code,name,type,normal_balance) values('1181','Dua cabang sumber','ASET','D'),('1182','Dua cabang tujuan','ASET','D'),('1183','Dua cabang alternatif','ASET','D')
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values
 ('f7300000-0000-4000-8000-0000000000a1','Dua cabang sumber','Bank','1181'),
 ('f7300000-0000-4000-8000-0000000000b2','Dua cabang tujuan','Kas','1182'),
 ('f7300000-0000-4000-8000-0000000000c3','Dua cabang alternatif','Bank','1183');
create function public.saldo_cabang(p_code text, p_branch uuid) returns numeric language sql security definer set search_path='public' as $$
 select coalesce(sum(l.debit-l.credit),0) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id
 where a.code=p_code and e.branch_id is not distinct from p_branch$$;
create function public.saldo_akun(p_code text) returns numeric language sql security definer set search_path='public' as $$
 select coalesce(sum(l.debit-l.credit),0) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code=p_code$$;
create table dua_input as select jsonb_build_object('tanggal',current_date,'from_account_id','f7300000-0000-4000-8000-0000000000a1',
 'to_account_id','f7300000-0000-4000-8000-0000000000b2','jumlah',1000,'biaya_admin',2.50,
 'branch_id','f7200000-0000-4000-8000-0000000000a1','to_branch_id','f7200000-0000-4000-8000-0000000000b2','keterangan','Antar cabang fiktif') header;
grant select on dua_input to authenticated;
select transfer_assert((select type='ASET' and normal_balance='D' and is_active and not is_header from coa_accounts where code='182010'),'akun 182010 Rekening Antar Cabang tersedia');
-- Baris lama tanpa kolom cabang tujuan (mis. LEGACY.TRANSFER di suite regresi) tetap dibaca tujuan = asal.
set role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claim.role','authenticated',false);

-- 1. Buat transfer antar cabang: dua jurnal, masing-masing seimbang di cabangnya.
insert into transfer_results values('dua',mutate_cash_transfer('dua-create','create',null,null,(select header from dua_input),null));
select transfer_assert(mutate_cash_transfer('dua-create','create',null,null,(select header from dua_input),null)=(select value from transfer_results where name='dua'),'ulang kirim = hasil sama');
select transfer_assert((select branch_id='f7200000-0000-4000-8000-0000000000a1' and to_branch_id='f7200000-0000-4000-8000-0000000000b2' and to_journal_entry_id is not null
 from cash_transfers where id=(select(value->>'transfer_id')::uuid from transfer_results where name='dua')),'cabang asal & tujuan tersimpan');
select transfer_assert((select (value->>'to_journal_entry_id') is not null from transfer_results where name='dua'),'hasil memuat jurnal tujuan');
select transfer_assert((select source='transfer-tujuan' and branch_id='f7200000-0000-4000-8000-0000000000b2' from journal_entries where id=(select(value->>'to_journal_entry_id')::uuid from transfer_results where name='dua')),'jurnal tujuan di cabang tujuan');
select transfer_assert(saldo_cabang('1181','f7200000-0000-4000-8000-0000000000a1')=-1002.50,'rekening sumber berkurang di cabang asal (jumlah+biaya)');
select transfer_assert(saldo_cabang('1182','f7200000-0000-4000-8000-0000000000b2')=1000,'rekening tujuan bertambah di cabang tujuan');
select transfer_assert(saldo_cabang('1182','f7200000-0000-4000-8000-0000000000a1')=0,'rekening tujuan tidak tercatat di cabang asal');
select transfer_assert(saldo_cabang('182010','f7200000-0000-4000-8000-0000000000a1')=1000 and saldo_cabang('182010','f7200000-0000-4000-8000-0000000000b2')=-1000 and saldo_akun('182010')=0,'antar cabang: konsolidasi nol');
select transfer_assert(saldo_cabang('740010','f7200000-0000-4000-8000-0000000000a1')>=2.50,'biaya admin di cabang asal');
select transfer_assert(not exists(select entry_id from journal_lines group by entry_id having sum(debit)<>sum(credit)),'setiap jurnal seimbang');

-- 2. Koreksi: ganti cabang tujuan jadi sama dengan asal + rekening tujuan lain. Dua jurnal lama dibalik, pengganti satu jurnal.
insert into transfer_results values('dua-satu',mutate_cash_transfer('dua-to-satu','edit',(select(value->>'transfer_id')::uuid from transfer_results where name='dua'),0,
 jsonb_set(jsonb_set((select header from dua_input),'{to_branch_id}','"f7200000-0000-4000-8000-0000000000a1"'),'{to_account_id}','"f7300000-0000-4000-8000-0000000000c3"'),'Salah cabang tujuan'));
select transfer_assert((select (value->>'reversal_to_journal_id') is not null and (value->>'replacement_to_journal_id') is null from transfer_results where name='dua-satu'),'dua pembalik, pengganti satu jurnal');
select transfer_assert((select branch_id='f7200000-0000-4000-8000-0000000000b2' and source='transfer-reversal' and tanggal=current_date from journal_entries where id=(select(value->>'reversal_to_journal_id')::uuid from transfer_results where name='dua-satu')),'pembalik tujuan di cabang tujuan lama');
select transfer_assert(saldo_cabang('1182','f7200000-0000-4000-8000-0000000000b2')=0,'tujuan lama kembali nol');
select transfer_assert(saldo_cabang('1183','f7200000-0000-4000-8000-0000000000a1')=1000,'tujuan baru di cabang asal');
select transfer_assert(saldo_akun('182010')=0 and saldo_cabang('182010','f7200000-0000-4000-8000-0000000000a1')=0 and saldo_cabang('182010','f7200000-0000-4000-8000-0000000000b2')=0,'antar cabang bersih per cabang');
select transfer_assert((select to_branch_id='f7200000-0000-4000-8000-0000000000a1' and to_journal_entry_id is null from cash_transfers where id=(select(value->>'replacement_transfer_id')::uuid from transfer_results where name='dua-satu')),'pengganti satu cabang');

-- 3. Koreksi balik: satu cabang -> dua cabang, sekalian ganti cabang asal dan tanggal.
insert into transfer_results values('satu-dua',mutate_cash_transfer('satu-to-dua','edit',(select(value->>'replacement_transfer_id')::uuid from transfer_results where name='dua-satu'),0,
 jsonb_set(jsonb_set(jsonb_set((select header from dua_input),'{branch_id}','"f7200000-0000-4000-8000-000000000001"'),'{tanggal}',to_jsonb(current_date-1)),'{to_branch_id}','"f7200000-0000-4000-8000-0000000000b2"'),'Ganti cabang asal'));
select transfer_assert((select branch_id='f7200000-0000-4000-8000-000000000001' and to_branch_id='f7200000-0000-4000-8000-0000000000b2' and tanggal=current_date-1 and to_journal_entry_id is not null
 from cash_transfers where id=(select(value->>'replacement_transfer_id')::uuid from transfer_results where name='satu-dua')),'pengganti dua cabang, cabang asal & tanggal baru');
select transfer_assert(saldo_cabang('1181','f7200000-0000-4000-8000-0000000000a1')=0,'sumber di cabang asal lama kembali nol');
select transfer_assert(saldo_cabang('1182','f7200000-0000-4000-8000-0000000000b2')=1000 and saldo_cabang('1183','f7200000-0000-4000-8000-0000000000a1')=0,'tujuan di cabang tujuan baru');

-- 4. Klien lama (tanpa to_branch_id) yang mengoreksi hanya cabang asal tetap menjaga cabang tujuan yang sudah berbeda.
insert into transfer_results values('klien-lama',mutate_cash_transfer('klien-lama-edit','edit',(select(value->>'replacement_transfer_id')::uuid from transfer_results where name='satu-dua'),0,
 (select header-'to_branch_id' from dua_input),'Klien lama'));
select transfer_assert((select branch_id='f7200000-0000-4000-8000-0000000000a1' and to_branch_id='f7200000-0000-4000-8000-0000000000b2' and to_journal_entry_id is not null
 from cash_transfers where id=(select(value->>'replacement_transfer_id')::uuid from transfer_results where name='klien-lama')),'klien lama: cabang tujuan dipertahankan');

-- 5. Batalkan transfer dua cabang: semua akun kembali nol di setiap cabang.
insert into transfer_results values('dua-batal',mutate_cash_transfer('dua-void','void',(select(value->>'replacement_transfer_id')::uuid from transfer_results where name='klien-lama'),0,'{}','Batal fiktif'));
select transfer_assert((select (value->>'reversal_to_journal_id') is not null from transfer_results where name='dua-batal'),'batal membalik jurnal tujuan');
select transfer_assert(not exists(select 1 from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id
 where a.code in('1181','1182','1183','182010') group by a.code,e.branch_id having sum(l.debit-l.credit)<>0),'semua akun nol per cabang setelah batal');
select transfer_assert(not exists(select entry_id from journal_lines group by entry_id having sum(debit)<>sum(credit)),'setiap jurnal tetap seimbang');

-- 6. Tanpa to_branch_id (klien lama) dan dengan cabang sama: tetap satu jurnal.
insert into transfer_results values('lama',mutate_cash_transfer('lama-create','create',null,null,(select header-'to_branch_id' from dua_input),null));
select transfer_assert((select to_branch_id=branch_id and to_journal_entry_id is null from cash_transfers where id=(select(value->>'transfer_id')::uuid from transfer_results where name='lama')),'klien lama: satu jurnal, tujuan = asal');
insert into transfer_results values('pusat-ke-cabang',mutate_cash_transfer('pusat-create','create',null,null,jsonb_set((select header from dua_input),'{branch_id}','""'),null));
select transfer_assert((select branch_id is null and to_branch_id='f7200000-0000-4000-8000-0000000000b2' and to_journal_entry_id is not null from cash_transfers where id=(select(value->>'transfer_id')::uuid from transfer_results where name='pusat-ke-cabang')),'Pusat -> cabang: dua jurnal');
select transfer_assert(saldo_cabang('1181',null)=-1002.50,'sumber berkurang di Pusat');

-- 7. Pengaman: cabang operasional terpilih menolak transfer ke cabang lain; perubahan langsung tetap ditolak.
select set_config('request.headers','{"x-kamo-operational-branch":"f7200000-0000-4000-8000-0000000000a1"}',false);
select transfer_reject($q$select mutate_cash_transfer('dua-header','create',null,null,(select header from dua_input),null)$q$,'tidak dapat diakses');
select set_config('request.headers','{}',false);
select transfer_reject($q$update journal_entries set branch_id=null where source='transfer-tujuan'$q$,'jalur resmi');
select transfer_reject($q$delete from journal_lines where entry_id in(select id from journal_entries where source='transfer-tujuan')$q$,'jalur resmi');
reset role;
update coa_accounts set is_active=false where code='182010';
set role authenticated;
select transfer_reject($q$select mutate_cash_transfer('dua-rac-off','create',null,null,(select header from dua_input),null)$q$,'182010');
select transfer_reject($q$select mutate_cash_transfer('dua-rac-off-void','void',(select(value->>'transfer_id')::uuid from transfer_results where name='pusat-ke-cabang'),0,'{}','Akun nonaktif')$q$,'182010');
reset role;
update coa_accounts set is_active=true where code='182010';
select 'DUA CABANG PASS';
