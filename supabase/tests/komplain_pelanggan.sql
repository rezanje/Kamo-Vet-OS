-- Komplain Pelanggan (migrasi 20261211100000_komplain_pelanggan): fixture fiktif di PostgreSQL sekali pakai; semuanya dibatalkan (rollback).
-- Dijalankan: psql -v ON_ERROR_STOP=1 -f supabase/tests/komplain_pelanggan.sql (rantai migrasi penuh + kandidat). Setiap pernyataan benar = NOTICE BP_PASS.
-- Dibuktikan: RLS per cabang untuk tiap peran, Admin Online ditolak di tiap fungsi/tabel, alur status sah/tak sah, jejak tak dapat diubah,
-- kunci anti-dobel, nomor unik, angka dashboard = hitung manual pada data acak, penutupan wajib catatan+jenis, ACL, search_path, tanpa efek uang/stok.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;raise notice 'BP_PASS %',label;end$$;
create function pg_temp.eq(got text, want text, label text) returns void language plpgsql as $$begin
 if got is distinct from want then raise exception 'Assertion failed: % (got %, want %)',label,got,want;end if;raise notice 'BP_PASS %',label;end$$;
create function pg_temp.has(msg text, expected text, label text) returns void language plpgsql as $$begin
 if msg is null or position(expected in msg)=0 then raise exception 'Unexpected result for %: % (want %)',label,msg,expected;end if;raise notice 'BP_PASS %',label;end$$;
create function pg_temp.sv(stmt text) returns text language plpgsql as $$declare r text;begin begin execute stmt into r;return r;exception when others then return 'ERR:'||sqlerrm;end;end$$;
create function pg_temp.aa(r text) returns text language sql as $$select case when left(r,1)='{' then r::jsonb->>'already_applied' else r end$$;
create function pg_temp.today() returns date language sql as $$select (now() at time zone 'Asia/Jakarta')::date$$;

