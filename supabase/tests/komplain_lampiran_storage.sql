-- Komplain Pelanggan — lampiran di storage (migrasi 20261211200000_komplain_lampiran_storage): fixture fiktif, semuanya dibatalkan (rollback).
-- Dijalankan oleh scripts/test-komplain-lampiran-storage-postgres.py setelah pelari menyiapkan storage.objects seperti hosted (kolom owner_id, RLS aktif,
-- hak authenticated) lalu memasang migrasi. Setiap pernyataan benar = NOTICE BP_PASS.
-- Dibuktikan: berkas komplain/ hanya terbaca oleh pengunggah (selama belum terlampir), Owner, dan akun yang boleh melihat komplainnya; cabang lain/rekan
-- tidak bisa mendaftar, membaca, atau menghapus; lampiran terdaftar tidak bisa dihapus siapa pun; Admin Online ditolak dua lapis; unggah-dulu tetap jalan;
-- lampiran harus milik pemanggil; daftar petugas menurut peran pelihat; ACL/SECURITY DEFINER.
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

-- ── fixture tambahan: dokter cabang A (rekan), bucket, objek ───────────────────────────────────────────
insert into auth.users(id,raw_user_meta_data) values('c1000000-0000-4000-8000-000000000012','{"full_name":"KPL dokter A"}');
insert into uu(n,id) values('kd','c1000000-0000-4000-8000-000000000012');
update profiles set role='DOCTOR',is_active=true where id=pg_temp.u('kd');
insert into user_branches(user_id,branch_id) values(pg_temp.u('kd'),pg_temp.b('A'));
select pg_temp.ok(exists(select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='owner_id') and (select relrowsecurity from pg_class where oid='storage.objects'::regclass),'P0 prasyarat: storage.objects punya owner_id dan RLS aktif (seperti hosted)');
insert into storage.buckets(id,name,public) values('dokumen','dokumen',false),('medical-docs','medical-docs',false) on conflict do nothing;
create function pg_temp.obj(un text, nm text, bucket text default 'dokumen') returns void language sql as $$
 insert into storage.objects(bucket_id,name,owner,owner_id) values(bucket,nm,pg_temp.u(un),pg_temp.u(un)::text) $$;
select pg_temp.obj('kp','komplain/1700000000001-a1.jpg'),pg_temp.obj('kp','komplain/1700000000002-a2.jpg'),pg_temp.obj('kk','komplain/1700000000003-k1.jpg'),
       pg_temp.obj('kp','komplain/1700000000004-p1.jpg'),pg_temp.obj('st2','komplain/1700000000005-o-st2.jpg'),pg_temp.obj('kp','komplain/1700000000006-o-kp.jpg'),
       pg_temp.obj('kk','komplain/1700000000007-o-kk.jpg'),pg_temp.obj('kp','komplain/1700000000008-o-kp2.jpg');
select pg_temp.obj('off','komplain/1700000000015-o-off.jpg'),pg_temp.obj('ao','komplain/1700000000016-o-ao.jpg');
insert into storage.objects(bucket_id,name,owner,owner_id) values('dokumen','komplain/1700000000017-o-anon.jpg',null,null);
-- bukan berkas komplain (harus tetap seperti semula): nama mirip, bucket lain, folder modul lain
select pg_temp.obj('kp','komplain/1700000000099-med.jpg','medical-docs'),pg_temp.obj('kp','komplainx/1-x.jpg'),pg_temp.obj('kp','Komplain/1-x.jpg'),pg_temp.obj('kp','x/komplain/1.jpg'),
       pg_temp.obj('kp','komplain'),pg_temp.obj('fin','pengeluaran/1700000000010-nota.jpg'),pg_temp.obj('st2','pembelian/1700000000011-faktur.pdf'),
       pg_temp.obj('kp','penjualan-online/1700000000012-bukti.jpg'),pg_temp.obj('kp','klinik-x/c1000000-0000-4000-8000-0000000000aa/1700000000013-f.jpg');
-- objek lama tanpa owner_id (hanya kolom owner terisi): harus tetap diperlakukan sebagai milik pengunggah
insert into storage.objects(bucket_id,name,owner,owner_id) values('dokumen','komplain/1700000000014-o-lama.jpg',pg_temp.u('stx'),null);

create function pg_temp.kb(un text) returns text language sql as $$
 select pg_temp.ra(un,'select coalesce(string_agg(substring(name from ''-(.*)$''),'','' order by name),''-'') from storage.objects where bucket_id=''dokumen'' and name like ''komplain/%''') $$;
