-- A5 (meeting 12 Nov 2026): izin Akses Grup "Koreksi visit rawat inap" (klinik.koreksi_visit).
-- apply as ONE transaction (the Supabase CLI / apply_migration runs this file in one; there is no begin/commit in it).
--
-- Keputusan pemilik (Reza, 12 Nov 2026; docs/meeting-2026-11-12/USULAN-A5.md):
--   1A "Manager" = ADMIN.  2A ADMIN otomatis dicentang (tidak ada perilaku yang hilang dibanding sekarang).
--   3A Koreksi untuk bulan yang komisinya sudah dibayar tetap boleh (Finance menyesuaikan manual); tidak ada pagar periode baru.
--
-- Isi:
--   * role_settings_private.action_catalog/action_modules: 'klinik.koreksi_visit' (modul klinik), IZIN KHUSUS seperti
--     'klinik.batalkan_penerimaan': Owner selalu boleh (tanpa membaca tabel kebijakan); peran lain HANYA bila izinnya tertulis
--     eksplisit di kebijakan aksi peran itu DAN lolos public.role_action_allowed (gerbang modul/epoch); gagal baca = ditolak.
--   * clinic_private.inpatient_visit_correction_actor()  -> 'OWNER' | 'GRANT' | null
--     public.clinic_inpatient_visit_correction_allowed()  -> boolean (untuk layar; bukan otorisasi)
--   * public.inpatient_daily_logs.correction_reason (baru, boleh kosong): alasan catatan yang DITAMBAHKAN sebagai koreksi
--     (visit dokter > 48 jam lalu, atau catatan setelah pasien pulang/RIP). Hanya diisi pagar database dari alasan yang dikirim
--     RPC koreksi; klien tidak bisa mengisi/mengubahnya. Koreksi isi catatan (update) tetap tercatat di inpatient_daily_log_edits
--     (isi lama + alasan) lewat audit_inpatient_care_edit yang TIDAK diubah.
--   * public.clinic_save_inpatient_log_correction(...) (baru, SECURITY INVOKER): pembungkus clinic_save_inpatient_log_with_status
--     yang membawa alasan koreksi (setelan transaksi clinic.inpatient_edit_reason, sama dengan clinic_update_inpatient_log).
--   * guard_inpatient_doctor_visit (H06, ganti penuh; fungsi kecil):
--       - visit dokter > 48 jam lalu: dulu kode tetap OWNER/ADMIN -> kini Owner atau pemegang izin, DAN wajib alasan (tersimpan);
--       - ubah waktu/tanggal/dokter/jenis visit: dulu kode tetap OWNER/ADMIN -> kini Owner atau pemegang izin, DAN wajib alasan;
--       - BARU: ubah paramedis pada catatan visit dokter ikut dijaga dengan aturan yang sama (dulu bebas);
--       - aturan lain tetap persis: waktu visit tidak boleh di masa depan, tanggal visit mengikuti jam visit (WIB),
--         catatan pemantauan tetap boleh mundur tanpa izin, jalur non-authenticated (impor/sistem) tidak diperiksa.
--   * protect_inpatient_care_staff (ganti penuh; hanya cabang "rawat inap sudah ditutup" yang berubah):
--       dulu catatan pada rawat inap yang sudah pulang ditolak untuk SIAPA PUN (termasuk Owner). Kini Owner/pemegang izin boleh
--       menambah/mengubah catatan dengan alasan wajib; tanggal catatan harus di dalam masa rawat (tanggal masuk s.d. tanggal pulang,
--       WIB); penambahan setelah pulang TIDAK boleh membawa obat/racikan/tagihan atau ubah kondisi. Peran lain tetap ditolak.
--   * ADMIN otomatis diberi izin (keputusan 2A), lihat bagian 6.
--
-- Kode galat baru (dipetakan aplikasi ke pesan biasa, src/lib/klinik-posting.ts parseClinicRecordError):
--   VISIT_CORRECTION_DENIED, VISIT_CORRECTION_REASON, VISIT_CORRECTION_WINDOW, VISIT_CORRECTION_CART.
--
-- Dampak:
--   * Peran selain OWNER/ADMIN: tidak berubah, KECUALI paramedis pada catatan visit dokter kini terkunci (sesuai usulan).
--   * OWNER/ADMIN: mencatat visit > 48 jam lalu dan mengubah waktu/dokter/jenis/paramedis visit kini WAJIB alasan.
--     Owner & pemegang izin kini juga bisa menambah/mengubah catatan setelah pasien pulang (dulu tidak ada yang bisa).
--   * Tidak ada baris catatan/komisi yang diubah. Laporan/komisi membaca catatan seperti biasa (koreksi ikut terhitung).
--
-- Urutan rilis: migrasi ini DULU, lalu aplikasi (aplikasi memanggil RPC baru; tanpa migrasi, form koreksi ditolak).
-- Aplikasi lama tetap jalan setelah migrasi, kecuali visit > 48 jam lalu oleh OWNER/ADMIN ditolak "alasan wajib" sampai
-- aplikasi baru (yang punya kolom alasan) terpasang.
--
-- Batal (rollback), satu transaksi:
--   1) pasang ulang teks guard_inpatient_doctor_visit dari 20261028170500_h06_doctor_visit_tamper_guard.sql dan
--      protect_inpatient_care_staff dari 20261006090000_inpatient_care_staff.sql (create or replace, teks apa adanya);
--   2) drop function public.clinic_save_inpatient_log_correction(uuid,uuid,jsonb,jsonb,jsonb,text,text,text),
--      public.clinic_inpatient_visit_correction_allowed(), clinic_private.inpatient_visit_correction_reason(),
--      clinic_private.inpatient_visit_correction_actor();
--   3) kebijakan: lepas 'klinik.koreksi_visit' dari semua action_policies.allowed (lewat Akses Grup oleh Owner, atau DBA dengan
--      pemicu action_policy_guard/epoch_guard dimatikan sementara seperti bagian 6), lalu
--      delete from role_settings_private.action_modules where id='klinik.koreksi_visit';
--      delete from role_settings_private.action_catalog where id='klinik.koreksi_visit';
--   4) kolom correction_reason boleh dibiarkan (data jejak); bila perlu: alter table public.inpatient_daily_logs drop column correction_reason;
set local lock_timeout = '5s';