create temp table uu(n text primary key,id uuid not null);grant all on uu to public;
create temp table bb(n text primary key,id uuid not null);grant all on bb to public;
create temp table cc(n text primary key,id uuid not null,nomor text);grant all on cc to public;
create function pg_temp.u(n text) returns uuid language sql as $$select id from uu where uu.n=$1$$;
create function pg_temp.b(n text) returns uuid language sql as $$select id from bb where bb.n=$1$$;
create function pg_temp.c(n text) returns uuid language sql as $$select id from cc where cc.n=$1$$;
create function pg_temp.k(n text) returns uuid language sql as $$select md5('kpl-key-'||n)::uuid$$;
create function pg_temp.cat(n text) returns uuid language sql as $$select id from public.complaint_categories where name=$1$$;
-- jalankan sebagai pengguna terautentikasi (RLS berlaku); hasil skalar teks atau 'ERR:'||pesan
create function pg_temp.ra(un text, stmt text) returns text language plpgsql as $$
declare r text;
begin
 perform set_config('request.jwt.claim.sub',(select id::text from uu where uu.n=un),true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin execute 'set local role authenticated';execute stmt into r;execute 'reset role';return coalesce(r,'NULL');
 exception when others then execute 'reset role';return 'ERR:'||sqlerrm;end;
end$$;
-- DML/DDL sebagai pengguna: 'OK' atau 'ERR:'
create function pg_temp.da(un text, stmt text) returns text language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',(select id::text from uu where uu.n=un),true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin execute 'set local role authenticated';execute stmt;execute 'reset role';return 'OK';
 exception when others then execute 'reset role';return 'ERR:'||sqlerrm;end;
end$$;
-- sebagai anon
create function pg_temp.an(stmt text) returns text language plpgsql as $$
declare r text;begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','',true);
 begin execute 'set local role anon';execute stmt into r;execute 'reset role';return coalesce(r,'NULL');
 exception when others then execute 'reset role';return 'ERR:'||sqlerrm;end;
end$$;
-- buat komplain lewat RPC; o = jsonb pengganti bawaan. Mengembalikan jsonb teks atau ERR:
create function pg_temp.mk(un text, key text, br text, o jsonb default '{}') returns text language plpgsql as $$
declare s text;
begin
 s:=format('select public.komplain_buat(%L::uuid,%L::uuid,%L,%L::date,%L::uuid,%L::uuid,%L,%L,%L,%L,%L::uuid,%L,%L,%L,%L::uuid[],%L::numeric,%L::uuid,%L::jsonb)::text',
  pg_temp.k(key),pg_temp.b(br),coalesce(o->>'kanal','Petshop'),o->>'tanggal',o->>'cust',o->>'pet',o->>'nama',o->>'tel',o->>'refj',o->>'refn',
  pg_temp.cat(coalesce(o->>'kat','Pelayanan staf')),coalesce(o->>'tingkat','Sedang'),coalesce(o->>'desk','Kasir salah hitung kembalian'),o->>'harapan',
  (select array_agg(x::text) from jsonb_array_elements_text(o->'karyawan') x),o->>'nominal',o->>'petugas',coalesce(o->'lamp','[]'::jsonb)::text);
 return pg_temp.ra(un,s);
end$$;
-- buat + daftarkan label
create function pg_temp.mkc(label text, un text, br text, o jsonb default '{}') returns text language plpgsql as $$
declare r text;
begin
 r:=pg_temp.mk(un,label,br,o);
 if left(r,4)='ERR:' then raise exception 'fixture % gagal: %',label,r;end if;
 insert into cc(n,id,nomor) values(label,(r::jsonb->>'id')::uuid,r::jsonb->>'nomor');return r;
end$$;
create function pg_temp.st(un text, label text, status text, note text default null, tipe text default null, key text default null) returns text language sql as $$
 select pg_temp.ra(un,format('select public.komplain_ubah_status(%L::uuid,%L,%L,%L,%L::uuid)::text',pg_temp.c(label),status,note,tipe,pg_temp.k(coalesce(key,'st-'||label||'-'||status||'-'||coalesce(note,'')||coalesce(tipe,'')||random()::text)))) $$;
create function pg_temp.cnt(un text, tbl text) returns text language sql as $$select pg_temp.ra(un,'select count(*)::text from public.'||tbl)$$;
create function pg_temp.sysclear() returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','',true);end$$;
create function pg_temp.grant_kelola(role_ text) returns void language plpgsql as $$begin
 perform pg_temp.sysclear();
 insert into role_settings_private.action_policies as a(role,allowed) values(role_::public.user_role,array['crm.komplain_kelola'])
  on conflict(role) do update set allowed=(select array_agg(distinct x) from unnest(a.allowed||array['crm.komplain_kelola']) x);end$$;
create function pg_temp.revoke_kelola(role_ text) returns void language plpgsql as $$begin
 perform pg_temp.sysclear();
 update role_settings_private.action_policies set allowed=array_remove(allowed,'crm.komplain_kelola') where role=role_::public.user_role;
 delete from role_settings_private.action_policies where role=role_::public.user_role and cardinality(allowed)=0;end$$;

-- ── fixtures ──────────────────────────────────────────────────────────────────────────────
insert into auth.users(id,raw_user_meta_data) select ('c1000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,jsonb_build_object('full_name','KPL '||nm)
 from (values(1,'owner'),(2,'admin'),(3,'finance'),(4,'kasir petshop'),(5,'dokter klinik'),(6,'staff dua'),(7,'staff cabang X'),(8,'admin online'),(9,'staff nonaktif'),(10,'staff kelola'),(11,'admin terbatas')) v(n,nm);
insert into uu(n,id) values('own','c1000000-0000-4000-8000-000000000001'),('adm','c1000000-0000-4000-8000-000000000002'),('fin','c1000000-0000-4000-8000-000000000003'),
 ('kp','c1000000-0000-4000-8000-000000000004'),('kk','c1000000-0000-4000-8000-000000000005'),('st2','c1000000-0000-4000-8000-000000000006'),
 ('stx','c1000000-0000-4000-8000-000000000007'),('ao','c1000000-0000-4000-8000-000000000008'),('off','c1000000-0000-4000-8000-000000000009'),
 ('kl','c1000000-0000-4000-8000-000000000010'),('adm2','c1000000-0000-4000-8000-000000000011');
update profiles set role='OWNER',is_active=true where id=pg_temp.u('own');
update profiles set role='ADMIN',is_active=true where id in(pg_temp.u('adm'),pg_temp.u('adm2'));
update profiles set role='FINANCE',is_active=true where id=pg_temp.u('fin');
update profiles set role='STAFF',is_active=true where id in(pg_temp.u('kp'),pg_temp.u('st2'),pg_temp.u('stx'),pg_temp.u('kl'));
update profiles set role='DOCTOR',is_active=true where id=pg_temp.u('kk');
update profiles set role='ADMIN_ONLINE',is_active=true where id=pg_temp.u('ao');
update profiles set role='STAFF',is_active=false where id=pg_temp.u('off');
insert into bb(n,id) values('A','c2000000-0000-4000-8000-000000000001'),('K','c2000000-0000-4000-8000-000000000002'),('X','c2000000-0000-4000-8000-000000000003'),('Z','c2000000-0000-4000-8000-000000000004');
insert into branches(id,code,name,type,is_active) values(pg_temp.b('A'),'KPLA','KPL petshop A','PETSHOP',true),(pg_temp.b('K'),'KPLK','KPL klinik K','KLINIK',true),
 (pg_temp.b('X'),'KPLX','KPL cabang X','PETSHOP',true),(pg_temp.b('Z'),'KPLZ','KPL cabang tutup','PETSHOP',false);
insert into user_branches(user_id,branch_id) values(pg_temp.u('kp'),pg_temp.b('A')),(pg_temp.u('kk'),pg_temp.b('K')),(pg_temp.u('st2'),pg_temp.b('A')),(pg_temp.u('stx'),pg_temp.b('X')),
 (pg_temp.u('ao'),pg_temp.b('A')),(pg_temp.u('off'),pg_temp.b('A')),(pg_temp.u('kl'),pg_temp.b('A')),(pg_temp.u('adm2'),pg_temp.b('A')),
 (pg_temp.u('own'),pg_temp.b('A')),(pg_temp.u('adm'),pg_temp.b('A')),(pg_temp.u('fin'),pg_temp.b('A'));
insert into employees(id,nama,jabatan,branch_id,status) values
 ('c3000000-0000-4000-8000-000000000001','Kasir Fiktif Satu','Kasir',pg_temp.b('A'),'Aktif'),('c3000000-0000-4000-8000-000000000002','Dokter Fiktif Dua','Dokter Hewan',pg_temp.b('K'),'Aktif'),
 ('c3000000-0000-4000-8000-000000000003','Karyawan Keluar Fiktif','Kasir',pg_temp.b('A'),'Aktif');
alter table employees disable trigger user;update employees set trashed_at=now() where id='c3000000-0000-4000-8000-000000000003';alter table employees enable trigger user;
insert into customers(id,name,phone) values('c4000000-0000-4000-8000-000000000001','Pelanggan Fiktif Satu','081200000001'),('c4000000-0000-4000-8000-000000000002','Pelanggan Fiktif Dua','081200000002');
insert into pets(id,customer_id,name) values('c5000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','Mochi Fiktif'),('c5000000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000002','Luna Fiktif');
-- berkas lampiran: sejak migrasi 20261211200000 lampiran harus ADA di storage.objects dan milik pengunggah (di sini hanya fixture; uji kepemilikan ada di komplain_lampiran_storage.sql)
alter table storage.objects add column if not exists owner_id text;
insert into storage.objects(bucket_id,name,owner,owner_id) select 'dokumen',n,pg_temp.u('kp'),pg_temp.u('kp')::text from unnest(array['komplain/foto1.jpg','komplain/foto2.png','komplain/bukti.jpg']) n;
-- jumlah baris keuangan/stok sebelum semua uji (harus sama sesudahnya)
create temp table money0 as select (select count(*) from journal_entries) je,(select count(*) from journal_lines) jl,(select count(*) from stock_moves) sm,(select count(*) from expenses) ex,
 (select count(*) from invoices) iv,(select count(*) from sales) sa,(select count(*) from point_ledger) pl;

-- ── S0. struktur, ACL, data awal ──────────────────────────────────────────────────────────
select pg_temp.eq((select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('complaint_categories','complaint_settings','complaint_counters','complaint_config_log','customer_complaints','customer_complaint_history','customer_complaint_files') and c.relrowsecurity),'7','S0 tujuh tabel baru semuanya ber-RLS');
select pg_temp.eq((select count(*)::text from public.complaint_categories),'10','S0 sepuluh kategori awal');
select pg_temp.eq((select string_agg(name,'|' order by sort_order) from public.complaint_categories),
 'Pelayanan staf|Dokter/Medis|Obat/Produk (kualitas/expired)|Harga/Tagihan/Kasir (salah hitung, double bayar)|Antrian/Waktu tunggu|Kebersihan/Fasilitas|Grooming|Rawat Inap|Pengiriman/Online|Lainnya','S0 daftar kategori awal sesuai permintaan');
select pg_temp.eq((select overdue_days::text from public.complaint_settings),'3','S0 batas terlambat bawaan 3 hari');
select pg_temp.ok(exists(select 1 from role_settings_private.action_catalog where id='crm.komplain_kelola' and enforced and "group"='CRM') and exists(select 1 from role_settings_private.action_modules where id='crm.komplain_kelola' and module_id='crm'),'S0 izin Akses Grup crm.komplain_kelola terdaftar (modul CRM)');
select pg_temp.eq((select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'komplain\_%' and p.proname not like 'komplain\_berkas\_%'),'13','S0 tepat 13 fungsi public (fungsi kebijakan storage komplain_berkas_* dihitung di komplain_lampiran_storage.sql)');
select pg_temp.ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','clinic_private') and p.proname like 'komplain\_%' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))),'S0 anon dan service_role tidak bisa menjalankan fungsi komplain');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'komplain\_%' and not has_function_privilege('authenticated',p.oid,'execute')),'S0 authenticated bisa menjalankan semua fungsi public komplain');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace='clinic_private'::regnamespace and p.proname like 'komplain\_%' and has_function_privilege('authenticated',p.oid,'execute')),'S0 fungsi clinic_private komplain tidak terbuka untuk klien');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace in('public'::regnamespace,'clinic_private'::regnamespace) and p.proname like 'komplain\_%' and p.prosecdef and not (coalesce(p.proconfig,'{}') @> array['search_path=""'])),'S0 semua fungsi SECURITY DEFINER ber-search_path kosong');
select pg_temp.ok(not exists(select 1 from pg_class c where c.relnamespace='public'::regnamespace and (c.relname like 'complaint\_%' or c.relname like 'customer\_complaint%') and (has_table_privilege('anon',c.oid,'select,insert,update,delete,truncate') or has_table_privilege('service_role',c.oid,'select,insert,update,delete,truncate') or has_table_privilege('authenticated',c.oid,'insert,update,delete,truncate'))),'S0 tabel baru: tanpa hak anon/service_role dan klien tidak punya hak tulis');
select pg_temp.ok(not has_table_privilege('authenticated','public.complaint_counters','select') and not has_table_privilege('authenticated','public.complaint_config_log','select'),'S0 penghitung nomor dan log konfigurasi tidak terbaca klien');
select pg_temp.ok((select count(*) from pg_trigger g where g.tgname='zz_admin_online_write_fence' and g.tgrelid in('public.customer_complaints'::regclass,'public.customer_complaint_history'::regclass,'public.customer_complaint_files'::regclass,'public.complaint_categories'::regclass,'public.complaint_settings'::regclass,'public.complaint_counters'::regclass,'public.complaint_config_log'::regclass))=7,'S0 pagar tulis Admin Online terpasang di 7 tabel');
select pg_temp.ok((select count(*) from pg_policy p where p.polname='admin_online_fence_r' and not p.polpermissive and p.polrelid in('public.customer_complaints'::regclass,'public.customer_complaint_history'::regclass,'public.customer_complaint_files'::regclass,'public.complaint_categories'::regclass,'public.complaint_settings'::regclass,'public.complaint_counters'::regclass,'public.complaint_config_log'::regclass))=7,'S0 pagar baca RESTRICTIVE Admin Online di 7 tabel');
select pg_temp.eq(pg_temp.an('select public.komplain_boleh()::text'),'ERR:permission denied for function komplain_boleh','S0 anon tidak boleh memanggil komplain_boleh');
select pg_temp.has(pg_temp.an('select public.komplain_dashboard(null,null,null,null,null,null,null,null)::text'),'permission denied','S0 anon tidak boleh memanggil dashboard');
select pg_temp.has(pg_temp.an('select count(*)::text from public.customer_complaints'),'permission denied','S0 anon tidak boleh membaca tabel komplain');

-- ── S1. peran + visibilitas dasar (fungsi pembantu) ───────────────────────────────────────
select pg_temp.eq(pg_temp.ra('ao','select clinic_private.komplain_actor()'),'ERR:permission denied for schema clinic_private','S1 klien tidak bisa memanggil fungsi privat langsung');
select pg_temp.eq(pg_temp.sv('select set_config(''request.jwt.claim.sub'','''||pg_temp.u('ao')||''',true)')||'|'||coalesce(pg_temp.sv('select clinic_private.komplain_actor()'),'NULL'),pg_temp.u('ao')||'|NULL','S1 Admin Online: komplain_actor() = NULL');
select pg_temp.eq(coalesce(pg_temp.sv('select public.komplain_boleh()::text'),'NULL'),'false','S1 Admin Online: komplain_boleh() = false');
select pg_temp.eq(pg_temp.sv('select public.komplain_visible('''||pg_temp.b('A')||''','''||pg_temp.u('ao')||''','''||pg_temp.u('ao')||''')::text'),'false','S1 Admin Online: komplain_visible() = false walau pembuat sendiri');
select pg_temp.eq(pg_temp.sv('select set_config(''request.jwt.claim.sub'','''||pg_temp.u('off')||''',true)')||'|'||coalesce(pg_temp.sv('select clinic_private.komplain_actor()'),'NULL'),pg_temp.u('off')||'|NULL','S1 akun nonaktif: komplain_actor() = NULL');
select pg_temp.eq(pg_temp.sv('select set_config(''request.jwt.claim.sub'','''||pg_temp.u('own')||''',true)')||'|'||coalesce(pg_temp.sv('select clinic_private.komplain_actor()'),'NULL'),pg_temp.u('own')||'|OWNER','S1 Owner terdeteksi');
select pg_temp.eq(pg_temp.sv('select set_config(''request.jwt.claim.sub'','''||pg_temp.u('kp')||''',true)')||'|'||coalesce(pg_temp.sv('select clinic_private.komplain_actor()'),'NULL'),pg_temp.u('kp')||'|STAFF','S1 STAFF terdeteksi');
select pg_temp.eq(pg_temp.sv('select set_config(''request.jwt.claim.sub'','''||''||''',true)')||'|'||coalesce(pg_temp.sv('select clinic_private.komplain_actor()'),'NULL'),'|NULL','S1 tanpa sesi: komplain_actor() = NULL');

-- ── S2. membuat komplain ──────────────────────────────────────────────────────────────────
select pg_temp.mkc('c1','kp','A',jsonb_build_object('kanal','Petshop','tingkat','Sedang','desk','Kembalian kurang Rp5.000','kat','Harga/Tagihan/Kasir (salah hitung, double bayar)'));
select pg_temp.eq((select nomor from cc where n='c1'),'KMP-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMM')||'-0001','S2 nomor pertama KMP-YYYYMM-0001');
select pg_temp.mkc('c2','kp','A',jsonb_build_object('kanal','Grooming','tingkat','Tinggi','desk','Hasil grooming kurang rapi','kat','Grooming','petugas',pg_temp.u('st2')::text));
select pg_temp.eq((select nomor from cc where n='c2'),'KMP-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMM')||'-0002','S2 nomor kedua berurutan');
select pg_temp.eq((select status from customer_complaints where id=pg_temp.c('c1')),'Baru','S2 status awal Baru');
select pg_temp.eq((select count(*)::text from customer_complaint_history where complaint_id=pg_temp.c('c1') and kind='dibuat' and seq=1 and actor=pg_temp.u('kp') and to_status='Baru'),'1','S2 jejak "dibuat" tercatat dengan pelaku');
select pg_temp.eq((select created_by::text from customer_complaints where id=pg_temp.c('c1')),pg_temp.u('kp')::text,'S2 pembuat = akun yang memanggil');
select pg_temp.eq((select complaint_date::text from customer_complaints where id=pg_temp.c('c1')),pg_temp.today()::text,'S2 tanggal bawaan = hari ini (WIB)');
-- idempoten
select pg_temp.eq(pg_temp.aa(pg_temp.mk('kp','c1','A',jsonb_build_object('kanal','Petshop','tingkat','Sedang','desk','Kembalian kurang Rp5.000','kat','Harga/Tagihan/Kasir (salah hitung, double bayar)'))),'true','S2 ulang dengan kunci sama = sudah diterapkan');
select pg_temp.eq((select count(*)::text from customer_complaints where created_by=pg_temp.u('kp')),'2','S2 ulang kunci sama tidak menggandakan baris');
select pg_temp.has(pg_temp.mk('kp','c1','A',jsonb_build_object('desk','Isi lain sama sekali')),'KOMPLAIN_KUNCI_DIPAKAI','S2 kunci sama dengan isi berbeda ditolak');
select pg_temp.eq(left(pg_temp.mk('st2','c1','A'),1),'{','S2 kunci yang sama oleh akun lain = komplain baru (kunci per pembuat)');
select pg_temp.has(pg_temp.ra('kp',format('select public.komplain_buat(null,%L::uuid,''Petshop'',null,null,null,null,null,null,null,%L::uuid,''Sedang'',''Isi komplain ok'',null,null,null,null,''[]'')::text',pg_temp.b('A'),pg_temp.cat('Grooming'))),'KOMPLAIN_KUNCI','S2 kunci kosong ditolak');
-- validasi masukan
select pg_temp.has(pg_temp.mk('kp','v1','X'),'KOMPLAIN_CABANG_DITOLAK','S2 STAFF tidak bisa membuat di cabang yang bukan miliknya');
select pg_temp.has(pg_temp.mk('own','v2','Z'),'KOMPLAIN_CABANG','S2 cabang nonaktif ditolak');
select pg_temp.has(pg_temp.mk('kp','v3','A',jsonb_build_object('kanal','Tokopedia')),'KOMPLAIN_KANAL','S2 kanal tak dikenal ditolak');
select pg_temp.has(pg_temp.mk('kp','v4','A',jsonb_build_object('tingkat','Parah')),'KOMPLAIN_TINGKAT','S2 tingkat tak dikenal ditolak');
select pg_temp.has(pg_temp.mk('kp','v5','A',jsonb_build_object('tanggal',(pg_temp.today()+1)::text)),'KOMPLAIN_TANGGAL','S2 tanggal masa depan ditolak');
select pg_temp.has(pg_temp.mk('kp','v6','A',jsonb_build_object('tanggal',(pg_temp.today()-181)::text)),'KOMPLAIN_TANGGAL','S2 tanggal lebih dari 180 hari lalu ditolak');
select pg_temp.has(pg_temp.mk('kp','v7','A',jsonb_build_object('desk','abc')),'KOMPLAIN_DESKRIPSI','S2 isi komplain terlalu pendek ditolak');
select pg_temp.has(pg_temp.mk('kp','v8','A',jsonb_build_object('desk','     ')),'KOMPLAIN_DESKRIPSI','S2 isi komplain spasi saja ditolak');
select pg_temp.has(pg_temp.mk('kp','v9','A',jsonb_build_object('nominal','-5')),'KOMPLAIN_NOMINAL','S2 nilai rupiah negatif ditolak');
select pg_temp.has(pg_temp.mk('kp','v10','A',jsonb_build_object('refj','Invoice klinik')),'KOMPLAIN_REFERENSI','S2 jenis dokumen tanpa nomor ditolak');
select pg_temp.has(pg_temp.mk('kp','v11','A',jsonb_build_object('refj','Bon tulis','refn','1')),'KOMPLAIN_REFERENSI','S2 jenis dokumen tak dikenal ditolak');
select pg_temp.has(pg_temp.mk('kp','v12','A',jsonb_build_object('cust','c4000000-0000-4000-8000-000000000001','pet','c5000000-0000-4000-8000-000000000002')),'KOMPLAIN_HEWAN','S2 hewan milik pelanggan lain ditolak');
select pg_temp.has(pg_temp.mk('kp','v13','A',jsonb_build_object('cust','c4000000-0000-4000-8000-0000000000ff')),'KOMPLAIN_PELANGGAN','S2 pelanggan tidak ada ditolak');
select pg_temp.has(pg_temp.mk('kp','v14','A',jsonb_build_object('karyawan',jsonb_build_array('c3000000-0000-4000-8000-0000000000ff'))),'KOMPLAIN_KARYAWAN','S2 karyawan tidak ada ditolak');
select pg_temp.has(pg_temp.mk('kp','v15','A',jsonb_build_object('karyawan',jsonb_build_array('c3000000-0000-4000-8000-000000000003'))),'KOMPLAIN_KARYAWAN','S2 karyawan yang sudah dihapus ditolak');
select pg_temp.has(pg_temp.mk('kp','v16','A',jsonb_build_object('petugas',pg_temp.u('stx')::text)),'KOMPLAIN_PETUGAS','S2 petugas tanpa akses cabang ditolak');
select pg_temp.has(pg_temp.mk('kp','v17','A',jsonb_build_object('petugas',pg_temp.u('off')::text)),'KOMPLAIN_PETUGAS','S2 petugas nonaktif ditolak');
select pg_temp.has(pg_temp.mk('kp','v18','A',jsonb_build_object('petugas',pg_temp.u('ao')::text)),'KOMPLAIN_PETUGAS','S2 petugas Admin Online ditolak');
select pg_temp.has(pg_temp.mk('kp','v19','A',jsonb_build_object('lamp','[{"path":"dokumen/x.jpg","nama":"x.jpg","mime":"image/jpeg","ukuran":10}]'::jsonb)),'KOMPLAIN_LAMPIRAN','S2 lampiran di luar folder komplain/ ditolak');
select pg_temp.has(pg_temp.mk('kp','v20','A',jsonb_build_object('lamp','[{"path":"komplain/../x.jpg","nama":"x.jpg","mime":"image/jpeg","ukuran":10}]'::jsonb)),'KOMPLAIN_LAMPIRAN','S2 lampiran dengan .. ditolak');
select pg_temp.has(pg_temp.mk('kp','v21','A',jsonb_build_object('lamp','[{"path":"komplain/a.jpg","nama":"a.jpg","ukuran":99999999}]'::jsonb)),'KOMPLAIN_LAMPIRAN','S2 lampiran > 10 MB ditolak');
select pg_temp.has(pg_temp.mk('kp','v22','A',jsonb_build_object('lamp','[{"path":"komplain/a.jpg","nama":"a.jpg"},{"path":"komplain/a.jpg","nama":"a2.jpg"}]'::jsonb)),'KOMPLAIN_LAMPIRAN','S2 lampiran kembar ditolak');
select pg_temp.has(pg_temp.mk('kp','v23','A',jsonb_build_object('lamp',(select jsonb_agg(jsonb_build_object('path','komplain/f'||g||'.jpg','nama','f'||g)) from generate_series(1,11) g))),'KOMPLAIN_LAMPIRAN','S2 lebih dari 10 lampiran ditolak');
select pg_temp.has(pg_temp.mk('ao','v24','A'),'ADMIN_ONLINE_FUNCTION_DENIED','S2 Admin Online tidak bisa membuat komplain');
select pg_temp.has(pg_temp.mk('off','v25','A'),'KOMPLAIN_DITOLAK','S2 akun nonaktif tidak bisa membuat komplain');
select pg_temp.eq((select count(*)::text from customer_complaints),'3','S2 semua penolakan tidak meninggalkan baris');
-- kategori nonaktif
update complaint_categories set is_active=false where name='Lainnya';
select pg_temp.has(pg_temp.mk('kp','v26','A',jsonb_build_object('kat','Lainnya')),'KOMPLAIN_KATEGORI','S2 kategori nonaktif tidak bisa dipilih');
update complaint_categories set is_active=true where name='Lainnya';
-- tautan pelanggan, hewan, dokumen, karyawan, lampiran, tanggal mundur
select pg_temp.mkc('c3','kp','A',jsonb_build_object('cust','c4000000-0000-4000-8000-000000000001','pet','c5000000-0000-4000-8000-000000000001','refj','Struk petshop','refn','STR-001',
  'karyawan',jsonb_build_array('c3000000-0000-4000-8000-000000000001'),'nominal','150000','harapan','Minta uang kembali','tanggal',(pg_temp.today()-3)::text,
  'lamp','[{"path":"komplain/foto1.jpg","nama":"foto1.jpg","mime":"image/jpeg","ukuran":2048},{"path":"komplain/foto2.png","nama":"foto2.png","mime":"image/png","ukuran":4096}]'::jsonb,'kanal','Online Shopee','tingkat','Kritis','kat','Grooming'));
select pg_temp.eq((select customer_name||'|'||customer_phone||'|'||pet_name from customer_complaints where id=pg_temp.c('c3')),'Pelanggan Fiktif Satu|081200000001|Mochi Fiktif','S2 nama/telepon/hewan diambil dari pelanggan terpilih');
select pg_temp.eq((select ref_kind||'|'||ref_no||'|'||amount_at_stake::text||'|'||desired_resolution from customer_complaints where id=pg_temp.c('c3')),'Struk petshop|STR-001|150000.00|Minta uang kembali','S2 dokumen, nilai rupiah, harapan tersimpan');
select pg_temp.eq((select involved::text from customer_complaints where id=pg_temp.c('c3')),'[{"id": "c3000000-0000-4000-8000-000000000001", "name": "Kasir Fiktif Satu"}]','S2 karyawan terlibat tersimpan dengan nama');
select pg_temp.eq((select count(*)::text from customer_complaint_files where complaint_id=pg_temp.c('c3')),'2','S2 dua lampiran tersimpan');
select pg_temp.eq((select complaint_date::text from customer_complaints where id=pg_temp.c('c3')),(pg_temp.today()-3)::text,'S2 tanggal mundur 3 hari tersimpan');
select pg_temp.ok((select complained_at<now() and (complained_at at time zone 'Asia/Jakarta')::date=pg_temp.today()-3 from customer_complaints where id=pg_temp.c('c3')),'S2 waktu komplain mundur konsisten dengan tanggalnya');
select pg_temp.eq((select kind||'|'||(changes->>'tingkat') from customer_complaint_history where complaint_id=pg_temp.c('c3') and seq=1),'dibuat|Kritis','S2 jejak awal memuat ringkasan tingkat');
select pg_temp.mkc('c4','own','K',jsonb_build_object('kanal','Klinik','tingkat','Rendah','kat','Dokter/Medis','desk','Dokter terlalu singkat menjelaskan'));
select pg_temp.mkc('c5','kk','K',jsonb_build_object('kanal','Rawat Inap','tingkat','Tinggi','kat','Rawat Inap','desk','Info rawat inap telat diberikan','karyawan',jsonb_build_array('c3000000-0000-4000-8000-000000000002')));
select pg_temp.mkc('c6','stx','X',jsonb_build_object('kanal','Petshop','desk','Barang expired di rak','kat','Obat/Produk (kualitas/expired)'));
select pg_temp.mkc('c7','adm','A',jsonb_build_object('kanal','Lainnya','desk','Antrian lama sekali','kat','Antrian/Waktu tunggu','petugas',pg_temp.u('kl')::text));
select pg_temp.eq(left(pg_temp.mk('fin','f1','K'),1),'{','S2 FINANCE bisa membuat di cabang yang bisa diaksesnya');
select pg_temp.eq(left(pg_temp.mk('own','o1','X'),1),'{','S2 Owner bisa membuat di semua cabang');
select pg_temp.eq(left(pg_temp.mk('adm','a1','X'),1),'{','S2 ADMIN (akses semua cabang bawaan) bisa membuat di cabang mana pun');
select pg_temp.eq((select count(distinct complaint_no)::text||'/'||count(*)::text from customer_complaints),'11/11','S2 11 komplain = 11 nomor berbeda');
select pg_temp.eq((select string_agg(right(complaint_no,4),',' order by complaint_no) from customer_complaints),'0001,0002,0003,0004,0005,0006,0007,0008,0009,0010,0011','S2 nomor berurutan tanpa celah');
select pg_temp.eq((select last_no::text from complaint_counters where period=to_char(now() at time zone 'Asia/Jakarta','YYYYMM')),'11','S2 penghitung bulan ini = 11');

-- ── S3. RLS: siapa melihat apa (tabel langsung) ───────────────────────────────────────────
-- komplain: c1 kp/A, c2 kp/A->st2, c3 kp/A, c4 own/K, c5 kk/K, c6 stx/X, c7 adm/A->kl, + f1 fin/K, o1 own/X, a1 adm/X (12 total, st2 membuat satu lagi di c1-kunci-sama)
select pg_temp.eq(pg_temp.cnt('own','customer_complaints'),'11','S3 Owner melihat semua cabang (11)');
select pg_temp.eq(pg_temp.cnt('adm','customer_complaints'),'11','S3 ADMIN melihat semua cabang (11)');
select pg_temp.eq(pg_temp.cnt('fin','customer_complaints'),'11','S3 FINANCE melihat semua cabang (11)');
select pg_temp.eq(pg_temp.cnt('kp','customer_complaints'),'3','S3 kasir petshop hanya melihat yang dibuatnya (c1,c2,c3)');
select pg_temp.eq(pg_temp.ra('kp','select string_agg(complaint_no,'','' order by complaint_no) from public.customer_complaints where branch_id<>'||quote_literal(pg_temp.b('A'))),'NULL','S3 kasir petshop tidak melihat cabang lain');
select pg_temp.eq(pg_temp.cnt('st2','customer_complaints'),'2','S3 staff dua melihat miliknya (1 dibuat) + yang ditugaskan (c2) = 2');
select pg_temp.eq(pg_temp.cnt('kl','customer_complaints'),'1','S3 staff kelola (tanpa izin) hanya melihat yang ditugaskan padanya (c7)');
select pg_temp.eq(pg_temp.cnt('kk','customer_complaints'),'1','S3 dokter klinik hanya melihat yang dibuatnya (c5)');
select pg_temp.eq(pg_temp.cnt('stx','customer_complaints'),'1','S3 staff cabang X hanya melihat c6');
select pg_temp.eq(pg_temp.cnt('ao','customer_complaints'),'0','S3 Admin Online tidak melihat satu pun komplain');
select pg_temp.eq(pg_temp.cnt('off','customer_complaints'),'0','S3 akun nonaktif tidak melihat komplain');
select pg_temp.eq(pg_temp.cnt('kp','customer_complaint_history'),'3','S3 riwayat kasir petshop = 3 baris (hanya komplainnya)');
select pg_temp.eq(pg_temp.cnt('kp','customer_complaint_files'),'2','S3 lampiran kasir petshop = 2 (c3)');
select pg_temp.eq(pg_temp.cnt('kk','customer_complaint_files'),'0','S3 dokter klinik tidak melihat lampiran komplain lain');
select pg_temp.eq(pg_temp.cnt('ao','customer_complaint_history'),'0','S3 Admin Online tidak melihat riwayat');
select pg_temp.eq(pg_temp.cnt('ao','customer_complaint_files'),'0','S3 Admin Online tidak melihat lampiran');
select pg_temp.eq(pg_temp.cnt('ao','complaint_categories'),'0','S3 Admin Online tidak melihat kategori');
select pg_temp.eq(pg_temp.cnt('ao','complaint_settings'),'0','S3 Admin Online tidak melihat pengaturan');
select pg_temp.eq(pg_temp.cnt('kp','complaint_categories'),'10','S3 kasir melihat 10 kategori');
select pg_temp.eq(pg_temp.cnt('off','complaint_categories'),'0','S3 akun nonaktif tidak melihat kategori');
select pg_temp.has(pg_temp.cnt('kp','complaint_counters'),'permission denied','S3 klien tidak bisa membaca penghitung nomor');
select pg_temp.has(pg_temp.cnt('own','complaint_config_log'),'permission denied','S3 Owner pun tidak membaca log konfigurasi lewat klien');
-- izin kelola untuk STAFF: melihat semua di cabangnya, bukan cabang lain
select pg_temp.grant_kelola('STAFF');
select pg_temp.eq(pg_temp.cnt('st2','customer_complaints'),'5','S3 staff dengan izin kelola melihat semua komplain cabang A (c1,c2,c3,c7,+1)');
select pg_temp.eq(pg_temp.ra('st2','select count(*)::text from public.customer_complaints where branch_id<>'||quote_literal(pg_temp.b('A'))),'0','S3 izin kelola tidak membuka cabang lain');
select pg_temp.eq(pg_temp.cnt('stx','customer_complaints'),'3','S3 staff cabang X dengan izin kelola melihat 3 komplain cabang X (c6,o1,a1)');
select pg_temp.eq(pg_temp.cnt('off','customer_complaints'),'0','S3 akun nonaktif tetap tidak melihat walau perannya punya izin');
select pg_temp.eq(pg_temp.cnt('ao','customer_complaints'),'0','S3 Admin Online tetap nol');
select pg_temp.revoke_kelola('STAFF');
select pg_temp.eq(pg_temp.cnt('st2','customer_complaints'),'2','S3 izin dicabut: kembali melihat hanya miliknya');
-- ADMIN dibatasi cabang (kemampuan peran) -> hanya cabang yang ditugaskan
select pg_temp.sysclear();
insert into role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,false);
select pg_temp.eq(pg_temp.cnt('adm2','customer_complaints'),'5','S3 ADMIN tanpa akses semua cabang hanya melihat cabang yang ditugaskan (A)');
select pg_temp.has(pg_temp.mk('adm2','adm2k','K'),'KOMPLAIN_CABANG_DITOLAK','S3 ADMIN tanpa akses semua cabang tidak bisa membuat di cabang K');
select pg_temp.sysclear();
delete from role_capabilities where role='ADMIN';
select pg_temp.eq(pg_temp.cnt('adm2','customer_complaints'),'11','S3 kemampuan peran dikembalikan: ADMIN melihat semua');
-- tulis langsung ditolak untuk semua
select pg_temp.has(pg_temp.da('own','insert into public.customer_complaints(complaint_no,branch_id,channel,complained_at,complaint_date,category_id,severity,description,request_key,request_hash) select ''KMP-X-1'',id,''Petshop'',now(),current_date,(select id from complaint_categories limit 1),''Rendah'',''abcdef'',gen_random_uuid(),''x'' from branches limit 1'),'permission denied','S3 Owner tidak bisa INSERT langsung ke komplain');
select pg_temp.has(pg_temp.da('own','update public.customer_complaints set severity=''Kritis'''),'permission denied','S3 Owner tidak bisa UPDATE langsung');
select pg_temp.has(pg_temp.da('own','delete from public.customer_complaints'),'permission denied','S3 Owner tidak bisa DELETE langsung');
select pg_temp.has(pg_temp.da('kp','insert into public.customer_complaint_history(complaint_id,branch_id,seq,kind,actor) select id,branch_id,99,''catatan'',created_by from customer_complaints limit 1'),'permission denied','S3 klien tidak bisa menulis riwayat langsung');
select pg_temp.has(pg_temp.da('kp','insert into public.customer_complaint_files(complaint_id,branch_id,path,nama,uploaded_by) select id,branch_id,''komplain/z.jpg'',''z'',created_by from customer_complaints limit 1'),'permission denied','S3 klien tidak bisa menulis lampiran langsung');
select pg_temp.has(pg_temp.da('own','update public.complaint_categories set name=''X'''),'permission denied','S3 Owner tidak bisa mengubah kategori langsung');
select pg_temp.has(pg_temp.da('own','delete from public.complaint_categories'),'permission denied','S3 kategori tidak bisa dihapus langsung');
select pg_temp.has(pg_temp.da('own','update public.complaint_settings set overdue_days=9'),'permission denied','S3 pengaturan tidak bisa diubah langsung');
select pg_temp.has(pg_temp.da('own','truncate public.customer_complaints'),'permission denied','S3 TRUNCATE ditolak');
select pg_temp.has(pg_temp.da('ao','insert into public.customer_complaints(complaint_no) values(''x'')'),'permission denied','S3 Admin Online tidak bisa menulis langsung');

-- ── S4. alur status ───────────────────────────────────────────────────────────────────────
select pg_temp.has(pg_temp.st('st2','c1','Dicek'),'KOMPLAIN_TIDAK_ADA','S4 akun yang tak melihat komplain mendapat "tidak ada" (bukan bocor)');
select pg_temp.has(pg_temp.st('adm','c1','Dicek'),'KOMPLAIN_BUKAN_PENANGANAN','S4 ADMIN yang bukan pembuat/petugas tanpa izin kelola ditolak');
select pg_temp.has(pg_temp.st('fin','c1','Dicek'),'KOMPLAIN_BUKAN_PENANGANAN','S4 FINANCE tanpa izin kelola ditolak');
select pg_temp.has(pg_temp.st('kp','c1','Baru'),'KOMPLAIN_STATUS','S4 tidak bisa kembali ke Baru');
select pg_temp.has(pg_temp.st('kp','c1','Sedang dicek'),'KOMPLAIN_STATUS','S4 status tak dikenal ditolak');
select pg_temp.has(pg_temp.st('ao','c1','Dicek'),'ADMIN_ONLINE_FUNCTION_DENIED','S4 Admin Online ditolak mengubah status');
select pg_temp.eq(left(pg_temp.st('kp','c1','Dicek'),1),'{','S4 pembuat boleh Baru -> Dicek');
select pg_temp.ok((select first_response_at is not null and first_response_at>=created_at from customer_complaints where id=pg_temp.c('c1')),'S4 respons pertama dicatat saat keluar dari Baru');
create temp table fr as select first_response_at t from customer_complaints where id=pg_temp.c('c1');
select pg_temp.has(pg_temp.st('kp','c1','Dicek'),'KOMPLAIN_STATUS_SAMA','S4 status sama ditolak');
select pg_temp.has(pg_temp.st('kp','c1','Baru'),'KOMPLAIN_STATUS','S4 Dicek -> Baru ditolak');
select pg_temp.eq(left(pg_temp.st('kp','c1','Dalam penanganan'),1),'{','S4 Dicek -> Dalam penanganan');
select pg_temp.has(pg_temp.st('kp','c1','Dicek'),'KOMPLAIN_TRANSISI','S4 Dalam penanganan -> Dicek ditolak');
select pg_temp.eq(left(pg_temp.st('kp','c1','Menunggu pelanggan'),1),'{','S4 Dalam penanganan -> Menunggu pelanggan');
select pg_temp.eq(left(pg_temp.st('kp','c1','Dalam penanganan'),1),'{','S4 Menunggu pelanggan -> Dalam penanganan');
select pg_temp.eq((select count(*)::text from customer_complaint_history where complaint_id=pg_temp.c('c1') and kind='status'),'4','S4 setiap perubahan status = satu baris jejak');
select pg_temp.eq((select string_agg(seq::text,',' order by seq) from customer_complaint_history where complaint_id=pg_temp.c('c1')),'1,2,3,4,5','S4 urutan jejak 1..5 tanpa celah');
select pg_temp.ok((select first_response_at=(select t from fr) from customer_complaints where id=pg_temp.c('c1')) and (select count(*)=1 from customer_complaint_history where complaint_id=pg_temp.c('c1') and from_status='Baru'),'S4 respons pertama tidak berubah oleh perubahan berikutnya');
-- penutupan
select pg_temp.has(pg_temp.st('kp','c1','Selesai'),'KOMPLAIN_CATATAN_PENYELESAIAN','S4 menutup tanpa catatan ditolak');
select pg_temp.has(pg_temp.st('kp','c1','Selesai','ok'),'KOMPLAIN_CATATAN_PENYELESAIAN','S4 catatan penyelesaian < 5 huruf ditolak');
select pg_temp.has(pg_temp.st('kp','c1','Selesai','Sudah dijelaskan ke pelanggan'),'KOMPLAIN_JENIS_PENYELESAIAN','S4 menutup tanpa jenis penyelesaian ditolak');
select pg_temp.has(pg_temp.st('kp','c1','Selesai','Sudah dijelaskan ke pelanggan','Ganti rugi'),'KOMPLAIN_JENIS_PENYELESAIAN','S4 jenis penyelesaian tak dikenal ditolak');
select pg_temp.has(pg_temp.st('kp','c1','Selesai','Sudah dijelaskan ke pelanggan','Tidak valid'),'KOMPLAIN_PENYELESAIAN_TIDAK_COCOK','S4 Selesai tidak boleh berjenis Tidak valid');
select pg_temp.has(pg_temp.st('kp','c1','Ditolak','Bukan komplain kami','Refund'),'KOMPLAIN_PENYELESAIAN_TIDAK_COCOK','S4 Ditolak wajib berjenis Tidak valid');
select pg_temp.has(pg_temp.st('kp','c1','Menunggu pelanggan','x','Refund'),'KOMPLAIN_JENIS_PENYELESAIAN_TERLARANG','S4 jenis penyelesaian hanya saat menutup');
select pg_temp.eq((select status from customer_complaints where id=pg_temp.c('c1')),'Dalam penanganan','S4 penolakan tidak mengubah status');
select pg_temp.eq(left(pg_temp.st('kp','c1','Selesai','Sudah dijelaskan ke pelanggan dan minta maaf','Maaf/penjelasan'),1),'{','S4 menutup dengan catatan + jenis berhasil');
select pg_temp.eq((select status||'|'||resolution_type||'|'||(closed_at is not null)::text||'|'||closed_by::text from customer_complaints where id=pg_temp.c('c1')),'Selesai|Maaf/penjelasan|true|'||pg_temp.u('kp')::text,'S4 kolom penutupan terisi');
select pg_temp.ok((select closed_at>=first_response_at from customer_complaints where id=pg_temp.c('c1')),'S4 waktu tutup setelah respons pertama');
select pg_temp.has(pg_temp.st('kp','c1','Dalam penanganan','buka lagi'),'KOMPLAIN_BUKA_KEMBALI','S4 pembuat tidak boleh membuka kembali komplain tertutup (butuh izin kelola)');
select pg_temp.has(pg_temp.st('own','c1','Dicek','alasan buka'),'KOMPLAIN_TRANSISI','S4 komplain tertutup hanya bisa dibuka ke Dalam penanganan');
select pg_temp.has(pg_temp.st('own','c1','Dalam penanganan'),'KOMPLAIN_ALASAN_BUKA','S4 membuka kembali wajib alasan');
select pg_temp.eq(left(pg_temp.st('own','c1','Dalam penanganan','Pelanggan kembali, masalah belum beres'),1),'{','S4 Owner membuka kembali dengan alasan');
select pg_temp.eq((select status||'|'||coalesce(closed_at::text,'-')||'|'||coalesce(resolution_type,'-')||'|'||coalesce(resolution_note,'-')||'|'||coalesce(closed_by::text,'-') from customer_complaints where id=pg_temp.c('c1')),'Dalam penanganan|-|-|-|-','S4 buka kembali mengosongkan kolom penutupan');
select pg_temp.eq(left(pg_temp.st('kp','c1','Ditolak','Setelah dicek bukan salah kami','Tidak valid'),1),'{','S4 Ditolak dengan jenis Tidak valid berhasil');
select pg_temp.eq((select status from customer_complaints where id=pg_temp.c('c1')),'Ditolak','S4 status Ditolak');
-- jalur lain: langsung ke Selesai dari Baru (c4), dari Dicek (c5)
select pg_temp.eq(left(pg_temp.st('own','c4','Selesai','Sudah dijelaskan dokternya','Edukasi staf'),1),'{','S4 Baru -> Selesai langsung diizinkan');
select pg_temp.ok((select first_response_at is not null from customer_complaints where id=pg_temp.c('c4')),'S4 menutup dari Baru ikut mengisi respons pertama');
select pg_temp.eq(left(pg_temp.st('kk','c5','Menunggu pelanggan'),1),'{','S4 Baru -> Menunggu pelanggan diizinkan');
select pg_temp.eq(left(pg_temp.st('kk','c5','Ditolak','Tidak sesuai kenyataan','Tidak valid'),1),'{','S4 Menunggu pelanggan -> Ditolak diizinkan');
-- petugas boleh mengubah status; izin kelola untuk ADMIN
select pg_temp.eq(left(pg_temp.st('st2','c2','Dicek'),1),'{','S4 petugas yang ditugaskan boleh mengubah status');
select pg_temp.grant_kelola('ADMIN');
select pg_temp.eq(left(pg_temp.st('adm','c3','Dicek'),1),'{','S4 ADMIN dengan izin kelola boleh mengubah komplain orang lain');
select pg_temp.eq(left(pg_temp.st('adm','c3','Selesai','Refund sudah dilakukan lewat layar refund','Refund'),1),'{','S4 ADMIN dengan izin kelola bisa menutup (jenis Refund hanya dicatat)');
select pg_temp.eq(left(pg_temp.st('adm','c3','Dalam penanganan','Dibuka lagi karena pelanggan masih keberatan'),1),'{','S4 pemegang izin kelola boleh membuka kembali');
select pg_temp.revoke_kelola('ADMIN');
select pg_temp.has(pg_temp.st('adm','c3','Menunggu pelanggan'),'KOMPLAIN_BUKAN_PENANGANAN','S4 izin dicabut: ADMIN kembali ditolak');
-- kunci anti-dobel status
select pg_temp.eq(pg_temp.aa(pg_temp.st('kp','c2','Dalam penanganan',null,null,'dobel-1')),'false','S4 permintaan status dengan kunci baru');
select pg_temp.eq(pg_temp.aa(pg_temp.st('kp','c2','Dalam penanganan',null,null,'dobel-1')),'true','S4 ulang kunci yang sama = sudah diterapkan, tanpa jejak ganda');
select pg_temp.eq((select count(*)::text from customer_complaint_history where complaint_id=pg_temp.c('c2') and request_key=pg_temp.k('dobel-1')),'1','S4 satu jejak untuk kunci anti-dobel');
select pg_temp.has(pg_temp.st('kp','c2','Menunggu pelanggan',null,null,'dobel-1'),'KOMPLAIN_KUNCI_DIPAKAI','S4 kunci yang sama dengan status berbeda ditolak');

-- ── S5. catatan dan ubah detail ───────────────────────────────────────────────────────────
select pg_temp.eq(left(pg_temp.ra('kp',format('select public.komplain_catatan(%L::uuid,''Pelanggan dihubungi via WA'',''[]'',%L::uuid)::text',pg_temp.c('c3'),pg_temp.k('cat1'))),1),'{','S5 pembuat menambah catatan');
select pg_temp.eq((select kind||'|'||note from customer_complaint_history where complaint_id=pg_temp.c('c3') order by seq desc limit 1),'catatan|Pelanggan dihubungi via WA','S5 catatan tercatat di jejak');
select pg_temp.eq(pg_temp.aa(pg_temp.ra('kp',format('select public.komplain_catatan(%L::uuid,''Pelanggan dihubungi via WA'',''[]'',%L::uuid)::text',pg_temp.c('c3'),pg_temp.k('cat1')))),'true','S5 catatan dengan kunci sama tidak ganda');
select pg_temp.has(pg_temp.ra('kp',format('select public.komplain_catatan(%L::uuid,''isi lain'',''[]'',%L::uuid)::text',pg_temp.c('c3'),pg_temp.k('cat1'))),'KOMPLAIN_KUNCI_DIPAKAI','S5 catatan kunci sama isi beda ditolak');
select pg_temp.has(pg_temp.ra('kp',format('select public.komplain_catatan(%L::uuid,'' '',''[]'',%L::uuid)::text',pg_temp.c('c3'),pg_temp.k('cat2'))),'KOMPLAIN_CATATAN','S5 catatan kosong tanpa lampiran ditolak');
select pg_temp.eq(left(pg_temp.ra('kp',format('select public.komplain_catatan(%L::uuid,null,%L::jsonb,%L::uuid)::text',pg_temp.c('c3'),'[{"path":"komplain/bukti.jpg","nama":"bukti.jpg","mime":"image/jpeg","ukuran":100}]',pg_temp.k('cat3'))),1),'{','S5 lampiran saja (tanpa catatan) diizinkan');
select pg_temp.eq((select count(*)::text from customer_complaint_files where complaint_id=pg_temp.c('c3')),'3','S5 lampiran bertambah menjadi 3');
select pg_temp.has(pg_temp.ra('st2',format('select public.komplain_catatan(%L::uuid,''coba'',''[]'',%L::uuid)::text',pg_temp.c('c3'),pg_temp.k('cat4'))),'KOMPLAIN_TIDAK_ADA','S5 akun yang tak melihat komplain tidak bisa menambah catatan');
select pg_temp.eq(left(pg_temp.ra('adm',format('select public.komplain_catatan(%L::uuid,''Dicatat oleh admin'',''[]'',%L::uuid)::text',pg_temp.c('c3'),pg_temp.k('cat5'))),1),'{','S5 ADMIN yang melihat komplain boleh menambah catatan');
select pg_temp.has(pg_temp.ra('kp',format('select public.komplain_catatan(%L::uuid,''catatan'',''[]'',%L::uuid)::text',pg_temp.c('c1'),pg_temp.k('cat6'))),'KOMPLAIN_SUDAH_DITUTUP','S5 komplain tertutup tidak menerima catatan');
select pg_temp.has(pg_temp.ra('ao',format('select public.komplain_catatan(%L::uuid,''catatan'',''[]'',%L::uuid)::text',pg_temp.c('c3'),pg_temp.k('cat7'))),'ADMIN_ONLINE_FUNCTION_DENIED','S5 Admin Online ditolak menambah catatan');
-- ubah detail
create function pg_temp.ud(un text, label text, kat text, sev text, petugas uuid, karyawan uuid[], nominal numeric, harapan text, refj text, refn text, note text, key text) returns text language sql as $$
 select pg_temp.ra(un,format('select public.komplain_ubah_detail(%L::uuid,%L::uuid,%L,%L::uuid,%L::uuid[],%L::numeric,%L,%L,%L,%L,%L::uuid)::text',pg_temp.c(label),pg_temp.cat(kat),sev,petugas,karyawan,nominal,harapan,refj,refn,note,pg_temp.k(key)))$$;
select pg_temp.has(pg_temp.ud('kp','c3','Grooming','Kritis',null,array['c3000000-0000-4000-8000-000000000001']::uuid[],150000,'Minta uang kembali','Struk petshop','STR-001','x','ud0'),'KOMPLAIN_ALASAN_UBAH','S5 ubah detail wajib alasan');
select pg_temp.has(pg_temp.ud('kp','c3','Grooming','Kritis',null,array['c3000000-0000-4000-8000-000000000001']::uuid[],150000,'Minta uang kembali','Struk petshop','STR-001','Tidak ada perubahan','ud1'),'KOMPLAIN_TIDAK_ADA_PERUBAHAN','S5 tanpa perubahan ditolak');
select pg_temp.eq(left(pg_temp.ud('kp','c3','Grooming','Tinggi',null,array['c3000000-0000-4000-8000-000000000001']::uuid[],175000,'Minta uang kembali','Struk petshop','STR-001','Tingkat diturunkan setelah dicek','ud2'),1),'{','S5 pembuat mengubah tingkat dan nilai rupiah');
select pg_temp.eq((select kind||'|'||(changes->'tingkat'->>'dari')||'>'||(changes->'tingkat'->>'ke')||'|'||(changes->'nominal'->>'ke')||'|'||(changes ? 'kategori')::text from customer_complaint_history where complaint_id=pg_temp.c('c3') order by seq desc limit 1),'ubah|Kritis>Tinggi|175000|false','S5 jejak memuat nilai lama/baru hanya untuk kolom yang berubah');
select pg_temp.eq((select severity||'|'||amount_at_stake::text from customer_complaints where id=pg_temp.c('c3')),'Tinggi|175000.00','S5 kolom komplain ikut berubah');
select pg_temp.eq(left(pg_temp.ud('kp','c3','Grooming','Tinggi',pg_temp.u('st2'),array['c3000000-0000-4000-8000-000000000001']::uuid[],175000,'Minta uang kembali','Struk petshop','STR-001','Tugaskan ke staff dua','ud3'),1),'{','S5 menugaskan petugas');
select pg_temp.eq((select kind from customer_complaint_history where complaint_id=pg_temp.c('c3') order by seq desc limit 1),'tugaskan','S5 hanya petugas berubah = jejak "tugaskan"');
select pg_temp.has(pg_temp.ud('kp','c3','Grooming','Tinggi',pg_temp.u('stx'),array['c3000000-0000-4000-8000-000000000001']::uuid[],175000,'Minta uang kembali','Struk petshop','STR-001','Tugaskan salah','ud4'),'KOMPLAIN_PETUGAS','S5 petugas tanpa akses cabang ditolak saat ubah');
select pg_temp.eq(left(pg_temp.ud('st2','c3','Grooming','Tinggi',pg_temp.u('st2'),array[]::uuid[],175000,'Minta uang kembali','Struk petshop','STR-001','Karyawan salah sebut','ud5'),1),'{','S5 petugas yang ditugaskan boleh mengubah');
select pg_temp.eq((select involved::text from customer_complaints where id=pg_temp.c('c3')),'[]','S5 daftar karyawan terlibat bisa dikosongkan');
select pg_temp.has(pg_temp.ud('adm','c3','Grooming','Rendah',pg_temp.u('st2'),array[]::uuid[],175000,'x','Struk petshop','STR-001','coba','ud6'),'KOMPLAIN_BUKAN_PENANGANAN','S5 ADMIN tanpa izin kelola tidak bisa mengubah komplain orang lain');
select pg_temp.has(pg_temp.ud('kp','c1','Grooming','Rendah',null,array[]::uuid[],null,null,null,null,'buka dulu','ud7'),'KOMPLAIN_SUDAH_DITUTUP','S5 komplain tertutup tidak bisa diubah');
select pg_temp.has(pg_temp.ud('kp','c2','Grooming','Berat',null,array[]::uuid[],null,null,null,null,'salah tingkat','ud8'),'KOMPLAIN_TINGKAT','S5 tingkat tak dikenal ditolak saat ubah');
select pg_temp.has(pg_temp.ud('ao','c2','Grooming','Rendah',null,array[]::uuid[],null,null,null,null,'coba','ud9'),'ADMIN_ONLINE_FUNCTION_DENIED','S5 Admin Online ditolak mengubah detail');
select pg_temp.eq(pg_temp.aa(pg_temp.ud('kp','c2','Grooming','Rendah',null,array[]::uuid[],null,null,null,null,'turun','ud10')),'false','S5 ubah dengan kunci baru');
select pg_temp.eq(pg_temp.aa(pg_temp.ud('kp','c2','Grooming','Rendah',null,array[]::uuid[],null,null,null,null,'turun','ud10')),'true','S5 ubah dengan kunci sama tidak ganda');

-- ── S6. kekekalan: jejak, lampiran, kolom asli, batasan data ─────────────────────────────
create function pg_temp.sup(stmt text) returns text language plpgsql as $$begin begin execute stmt;return 'OK';exception when others then return 'ERR:'||sqlerrm;end;end$$;
select pg_temp.has(pg_temp.sup('update public.customer_complaint_history set note=''diubah'''),'KOMPLAIN_JEJAK_TETAP','S6 jejak tidak bisa diubah (pemilik database)');
select pg_temp.has(pg_temp.sup('delete from public.customer_complaint_history'),'KOMPLAIN_JEJAK_TETAP','S6 jejak tidak bisa dihapus');
select pg_temp.has(pg_temp.sup('truncate public.customer_complaint_history'),'KOMPLAIN_JEJAK_TETAP','S6 jejak tidak bisa di-TRUNCATE');
select pg_temp.has(pg_temp.sup('update public.customer_complaint_files set nama=''x'''),'KOMPLAIN_JEJAK_TETAP','S6 lampiran tidak bisa diubah');
select pg_temp.has(pg_temp.sup('delete from public.customer_complaint_files'),'KOMPLAIN_JEJAK_TETAP','S6 lampiran tidak bisa dihapus');
select pg_temp.has(pg_temp.sup('truncate public.customer_complaint_files'),'KOMPLAIN_JEJAK_TETAP','S6 lampiran tidak bisa di-TRUNCATE');
select pg_temp.has(pg_temp.sup('delete from public.customer_complaints'),'KOMPLAIN_TETAP','S6 komplain tidak bisa dihapus');
select pg_temp.has(pg_temp.sup('truncate public.customer_complaints'),'ERR:','S6 komplain tidak bisa di-TRUNCATE (juga ditahan kunci asing dari riwayat)');
select pg_temp.has(pg_temp.sup('update public.customer_complaints set description=''ganti isi komplain'''),'KOMPLAIN_TETAP','S6 isi komplain asli tidak bisa diubah');
select pg_temp.has(pg_temp.sup('update public.customer_complaints set complaint_no=''KMP-000000-9999'''),'KOMPLAIN_TETAP','S6 nomor tidak bisa diubah');
select pg_temp.has(pg_temp.sup('update public.customer_complaints set branch_id=(select id from branches where code=''KPLX'')'),'KOMPLAIN_TETAP','S6 cabang tidak bisa dipindah');
select pg_temp.has(pg_temp.sup('update public.customer_complaints set created_by=(select id from profiles where role=''OWNER'' limit 1)'),'KOMPLAIN_TETAP','S6 pembuat tidak bisa diganti');
select pg_temp.has(pg_temp.sup('update public.customer_complaints set customer_name=''Orang Lain'''),'KOMPLAIN_TETAP','S6 nama pelanggan tidak bisa diganti');
-- batasan data (CHECK) menahan keadaan tak koheren walau ditulis langsung
select pg_temp.has(pg_temp.sup('update public.customer_complaints set status=''Selesai'' where id='''||pg_temp.c('c2')||''''),'complaints_closed_iff','S6 CHECK: Selesai tanpa waktu tutup ditolak');
select pg_temp.has(pg_temp.sup('update public.customer_complaints set status=''Selesai'',closed_at=now(),closed_by=created_by,resolution_type=''Refund'' where id='''||pg_temp.c('c2')||''''),'complaints_closed_fields','S6 CHECK: tutup tanpa catatan ditolak');
select pg_temp.has(pg_temp.sup('update public.customer_complaints set status=''Ditolak'',closed_at=now(),closed_by=created_by,resolution_type=''Refund'',resolution_note=''catatan ok'' where id='''||pg_temp.c('c2')||''''),'complaints_resolution_matches','S6 CHECK: Ditolak berjenis selain Tidak valid ditolak');
select pg_temp.has(pg_temp.sup('update public.customer_complaints set status=''Baru'' where id='''||pg_temp.c('c2')||''''),'complaints_first_response','S6 CHECK: status Baru dengan respons pertama terisi ditolak');
select pg_temp.has(pg_temp.sup('update public.customer_complaints set resolution_type=''Refund'' where id='''||pg_temp.c('c2')||''''),'complaints_closed_fields','S6 CHECK: jenis penyelesaian pada komplain terbuka ditolak');
select pg_temp.has(pg_temp.sup('update public.customer_complaints set severity=''Parah'' where id='''||pg_temp.c('c2')||''''),'customer_complaints_severity_check','S6 CHECK: tingkat di luar daftar ditolak');
select pg_temp.has(pg_temp.sup('insert into public.customer_complaint_files(complaint_id,branch_id,path,nama,uploaded_by) select id,branch_id,''dokumen/x.jpg'',''x'',created_by from customer_complaints limit 1'),'customer_complaint_files_path_check','S6 CHECK: lampiran di luar folder komplain/ ditolak');
select pg_temp.has(pg_temp.sup('insert into public.customer_complaint_history(complaint_id,branch_id,seq,kind,actor) select id,branch_id,1,''catatan'',created_by from customer_complaints limit 1'),'customer_complaint_history_complaint_id_seq_key','S6 nomor urut jejak unik per komplain');

-- ── S7. kategori & pengaturan ─────────────────────────────────────────────────────────────
select pg_temp.has(pg_temp.ra('kp','select public.komplain_kategori_simpan(null,''Parkir'',null,true)::text'),'KOMPLAIN_KELOLA_DITOLAK','S7 kasir tanpa izin tidak bisa menambah kategori');
select pg_temp.has(pg_temp.ra('adm','select public.komplain_kategori_simpan(null,''Parkir'',null,true)::text'),'KOMPLAIN_KELOLA_DITOLAK','S7 ADMIN tanpa izin kelola tidak bisa menambah kategori');
select pg_temp.has(pg_temp.ra('ao','select public.komplain_kategori_simpan(null,''Parkir'',null,true)::text'),'ADMIN_ONLINE_FUNCTION_DENIED','S7 Admin Online ditolak');
select pg_temp.eq(left(pg_temp.ra('own','select public.komplain_kategori_simpan(null,''Parkir & Akses'',null,true)::text'),1),'{','S7 Owner menambah kategori');
select pg_temp.eq((select sort_order::text from complaint_categories where name='Parkir & Akses'),'110','S7 kategori baru ditaruh di urutan akhir');
select pg_temp.has(pg_temp.ra('own','select public.komplain_kategori_simpan(null,''  parkir & akses '',null,true)::text'),'KOMPLAIN_KATEGORI_KEMBAR','S7 nama kembar (huruf besar/kecil, spasi) ditolak');
select pg_temp.has(pg_temp.ra('own','select public.komplain_kategori_simpan(null,''a'',null,true)::text'),'KOMPLAIN_KATEGORI_NAMA','S7 nama terlalu pendek ditolak');
select pg_temp.eq(left(pg_temp.mk('kp','kat1','A',jsonb_build_object('kat','Parkir & Akses')),1),'{','S7 kategori baru langsung bisa dipakai');
select pg_temp.eq(left(pg_temp.ra('own',format('select public.komplain_kategori_simpan(%L::uuid,''Parkir & Akses'',null,false)::text',pg_temp.cat('Parkir & Akses'))),1),'{','S7 Owner menonaktifkan kategori');
select pg_temp.has(pg_temp.mk('kp','kat2','A',jsonb_build_object('kat','Parkir & Akses')),'KOMPLAIN_KATEGORI','S7 kategori nonaktif tidak bisa dipilih untuk komplain baru');
select pg_temp.eq((select count(*)::text from complaint_config_log where kind='kategori'),'2','S7 setiap ubah kategori tercatat di log');
select pg_temp.grant_kelola('STAFF');
select pg_temp.eq(left(pg_temp.ra('kp','select public.komplain_kategori_simpan(null,''Jam buka'',null,true)::text'),1),'{','S7 staff dengan izin kelola boleh menambah kategori');
select pg_temp.revoke_kelola('STAFF');
select pg_temp.has(pg_temp.ra('kp','select public.komplain_pengaturan_simpan(5)::text'),'KOMPLAIN_KELOLA_DITOLAK','S7 kasir tidak bisa mengubah batas terlambat');
select pg_temp.has(pg_temp.ra('own','select public.komplain_pengaturan_simpan(0)::text'),'KOMPLAIN_HARI_TELAT','S7 batas 0 hari ditolak');
select pg_temp.has(pg_temp.ra('own','select public.komplain_pengaturan_simpan(91)::text'),'KOMPLAIN_HARI_TELAT','S7 batas 91 hari ditolak');
select pg_temp.eq(left(pg_temp.ra('own','select public.komplain_pengaturan_simpan(5)::text'),1),'{','S7 Owner mengubah batas terlambat ke 5');
select pg_temp.eq((select overdue_days::text from complaint_settings),'5','S7 pengaturan tersimpan');
select pg_temp.eq((select old_value::text||'>'||new_value::text from complaint_config_log where kind='pengaturan' order by created_at desc limit 1),'3>5','S7 log pengaturan memuat nilai lama dan baru');
select pg_temp.eq(left(pg_temp.ra('own','select public.komplain_pengaturan_simpan(3)::text'),1),'{','S7 batas dikembalikan ke 3');
update complaint_categories set is_active=true where name='Parkir & Akses';
select pg_temp.has(pg_temp.sup('update public.complaint_config_log set kind=''kategori'''),'KOMPLAIN_JEJAK_TETAP','S7 log konfigurasi tidak bisa diubah');
select pg_temp.has(pg_temp.sup('delete from public.complaint_config_log'),'KOMPLAIN_JEJAK_TETAP','S7 log konfigurasi tidak bisa dihapus');

-- ── S8. fungsi baca: pilihan, daftar, detail ──────────────────────────────────────────────
select pg_temp.eq(pg_temp.ra('kp',format('select (public.komplain_pilihan(%L::uuid)->''cabang'')::text',pg_temp.b('A'))),'[{"id": "'||pg_temp.b('A')||'", "kode": "KPLA", "nama": "KPL petshop A"}]','S8 kasir hanya diberi pilihan cabangnya sendiri');
select pg_temp.eq(pg_temp.ra('own','select jsonb_array_length(public.komplain_pilihan(null)->''cabang'')::text'),'3','S8 Owner diberi 3 cabang aktif (nonaktif tidak)');
select pg_temp.eq(pg_temp.ra('kp',format('select (public.komplain_pilihan(%L::uuid)->>''peran'')||''|''||(public.komplain_pilihan(null)->>''kelola'')',pg_temp.b('A'))),'STAFF|false','S8 pilihan memuat peran dan hak kelola');
select pg_temp.eq(pg_temp.ra('own','select (public.komplain_pilihan(null)->>''kelola'')'),'true','S8 Owner punya hak kelola');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.ra('kp',format('select public.komplain_pilihan(%L::uuid)->''petugas''',pg_temp.b('A')))::jsonb) e where e->>'id' in(pg_temp.u('ao')::text,pg_temp.u('off')::text,pg_temp.u('stx')::text,pg_temp.u('kk')::text)),'S8 daftar petugas tidak memuat Admin Online, akun nonaktif, atau akun tanpa akses cabang');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pg_temp.ra('kp',format('select public.komplain_pilihan(%L::uuid)->''petugas''',pg_temp.b('A')))::jsonb) e where e->>'id'=pg_temp.u('st2')::text),'S8 daftar petugas memuat staff cabang A');
select pg_temp.eq(pg_temp.ra('kp',format('select jsonb_array_length(public.komplain_pilihan(%L::uuid)->''petugas'')::text',pg_temp.b('X'))),'0','S8 petugas cabang yang tak boleh diakses = kosong');
select pg_temp.has(pg_temp.ra('ao','select public.komplain_pilihan(null)::text'),'ADMIN_ONLINE_FUNCTION_DENIED','S8 Admin Online ditolak membaca pilihan');
select pg_temp.eq(pg_temp.ra('own','select (public.komplain_daftar(null,null,null,null,null,null,null,null,null,null,null,null)->>''total'')'),'12','S8 daftar Owner: 12 (11 + 1 dari uji kategori baru)');
select pg_temp.eq(pg_temp.ra('kp','select (public.komplain_daftar(null,null,null,null,null,null,null,null,null,null,null,null)->>''total'')'),'4','S8 daftar kasir: hanya 4 yang terlihat (miliknya)');
select pg_temp.eq(pg_temp.ra('kp','select (public.komplain_daftar(null,null,null,null,null,null,null,null,null,null,null,null)->>''total'')'),pg_temp.cnt('kp','customer_complaints'),'S8 daftar = jumlah baris yang boleh dilihat RLS');
select pg_temp.eq(pg_temp.ra('kp','select jsonb_array_length(public.komplain_daftar(null,null,null,null,null,null,null,null,null,null,null,null)->''baris'')::text'),'4','S8 baris daftar kasir: hanya 4 baris dikirim');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.ra('kp','select public.komplain_daftar(null,null,null,null,null,null,null,null,null,null,null,null)->''baris''')::jsonb) e where (e->>'dibuat_oleh')<>pg_temp.u('kp')::text and (e->>'petugas_id') is distinct from pg_temp.u('kp')::text),'S8 baris daftar kasir hanya milik/ditugaskan kepadanya');
select pg_temp.eq(pg_temp.ra('own',format('select (public.komplain_daftar(null,null,%L::uuid,null,null,null,null,null,null,null,null,null)->>''total'')',pg_temp.b('K'))),'3','S8 filter cabang K = 3 (c4,c5,f1)');
select pg_temp.eq(pg_temp.ra('own','select (public.komplain_daftar(null,null,null,null,''Sedang'',null,null,null,null,null,null,null)->>''total'')'),(select count(*)::text from customer_complaints where severity='Sedang'),'S8 filter tingkat Sedang = hitung manual');
select pg_temp.eq(pg_temp.ra('own','select (public.komplain_daftar(null,null,null,null,null,''terbuka'',null,null,null,null,null,null)->>''total'')||''/''||(public.komplain_daftar(null,null,null,null,null,''ditutup'',null,null,null,null,null,null)->>''total'')'),(select count(*) filter (where closed_at is null)||'/'||count(*) filter (where closed_at is not null) from customer_complaints),'S8 filter terbuka/ditutup sesuai data');
select pg_temp.eq(pg_temp.ra('own','select (public.komplain_daftar(null,null,null,null,null,null,null,''Online Shopee'',null,null,null,null)->>''total'')'),'1','S8 filter kanal');
select pg_temp.eq(pg_temp.ra('own',format('select (public.komplain_daftar(null,null,null,%L::uuid,null,null,null,null,null,null,null,null)->>''total'')',pg_temp.cat('Grooming'))),'2','S8 filter kategori Grooming = 2 (c2,c3)');
select pg_temp.eq(pg_temp.ra('own',format('select (public.komplain_daftar(null,null,null,null,null,null,%L::uuid,null,null,null,null,null)->>''total'')',pg_temp.u('st2'))),(select count(*)::text from customer_complaints where assigned_to=pg_temp.u('st2')),'S8 filter petugas st2 = hitung manual');
select pg_temp.eq(pg_temp.ra('own','select (public.komplain_daftar(null,null,null,null,null,null,null,null,''STR-001'',null,null,null)->>''total'')'),'1','S8 pencarian nomor struk');
select pg_temp.eq(pg_temp.ra('own','select (public.komplain_daftar(null,null,null,null,null,null,null,null,''Pelanggan Fiktif'',null,null,null)->>''total'')'),'1','S8 pencarian nama pelanggan');
select pg_temp.eq(pg_temp.ra('own','select (public.komplain_daftar(null,null,null,null,null,null,null,null,''%'',null,null,null)->>''total'')'),'0','S8 pencarian "%" diperlakukan harfiah, bukan pola');
select pg_temp.eq(pg_temp.ra('own',format('select (public.komplain_daftar(%L::date,%L::date,null,null,null,null,null,null,null,null,null,null)->>''total'')',pg_temp.today()-5,pg_temp.today()-2)),'1','S8 rentang tanggal memuat tanggal mundur c3');
select pg_temp.eq(pg_temp.ra('own','select jsonb_array_length(public.komplain_daftar(null,null,null,null,null,null,null,null,null,null,5,0)->''baris'')::text||''/''||jsonb_array_length(public.komplain_daftar(null,null,null,null,null,null,null,null,null,null,5,10)->''baris'')::text'),'5/2','S8 paginasi: halaman 1 = 5 baris, halaman ke-3 = 2 baris');
select pg_temp.eq(pg_temp.ra('own','select (public.komplain_daftar(null,null,null,null,null,null,null,null,null,''nomor'',1,0)->''baris''->0->>''nomor'')'),(select max(complaint_no) from customer_complaints),'S8 urutan nomor: terbesar dulu');
select pg_temp.eq(pg_temp.ra('own','select (public.komplain_daftar(null,null,null,null,null,null,null,null,null,''umur'',1,0)->''baris''->0->>''status'')'),(select status from customer_complaints where closed_at is null order by complained_at,id limit 1),'S8 urutan umur: komplain terbuka tertua dulu');
select pg_temp.has(pg_temp.ra('own','select public.komplain_daftar(null,null,null,null,null,''Hilang'',null,null,null,null,null,null)::text'),'KOMPLAIN_STATUS','S8 status filter tak dikenal ditolak');
select pg_temp.has(pg_temp.ra('own',format('select public.komplain_daftar(%L::date,%L::date,null,null,null,null,null,null,null,null,null,null)::text',pg_temp.today(),pg_temp.today()-1)),'KOMPLAIN_RENTANG','S8 rentang terbalik ditolak');
select pg_temp.has(pg_temp.ra('ao','select public.komplain_daftar(null,null,null,null,null,null,null,null,null,null,null,null)::text'),'ADMIN_ONLINE_FUNCTION_DENIED','S8 Admin Online ditolak membaca daftar');
select pg_temp.has(pg_temp.ra('off','select public.komplain_daftar(null,null,null,null,null,null,null,null,null,null,null,null)::text'),'KOMPLAIN_DITOLAK','S8 akun nonaktif ditolak membaca daftar');
-- detail
select pg_temp.eq(pg_temp.ra('kp',format('select (public.komplain_detail(%L::uuid)->''komplain''->>''nomor'')',pg_temp.c('c3'))),(select nomor from cc where n='c3'),'S8 detail komplain sendiri');
select pg_temp.has(pg_temp.ra('kp',format('select public.komplain_detail(%L::uuid)::text',pg_temp.c('c5'))),'KOMPLAIN_TIDAK_ADA','S8 detail komplain cabang lain ditolak');
select pg_temp.has(pg_temp.ra('st2',format('select public.komplain_detail(%L::uuid)::text',pg_temp.c('c1'))),'KOMPLAIN_TIDAK_ADA','S8 detail komplain staff lain (cabang sama) ditolak');
select pg_temp.has(pg_temp.ra('ao',format('select public.komplain_detail(%L::uuid)::text',pg_temp.c('c3'))),'ADMIN_ONLINE_FUNCTION_DENIED','S8 Admin Online ditolak membaca detail');
select pg_temp.eq(pg_temp.ra('kp',format('select jsonb_array_length(public.komplain_detail(%L::uuid)->''riwayat'')::text||''/''||jsonb_array_length(public.komplain_detail(%L::uuid)->''berkas'')::text',pg_temp.c('c3'),pg_temp.c('c3'))),(select (select count(*) from customer_complaint_history where complaint_id=pg_temp.c('c3'))||'/'||(select count(*) from customer_complaint_files where complaint_id=pg_temp.c('c3'))),'S8 detail memuat seluruh riwayat dan berkas');
select pg_temp.eq(pg_temp.ra('kp',format('select (public.komplain_detail(%L::uuid)->''boleh''->>''ubah'')||''|''||(public.komplain_detail(%L::uuid)->''boleh''->>''buka_kembali'')',pg_temp.c('c3'),pg_temp.c('c1'))),'true|false','S8 hak di detail: pembuat boleh ubah, tidak boleh buka kembali');
select pg_temp.eq(pg_temp.ra('own',format('select (public.komplain_detail(%L::uuid)->''boleh''->>''buka_kembali'')',pg_temp.c('c4'))),'true','S8 Owner boleh membuka kembali komplain tertutup');
select pg_temp.ok(pg_temp.ra('kp',format('select (public.komplain_detail(%L::uuid)->''komplain''->>''respons_jam'')',pg_temp.c('c3'))) not in ('NULL') and left(pg_temp.ra('kp',format('select (public.komplain_detail(%L::uuid)->''komplain''->>''respons_jam'')',pg_temp.c('c3'))),4)<>'ERR:','S8 jam respons dihitung di detail');