create function pg_temp.dl(un text, nm text, bucket text default 'dokumen') returns text language plpgsql as $$
declare n int;
begin
 perform set_config('request.jwt.claim.sub',(select id::text from uu where uu.n=un),true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin
  execute 'set local role authenticated';
  execute format('delete from storage.objects where bucket_id=%L and name=%L',bucket,nm);get diagnostics n=row_count;
  raise exception 'BATAL_%',n;
 exception when others then
  execute 'reset role';
  if sqlerrm like 'BATAL\_%' then return 'dihapus='||substr(sqlerrm,7); end if;
  return 'ERR:'||sqlerrm;
 end;
end$$;
create function pg_temp.ins(un text, nm text, bucket text default 'dokumen', ret boolean default true) returns text language plpgsql as $$
declare r text;
begin
 perform set_config('request.jwt.claim.sub',(select id::text from uu where uu.n=un),true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin
  execute 'set local role authenticated';
  if ret then
   execute format('insert into storage.objects(bucket_id,name,owner,owner_id) values(%L,%L,%L::uuid,%L) returning name',bucket,nm,(select id from uu where uu.n=un),(select id::text from uu where uu.n=un)) into r;
  else
   execute format('insert into storage.objects(bucket_id,name,owner,owner_id) values(%L,%L,%L::uuid,%L)',bucket,nm,(select id from uu where uu.n=un),(select id::text from uu where uu.n=un)); r:='tanpa-returning';
  end if;
  raise exception 'BATAL_%',coalesce(r,'kosong');
 exception when others then
  execute 'reset role';
  if sqlerrm like 'BATAL\_%' then return 'OK'; end if;
  return 'ERR:'||sqlerrm;
 end;
end$$;
create function pg_temp.upd(un text, nm text, bucket text default 'dokumen') returns text language plpgsql as $$
declare n int;
begin
 perform set_config('request.jwt.claim.sub',(select id::text from uu where uu.n=un),true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin
  execute 'set local role authenticated';
  execute format('update storage.objects set name=name where bucket_id=%L and name=%L',bucket,nm);get diagnostics n=row_count;
  raise exception 'BATAL_%',n;
 exception when others then
  execute 'reset role';
  if sqlerrm like 'BATAL\_%' then return 'diubah='||substr(sqlerrm,7); end if;
  return 'ERR:'||sqlerrm;
 end;
end$$;
create function pg_temp.cnt_name(un text, nm text) returns text language sql as $$
 select pg_temp.ra(un,format('select count(*)::text from storage.objects where bucket_id=''dokumen'' and name=%L',nm)) $$;

-- ── P1. lampiran harus milik pemanggil (RPC), sebelum berkas dilampirkan ─────────────────────────────
select pg_temp.has(pg_temp.mk('kp','l1','A',jsonb_build_object('lamp','[{"path":"komplain/1700000000005-o-st2.jpg","nama":"punya st2.jpg"}]'::jsonb)),'KOMPLAIN_LAMPIRAN_MILIK','P1 melampirkan berkas milik akun lain ditolak');
select pg_temp.has(pg_temp.mk('kp','l2','A',jsonb_build_object('lamp','[{"path":"komplain/1700000000555-tidak-ada.jpg","nama":"hantu.jpg"}]'::jsonb)),'KOMPLAIN_LAMPIRAN_MILIK','P1 melampirkan jalur yang tidak pernah diunggah ditolak');
select pg_temp.has(pg_temp.mk('kp','l3','A',jsonb_build_object('lamp','[{"path":"komplain/1700000000099-med.jpg","nama":"med.jpg"}]'::jsonb)),'KOMPLAIN_LAMPIRAN_MILIK','P1 berkas di bucket lain (bukan dokumen) tidak dihitung');
select pg_temp.has(pg_temp.mk('kp','l4','A',jsonb_build_object('lamp','[{"path":"komplain/1700000000001-a1.jpg","nama":"a1.jpg"},{"path":"komplain/1700000000003-k1.jpg","nama":"k1 milik kk.jpg"}]'::jsonb)),'KOMPLAIN_LAMPIRAN_MILIK','P1 satu berkas milik orang lain di antara berkas sendiri menggagalkan semuanya');
select pg_temp.has(pg_temp.mk('adm','l5','A',jsonb_build_object('lamp','[{"path":"komplain/1700000000001-a1.jpg","nama":"a1.jpg"}]'::jsonb)),'KOMPLAIN_LAMPIRAN_MILIK','P1 Admin pun tidak bisa melampirkan berkas orang lain (hanya unggahan sendiri)');
select pg_temp.eq((select count(*)::text from customer_complaints),'0','P1 penolakan tidak meninggalkan komplain setengah jadi');
select pg_temp.mkc('cA','kp','A',jsonb_build_object('desk','Struk salah, foto terlampir','lamp','[{"path":"komplain/1700000000001-a1.jpg","nama":"a1.jpg","mime":"image/jpeg","ukuran":100},{"path":"komplain/1700000000002-a2.jpg","nama":"a2.jpg","mime":"image/jpeg","ukuran":100}]'::jsonb));
select pg_temp.mkc('cK','kk','K',jsonb_build_object('desk','Foto hasil lab bocor','lamp','[{"path":"komplain/1700000000003-k1.jpg","nama":"k1.jpg"}]'::jsonb));
select pg_temp.mkc('cP','kp','A',jsonb_build_object('desk','Ditugaskan ke rekan','petugas',pg_temp.u('st2')::text,'lamp','[{"path":"komplain/1700000000004-p1.jpg","nama":"p1.jpg"}]'::jsonb));
select pg_temp.mkc('c0','kp','A',jsonb_build_object('desk','Tanpa lampiran sama sekali','lamp','[]'::jsonb));
select pg_temp.eq((select count(*)::text from customer_complaint_files),'4','P1 empat lampiran tercatat (dua + satu + satu)');
select pg_temp.has(pg_temp.ra('kp',format('select public.komplain_catatan(%L::uuid,''coba'',%L::jsonb,%L::uuid)::text',pg_temp.c('cA'),'[{"path":"komplain/1700000000005-o-st2.jpg","nama":"punya st2.jpg"}]',pg_temp.k('cat-milik'))),'KOMPLAIN_LAMPIRAN_MILIK','P1 catatan: berkas milik akun lain ditolak');
select pg_temp.eq(left(pg_temp.ra('kp',format('select public.komplain_catatan(%L::uuid,''bukti tambahan'',%L::jsonb,%L::uuid)::text',pg_temp.c('cA'),'[{"path":"komplain/1700000000008-o-kp2.jpg","nama":"o-kp2.jpg"}]',pg_temp.k('cat-ok'))),1),'{','P1 catatan: berkas sendiri diterima');
select pg_temp.eq(left(pg_temp.ra('stx',format('select public.komplain_buat(%L::uuid,%L::uuid,''Petshop'',null,null,null,null,null,null,null,%L::uuid,''Sedang'',''Berkas lama tanpa owner_id'',null,null,null,null,%L::jsonb)::text',pg_temp.k('lama'),pg_temp.b('X'),pg_temp.cat('Grooming'),'[{"path":"komplain/1700000000014-o-lama.jpg","nama":"lama.jpg"}]')),1),'{','P1 objek lama tanpa owner_id dipakai kolom owner (pemilik = penunggah)');
select pg_temp.eq(pg_temp.kb('stx'),'o-lama.jpg','P1 objek lama (owner_id kosong, owner = stx) terbaca oleh pemiliknya setelah terlampir ke komplain miliknya');

-- ── P2. membaca / mendaftar berkas komplain/ per peran ────────────────────────────────────────────────
select pg_temp.eq(pg_temp.kb('kp'),'a1.jpg,a2.jpg,p1.jpg,o-kp.jpg,o-kp2.jpg','P2 pembuat (STAFF A): lampiran komplainnya + unggahan sendiri yang belum terlampir; tidak melihat berkas cabang K maupun milik rekan');
select pg_temp.eq(pg_temp.kb('st2'),'p1.jpg,o-st2.jpg','P2 rekan satu cabang: hanya miliknya + berkas komplain yang ditugaskan kepadanya; TIDAK melihat a1/a2');
select pg_temp.eq(pg_temp.kb('kk'),'k1.jpg,o-kk.jpg','P2 dokter cabang K: berkasnya sendiri');
select pg_temp.eq(pg_temp.kb('stx'),'o-lama.jpg','P2 staf cabang lain: tidak melihat satu pun berkas komplain cabang A/K (hanya miliknya)');
select pg_temp.eq(pg_temp.kb('kd'),'-','P2 dokter cabang A lain: tidak melihat apa pun');
select pg_temp.eq(pg_temp.kb('own'),'a1.jpg,a2.jpg,k1.jpg,p1.jpg,o-st2.jpg,o-kp.jpg,o-kk.jpg,o-kp2.jpg,o-lama.jpg,o-off.jpg,o-ao.jpg,o-anon.jpg','P2 Owner membaca semua berkas komplain/ (terlampir maupun belum)');
select pg_temp.eq(pg_temp.kb('adm'),'a1.jpg,a2.jpg,k1.jpg,p1.jpg,o-kp2.jpg,o-lama.jpg','P2 Admin: berkas yang terlampir pada komplain yang boleh dilihatnya (semua cabang), bukan unggahan orang yang belum terlampir');
select pg_temp.eq(pg_temp.kb('fin'),pg_temp.kb('adm'),'P2 Finance sama dengan Admin');
select pg_temp.eq(pg_temp.kb('ao'),'-','P2 Admin Online: nol berkas komplain (bahkan unggahannya sendiri)');
select pg_temp.eq(pg_temp.kb('off'),'-','P2 akun nonaktif: nol berkas (bahkan unggahannya sendiri)');
select pg_temp.eq(pg_temp.ra('stx','select count(*)::text from storage.objects where bucket_id=''medical-docs'' and name like ''komplain/%'''),'1','P2 bucket lain: objek bernama komplain/... tetap terbaca (kebijakan lama medical_docs_read)');
select pg_temp.eq(pg_temp.cnt_name('stx','komplainx/1-x.jpg')||pg_temp.cnt_name('stx','komplain'),'11','P2 nama mirip (komplainx/..., komplain) tetap terbaca seperti semula');
select pg_temp.eq(pg_temp.kb('kl'),'-','P2 staf tanpa izin kelola yang bukan pembuat/petugas: nol');
select pg_temp.grant_kelola('STAFF');
select pg_temp.eq(pg_temp.kb('kl'),'a1.jpg,a2.jpg,p1.jpg,o-kp2.jpg','P2 pemegang izin kelola (cabang A) membaca lampiran terlampir di cabang A, bukan cabang K');
select pg_temp.revoke_kelola('STAFF');
select pg_temp.eq(pg_temp.kb('kl'),'-','P2 izin kelola dicabut = akses berkas hilang lagi');
select pg_temp.eq(pg_temp.cnt_name('stx','komplain/1700000000001-a1.jpg'),'0','P2 staf cabang lain tidak bisa membaca a1 walau menyebut nama persisnya');
select pg_temp.eq(pg_temp.cnt_name('st2','komplain/1700000000001-a1.jpg'),'0','P2 rekan satu cabang tidak bisa membaca a1 dengan nama persis');
select pg_temp.eq(pg_temp.cnt_name('kp','komplain/1700000000001-a1.jpg'),'1','P2 pembuat membaca a1 dengan nama persis');
select pg_temp.eq(pg_temp.cnt_name('kk','komplain/1700000000001-a1.jpg'),'0','P2 dokter cabang K tidak bisa membaca a1');
-- staf pindah cabang kehilangan akses ke lampiran komplain lama
delete from user_branches where user_id=pg_temp.u('kp') and branch_id=pg_temp.b('A'); insert into user_branches(user_id,branch_id) values(pg_temp.u('kp'),pg_temp.b('X'));
select pg_temp.eq(pg_temp.kb('kp'),'o-kp.jpg','P2 staf pindah cabang: lampiran terlampir ke komplain lama tidak lagi terbaca (unggahan yatim sendiri tetap)');
delete from user_branches where user_id=pg_temp.u('kp') and branch_id=pg_temp.b('X'); insert into user_branches(user_id,branch_id) values(pg_temp.u('kp'),pg_temp.b('A'));
select pg_temp.eq(pg_temp.kb('kp'),'a1.jpg,a2.jpg,p1.jpg,o-kp.jpg,o-kp2.jpg','P2 kembali ke cabang A = akses kembali');

-- ── P3. menghapus berkas komplain/ ─────────────────────────────────────────────────────────────────────
select pg_temp.eq(pg_temp.dl('stx','komplain/1700000000001-a1.jpg'),'dihapus=0','P3 staf cabang lain TIDAK bisa menghapus lampiran komplain cabang A (temuan MAJOR-1)');
select pg_temp.eq(pg_temp.dl('st2','komplain/1700000000001-a1.jpg'),'dihapus=0','P3 rekan satu cabang tidak bisa menghapus lampiran');
select pg_temp.eq(pg_temp.dl('kp','komplain/1700000000001-a1.jpg'),'dihapus=0','P3 pengunggah pun tidak bisa menghapus berkas yang sudah terlampir');
select pg_temp.eq(pg_temp.dl('own','komplain/1700000000001-a1.jpg'),'dihapus=0','P3 Owner tidak bisa menghapus berkas yang sudah terlampir');
select pg_temp.eq(pg_temp.dl('adm','komplain/1700000000001-a1.jpg'),'dihapus=0','P3 Admin tidak bisa menghapus berkas terlampir');
select pg_temp.eq(pg_temp.dl('ao','komplain/1700000000001-a1.jpg'),'dihapus=0','P3 Admin Online tidak bisa menghapus berkas terlampir');
select pg_temp.eq(pg_temp.dl('kp','komplain/1700000000006-o-kp.jpg'),'dihapus=1','P3 pengunggah menghapus unggahannya sendiri yang belum terlampir');
select pg_temp.eq(pg_temp.dl('st2','komplain/1700000000006-o-kp.jpg'),'dihapus=0','P3 rekan tidak bisa menghapus unggahan yatim orang lain');
select pg_temp.eq(pg_temp.dl('adm','komplain/1700000000006-o-kp.jpg'),'dihapus=0','P3 Admin tidak bisa menghapus unggahan yatim orang lain');
select pg_temp.eq(pg_temp.dl('fin','komplain/1700000000006-o-kp.jpg'),'dihapus=0','P3 Finance tidak bisa menghapus unggahan yatim orang lain');
select pg_temp.eq(pg_temp.dl('ao','komplain/1700000000006-o-kp.jpg'),'dihapus=0','P3 Admin Online tidak bisa menghapus unggahan yatim');
select pg_temp.eq(pg_temp.dl('off','komplain/1700000000006-o-kp.jpg'),'dihapus=0','P3 akun nonaktif tidak bisa menghapus');
select pg_temp.eq(pg_temp.dl('off','komplain/1700000000015-o-off.jpg'),'dihapus=0','P3 akun nonaktif tidak bisa menghapus unggahannya sendiri');
select pg_temp.eq(pg_temp.dl('ao','komplain/1700000000016-o-ao.jpg'),'dihapus=0','P3 Admin Online tidak bisa menghapus unggahannya sendiri');
select pg_temp.eq(pg_temp.dl('own','komplain/1700000000005-o-st2.jpg'),'dihapus=1','P3 Owner boleh membersihkan unggahan yatim orang lain (hanya yang belum terlampir)');
select pg_temp.eq(pg_temp.dl('kk','komplain/1700000000005-o-st2.jpg'),'dihapus=0','P3 dokter lain tidak bisa menghapus unggahan yatim st2');
select pg_temp.eq(pg_temp.dl('stx','komplain/1700000000014-o-lama.jpg'),'dihapus=0','P3 berkas lama yang sudah terlampir pada komplain: pemiliknya pun tidak bisa menghapus');
-- berkas yang belum terlampir lalu dilampirkan: tidak bisa dihapus lagi
select pg_temp.eq(pg_temp.dl('kp','komplain/1700000000008-o-kp2.jpg'),'dihapus=0','P3 o-kp2 sudah dilampirkan lewat catatan P1: kini tidak bisa dihapus pengunggahnya');
-- objek nonkomplain tetap seperti semula
select pg_temp.eq(pg_temp.dl('kp','komplainx/1-x.jpg'),'dihapus=1','P3 nama mirip (komplainx/) tidak terkena aturan baru');
select pg_temp.eq(pg_temp.dl('stx','Komplain/1-x.jpg'),'dihapus=1','P3 huruf besar Komplain/ tidak terkena aturan baru (dokumen_delete lama)');
select pg_temp.eq(pg_temp.dl('stx','x/komplain/1.jpg'),'dihapus=1','P3 komplain/ di tengah jalur tidak terkena');
select pg_temp.eq(pg_temp.dl('stx','komplain'),'dihapus=1','P3 nama "komplain" tanpa garis miring tidak terkena');
select pg_temp.eq(pg_temp.dl('stx','komplain/1700000000099-med.jpg','medical-docs'),'dihapus=1','P3 bucket medical-docs dengan nama komplain/... tidak terkena');
select pg_temp.eq(pg_temp.dl('stx','pengeluaran/1700000000010-nota.jpg'),'dihapus=1','P3 pengeluaran/ tetap bisa dihapus akun mana pun seperti sebelumnya');
select pg_temp.eq(pg_temp.dl('stx','pembelian/1700000000011-faktur.pdf'),'dihapus=1','P3 pembelian/ tetap seperti sebelumnya');
select pg_temp.eq(pg_temp.dl('stx','penjualan-online/1700000000012-bukti.jpg'),'dihapus=1','P3 penjualan-online/ tetap seperti sebelumnya');
select pg_temp.eq(pg_temp.dl('stx','klinik-x/c1000000-0000-4000-8000-0000000000aa/1700000000013-f.jpg'),'dihapus=1','P3 folder modul/refId tetap seperti sebelumnya');
select pg_temp.eq(pg_temp.dl('ao','pengeluaran/1700000000010-nota.jpg'),'dihapus=0','P3 Admin Online tetap ditolak di pengeluaran/ (pagar lama)');

-- ── P4. unggah (insert): unggah-dulu tetap jalan ────────────────────────────────────────────────────────
select pg_temp.eq(pg_temp.ins('kp','komplain/1700000001001-baru-kp.jpg'),'OK','P4 STAFF boleh mengunggah SEBELUM komplain ada (insert ... returning lolos)');
select pg_temp.eq(pg_temp.ins('kk','komplain/1700000001002-baru-kk.jpg'),'OK','P4 DOCTOR boleh mengunggah');
select pg_temp.eq(pg_temp.ins('stx','komplain/1700000001003-baru-stx.jpg'),'OK','P4 staf cabang lain boleh mengunggah (hak melihat komplain tidak diperlukan untuk unggah)');
select pg_temp.eq(pg_temp.ins('adm','komplain/1700000001004-baru-adm.jpg'),'OK','P4 Admin boleh mengunggah');
select pg_temp.eq(pg_temp.ins('fin','komplain/1700000001005-baru-fin.jpg'),'OK','P4 Finance boleh mengunggah');
select pg_temp.eq(pg_temp.ins('own','komplain/1700000001006-baru-own.jpg'),'OK','P4 Owner boleh mengunggah');
select pg_temp.has(pg_temp.ins('ao','komplain/1700000001007-baru-ao.jpg'),'row-level security','P4 Admin Online ditolak mengunggah ke komplain/');
select pg_temp.has(pg_temp.ins('off','komplain/1700000001008-baru-off.jpg'),'row-level security','P4 akun nonaktif ditolak mengunggah ke komplain/');
select pg_temp.has(pg_temp.ins('off','komplain/1700000001015-baru-off.jpg','dokumen',false),'komplain_berkas_tulis_ketat','P4 akun nonaktif ditolak oleh kebijakan INSERT sendiri (tanpa RETURNING, jadi bukan kebijakan baca)');
select pg_temp.eq(pg_temp.ins('kp','komplain/1700000001016-baru-kp.jpg','dokumen',false),'OK','P4 unggah tanpa RETURNING oleh STAFF tetap jalan');
select pg_temp.eq(pg_temp.ins('kp','pengeluaran/1700000001009-nota.jpg'),'OK','P4 pengeluaran/ tetap bisa diunggah');
select pg_temp.eq(pg_temp.ins('off','pengeluaran/1700000001010-nota.jpg'),'OK','P4 akun nonaktif di pengeluaran/ tetap seperti sebelumnya (kebijakan lama tidak memeriksa akun; bukan wilayah tambalan ini)');
select pg_temp.has(pg_temp.ins('ao','pengeluaran/1700000001011-nota.jpg'),'row-level security','P4 Admin Online tetap ditolak di pengeluaran/ (pagar lama)');
select pg_temp.eq(pg_temp.ins('off','Komplain/1700000001012-x.jpg'),'OK','P4 huruf besar Komplain/ tidak terkena aturan baru');
select pg_temp.eq(pg_temp.ins('off','komplainx/1700000001013-x.jpg'),'OK','P4 nama mirip komplainx/ tidak terkena aturan baru');
select pg_temp.eq(pg_temp.ins('off','komplain/1700000001014-m.jpg','medical-docs'),'OK','P4 bucket medical-docs dengan nama komplain/... tidak terkena aturan baru');

-- ── P5. ubah (update): tertutup untuk komplain/ walau kelak ada kebijakan UPDATE yang longgar ─────────────
create policy tmp_dokumen_ubah on storage.objects for update to authenticated using (bucket_id='dokumen') with check (bucket_id='dokumen');
select pg_temp.eq(pg_temp.upd('kp','komplain/1700000000001-a1.jpg'),'diubah=0','P5 berkas komplain/ tidak bisa diubah walau ada kebijakan UPDATE longgar');
select pg_temp.eq(pg_temp.upd('own','komplain/1700000000001-a1.jpg'),'diubah=0','P5 Owner pun tidak');
select pg_temp.eq(pg_temp.upd('kp','pengeluaran/1700000000010-nota.jpg'),'diubah=1','P5 kontrol: objek lain bisa diubah dengan kebijakan longgar yang sama (tambalan hanya mengetatkan komplain/)');
select pg_temp.eq(pg_temp.upd('stx','Komplain/1-x.jpg'),'diubah=1','P5 kontrol: huruf besar tidak terkena');
select pg_temp.eq(pg_temp.upd('kp','komplainx/1-x.jpg'),'diubah=1','P5 kontrol: nama mirip komplainx/ tidak terkena');
select pg_temp.eq(pg_temp.upd('kp','komplain/1700000000099-med.jpg','medical-docs'),'diubah=1','P5 kontrol: bucket medical-docs dengan nama komplain/... tidak terkena (kebijakan lama medical_docs_update)');
drop policy tmp_dokumen_ubah on storage.objects;

-- ── P6. Admin Online ditolak DUA lapis ─────────────────────────────────────────────────────────────────
select pg_temp.eq(pg_temp.kb('ao'),'-','P6 lapis 1+2 aktif: nol berkas');
drop policy admin_online_fence_storage on storage.objects;
select pg_temp.eq(pg_temp.ra('ao','select count(*)::text from storage.objects where bucket_id=''dokumen'' and name like ''pengeluaran/%'''),'1','P6 kontrol: tanpa pagar lama Admin Online memang bisa membaca pengeluaran/ (pagar benar-benar dilepas)');
select pg_temp.eq(pg_temp.kb('ao'),'-','P6 pagar lama dilepas: kebijakan komplain sendiri tetap menolak baca');
select pg_temp.eq(pg_temp.dl('ao','komplain/1700000000006-o-kp.jpg'),'dihapus=0','P6 pagar lama dilepas: tetap tak bisa hapus');
select pg_temp.eq(pg_temp.dl('ao','komplain/1700000000016-o-ao.jpg'),'dihapus=0','P6 pagar lama dilepas: tak bisa menghapus unggahannya sendiri');
select pg_temp.has(pg_temp.ins('ao','komplain/1700000002001-ao.jpg'),'row-level security','P6 pagar lama dilepas: tetap tak bisa mengunggah ke komplain/');
select pg_temp.has(pg_temp.ins('ao','komplain/1700000002003-ao.jpg','dokumen',false),'komplain_berkas_tulis_ketat','P6 pagar lama dilepas: kebijakan INSERT komplain sendiri menolak Admin Online (tanpa RETURNING)');
select pg_temp.eq(pg_temp.ins('ao','pengeluaran/1700000002002-ao.jpg'),'OK','P6 kontrol: tanpa pagar lama Admin Online bisa mengunggah ke pengeluaran/');
create policy admin_online_fence_storage on storage.objects as restrictive for all to authenticated using (not (select admin_online_private.is_admin_online())) with check (not (select admin_online_private.is_admin_online()));

-- ── P7. fungsi kebijakan: ACL, SECURITY DEFINER, tanpa kebocoran ──────────────────────────────────────────
select pg_temp.eq((select count(*)::text from pg_proc where pronamespace='public'::regnamespace and proname like 'komplain\_berkas\_%'),'2','P7 tepat dua fungsi kebijakan storage');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'komplain\_berkas\_%' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or not has_function_privilege('authenticated',p.oid,'execute'))),'P7 hanya authenticated yang bisa menjalankan fungsi kebijakan (bukan anon/service_role/public)');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'komplain\_berkas\_%' and not (p.prosecdef and coalesce(p.proconfig,'{}') @> array['search_path=""'])),'P7 fungsi kebijakan SECURITY DEFINER ber-search_path kosong');
select pg_temp.has(pg_temp.an('select public.komplain_berkas_boleh_baca(''komplain/x'',null)::text'),'permission denied','P7 anon tidak boleh memanggil fungsi kebijakan baca');
select pg_temp.has(pg_temp.an('select public.komplain_berkas_boleh_hapus(''komplain/x'',null)::text'),'permission denied','P7 anon tidak boleh memanggil fungsi kebijakan hapus');
select pg_temp.eq(pg_temp.ra('ao','select public.komplain_berkas_boleh_baca(''komplain/1700000000001-a1.jpg'',null)::text'),'false','P7 Admin Online memanggil langsung: false');
select pg_temp.eq(pg_temp.ra('stx','select public.komplain_berkas_boleh_baca(''komplain/1700000000001-a1.jpg'',null)::text'),'false','P7 staf cabang lain memanggil langsung berkas orang lain: false');
select pg_temp.eq(pg_temp.ra('stx','select public.komplain_berkas_boleh_hapus(''komplain/1700000000001-a1.jpg'',null)::text'),'false','P7 hapus langsung berkas terlampir: false');
select pg_temp.eq(pg_temp.ra('stx','select public.komplain_berkas_boleh_hapus(''komplain/tidak-ada'',null)::text'),'false','P7 hapus langsung tanpa pemilik: false (null tidak lolos)');
create function pg_temp.fh(un text, nm text, own text) returns text language sql as $$
 select pg_temp.ra(un,format('select public.komplain_berkas_boleh_hapus(%L,%L)::text',nm,case when own is null then null else pg_temp.u(own)::text end)) $$;
