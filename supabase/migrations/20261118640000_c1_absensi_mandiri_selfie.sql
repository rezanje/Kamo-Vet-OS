-- C1 (meeting 12 Nov 2026) TAHAP 1 + SELFIE WAJIB (Reza: keputusan A): absen mandiri lewat server, foto selfie, koreksi absen.
-- Apply as ONE transaction (satu transaksi; tanpa begin/commit sendiri).
-- URUTAN DEPLOY WAJIB: rilis aplikasi dulu, LANGSUNG pasang migrasi ini (jeda sependek mungkin) — lihat DAMPAK.
--
-- LATAR (USULAN-C1.md): absen mandiri lama menulis tabel attendance langsung dari aplikasi — jam diambil dari server aplikasi
-- tapi bisa diakali lewat Data API, absen masuk kedua menimpa jam pertama, absen pulang shift malam (lewat tengah malam)
-- tidak tercatat, cabang memakai cabang utama karyawan (bukan penugasan/jadwal), dan tidak ada bukti foto.
--
-- RANCANGAN
--  * public.absen_mandiri(jenis 'masuk'|'pulang', lat, lng, foto) = SATU-SATUNYA jalur tulis absen milik staf sendiri.
--    - Jam = jam server (now(), WIB). Aplikasi tidak mengirim jam.
--    - Tanggal kerja = tanggal mulai shift: absen pulang jam 06:00 untuk shift 22:00–06:00 masuk ke baris kemarin.
--      Absen masuk dicocokkan ke jadwal kemarin/hari ini/besok yang jendelanya (4 jam sebelum mulai s/d jam pulang) memuat jam
--      sekarang; tidak ada yang cocok = tanggal hari ini (dengan shift hari ini bila ada).
--    - Tanpa jadwal / jadwal libur hari ini: BOLEH absen, baris ditandai tanpa_jadwal = true (untuk dicek HR).
--    - Absen masuk dua kali ditolak (tidak menimpa). Absen pulang memilih baris terbuka (sudah masuk, belum pulang) yang
--      jam masuknya paling lama 20 jam lalu; lupa pulang lebih dari itu = ajukan koreksi.
--    - Lokasi dicek di server: cabang = cabang shift terjadwal (bila shift milik satu cabang), selain itu cabang penugasan
--      yang sedang berjalan (employee_branch_assignments), terakhir cabang utama karyawan (data lama). Lolos bila di dalam
--      radius salah satu cabang itu. Cabang tanpa titik koordinat = pengecekan mati (aturan lama 0087 dipertahankan).
--    - Selfie WAJIB: foto diunggah dulu ke bucket privat 'absensi-foto' dengan path
--      <employee_id>/<YYYY-MM-DD>/<in|out>-<uuid>.jpg; fungsi memeriksa path milik karyawan itu, jenisnya cocok, tanggalnya
--      hari ini/kemarin (WIB), objeknya benar-benar ada, dan belum pernah dipakai.
--    - Tercatat: waktu_masuk/waktu_pulang (timestamptz persis), lat/lng/jarak, cabang, shift, sumber 'mandiri', path foto.
--    - Siap tahap 2 (pencocokan wajah): kolom verifikasi_status ('belum' bawaan; 'cocok'/'tinjau'/'tidak_cocok' untuk nanti).
--      Tahap 2 cukup menambah kolom skor & waktu verifikasi + tabel foto acuan; path foto sudah tersimpan per absen.
--  * Policy lama attendance_insert_self / attendance_update_self DIHAPUS: staf tidak bisa lagi menulis attendance langsung.
--    Catat manual HR (/hris/absensi) tetap lewat policy attendance_owner_all / attendance_write_manager (tidak diubah).
--  * Penjaga kolom (trigger attendance_guard_client): tulis langsung dari aplikasi (HR manual) selalu sumber 'manual' dan
--    tidak bisa mengisi/mengubah kolom bukti (waktu persis, lokasi, foto, verifikasi, koreksi). HR mengubah jam/status baris
--    mandiri = sumber jadi 'manual' (bukti asli tetap tersimpan; perubahan tercatat di Log Aktifitas).
--  * Bucket privat 'absensi-foto': staf hanya bisa MENGUNGGAH ke folder <employee_id miliknya>; baca = OWNER/ADMIN pengelola
--    karyawan itu (+ karyawan itu sendiri, perlu agar unggahan bisa dikonfirmasi). Tidak ada ubah/hapus untuk klien (bukti).
--  * Koreksi absen (lupa absen / foto gagal / lokasi gagal / lainnya): tabel attendance_corrections, diajukan staf lewat
--    public.ajukan_koreksi_absen(), diputuskan OWNER/ADMIN pengelola karyawan lewat public.putuskan_koreksi_absen().
--    Disetujui = baris attendance ditulis/dilengkapi dengan sumber 'koreksi' + penyetuju + id koreksi. ADMIN tidak bisa
--    menyetujui koreksinya sendiri (OWNER boleh). Tercatat di Log Aktifitas (sumber baru attendance_corrections).
--  * private.absen_sekarang() = sumber jam fungsi absen (now()). Dipisah hanya supaya uji otomatis bisa memaku jam;
--    di Production tidak pernah diganti.
--
-- DAMPAK
--  * Data lama tidak diubah. Baris attendance lama mendapat sumber 'manual' (asal-usulnya tidak bisa dibedakan lagi),
--    verifikasi_status 'belum', tanpa_jadwal false.
--  * BEGITU MIGRASI INI TERPASANG, aplikasi VERSI LAMA tidak bisa absen mandiri lagi: tombol Clock In/Out versi lama menulis
--    attendance langsung, ditolak database, dan versi lama TIDAK memeriksa galatnya → staf melihat "Clock-in tercatat" padahal
--    tidak tersimpan. Karena itu URUTANNYA: (1) merge + deploy aplikasi baru, pastikan live; (2) segera apply migrasi ini.
--    Selama jeda (aplikasi baru, migrasi belum): absen mandiri menampilkan "Absen mandiri sedang diperbarui" (fungsi/bucket
--    belum ada) — staf tahu absennya belum masuk; layar HR & laporan tetap jalan. Jangan pasang migrasi sebelum aplikasi baru live.
--  * Catat manual HR, penggajian, dan laporan tetap membaca kolom lama (tanggal, jam_masuk, jam_pulang, status).
--
-- ROLLBACK (satu transaksi; data koreksi & foto ikut hilang bila tabel/bucket dihapus — ekspor dulu bila sudah dipakai):
--   drop function public.absen_mandiri(text,double precision,double precision,text),
--     public.ajukan_koreksi_absen(date,time,time,text,text), public.putuskan_koreksi_absen(uuid,boolean,text),
--     private.absen_sekarang(), private.absen_jarak_meter(double precision,double precision,double precision,double precision),
--     private.absen_foto_karyawan(text);
--   drop policy absensi_foto_insert_self on storage.objects; drop policy absensi_foto_select on storage.objects;
--   (bucket boleh ditinggal; kalau perlu: delete from storage.objects where bucket_id='absensi-foto'; delete from storage.buckets where id='absensi-foto';)
--   drop trigger attendance_guard_client on public.attendance; drop function public.attendance_guard_client();
--   delete from public.activity_log_sources where entity='attendance_corrections'; (trigger ikut hilang saat tabel dihapus)
--   alter table public.attendance drop constraint attendance_koreksi_fk; drop table public.attendance_corrections;
--   -- kembalikan jalur tulis staf lama (hanya bila aplikasi juga dikembalikan ke versi lama):
--   create policy attendance_insert_self on public.attendance for insert to authenticated
--     with check ((select private.is_own_employee(employee_id)) and status = 'Hadir');
--   create policy attendance_update_self on public.attendance for update to authenticated
--     using ((select private.is_own_employee(employee_id)))
--     with check ((select private.is_own_employee(employee_id)) and status = 'Hadir');
--   Kolom baru attendance boleh DITINGGAL (nullable / berbawaan; aplikasi lama mengabaikannya).
--
-- CARA CEK SETELAH PASANG (semua SELECT):
--   select polname from pg_policy where polrelid='public.attendance'::regclass order by 1;
--     -- tidak ada lagi attendance_insert_self / attendance_update_self
--   select id, public from storage.buckets where id='absensi-foto';            -- 1 baris, public = false
--   select count(*) from pg_proc where proname in ('absen_mandiri','ajukan_koreksi_absen','putuskan_koreksi_absen'); -- 3
set local lock_timeout='5s';