-- ── S9. dashboard = hitung manual pada data acak ──────────────────────────────────────────
-- 90 komplain acak ditanam langsung (superuser) di tiga cabang, 8 pembuat, status/tingkat/kanal/tanggal acak, sebagian ditutup.
select setseed(0.4242);
create temp table plant(i int);
insert into plant select g from generate_series(1,90) g;
alter table customer_complaints disable trigger komplain_guard_ubah;
insert into customer_complaints(complaint_no,branch_id,channel,complained_at,complaint_date,customer_id,customer_name,customer_phone,category_id,severity,description,involved,
  assigned_to,status,first_response_at,closed_at,closed_by,resolution_type,resolution_note,created_by,created_at,request_key,request_hash)
select 'KMP-209901-'||lpad(i::text,4,'0'),b.id,ch,ts,(ts at time zone 'Asia/Jakarta')::date,
  case when r1<0.3 then 'c4000000-0000-4000-8000-000000000001'::uuid when r1<0.45 then 'c4000000-0000-4000-8000-000000000002'::uuid end,
  case when r1<0.3 then 'Pelanggan Fiktif Satu' when r1<0.45 then 'Pelanggan Fiktif Dua' when r1<0.6 then 'Tamu '||(i%4) end,
  case when r1<0.6 and r1>=0.45 then '0812000010'||(i%4) end,
  k.id,sv,'Komplain acak nomor '||i,
  case when r2<0.2 then '[{"id":"c3000000-0000-4000-8000-000000000001","name":"Kasir Fiktif Satu"}]'::jsonb when r2<0.35 then '[{"id":"c3000000-0000-4000-8000-000000000002","name":"Dokter Fiktif Dua"},{"id":"c3000000-0000-4000-8000-000000000001","name":"Kasir Fiktif Satu"}]'::jsonb else '[]'::jsonb end,
  case when r3<0.25 then pg_temp.u('kp') when r3<0.4 then pg_temp.u('st2') when r3<0.5 then pg_temp.u('kk') end,
  stt,case when stt<>'Baru' then ts+make_interval(hours=>1+(i%30)) end,
  case when stt in('Selesai','Ditolak') then ts+make_interval(hours=>31+(i%200)) end,
  case when stt in('Selesai','Ditolak') then cr end,
  case when stt='Ditolak' then 'Tidak valid' when stt='Selesai' then (array['Maaf/penjelasan','Ganti barang','Refund','Diskon/voucher','Edukasi staf'])[1+(i%5)] end,
  case when stt in('Selesai','Ditolak') then 'Catatan penyelesaian acak' end,
  cr,ts,gen_random_uuid(),'plant'