-- ───────────────────────── 0) Pagar: fungsi hidup harus sama dengan teks yang ditinjau ─────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'guard_inpatient_doctor_visit'
                   and p.prosrc like '%visit dokter lebih dari 48 jam lalu hanya dapat dicatat Admin/Owner%'
                   and p.prosrc like '%hanya dapat dikoreksi OWNER/ADMIN%')
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'protect_inpatient_care_staff'
                      and p.prosrc like '%CARE_INVALID: rawat inap sudah ditutup%')
     or exists (select 1 from information_schema.columns where table_schema = 'public'
                and table_name = 'inpatient_daily_logs' and column_name = 'correction_reason') then
    raise exception 'A5_PRECONDITION: pagar catatan rawat inap di database berbeda dari yang ditinjau (atau A5 sudah terpasang); tidak ada yang diubah';
  end if;
end $$;

-- ───────────────────────── 1) Jejak alasan catatan yang ditambahkan sebagai koreksi ─────────────────────────
alter table public.inpatient_daily_logs add column correction_reason text;
comment on column public.inpatient_daily_logs.correction_reason is
  'A5: alasan bila catatan DITAMBAHKAN sebagai koreksi (visit dokter > 48 jam lalu / setelah pasien pulang). Diisi pagar database saja.';

-- ───────────────────────── 2) Izin Akses Grup (izin khusus, bawaan MATI untuk selain Owner) ─────────────────────────
insert into role_settings_private.action_catalog(id, label, "group", enforced)
values ('klinik.koreksi_visit', 'Koreksi visit rawat inap', 'Klinik', true)
on conflict (id) do nothing;
insert into role_settings_private.action_modules(id, module_id)
values ('klinik.koreksi_visit', 'klinik')
on conflict (id) do nothing;

create function clinic_private.inpatient_visit_correction_actor() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.user_role; v_ok boolean := false;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then return null; end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_role is null then return null; end if;
  -- Owner tidak pernah dikunci oleh tabel kebijakan: tidak ada pembacaan yang bisa menolaknya.
  if v_role = 'OWNER' then return 'OWNER'; end if;
  begin
    -- Peran lain: HARUS ada izin tertulis eksplisit (kebijakan "bawaan lama" = semua aksi bukan izin tertulis) dan lolos pagar modul/epoch.
    v_ok := exists (select 1 from role_settings_private.action_policies a
                    where a.role = v_role and 'klinik.koreksi_visit' = any (a.allowed))
            and public.role_action_allowed('klinik.koreksi_visit');
  exception when others then
    v_ok := false;   -- gagal baca untuk peran lain = ditolak
  end;
  return case when v_ok then 'GRANT' else null end;
