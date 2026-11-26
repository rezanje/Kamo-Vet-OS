-- Pengeluaran bertanggal mundur (migrasi *_backdate_pengeluaran): fictional fixtures in disposable PostgreSQL only; everything rolls back.
-- Keputusan Owner (Andri 23 Nov): SEMUA akun yang boleh input pengeluaran boleh mundur. Aturan yang dibuktikan: alasan wajib 3-200, 31 hari, masa depan ditolak,
-- periode tertutup ditolak, rekonsiliasi bank ditolak, jejak tak bisa diubah, INSERT/UPDATE langsung bertanggal bebas ditolak, Admin Online ditolak, hari ini tidak berubah,
-- laci shift sekarang berkurang (jurnal di tanggal mundur), idempotensi, ACL/search_path.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;raise notice 'BP_PASS %',label;end$$;
create function pg_temp.reject(stmt text, expected text, label text) returns void language plpgsql as $$
declare failed boolean:=false;msg text;begin
 begin execute stmt;exception when others then failed:=true;msg:=sqlerrm;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
 if position(expected in msg)=0 then raise exception 'Unexpected rejection for %: %',label,msg;end if;
 raise notice 'BP_PASS %',label;
end$$;
create function pg_temp.sv(stmt text) returns text language plpgsql security definer as $$declare r text;begin execute stmt into r;return r;end$$;
create function pg_temp.as_(uid text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',uid,true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);end$$;
create function pg_temp.today() returns date language sql as $$select (now() at time zone 'Asia/Jakarta')::date$$;
-- jalankan lalu batalkan (sub-transaksi): 'OK' bila berhasil, selain itu pesan galat
create function pg_temp.try(stmt text) returns text language plpgsql as $$
begin
 begin execute stmt;raise exception 'TRY_OK';
 exception when others then return case when sqlerrm='TRY_OK' then 'OK' else sqlerrm end;end;
end$$;

-- ── fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into auth.users(id,raw_user_meta_data) values
 ('ed100000-0000-4000-8000-000000000001','{"full_name":"BDP owner"}'),('ed100000-0000-4000-8000-000000000002','{"full_name":"BDP admin"}'),
 ('ed100000-0000-4000-8000-000000000003','{"full_name":"BDP finance"}'),('ed100000-0000-4000-8000-000000000004','{"full_name":"BDP kasir petshop"}'),
 ('ed100000-0000-4000-8000-000000000005','{"full_name":"BDP kasir klinik"}'),('ed100000-0000-4000-8000-000000000006','{"full_name":"BDP admin online"}'),
 ('ed100000-0000-4000-8000-000000000007','{"full_name":"BDP kasir dua"}'),('ed100000-0000-4000-8000-000000000008','{"full_name":"BDP kasir cabang lain"}'),
 ('ed100000-0000-4000-8000-000000000009','{"full_name":"BDP finance nonaktif"}');
update profiles set role='OWNER',is_active=true where id='ed100000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id='ed100000-0000-4000-8000-000000000002';
update profiles set role='FINANCE',is_active=true where id='ed100000-0000-4000-8000-000000000003';
update profiles set role='STAFF',is_active=true where id in('ed100000-0000-4000-8000-000000000004','ed100000-0000-4000-8000-000000000007','ed100000-0000-4000-8000-000000000008');
update profiles set role='DOCTOR',is_active=true where id='ed100000-0000-4000-8000-000000000005';
update profiles set role='ADMIN_ONLINE',is_active=true where id='ed100000-0000-4000-8000-000000000006';
update profiles set role='FINANCE',is_active=false where id='ed100000-0000-4000-8000-000000000009';
insert into role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,false),('FINANCE',false,false) on conflict(role) do update set all_branches=false;
insert into role_modules(role,module_id) values('STAFF','pos'),('ADMIN','pos'),('FINANCE','pos'),('DOCTOR','klinik') on conflict do nothing;
insert into branches(id,code,name,type) values('ed200000-0000-4000-8000-000000000001','BDPA','BDP petshop A','PETSHOP'),('ed200000-0000-4000-8000-000000000002','BDPK','BDP klinik K','KLINIK'),
 ('ed200000-0000-4000-8000-000000000003','BDPX','BDP cabang lain','PETSHOP');
insert into user_branches(user_id,branch_id) values
 ('ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001'),('ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000002'),
 ('ed100000-0000-4000-8000-000000000002','ed200000-0000-4000-8000-000000000001'),('ed100000-0000-4000-8000-000000000002','ed200000-0000-4000-8000-000000000002'),
 ('ed100000-0000-4000-8000-000000000003','ed200000-0000-4000-8000-000000000001'),('ed100000-0000-4000-8000-000000000003','ed200000-0000-4000-8000-000000000002'),
 ('ed100000-0000-4000-8000-000000000004','ed200000-0000-4000-8000-000000000001'),('ed100000-0000-4000-8000-000000000005','ed200000-0000-4000-8000-000000000002'),
 ('ed100000-0000-4000-8000-000000000006','ed200000-0000-4000-8000-000000000001'),('ed100000-0000-4000-8000-000000000007','ed200000-0000-4000-8000-000000000001'),
 ('ed100000-0000-4000-8000-000000000008','ed200000-0000-4000-8000-000000000003'),('ed100000-0000-4000-8000-000000000009','ed200000-0000-4000-8000-000000000001');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values
 ('1191','BDP kas petshop','ASET','D',false,true),('1192','BDP bank','ASET','D',false,true),('1193','BDP kas klinik','ASET','D',false,true),('1194','BDP bank dua','ASET','D',false,true)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code,is_active) values
 ('ed500000-0000-4000-8000-000000000001','BDP kas petshop','Kas','1191',true),('ed500000-0000-4000-8000-000000000002','BDP bank','Bank','1192',true),
 ('ed500000-0000-4000-8000-000000000003','BDP kas klinik','Kas','1193',true),('ed500000-0000-4000-8000-000000000004','BDP bank dua','Bank','1194',true);
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','ed200000-0000-4000-8000-000000000001','ed500000-0000-4000-8000-000000000001'),('Transfer','ed200000-0000-4000-8000-000000000001','ed500000-0000-4000-8000-000000000002'),
 ('Tunai','ed200000-0000-4000-8000-000000000002','ed500000-0000-4000-8000-000000000003'),('Transfer','ed200000-0000-4000-8000-000000000002','ed500000-0000-4000-8000-000000000002') on conflict do nothing;
update accounting_locks set closed_until=null;
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at) values
 ('ed600000-0000-4000-8000-00000000000a','ed200000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000004','petshop',50000,now()-interval '3 hours'),
 ('ed600000-0000-4000-8000-00000000000b','ed200000-0000-4000-8000-000000000002','ed100000-0000-4000-8000-000000000005','klinik',100000,now()-interval '3 hours'),
 ('ed600000-0000-4000-8000-00000000000c','ed200000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001','petshop',0,now()-interval '3 hours');

create temp table res(name text primary key,r jsonb);grant all on res to public;
create function pg_temp.exp(key text,ctx text,br uuid,d date,reason text default null,amount numeric default 25000,kat text default 'Operasional',metode text default 'Tunai',acct uuid default null)
 returns jsonb language sql as $$
 select public.post_expense_atomic(key,ctx,br,jsonb_strip_nulls(jsonb_build_object('tanggal',d::text,'kategori',kat,'jumlah',amount,'metode_bayar',metode,'deskripsi','BDP uji '||key,
  'alasan_tanggal',reason,'account_id',acct)),'[{"path":"pengeluaran/bdp.jpg","nama":"bdp.jpg","mime":"image/jpeg","ukuran":100}]'::jsonb)$$;
