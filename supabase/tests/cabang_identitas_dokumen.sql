-- Identitas cabang untuk dokumen cetak (migrasi 20261213100000_cabang_identitas_dokumen): fixture fiktif, semuanya dibatalkan (rollback).
-- Dijalankan oleh scripts/test-cabang-identitas-postgres.py setelah pelari menyiapkan storage.objects seperti hosted (kolom owner_id, RLS aktif,
-- hak authenticated) lalu memasang migrasi. Setiap pernyataan benar = NOTICE BP_PASS.
-- Dibuktikan: kolom baru nullable dan kosong; batasan data; update_branch_identity hanya OWNER/ADMIN aktif (Admin Online, finance, staf, dokter, akun nonaktif,
-- anon ditolak) + validasi + jejak audit; penulisan langsung ke kolom baru ditolak untuk akun login (kolom lama tetap seperti semula); storage cabang-logo/:
-- baca semua akun internal, unggah/hapus hanya OWNER/ADMIN, ubah ditolak, Admin Online ditolak, awalan lain/bucket lain tidak berubah; ACL/SECURITY DEFINER.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;raise notice 'BP_PASS %',label;end$$;
create function pg_temp.eq(got text, want text, label text) returns void language plpgsql as $$begin
 if got is distinct from want then raise exception 'Assertion failed: % (got %, want %)',label,got,want;end if;raise notice 'BP_PASS %',label;end$$;
create function pg_temp.has(msg text, expected text, label text) returns void language plpgsql as $$begin
 if msg is null or position(expected in msg)=0 then raise exception 'Unexpected result for %: % (want %)',label,msg,expected;end if;raise notice 'BP_PASS %',label;end$$;

