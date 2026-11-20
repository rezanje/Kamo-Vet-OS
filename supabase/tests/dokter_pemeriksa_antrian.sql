-- Dokter pemeriksa di antrian (migrasi *_dokter_pemeriksa_antrian): fixture fiktif di PostgreSQL sekali pakai; semuanya di-rollback.
-- Yang dibuktikan: kolom visits.pemeriksa_id (opsional, FK karyawan); hanya dokter aktif yang bertugas di cabang kunjungan boleh dipilih;
-- tidak bisa diganti setelah ditagih/diarsipkan; doctor_id/dokter (groomer di Grooming) TIDAK berubah artinya; tidak menyentuh tagihan/jurnal;
-- atribusi laporan (performers baris -> penjual -> dokter kunjungan) tidak berubah oleh kolom ini; ACL/RLS kunjungan tetap; pagar Admin Online ikut.
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
create function pg_temp.accept(stmt text, label text) returns void language plpgsql as $$
begin execute stmt;raise notice 'BP_PASS %',label;exception when others then raise exception 'Expected success for %: %',label,sqlerrm;end$$;
create function pg_temp.as_(uid text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',uid,true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);end$$;
create function pg_temp.dba() returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','',true);end$$;
create function pg_temp.today() returns date language sql as $$select (now() at time zone 'Asia/Jakarta')::date$$;
create function pg_temp.pem(v uuid) returns uuid language sql as $$select pemeriksa_id from public.visits where id=v$$;
-- kunjungan fiktif; tiap panggilan id sendiri
create function pg_temp.mk(id uuid, branch uuid, poli text, doc uuid, dokter text, pemeriksa uuid) returns void language plpgsql as $$begin
 insert into public.visits(id,branch_id,customer_id,pet_id,poli,doctor_id,dokter,pemeriksa_id,status,queue_number)
 values(id,branch,'dd300000-0000-4000-8000-000000000001','dd400000-0000-4000-8000-000000000001',poli,doc,dokter,pemeriksa,'Menunggu','DD-'||substr(id::text,33));end$$;

-- ── fixtures ────────────────────────────────────────────────────────────────────────────────────────
insert into branches(id,code,name,type) values('dd200000-0000-4000-8000-000000000001','DDA','DD cabang A','KLINIK'),('dd200000-0000-4000-8000-000000000002','DDB','DD cabang B','KLINIK'),('dd200000-0000-4000-8000-000000000003','DDC','DD cabang C','KLINIK');
insert into auth.users(id,raw_user_meta_data) values('dd100000-0000-4000-8000-000000000001','{"full_name":"DD owner"}'),('dd100000-0000-4000-8000-000000000002','{"full_name":"DD staf klinik"}'),
 ('dd100000-0000-4000-8000-000000000003','{"full_name":"DD admin online"}');
update profiles set role='OWNER',is_active=true where id='dd100000-0000-4000-8000-000000000001';
update profiles set role='STAFF',is_active=true where id='dd100000-0000-4000-8000-000000000002';
insert into role_modules(role,module_id) values('STAFF','klinik') on conflict do nothing;
insert into user_branches(user_id,branch_id) values('dd100000-0000-4000-8000-000000000001','dd200000-0000-4000-8000-000000000001'),('dd100000-0000-4000-8000-000000000002','dd200000-0000-4000-8000-000000000001');
insert into employees(id,nama,jabatan,branch_id,status) values
 ('dd500000-0000-4000-8000-000000000001','Dokter Satu Fiktif','Dokter Hewan Poli','dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-000000000002','Dokter Dua Fiktif','Dokter Hewan Ranap - Poli','dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-000000000003','Groomer Fiktif','Staff Toko - Groomer','dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-000000000004','Paramedis Fiktif','Paramedis','dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-000000000005','Perawat Fiktif','Perawat','dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-000000000006','Asisten Dokter Fiktif','Asisten Dokter Hewan','dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-000000000007','Dokter Nonaktif Fiktif','Dokter Hewan','dd200000-0000-4000-8000-000000000001','Nonaktif'),
 ('dd500000-0000-4000-8000-000000000008','Dokter Sampah Fiktif','Dokter Hewan','dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-000000000009','Dokter Cabang B Fiktif','Dokter Hewan','dd200000-0000-4000-8000-000000000002','Aktif'),
 ('dd500000-0000-4000-8000-00000000000a','Dokter Tugas Ganda Fiktif','Dokter Hewan','dd200000-0000-4000-8000-000000000002','Aktif'),
 ('dd500000-0000-4000-8000-00000000000b','Dokter Tugas Selesai Fiktif','Dokter Hewan','dd200000-0000-4000-8000-000000000002','Aktif'),
 ('dd500000-0000-4000-8000-00000000000c','Dokter Tugas Akhir Hari Fiktif','Dokter Hewan','dd200000-0000-4000-8000-000000000002','Aktif'),
 ('dd500000-0000-4000-8000-00000000000d','Dokter Tugas Besok Fiktif','Dokter Hewan','dd200000-0000-4000-8000-000000000002','Aktif'),
 ('dd500000-0000-4000-8000-00000000000e','Drh Singkat Fiktif','drh. Singkat','dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-00000000000f','Tanpa Jabatan Fiktif',null,'dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-000000000010','Dokter Perawat Fiktif','Dokter dan Perawat','dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-000000000011','Dr Hewan Fiktif','DR HEWAN','dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-000000000012','Kasir Fiktif','Kasir','dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-000000000013','Doktoral Fiktif','Staf Doktoral Admin','dd200000-0000-4000-8000-000000000001','Aktif'),
 ('dd500000-0000-4000-8000-000000000014','Dokter Tugas Cabang C Fiktif','Dokter Hewan','dd200000-0000-4000-8000-000000000002','Aktif');
alter table employees disable trigger user; update employees set trashed_at=now() where id='dd500000-0000-4000-8000-000000000008'; alter table employees enable trigger user;
insert into employee_branch_assignments(employee_id,branch_id,role,effective_date,end_date,ended_by,ended_reason) values
 ('dd500000-0000-4000-8000-00000000000a','dd200000-0000-4000-8000-000000000001','SECONDARY',pg_temp.today()-30,null,null,null),
 ('dd500000-0000-4000-8000-00000000000b','dd200000-0000-4000-8000-000000000001','SECONDARY',pg_temp.today()-30,pg_temp.today()-1,'dd100000-0000-4000-8000-000000000001','uji selesai'),
 ('dd500000-0000-4000-8000-00000000000c','dd200000-0000-4000-8000-000000000001','SECONDARY',pg_temp.today()-30,pg_temp.today(),'dd100000-0000-4000-8000-000000000001','uji akhir hari'),
 ('dd500000-0000-4000-8000-00000000000d','dd200000-0000-4000-8000-000000000001','SECONDARY',pg_temp.today()+1,null,null,null),
 ('dd500000-0000-4000-8000-000000000014','dd200000-0000-4000-8000-000000000003','SECONDARY',pg_temp.today()-30,null,null,null);
insert into customers(id,name,phone) values('dd300000-0000-4000-8000-000000000001','DD pemilik','0800000011');
insert into pets(id,customer_id,name) values('dd400000-0000-4000-8000-000000000001','dd300000-0000-4000-8000-000000000001','DD hewan');
insert into items(id,code,name,unit,item_type,sell_price) values('dd600000-0000-4000-8000-000000000001','DDSVC','DD jasa grooming','pcs','Jasa',100000);

-- ── A. skema, ACL, pagar ─────────────────────────────────────────────────────────────────────────────
select pg_temp.ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='visits' and column_name='pemeriksa_id' and data_type='uuid' and is_nullable='YES' and column_default is null),'A01 kolom visits.pemeriksa_id uuid, boleh kosong, tanpa isian awal');
select pg_temp.ok((select confdeltype from pg_constraint where conrelid='public.visits'::regclass and contype='f' and confrelid='public.employees'::regclass and conkey=array[(select attnum from pg_attribute where attrelid='public.visits'::regclass and attname='pemeriksa_id')])='n','A02 FK ke employees ON DELETE SET NULL');
select pg_temp.ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='visits' and indexname='visits_pemeriksa_id_idx'),'A03 indeks parsial untuk pencarian FK');
select pg_temp.ok((select count(*) from pg_trigger where tgrelid='public.visits'::regclass and not tgisinternal and tgname in('b2_guard_visit_pemeriksa','master_ref_employees_pemeriksa_id'))=2,'A04 dua trigger baru terpasang di visits');
select pg_temp.ok((select tgtype&2<>0 from pg_trigger where tgname='b2_guard_visit_pemeriksa' and tgrelid='public.visits'::regclass),'A05 pagar berjalan BEFORE');
select pg_temp.ok(not has_function_privilege('authenticated','clinic_private.guard_visit_pemeriksa()','execute') and not has_function_privilege('anon','clinic_private.guard_visit_pemeriksa()','execute') and not has_function_privilege('service_role','clinic_private.guard_visit_pemeriksa()','execute'),'A06 fungsi pagar tidak dapat dipanggil klien');
select pg_temp.ok((select prosecdef and proconfig::text like '%search_path%' from pg_proc where oid='clinic_private.guard_visit_pemeriksa()'::regprocedure),'A07 fungsi pagar SECURITY DEFINER dengan search_path terkunci');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.visits'::regclass),'A08 RLS visits tetap aktif');
select pg_temp.ok((select count(*) from pg_policies where schemaname='public' and tablename='visits')>=4,'A09 kebijakan RLS visits tidak berkurang');
select pg_temp.ok(has_column_privilege('authenticated','public.visits','pemeriksa_id','insert') and has_column_privilege('authenticated','public.visits','pemeriksa_id','update'),'A10 klien login dapat menulis kolom (lewat RLS + pagar)');
select pg_temp.ok(not has_table_privilege('public','public.visits','select'),'A11 role public tetap tanpa akses visits');
select pg_temp.ok((select count(*) from visits where pemeriksa_id is not null)=0,'A12 tanpa isi ulang: kunjungan yang ada tidak punya pemeriksa');
select pg_temp.ok(pg_get_functiondef('public.clinic_change_visit_doctor(uuid,uuid,text,text,boolean,boolean)'::regprocedure) !~ 'pemeriksa','A13 Ubah dokter PJ tidak ditambal (tidak menyebut pemeriksa)');
select pg_temp.ok(pg_get_functiondef('clinic_private.guard_visit_archive()'::regprocedure) !~ 'pemeriksa','A14 pagar arsip kunjungan tidak ditambal');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and p.prosecdef and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.prorettype<>'trigger'::regtype and has_function_privilege('authenticated',p.oid,'execute') and p.proname<>'post_online_order' and p.proname not like 'admin\_online\_%' and p.prosrc !~ 'admin_online_private\.deny_admin_online' and not exists(select 1 from pg_depend e where e.classid='pg_proc'::regclass and e.objid=p.oid and e.deptype='e') and not exists(select 1 from pg_depend d join pg_policy pol on d.classid='pg_policy'::regclass and d.objid=pol.oid where d.refclassid='pg_proc'::regclass and d.refobjid=p.oid))=0,'A15 guard_all sudah memagari semua fungsi SECURITY DEFINER yang dapat dipanggil klien (tidak ada yang lolos)');
select pg_temp.ok(exists(select 1 from pg_trigger where tgrelid='public.visits'::regclass and tgname='zz_admin_online_write_fence'),'A16 pagar tulis Admin Online tetap ada di visits');