-- ───────────── 1. Kolom baru attendance ─────────────
alter table public.attendance
 add column sumber text not null default 'manual',
 add column branch_id uuid references public.branches(id) on delete set null,
 add column shift_id uuid references public.work_shifts(id) on delete set null,
 add column waktu_masuk timestamptz,
 add column waktu_pulang timestamptz,
 add column lat_masuk numeric(10,7),
 add column lng_masuk numeric(10,7),
 add column jarak_masuk_m integer,
 add column lat_pulang numeric(10,7),
 add column lng_pulang numeric(10,7),
 add column jarak_pulang_m integer,
 add column foto_masuk text,
 add column foto_pulang text,
 add column verifikasi_status text not null default 'belum',
 add column tanpa_jadwal boolean not null default false,
 add column koreksi_id uuid,
 add column disetujui_oleh uuid references public.profiles(id) on delete set null;
alter table public.attendance
 add constraint attendance_sumber_check check (sumber in ('manual','mandiri','koreksi')),
 add constraint attendance_verifikasi_check check (verifikasi_status in ('belum','cocok','tinjau','tidak_cocok'));
create unique index attendance_foto_masuk_uniq on public.attendance(foto_masuk) where foto_masuk is not null;
create unique index attendance_foto_pulang_uniq on public.attendance(foto_pulang) where foto_pulang is not null;
comment on column public.attendance.tanggal is 'Tanggal kerja = tanggal MULAI shift. Absen pulang shift malam (lewat tengah malam) masuk ke baris ini.';
comment on column public.attendance.sumber is 'manual = dicatat/diubah HR; mandiri = absen sendiri lewat absen_mandiri(); koreksi = koreksi absen yang disetujui.';
comment on column public.attendance.waktu_masuk is 'Waktu server persis saat absen masuk mandiri (bukti). jam_masuk = jam WIB-nya.';
comment on column public.attendance.waktu_pulang is 'Waktu server persis saat absen pulang mandiri (bukti). jam_pulang = jam WIB-nya.';
comment on column public.attendance.foto_masuk is 'Path selfie absen masuk di bucket privat absensi-foto.';
comment on column public.attendance.foto_pulang is 'Path selfie absen pulang di bucket privat absensi-foto.';
comment on column public.attendance.verifikasi_status is 'Status pencocokan wajah (tahap 2). Tahap 1: selalu belum; HR mengecek foto bila ragu.';
comment on column public.attendance.tanpa_jadwal is 'Absen mandiri pada hari tanpa jadwal atau jadwal libur — perlu dicek HR.';