create function pg_temp.fb(un text, nm text, own text) returns text language sql as $$
 select pg_temp.ra(un,format('select public.komplain_berkas_boleh_baca(%L,%L)::text',nm,case when own is null then null else pg_temp.u(own)::text end)) $$;
select pg_temp.eq(pg_temp.fh('kp','komplain/1700000000006-o-kp.jpg','kp'),'true','P7 fungsi hapus: pengunggah, belum terlampir = true');
select pg_temp.eq(pg_temp.fh('own','komplain/1700000000006-o-kp.jpg','kp'),'true','P7 fungsi hapus: Owner, belum terlampir = true');
select pg_temp.eq(pg_temp.fh('adm','komplain/1700000000006-o-kp.jpg','kp'),'false','P7 fungsi hapus: Admin bukan pengunggah = false');
select pg_temp.eq(pg_temp.fh('fin','komplain/1700000000006-o-kp.jpg','kp'),'false','P7 fungsi hapus: Finance bukan pengunggah = false');
select pg_temp.eq(pg_temp.fh('st2','komplain/1700000000006-o-kp.jpg','kp'),'false','P7 fungsi hapus: rekan bukan pengunggah = false');
select pg_temp.eq(pg_temp.fh('kp','komplain/1700000000001-a1.jpg','kp'),'false','P7 fungsi hapus: pengunggah tapi sudah terlampir = false');
select pg_temp.eq(pg_temp.fh('own','komplain/1700000000001-a1.jpg','kp'),'false','P7 fungsi hapus: Owner tapi sudah terlampir = false');
select pg_temp.eq(pg_temp.fh('off','komplain/1700000000015-o-off.jpg','off'),'false','P7 fungsi hapus: akun nonaktif pengunggah = false (peran dicek di fungsi sendiri)');
select pg_temp.eq(pg_temp.fh('ao','komplain/1700000000016-o-ao.jpg','ao'),'false','P7 fungsi hapus: Admin Online pengunggah = false');
select pg_temp.eq(pg_temp.fh('kp','komplain/1700000000006-o-kp.jpg',null),'false','P7 fungsi hapus: pemilik tidak diketahui = false');
select pg_temp.eq(pg_temp.fb('off','komplain/1700000000015-o-off.jpg','off'),'false','P7 fungsi baca: akun nonaktif pengunggah = false');
select pg_temp.eq(pg_temp.fb('ao','komplain/1700000000016-o-ao.jpg','ao'),'false','P7 fungsi baca: Admin Online pengunggah = false');
select pg_temp.eq(pg_temp.fb('kp','komplain/1700000000006-o-kp.jpg','kp'),'true','P7 fungsi baca: pengunggah, belum terlampir = true');
select pg_temp.eq(pg_temp.fb('st2','komplain/1700000000006-o-kp.jpg','kp'),'false','P7 fungsi baca: rekan = false (pemilik bukan pemanggil)');
select pg_temp.eq(pg_temp.fb('adm','komplain/1700000000006-o-kp.jpg','kp'),'false','P7 fungsi baca: Admin tidak membaca yatim orang lain');
select pg_temp.eq(pg_temp.fb('kp','komplain/1700000000017-o-anon.jpg',null),'false','P7 fungsi baca: objek tanpa pemilik tidak terbaca siapa pun kecuali Owner');
select pg_temp.eq(pg_temp.fb('own','komplain/1700000000017-o-anon.jpg',null),'true','P7 fungsi baca: Owner membaca objek tanpa pemilik');
select pg_temp.eq(pg_temp.fb('kp','komplain/1700000000001-a1.jpg','kp'),'true','P7 fungsi baca: lampiran terlampir pada komplain sendiri = true');
select pg_temp.eq((select string_agg(polname||':'||polcmd::text||':'||(not polpermissive)::text,',' order by polname) from pg_policy where polrelid='storage.objects'::regclass and polname like 'komplain\_berkas\_%'),
  'komplain_berkas_baca_ketat:r:true,komplain_berkas_hapus_ketat:d:true,komplain_berkas_tulis_ketat:a:true,komplain_berkas_ubah_ketat:w:true','P7 empat kebijakan: semuanya RESTRICTIVE untuk SELECT/DELETE/INSERT/UPDATE');