end $$;
revoke all on function clinic_private.inpatient_visit_correction_actor() from public, anon, authenticated, service_role;

-- Untuk layar: tampilkan "Tambah koreksi visit"/edit setelah pulang atau tidak (bukan otorisasi; pagar database memeriksa lagi).
create function public.clinic_inpatient_visit_correction_allowed() returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  return clinic_private.inpatient_visit_correction_actor() is not null;
end $$;
revoke all on function public.clinic_inpatient_visit_correction_allowed() from public, anon, service_role;
grant execute on function public.clinic_inpatient_visit_correction_allowed() to authenticated;

-- Alasan koreksi yang dikirim RPC (setelan transaksi, sama dengan audit_inpatient_care_edit). Kosong/terlalu pendek = null.
create function clinic_private.inpatient_visit_correction_reason() returns text
language sql stable set search_path = '' as $$
  select case when length(btrim(coalesce(current_setting('clinic.inpatient_edit_reason', true), ''))) between 3 and 500
              then btrim(current_setting('clinic.inpatient_edit_reason', true)) end;
$$;
revoke all on function clinic_private.inpatient_visit_correction_reason() from public, anon, authenticated, service_role;

-- ───────────────────────── 3) RPC tambah catatan koreksi (membawa alasan) ─────────────────────────
-- Pembungkus tipis: hak, cabang, idempoten, keranjang & ubah kondisi tetap diputuskan clinic_save_inpatient_log_with_status dan
-- pagar tabel. SECURITY INVOKER: tidak menambah hak apa pun. Setelah pasien pulang, keranjang/ubah kondisi ditolak oleh pagar
-- (clinic.inpatient_correction_extra) pada saat catatan disisipkan, yaitu SETELAH baris rawat inap terkunci.
create function public.clinic_save_inpatient_log_correction(
  p_inpatient_id uuid, p_medical_record_id uuid, p_log jsonb, p_rows jsonb, p_compounds jsonb,
  p_request_key text, p_new_status text, p_reason text) returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_prev_reason text := current_setting('clinic.inpatient_edit_reason', true);
  v_prev_extra text := current_setting('clinic.inpatient_correction_extra', true);
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'VISIT_CORRECTION_REASON: alasan koreksi wajib diisi (3-500 huruf)';
  end if;
  perform set_config('clinic.inpatient_edit_reason', v_reason, true);
  perform set_config('clinic.inpatient_correction_extra',
    case when (jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) > 0)
           or (jsonb_typeof(p_compounds) = 'array' and jsonb_array_length(p_compounds) > 0)
           or p_new_status is not null then '1' else '' end, true);
  v_id := public.clinic_save_inpatient_log_with_status(
    p_inpatient_id, p_medical_record_id, p_log, p_rows, p_compounds, p_request_key, p_new_status);
  perform set_config('clinic.inpatient_edit_reason', coalesce(v_prev_reason, ''), true);
  perform set_config('clinic.inpatient_correction_extra', coalesce(v_prev_extra, ''), true);
  return v_id;
end $$;
revoke all on function public.clinic_save_inpatient_log_correction(uuid,uuid,jsonb,jsonb,jsonb,text,text,text) from public, anon, service_role;
grant execute on function public.clinic_save_inpatient_log_correction(uuid,uuid,jsonb,jsonb,jsonb,text,text,text) to authenticated;