-- ───────────── 2. Penjaga kolom bukti untuk tulis langsung dari aplikasi (HR manual) ─────────────
create function public.attendance_guard_client() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 -- Fungsi database (SECURITY DEFINER) berjalan sebagai pemiliknya, jadi tidak tersentuh penjaga ini.
 if current_user not in ('authenticated','anon') then return new; end if;
 if tg_op='INSERT' then
  new.sumber:='manual';
  new.waktu_masuk:=null; new.waktu_pulang:=null;
  new.lat_masuk:=null; new.lng_masuk:=null; new.jarak_masuk_m:=null;
  new.lat_pulang:=null; new.lng_pulang:=null; new.jarak_pulang_m:=null;
  new.foto_masuk:=null; new.foto_pulang:=null;
  new.verifikasi_status:='belum'; new.tanpa_jadwal:=false;
  new.koreksi_id:=null; new.disetujui_oleh:=null;
 else
  new.waktu_masuk:=old.waktu_masuk; new.waktu_pulang:=old.waktu_pulang;
  new.lat_masuk:=old.lat_masuk; new.lng_masuk:=old.lng_masuk; new.jarak_masuk_m:=old.jarak_masuk_m;
  new.lat_pulang:=old.lat_pulang; new.lng_pulang:=old.lng_pulang; new.jarak_pulang_m:=old.jarak_pulang_m;
  new.foto_masuk:=old.foto_masuk; new.foto_pulang:=old.foto_pulang;
  new.verifikasi_status:=old.verifikasi_status; new.tanpa_jadwal:=old.tanpa_jadwal;
  new.koreksi_id:=old.koreksi_id; new.disetujui_oleh:=old.disetujui_oleh;
  new.sumber:=case when (new.jam_masuk,new.jam_pulang,new.status) is distinct from (old.jam_masuk,old.jam_pulang,old.status)
                   then 'manual' else old.sumber end;
 end if;
 return new;
end $$;
revoke all on function public.attendance_guard_client() from public,anon,authenticated,service_role;
create trigger attendance_guard_client before insert or update on public.attendance
 for each row execute function public.attendance_guard_client();

-- ───────────── 3. Staf tidak lagi menulis attendance langsung ─────────────
drop policy if exists attendance_insert_self on public.attendance;
drop policy if exists attendance_update_self on public.attendance;

-- ───────────── 4. Pembantu ─────────────
create function private.absen_sekarang() returns timestamptz language sql stable set search_path='' as $$ select now() $$;
comment on function private.absen_sekarang() is 'Sumber jam absen mandiri (now()). Dipisah hanya agar uji otomatis bisa memaku jam.';
revoke all on function private.absen_sekarang() from public,anon,authenticated,service_role;

create function private.absen_jarak_meter(lat1 double precision,lng1 double precision,lat2 double precision,lng2 double precision)
returns integer language sql immutable set search_path='' as $$
 -- Haversine, sama dengan src/lib/lokasi.ts (jarakMeter).
 select round(2*6371000*asin(least(1,sqrt(
   power(sin(radians(lat2-lat1)/2),2)+cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lng2-lng1)/2),2)))))::integer
$$;
revoke all on function private.absen_jarak_meter(double precision,double precision,double precision,double precision) from public,anon,authenticated,service_role;

-- Pemilik path foto absen: <employee_id>/<YYYY-MM-DD>/<in|out>-<uuid>.jpg → employee_id; bentuk lain = null.
create function private.absen_foto_karyawan(p_name text) returns uuid language sql immutable set search_path='' as $$
 select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}-[0-9]{2}-[0-9]{2}/(in|out)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
   then split_part(p_name,'/',1)::uuid end
$$;
revoke all on function private.absen_foto_karyawan(text) from public,anon;
grant execute on function private.absen_foto_karyawan(text) to authenticated;