-- ── B. pendaftaran yang sah ──────────────────────────────────────────────────────────────────────────
select pg_temp.accept($$select pg_temp.mk('dd700000-0000-4000-8000-000000000001','dd200000-0000-4000-8000-000000000001','Grooming','dd500000-0000-4000-8000-000000000003','Groomer Fiktif','dd500000-0000-4000-8000-000000000001')$$,'B01 Grooming: groomer di doctor_id + dokter pemeriksa tersimpan');
select pg_temp.ok((select doctor_id='dd500000-0000-4000-8000-000000000003' and dokter='Groomer Fiktif' and pemeriksa_id='dd500000-0000-4000-8000-000000000001' from visits where id='dd700000-0000-4000-8000-000000000001'),'B02 doctor_id/dokter tetap groomer; pemeriksa terpisah');
select pg_temp.accept($$select pg_temp.mk('dd700000-0000-4000-8000-000000000002','dd200000-0000-4000-8000-000000000001','Grooming','dd500000-0000-4000-8000-000000000003','Groomer Fiktif',null)$$,'B03 tanpa pemeriksa tetap sah (opsional)');
select pg_temp.ok(pg_temp.pem('dd700000-0000-4000-8000-000000000002') is null,'B04 pemeriksa kosong tersimpan kosong');
select pg_temp.accept($$insert into visits(id,branch_id,customer_id,pet_id,poli,status,queue_number) values('dd700000-0000-4000-8000-000000000003','dd200000-0000-4000-8000-000000000001','dd300000-0000-4000-8000-000000000001','dd400000-0000-4000-8000-000000000001','Poli Umum','Menunggu','DD-OLD1')$$,'B05 INSERT lama (tanpa kolom baru) tetap sah');
select pg_temp.accept($$select pg_temp.mk('dd700000-0000-4000-8000-000000000004','dd200000-0000-4000-8000-000000000001','Poli Umum','dd500000-0000-4000-8000-000000000001','Dokter Satu Fiktif',null)$$,'B06 poli medis tanpa pemeriksa tetap sah');
select pg_temp.accept($$select pg_temp.mk('dd700000-0000-4000-8000-000000000005','dd200000-0000-4000-8000-000000000001','Grooming','dd500000-0000-4000-8000-000000000003','Groomer Fiktif','dd500000-0000-4000-8000-000000000002')$$,'B07 jabatan "Dokter Hewan Ranap - Poli" diterima');
select pg_temp.accept($$select pg_temp.mk('dd700000-0000-4000-8000-000000000006','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-00000000000e')$$,'B08 jabatan "drh. Singkat" diterima');
select pg_temp.accept($$select pg_temp.mk('dd700000-0000-4000-8000-000000000007','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-000000000011')$$,'B09 jabatan "DR HEWAN" (huruf besar) diterima');
select pg_temp.accept($$select pg_temp.mk('dd700000-0000-4000-8000-000000000008','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-00000000000a')$$,'B10 dokter cabang lain dengan penugasan sekunder yang berlaku diterima');
select pg_temp.accept($$select pg_temp.mk('dd700000-0000-4000-8000-000000000009','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-00000000000c')$$,'B11 penugasan berakhir HARI INI masih berlaku');
select pg_temp.ok((select count(*) from visits where id::text like 'dd700000-0000-4000-8000-00000000000%' and pemeriksa_id is not null)=6,'B12 enam kunjungan sah memuat pemeriksa');