create function pg_temp.save(name text,v jsonb) returns void language sql as $$insert into res values($1,$2)$$;
create function pg_temp.eid(name text) returns uuid language sql security definer as $$select (r->>'expense_id')::uuid from res where res.name=$1$$;
create function pg_temp.jid(name text) returns uuid language sql security definer as $$select (r->>'journal_id')::uuid from res where res.name=$1$$;
create function pg_temp.jdate(name text) returns date language sql security definer as $$select e.tanggal from public.journal_entries e where e.id=(select (r->>'journal_id')::uuid from res where res.name=$1)$$;
create function pg_temp.jnet(name text) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l where l.entry_id=(select (r->>'journal_id')::uuid from res where res.name=$1)$$;
create function pg_temp.jline(name text,code text) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where a.code=$2 and l.entry_id=(select (r->>'journal_id')::uuid from res where res.name=$1)$$;
create function pg_temp.exrow(name text) returns public.expenses language sql security definer as $$select * from public.expenses where id=(select (r->>'expense_id')::uuid from res where res.name=$1)$$;
create function pg_temp.nback() returns integer language sql security definer as $$select count(*)::int from public.expense_backdates$$;
create function pg_temp.nexp() returns integer language sql security definer as $$select count(*)::int from public.expenses$$;
create function pg_temp.audit(name text) returns public.expense_backdates language sql security definer as $$select * from public.expense_backdates where expense_id=(select (r->>'expense_id')::uuid from res where res.name=$1)$$;
create function pg_temp.balanced() returns boolean language sql security definer as $$
 select not exists(select 1 from public.journal_lines group by entry_id having sum(debit-credit)<>0)$$;
create function pg_temp.klinik_cash() returns numeric language sql security definer as $$select clinic_private.klinik_shift_expected_cash('ed600000-0000-4000-8000-00000000000b')$$;
create function pg_temp.shift_tunai(sh uuid) returns numeric language sql security definer as $$select coalesce(sum(jumlah),0) from public.expenses where shift_id=$1 and metode_bayar='Tunai'$$;

-- ── 0. objek baru ───────────────────────────────────────────────────────────────────────────────
select pg_temp.ok(to_regclass('public.expense_backdates') is not null and (select relrowsecurity from pg_class where oid='public.expense_backdates'::regclass),'tabel jejak expense_backdates ada dan RLS aktif');
select pg_temp.ok(to_regprocedure('public.expense_backdate_precheck(date,text)') is not null and to_regprocedure('public.expense_backdate_bank_check(date,text)') is not null
 and to_regprocedure('public.expense_date_gate()') is not null and to_regprocedure('public.guard_expense_backdates()') is not null,'4 fungsi baru ada (precheck, bank_check, gerbang, penjaga jejak)');
select pg_temp.ok(exists(select 1 from pg_trigger where tgrelid='public.expenses'::regclass and tgname='a0_expense_date_gate' and tgenabled='O' and not tgisinternal),'gerbang INSERT/UPDATE tanggal terpasang dan aktif pada expenses');
select pg_temp.ok(exists(select 1 from pg_trigger where tgrelid='public.expense_backdates'::regclass and tgname='expense_backdates_guard') and exists(select 1 from pg_trigger where tgrelid='public.expense_backdates'::regclass and tgname='expense_backdates_guard_truncate'),'penjaga jejak (UPDATE/DELETE dan TRUNCATE) terpasang');
select pg_temp.ok((length(pg_get_functiondef('public.post_expense_atomic(text,text,uuid,jsonb,jsonb)'::regprocedure))-length(replace(pg_get_functiondef('public.post_expense_atomic(text,text,uuid,jsonb,jsonb)'::regprocedure),'BACKDATE_PENGELUARAN','')))/length('BACKDATE_PENGELUARAN')=3,'post_expense_atomic ditambal tepat 3 titik (penanda BACKDATE_PENGELUARAN)');
select pg_temp.ok(not exists(select 1 from role_settings_private.action_catalog where id ilike '%mundur%' and id ilike '%pengeluaran%') and not exists(select 1 from role_settings_private.action_catalog where id ilike 'pengeluaran%tanggal%'),'TIDAK ada izin baru "Tanggal mundur - Input pengeluaran" (keputusan Owner: semua akun)');
select pg_temp.ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='expenses' and (column_name like '%alasan%' or column_name like 'effective%' or column_name like '%backdate%')),'tidak ada kolom baru di expenses (tanggal = expenses.tanggal)');
select pg_temp.ok((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid='public.post_expense_atomic(text,text,uuid,jsonb,jsonb)'::regprocedure)
 and position('deny_admin_online' in pg_get_functiondef('public.post_expense_atomic(text,text,uuid,jsonb,jsonb)'::regprocedure))>0,'post_expense_atomic tetap SECURITY DEFINER, search_path kosong, penjaga Admin Online masih ada');