-- ───────────── 5. Bucket privat foto absen ─────────────
insert into storage.buckets(id,name,public) select 'absensi-foto','absensi-foto',false
on conflict (id) do update set public=false;
do $bucket$
begin
 -- Kolom batas ukuran/jenis hanya ada di storage Supabase asli (bukan di database uji).
 if exists(select 1 from information_schema.columns where table_schema='storage' and table_name='buckets' and column_name='file_size_limit') then
  execute 'update storage.buckets set file_size_limit=5242880 where id=''absensi-foto''';
 end if;
 if exists(select 1 from information_schema.columns where table_schema='storage' and table_name='buckets' and column_name='allowed_mime_types') then
  execute 'update storage.buckets set allowed_mime_types=array[''image/jpeg''] where id=''absensi-foto''';
 end if;
end $bucket$;

drop policy if exists absensi_foto_insert_self on storage.objects;
create policy absensi_foto_insert_self on storage.objects for insert to authenticated
 with check (bucket_id='absensi-foto' and (select private.is_own_employee(private.absen_foto_karyawan(name))));
drop policy if exists absensi_foto_select on storage.objects;
create policy absensi_foto_select on storage.objects for select to authenticated
 using (bucket_id='absensi-foto' and (
   (select private.can_manage_hris_employee(private.absen_foto_karyawan(name)))
   or (select private.is_own_employee(private.absen_foto_karyawan(name)))));
-- Tidak ada policy UPDATE/DELETE: foto absen adalah bukti, klien tidak bisa menimpa atau menghapusnya.

-- ───────────── 6. Absen mandiri ─────────────
create function public.absen_mandiri(p_jenis text, p_lat double precision default null, p_lng double precision default null, p_foto text default null)
returns jsonb language plpgsql volatile security definer set search_path='' set lock_timeout='5s' as $$
declare
 v_uid uuid:=auth.uid();
 v_emp_id uuid; v_emp_branch uuid;
 v_now timestamptz:=private.absen_sekarang();
 v_wib timestamp; v_today date; v_jam time;
 v_tanggal date; v_shift uuid; v_tanpa_jadwal boolean:=false;
 v_sh record; v_att public.attendance; r record;
 v_branch uuid; v_branch_nama text; v_jarak integer; v_status_lokasi text;
 v_best_d integer; v_best uuid; v_best_nama text; v_near_d integer; v_near_radius integer; v_near_nama text;
 v_tanpa_titik uuid; v_tanpa_titik_nama text; v_ada_kandidat boolean:=false;
 v_foto_emp uuid; v_foto_tgl date; d integer;
 v_shift_mulai timestamp; v_shift_selesai timestamp; v_menit integer;