-- ── C. penolakan ─────────────────────────────────────────────────────────────────────────────────────
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000c1','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-000000000003')$$,'PEMERIKSA_BUKAN_DOKTER','C01 groomer tidak boleh jadi pemeriksa');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000c2','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-000000000004')$$,'PEMERIKSA_BUKAN_DOKTER','C02 paramedis ditolak');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000c3','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-000000000005')$$,'PEMERIKSA_BUKAN_DOKTER','C03 perawat ditolak');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000c4','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-000000000006')$$,'PEMERIKSA_BUKAN_DOKTER','C04 asisten dokter ditolak (paramedis, seperti aplikasi)');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000c5','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-000000000010')$$,'PEMERIKSA_BUKAN_DOKTER','C05 "Dokter dan Perawat" ditolak (paramedis menang, seperti aplikasi)');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000c6','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-00000000000f')$$,'PEMERIKSA_BUKAN_DOKTER','C06 tanpa jabatan ditolak');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000c7','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-000000000012')$$,'PEMERIKSA_BUKAN_DOKTER','C07 kasir ditolak');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000c8','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-000000000013')$$,'PEMERIKSA_BUKAN_DOKTER','C08 kata "Doktoral" bukan dokter');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000c9','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-000000000007')$$,'PEMERIKSA_TIDAK_VALID','C09 dokter nonaktif ditolak');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000ca','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-000000000008')$$,'PEMERIKSA_TIDAK_VALID','C10 dokter di Sampah ditolak');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000cb','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-0000000000ff')$$,'PEMERIKSA_TIDAK_VALID','C11 id yang tidak ada ditolak');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000cc','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-000000000009')$$,'PEMERIKSA_BUKAN_CABANG','C12 dokter cabang lain tanpa penugasan ditolak');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000cd','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-00000000000b')$$,'PEMERIKSA_BUKAN_CABANG','C13 penugasan sudah berakhir kemarin ditolak');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000ce','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-00000000000d')$$,'PEMERIKSA_BUKAN_CABANG','C14 penugasan baru mulai besok ditolak');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000d0','dd200000-0000-4000-8000-000000000001','Grooming',null,null,'dd500000-0000-4000-8000-000000000014')$$,'PEMERIKSA_BUKAN_CABANG','C17 penugasan aktif di cabang LAIN (C) tidak membuka cabang A');
select pg_temp.reject($$select pg_temp.mk('dd700000-0000-4000-8000-0000000000cf','dd200000-0000-4000-8000-000000000002','Grooming',null,null,'dd500000-0000-4000-8000-000000000001')$$,'PEMERIKSA_BUKAN_CABANG','C15 dokter cabang A tidak boleh memeriksa di cabang B');
select pg_temp.ok((select count(*) from visits where id::text like 'dd700000-0000-4000-8000-0000000000c%')=0,'C16 tak satu pun kunjungan ditolak yang tersimpan');