select pg_temp.eq((select string_agg(distinct pg_get_userbyid(r),',') from pg_policy p, unnest(p.polroles) r where polrelid='storage.objects'::regclass and polname like 'komplain\_berkas\_%'),'authenticated','P7 kebijakan hanya untuk authenticated');
select pg_temp.eq((select string_agg(polname,',' order by polname) from pg_policy where polrelid='storage.objects'::regclass and polname in('dokumen_read','dokumen_write','dokumen_delete') and polpermissive),'dokumen_delete,dokumen_read,dokumen_write','P7 kebijakan lama dokumen_* tetap ada (tambalan hanya menambah pembatas)');
select pg_temp.eq((select qual from pg_policies where schemaname='storage' and tablename='objects' and policyname='dokumen_read'),'(bucket_id = ''dokumen''::text)','P7 dokumen_read tidak berubah');

-- ── P8. daftar petugas menurut peran pelihat (MINOR-1) ───────────────────────────────────────────────────
create function pg_temp.pt(un text, br text) returns text language sql as $$
 select pg_temp.ra(un,format('select coalesce(string_agg(e->>''nama'',''|'' order by e->>''nama''),''-'') from jsonb_array_elements(public.komplain_pilihan(%L::uuid)->''petugas'') e',pg_temp.b(br))) $$;