begin
 if v_uid is null then raise exception using errcode='42501', message='ABSEN_AUTH: sesi login berakhir, silakan masuk lagi.'; end if;
 if p_jenis is null or p_jenis not in ('masuk','pulang') then raise exception using errcode='22023', message='ABSEN_JENIS: jenis absen tidak dikenal.'; end if;
 select e.id, e.branch_id into v_emp_id, v_emp_branch from public.employees e
  join public.profiles p on p.id=e.profile_id and p.is_active
  where e.profile_id=v_uid and e.status='Aktif' and e.trashed_at is null;
 if v_emp_id is null then raise exception using errcode='42501', message='ABSEN_KARYAWAN: akun belum tertaut ke data karyawan aktif.'; end if;

 v_wib:=v_now at time zone 'Asia/Jakarta'; v_today:=v_wib::date; v_jam:=date_trunc('second',v_wib)::time;
 -- Klik dobel / dua HP sekaligus: diproses satu per satu per karyawan.
 perform pg_advisory_xact_lock(hashtextextended('absen-mandiri:'||v_emp_id::text,0));

 -- Koordinat
 if (p_lat is null) <> (p_lng is null) or (p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180 or (p_lat=0 and p_lng=0))) then
  raise exception using errcode='22023', message='ABSEN_LOKASI_TIDAK_VALID: lokasi HP tidak terbaca dengan benar, coba lagi.';
 end if;

 -- Foto selfie wajib
 v_foto_emp:=private.absen_foto_karyawan(p_foto);
 if p_foto is null or v_foto_emp is null or v_foto_emp<>v_emp_id
    or split_part(split_part(p_foto,'/',3),'-',1)<>(case p_jenis when 'masuk' then 'in' else 'out' end) then
  raise exception using errcode='22023', message='ABSEN_FOTO: foto selfie wajib diambil dulu sebelum absen.';
 end if;
 begin v_foto_tgl:=split_part(p_foto,'/',2)::date; exception when others then v_foto_tgl:=null; end;
 if v_foto_tgl is null or v_foto_tgl not between v_today-1 and v_today
    or not exists(select 1 from storage.objects o where o.bucket_id='absensi-foto' and o.name=p_foto) then
  raise exception using errcode='22023', message='ABSEN_FOTO: foto selfie belum terunggah, ambil foto lagi.';
 end if;
 if exists(select 1 from public.attendance a where a.foto_masuk=p_foto or a.foto_pulang=p_foto) then
  raise exception using errcode='22023', message='ABSEN_FOTO: foto ini sudah dipakai, ambil foto baru.';
 end if;

 if p_jenis='masuk' then
  -- Jadwal yang jendelanya memuat jam sekarang (4 jam sebelum mulai s/d jam pulang), belum diabsen masuk.
  select s.tanggal, s.shift_id into v_sh
   from public.employee_schedules s join public.work_shifts w on w.id=s.shift_id
   where s.employee_id=v_emp_id and s.tanggal between v_today-1 and v_today+1
     and not w.is_libur and w.jam_masuk is not null and w.jam_pulang is not null
     and not exists(select 1 from public.attendance a where a.employee_id=v_emp_id and a.tanggal=s.tanggal and a.jam_masuk is not null)
     and v_wib >= (s.tanggal+w.jam_masuk) - interval '4 hours'
     and v_wib <= (s.tanggal+w.jam_pulang) + case when w.jam_pulang<=w.jam_masuk then interval '1 day' else interval '0' end
   order by abs(extract(epoch from (v_wib-(s.tanggal+w.jam_masuk)))) limit 1;
  if v_sh.tanggal is not null then
   v_tanggal:=v_sh.tanggal; v_shift:=v_sh.shift_id;
  else
   -- Masih ada absen masuk kemarin yang belum ditutup (mis. shift malam): pulang dulu.
   if exists(select 1 from public.attendance a where a.employee_id=v_emp_id and a.tanggal=v_today-1
              and a.jam_masuk is not null and a.jam_pulang is null
              and coalesce(a.waktu_masuk,(a.tanggal+a.jam_masuk) at time zone 'Asia/Jakarta') >= v_now - interval '20 hours') then
    raise exception using errcode='P0001', message='ABSEN_SUDAH_MASUK: kamu masih tercatat masuk dan belum absen pulang. Absen pulang dulu.';
   end if;
   v_tanggal:=v_today;
   select s.shift_id, w.is_libur into v_sh from public.employee_schedules s join public.work_shifts w on w.id=s.shift_id
    where s.employee_id=v_emp_id and s.tanggal=v_today;
   v_shift:=v_sh.shift_id;
   v_tanpa_jadwal:=(v_sh.shift_id is null or coalesce(v_sh.is_libur,false));
  end if;

  select * into v_att from public.attendance where employee_id=v_emp_id and tanggal=v_tanggal for update;
  if found and v_att.jam_masuk is not null then
   raise exception using errcode='P0001', message=format('ABSEN_SUDAH_MASUK: kamu sudah absen masuk jam %s. Absen masuk tidak bisa diulang.',to_char(v_att.jam_masuk,'HH24:MI'));
  end if;
  if found and v_att.status in ('Izin','Sakit','Cuti') then
   raise exception using errcode='P0001', message=format('ABSEN_STATUS_HR: hari ini kamu tercatat %s oleh HR. Hubungi HR bila ternyata masuk.',v_att.status);
  end if;
 else
  select * into v_att from public.attendance a
   where a.employee_id=v_emp_id and a.tanggal between v_today-1 and v_today and a.jam_masuk is not null and a.jam_pulang is null
     and coalesce(a.waktu_masuk,(a.tanggal+a.jam_masuk) at time zone 'Asia/Jakarta') >= v_now - interval '20 hours'
   order by coalesce(a.waktu_masuk,(a.tanggal+a.jam_masuk) at time zone 'Asia/Jakarta') desc limit 1 for update;
  if not found then
   if exists(select 1 from public.attendance a where a.employee_id=v_emp_id and a.tanggal=v_today and a.jam_pulang is not null) then
    raise exception using errcode='P0001', message='ABSEN_SUDAH_PULANG: kamu sudah absen pulang hari ini.';
   end if;
   raise exception using errcode='P0001', message='ABSEN_BELUM_MASUK: belum ada absen masuk yang bisa ditutup. Lupa absen masuk? Ajukan koreksi absen.';
  end if;
  v_tanggal:=v_att.tanggal;
  v_shift:=coalesce(v_att.shift_id,(select s.shift_id from public.employee_schedules s where s.employee_id=v_emp_id and s.tanggal=v_att.tanggal));
 end if;

 -- Lokasi: cabang shift terjadwal → cabang penugasan berjalan → cabang utama (data lama).
 for r in
  with shift_cabang as (
   select w.branch_id from public.work_shifts w where w.id=v_shift and w.branch_id is not null
  ), kandidat as (
   select branch_id from shift_cabang
   union
   select a.branch_id from public.employee_branch_assignments a
    where not exists(select 1 from shift_cabang) and a.employee_id=v_emp_id
      and a.effective_date<=v_today and (a.end_date is null or a.end_date>=v_today)
   union
   select v_emp_branch where v_emp_branch is not null and not exists(select 1 from shift_cabang)
     and not exists(select 1 from public.employee_branch_assignments a where a.employee_id=v_emp_id
                      and a.effective_date<=v_today and (a.end_date is null or a.end_date>=v_today))
  )
  select b.id, b.name, b.lat::double precision lat, b.lng::double precision lng, b.radius_m
   from kandidat k join public.branches b on b.id=k.branch_id order by b.name
 loop
  v_ada_kandidat:=true;
  if r.lat is null or r.lng is null then
   if v_tanpa_titik is null then v_tanpa_titik:=r.id; v_tanpa_titik_nama:=r.name; end if;
   continue;
  end if;
  if p_lat is null then continue; end if;
  d:=private.absen_jarak_meter(r.lat,r.lng,p_lat,p_lng);
  if d<=r.radius_m and (v_best_d is null or d<v_best_d) then v_best:=r.id; v_best_d:=d; v_best_nama:=r.name; end if;
  if v_near_d is null or d<v_near_d then v_near_d:=d; v_near_radius:=r.radius_m; v_near_nama:=r.name; end if;
 end loop;
 if v_best is not null then
  v_branch:=v_best; v_branch_nama:=v_best_nama; v_jarak:=v_best_d; v_status_lokasi:='di_dalam';
 elsif v_tanpa_titik is not null then
  v_branch:=v_tanpa_titik; v_branch_nama:=v_tanpa_titik_nama; v_jarak:=null; v_status_lokasi:='tanpa_titik';
 elsif not v_ada_kandidat then
  v_branch:=null; v_jarak:=null; v_status_lokasi:='tanpa_cabang';
 elsif p_lat is null then
  raise exception using errcode='P0001', message='ABSEN_LOKASI_KOSONG: lokasi HP tidak terbaca. Izinkan akses lokasi di browser, lalu coba lagi.';
 else
  raise exception using errcode='P0001', message=format('ABSEN_DI_LUAR_RADIUS: kamu %s m dari %s, batasnya %s m. Absen hanya bisa dari lokasi cabang.',v_near_d,v_near_nama,v_near_radius);
 end if;

 if p_jenis='masuk' then
  if v_att.id is null then
   insert into public.attendance(employee_id,tanggal,jam_masuk,status,sumber,branch_id,shift_id,waktu_masuk,lat_masuk,lng_masuk,jarak_masuk_m,foto_masuk,tanpa_jadwal)
   values(v_emp_id,v_tanggal,v_jam,'Hadir','mandiri',v_branch,v_shift,v_now,p_lat,p_lng,v_jarak,p_foto,v_tanpa_jadwal)
   returning * into v_att;
  else
   update public.attendance set jam_masuk=v_jam,status='Hadir',sumber='mandiri',branch_id=v_branch,shift_id=v_shift,waktu_masuk=v_now,
     lat_masuk=p_lat,lng_masuk=p_lng,jarak_masuk_m=v_jarak,foto_masuk=p_foto,tanpa_jadwal=v_tanpa_jadwal
    where id=v_att.id returning * into v_att;
  end if;
 else
  update public.attendance set jam_pulang=v_jam,waktu_pulang=v_now,lat_pulang=p_lat,lng_pulang=p_lng,jarak_pulang_m=v_jarak,
    foto_pulang=p_foto,branch_id=coalesce(branch_id,v_branch),shift_id=coalesce(shift_id,v_shift)
   where id=v_att.id returning * into v_att;
 end if;

 -- Telat / pulang cepat untuk pesan di layar (laporan menghitung ulang dari jadwal).
 select w.nama, w.jam_masuk, w.jam_pulang into v_sh from public.work_shifts w where w.id=v_shift and not w.is_libur;
 if v_sh.jam_masuk is not null then
  v_shift_mulai:=v_tanggal+v_sh.jam_masuk;
  v_shift_selesai:=v_tanggal+v_sh.jam_pulang+case when v_sh.jam_pulang<=v_sh.jam_masuk then interval '1 day' else interval '0' end;
  v_menit:=case when p_jenis='masuk' then greatest(0,floor(extract(epoch from (v_wib-v_shift_mulai))/60)::integer)
                else greatest(0,ceil(extract(epoch from (v_shift_selesai-v_wib))/60)::integer) end;
 end if;

 return jsonb_build_object(
  'attendance_id',v_att.id,'jenis',p_jenis,'tanggal',v_tanggal,'jam',to_char(v_jam,'HH24:MI'),'waktu',v_now,
  'shift',v_sh.nama,'shift_jam_masuk',to_char(v_sh.jam_masuk,'HH24:MI'),'shift_jam_pulang',to_char(v_sh.jam_pulang,'HH24:MI'),
  'telat_menit',case when p_jenis='masuk' then v_menit end,'pulang_cepat_menit',case when p_jenis='pulang' then v_menit end,
  'tanpa_jadwal',v_att.tanpa_jadwal,'cabang',v_branch_nama,'jarak_m',v_jarak,'lokasi',v_status_lokasi);