-- ───────────────────────── 4) H06 visit dokter: izin menggantikan kode tetap OWNER/ADMIN ─────────────────────────
-- Teks asal: 20261028170500_h06_doctor_visit_tamper_guard.sql. Yang berubah ditandai "A5".
create or replace function public.guard_inpatient_doctor_visit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_reason text;
begin
  if tg_op = 'INSERT' then
    -- A5: alasan koreksi hanya diisi pagar (di sini atau protect_inpatient_care_staff), tidak pernah dari klien.
    new.correction_reason := null;
    if new.log_kind = 'doctor_visit' then
      new.created_at := coalesce(new.created_at, now());
      if new.created_at > now() + interval '5 minutes' then
        raise exception using errcode = 'P0001', message = 'CARE_INVALID: waktu visit dokter tidak boleh di masa depan';
      end if;
      if new.created_at < now() - interval '48 hours'
         and coalesce(auth.role(), '') = 'authenticated' then
        -- A5: Owner atau pemegang izin "Koreksi visit rawat inap" (dulu: kode tetap OWNER/ADMIN), dengan alasan wajib.
        if clinic_private.inpatient_visit_correction_actor() is null then
          raise exception using errcode = 'P0001',
            message = 'VISIT_CORRECTION_DENIED: visit dokter lebih dari 48 jam lalu hanya dapat dicatat Owner atau peran yang diberi izin Koreksi visit rawat inap';
        end if;
        v_reason := clinic_private.inpatient_visit_correction_reason();
        if v_reason is null then
          raise exception using errcode = 'P0001',
            message = 'VISIT_CORRECTION_REASON: visit dokter lebih dari 48 jam lalu adalah koreksi; alasan koreksi wajib diisi';
        end if;
        new.correction_reason := v_reason;
      end if;
      new.log_date := (new.created_at at time zone 'Asia/Jakarta')::date;
    end if;
    return new;
  end if;
  -- A5: jejak alasan tambah-koreksi tidak bisa diubah lewat update.
  new.correction_reason := old.correction_reason;
  if (old.log_kind = 'doctor_visit' or new.log_kind = 'doctor_visit')
     and (new.created_at is distinct from old.created_at or new.log_date is distinct from old.log_date
       or new.visit_doctor_id is distinct from old.visit_doctor_id or new.log_kind is distinct from old.log_kind
       -- A5: paramedis pada catatan visit dokter ikut dijaga.
       or new.paramedic_id is distinct from old.paramedic_id)
     and coalesce(auth.role(), '') = 'authenticated' then
    if clinic_private.inpatient_visit_correction_actor() is null then
      raise exception using errcode = 'P0001',
        message = 'VISIT_CORRECTION_DENIED: waktu, tanggal, dokter, jenis, atau paramedis visit dokter hanya dapat dikoreksi Owner atau peran yang diberi izin Koreksi visit rawat inap';
    end if;
    if clinic_private.inpatient_visit_correction_reason() is null then
      raise exception using errcode = 'P0001',
        message = 'VISIT_CORRECTION_REASON: koreksi waktu, dokter, jenis, atau paramedis visit dokter wajib disertai alasan';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_inpatient_doctor_visit() from public, anon, authenticated, service_role;