from (select i,random() r1,random() r2,random() r3,
  (select id from bb order by n offset (i%3) limit 1) bid,
  (array['Petshop','Klinik','Grooming','Rawat Inap','Online Shopee','Lainnya'])[1+(i%6)] ch,
  (array['Rendah','Sedang','Tinggi','Kritis'])[1+floor(random()*4)::int] sv,
  (array['Baru','Dicek','Dalam penanganan','Menunggu pelanggan','Selesai','Ditolak'])[1+floor(random()*6)::int] stt,
  now()-make_interval(days=>floor(random()*70)::int,hours=>floor(random()*20)::int) ts,
  (array[pg_temp.u('kp'),pg_temp.u('st2'),pg_temp.u('kk'),pg_temp.u('own'),pg_temp.u('adm'),pg_temp.u('fin'),pg_temp.u('stx'),pg_temp.u('kl')])[1+(i%8)] cr,
  (select id from complaint_categories order by sort_order offset (i%10) limit 1) kid from plant) p
 join bb b on b.id=p.bid join complaint_categories k on k.id=p.kid;
alter table customer_complaints enable trigger komplain_guard_ubah;
select pg_temp.eq((select count(*)::text from customer_complaints where request_hash='plant'),'90','S9 90 komplain acak tertanam');
select pg_temp.ok((select count(*) from customer_complaints where request_hash='plant' and closed_at is null)>10 and (select count(*) from customer_complaints where request_hash='plant' and closed_at is not null)>10,'S9 data acak memuat komplain terbuka dan tertutup');
-- pembanding: hitung manual dengan SQL biasa (tanpa memakai fungsi dashboard)
create function pg_temp.dash(un text, dari date, sampai date, br uuid, kat uuid, sev text, st text, asg uuid, ch text) returns jsonb language sql as $$
 select pg_temp.ra(un,format('select public.komplain_dashboard(%L::date,%L::date,%L::uuid,%L::uuid,%L,%L,%L::uuid,%L)::text',dari,sampai,br,kat,sev,st,asg,ch))::jsonb $$;