-- ── D. perubahan sesudah dibuat ──────────────────────────────────────────────────────────────────────
select pg_temp.accept($$update visits set pemeriksa_id='dd500000-0000-4000-8000-000000000002' where id='dd700000-0000-4000-8000-000000000001'$$,'D01 ganti pemeriksa sebelum ditagih diperbolehkan');
select pg_temp.accept($$update visits set pemeriksa_id='dd500000-0000-4000-8000-000000000001' where id='dd700000-0000-4000-8000-000000000002'$$,'D02 mengisi pemeriksa yang tadinya kosong sebelum ditagih diperbolehkan');
select pg_temp.reject($$update visits set pemeriksa_id='dd500000-0000-4000-8000-000000000003' where id='dd700000-0000-4000-8000-000000000002'$$,'PEMERIKSA_BUKAN_DOKTER','D03 mengganti ke groomer ditolak');
select pg_temp.reject($$update visits set pemeriksa_id='dd500000-0000-4000-8000-000000000009' where id='dd700000-0000-4000-8000-000000000002'$$,'PEMERIKSA_BUKAN_CABANG','D04 mengganti ke dokter cabang lain ditolak');
select pg_temp.ok(pg_temp.pem('dd700000-0000-4000-8000-000000000002')='dd500000-0000-4000-8000-000000000001','D05 penolakan tidak mengubah isi');
insert into invoices(id,visit_id,invoice_no) values('dd800000-0000-4000-8000-000000000001','dd700000-0000-4000-8000-000000000001','DD-INV-1');
select pg_temp.reject($$update visits set pemeriksa_id='dd500000-0000-4000-8000-000000000001' where id='dd700000-0000-4000-8000-000000000001'$$,'PEMERIKSA_TERKUNCI','D06 setelah ada tagihan pemeriksa tidak boleh diganti ke orang lain');
select pg_temp.accept($$update visits set keluhan='gatal',pemeriksa_id='dd500000-0000-4000-8000-000000000002' where id='dd700000-0000-4000-8000-000000000001'$$,'D07 menulis ulang pemeriksa yang SAMA setelah ditagih bukan perubahan (tidak ditolak)');
select pg_temp.accept($$update visits set status='Selesai' where id='dd700000-0000-4000-8000-000000000001'$$,'D08 kolom lain kunjungan bertagihan tetap bisa berubah (pagar hanya untuk pemeriksa)');
select pg_temp.accept($$update visits set pemeriksa_id=null where id='dd700000-0000-4000-8000-000000000001'$$,'D09 mengosongkan (mis. karyawan dihapus) tetap diperbolehkan');
select pg_temp.reject($$update visits set pemeriksa_id='dd500000-0000-4000-8000-000000000001' where id='dd700000-0000-4000-8000-000000000001'$$,'PEMERIKSA_TERKUNCI','D10 mengisi kembali setelah ditagih ditolak');
update invoices set voided_at=now() where id='dd800000-0000-4000-8000-000000000001';
select pg_temp.accept($$update visits set pemeriksa_id='dd500000-0000-4000-8000-000000000001' where id='dd700000-0000-4000-8000-000000000001'$$,'D11 tagihan Void tidak mengunci');
alter table visits disable trigger a0_guard_visit_archive; update visits set archived_at=now(),archived_by='dd100000-0000-4000-8000-000000000001',archive_reason='uji arsip' where id='dd700000-0000-4000-8000-000000000005'; alter table visits enable trigger a0_guard_visit_archive;
select pg_temp.reject($$update visits set pemeriksa_id='dd500000-0000-4000-8000-000000000001' where id='dd700000-0000-4000-8000-000000000005'$$,'PEMERIKSA_TERKUNCI','D12 kunjungan diarsipkan: pemeriksa tidak dapat diganti');
select pg_temp.accept($$update visits set pemeriksa_id=pemeriksa_id where id='dd700000-0000-4000-8000-000000000005'$$,'D13 tulis-ulang nilai yang sama pada kunjungan arsip tidak memicu pagar');
select pg_temp.accept($$update visits set doctor_id='dd500000-0000-4000-8000-000000000003' where id='dd700000-0000-4000-8000-000000000004'$$,'D14 mengubah doctor_id (jalur Ubah dokter PJ) tidak melewati pagar pemeriksa');
select pg_temp.ok((select pemeriksa_id is null from visits where id='dd700000-0000-4000-8000-000000000004'),'D15 mengubah doctor_id tidak mengisi pemeriksa');