-- ───────────────────────── 5) Catatan setelah pasien pulang: Owner/pemegang izin, dengan alasan ─────────────────────────
-- Teks asal: 20261006090000_inpatient_care_staff.sql. Hanya blok "discharged_at is not null" yang berubah (ditandai "A5").
create or replace function public.protect_inpatient_care_staff() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_record public.inpatient_records%rowtype;v_visit public.visits%rowtype;v_reason text;
begin
 if coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null then
   raise exception using errcode='P0001',message='ACCESS_DENIED: pengguna tidak terautentikasi';
 end if;
 perform 1 from public.profiles where id=auth.uid() and is_active=true for share;
 if not found then raise exception using errcode='P0001',message='ACCESS_DENIED: pengguna tidak aktif';end if;
 if tg_table_name='inpatient_records' then
   if not public.user_can_access_branch(new.branch_id) then
     raise exception using errcode='P0001',message='ACCESS_DENIED: cabang tidak dapat diakses';
   end if;
   if tg_op='UPDATE' then
     if new.doctor_id is distinct from old.doctor_id or new.doctor_name is distinct from old.doctor_name
       or new.visit_id is distinct from old.visit_id or new.branch_id is distinct from old.branch_id then
       raise exception using errcode='P0001',message='CARE_INVALID: dokter PJ awal tetap tersimpan';
     end if;
   else
     select * into v_visit from public.visits where id=new.visit_id for share;
     if not found or v_visit.branch_id is distinct from new.branch_id or v_visit.doctor_id is null then
       raise exception using errcode='P0001',message='CARE_INVALID: pilih dokter PJ pada kunjungan sebelum masuk rawat inap';
     end if;
     new.doctor_id:=v_visit.doctor_id;
     new.doctor_name:=public.clinic_staff_name(new.doctor_id,new.branch_id,'doctor');
   end if;
   return new;
 end if;
 select * into v_record from public.inpatient_records where id=new.inpatient_record_id for update;
 if not found or not public.user_can_access_branch(v_record.branch_id) then
   raise exception using errcode='P0001',message='ACCESS_DENIED: rawat inap tidak dapat diakses';
 end if;
 if v_record.discharged_at is not null then
   -- A5 (meeting 12 Nov 2026): dulu ditolak untuk siapa pun. Kini Owner / pemegang izin "Koreksi visit rawat inap" saja,
   -- dengan alasan wajib, tanggal catatan di dalam masa rawat (WIB), dan tanpa obat/tagihan/ubah kondisi saat menambah.
   if clinic_private.inpatient_visit_correction_actor() is null then
     raise exception using errcode='P0001',message='VISIT_CORRECTION_DENIED: rawat inap sudah ditutup; catatan hanya dapat ditambah atau dikoreksi Owner atau peran yang diberi izin Koreksi visit rawat inap';
   end if;
   v_reason:=clinic_private.inpatient_visit_correction_reason();
   if v_reason is null then
     raise exception using errcode='P0001',message='VISIT_CORRECTION_REASON: catatan setelah pasien pulang adalah koreksi; alasan koreksi wajib diisi';
   end if;
   if (new.log_date<(v_record.admitted_at at time zone 'Asia/Jakarta')::date
       or new.log_date>(v_record.discharged_at at time zone 'Asia/Jakarta')::date)
     and (tg_op='INSERT' or new.log_date is distinct from old.log_date) then
     raise exception using errcode='P0001',message='VISIT_CORRECTION_WINDOW: tanggal catatan koreksi harus di antara tanggal masuk dan tanggal pulang pasien';
   end if;
   if tg_op='INSERT' then
     if coalesce(current_setting('clinic.inpatient_correction_extra',true),'')='1' then
       raise exception using errcode='P0001',message='VISIT_CORRECTION_CART: catatan setelah pasien pulang hanya berisi visit/pemantauan, tanpa obat, tagihan, atau ubah kondisi';
     end if;
     new.correction_reason:=v_reason;
   end if;
 end if;
 if nullif(btrim(new.condition_note),'') is null then
   raise exception using errcode='P0001',message='CARE_INVALID: kondisi pasien wajib diisi';
 end if;
 if tg_op='UPDATE' then
   if new.inpatient_record_id is distinct from old.inpatient_record_id then
     raise exception using errcode='P0001',message='CARE_INVALID: catatan tidak dapat dipindahkan ke pasien lain';
   end if;
   new.updated_at:=now();new.updated_by:=auth.uid();new.created_by:=old.created_by;
 else new.created_by:=auth.uid();
 end if;
 if new.log_kind is null then
   if tg_op<>'UPDATE' or old.log_kind is not null
     or new.visit_doctor_id is not null or new.paramedic_id is not null then
     raise exception using errcode='P0001',message='CARE_INVALID: pilih jenis laporan pemantauan atau visit dokter';
   end if;
   new.doctor_name:=old.doctor_name;new.paramedic_name:=old.paramedic_name;
   return new;
 end if;
 if new.log_kind='doctor_visit' and new.visit_doctor_id is null then
   raise exception using errcode='P0001',message='CARE_INVALID: dokter visit wajib dipilih';
 end if;
 if new.visit_doctor_id is null then new.doctor_name:=null;
 elsif tg_op='UPDATE' and new.visit_doctor_id is not distinct from old.visit_doctor_id
   and new.log_kind is not distinct from old.log_kind then new.doctor_name:=old.doctor_name;
 else new.doctor_name:=public.clinic_staff_name(new.visit_doctor_id,v_record.branch_id,'doctor');end if;
 if new.paramedic_id is null then new.paramedic_name:=null;
 elsif tg_op='UPDATE' and new.paramedic_id is not distinct from old.paramedic_id then new.paramedic_name:=old.paramedic_name;
 else new.paramedic_name:=public.clinic_staff_name(new.paramedic_id,v_record.branch_id,'paramedic');end if;
 return new;
end;
$$;
revoke all on function public.protect_inpatient_care_staff() from public,anon,authenticated,service_role;