end $$;
comment on function public.absen_mandiri(text,double precision,double precision,text) is
 'C1: satu-satunya jalur absen mandiri staf — jam server (WIB), cek lokasi cabang penugasan/jadwal, selfie wajib, tanpa menimpa, shift malam benar.';
revoke all on function public.absen_mandiri(text,double precision,double precision,text) from public,anon,service_role;
grant execute on function public.absen_mandiri(text,double precision,double precision,text) to authenticated;

-- ───────────── 7. Koreksi absen ─────────────
create table public.attendance_corrections (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete cascade,
 tanggal date not null,
 jam_masuk time,
 jam_pulang time,
 kategori text not null check (kategori in ('lupa_absen','foto_gagal','lokasi_gagal','lainnya')),
 alasan text not null check (length(btrim(alasan)) between 3 and 300),
 status text not null default 'Menunggu' check (status in ('Menunggu','Disetujui','Ditolak')),
 catatan_penyetuju text check (catatan_penyetuju is null or length(catatan_penyetuju)<=300),
 approved_by uuid references public.profiles(id) on delete set null,
 approved_at timestamptz,
 attendance_id uuid references public.attendance(id) on delete set null,
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 check (jam_masuk is not null or jam_pulang is not null),
 check ((status='Menunggu' and approved_at is null) or (status<>'Menunggu' and approved_at is not null))
);
create unique index attendance_corrections_satu_menunggu on public.attendance_corrections(employee_id,tanggal) where status='Menunggu';
create index attendance_corrections_status on public.attendance_corrections(status,tanggal);
alter table public.attendance add constraint attendance_koreksi_fk foreign key (koreksi_id) references public.attendance_corrections(id) on delete set null;
comment on table public.attendance_corrections is 'C1: pengajuan koreksi absen staf (lupa absen / foto gagal / lokasi gagal). Ditulis hanya lewat ajukan_/putuskan_koreksi_absen().';