create function pg_temp.manual(un text, q text) returns text language sql as $$select pg_temp.ra(un,q)$$;
create function pg_temp.pred(br uuid, kat uuid, sev text, st text, asg uuid, ch text, with_status boolean) returns text language sql as $$
 select format('(%L::uuid is null or c.branch_id=%L::uuid) and (%L::uuid is null or c.category_id=%L::uuid) and (%L is null or c.severity=%L) and (%L::uuid is null or c.assigned_to=%L::uuid) and (%L is null or c.channel=%L)',br,br,kat,kat,sev,sev,asg,asg,ch,ch)
  || case when with_status then format(' and (%L is null or (%L=''terbuka'' and c.closed_at is null) or (%L=''ditutup'' and c.closed_at is not null) or c.status=%L)',st,st,st,st) else '' end $$;
create function pg_temp.check_dash(un text, label text, dari date, sampai date, br uuid default null, kat uuid default null, sev text default null, st text default null, asg uuid default null, ch text default null) returns void language plpgsql as $$
declare d jsonb; p text; ps text; hari int; t0 date:=pg_temp.today(); d1 date:=coalesce(dari,date_trunc('month',pg_temp.today()::timestamp)::date); d2 date:=coalesce(sampai,pg_temp.today());
        m1 date:=date_trunc('month',pg_temp.today()::timestamp)::date; exp text; got text;