-- ── E. tidak menyentuh uang, atribusi laporan tidak berubah ─────────────────────────────────────────
insert into invoices(id,visit_id,invoice_no,subtotal,total,paid_status,paid_at) values('dd800000-0000-4000-8000-000000000002','dd700000-0000-4000-8000-000000000006','DD-INV-2',300000,300000,'Lunas',now());
insert into invoice_items(id,invoice_id,item_id,deskripsi,qty,harga,service_performers) values
 ('dd900000-0000-4000-8000-000000000001','dd800000-0000-4000-8000-000000000002','dd600000-0000-4000-8000-000000000001','Grooming A',1,100000,null),
 ('dd900000-0000-4000-8000-000000000002','dd800000-0000-4000-8000-000000000002','dd600000-0000-4000-8000-000000000001','Grooming B',1,100000,'{"doctor_id":"dd500000-0000-4000-8000-000000000001","staff_id":"dd500000-0000-4000-8000-000000000003"}'),
 ('dd900000-0000-4000-8000-000000000003','dd800000-0000-4000-8000-000000000002','dd600000-0000-4000-8000-000000000001','Grooming C',1,100000,'{"doctor_id":null,"staff_id":"dd500000-0000-4000-8000-000000000003"}');
create temp table before_money as select
 (select md5(coalesce(string_agg(to_jsonb(i)::text,'|' order by i.id),'')) from invoice_items i) items,
 (select md5(coalesce(string_agg(to_jsonb(i)::text,'|' order by i.id),'')) from invoices i) inv,
 (select count(*) from journal_lines) jl, (select count(*) from journal_entries) je, (select count(*) from payrolls) pr;