alter table public.attendance_corrections enable row level security;
revoke all on public.attendance_corrections from anon;
revoke insert, update, delete, truncate on public.attendance_corrections from authenticated;
grant select on public.attendance_corrections to authenticated;
create policy attendance_corrections_select on public.attendance_corrections for select to authenticated
 using ((select private.can_read_hris_work(employee_id)));

create function public.ajukan_koreksi_absen(p_tanggal date, p_jam_masuk time, p_jam_pulang time, p_kategori text, p_alasan text)
returns uuid language plpgsql volatile security definer set search_path='' set lock_timeout='5s' as $$
declare v_uid uuid:=auth.uid(); v_emp uuid; v_today date:=(private.absen_sekarang() at time zone 'Asia/Jakarta')::date;
 v_alasan text:=btrim(coalesce(p_alasan,'')); v_att public.attendance; v_id uuid;
begin
 if v_uid is null then raise exception using errcode='42501', message='KOREKSI_AUTH: sesi login berakhir, silakan masuk lagi.'; end if;
 select e.id into v_emp from public.employees e join public.profiles p on p.id=e.profile_id and p.is_active
  where e.profile_id=v_uid and e.status='Aktif' and e.trashed_at is null;
 if v_emp is null then raise exception using errcode='42501', message='KOREKSI_KARYAWAN: akun belum tertaut ke data karyawan aktif.'; end if;
 if p_tanggal is null or p_tanggal>v_today or p_tanggal<v_today-31 then
  raise exception using errcode='22023', message='KOREKSI_TANGGAL: tanggal koreksi paling lama 31 hari ke belakang dan tidak boleh tanggal depan.';
 end if;
 if p_jam_masuk is null and p_jam_pulang is null then raise exception using errcode='22023', message='KOREKSI_JAM: isi jam masuk dan/atau jam pulang yang benar.'; end if;
 if p_kategori is null or p_kategori not in ('lupa_absen','foto_gagal','lokasi_gagal','lainnya') then
  raise exception using errcode='22023', message='KOREKSI_KATEGORI: pilih alasan koreksi.';
 end if;
 if length(v_alasan) not between 3 and 300 then raise exception using errcode='22023', message='KOREKSI_ALASAN: alasan wajib diisi 3 sampai 300 huruf.'; end if;
 select * into v_att from public.attendance where employee_id=v_emp and tanggal=p_tanggal;
 if p_jam_masuk is null and v_att.jam_masuk is null then
  raise exception using errcode='22023', message='KOREKSI_JAM: belum ada absen masuk di tanggal itu, jam masuk wajib diisi.';
 end if;
 if exists(select 1 from public.attendance_corrections c where c.employee_id=v_emp and c.tanggal=p_tanggal and c.status='Menunggu') then
  raise exception using errcode='P0001', message='KOREKSI_DOBEL: masih ada koreksi tanggal ini yang menunggu persetujuan.';
 end if;
 insert into public.attendance_corrections(employee_id,tanggal,jam_masuk,jam_pulang,kategori,alasan,created_by)
 values(v_emp,p_tanggal,p_jam_masuk,p_jam_pulang,p_kategori,v_alasan,v_uid) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.ajukan_koreksi_absen(date,time,time,text,text) from public,anon,service_role;
grant execute on function public.ajukan_koreksi_absen(date,time,time,text,text) to authenticated;

create function public.putuskan_koreksi_absen(p_id uuid, p_setuju boolean, p_catatan text default null)
returns jsonb language plpgsql volatile security definer set search_path='' set lock_timeout='5s' as $$
declare v_uid uuid:=auth.uid(); v_role text; v_k public.attendance_corrections; v_att public.attendance;
 v_catatan text:=nullif(btrim(coalesce(p_catatan,'')),''); v_shift uuid;