create temp table uu(n text primary key,id uuid not null);grant all on uu to public;
create temp table bb(n text primary key,id uuid not null);grant all on bb to public;
create function pg_temp.u(n text) returns uuid language sql as $$select id from uu where uu.n=$1$$;
create function pg_temp.b(n text) returns uuid language sql as $$select id from bb where bb.n=$1$$;
-- skalar sebagai pengguna terautentikasi (RLS berlaku); hasil teks atau 'ERR:'||pesan
create function pg_temp.ra(un text, stmt text) returns text language plpgsql as $$
declare r text;
begin
 perform set_config('request.jwt.claim.sub',coalesce((select id::text from uu where uu.n=un),''),true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin execute 'set local role authenticated';execute stmt into r;execute 'reset role';return coalesce(r,'NULL');
 exception when others then execute 'reset role';return 'ERR:'||sqlerrm;end;
end$$;
-- DML sebagai pengguna: 'OK' atau 'ERR:' (perubahan bertahan sampai rollback akhir)
create function pg_temp.da(un text, stmt text) returns text language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',coalesce((select id::text from uu where uu.n=un),''),true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
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
-- hapus objek sebagai pengguna lalu BATALKAN: 'dihapus=N' atau 'ERR:'
create function pg_temp.dl(un text, nm text, bucket text default 'dokumen') returns text language plpgsql as $$
declare n int;
begin
 perform set_config('request.jwt.claim.sub',coalesce((select id::text from uu where uu.n=un),''),true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
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
-- unggah objek sebagai pengguna (dengan RETURNING seperti API storage) lalu BATALKAN: 'ok' atau 'ERR:'
create function pg_temp.ins(un text, nm text, bucket text default 'dokumen') returns text language plpgsql as $$
declare r text;
begin
 perform set_config('request.jwt.claim.sub',coalesce((select id::text from uu where uu.n=un),''),true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin
  execute 'set local role authenticated';
  execute format('insert into storage.objects(bucket_id,name,owner,owner_id) values(%L,%L,%L::uuid,%L) returning id::text',bucket,nm,(select id from uu where uu.n=un),(select id::text from uu where uu.n=un)) into r;
  raise exception 'BATAL_ok';
 exception when others then
  execute 'reset role';
  if sqlerrm='BATAL_ok' then return 'ok'; end if;
  return 'ERR:'||sqlerrm;
 end;
end$$;
-- ubah nama objek sebagai pengguna lalu BATALKAN: 'diubah=N' atau 'ERR:'
create function pg_temp.up(un text, nm text, bucket text default 'dokumen') returns text language plpgsql as $$
declare n int;
begin
 perform set_config('request.jwt.claim.sub',coalesce((select id::text from uu where uu.n=un),''),true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
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
create function pg_temp.sysclear() returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','',true);end$$;
-- hitungan objek bernama itu yang terlihat oleh pengguna
create function pg_temp.vis(un text, nm text, bucket text default 'dokumen') returns text language sql as $$
 select pg_temp.ra(un,format('select count(*)::text from storage.objects where bucket_id=%L and name=%L',bucket,nm)) $$;
-- panggil RPC identitas sebagai pengguna; teks jsonb atau ERR:
create function pg_temp.idn(un text, br text, alamat text, tel text, logo text default null, ubah boolean default false) returns text language sql as $$
 select pg_temp.ra(un,format('select public.update_branch_identity(%L::uuid,%L,%L,%L,%L)::text',pg_temp.b(br),alamat,tel,logo,ubah)) $$;
create function pg_temp.jb(t text) returns jsonb language plpgsql as $$begin
 if left(t,1)='{' then return t::jsonb; end if; return jsonb_build_object('ERR',t); end$$;
create function pg_temp.col(br text) returns text language plpgsql as $$
begin return (select concat_ws('|',coalesce(alamat,'~'),coalesce(telepon,'~'),coalesce(logo_path,'~')) from public.branches where id=pg_temp.b(br)); end$$;

-- ── fixtures ──────────────────────────────────────────────────────────────────────────────
insert into auth.users(id,raw_user_meta_data) select ('c1000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,jsonb_build_object('full_name','CID '||nm)
 from (values(1,'owner'),(2,'admin'),(3,'finance'),(4,'staf'),(5,'dokter'),(6,'admin online'),(7,'admin nonaktif'),(8,'admin dua'),(9,'staf dua')) v(n,nm);
insert into uu(n,id) values('own','c1000000-0000-4000-8000-000000000001'),('adm','c1000000-0000-4000-8000-000000000002'),('fin','c1000000-0000-4000-8000-000000000003'),
 ('st','c1000000-0000-4000-8000-000000000004'),('kk','c1000000-0000-4000-8000-000000000005'),('ao','c1000000-0000-4000-8000-000000000006'),
 ('off','c1000000-0000-4000-8000-000000000007'),('adm2','c1000000-0000-4000-8000-000000000008'),('st2','c1000000-0000-4000-8000-000000000009'),
 ('nobody','c1000000-0000-4000-8000-000000000099');
update profiles set role='OWNER',is_active=true where id=pg_temp.u('own');
update profiles set role='ADMIN',is_active=true where id in(pg_temp.u('adm'),pg_temp.u('adm2'));
update profiles set role='FINANCE',is_active=true where id=pg_temp.u('fin');
update profiles set role='STAFF',is_active=true where id in(pg_temp.u('st'),pg_temp.u('st2'));
update profiles set role='DOCTOR',is_active=true where id=pg_temp.u('kk');
update profiles set role='ADMIN_ONLINE',is_active=true where id=pg_temp.u('ao');
update profiles set role='ADMIN',is_active=false where id=pg_temp.u('off');
insert into bb(n,id) values('A','c2000000-0000-4000-8000-000000000001'),('K','c2000000-0000-4000-8000-000000000002'),('GHOST','c2000000-0000-4000-8000-0000000000ee');
insert into branches(id,code,name,type,is_active) values(pg_temp.b('A'),'CIDA','CID klinik A','KLINIK',true),(pg_temp.b('K'),'CIDK','CID klinik K','KLINIK',true);
insert into user_branches(user_id,branch_id) select u.id,pg_temp.b('A') from uu u where u.n in ('st','kk','ao','st2');
select pg_temp.ok(exists(select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='owner_id') and (select relrowsecurity from pg_class where oid='storage.objects'::regclass),'P0 prasyarat: storage.objects punya owner_id dan RLS aktif (seperti hosted)');
insert into storage.buckets(id,name,public) values('dokumen','dokumen',false),('medical-docs','medical-docs',false),('pet-photos','pet-photos',true) on conflict do nothing;

-- ══ A. Kolom dan batasan ══════════════════════════════════════════════════════════════════
select pg_temp.eq((select string_agg(column_name||':'||data_type||':'||is_nullable,',' order by column_name) from information_schema.columns where table_schema='public' and table_name='branches' and column_name in ('alamat','telepon','logo_path')),
 'alamat:text:YES,logo_path:text:YES,telepon:text:YES','A1 tiga kolom text nullable');
select pg_temp.eq((select count(*)::text from public.branches where alamat is not null or telepon is not null or logo_path is not null),'0','A2 semua cabang kosong (tanpa isi data)');
select pg_temp.eq(pg_temp.col('A'),'~|~|~','A3 cabang fiktif kosong');
select pg_temp.eq((select count(*)::text from public.branches where code='SEEDCID' and alamat is null and telepon is null and logo_path is null),'1','A3b cabang yang sudah ada sebelum migrasi tetap kosong (migrasi tidak mengisi data)');
-- batasan data (sebagai pemilik tabel/postgres: batasan berlaku untuk semua)
create function pg_temp.raw_upd(br text, setc text) returns text language plpgsql as $$begin
 begin execute format('update public.branches set %s where id=%L',setc,pg_temp.b(br));return 'OK';
 exception when others then return 'ERR:'||sqlerrm;end;end$$;
select pg_temp.has(pg_temp.raw_upd('A',$$alamat='ab'$$),'branches_identitas_cek','A4 alamat 2 karakter ditolak batasan');
select pg_temp.has(pg_temp.raw_upd('A',format($$alamat=%L$$,repeat('x',201))),'branches_identitas_cek','A5 alamat 201 karakter ditolak batasan');
select pg_temp.has(pg_temp.raw_upd('A',format($$alamat=%L$$,'Jl. Raya'||chr(7)||'1')),'branches_identitas_cek','A6 alamat berisi karakter kontrol ditolak');
select pg_temp.has(pg_temp.raw_upd('A',$$telepon='abc-def'$$),'branches_identitas_cek','A7 telepon berisi huruf ditolak');
select pg_temp.has(pg_temp.raw_upd('A',format($$telepon=%L$$,repeat('1',31))),'branches_identitas_cek','A8 telepon 31 karakter ditolak');
select pg_temp.has(pg_temp.raw_upd('A',$$telepon='12'$$),'branches_identitas_cek','A9 telepon 2 karakter ditolak');
select pg_temp.has(pg_temp.raw_upd('A',format($$logo_path=%L$$,'cabang-logo/'||pg_temp.b('K')||'/logo.png')),'branches_identitas_cek','A10 jalur logo milik cabang lain ditolak');
select pg_temp.has(pg_temp.raw_upd('A',format($$logo_path=%L$$,'cabang-logo/'||pg_temp.b('A')||'/logo.gif')),'branches_identitas_cek','A11 ekstensi gif ditolak');
select pg_temp.has(pg_temp.raw_upd('A',format($$logo_path=%L$$,'pengeluaran/'||pg_temp.b('A')||'/logo.png')),'branches_identitas_cek','A12 jalur bukan cabang-logo/ ditolak');
select pg_temp.has(pg_temp.raw_upd('A',format($$logo_path=%L$$,'cabang-logo/'||pg_temp.b('A')||'/a/b.png')),'branches_identitas_cek','A13 jalur bersarang ditolak');
select pg_temp.has(pg_temp.raw_upd('A',format($$logo_path=%L$$,'cabang-logo/'||pg_temp.b('A')||'/../x.png')),'branches_identitas_cek','A14 jalur dengan .. dan / ditolak');
select pg_temp.eq(pg_temp.raw_upd('A',format($$alamat='Jl. Raya 1, Bogor', telepon='+62 251-8888 (1)', logo_path=%L$$,'cabang-logo/'||pg_temp.b('A')||'/Logo-1.PNG')),'OK','A15 nilai sah diterima (png huruf besar)');
select pg_temp.eq(pg_temp.raw_upd('A',format($$logo_path=%L$$,'cabang-logo/'||pg_temp.b('A')||'/l.jpeg')),'OK','A16 jpeg diterima');
select pg_temp.eq(pg_temp.raw_upd('A',format($$logo_path=%L$$,'cabang-logo/'||pg_temp.b('A')||'/l.webp')),'OK','A17 webp diterima');
select pg_temp.eq(pg_temp.raw_upd('A','alamat=null, telepon=null, logo_path=null'),'OK','A18 kosongkan kembali');

-- ══ B. update_branch_identity ═════════════════════════════════════════════════════════════
select pg_temp.eq(pg_temp.idn('own','A','  Jl.   Raya   Cimanggu 12 ',' 0251  8888 '),(select jsonb_build_object('id',pg_temp.b('A'),'alamat','Jl. Raya Cimanggu 12','telepon','0251 8888','logo_path',null,'logo_lama',null,'changed',true)::text),'B1 OWNER mengisi alamat+telepon (spasi dirapikan)');
select pg_temp.eq(pg_temp.col('A'),'Jl. Raya Cimanggu 12|0251 8888|~','B2 nilai tersimpan');
select pg_temp.eq((select count(*)::text from clinic_private.master_edit_audit where entity='branches' and entity_id=pg_temp.b('A') and action='update' and actor_id=pg_temp.u('own') and after_state->>'alamat'='Jl. Raya Cimanggu 12' and before_state->>'alamat' is null),'1','B3 jejak audit tercatat dengan pelaku');
select pg_temp.eq((pg_temp.jb(pg_temp.idn('own','A','Jl. Raya Cimanggu 12','0251 8888')))->>'changed','false','B4 tanpa perubahan: changed=false');
select pg_temp.eq((select count(*)::text from clinic_private.master_edit_audit where entity='branches' and entity_id=pg_temp.b('A')),'1','B5 tanpa perubahan: tidak ada jejak baru');
select pg_temp.eq((pg_temp.jb(pg_temp.idn('adm','K','Jl. Klinik K 5',null)))->>'changed','true','B6 ADMIN boleh');
select pg_temp.eq(pg_temp.col('K'),'Jl. Klinik K 5|~|~','B7 ADMIN: telepon null = kosong');
-- peran lain ditolak, data tidak berubah
select pg_temp.has(pg_temp.idn('fin','A','X alamat panjang','0251 1'),'Hanya OWNER/ADMIN aktif','B8 FINANCE ditolak');
select pg_temp.has(pg_temp.idn('st','A','X alamat panjang','0251 1'),'Hanya OWNER/ADMIN aktif','B9 STAFF ditolak');
select pg_temp.has(pg_temp.idn('kk','A','X alamat panjang','0251 1'),'Hanya OWNER/ADMIN aktif','B10 DOCTOR ditolak');
select pg_temp.has(pg_temp.idn('off','A','X alamat panjang','0251 1'),'Hanya OWNER/ADMIN aktif','B11 ADMIN nonaktif ditolak');
select pg_temp.has(pg_temp.idn('nobody','A','X alamat panjang','0251 1'),'Hanya OWNER/ADMIN aktif','B12 akun tanpa profil ditolak');
select pg_temp.has(pg_temp.idn('ao','A','X alamat panjang','0251 1'),'ADMIN_ONLINE','B13 Admin Online ditolak oleh pagar Admin Online');
select pg_temp.has(pg_temp.an($$select public.update_branch_identity(null,'x',null)::text$$),'ERR:','B14 anon ditolak (tanpa hak eksekusi)');
select pg_temp.eq(pg_temp.col('A'),'Jl. Raya Cimanggu 12|0251 8888|~','B15 data cabang A tidak berubah oleh penolakan');
select pg_temp.has(pg_temp.idn('own','GHOST','Jl. Hantu 1',null),'Cabang tidak ditemukan','B16 cabang tidak ada');
-- validasi
select pg_temp.has(pg_temp.idn('own','A','ab',null),'Alamat cabang 3 sampai 200','B17 alamat terlalu pendek');
select pg_temp.has(pg_temp.idn('own','A',repeat('x',201),null),'Alamat cabang 3 sampai 200','B18 alamat terlalu panjang');
select pg_temp.has(pg_temp.idn('own','A','Jl. Raya'||chr(7)||'1',null),'Alamat cabang 3 sampai 200','B19 alamat berisi karakter kontrol');
select pg_temp.has(pg_temp.idn('own','A','Jl. Raya 1','telp 123'),'Telepon cabang 3 sampai 30','B20 telepon berisi huruf');
select pg_temp.has(pg_temp.idn('own','A','Jl. Raya 1',repeat('1',31)),'Telepon cabang 3 sampai 30','B21 telepon terlalu panjang');
select pg_temp.eq((pg_temp.jb(pg_temp.idn('own','A','Jl. Raya 1',repeat('1',30))))->>'changed','true','B22 telepon 30 karakter masih boleh');
select pg_temp.eq((pg_temp.jb(pg_temp.idn('own','A','Jl. Raya 1','   ')))->>'telepon',null,'B23 telepon spasi saja = dikosongkan');
select pg_temp.eq((pg_temp.jb(pg_temp.idn('own','A',E'Jl. Raya\n  Lantai 2','0251 8888')))->>'alamat','Jl. Raya Lantai 2','B24 baris baru dalam alamat menjadi spasi');
-- logo
select pg_temp.has(pg_temp.idn('own','A','Jl. Raya 1','0251 8888','cabang-logo/'||pg_temp.b('A')||'/logo.png',true),'Berkas logo belum terunggah','B25 logo belum ada di storage ditolak');
insert into storage.objects(bucket_id,name,owner,owner_id) values('dokumen','cabang-logo/'||pg_temp.b('A')||'/logo.png',pg_temp.u('own'),pg_temp.u('own')::text),
 ('dokumen','cabang-logo/'||pg_temp.b('A')||'/logo2.webp',pg_temp.u('own'),pg_temp.u('own')::text),
 ('dokumen','cabang-logo/'||pg_temp.b('K')||'/logo.png',pg_temp.u('own'),pg_temp.u('own')::text),
 ('dokumen','cabang-logo/'||pg_temp.b('A')||'/logo.gif',pg_temp.u('own'),pg_temp.u('own')::text),
 ('dokumen','pengeluaran/1700000000001-nota.png',pg_temp.u('fin'),pg_temp.u('fin')::text);
select pg_temp.has(pg_temp.idn('own','A','Jl. Raya 1','0251 8888','cabang-logo/'||pg_temp.b('K')||'/logo.png',true),'Jalur logo tidak sah','B26 logo milik cabang lain ditolak walau ada di storage');
select pg_temp.has(pg_temp.idn('own','A','Jl. Raya 1','0251 8888','cabang-logo/'||pg_temp.b('A')||'/logo.gif',true),'Jalur logo tidak sah','B27 logo ekstensi gif ditolak');
select pg_temp.has(pg_temp.idn('own','A','Jl. Raya 1','0251 8888','pengeluaran/1700000000001-nota.png',true),'Jalur logo tidak sah','B28 berkas modul lain tidak bisa dijadikan logo');
select pg_temp.has(pg_temp.idn('own','A','Jl. Raya 1','0251 8888','cabang-logo/'||pg_temp.b('A')||'/../../x.png',true),'Jalur logo tidak sah','B29 jalur dengan .. ditolak');
insert into storage.objects(bucket_id,name,owner,owner_id) values('medical-docs','cabang-logo/'||pg_temp.b('A')||'/lain-bucket.png',pg_temp.u('own'),pg_temp.u('own')::text);
select pg_temp.has(pg_temp.idn('own','A','Jl. Raya 1','0251 8888','cabang-logo/'||pg_temp.b('A')||'/lain-bucket.png',true),'Berkas logo belum terunggah','B29b berkas bernama sama di bucket lain tidak dihitung');
select pg_temp.eq((pg_temp.jb(pg_temp.idn('own','A','Jl. Raya 1','0251 8888','cabang-logo/'||pg_temp.b('A')||'/logo.png',true)))->>'logo_path','cabang-logo/'||pg_temp.b('A')||'/logo.png','B30 logo sah diterima');
select pg_temp.eq(pg_temp.col('A'),'Jl. Raya 1|0251 8888|cabang-logo/'||pg_temp.b('A')||'/logo.png','B31 logo tersimpan');
select pg_temp.eq((pg_temp.jb(pg_temp.idn('own','A','Jl. Raya 2','0251 8888')))->>'logo_path','cabang-logo/'||pg_temp.b('A')||'/logo.png','B32 ubah_logo=false: logo lama dipertahankan walau jalur dikirim null');
select pg_temp.eq((pg_temp.jb(pg_temp.idn('own','A','Jl. Raya 2','0251 8888','cabang-logo/'||pg_temp.b('A')||'/logo2.webp',true)))->>'logo_lama','cabang-logo/'||pg_temp.b('A')||'/logo.png','B33 ganti logo: logo lama dilaporkan untuk dibersihkan');
select pg_temp.eq((pg_temp.jb(pg_temp.idn('own','A','Jl. Raya 2','0251 8888',null,true)))->>'logo_lama','cabang-logo/'||pg_temp.b('A')||'/logo2.webp','B34 hapus logo: logo lama dilaporkan');
select pg_temp.eq(pg_temp.col('A'),'Jl. Raya 2|0251 8888|~','B35 logo terhapus dari cabang');
select pg_temp.eq((select count(*)::text from storage.objects where bucket_id='dokumen' and name='cabang-logo/'||pg_temp.b('A')||'/logo2.webp'),'1','B36 RPC tidak menghapus berkas storage sendiri (dibersihkan aplikasi)');
select pg_temp.eq((select count(*)::text from clinic_private.master_edit_audit where entity='branches' and entity_id=pg_temp.b('A') and action='update' and before_state->>'logo_path' is null and after_state->>'logo_path'='cabang-logo/'||pg_temp.b('A')||'/logo.png'),'1','B37 jejak: pasang logo pertama (kosong -> logo.png)');
select pg_temp.eq((select count(*)::text from clinic_private.master_edit_audit where entity='branches' and entity_id=pg_temp.b('A') and action='update' and before_state->>'logo_path'='cabang-logo/'||pg_temp.b('A')||'/logo.png' and after_state->>'logo_path'='cabang-logo/'||pg_temp.b('A')||'/logo.png'),'1','B37b jejak: ubah alamat saja mempertahankan logo di kedua sisi');
select pg_temp.eq((select count(*)::text from clinic_private.master_edit_audit where entity='branches' and entity_id=pg_temp.b('A') and action='update' and after_state->>'logo_path' is null and before_state->>'logo_path'='cabang-logo/'||pg_temp.b('A')||'/logo2.webp'),'1','B37c jejak: hapus logo (logo2.webp -> kosong)');
-- logo yang sudah dipakai boleh dipasang ulang walau objeknya hilang dari storage (tidak diperiksa ulang bila jalur sama)
select pg_temp.eq((pg_temp.jb(pg_temp.idn('own','A','Jl. Raya 2','0251 8888','cabang-logo/'||pg_temp.b('A')||'/logo.png',true)))->>'changed','true','B38 pasang logo lagi');
delete from storage.objects where bucket_id='dokumen' and name='cabang-logo/'||pg_temp.b('A')||'/logo.png';
select pg_temp.eq((pg_temp.jb(pg_temp.idn('own','A','Jl. Raya 3','0251 8888','cabang-logo/'||pg_temp.b('A')||'/logo.png',true)))->>'changed','true','B39 jalur logo sama tidak diperiksa ulang di storage (hanya alamat berubah)');

-- ══ C. Penulisan langsung ══════════════════════════════════════════════════════════════════
select pg_temp.has(pg_temp.da('own',format($$update public.branches set alamat='Dipalsukan 1' where id=%L$$,pg_temp.b('A'))),'hanya bisa diubah lewat Pengaturan > Cabang','C1 OWNER lewat REST langsung ke alamat ditolak');
select pg_temp.has(pg_temp.da('st',format($$update public.branches set telepon='0812345678' where id=%L$$,pg_temp.b('A'))),'hanya bisa diubah lewat Pengaturan > Cabang','C2 STAFF lewat REST langsung ke telepon ditolak');
select pg_temp.has(pg_temp.da('adm',format($$update public.branches set logo_path='cabang-logo/%s/logo2.webp' where id=%L$$,pg_temp.b('A'),pg_temp.b('A'))),'hanya bisa diubah lewat Pengaturan > Cabang','C3 ADMIN lewat REST langsung ke logo_path ditolak');
select pg_temp.has(pg_temp.da('own',format($$update public.branches set alamat=null where id=%L$$,pg_temp.b('A'))),'hanya bisa diubah lewat Pengaturan > Cabang','C4 mengosongkan alamat lewat REST juga ditolak');
select pg_temp.eq(pg_temp.col('A'),'Jl. Raya 3|0251 8888|cabang-logo/'||pg_temp.b('A')||'/logo.png','C5 data tidak berubah oleh penolakan');
select pg_temp.eq(pg_temp.da('st',format($$update public.branches set radius_m=radius_m+1, lat=-6.5 where id=%L$$,pg_temp.b('A'))),'OK','C6 kolom lama (radius/lat) tetap bisa ditulis seperti semula');
select pg_temp.has(pg_temp.da('own',format($$update public.branches set name='Nama Baru Langsung' where id=%L$$,pg_temp.b('A'))),'hanya bisa diubah lewat menu Perusahaan > Cabang','C7 penjaga lama (nama) tetap bekerja');
select pg_temp.eq(pg_temp.da('own',format($$update public.branches set alamat=alamat where id=%L$$,pg_temp.b('A'))),'OK','C8 UPDATE yang tidak mengubah ketiga kolom tidak ditolak');
update public.branches set alamat='Jalur sistem 99' where id=pg_temp.b('K');
select pg_temp.eq(pg_temp.col('K'),'Jalur sistem 99|~|~','C9 jalur sistem (postgres) tetap bisa menulis');
create function pg_temp.ad(stmt text) returns text language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','',true);
 begin execute 'set local role anon';execute stmt;execute 'reset role';return 'OK';
 exception when others then execute 'reset role';return 'ERR:'||sqlerrm;end;end$$;
select pg_temp.ok(pg_temp.ad(format($$update public.branches set alamat='Anon 1' where id=%L$$,pg_temp.b('K'))) is not null,'C10 anon: percobaan menulis dijalankan');
select pg_temp.eq(pg_temp.col('K'),'Jalur sistem 99|~|~','C11 anon tidak mengubah apa pun');

-- ══ D. Storage cabang-logo/ ═══════════════════════════════════════════════════════════════
select pg_temp.sysclear();
insert into storage.objects(bucket_id,name,owner,owner_id) values('dokumen','cabang-logo/'||pg_temp.b('K')||'/papan.jpg',pg_temp.u('own'),pg_temp.u('own')::text);
-- baca
select pg_temp.eq(pg_temp.vis('own','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'1','D1 OWNER membaca logo');
select pg_temp.eq(pg_temp.vis('adm','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'1','D2 ADMIN membaca logo');
select pg_temp.eq(pg_temp.vis('fin','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'1','D3 FINANCE membaca logo (tercetak di dokumen)');
select pg_temp.eq(pg_temp.vis('st','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'1','D4 STAFF cabang lain membaca logo');
select pg_temp.eq(pg_temp.vis('kk','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'1','D5 DOCTOR membaca logo');
select pg_temp.eq(pg_temp.vis('ao','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'0','D6 Admin Online tidak melihat logo (pagar lama)');
-- unggah
select pg_temp.eq(pg_temp.ins('own','cabang-logo/'||pg_temp.b('A')||'/baru.png'),'ok','D7 OWNER unggah logo cabang yang ada');
select pg_temp.eq(pg_temp.ins('adm','cabang-logo/'||pg_temp.b('K')||'/baru.webp'),'ok','D8 ADMIN unggah logo');
select pg_temp.eq(pg_temp.ins('adm2','cabang-logo/'||pg_temp.b('K')||'/BARU.JPEG'),'ok','D9 ADMIN unggah JPEG huruf besar');
select pg_temp.has(pg_temp.ins('fin','cabang-logo/'||pg_temp.b('A')||'/baru.png'),'row-level security','D10 FINANCE tidak boleh unggah');
select pg_temp.has(pg_temp.ins('st','cabang-logo/'||pg_temp.b('A')||'/baru.png'),'row-level security','D11 STAFF tidak boleh unggah');
select pg_temp.has(pg_temp.ins('kk','cabang-logo/'||pg_temp.b('A')||'/baru.png'),'row-level security','D12 DOCTOR tidak boleh unggah');
select pg_temp.has(pg_temp.ins('ao','cabang-logo/'||pg_temp.b('A')||'/baru.png'),'row-level security','D13 Admin Online tidak boleh unggah');
select pg_temp.has(pg_temp.ins('off','cabang-logo/'||pg_temp.b('A')||'/baru.png'),'row-level security','D14 ADMIN nonaktif tidak boleh unggah');
select pg_temp.has(pg_temp.ins('nobody','cabang-logo/'||pg_temp.b('A')||'/baru.png'),'row-level security','D15 akun tanpa profil tidak boleh unggah');
select pg_temp.has(pg_temp.ins('own','cabang-logo/'||pg_temp.b('GHOST')||'/baru.png'),'row-level security','D16 OWNER tidak boleh unggah untuk cabang yang tidak ada');
select pg_temp.has(pg_temp.ins('own','cabang-logo/'||pg_temp.b('A')||'/baru.gif'),'row-level security','D17 ekstensi gif ditolak walau OWNER');
select pg_temp.has(pg_temp.ins('own','cabang-logo/'||pg_temp.b('A')||'/sub/baru.png'),'row-level security','D18 folder bersarang ditolak');
select pg_temp.has(pg_temp.ins('own','cabang-logo/baru.png'),'row-level security','D19 tanpa folder cabang ditolak');
select pg_temp.has(pg_temp.ins('own','cabang-logo/'||pg_temp.b('A')||'/..%2Fx.png'),'row-level security','D20 karakter aneh di nama ditolak');
select pg_temp.has(pg_temp.ins('own','cabang-logo/'||pg_temp.b('A')||'/'||repeat('a',130)||'.png'),'row-level security','D21 nama berkas terlalu panjang ditolak');
-- hapus
select pg_temp.eq(pg_temp.dl('own','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'dihapus=1','D22 OWNER menghapus logo');
select pg_temp.eq(pg_temp.dl('adm','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'dihapus=1','D23 ADMIN menghapus logo');
select pg_temp.eq(pg_temp.dl('fin','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'dihapus=0','D24 FINANCE tidak bisa menghapus logo');
select pg_temp.eq(pg_temp.dl('st','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'dihapus=0','D25 STAFF tidak bisa menghapus logo');
select pg_temp.eq(pg_temp.dl('kk','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'dihapus=0','D26 DOCTOR tidak bisa menghapus logo');
select pg_temp.eq(pg_temp.dl('ao','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'dihapus=0','D27 Admin Online tidak bisa menghapus logo');
select pg_temp.eq(pg_temp.dl('off','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'dihapus=0','D28 ADMIN nonaktif tidak bisa menghapus logo');
select pg_temp.eq((select count(*)::text from storage.objects where bucket_id='dokumen' and name='cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'1','D29 logo masih ada setelah semua percobaan batal');
-- ══ E. Awalan lain / bucket lain tidak berubah ═════════════════════════════════════════════
insert into storage.objects(bucket_id,name,owner,owner_id) values
 ('dokumen','pengeluaran/1700000000002-b.jpg',pg_temp.u('st'),pg_temp.u('st')::text),
 ('dokumen','cabang-logo',pg_temp.u('st'),pg_temp.u('st')::text),
 ('dokumen','cabang-logoX/a.png',pg_temp.u('st'),pg_temp.u('st')::text),
 ('dokumen','Cabang-Logo/a.png',pg_temp.u('st'),pg_temp.u('st')::text),
 ('dokumen','x/cabang-logo/a.png',pg_temp.u('st'),pg_temp.u('st')::text),
 ('dokumen','komplain/1700000000003-k.jpg',pg_temp.u('st'),pg_temp.u('st')::text),
 ('medical-docs','cabang-logo/'||pg_temp.b('A')||'/m.png',pg_temp.u('st'),pg_temp.u('st')::text),
 ('pet-photos','cabang-logo/'||pg_temp.b('A')||'/p.png',pg_temp.u('st'),pg_temp.u('st')::text);
select pg_temp.eq(pg_temp.ins('st','pengeluaran/1700000000009-n.jpg'),'ok','E1 STAFF tetap bisa unggah ke pengeluaran/');
select pg_temp.eq(pg_temp.dl('st','pengeluaran/1700000000002-b.jpg'),'dihapus=1','E2 STAFF tetap bisa hapus di pengeluaran/');
select pg_temp.eq(pg_temp.ins('fin','pembelian/1700000000009-f.pdf'),'ok','E3 FINANCE tetap bisa unggah ke pembelian/');
select pg_temp.eq(pg_temp.ins('st','cabang-logo'),'ok','E4 nama persis cabang-logo (tanpa garis miring) tidak tercakup');
select pg_temp.eq(pg_temp.ins('st','cabang-logoX/a.png'),'ok','E5 cabang-logoX/ tidak tercakup');
select pg_temp.eq(pg_temp.ins('st','Cabang-Logo/b.png'),'ok','E6 Cabang-Logo/ (huruf besar) tidak tercakup');
select pg_temp.eq(pg_temp.ins('st','x/cabang-logo/b.png'),'ok','E7 x/cabang-logo/ tidak tercakup');
select pg_temp.eq(pg_temp.dl('st','cabang-logoX/a.png'),'dihapus=1','E8 hapus cabang-logoX/ tidak tercakup');
select pg_temp.eq(pg_temp.dl('st','Cabang-Logo/a.png'),'dihapus=1','E9 hapus Cabang-Logo/ tidak tercakup');
select pg_temp.eq(pg_temp.dl('st','x/cabang-logo/a.png'),'dihapus=1','E10 hapus x/cabang-logo/ tidak tercakup');
select pg_temp.eq(pg_temp.dl('st','cabang-logo'),'dihapus=1','E11 hapus nama persis cabang-logo tidak tercakup');
select pg_temp.eq(pg_temp.ins('st','cabang-logo/'||pg_temp.b('A')||'/m2.png','medical-docs'),'ok','E12 bucket medical-docs dengan awalan sama tidak tercakup (unggah)');
select pg_temp.eq(pg_temp.dl('st','cabang-logo/'||pg_temp.b('A')||'/m.png','medical-docs'),'dihapus=1','E13 bucket medical-docs dengan awalan sama tidak tercakup (hapus)');
select pg_temp.eq(pg_temp.ins('st','cabang-logo/'||pg_temp.b('A')||'/p2.png','pet-photos'),'ok','E14 bucket pet-photos dengan awalan sama tidak tercakup (unggah)');
select pg_temp.eq(pg_temp.ins('st','komplain/1700000000099-x.jpg'),'ok','E15 komplain/ tidak tersentuh (unggah)');
select pg_temp.eq(pg_temp.vis('st','pengeluaran/1700000000002-b.jpg'),'1','E16 STAFF tetap membaca pengeluaran/');
select pg_temp.eq(pg_temp.vis('ao','pengeluaran/1700000000002-b.jpg'),'0','E17 Admin Online tetap ditolak di pengeluaran/ (pagar lama tidak berubah)');
select pg_temp.ok(pg_temp.an($$select count(*)::text from storage.objects where bucket_id='dokumen' and name like 'cabang-logo/%'$$) in ('0','ERR:permission denied for table objects'),'E18 anon tidak melihat berkas logo (0 baris atau tanpa hak tabel)');

-- ubah (nama/pindah): ditolak untuk semua walau ada kebijakan UPDATE permisif; awalan/bucket lain tetap bisa
create policy tmp_dokumen_ubah on storage.objects for update to authenticated using (true) with check (true);
create policy tmp_medical_ubah on storage.objects for update to authenticated using (bucket_id='medical-docs') with check (bucket_id='medical-docs');
select pg_temp.eq(pg_temp.up('own','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'diubah=0','E19 OWNER tidak bisa mengubah objek logo walau ada kebijakan UPDATE permisif');
select pg_temp.eq(pg_temp.up('adm','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'diubah=0','E20 ADMIN tidak bisa mengubah objek logo');
select pg_temp.eq(pg_temp.up('st','cabang-logo/'||pg_temp.b('K')||'/papan.jpg'),'diubah=0','E21 STAFF tidak bisa mengubah objek logo');
select pg_temp.eq(pg_temp.up('st','pengeluaran/1700000000001-nota.png'),'diubah=1','E22 kontrol: objek awalan lain tetap bisa diubah (tidak tersentuh)');
select pg_temp.eq(pg_temp.up('st','cabang-logo'),'diubah=1','E24 nama persis cabang-logo tidak tercakup (ubah)');
select pg_temp.eq(pg_temp.up('st','Cabang-Logo/a.png'),'diubah=1','E25 Cabang-Logo/ tidak tercakup (ubah)');
select pg_temp.eq(pg_temp.up('st','x/cabang-logo/a.png'),'diubah=1','E26 x/cabang-logo/ tidak tercakup (ubah)');
select pg_temp.eq(pg_temp.up('st','cabang-logoX/a.png'),'diubah=1','E27 cabang-logoX/ tidak tercakup (ubah)');
select pg_temp.eq(pg_temp.up('st','cabang-logo/'||pg_temp.b('A')||'/m.png','medical-docs'),'diubah=1','E28 bucket medical-docs dengan awalan sama tidak tercakup (ubah)');
drop policy tmp_dokumen_ubah on storage.objects; drop policy tmp_medical_ubah on storage.objects;

-- ══ F. Fungsi kebijakan, ACL, bentuk fungsi ═══════════════════════════════════════════════
select pg_temp.eq(pg_temp.ra('own',format($$select public.cabang_logo_boleh_tulis('cabang-logo/%s/a.png')::text$$,pg_temp.b('A'))),'true','F1 fungsi tulis: OWNER true');
select pg_temp.eq(pg_temp.ra('adm',format($$select public.cabang_logo_boleh_tulis('cabang-logo/%s/a.png')::text$$,pg_temp.b('A'))),'true','F2 fungsi tulis: ADMIN true');
select pg_temp.eq(pg_temp.ra('fin',format($$select public.cabang_logo_boleh_tulis('cabang-logo/%s/a.png')::text$$,pg_temp.b('A'))),'false','F3 fungsi tulis: FINANCE false');
select pg_temp.eq(pg_temp.ra('ao',format($$select public.cabang_logo_boleh_tulis('cabang-logo/%s/a.png')::text$$,pg_temp.b('A'))),'false','F4 fungsi tulis: Admin Online false (lapis kedua selain pagar storage)');
select pg_temp.eq(pg_temp.ra('off',format($$select public.cabang_logo_boleh_tulis('cabang-logo/%s/a.png')::text$$,pg_temp.b('A'))),'false','F5 fungsi tulis: ADMIN nonaktif false');
select pg_temp.eq(pg_temp.ra('own',$$select public.cabang_logo_boleh_tulis(null)::text$$),'false','F6 fungsi tulis: nama null false');
select pg_temp.eq(pg_temp.ra('own',$$select public.cabang_logo_boleh_hapus('cabang-logo/x/a.png')::text$$),'true','F7 fungsi hapus: OWNER true');
select pg_temp.eq(pg_temp.ra('adm',$$select public.cabang_logo_boleh_hapus('cabang-logo/x/a.png')::text$$),'true','F8 fungsi hapus: ADMIN true');
select pg_temp.eq(pg_temp.ra('st',$$select public.cabang_logo_boleh_hapus('cabang-logo/x/a.png')::text$$),'false','F9 fungsi hapus: STAFF false');
select pg_temp.eq(pg_temp.ra('ao',$$select public.cabang_logo_boleh_hapus('cabang-logo/x/a.png')::text$$),'false','F10 fungsi hapus: Admin Online false (lapis kedua)');
select pg_temp.eq(pg_temp.ra('off',$$select public.cabang_logo_boleh_hapus('cabang-logo/x/a.png')::text$$),'false','F11 fungsi hapus: ADMIN nonaktif false');
select pg_temp.eq((select string_agg(p.proname||':'||has_function_privilege('anon',p.oid,'execute')||has_function_privilege('service_role',p.oid,'execute')||has_function_privilege('authenticated',p.oid,'execute'),',' order by p.proname)
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('update_branch_identity','cabang_logo_boleh_tulis','cabang_logo_boleh_hapus')),
 'cabang_logo_boleh_hapus:falsefalsetrue,cabang_logo_boleh_tulis:falsefalsetrue,update_branch_identity:falsefalsetrue','F12 ACL: hanya authenticated');
select pg_temp.eq((select has_function_privilege('authenticated','public.guard_branch_identity_direct_edit()'::regprocedure,'execute')::text||has_function_privilege('anon','public.guard_branch_identity_direct_edit()'::regprocedure,'execute')::text),'falsefalse','F13 fungsi pemicu tidak dapat dieksekusi klien');
select pg_temp.eq((select count(*)::text from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('update_branch_identity','cabang_logo_boleh_tulis','cabang_logo_boleh_hapus') and p.prosecdef and coalesce(p.proconfig,'{}') @> array['search_path=""']),'3','F14 tiga fungsi SECURITY DEFINER dengan search_path kosong');
select pg_temp.ok((select prosrc ~ 'admin_online_private\.deny_admin_online' from pg_proc where oid='public.update_branch_identity(uuid,text,text,text,boolean)'::regprocedure),'F15 update_branch_identity memuat penjaga Admin Online (guard_all)');
select pg_temp.eq((select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'cabang_logo_%' and permissive='RESTRICTIVE' and roles='{authenticated}'),'3','F16 tiga kebijakan RESTRICTIVE untuk authenticated');
select pg_temp.eq((select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'cabang_logo_%' and cmd='SELECT'),'0','F17 tidak ada kebijakan baca baru (baca tetap lewat dokumen_read)');
select pg_temp.eq((select count(*)::text from pg_trigger where tgrelid='public.branches'::regclass and tgname='a00_guard_branch_identity_edit' and not tgisinternal and tgenabled='O'),'1','F18 pemicu penjaga aktif');
select pg_temp.eq((select count(*)::text from pg_trigger where tgrelid='public.branches'::regclass and tgname in ('a00_guard_branch_direct_edit','zz_admin_online_write_fence') and not tgisinternal),'2','F19 pemicu lama tetap ada');
-- guard_all/fence_all idempoten: menjalankan ulang tidak mengubah apa pun pada fungsi baru
select pg_temp.sysclear();
create temp table dg0 as select p.oid::regprocedure::text sig, md5(pg_get_functiondef(p.oid)) m from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('update_branch_identity','cabang_logo_boleh_tulis','cabang_logo_boleh_hapus','guard_branch_identity_direct_edit');
select admin_online_private.guard_all(); select admin_online_private.fence_all();
select pg_temp.eq((select count(*)::text from dg0 d join pg_proc p on p.oid=to_regprocedure(d.sig) where md5(pg_get_functiondef(p.oid))<>d.m),'0','F20 guard_all/fence_all ulang: fungsi baru tidak berubah (idempoten)');
rollback;