-- ── 1. HARI INI tidak berubah untuk siapa pun (tanpa alasan, tanpa jejak) ──────────────────────────
select pg_temp.as_('ed100000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.save('t_owner',pg_temp.exp('t-owner','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()));
select pg_temp.as_('ed100000-0000-4000-8000-000000000002');
select pg_temp.save('t_admin',pg_temp.exp('t-admin','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today(),null,11000,'Listrik & Air'));
select pg_temp.as_('ed100000-0000-4000-8000-000000000003');
select pg_temp.save('t_fin',pg_temp.exp('t-fin','backoffice','ed200000-0000-4000-8000-000000000002',pg_temp.today(),null,12000,'Transportasi'));
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
select pg_temp.save('t_staff',pg_temp.exp('t-staff','cashier',null,pg_temp.today(),null,13000,'Perlengkapan'));
select pg_temp.as_('ed100000-0000-4000-8000-000000000005');
select pg_temp.save('t_doc',pg_temp.exp('t-doc','clinic',null,pg_temp.today(),null,14000,'Perawatan'));
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
select pg_temp.save('t_staff_reason',pg_temp.exp('t-staff-r','cashier',null,pg_temp.today(),'alasan diabaikan karena hari ini',15000));
reset role;
select pg_temp.ok(pg_temp.nback()=0,'hari ini: tidak ada baris jejak untuk 6 pengeluaran (OWNER, ADMIN, FINANCE, kasir petshop, kasir klinik, hari ini+alasan)');
select pg_temp.ok((select count(*)=6 from expenses where created_by::text like 'ed100000%' and tanggal=pg_temp.today()),'6 pengeluaran hari ini tersimpan');
select pg_temp.ok(pg_temp.jdate('t_owner')=pg_temp.today() and pg_temp.jdate('t_admin')=pg_temp.today() and pg_temp.jdate('t_fin')=pg_temp.today() and pg_temp.jdate('t_staff')=pg_temp.today() and pg_temp.jdate('t_doc')=pg_temp.today(),'jurnal semua pengeluaran hari ini bertanggal hari ini');
select pg_temp.ok(pg_temp.jnet('t_owner')=0 and pg_temp.jnet('t_admin')=0 and pg_temp.jnet('t_fin')=0 and pg_temp.jnet('t_staff')=0 and pg_temp.jnet('t_doc')=0,'debit = kredit di semua jurnal hari ini');
select pg_temp.ok(pg_temp.jline('t_owner','760003')=25000 and pg_temp.jline('t_admin','720002')=11000 and pg_temp.jline('t_fin','740003')=12000 and pg_temp.jline('t_staff','740001')=13000 and pg_temp.jline('t_doc','740007')=14000,'akun beban per kategori tidak berubah');
select pg_temp.ok(pg_temp.jline('t_staff','1191')=-13000 and pg_temp.jline('t_doc','1193')=-14000,'akun kas per cabang/metode tidak berubah (kas petshop 1191, kas klinik 1193)');
select pg_temp.ok((pg_temp.exrow('t_staff')).shift_id='ed600000-0000-4000-8000-00000000000a' and (pg_temp.exrow('t_doc')).shift_id='ed600000-0000-4000-8000-00000000000b' and (pg_temp.exrow('t_owner')).shift_id is null,'shift: kasir/klinik menempel ke shift terbuka sendiri, back office tanpa shift');
select pg_temp.ok((pg_temp.exrow('t_staff_reason')).tanggal=pg_temp.today() and not exists(select 1 from expense_backdates where reason like 'alasan diabaikan%'),'alasan pada tanggal hari ini diabaikan (tidak disimpan)');

-- ── 2. MUNDUR berhasil untuk semua peran yang boleh input pengeluaran ───────────────────────────────
select pg_temp.as_('ed100000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.save('b_owner',pg_temp.exp('b-owner','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-1,'Nota listrik kemarin terlupa diinput',26000));
select pg_temp.as_('ed100000-0000-4000-8000-000000000002');
select pg_temp.save('b_admin',pg_temp.exp('b-admin','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-3,'Bayar parkir tanggal 3 hari lalu',27000,'Transportasi'));
select pg_temp.as_('ed100000-0000-4000-8000-000000000003');
select pg_temp.save('b_fin',pg_temp.exp('b-fin','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-31,'Tagihan lama baru diterima',28000,'Perawatan'));
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
select pg_temp.save('b_staff',pg_temp.exp('b-staff','cashier',null,pg_temp.today()-2,'Beli galon dua hari lalu lupa dicatat',29000));
select pg_temp.as_('ed100000-0000-4000-8000-000000000005');
select pg_temp.save('b_doc',pg_temp.exp('b-doc','clinic',null,pg_temp.today()-5,'Beli sabun klinik lima hari lalu',30000,'Perlengkapan'));
select pg_temp.as_('ed100000-0000-4000-8000-000000000001');
select pg_temp.save('b_owner_cash',pg_temp.exp('b-owner-cash','cashier',null,pg_temp.today()-1,'Owner lewat kasir petshop',31000));
reset role;
select pg_temp.ok((pg_temp.exrow('b_owner')).tanggal=pg_temp.today()-1 and (pg_temp.exrow('b_admin')).tanggal=pg_temp.today()-3 and (pg_temp.exrow('b_fin')).tanggal=pg_temp.today()-31,'OWNER/ADMIN/FINANCE back office: expenses.tanggal = tanggal pilihan');
select pg_temp.ok((pg_temp.exrow('b_staff')).tanggal=pg_temp.today()-2 and (pg_temp.exrow('b_doc')).tanggal=pg_temp.today()-5 and (pg_temp.exrow('b_owner_cash')).tanggal=pg_temp.today()-1,'kasir petshop, kasir klinik, Owner lewat kasir: expenses.tanggal = tanggal pilihan (tanpa izin khusus)');
select pg_temp.ok(pg_temp.jdate('b_owner')=pg_temp.today()-1 and pg_temp.jdate('b_admin')=pg_temp.today()-3 and pg_temp.jdate('b_fin')=pg_temp.today()-31,'jurnal back office bertanggal mundur (kemarin, 3 hari, 31 hari)');
select pg_temp.ok(pg_temp.jdate('b_staff')=pg_temp.today()-2 and pg_temp.jdate('b_doc')=pg_temp.today()-5 and pg_temp.jdate('b_owner_cash')=pg_temp.today()-1,'jurnal kasir/klinik bertanggal mundur');
select pg_temp.ok(pg_temp.jnet('b_owner')=0 and pg_temp.jnet('b_admin')=0 and pg_temp.jnet('b_fin')=0 and pg_temp.jnet('b_staff')=0 and pg_temp.jnet('b_doc')=0 and pg_temp.jnet('b_owner_cash')=0,'debit = kredit di semua jurnal mundur');
select pg_temp.ok(pg_temp.jline('b_owner','760003')=26000 and pg_temp.jline('b_owner','1191')=-26000,'jurnal Owner back office: beban 26000 debit, kas cabang 1191 kredit');
select pg_temp.ok(pg_temp.jline('b_admin','740003')=27000 and pg_temp.jline('b_fin','740007')=28000 and pg_temp.jline('b_staff','760003')=29000 and pg_temp.jline('b_staff','1191')=-29000 and pg_temp.jline('b_doc','740001')=30000 and pg_temp.jline('b_doc','1193')=-30000,'akun beban dan kas benar pada jurnal mundur (kas keluar dari akun kas cabang)');
select pg_temp.ok((select count(*)=1 and min(actor_id::text)='ed100000-0000-4000-8000-000000000001' and min(effective_date)=pg_temp.today()-1 and min(reason)='Nota listrik kemarin terlupa diinput' and min(context)='backoffice'
 and min(branch_id::text)='ed200000-0000-4000-8000-000000000001' and min(kategori)='Operasional' and min(jumlah)=26000 and min(shift_id::text) is null from expense_backdates where expense_id=pg_temp.eid('b_owner')),'jejak OWNER: pelaku, tanggal efektif, alasan, konteks, cabang, kategori, jumlah');
select pg_temp.ok((select actor_id='ed100000-0000-4000-8000-000000000002' and effective_date=pg_temp.today()-3 and context='backoffice' from pg_temp.audit('b_admin')) and (select actor_id='ed100000-0000-4000-8000-000000000003' and effective_date=pg_temp.today()-31 from pg_temp.audit('b_fin')),'jejak ADMIN dan FINANCE tercatat dengan pelaku dan tanggal efektif');
select pg_temp.ok((select actor_id='ed100000-0000-4000-8000-000000000004' and context='cashier' and shift_id='ed600000-0000-4000-8000-00000000000a' and reason like 'Beli galon%' from pg_temp.audit('b_staff')),'jejak kasir petshop: konteks cashier + shift terbuka');
select pg_temp.ok((select actor_id='ed100000-0000-4000-8000-000000000005' and context='clinic' and shift_id='ed600000-0000-4000-8000-00000000000b' and branch_id='ed200000-0000-4000-8000-000000000002' from pg_temp.audit('b_doc')),'jejak kasir klinik: konteks clinic + shift klinik + cabang klinik');
select pg_temp.ok((select recorded_at>now()-interval '5 minutes' and recorded_at<=now() and (recorded_at at time zone 'Asia/Jakarta')::date>effective_date from expense_backdates where expense_id=pg_temp.eid('b_staff')),'waktu nyata tercatat (recorded_at) dan lebih baru dari tanggal efektif');
select pg_temp.ok(pg_temp.nback()=6,'tepat 6 baris jejak untuk 6 pengeluaran mundur');
select pg_temp.ok((pg_temp.exrow('b_staff')).shift_id='ed600000-0000-4000-8000-00000000000a' and (pg_temp.exrow('b_doc')).shift_id='ed600000-0000-4000-8000-00000000000b' and (pg_temp.exrow('b_owner')).shift_id is null,'kasir/klinik mundur menempel ke shift terbuka SEKARANG; back office tanpa shift');

-- ── 3. PENOLAKAN ─────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.exp('r-noreason','cashier',null,pg_temp.today()-1,null)$q$,'Tanggal mundur: alasan wajib','tanpa alasan ditolak');
select pg_temp.reject($q$select pg_temp.exp('r-empty','cashier',null,pg_temp.today()-1,'')$q$,'Tanggal mundur: alasan wajib','alasan kosong ditolak');
select pg_temp.reject($q$select pg_temp.exp('r-space','cashier',null,pg_temp.today()-1,'     ')$q$,'Tanggal mundur: alasan wajib','alasan spasi saja ditolak');
select pg_temp.reject($q$select pg_temp.exp('r-short','cashier',null,pg_temp.today()-1,'ab')$q$,'Tanggal mundur: alasan wajib','alasan 2 huruf ditolak');
select pg_temp.reject($q$select pg_temp.exp('r-short2','cashier',null,pg_temp.today()-1,'  ab  ')$q$,'Tanggal mundur: alasan wajib','alasan 3 karakter tetapi 2 setelah dirapikan ditolak');
select pg_temp.reject($q$select pg_temp.exp('r-long','cashier',null,pg_temp.today()-1,repeat('x',201))$q$,'Tanggal mundur: alasan wajib','alasan 201 huruf ditolak');
select pg_temp.save('len200',pg_temp.exp('r-200','cashier',null,pg_temp.today()-1,repeat('y',200),1100));
select pg_temp.save('len3',pg_temp.exp('r-3','cashier',null,pg_temp.today()-1,'abc',1200));
select pg_temp.save('trim',pg_temp.exp('r-trim','cashier',null,pg_temp.today()-1,'   dirapikan   ',1300));
select pg_temp.reject($q$select pg_temp.exp('r-32','cashier',null,pg_temp.today()-32,'terlalu lama')$q$,'paling lama 31 hari','32 hari ke belakang ditolak');
select pg_temp.reject($q$select pg_temp.exp('r-90','cashier',null,pg_temp.today()-90,'terlalu lama')$q$,'paling lama 31 hari','90 hari ke belakang ditolak');
select pg_temp.reject($q$select pg_temp.exp('r-future','cashier',null,pg_temp.today()+1,'masa depan')$q$,'Tanggal, kategori, metode atau jumlah pengeluaran tidak valid','besok ditolak (dengan alasan)');
select pg_temp.reject($q$select pg_temp.exp('r-future2','cashier',null,pg_temp.today()+30,null)$q$,'Tanggal, kategori, metode atau jumlah pengeluaran tidak valid','30 hari ke depan ditolak');
select pg_temp.reject($q$select pg_temp.exp('r-nodate','cashier',null,null,'tanpa tanggal')$q$,'Tanggal, kategori, metode atau jumlah pengeluaran tidak valid','tanggal kosong ditolak');
select pg_temp.reject($q$select pg_temp.exp('r-acct','cashier',null,pg_temp.today()-1,'pilih rekening','25000','Operasional','Tunai','ed500000-0000-4000-8000-000000000002')$q$,'Pemilihan rekening hanya tersedia','kasir tidak boleh memilih rekening (aturan lama tetap)');
reset role;
select pg_temp.ok(pg_temp.nback()=9 and (select count(*)=0 from expenses where deskripsi like 'BDP uji r-%' and tanggal<>pg_temp.today()-1),'penolakan tidak meninggalkan pengeluaran atau jejak (9 jejak = 6 + 3 yang sah)');
select pg_temp.ok((select reason from pg_temp.audit('trim'))='dirapikan' and (select length(reason)=200 from pg_temp.audit('len200')),'alasan dirapikan (trim) dan 200 huruf diterima utuh; 3 huruf diterima');
-- periode akuntansi ditutup
update accounting_locks set closed_until=pg_temp.today()-3;
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.exp('c-eq','cashier',null,pg_temp.today()-3,'tepat di batas tutup')$q$,'Periode akuntansi sudah ditutup','periode tertutup: tanggal = closed_until ditolak (pesan lama)');
select pg_temp.reject($q$select pg_temp.exp('c-before','cashier',null,pg_temp.today()-10,'sebelum tutup')$q$,'Periode akuntansi sudah ditutup','periode tertutup: tanggal sebelum closed_until ditolak');
select pg_temp.save('c_ok',pg_temp.exp('c-after','cashier',null,pg_temp.today()-2,'sesudah tutup buku',1400));
select pg_temp.as_('ed100000-0000-4000-8000-000000000003');
select pg_temp.reject($q$select pg_temp.exp('c-fin','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-4,'back office juga ditolak')$q$,'Periode akuntansi sudah ditutup','periode tertutup berlaku juga di back office');
reset role;
update accounting_locks set closed_until=null;
select pg_temp.ok((pg_temp.exrow('c_ok')).tanggal=pg_temp.today()-2,'sehari setelah batas tutup buku diterima');
-- rekonsiliasi bank
insert into bank_reconciliations(tanggal,bank_coa_code,cash_account_id) values(pg_temp.today()-2,'1192','ed500000-0000-4000-8000-000000000002');
select pg_temp.as_('ed100000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.exp('k-before','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-3,'rekening sudah direkonsiliasi','25000','Operasional','Transfer','ed500000-0000-4000-8000-000000000002')$q$,'rekonsiliasi bank','rekonsiliasi bank pada/sesudah tanggal: rekening pilihan ditolak (tanggal 3 hari lalu, rekon 2 hari lalu)');
select pg_temp.reject($q$select pg_temp.exp('k-eq','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-2,'tepat di tanggal rekon','25000','Operasional','Transfer','ed500000-0000-4000-8000-000000000002')$q$,'rekonsiliasi bank','rekonsiliasi pada tanggal yang sama ditolak');
select pg_temp.save('k_after',pg_temp.exp('k-after','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-1,'sesudah tanggal rekonsiliasi',20500,'Operasional','Transfer','ed500000-0000-4000-8000-000000000002'));
select pg_temp.ok((pg_temp.exrow('k_after')).tanggal=pg_temp.today()-1,'tanggal SESUDAH tanggal rekonsiliasi diterima (belum tercakup rekonsiliasi)');
select pg_temp.save('k_other',pg_temp.exp('k-other','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-3,'rekening lain tidak terkunci',21000,'Operasional','Transfer','ed500000-0000-4000-8000-000000000004'));
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$select pg_temp.exp('k-map','cashier',null,pg_temp.today()-3,'transfer lewat kasir','25000','Operasional','Transfer')$q$,'rekonsiliasi bank','kasir dengan metode Transfer (akun peta = rekening yang direkonsiliasi) ditolak');
select pg_temp.save('k_cash',pg_temp.exp('k-cash','cashier',null,pg_temp.today()-3,'tunai tidak punya rekonsiliasi bank',22000));
select pg_temp.save('k_today',pg_temp.exp('k-today','cashier',null,pg_temp.today(),null,23000,'Operasional','Transfer'));
reset role;
select pg_temp.ok((pg_temp.exrow('k_other')).tanggal=pg_temp.today()-3 and (pg_temp.exrow('k_cash')).tanggal=pg_temp.today()-3 and (pg_temp.exrow('k_today')).tanggal=pg_temp.today(),'rekening lain, tunai, dan hari ini TIDAK terkunci oleh rekonsiliasi rekening 1192');
update bank_reconciliations set voided_at=now();
select pg_temp.as_('ed100000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.save('k_void',pg_temp.exp('k-void','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-3,'rekonsiliasi dibatalkan',24000,'Operasional','Transfer','ed500000-0000-4000-8000-000000000002'));
reset role;
select pg_temp.ok((pg_temp.exrow('k_void')).tanggal=pg_temp.today()-3,'rekonsiliasi yang dibatalkan (voided_at) tidak mengunci');
update bank_reconciliations set voided_at=null,tanggal=pg_temp.today()-5;
select pg_temp.as_('ed100000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.save('k_older',pg_temp.exp('k-older','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-3,'rekonsiliasi lebih lama dari tanggal',25500,'Operasional','Transfer','ed500000-0000-4000-8000-000000000002'));
reset role;
select pg_temp.ok((pg_temp.exrow('k_older')).tanggal=pg_temp.today()-3,'rekonsiliasi SEBELUM tanggal pengeluaran tidak mengunci');
-- rekonsiliasi bank bertanggal HARI INI pada rekening 1192: pengeluaran hari ini tetap bebas (pemeriksaan hanya untuk tanggal mundur)
update bank_reconciliations set tanggal=pg_temp.today();
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.save('k_today2',pg_temp.exp('k-today2','cashier',null,pg_temp.today(),null,23500,'Operasional','Transfer'));
select pg_temp.reject($q$select pg_temp.exp('k-back-today','cashier',null,pg_temp.today()-1,'rekon bertanggal hari ini mencakup kemarin','25000','Operasional','Transfer')$q$,'rekonsiliasi bank','rekonsiliasi bertanggal hari ini mengunci tanggal mundur pada rekening itu');
reset role;
select pg_temp.ok((pg_temp.exrow('k_today2')).tanggal=pg_temp.today(),'pengeluaran HARI INI pada rekening yang direkonsiliasi hari ini tetap bebas');
update bank_reconciliations set tanggal=pg_temp.today()-2,bank_coa_code='ZZZZ-TIDAK-ADA',cash_account_id=null;
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.exp('k-unknown','cashier',null,pg_temp.today()-3,'rekon rekening tak dikenal','25000')$q$,'rekonsiliasi bank','rekonsiliasi dengan rekening tak dikenal mengunci (gagal-tertutup)');
reset role;
delete from bank_reconciliations;
-- Admin Online dan akun tanpa akses
select pg_temp.as_('ed100000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.reject($q$select pg_temp.exp('ao-back','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-1,'admin online mundur')$q$,'ADMIN_ONLINE_FUNCTION_DENIED','Admin Online ditolak seluruhnya: back office mundur');
select pg_temp.reject($q$select pg_temp.exp('ao-today','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today())$q$,'ADMIN_ONLINE_FUNCTION_DENIED','Admin Online ditolak: hari ini juga');
select pg_temp.reject($q$select pg_temp.exp('ao-cash','cashier',null,pg_temp.today()-1,'admin online kasir')$q$,'ADMIN_ONLINE_FUNCTION_DENIED','Admin Online ditolak: konteks kasir');
select pg_temp.reject($q$select pg_temp.exp('ao-clin','clinic',null,pg_temp.today()-1,'admin online klinik')$q$,'ADMIN_ONLINE_FUNCTION_DENIED','Admin Online ditolak: konteks klinik');
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$select pg_temp.exp('st-back','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-1,'kasir biasa lewat back office')$q$,'Akses pengeluaran ditolak','peran tanpa akses back office (STAFF) tetap ditolak walau beralasan');
select pg_temp.as_('ed100000-0000-4000-8000-000000000005');
select pg_temp.reject($q$select pg_temp.exp('doc-back','backoffice','ed200000-0000-4000-8000-000000000002',pg_temp.today()-1,'kasir klinik lewat back office')$q$,'Akses pengeluaran ditolak','DOCTOR lewat back office tetap ditolak');
select pg_temp.reject($q$select pg_temp.exp('doc-cashier','cashier',null,pg_temp.today()-1,'kasir klinik lewat kasir petshop')$q$,'Shift tidak valid','konteks kasir tanpa shift petshop ditolak');
select pg_temp.as_('ed100000-0000-4000-8000-000000000008');
select pg_temp.reject($q$select pg_temp.exp('oth-cash','cashier',null,pg_temp.today()-1,'tanpa shift')$q$,'Shift tidak valid','akun tanpa shift terbuka ditolak (mundur)');
select pg_temp.as_('ed100000-0000-4000-8000-000000000002');
select pg_temp.reject($q$select pg_temp.exp('adm-other','backoffice','ed200000-0000-4000-8000-000000000003',pg_temp.today()-1,'cabang tanpa akses')$q$,'Akses pengeluaran ditolak','ADMIN di cabang tanpa akses ditolak (mundur)');
select pg_temp.as_('ed100000-0000-4000-8000-000000000009');
select pg_temp.reject($q$select pg_temp.exp('inactive','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-1,'nonaktif')$q$,'Akses pengeluaran ditolak','akun nonaktif ditolak (mundur)');
select pg_temp.as_('');
select pg_temp.reject($q$select pg_temp.exp('anon','backoffice','ed200000-0000-4000-8000-000000000001',pg_temp.today()-1,'tanpa login')$q$,'Akses pengeluaran ditolak','tanpa sesi login ditolak');
reset role;
select pg_temp.ok(pg_temp.nback()=15 and (select count(*)=0 from expenses where deskripsi in('BDP uji ao-back','BDP uji ao-today','BDP uji st-back','BDP uji inactive','BDP uji anon')),'penolakan peran/akses tidak meninggalkan pengeluaran maupun jejak (15 jejak sah)');

-- ── 4. IDEMPOTENSI (kunci permintaan) ────────────────────────────────────────────────────────────
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.save('i1',pg_temp.exp('idem-1','cashier',null,pg_temp.today()-2,'idempoten pertama',17000));
select pg_temp.ok(pg_temp.exp('idem-1','cashier',null,pg_temp.today()-2,'idempoten pertama',17000)=(select r from res where name='i1'),'kunci sama + isi sama = jawaban lama (tanpa menggandakan)');
select pg_temp.ok(public.get_expense_posting_result('idem-1')=(select r from res where name='i1'),'pemulihan hasil simpan membaca jawaban yang sama');
select pg_temp.reject($q$select pg_temp.exp('idem-1','cashier',null,pg_temp.today()-3,'idempoten pertama',17000)$q$,'rincian berbeda','kunci sama + tanggal lain ditolak');
select pg_temp.reject($q$select pg_temp.exp('idem-1','cashier',null,pg_temp.today()-2,'alasan lain',17000)$q$,'rincian berbeda','kunci sama + alasan lain ditolak');
select pg_temp.reject($q$select pg_temp.exp('idem-1','cashier',null,pg_temp.today()-2,'idempoten pertama',18000)$q$,'rincian berbeda','kunci sama + jumlah lain ditolak');
select pg_temp.reject($q$select pg_temp.exp('idem-1','cashier',null,pg_temp.today(),null,17000)$q$,'rincian berbeda','kunci sama + diubah jadi hari ini ditolak');
reset role;
select pg_temp.ok((select count(*)=1 from expenses where id=pg_temp.eid('i1')) and (select count(*)=1 from expense_backdates where expense_id=pg_temp.eid('i1')) and (select count(*)=1 from journal_entries where source='expense' and source_ref=pg_temp.eid('i1')::text),'satu pengeluaran, satu jejak, satu jurnal setelah percobaan ulang');
update accounting_locks set closed_until=pg_temp.today()-1;
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.ok(pg_temp.exp('idem-1','cashier',null,pg_temp.today()-2,'idempoten pertama',17000)=(select r from res where name='i1'),'pengulangan kunci yang sama tetap menjawab walau periodenya kini ditutup (pemulihan respons hilang)');
reset role;
update accounting_locks set closed_until=null;
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.save('i2',pg_temp.exp('idem-2','cashier',null,pg_temp.today()-2,'idempoten pertama',17000));
select pg_temp.as_('ed100000-0000-4000-8000-000000000007');
select pg_temp.reject($q$select pg_temp.exp('idem-1','cashier',null,pg_temp.today()-2,'akun lain memakai kunci yang sama','17000')$q$,'Shift tidak valid','kunci dibatasi per pelaku: akun lain dengan kunci sama diperlakukan sebagai permintaan baru (butuh shiftnya sendiri)');
reset role;
select pg_temp.ok(pg_temp.eid('i1')<>pg_temp.eid('i2') and (select count(*)=2 from expense_backdates where kategori='Operasional' and jumlah=17000),'kunci berbeda dengan isi sama = dua pengeluaran dan dua jejak (aturan lama: dua kejadian terpisah)');

-- ── 5. TULIS LANGSUNG ke expenses (lubang lama) ──────────────────────────────────────────────────
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.ok(pg_temp.try($q$insert into public.expenses(branch_id,tanggal,kategori,jumlah,metode_bayar,created_by) values('ed200000-0000-4000-8000-000000000001',pg_temp.today()-2,'Operasional',99000,'Tunai',auth.uid())$q$) like 'Tanggal mundur: pengeluaran bertanggal selain hari ini%','INSERT langsung kasir dengan tanggal 2 hari lalu DITOLAK gerbang');
select pg_temp.ok(pg_temp.try($q$insert into public.expenses(branch_id,tanggal,kategori,jumlah,metode_bayar,created_by) values('ed200000-0000-4000-8000-000000000001',pg_temp.today()+1,'Operasional',99000,'Tunai',auth.uid())$q$) like 'Tanggal mundur: pengeluaran bertanggal selain hari ini%','INSERT langsung kasir dengan tanggal besok DITOLAK gerbang');
select pg_temp.ok(pg_temp.try($q$insert into public.expenses(branch_id,tanggal,kategori,jumlah,metode_bayar,created_by) values('ed200000-0000-4000-8000-000000000001',pg_temp.today()-31,'Operasional',99000,'Tunai',auth.uid())$q$) like 'Tanggal mundur: pengeluaran bertanggal selain hari ini%','INSERT langsung kasir dengan tanggal 31 hari lalu DITOLAK gerbang');
select pg_temp.ok(pg_temp.try($q$insert into public.expenses(branch_id,tanggal,kategori,jumlah,metode_bayar,created_by) values('ed200000-0000-4000-8000-000000000001','2020-01-01','Operasional',99000,'Tunai',auth.uid())$q$) like 'Tanggal mundur: pengeluaran bertanggal selain hari ini%','INSERT langsung kasir dengan tanggal tahun lalu DITOLAK gerbang');
select pg_temp.as_('ed100000-0000-4000-8000-000000000001');
select pg_temp.ok(pg_temp.try($q$insert into public.expenses(branch_id,tanggal,kategori,jumlah,metode_bayar,created_by) values('ed200000-0000-4000-8000-000000000001',pg_temp.today()-2,'Operasional',99000,'Tunai',auth.uid())$q$) like 'Tanggal mundur: pengeluaran bertanggal selain hari ini%','INSERT langsung OWNER dengan tanggal lampau juga ditolak (tidak ada pengecualian peran)');
select pg_temp.as_('ed100000-0000-4000-8000-000000000003');
select pg_temp.ok(pg_temp.try($q$insert into public.expenses(branch_id,tanggal,kategori,jumlah,metode_bayar,created_by) values('ed200000-0000-4000-8000-000000000001',pg_temp.today()-9,'Operasional',99000,'Tunai',auth.uid())$q$) like 'Tanggal mundur: pengeluaran bertanggal selain hari ini%','INSERT langsung FINANCE dengan tanggal lampau juga ditolak');
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
select pg_temp.ok(pg_temp.try($q$insert into public.expenses(branch_id,tanggal,kategori,jumlah,metode_bayar,created_by) values('ed200000-0000-4000-8000-000000000001',pg_temp.today(),'Operasional',1000,'Tunai',auth.uid())$q$)='OK','INSERT langsung bertanggal hari ini tidak berubah (perilaku lama; gerbang hanya menutup tanggal selain hari ini)');
select pg_temp.ok(pg_temp.try($q$update public.expenses set tanggal=pg_temp.today()-9 where deskripsi like 'BDP uji b-staff'$q$) like 'permission denied%','UPDATE tanggal oleh klien: tidak ada hak UPDATE sama sekali (sudah dicabut)');
select pg_temp.ok(pg_temp.try($q$delete from public.expenses where deskripsi like 'BDP uji b-staff'$q$) like 'permission denied%','DELETE oleh klien ditolak (hak dicabut)');
reset role;
-- pertahanan berlapis: seandainya hak UPDATE dikembalikan, gerbang menolak ganti tanggal
grant update on public.expenses to authenticated;
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.ok(pg_temp.try($q$update public.expenses set tanggal=pg_temp.today()-9 where deskripsi='BDP uji b-staff'$q$) like 'Tanggal mundur: tanggal pengeluaran tidak dapat diubah langsung%','(lapis kedua) UPDATE tanggal ditolak gerbang walau hak UPDATE ada');
select pg_temp.ok(pg_temp.try($q$update public.expenses set tanggal=pg_temp.today() where deskripsi='BDP uji b-staff'$q$) like 'Tanggal mundur: tanggal pengeluaran tidak dapat diubah langsung%','(lapis kedua) UPDATE memindahkan tanggal mundur -> hari ini juga ditolak (jurnal tetap di tanggal lama)');
select pg_temp.ok(coalesce(pg_temp.try($q$update public.expenses set tanggal=tanggal where deskripsi='BDP uji b-staff'$q$),'') not like 'Tanggal mundur:%','UPDATE yang tidak mengubah tanggal tidak disentuh gerbang');
select pg_temp.ok(coalesce(pg_temp.try($q$update public.expenses set deskripsi='ubah' where deskripsi='BDP uji b-staff'$q$),'') not like 'Tanggal mundur:%','UPDATE kolom lain tidak disentuh gerbang');
reset role;
revoke update on public.expenses from authenticated;
select pg_temp.as_('ed100000-0000-4000-8000-000000000001');
set local role service_role;
select pg_temp.ok(pg_temp.try($q$insert into public.expenses(branch_id,tanggal,kategori,jumlah,metode_bayar,created_by) values('ed200000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Jakarta')::date-2,'Operasional',99000,'Tunai','ed100000-0000-4000-8000-000000000001')$q$)='OK','service_role (kunci server tepercaya) tidak digerbang: sama dengan keputusan versi penjualan');
reset role;
select pg_temp.ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','clinic_private') and not p.prosecdef
 and (lower(p.prosrc) like '%insert into public.expenses%' or lower(p.prosrc) like '%update public.expenses%')),'semua fungsi yang menulis/mengubah expenses adalah SECURITY DEFINER (penulis resmi: refund, retur, biaya merchant, J03, koreksi tidak terpengaruh gerbang)');
select pg_temp.ok(exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='revise_expense_atomic' and p.prosecdef),'jalur koreksi revise_expense_atomic tetap SECURITY DEFINER (tidak terkena gerbang)');
-- koreksi resmi tetap jalan: FINANCE mengubah tanggal pengeluaran back office hari ini ke tanggal lampau (jalur berjejak lama, tidak diubah)
select pg_temp.as_('ed100000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.ok(public.revise_expense_atomic('rev-1',pg_temp.eid('t_owner'),0,'edit',jsonb_build_object('tanggal',(pg_temp.today()-4)::text,'kategori','Operasional','deskripsi','koreksi','jumlah',25000,'metode_bayar','Tunai'),'Koreksi tanggal oleh Finance') is not null,'jalur koreksi resmi (Ubah) masih bisa memindahkan tanggal: tidak diblokir gerbang');
select pg_temp.ok(public.revise_expense_atomic('void-1',pg_temp.eid('b_admin'),0,'void','{}'::jsonb,'Batal pengeluaran mundur') is not null,'jalur Batalkan pada pengeluaran bertanggal mundur berjalan');
reset role;
select pg_temp.ok((pg_temp.exrow('t_owner')).tanggal=pg_temp.today()-4 and (pg_temp.exrow('b_admin')).voided_at is not null and (select count(*)=1 from expense_backdates where expense_id=pg_temp.eid('b_admin')),'koreksi/batal memengaruhi pengeluaran, jejak tanggal mundur asli tidak berubah');

-- ── 6. TABEL JEJAK: tak bisa diubah ──────────────────────────────────────────────────────────────
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.ok(pg_temp.try($q$insert into public.expense_backdates(expense_id,actor_id,branch_id,context,request_key,effective_date,reason,kategori,jumlah) values(gen_random_uuid(),auth.uid(),'ed200000-0000-4000-8000-000000000001','cashier','x',pg_temp.today()-1,'palsu','Operasional',1)$q$) like 'permission denied%','klien tidak bisa INSERT jejak');
select pg_temp.ok(pg_temp.try($q$update public.expense_backdates set reason='diubah'$q$) like 'permission denied%','klien tidak bisa UPDATE jejak');
select pg_temp.ok(pg_temp.try($q$delete from public.expense_backdates$q$) like 'permission denied%','klien tidak bisa DELETE jejak');
select pg_temp.ok(pg_temp.try($q$truncate public.expense_backdates$q$) like 'permission denied%','klien tidak bisa TRUNCATE jejak');
reset role;
select pg_temp.ok(pg_temp.try($q$update public.expense_backdates set reason='diubah superuser'$q$) like 'Jejak tanggal mundur pengeluaran tidak dapat diubah%','superuser pun tidak bisa UPDATE jejak (trigger)');
select pg_temp.ok(pg_temp.try($q$delete from public.expense_backdates$q$) like 'Jejak tanggal mundur pengeluaran tidak dapat diubah%','superuser pun tidak bisa DELETE jejak (trigger)');
select pg_temp.ok(pg_temp.try($q$truncate public.expense_backdates$q$) like 'Jejak tanggal mundur pengeluaran tidak dapat diubah%','superuser pun tidak bisa TRUNCATE jejak (trigger)');
select pg_temp.ok(pg_temp.try($q$insert into public.expense_backdates(expense_id,actor_id,branch_id,context,request_key,effective_date,reason,kategori,jumlah) values(gen_random_uuid(),'ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001','cashier','tk1',pg_temp.today()-1,'ab','Operasional',1)$q$) like '%expense_backdates_reason_check%','CHECK tabel: alasan < 3 huruf ditolak');
select pg_temp.ok(pg_temp.try($q$insert into public.expense_backdates(expense_id,actor_id,branch_id,context,request_key,effective_date,reason,kategori,jumlah) values(gen_random_uuid(),'ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001','cashier','tk2',pg_temp.today(),'alasan sah','Operasional',1)$q$) like '%expense_backdates_date_check%','CHECK tabel: tanggal efektif hari ini ditolak (bukan mundur)');
select pg_temp.ok(pg_temp.try($q$insert into public.expense_backdates(expense_id,actor_id,branch_id,context,request_key,effective_date,reason,kategori,jumlah) values(gen_random_uuid(),'ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001','cashier','tk3',pg_temp.today()-32,'alasan sah','Operasional',1)$q$) like '%expense_backdates_date_check%','CHECK tabel: 32 hari ke belakang ditolak');
select pg_temp.ok(pg_temp.try($q$insert into public.expense_backdates(expense_id,actor_id,branch_id,context,request_key,effective_date,reason,kategori,jumlah) values(gen_random_uuid(),'ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001','cashier','tk4',pg_temp.today()-1,'alasan sah','Operasional',0)$q$) like '%expense_backdates_jumlah_check%','CHECK tabel: jumlah 0 ditolak');
select pg_temp.ok(pg_temp.try($q$insert into public.expense_backdates(expense_id,actor_id,branch_id,context,request_key,effective_date,reason,kategori,jumlah) values(gen_random_uuid(),'ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001','toko','tk5',pg_temp.today()-1,'alasan sah','Operasional',1)$q$) like '%expense_backdates_context_check%','CHECK tabel: konteks di luar cashier/clinic/backoffice ditolak');
select pg_temp.ok(pg_temp.try(format($q$insert into public.expense_backdates(expense_id,actor_id,branch_id,context,request_key,effective_date,reason,kategori,jumlah) values(%L,'ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001','cashier','tk6',pg_temp.today()-1,'alasan sah','Operasional',1)$q$,pg_temp.eid('b_staff'))) like '%expense_backdates_expense_id_key%','UNIK: satu jejak per pengeluaran');
select pg_temp.ok(pg_temp.try($q$insert into public.expense_backdates(expense_id,actor_id,branch_id,context,request_key,effective_date,reason,kategori,jumlah) values(gen_random_uuid(),'ed100000-0000-4000-8000-000000000004','ed200000-0000-4000-8000-000000000001','cashier','b-staff',pg_temp.today()-1,'alasan sah','Operasional',1)$q$) like '%expense_backdates_actor_id_request_key_key%','UNIK: satu jejak per (pelaku, kunci permintaan)');
-- RLS baca
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.ok((select count(*) from public.expense_backdates)=(select count(*) from public.expense_backdates where actor_id='ed100000-0000-4000-8000-000000000004') and (select count(*)>=5 from public.expense_backdates),'kasir membaca jejak miliknya sendiri saja (>= 5 baris)');
select pg_temp.as_('ed100000-0000-4000-8000-000000000007');
select pg_temp.ok((select count(*)=0 from public.expense_backdates),'kasir lain di cabang yang sama tidak membaca jejak orang lain');
select pg_temp.as_('ed100000-0000-4000-8000-000000000003');
select pg_temp.ok((select count(*)>=8 from public.expense_backdates where branch_id='ed200000-0000-4000-8000-000000000001') and (select count(*)>=1 from public.expense_backdates where branch_id='ed200000-0000-4000-8000-000000000002'),'FINANCE dengan akses cabang membaca jejak cabangnya');
select pg_temp.as_('ed100000-0000-4000-8000-000000000008');
select pg_temp.ok((select count(*)=0 from public.expense_backdates),'akun cabang lain tidak membaca jejak');
select pg_temp.as_('ed100000-0000-4000-8000-000000000005');
select pg_temp.ok((select count(*)=1 from public.expense_backdates) and (select context='clinic' from public.expense_backdates),'kasir klinik hanya membaca jejak klinik miliknya');
select pg_temp.as_('ed100000-0000-4000-8000-000000000006');
select pg_temp.ok((select count(*)=0 from public.expense_backdates),'Admin Online tidak membaca jejak (pagar baca)');
select pg_temp.as_('ed100000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*)>=10 from public.expense_backdates),'OWNER membaca jejak semua cabangnya');
reset role;

-- ── 7. EFEK SHIFT / LACI ─────────────────────────────────────────────────────────────────────────
select pg_temp.ok(pg_temp.shift_tunai('ed600000-0000-4000-8000-00000000000a')>=(13000+15000+29000+17000+17000),'laci petshop: pengeluaran tunai mundur dan hari ini sama-sama dihitung per shift_id');
select pg_temp.ok((select jumlah=29000 and tanggal=pg_temp.today()-2 and shift_id='ed600000-0000-4000-8000-00000000000a' and metode_bayar='Tunai' from public.expenses where id=pg_temp.eid('b_staff')),'pengeluaran mundur kasir: tanggal 2 hari lalu, tetapi shift_id = shift terbuka sekarang');
select pg_temp.ok((select count(*)=0 from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where e.id=pg_temp.jid('b_staff') and e.tanggal=pg_temp.today()) and pg_temp.jline('b_staff','1191')=-29000,'buku besar kas: keluar di TANGGAL MUNDUR, tidak ada baris jurnal bertanggal hari ini');
create temp table kc(v0 numeric,v1 numeric,v2 numeric);grant all on kc to public;
insert into kc(v0) values(pg_temp.klinik_cash());
select pg_temp.as_('ed100000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.save('kl_tunai',pg_temp.exp('kl-tunai','clinic',null,pg_temp.today()-4,'uji laci klinik tunai',12345));
reset role;
update kc set v1=pg_temp.klinik_cash();
select pg_temp.ok((select v0-v1=12345 from kc),'klinik: pengeluaran TUNAI mundur mengurangi kas shift klinik sekarang tepat sebesar jumlahnya (klinik_shift_expected_cash)');
select pg_temp.as_('ed100000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.save('kl_tf',pg_temp.exp('kl-tf','clinic',null,pg_temp.today()-4,'uji laci klinik transfer',9999,'Operasional','Transfer'));
reset role;
update kc set v2=pg_temp.klinik_cash();
select pg_temp.ok((select v1=v2 from kc),'klinik: pengeluaran TRANSFER mundur tidak mengubah kas laci');
select pg_temp.ok((select v2=100000-(select sum(jumlah) from expenses where shift_id='ed600000-0000-4000-8000-00000000000b' and metode_bayar='Tunai') from kc),'klinik: kas seharusnya = saldo awal - semua pengeluaran tunai shift (hari ini + mundur)');
select pg_temp.ok((select e.shift_id='ed600000-0000-4000-8000-00000000000b' and e.tanggal=pg_temp.today()-4 from expenses e where id=pg_temp.eid('kl_tunai')),'baris klinik mundur: tanggal mundur, shift klinik sekarang');

-- ── 8. ACL, search_path, pagar Admin Online ───────────────────────────────────────────────────────
select pg_temp.ok(has_function_privilege('authenticated','public.post_expense_atomic(text,text,uuid,jsonb,jsonb)','execute') and not has_function_privilege('anon','public.post_expense_atomic(text,text,uuid,jsonb,jsonb)','execute'),'post_expense_atomic: authenticated boleh, anon tidak');
select pg_temp.ok(not has_function_privilege('authenticated','public.expense_backdate_precheck(date,text)','execute') and not has_function_privilege('anon','public.expense_backdate_precheck(date,text)','execute') and not has_function_privilege('service_role','public.expense_backdate_precheck(date,text)','execute'),'expense_backdate_precheck: internal, tidak bisa dipanggil klien');
select pg_temp.ok(not has_function_privilege('authenticated','public.expense_backdate_bank_check(date,text)','execute') and not has_function_privilege('anon','public.expense_backdate_bank_check(date,text)','execute') and not has_function_privilege('service_role','public.expense_backdate_bank_check(date,text)','execute'),'expense_backdate_bank_check: internal, tidak bisa dipanggil klien');
select pg_temp.ok(not has_function_privilege('authenticated','public.expense_date_gate()','execute') and not has_function_privilege('anon','public.expense_date_gate()','execute') and not has_function_privilege('authenticated','public.guard_expense_backdates()','execute') and not has_function_privilege('anon','public.guard_expense_backdates()','execute'),'fungsi pemicu gerbang dan penjaga: tidak bisa dipanggil klien');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.oid in('public.expense_backdate_precheck(date,text)'::regprocedure,'public.expense_backdate_bank_check(date,text)'::regprocedure,'public.expense_date_gate()'::regprocedure,'public.guard_expense_backdates()'::regprocedure,'public.post_expense_atomic(text,text,uuid,jsonb,jsonb)'::regprocedure)
 and not ('search_path=""'=any(coalesce(p.proconfig,'{}'::text[])))),'5 fungsi (4 baru + post_expense_atomic) memakai search_path kosong');
select pg_temp.ok(has_table_privilege('authenticated','public.expense_backdates','select') and not has_table_privilege('authenticated','public.expense_backdates','insert') and not has_table_privilege('authenticated','public.expense_backdates','update')
 and not has_table_privilege('authenticated','public.expense_backdates','delete') and not has_table_privilege('authenticated','public.expense_backdates','truncate'),'tabel jejak: authenticated hanya SELECT');
select pg_temp.ok(not has_table_privilege('anon','public.expense_backdates','select') and not has_table_privilege('service_role','public.expense_backdates','insert') and not has_table_privilege('service_role','public.expense_backdates','update'),'tabel jejak: anon tanpa akses; service_role tidak bisa menulis');
select pg_temp.ok(exists(select 1 from pg_trigger where tgrelid='public.expense_backdates'::regclass and tgname='zz_admin_online_write_fence') and exists(select 1 from pg_policy where polrelid='public.expense_backdates'::regclass and polname='admin_online_fence_r'),'pagar Admin Online terpasang pada tabel jejak (trigger tulis + kebijakan baca)');
select pg_temp.ok(not has_table_privilege('authenticated','public.expenses','update') and not has_table_privilege('authenticated','public.expenses','delete') and has_table_privilege('authenticated','public.expenses','insert'),'expenses: hak klien tidak berubah (INSERT ada, UPDATE/DELETE tidak)');
select pg_temp.as_('ed100000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.ok(pg_temp.try($q$insert into public.expenses(branch_id,tanggal,kategori,jumlah,metode_bayar,created_by) values('ed200000-0000-4000-8000-000000000001',pg_temp.today(),'Operasional',1000,'Tunai',auth.uid())$q$)<>'OK','Admin Online tidak bisa INSERT langsung ke expenses (pagar #549 utuh)');
reset role;

-- ── 9. INVARIAN ───────────────────────────────────────────────────────────────────────────────────
select pg_temp.ok(pg_temp.balanced(),'semua jurnal seimbang (debit = kredit per entri) setelah seluruh skenario');
select pg_temp.ok(not exists(select 1 from public.expense_backdates b left join public.expenses e on e.id=b.expense_id left join public.journal_entries j on j.id=e.journal_entry_id
 where e.id is null or j.id is null or (e.revision=0 and (e.tanggal<>b.effective_date or j.tanggal<>b.effective_date)) or e.created_by<>b.actor_id),'setiap jejak menunjuk pengeluaran dan jurnal yang bertanggal sama dengan tanggal efektif, pelaku sama');
select pg_temp.ok(not exists(select 1 from public.expenses e where e.revision=0 and e.created_by::text like 'ed100000%' and e.tanggal<pg_temp.today() and e.journal_entry_id is not null
 and not exists(select 1 from public.expense_backdates b where b.expense_id=e.id)),'setiap pengeluaran bertanggal lampau yang lewat fungsi punya jejak (tidak ada yang lolos tanpa jejak)');
select pg_temp.ok(not exists(select 1 from public.expense_backdates where effective_date>=(recorded_at at time zone 'Asia/Jakarta')::date or effective_date<(recorded_at at time zone 'Asia/Jakarta')::date-31 or length(btrim(reason)) not between 3 and 200),'tidak ada jejak di luar aturan (hari ini/ masa depan, > 31 hari, alasan di luar 3-200)');
select pg_temp.ok((select count(*) from public.expense_posting_requests where kind='create' and payload->'expense'?'alasan_tanggal')>=10,'alasan ikut dalam isi permintaan yang disimpan untuk idempotensi');

-- ── 10. CELAH TES dari review independen PR #570 (rapikan, 26 Nov 2026): mutan X01/X02/X04/X14 selamat dari suite lama ──
reset role;
select pg_temp.as_('ed100000-0000-4000-8000-000000000001'); -- bagian 8 meninggalkan klaim Admin Online; pagar profiles menolak INSERT atas namanya
insert into auth.users(id,raw_user_meta_data) values('ed100000-0000-4000-8000-00000000000a','{"full_name":"BDP finance cabang lain"}');
update profiles set role='FINANCE',is_active=true where id='ed100000-0000-4000-8000-00000000000a';
insert into user_branches(user_id,branch_id) values('ed100000-0000-4000-8000-00000000000a','ed200000-0000-4000-8000-000000000003');
create function pg_temp.nvisible() returns integer language sql as $$select count(*)::int from public.expense_backdates$$;
select pg_temp.ok(pg_temp.nback()>=10,'prasyarat bagian 10: sudah ada >= 10 baris jejak untuk diuji pembacaannya');
select pg_temp.as_('ed100000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.ok(pg_temp.nvisible()>=10,'FINANCE cabang yang sama membaca jejak cabangnya (kontrol)');
select pg_temp.as_('ed100000-0000-4000-8000-00000000000a');
select pg_temp.ok(pg_temp.nvisible()=0,'FINANCE cabang LAIN tidak membaca satu pun jejak (RLS akses cabang; X01)');
select pg_temp.as_('ed100000-0000-4000-8000-000000000009');
select pg_temp.ok(pg_temp.nvisible()=0,'FINANCE NONAKTIF di cabang yang sama tidak membaca satu pun jejak (X02)');
select pg_temp.as_('ed100000-0000-4000-8000-000000000008');
select pg_temp.ok(pg_temp.nvisible()=0,'kasir cabang lain tidak membaca jejak');
select pg_temp.as_('ed100000-0000-4000-8000-000000000007');
select pg_temp.ok(pg_temp.nvisible()=0 and not exists(select 1 from public.expense_backdates where actor_id<>auth.uid()),'kasir lain di cabang yang sama tidak membaca jejak orang lain');
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
select pg_temp.ok(pg_temp.nvisible()>=1 and not exists(select 1 from public.expense_backdates where actor_id<>auth.uid()),'pelaku hanya membaca jejak miliknya sendiri');
select pg_temp.as_('ed100000-0000-4000-8000-000000000001');
select pg_temp.ok(pg_temp.nvisible()=pg_temp.nback(),'OWNER membaca semua jejak');
-- INSERT langsung dengan tanggal KOSONG: harus ditolak gerbang (bukan lolos ke NOT NULL); mutan "<>" meloloskan NULL (X14)
select pg_temp.as_('ed100000-0000-4000-8000-000000000004');
select pg_temp.ok(pg_temp.try($q$insert into public.expenses(branch_id,tanggal,kategori,jumlah,metode_bayar,created_by) values('ed200000-0000-4000-8000-000000000001',null,'Operasional',99000,'Tunai',auth.uid())$q$) like 'Tanggal mundur: pengeluaran bertanggal selain hari ini%','INSERT langsung dengan tanggal KOSONG ditolak oleh gerbang (X14)');
reset role;
-- jejak menyimpan kategori dan jumlah pengeluaran yang SEBENARNYA, bukan konstanta (X04)
select pg_temp.ok(not exists(select 1 from public.expense_backdates b join public.expenses e on e.id=b.expense_id where e.revision=0 and (b.kategori is distinct from e.kategori or b.jumlah is distinct from e.jumlah))
 and (select count(distinct kategori) from public.expense_backdates)>=3 and exists(select 1 from public.expense_backdates where kategori='Perlengkapan') and exists(select 1 from public.expense_backdates where kategori='Transportasi'),'jejak menyimpan kategori dan jumlah sebenarnya (>= 3 kategori berbeda; X04)');

rollback;