begin
 select p.role::text into v_role from public.profiles p where p.id=v_uid and p.is_active;
 if v_uid is null or v_role is null then raise exception using errcode='42501', message='KOREKSI_AUTH: sesi login berakhir, silakan masuk lagi.'; end if;
 if p_setuju is null then raise exception using errcode='22023', message='KOREKSI_KEPUTUSAN: pilih setujui atau tolak.'; end if;
 if v_catatan is not null and length(v_catatan)>300 then raise exception using errcode='22023', message='KOREKSI_CATATAN: catatan maksimal 300 huruf.'; end if;
 select * into v_k from public.attendance_corrections where id=p_id for update;
 if not found then raise exception using errcode='22023', message='KOREKSI_TIDAK_ADA: pengajuan koreksi tidak ditemukan.'; end if;
 if not private.can_manage_hris_employee(v_k.employee_id) then
  raise exception using errcode='42501', message='KOREKSI_AKSES: hanya OWNER/ADMIN pengelola cabang karyawan ini yang bisa memutuskan.';
 end if;
 if v_role<>'OWNER' and private.is_own_employee(v_k.employee_id) then
  raise exception using errcode='42501', message='KOREKSI_DIRI_SENDIRI: koreksi absen milikmu sendiri diputuskan oleh atasan/OWNER.';
 end if;
 if v_k.status<>'Menunggu' then raise exception using errcode='P0001', message='KOREKSI_SUDAH_DIPUTUSKAN: pengajuan ini sudah diputuskan.'; end if;

 if p_setuju then
  perform pg_advisory_xact_lock(hashtextextended('absen-mandiri:'||v_k.employee_id::text,0));
  select * into v_att from public.attendance where employee_id=v_k.employee_id and tanggal=v_k.tanggal for update;
  if coalesce(v_k.jam_masuk,v_att.jam_masuk) is null then
   raise exception using errcode='22023', message='KOREKSI_JAM: jam masuk belum ada; minta karyawan mengajukan ulang dengan jam masuk.';
  end if;
  if v_att.id is null then
   select s.shift_id into v_shift from public.employee_schedules s where s.employee_id=v_k.employee_id and s.tanggal=v_k.tanggal;
   insert into public.attendance(employee_id,tanggal,jam_masuk,jam_pulang,status,keterangan,sumber,shift_id,koreksi_id,disetujui_oleh)
   values(v_k.employee_id,v_k.tanggal,v_k.jam_masuk,v_k.jam_pulang,'Hadir',left('Koreksi absen: '||v_k.alasan,300),'koreksi',v_shift,v_k.id,v_uid)
   returning * into v_att;
  else
   update public.attendance set jam_masuk=coalesce(v_k.jam_masuk,jam_masuk), jam_pulang=coalesce(v_k.jam_pulang,jam_pulang),
     status='Hadir', sumber='koreksi', koreksi_id=v_k.id, disetujui_oleh=v_uid,
     keterangan=coalesce(nullif(keterangan,''),left('Koreksi absen: '||v_k.alasan,300))
    where id=v_att.id returning * into v_att;
  end if;
 end if;

 update public.attendance_corrections set status=case when p_setuju then 'Disetujui' else 'Ditolak' end,
   catatan_penyetuju=v_catatan, approved_by=v_uid, approved_at=now(), attendance_id=v_att.id
  where id=v_k.id;
 return jsonb_build_object('id',v_k.id,'status',case when p_setuju then 'Disetujui' else 'Ditolak' end,'attendance_id',v_att.id);
end $$;
revoke all on function public.putuskan_koreksi_absen(uuid,boolean,text) from public,anon,service_role;
grant execute on function public.putuskan_koreksi_absen(uuid,boolean,text) to authenticated;

-- ───────────── 8. Log Aktifitas (metadata saja) ─────────────
insert into public.activity_log_sources
 (entity,module_id,scope_kind,identity_keys,branch_columns,scope_parents,parent_entity,parent_key,metadata_only)
values ('attendance_corrections','hris','refs',array['id'],'{}','[{"entity":"employees","key":"employee_id"}]','employees','employee_id',true);
create trigger a01_activity_change after insert or update on public.attendance_corrections
 for each row execute function public.capture_activity_log();
create trigger a01_activity_delete before delete on public.attendance_corrections
 for each row execute function public.capture_activity_log();

-- ───────────── 9. Pemeriksaan pasang ─────────────
do $check$
begin
 if exists(select 1 from pg_policy where polrelid='public.attendance'::regclass and polname in ('attendance_insert_self','attendance_update_self')) then
  raise exception 'C1: policy tulis staf lama masih ada';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.attendance'::regclass and polname='attendance_write_manager') then
  raise exception 'C1: policy catat manual HR (attendance_write_manager) hilang';
 end if;
 if not exists(select 1 from storage.buckets where id='absensi-foto' and not public) then raise exception 'C1: bucket absensi-foto belum privat'; end if;
 if (select count(*) from pg_trigger where tgrelid='public.attendance'::regclass and tgname='attendance_guard_client')<>1 then
  raise exception 'C1: penjaga kolom attendance belum terpasang';
 end if;
end $check$;