select pg_temp.eq(pg_temp.pt('kp','A'),'KPL dokter A|KPL kasir petshop|KPL staff dua|KPL staff kelola','P8 STAFF hanya melihat rekan STAFF/DOCTOR cabangnya (Owner/Admin/Finance tersembunyi)');
select pg_temp.eq(pg_temp.pt('kd','A'),pg_temp.pt('kp','A'),'P8 DOCTOR sama dengan STAFF');
select pg_temp.eq(pg_temp.pt('kk','K'),'KPL dokter klinik','P8 dokter cabang K: hanya dirinya (tak ada rekan lain)');
select pg_temp.eq(pg_temp.pt('own','A'),'KPL admin|KPL admin terbatas|KPL dokter A|KPL finance|KPL kasir petshop|KPL owner|KPL staff dua|KPL staff kelola','P8 Owner melihat semua akun yang bisa ditugaskan');
select pg_temp.eq(pg_temp.pt('adm','A'),pg_temp.pt('own','A'),'P8 Admin melihat semua');
select pg_temp.eq(pg_temp.pt('fin','A'),pg_temp.pt('own','A'),'P8 Finance melihat semua');
select pg_temp.grant_kelola('STAFF');
select pg_temp.eq(pg_temp.pt('kp','A'),pg_temp.pt('own','A'),'P8 pemegang izin kelola melihat semua (perlu menugaskan siapa pun)');
select pg_temp.revoke_kelola('STAFF');
select pg_temp.eq(pg_temp.pt('kp','A'),'KPL dokter A|KPL kasir petshop|KPL staff dua|KPL staff kelola','P8 izin kelola dicabut = daftar menyempit lagi');
select pg_temp.eq(pg_temp.pt('kp','X'),'-','P8 cabang tanpa akses tetap kosong');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.ra('kp',format('select public.komplain_pilihan(%L::uuid)->''petugas''',pg_temp.b('A')))::jsonb) e where e->>'peran' not in('STAFF','DOCTOR')),'P8 STAFF tidak menerima satu pun nama berperan Owner/Admin/Finance');
select pg_temp.has(pg_temp.ra('ao','select public.komplain_pilihan(null)::text'),'ADMIN_ONLINE_FUNCTION_DENIED','P8 Admin Online tetap ditolak');
select pg_temp.eq(pg_temp.ra('kp',format('select (public.komplain_pilihan(%L::uuid)->>''peran'')',pg_temp.b('A'))),'STAFF','P8 bagian lain pilihan tidak berubah (peran)');