select pg_temp.ok((select md5(coalesce(string_agg(to_jsonb(i)::text,'|' order by i.id),'')) from invoice_items i)=(select items from before_money) and (select count(*) from journal_lines)=(select jl from before_money) and (select count(*) from payrolls)=(select pr from before_money),'E01 memilih pemeriksa tidak menulis baris tagihan, jurnal, atau slip gaji');
-- Aturan atribusi laporan Tenaga Penjual/Komisi (komisi-data.ts & laporan-tenaga-penjual): performers baris -> penjual baris/tagihan -> dokter kunjungan (visits.doctor_id).
create function pg_temp.attrib(p_visit uuid) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(ii.id::text, case when ii.service_performers is not null then jsonb_build_array(ii.service_performers->>'doctor_id',ii.service_performers->>'staff_id')
  when coalesce(ii.salesperson_id,i.salesperson_id) is not null then jsonb_build_array(coalesce(ii.salesperson_id,i.salesperson_id)::text)
  else jsonb_build_array(vv.doctor_id::text) end),'{}')
 from invoice_items ii join invoices i on i.id=ii.invoice_id join visits vv on vv.id=i.visit_id where i.visit_id=p_visit and i.voided_at is null$$;
create temp table attrib_before as select pg_temp.attrib('dd700000-0000-4000-8000-000000000006') a;
update visits set doctor_id=doctor_id where id='dd700000-0000-4000-8000-000000000006';
select pg_temp.ok((select a from attrib_before)=pg_temp.attrib('dd700000-0000-4000-8000-000000000006'),'E02 atribusi laporan identik sebelum/sesudah kolom ada (tanpa pemeriksa)');
select pg_temp.ok(pg_temp.attrib('dd700000-0000-4000-8000-000000000006')->'dd900000-0000-4000-8000-000000000002'=jsonb_build_array('dd500000-0000-4000-8000-000000000001','dd500000-0000-4000-8000-000000000003'),'E03 baris berpelaksana eksplisit tetap dokter + groomer pilihan kasir');
select pg_temp.ok(pg_temp.attrib('dd700000-0000-4000-8000-000000000006')->'dd900000-0000-4000-8000-000000000003'=jsonb_build_array(null,'dd500000-0000-4000-8000-000000000003'),'E04 baris hanya-groomer tidak otomatis mendapat dokter dari kunjungan/pemeriksa');
-- pemeriksa pada kunjungan tidak mengubah atribusi baris tanpa pelaksana: tetap visits.doctor_id (aturan lama), bukan pemeriksa
select pg_temp.accept($$update visits set doctor_id='dd500000-0000-4000-8000-000000000003' where id='dd700000-0000-4000-8000-000000000006'$$,'E05 fixture: doctor_id kunjungan = groomer (seperti Grooming nyata)');
select pg_temp.ok(pg_temp.attrib('dd700000-0000-4000-8000-000000000006')->'dd900000-0000-4000-8000-000000000001'=jsonb_build_array('dd500000-0000-4000-8000-000000000003'),'E06 baris tanpa pelaksana tetap memakai visits.doctor_id lama; kolom pemeriksa tidak ikut menentukan komisi');
select pg_temp.ok((select pemeriksa_id from visits where id='dd700000-0000-4000-8000-000000000006')='dd500000-0000-4000-8000-00000000000e','E07 kunjungan itu tetap mencatat pemeriksanya (hanya tampilan/isian awal kasir)');
select pg_temp.ok((select md5(coalesce(string_agg(to_jsonb(i)::text,'|' order by i.id),'')) from invoice_items i)=(select items from before_money),'E08 baris tagihan identik setelah semua uji atribusi');