-- ───────────────────────── 6) Keputusan 2A: ADMIN otomatis diberi izin ─────────────────────────
-- Sebelum A5, ADMIN sudah bisa (1) visit > 48 jam lalu dan (2) ubah waktu/dokter/jenis visit lewat kode tetap. Izin khusus hanya
-- berlaku bila tertulis eksplisit di role_settings_private.action_policies, jadi:
--   * ADMIN SUDAH punya kebijakan aksi tersimpan ("custom"): 'klinik.koreksi_visit' DITAMBAHKAN ke daftarnya; isi lain tetap.
--   * ADMIN belum punya ("bawaan lama" = semua aksi biasa boleh, izin khusus mati): ditulis kebijakan yang SETARA dengan bawaan
--     lama itu, yaitu semua aksi katalog yang aktif (enforced) KECUALI izin khusus yang sudah ada, ditambah 'klinik.koreksi_visit'.
--     Ini persis yang terjadi bila Owner mencentang izin khusus untuk peran bawaan-lama lalu menyimpan di Akses Grup
--     (src/app/(app)/pengaturan/akses-grup/actions.ts). Daftar izin khusus di bawah harus sama dengan
--     src/lib/role-grant-only-actions.ts sebelum A5 (dijaga tes sinkron src/lib/__tests__/koreksi-visit-akses.test.ts).
--     Bedanya hanya ke depan: aksi biasa yang BARU diaktifkan setelah ini tidak otomatis tercentang untuk ADMIN (sama dengan peran
--     yang kebijakannya sudah diatur Owner); Owner mencentangnya di Akses Grup bila perlu.
-- Mengikuti cara simpan atomik (save_role_access_config): kunci epoch ADMIN lebih dulu, kunci peran yang sama, epoch naik satu
-- (revisi lama di editor Akses Grup jadi basi = ROLE_REVISION_CONFLICT), dan satu baris riwayat dengan isi sebelum/sesudah.
-- Pemicu penjaga (config_guard) hanya menerima izin-transaksi dari RPC simpan atomik atau superuser asli; runner migrasi Supabase
-- bukan superuser, jadi dua pemicu penjaga dimatikan SEMENTARA di dalam transaksi ini (kunci ACCESS EXCLUSIVE sampai commit, tidak
-- ada sesi lain yang bisa menulis/membaca di sela itu) lalu dinyalakan lagi sebelum commit. Urutan kunci epochs -> action_policies
-- sama dengan pembaca role_action_allowed (mencegah deadlock).
alter table role_settings_private.epochs disable trigger epoch_guard;
alter table role_settings_private.action_policies disable trigger action_policy_guard;
do $$
declare
  v_before jsonb; v_after jsonb; v_allowed text[]; v_found boolean;
  v_grant_only constant text[] := array[
    'penjualan.pos_penerimaan.batalkan', 'penjualan.pos_penerimaan.tanggal_mundur',
    'klinik.batalkan_penerimaan', 'klinik.batalkan_penerimaan_tanggal',
    'pembelian.batalkan_penerimaan', 'pembelian.batalkan_faktur', 'pembelian.batalkan_pembayaran',
    'pembelian.batalkan_uang_muka', 'pembelian.tanggal_mundur'];
  -- 'kasir.diskon_manual' SENGAJA tidak dikecualikan: untuk ADMIN bawaan-lama, diskon manual BOLEH
  -- (20261112072724_diskon_manual_owner_admin: legacy hanya ADMIN), jadi kebijakan setara harus memuatnya.
begin
  perform 1 from role_settings_private.epochs where role = 'ADMIN' for update;
  perform pg_advisory_xact_lock(724061, 1);
  select a.allowed into v_allowed from role_settings_private.action_policies a where a.role = 'ADMIN' for update;
  v_found := found;
  if v_found and 'klinik.koreksi_visit' = any (v_allowed) then
    return;   -- sudah diberi; tidak ada yang diubah
  end if;
  v_before := role_settings_private.snapshot('ADMIN');
  if v_found then
    update role_settings_private.action_policies
       set allowed = array(select distinct x from unnest(v_allowed || 'klinik.koreksi_visit'::text) x order by 1)
     where role = 'ADMIN';
  else
    insert into role_settings_private.action_policies(role, allowed)
    values ('ADMIN', array(select c.id from role_settings_private.action_catalog c
                           where c.enforced and (c.id = 'klinik.koreksi_visit' or not (c.id = any (v_grant_only)))
                           order by 1));
  end if;
  update role_settings_private.epochs set epoch = epoch + 1 where role = 'ADMIN';
  v_after := role_settings_private.snapshot('ADMIN');
  insert into role_settings_private.audit(role, created_by, reason, before, after)
  values ('ADMIN', '00000000-0000-0000-0000-000000000000',
          'A5 (meeting 12 Nov 2026, keputusan 2A): izin Koreksi visit rawat inap otomatis dicentang untuk ADMIN (migrasi; perilaku lama ADMIN dipertahankan)',
          v_before, v_after);
end $$;
alter table role_settings_private.action_policies enable trigger action_policy_guard;
alter table role_settings_private.epochs enable trigger epoch_guard;