-- ── P9. tidak ada efek samping ─────────────────────────────────────────────────────────────────────────────
select pg_temp.eq((select count(*)::text from storage.objects where bucket_id='dokumen' and name not like 'komplain/%'),'8','P9 jumlah objek non-komplain di dokumen tidak berubah oleh uji hapus (semua hapus dibatalkan)');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace in('public'::regnamespace,'clinic_private'::regnamespace) and p.proname like 'komplain\_%' and (p.prosrc ilike '%journal_%' or p.prosrc ilike '%stock_moves%' or p.prosrc ilike '%point_ledger%')),'P9 tidak ada fungsi komplain yang menyentuh jurnal/stok/poin');

-- ── P10. log konfigurasi kebal TRUNCATE ─────────────────────────────────────────────────────────────────────────
create function pg_temp.sup(stmt text) returns text language plpgsql as $$begin begin execute stmt;return 'OK';exception when others then return 'ERR:'||sqlerrm;end;end$$;
select pg_temp.has(pg_temp.sup('truncate public.complaint_config_log'),'KOMPLAIN_JEJAK_TETAP','P10 TRUNCATE log konfigurasi ditolak (pemilik database)');
select pg_temp.has(pg_temp.sup('truncate public.customer_complaint_history'),'KOMPLAIN_JEJAK_TETAP','P10 TRUNCATE jejak tetap ditolak');

rollback;