begin
 d:=pg_temp.dash(un,dari,sampai,br,kat,sev,st,asg,ch); p:=pg_temp.pred(br,kat,sev,st,asg,ch,false); ps:=pg_temp.pred(br,kat,sev,st,asg,ch,true);
 select overdue_days into hari from complaint_settings;
 if d is null then raise exception 'Assertion failed: % dashboard kosong',label;end if;
 perform pg_temp.eq(d->'kpi'->>'total',pg_temp.manual(un,format('select count(*)::text from public.customer_complaints c where %s and c.complaint_date between %L and %L',ps,d1,d2)),label||' total');
 perform pg_temp.eq(d->'kpi'->>'terbuka',pg_temp.manual(un,format('select count(*)::text from public.customer_complaints c where %s and c.closed_at is null',ps)),label||' terbuka (semua komplain belum ditutup)');
 perform pg_temp.eq(d->'kpi'->>'terlambat',pg_temp.manual(un,format('select count(*)::text from public.customer_complaints c where %s and c.closed_at is null and %L::date - c.complaint_date > %s',ps,t0,hari)),label||' terlambat');
 perform pg_temp.eq(d->'kpi'->>'kritis_terbuka',pg_temp.manual(un,format('select count(*)::text from public.customer_complaints c where %s and c.closed_at is null and c.severity=''Kritis''',ps)),label||' kritis terbuka');
 perform pg_temp.eq(d->'kpi'->>'ditutup_rentang',pg_temp.manual(un,format('select count(*)::text from public.customer_complaints c where %s and c.closed_at is not null and c.complaint_date between %L and %L',ps,d1,d2)),label||' ditutup dalam rentang');
 perform pg_temp.eq(d->'kpi'->>'ditutup_bulan_ini',pg_temp.manual(un,format('select count(*)::text from public.customer_complaints c where %s and c.closed_at is not null and (c.closed_at at time zone ''Asia/Jakarta'')::date>=%L and (c.closed_at at time zone ''Asia/Jakarta'')::date<%L',p,m1,(m1+interval '1 month')::date)),label||' ditutup bulan ini');
 perform pg_temp.eq(coalesce(d->'kpi'->>'rata_respons_jam','NULL'),pg_temp.manual(un,format('select coalesce(round(avg(extract(epoch from c.first_response_at-c.complained_at)/3600.0),1)::text,''NULL'') from public.customer_complaints c where %s and c.complaint_date between %L and %L and c.first_response_at is not null',ps,d1,d2)),label||' rata-rata respons (jam)');
 perform pg_temp.eq(coalesce(d->'kpi'->>'rata_selesai_hari','NULL'),pg_temp.manual(un,format('select coalesce(round(avg(extract(epoch from c.closed_at-c.complained_at)/86400.0),1)::text,''NULL'') from public.customer_complaints c where %s and c.complaint_date between %L and %L and c.closed_at is not null',ps,d1,d2)),label||' rata-rata penyelesaian (hari)');
 perform pg_temp.eq((select string_agg((e->>'tingkat')||':'||(e->>'jumlah'),',' order by ord) from jsonb_array_elements(d->'per_tingkat') with ordinality t(e,ord)),
   pg_temp.manual(un,format('select string_agg(s||'':''||(select count(*) from public.customer_complaints c where %s and c.complaint_date between %L and %L and c.severity=s),'','' order by o) from unnest(array[''Kritis'',''Tinggi'',''Sedang'',''Rendah'']) with ordinality x(s,o)',ps,d1,d2)),label||' per tingkat');
 perform pg_temp.eq((select string_agg((e->>'status')||':'||(e->>'jumlah'),',' order by ord) from jsonb_array_elements(d->'per_status') with ordinality t(e,ord)),
   pg_temp.manual(un,format('select string_agg(s||'':''||(select count(*) from public.customer_complaints c where %s and c.complaint_date between %L and %L and c.status=s),'','' order by o) from unnest(array[''Baru'',''Dicek'',''Dalam penanganan'',''Menunggu pelanggan'',''Selesai'',''Ditolak'']) with ordinality x(s,o)',ps,d1,d2)),label||' per status');
 perform pg_temp.eq((select coalesce(string_agg((e->>'cabang_id')||':'||(e->>'jumlah')||':'||(e->>'terbuka'),',' order by ord),'') from jsonb_array_elements(d->'per_cabang') with ordinality t(e,ord)),
   pg_temp.manual(un,format('select coalesce(string_agg(branch_id::text||'':''||n||'':''||o,'','' order by n desc,nm,branch_id),'''') from (select c.branch_id,b.name nm,count(*) n,count(*) filter (where c.closed_at is null) o from public.customer_complaints c join public.branches b on b.id=c.branch_id where %s and c.complaint_date between %L and %L group by c.branch_id,b.name) z',ps,d1,d2)),label||' per cabang (urutan dan angka)');
 perform pg_temp.eq((select coalesce(string_agg((e->>'kategori_id')||':'||(e->>'jumlah')||':'||(e->>'terbuka'),',' order by ord),'') from jsonb_array_elements(d->'per_kategori') with ordinality t(e,ord)),
   pg_temp.manual(un,format('select coalesce(string_agg(category_id::text||'':''||n||'':''||o,'','' order by n desc,nm,category_id),'''') from (select c.category_id,k.name nm,count(*) n,count(*) filter (where c.closed_at is null) o from public.customer_complaints c join public.complaint_categories k on k.id=c.category_id where %s and c.complaint_date between %L and %L group by c.category_id,k.name) z',ps,d1,d2)),label||' per kategori (urutan dan angka)');
 perform pg_temp.eq((select string_agg((e->>'kanal')||':'||(e->>'jumlah'),',' order by ord) from jsonb_array_elements(d->'per_kanal') with ordinality t(e,ord)),
   pg_temp.manual(un,format('select string_agg(s||'':''||(select count(*) from public.customer_complaints c where %s and c.complaint_date between %L and %L and c.channel=s),'','' order by o) from unnest(array[''Petshop'',''Klinik'',''Grooming'',''Rawat Inap'',''Online Shopee'',''Lainnya'']) with ordinality x(s,o)',ps,d1,d2)),label||' per kanal');
 perform pg_temp.eq((select count(*)::text||'/'||sum((e->>'jumlah')::int)::text from jsonb_array_elements(d->'tren_hari') e),(d2-d1+1)::text||'/'||(d->'kpi'->>'total'),label||' tren harian: satu titik per hari, jumlah = total');
 perform pg_temp.eq((select sum((e->>'jumlah')::int)::text from jsonb_array_elements(d->'tren_minggu') e),d->'kpi'->>'total',label||' tren mingguan: jumlah = total');
 perform pg_temp.eq((select coalesce(string_agg((e->>'nama')||':'||(e->>'jumlah'),',' order by ord),'') from jsonb_array_elements(d->'pelanggan_berulang') with ordinality t(e,ord)),
   pg_temp.manual(un,format('select coalesce(string_agg(nama||'':''||n,'','' order by n desc,last desc,nama,k),'''') from (select * from (select coalesce(c.customer_id::text,''n:''||lower(btrim(c.customer_name))||''|''||regexp_replace(coalesce(c.customer_phone,''''),''\D'','''',''g'')) k,max(c.customer_name) nama,count(*) n,max(c.complaint_date) last from public.customer_complaints c where %s and c.complaint_date between %L and %L and (c.customer_id is not null or c.customer_name is not null) group by 1 having count(*)>=2 order by count(*) desc,max(c.complaint_date) desc,1 limit 10) y) z',ps,d1,d2)),label||' pelanggan berulang');
 perform pg_temp.eq((select coalesce(string_agg((e->>'karyawan_id')||':'||(e->>'jumlah'),',' order by ord),'') from jsonb_array_elements(d->'karyawan_disebut') with ordinality t(e,ord)),
   pg_temp.manual(un,format('select coalesce(string_agg(eid||'':''||n,'','' order by n desc,nm,eid),'''') from (select e->>''id'' eid,max(e->>''name'') nm,count(*) n from public.customer_complaints c,jsonb_array_elements(c.involved) e where %s and c.complaint_date between %L and %L group by e->>''id'' order by count(*) desc,max(e->>''name''),e->>''id'' limit 10) z',ps,d1,d2)),label||' karyawan yang disebut');
 perform pg_temp.eq((select coalesce(string_agg(e->>'id','|' order by ord),'') from jsonb_array_elements(d->'umur_terbuka') with ordinality t(e,ord)),
   pg_temp.manual(un,format('select coalesce(string_agg(id::text,''|'' order by complained_at,id),'''') from (select c.id,c.complained_at from public.customer_complaints c where %s and c.closed_at is null order by c.complained_at,c.id limit 50) z',ps)),label||' daftar umur terbuka (urutan tertua dulu, maks. 50)');
 perform pg_temp.ok((select coalesce(bool_and((e->>'umur_hari')::int=t0-(e->>'tanggal')::date and (e->>'terlambat')::boolean=((e->>'umur_hari')::int>hari)),true) from jsonb_array_elements(d->'umur_terbuka') e),label||' umur hari dan tanda terlambat di daftar umur');
end$$;
select pg_temp.check_dash('own','S9 Owner bawaan (bulan ini)',null,null);
select pg_temp.check_dash('own','S9 Owner 30 hari',pg_temp.today()-30,pg_temp.today());
select pg_temp.check_dash('own','S9 Owner 70 hari',pg_temp.today()-70,pg_temp.today());
select pg_temp.check_dash('own','S9 Owner cabang A',pg_temp.today()-45,pg_temp.today(),pg_temp.b('A'));
select pg_temp.check_dash('own','S9 Owner tingkat Kritis',pg_temp.today()-45,pg_temp.today(),null,null,'Kritis');
select pg_temp.check_dash('own','S9 Owner status terbuka',pg_temp.today()-45,pg_temp.today(),null,null,null,'terbuka');
select pg_temp.check_dash('own','S9 Owner status ditutup',pg_temp.today()-45,pg_temp.today(),null,null,null,'ditutup');
select pg_temp.check_dash('own','S9 Owner status Selesai',pg_temp.today()-60,pg_temp.today(),null,null,null,'Selesai');
select pg_temp.check_dash('own','S9 Owner kanal+kategori',pg_temp.today()-60,pg_temp.today(),null,pg_temp.cat('Grooming'),null,null,null,'Grooming');
select pg_temp.check_dash('own','S9 Owner petugas st2',pg_temp.today()-60,pg_temp.today(),null,null,null,null,pg_temp.u('st2'));
select pg_temp.check_dash('adm','S9 ADMIN cabang K',pg_temp.today()-40,pg_temp.today(),pg_temp.b('K'));
select pg_temp.check_dash('fin','S9 FINANCE 20 hari',pg_temp.today()-20,pg_temp.today());
select pg_temp.check_dash('kp','S9 kasir petshop 60 hari (hanya miliknya)',pg_temp.today()-60,pg_temp.today());
select pg_temp.check_dash('kk','S9 dokter klinik 60 hari',pg_temp.today()-60,pg_temp.today());
select pg_temp.check_dash('stx','S9 staff cabang X bawaan',null,null);
select pg_temp.grant_kelola('STAFF');
select pg_temp.check_dash('kl','S9 staff dengan izin kelola (cabang A) 60 hari',pg_temp.today()-60,pg_temp.today());
select pg_temp.revoke_kelola('STAFF');
select pg_temp.ok((pg_temp.dash('kp',pg_temp.today()-60,pg_temp.today(),null,null,null,null,null,null)->'kpi'->>'total')::int<(pg_temp.dash('own',pg_temp.today()-60,pg_temp.today(),null,null,null,null,null,null)->'kpi'->>'total')::int,'S9 total kasir lebih kecil dari total Owner (cakupan dibatasi di database)');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.dash('kp',pg_temp.today()-60,pg_temp.today(),null,null,null,null,null,null)->'umur_terbuka') e where (e->>'cabang_id')::uuid<>pg_temp.b('A')),'S9 daftar umur kasir tidak memuat cabang lain');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.dash('kp',pg_temp.today()-60,pg_temp.today(),null,null,null,null,null,null)->'umur_terbuka') e where (e->>'dibuat_oleh')::uuid<>pg_temp.u('kp') and (e->>'petugas_id') is distinct from pg_temp.u('kp')::text),'S9 daftar umur kasir hanya memuat miliknya/ditugaskan padanya');
select pg_temp.has(pg_temp.ra('ao','select public.komplain_dashboard(null,null,null,null,null,null,null,null)::text'),'ADMIN_ONLINE_FUNCTION_DENIED','S9 Admin Online ditolak membuka dashboard');
select pg_temp.has(pg_temp.ra('off','select public.komplain_dashboard(null,null,null,null,null,null,null,null)::text'),'KOMPLAIN_DITOLAK','S9 akun nonaktif ditolak membuka dashboard');
select pg_temp.has(pg_temp.ra('own',format('select public.komplain_dashboard(%L::date,%L::date,null,null,null,null,null,null)::text',pg_temp.today(),pg_temp.today()-2)),'KOMPLAIN_RENTANG','S9 rentang terbalik ditolak');
select pg_temp.has(pg_temp.ra('own',format('select public.komplain_dashboard(%L::date,%L::date,null,null,null,null,null,null)::text',pg_temp.today()-400,pg_temp.today())),'KOMPLAIN_RENTANG','S9 rentang lebih dari 367 hari ditolak');
select pg_temp.has(pg_temp.ra('own','select public.komplain_dashboard(null,null,null,null,''Gawat'',null,null,null)::text'),'KOMPLAIN_TINGKAT','S9 tingkat tak dikenal ditolak');
-- batas terlambat bisa diubah dan dipakai
select pg_temp.eq(left(pg_temp.ra('own','select public.komplain_pengaturan_simpan(10)::text'),1),'{','S9 batas terlambat diubah ke 10 hari');
select pg_temp.check_dash('own','S9 Owner dengan batas terlambat 10 hari',pg_temp.today()-60,pg_temp.today());
select pg_temp.ok((pg_temp.dash('own',null,null,null,null,null,null,null,null)->>'hari_telat')='10','S9 dashboard menyebut batas terlambat yang berlaku');
select pg_temp.eq(left(pg_temp.ra('own','select public.komplain_pengaturan_simpan(3)::text'),1),'{','S9 batas terlambat dikembalikan ke 3');

-- ── S10. Admin Online: setiap fungsi dan tabel (probe dinamis) ───────────────────────────
create function pg_temp.probe_ao() returns text language plpgsql as $$
declare f record; args text; r text; a oid; i int; bad text:=''; n int:=0; t text; msg text;
begin
 perform set_config('request.jwt.claim.sub',pg_temp.u('ao')::text,true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 for f in select p.oid,p.proname,p.proargtypes::oid[] ats,p.oid::regprocedure::text sig from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'komplain\_%' and p.proname not in('komplain_boleh','komplain_visible') and p.proname not like 'komplain\_berkas\_%' order by 2 loop
  select coalesce(string_agg('null::'||format_type(ty,null),',' order by ord),'') into args from unnest(f.ats) with ordinality t(ty,ord);
  n:=n+1;
  begin execute 'set local role authenticated'; execute 'select public.'||f.proname||'('||args||')'; execute 'reset role'; bad:=bad||f.proname||'(berhasil!) ';
  exception when others then execute 'reset role'; if position('ADMIN_ONLINE_FUNCTION_DENIED' in sqlerrm)=0 then bad:=bad||f.proname||'('||left(sqlerrm,50)||') '; end if; end;
 end loop;
 return n||'|'||bad;
end$$;
select pg_temp.eq(pg_temp.probe_ao(),'11|','S10 Admin Online ditolak (ADMIN_ONLINE_FUNCTION_DENIED) di SEMUA 11 fungsi baca/tulis, argumen bertipe');
select pg_temp.eq(pg_temp.ra('ao','select count(*)::text from public.customer_complaints')||'|'||pg_temp.ra('ao','select count(*)::text from public.customer_complaint_history')||'|'||pg_temp.ra('ao','select count(*)::text from public.customer_complaint_files')||'|'||pg_temp.ra('ao','select count(*)::text from public.complaint_categories')||'|'||pg_temp.ra('ao','select count(*)::text from public.complaint_settings'),'0|0|0|0|0','S10 Admin Online membaca 0 baris di semua tabel komplain');
select pg_temp.has(pg_temp.da('ao','insert into public.complaint_categories(name) values(''xx'')'),'permission denied','S10 Admin Online tidak bisa menulis kategori');
select pg_temp.has(pg_temp.da('ao','delete from public.customer_complaint_history'),'permission denied','S10 Admin Online tidak bisa menghapus jejak');

-- ── S11. tanpa efek uang / stok / poin ───────────────────────────────────────────────────
-- ── S12. celah yang ditemukan review independen (mutan yang dulu selamat): kategori, batas daftar, hak ubah detail, umur tertutup, nama pelaku, batas nilai, TRUNCATE ──
-- a. kategori 'dipakai' hanya menghitung komplain yang boleh dilihat peminta (bukan seluruh tabel)
select pg_temp.mkc('v1','st2','A',jsonb_build_object('desk','Kamar mandi kotor satu','kat','Kebersihan/Fasilitas'));
select pg_temp.mkc('v2','st2','A',jsonb_build_object('desk','Kamar mandi kotor dua','kat','Kebersihan/Fasilitas'));
select pg_temp.mkc('v3','kp','A',jsonb_build_object('desk','Kamar mandi kotor tiga','kat','Kebersihan/Fasilitas'));
select pg_temp.eq(pg_temp.ra('kp','select (select (e->>''dipakai'') from jsonb_array_elements(public.komplain_kategori_daftar()->''kategori'') e where e->>''nama''=''Kebersihan/Fasilitas'')'),
  pg_temp.ra('kp','select count(*)::text from public.customer_complaints where category_id=(select id from public.complaint_categories where name=''Kebersihan/Fasilitas'')'),'S12 kategori: jumlah "dipakai" untuk STAFF = komplain yang boleh dilihatnya (RLS), bukan semua');
select pg_temp.ok((pg_temp.ra('kp','select (select (e->>''dipakai'') from jsonb_array_elements(public.komplain_kategori_daftar()->''kategori'') e where e->>''nama''=''Kebersihan/Fasilitas'')'))::int
  < (pg_temp.ra('own','select (select (e->>''dipakai'') from jsonb_array_elements(public.komplain_kategori_daftar()->''kategori'') e where e->>''nama''=''Kebersihan/Fasilitas'')'))::int,'S12 kategori: Owner melihat jumlah lebih besar daripada STAFF (uji tidak sepele)');
select pg_temp.eq(pg_temp.ra('own','select (select (e->>''dipakai'') from jsonb_array_elements(public.komplain_kategori_daftar()->''kategori'') e where e->>''nama''=''Kebersihan/Fasilitas'')'),
  (select count(*)::text from customer_complaints where category_id=pg_temp.cat('Kebersihan/Fasilitas')),'S12 kategori: Owner = hitung manual semua komplain kategori itu');
-- b. hak ubah detail: akun yang tak melihat komplain mendapat pesan "tidak ada", bukan "bukan penanganan"
select pg_temp.has(pg_temp.ud('stx','c3','Grooming','Tinggi',null,array[]::uuid[],175000,'x','Struk petshop','STR-001','coba ubah komplain orang lain','udv1'),'KOMPLAIN_TIDAK_ADA','S12 ubah detail: akun yang tak melihat komplain mendapat KOMPLAIN_TIDAK_ADA');
select pg_temp.has(pg_temp.ud('st2','c1','Grooming','Tinggi',null,array[]::uuid[],175000,'x',null,null,'rekan bukan pembuat','udv2'),'KOMPLAIN_TIDAK_ADA','S12 ubah detail: rekan satu cabang yang bukan pembuat/petugas juga KOMPLAIN_TIDAK_ADA');
-- c. umur komplain tertutup kosong dan tidak pernah "terlambat"
select pg_temp.ok((select count(*) from jsonb_array_elements(pg_temp.ra('own','select public.komplain_daftar(null,null,null,null,null,''ditutup'',null,null,null,null,null,null)->''baris''')::jsonb) e)>=1,'S12 ada komplain tertutup untuk diuji umurnya');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.ra('own','select public.komplain_daftar(null,null,null,null,null,''ditutup'',null,null,null,null,null,null)->''baris''')::jsonb) e where e->'umur_hari' <> 'null'::jsonb or (e->>'terlambat')::boolean),'S12 komplain tertutup: umur_hari kosong dan tidak terlambat');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.ra('own','select public.komplain_daftar(null,null,null,null,null,''terbuka'',null,null,null,null,null,null)->''baris''')::jsonb) e where e->'umur_hari' = 'null'::jsonb),'S12 komplain terbuka: umur_hari selalu terisi');
-- d. jejak mencatat NAMA dan PERAN pelaku persis seperti profilnya
select pg_temp.ok((select count(*) from customer_complaint_history)>=10 and not exists(select 1 from customer_complaint_history h join profiles p on p.id=h.actor where h.actor_name is distinct from p.full_name or h.actor_role is distinct from p.role::text or h.actor_name is null),'S12 jejak: actor_name dan actor_role sama dengan profil pelaku di semua baris');
-- e. batas nilai rupiah (1.000.000.000.000) di pembuatan dan di ubah detail
select pg_temp.has(pg_temp.mk('kp','nm1','A',jsonb_build_object('nominal','1000000000001')),'KOMPLAIN_NOMINAL','S12 nilai di atas 1 triliun ditolak saat membuat');
select pg_temp.eq(left(pg_temp.mk('kp','nm2','A',jsonb_build_object('nominal','1000000000000')),1),'{','S12 nilai tepat 1 triliun diterima saat membuat (batas tajam)');
select pg_temp.has(pg_temp.ud('kp','c3','Grooming','Tinggi',pg_temp.u('st2'),array['c3000000-0000-4000-8000-000000000001']::uuid[],1000000000001,'Minta uang kembali','Struk petshop','STR-001','nilai terlalu besar','udv3'),'KOMPLAIN_NOMINAL','S12 nilai di atas 1 triliun ditolak saat mengubah detail');
-- f. batas jumlah baris daftar: permintaan 100000 baris dipotong 5000 (5100 komplain massal, dibatalkan di akhir)
select pg_temp.eq(pg_temp.sup($sq$insert into public.customer_complaints(complaint_no,branch_id,channel,complained_at,complaint_date,category_id,severity,description,created_by,request_key,request_hash)
  select 'KMP-LIM-'||g,pg_temp.b('A'),'Petshop',now(),(now() at time zone 'Asia/Jakarta')::date,(select id from complaint_categories order by sort_order limit 1),'Rendah','Baris massal untuk uji batas',pg_temp.u('own'),md5('lim'||g)::uuid,'h' from generate_series(1,5100) g$sq$),'OK','S12 5100 komplain massal dibuat (superuser)');