-- ── F. jalur klien login (RLS + pagar) ───────────────────────────────────────────────────────────────
select pg_temp.as_('dd100000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.accept($$insert into public.visits(id,branch_id,customer_id,pet_id,poli,doctor_id,dokter,pemeriksa_id,status,queue_number) values('dd700000-0000-4000-8000-0000000000f1','dd200000-0000-4000-8000-000000000001','dd300000-0000-4000-8000-000000000001','dd400000-0000-4000-8000-000000000001','Grooming','dd500000-0000-4000-8000-000000000003','Groomer Fiktif','dd500000-0000-4000-8000-000000000001','Menunggu','DD-F1')$$,'F01 staf klinik mendaftarkan Grooming dengan dokter pemeriksa lewat RLS');
select pg_temp.reject($$insert into public.visits(id,branch_id,customer_id,pet_id,poli,doctor_id,dokter,pemeriksa_id,status,queue_number) values('dd700000-0000-4000-8000-0000000000f2','dd200000-0000-4000-8000-000000000001','dd300000-0000-4000-8000-000000000001','dd400000-0000-4000-8000-000000000001','Grooming','dd500000-0000-4000-8000-000000000003','Groomer Fiktif','dd500000-0000-4000-8000-000000000003','Menunggu','DD-F2')$$,'PEMERIKSA_BUKAN_DOKTER','F02 pagar berlaku juga untuk klien login (groomer sebagai pemeriksa ditolak)');
select pg_temp.accept($$update public.visits set pemeriksa_id='dd500000-0000-4000-8000-000000000002' where id='dd700000-0000-4000-8000-0000000000f1'$$,'F03 staf dapat meralat pemeriksa sebelum ditagih');
select pg_temp.reject($$select clinic_private.guard_visit_pemeriksa()$$,'permission denied','F04 klien tidak dapat memanggil fungsi pagar langsung');
reset role; select pg_temp.dba();
select pg_temp.ok((select pemeriksa_id from visits where id='dd700000-0000-4000-8000-0000000000f1')='dd500000-0000-4000-8000-000000000002','F05 pilihan klien tersimpan');

-- ── G. pagar Admin Online dan kebersihan ─────────────────────────────────────────────────────────────
create temp table fence_before as select md5(string_agg(pg_get_functiondef(p.oid),'|' order by p.oid::regprocedure::text)) f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clinic_private' and p.prokind='f';
select admin_online_private.guard_all(); select admin_online_private.fence_all();
select pg_temp.ok((select f from fence_before)=(select md5(string_agg(pg_get_functiondef(p.oid),'|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clinic_private' and p.prokind='f'),'G01 guard_all/fence_all idempoten: tak ada fungsi clinic_private yang berubah lagi');
select pg_temp.ok(not exists(select 1 from pg_trigger t where t.tgrelid='public.visits'::regclass and t.tgname='b2_guard_visit_pemeriksa' and t.tgenabled='D'),'G02 pagar pemeriksa aktif (tidak dinonaktifkan)');
select pg_temp.ok((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like '%pemeriksa%' and c.relkind in('r','v','m'))=0,'G03 tidak ada tabel/tampilan baru (hanya satu kolom)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','clinic_private') and p.proname like '%pemeriksa%')=1,'G04 tepat satu fungsi baru');
-- Peran Admin Online tetap tidak bisa menulis kunjungan (termasuk kolom baru): pagar tulis visits utuh.
insert into auth.users(id,raw_user_meta_data) values('dd100000-0000-4000-8000-000000000003','{"full_name":"DD admin online"}') on conflict do nothing;
update profiles set role='ADMIN_ONLINE',is_active=true where id='dd100000-0000-4000-8000-000000000003';
insert into user_branches(user_id,branch_id) values('dd100000-0000-4000-8000-000000000003','dd200000-0000-4000-8000-000000000001') on conflict do nothing;
select pg_temp.as_('dd100000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.reject($$insert into public.visits(id,branch_id,customer_id,pet_id,poli,pemeriksa_id) values('dd700000-0000-4000-8000-0000000000a1','dd200000-0000-4000-8000-000000000001','dd300000-0000-4000-8000-000000000001','dd400000-0000-4000-8000-000000000001','Grooming','dd500000-0000-4000-8000-000000000001')$$,'ADMIN_ONLINE_WRITE_DENIED','G06 Admin Online tidak dapat mendaftarkan antrian (pagar tulis visits tetap)');
reset role; select pg_temp.dba();
rollback;