select pg_temp.eq(pg_temp.ra('own','select jsonb_array_length(public.komplain_daftar(null,null,null,null,null,null,null,null,null,null,100000,0)->''baris'')::text'),'5000','S12 daftar: p_limit 100000 dipotong menjadi 5000 baris');
select pg_temp.eq(pg_temp.ra('own','select jsonb_array_length(public.komplain_daftar(null,null,null,null,null,null,null,null,null,null,5000,0)->''baris'')::text'),'5000','S12 daftar: p_limit 5000 tepat 5000 baris');
select pg_temp.ok((pg_temp.ra('own','select (public.komplain_daftar(null,null,null,null,null,null,null,null,null,null,100000,0)->>''total'')'))::int>5100,'S12 daftar: total tetap menghitung semua (bukan hanya yang dikirim)');
-- g. TRUNCATE oleh pemilik database ditolak pada jejak dan lampiran (komplain: ditolak pula oleh tabel anak)
select pg_temp.has(pg_temp.sup('truncate public.customer_complaint_history'),'KOMPLAIN_JEJAK_TETAP','S12 TRUNCATE jejak ditolak');
select pg_temp.has(pg_temp.sup('truncate public.customer_complaint_files'),'KOMPLAIN_JEJAK_TETAP','S12 TRUNCATE lampiran ditolak');
select pg_temp.has(pg_temp.sup('truncate public.customer_complaints cascade'),'KOMPLAIN_JEJAK_TETAP','S12 TRUNCATE komplain (cascade) ditolak');
select pg_temp.ok((select count(*) from customer_complaint_history)>=10 and (select count(*) from customer_complaint_files)>=3,'S12 jejak dan lampiran masih utuh sesudah percobaan TRUNCATE');

select pg_temp.ok((select je=(select count(*) from journal_entries) and jl=(select count(*) from journal_lines) and sm=(select count(*) from stock_moves) and ex=(select count(*) from expenses)
  and iv=(select count(*) from invoices) and sa=(select count(*) from sales) and pl=(select count(*) from point_ledger) from money0),'S11 jurnal, stok, pengeluaran, invoice, penjualan, poin tidak berubah oleh seluruh uji komplain');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace in('public'::regnamespace,'clinic_private'::regnamespace) and p.proname like 'komplain\_%' and (p.prosrc ilike '%journal_%' or p.prosrc ilike '%stock_%' or p.prosrc ilike '%expenses%' or p.prosrc ilike '%point_ledger%' or p.prosrc ilike '%cash_%')),'S11 tidak ada fungsi komplain yang menyebut tabel jurnal/stok/kas/poin');

rollback;
