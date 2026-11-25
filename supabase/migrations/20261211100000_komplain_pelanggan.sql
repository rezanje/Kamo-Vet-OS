-- Komplain Pelanggan (permintaan Pak Andri, 24 Nov 2026: "saya minta dibuatkan dashboard komplain" -> pilihan B: fitur komplain di dalam Kamo Vet OS).
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Mencatat komplain pelanggan per cabang, menanganinya sampai selesai, dan meringkasnya di dashboard.
-- HANYA MENCATAT: tidak ada jurnal, tidak ada uang, tidak ada stok yang disentuh. Refund / ganti barang hanya dicatat sebagai teks
-- (jenis penyelesaian + nomor invoice/struk); uangnya tetap dikerjakan lewat layar refund / koreksi yang sudah ada.
--
-- Isi (semuanya baru; tidak ada tabel/fungsi lama yang diubah):
--   * Izin Akses Grup crm.komplain_kelola (izin khusus, bawaan MATI untuk selain OWNER): ubah status / petugas komplain ORANG LAIN.
--   * public.complaint_categories        daftar kategori yang bisa ditambah Owner (10 kategori awal di bawah)
--   * public.customer_complaints         komplain (nomor KMP-YYYYMM-NNNN), RLS per cabang; HANYA berubah lewat fungsi di bawah
--   * public.customer_complaint_history  jejak tak dapat diubah (siapa mengubah apa, kapan, catatan)
--   * public.customer_complaint_files    lampiran (foto/tangkapan layar), hanya bisa ditambah
--   * public.complaint_settings          batas "terlambat" (hari), bawaan 3
--   * public.complaint_counters          penghitung nomor per bulan; public.complaint_config_log jejak ubah kategori/pengaturan
--   * fungsi tulis : komplain_buat, komplain_ubah_status, komplain_catatan, komplain_ubah_detail, komplain_kategori_simpan, komplain_pengaturan_simpan
--   * fungsi baca  : komplain_pilihan, komplain_kategori_daftar, komplain_daftar, komplain_detail, komplain_dashboard
--
-- RANCANGAN
--   * Siapa boleh: akun aktif berperan OWNER/ADMIN/FINANCE/STAFF/DOCTOR. ADMIN_ONLINE ditolak total (tabel dan fungsi).
--   * Siapa melihat: OWNER/ADMIN/FINANCE melihat semua komplain di cabang yang boleh mereka akses; STAFF/DOCTOR hanya komplain
--     cabang mereka yang mereka buat atau ditugaskan kepada mereka; pemegang izin kelola melihat semua di cabang mereka.
--     Aturan ini ada di database (kebijakan RLS + fungsi baca), bukan hanya di layar.
--   * Siapa mengubah: pembuat, petugas, atau pemegang izin kelola (OWNER selalu). Membuka kembali komplain yang sudah ditutup:
--     hanya OWNER / pemegang izin kelola.
--   * Status: Baru -> Dicek -> Dalam penanganan -> Menunggu pelanggan -> Selesai / Ditolak (tidak valid). Menutup wajib catatan + jenis penyelesaian.
--   * Waktu respons pertama = saat status pertama kali keluar dari "Baru". Waktu penyelesaian = saat ditutup. Keduanya dihitung dari
--     waktu komplain (tanggal komplain + jam pencatatan).
--   * Semua tulis lewat fungsi SECURITY DEFINER (search_path kosong, kunci anti-dobel); klien tidak punya hak INSERT/UPDATE/DELETE tabel.
--   * Dashboard: komplain_dashboard (SECURITY DEFINER STABLE) memakai predikat visibilitas yang SAMA dengan RLS.
--
-- Batal (satu transaksi; hanya aman bila belum ada komplain nyata):
--   drop function public.komplain_dashboard(date,date,uuid,uuid,text,text,uuid,text);  drop function public.komplain_detail(uuid);
--   drop function public.komplain_daftar(date,date,uuid,uuid,text,text,uuid,text,text,text,integer,integer);
--   drop function public.komplain_kategori_daftar();  drop function public.komplain_pilihan(uuid);
--   drop function public.komplain_pengaturan_simpan(integer);  drop function public.komplain_kategori_simpan(uuid,text,integer,boolean);
--   drop function public.komplain_ubah_detail(uuid,uuid,text,uuid,uuid[],numeric,text,text,text,text,uuid);
--   drop function public.komplain_catatan(uuid,text,jsonb,uuid);  drop function public.komplain_ubah_status(uuid,text,text,text,uuid);
--   drop function public.komplain_buat(uuid,uuid,text,date,uuid,uuid,text,text,text,text,uuid,text,text,text,uuid[],numeric,uuid,jsonb);
--   drop table public.customer_complaint_files, public.customer_complaint_history, public.customer_complaints, public.complaint_categories,
--     public.complaint_settings, public.complaint_counters, public.complaint_config_log;
--   drop function public.komplain_visible(uuid,uuid,uuid); drop function public.komplain_boleh();
--   drop function clinic_private.komplain_guard_tetap(); drop function clinic_private.komplain_guard_ubah(); drop function clinic_private.komplain_log(uuid,uuid,text,text,text,text,jsonb,uuid);
--   drop function clinic_private.komplain_lampiran(jsonb); drop function clinic_private.komplain_user_di_cabang(uuid,uuid);
--   drop function clinic_private.komplain_kelola(); drop function clinic_private.komplain_actor();
--   delete from role_settings_private.action_modules where id='crm.komplain_kelola'; delete from role_settings_private.action_catalog where id='crm.komplain_kelola';
set local lock_timeout = '5s';

do $pre$
begin
  if to_regclass('public.customer_complaints') is not null or to_regclass('public.complaint_categories') is not null
     or to_regclass('public.customer_complaint_history') is not null then
    raise exception 'KOMPLAIN_DRIFT: tabel komplain sudah ada; periksa urutan migrasi';
  end if;
  if to_regprocedure('admin_online_private.guard_all()') is null or to_regprocedure('admin_online_private.fence_all()') is null
     or to_regprocedure('public.user_can_access_branch(uuid)') is null then
    raise exception 'KOMPLAIN_DRIFT: prasyarat (pagar Admin Online, user_can_access_branch) tidak ada';
  end if;
end $pre$;

-- ───────────── 1. Izin Akses Grup (izin khusus, bawaan MATI untuk selain OWNER) ─────────────
insert into role_settings_private.action_catalog(id, label, "group", enforced) values
 ('crm.komplain_kelola', 'Kelola semua komplain pelanggan — ubah status / petugas komplain orang lain, buka kembali komplain yang sudah ditutup. Bawaan hanya Owner', 'CRM', true)
on conflict (id) do nothing;
insert into role_settings_private.action_modules(id, module_id) values ('crm.komplain_kelola', 'crm') on conflict do nothing;

-- ───────────── 2. Tabel ─────────────
create table public.complaint_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 60),
  sort_order integer not null default 100 check (sort_order between 0 and 9999),
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index complaint_categories_name_uk on public.complaint_categories (lower(btrim(name)));
comment on table public.complaint_categories is 'Kategori komplain pelanggan. Dikelola Owner/pemegang izin kelola lewat komplain_kategori_simpan; tidak pernah dihapus (hanya dinonaktifkan).';

insert into public.complaint_categories(name, sort_order) values
 ('Pelayanan staf', 10), ('Dokter/Medis', 20), ('Obat/Produk (kualitas/expired)', 30), ('Harga/Tagihan/Kasir (salah hitung, double bayar)', 40),
 ('Antrian/Waktu tunggu', 50), ('Kebersihan/Fasilitas', 60), ('Grooming', 70), ('Rawat Inap', 80), ('Pengiriman/Online', 90), ('Lainnya', 100);

create table public.complaint_settings (
  id boolean primary key default true check (id),
  overdue_days integer not null default 3 check (overdue_days between 1 and 90),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.complaint_settings(id, overdue_days) values (true, 3);

create table public.complaint_counters (
  period text primary key check (period ~ '^[0-9]{6}$'),
  last_no integer not null check (last_no >= 1)
);

create table public.complaint_config_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('kategori', 'pengaturan')),
  ref text,
  old_value jsonb,
  new_value jsonb,
  actor uuid not null,
  created_at timestamptz not null default clock_timestamp()
);

create table public.customer_complaints (
  id uuid primary key default gen_random_uuid(),
  complaint_no text not null unique,
  branch_id uuid not null references public.branches(id),
  channel text not null check (channel in ('Petshop', 'Klinik', 'Grooming', 'Rawat Inap', 'Online Shopee', 'Lainnya')),
  complained_at timestamptz not null,
  complaint_date date not null,
  customer_id uuid,
  pet_id uuid,
  customer_name text check (customer_name is null or length(customer_name) <= 120),
  customer_phone text check (customer_phone is null or length(customer_phone) <= 40),
  pet_name text check (pet_name is null or length(pet_name) <= 120),
  ref_kind text check (ref_kind is null or ref_kind in ('Invoice klinik', 'Struk petshop', 'Pesanan online', 'Lainnya')),
  ref_no text check (ref_no is null or length(ref_no) between 1 and 60),
  category_id uuid not null references public.complaint_categories(id),
  severity text not null check (severity in ('Rendah', 'Sedang', 'Tinggi', 'Kritis')),
  description text not null check (length(btrim(description)) between 5 and 4000),
  desired_resolution text check (desired_resolution is null or length(desired_resolution) <= 1000),
  involved jsonb not null default '[]'::jsonb check (jsonb_typeof(involved) = 'array' and jsonb_array_length(involved) <= 10),
  amount_at_stake numeric(15,2) check (amount_at_stake is null or amount_at_stake >= 0),
  assigned_to uuid references public.profiles(id),
  status text not null default 'Baru' check (status in ('Baru', 'Dicek', 'Dalam penanganan', 'Menunggu pelanggan', 'Selesai', 'Ditolak')),
  first_response_at timestamptz,
  closed_at timestamptz,
  closed_by uuid,
  resolution_type text check (resolution_type is null or resolution_type in ('Maaf/penjelasan', 'Ganti barang', 'Refund', 'Diskon/voucher', 'Edukasi staf', 'Tidak valid')),
  resolution_note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  request_key uuid not null,
  request_hash text not null,
  constraint complaints_date_matches check (complaint_date = (complained_at at time zone 'Asia/Jakarta')::date),
  constraint complaints_ref_pair check ((ref_kind is null) = (ref_no is null)),
  constraint complaints_closed_iff check ((status in ('Selesai', 'Ditolak')) = (closed_at is not null)),
  constraint complaints_closed_fields check (
    (closed_at is null and resolution_type is null and resolution_note is null and closed_by is null)
    or (closed_at is not null and resolution_type is not null and closed_by is not null and length(btrim(coalesce(resolution_note, ''))) >= 5)),
  constraint complaints_resolution_matches check (
    (status = 'Ditolak' and resolution_type = 'Tidak valid') or (status = 'Selesai' and resolution_type <> 'Tidak valid') or status not in ('Selesai', 'Ditolak')),
  constraint complaints_first_response check ((status = 'Baru') = (first_response_at is null)),
  unique (created_by, request_key)
);
comment on table public.customer_complaints is 'Komplain pelanggan. Tidak pernah dihapus; berubah hanya lewat komplain_* (SECURITY DEFINER). Tidak menyentuh uang/stok.';
create index customer_complaints_branch_date_idx on public.customer_complaints (branch_id, complaint_date desc);
create index customer_complaints_open_idx on public.customer_complaints (complained_at) where closed_at is null;
create index customer_complaints_assigned_idx on public.customer_complaints (assigned_to) where assigned_to is not null;
create index customer_complaints_customer_idx on public.customer_complaints (customer_id) where customer_id is not null;

create table public.customer_complaint_history (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.customer_complaints(id),
  branch_id uuid not null,
  seq integer not null check (seq >= 1),
  kind text not null check (kind in ('dibuat', 'status', 'catatan', 'ubah', 'tugaskan', 'lampiran')),
  from_status text,
  to_status text,
  note text check (note is null or length(note) <= 4000),
  changes jsonb,
  actor uuid not null,
  actor_name text,
  actor_role text,
  request_key uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (complaint_id, seq)
);
create unique index customer_complaint_history_key_uk on public.customer_complaint_history (complaint_id, request_key) where request_key is not null;
comment on table public.customer_complaint_history is 'Jejak komplain: hanya ditambah; tidak bisa diubah atau dihapus.';

create table public.customer_complaint_files (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.customer_complaints(id),
  branch_id uuid not null,
  path text not null check (length(path) between 1 and 500 and path like 'komplain/%' and position('..' in path) = 0),
  nama text not null check (length(nama) between 1 and 200),
  mime text check (mime is null or length(mime) <= 120),
  ukuran bigint check (ukuran is null or (ukuran > 0 and ukuran <= 10485760)),
  uploaded_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (complaint_id, path)
);
comment on table public.customer_complaint_files is 'Lampiran komplain (berkas ada di bucket dokumen, folder komplain/). Hanya ditambah.';

-- ───────────── 3. Fungsi bantu ─────────────
-- Peran akun yang boleh memakai fitur ini (NULL = tidak boleh; ADMIN_ONLINE dan akun tak aktif selalu NULL).
create function clinic_private.komplain_actor() returns text
language plpgsql stable security definer set search_path = '' as $f$
declare v_role public.user_role;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then return null; end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_role is null or v_role::text not in ('OWNER', 'ADMIN', 'FINANCE', 'STAFF', 'DOCTOR') then return null; end if;
  return v_role::text;
end $f$;
revoke all on function clinic_private.komplain_actor() from public, anon, authenticated, service_role;

-- Izin kelola semua: OWNER selalu (tanpa membaca tabel kebijakan); peran lain hanya bila izinnya DICENTANG eksplisit. Tanpa kebijakan = TIDAK.
create function clinic_private.komplain_kelola() returns boolean
language plpgsql stable security definer set search_path = '' as $f$
declare v_role text; v_allowed text[];
begin
  v_role := clinic_private.komplain_actor();
  if v_role is null then return false; end if;
  if v_role = 'OWNER' then return true; end if;
  begin
    if not exists (select 1 from role_settings_private.action_catalog where id = 'crm.komplain_kelola' and enforced) then return false; end if;
    select a.allowed into v_allowed from role_settings_private.action_policies a where a.role = v_role::public.user_role;
    if not found then return false; end if;
    return 'crm.komplain_kelola' = any (v_allowed);
  exception when others then return false;
  end;
end $f$;
revoke all on function clinic_private.komplain_kelola() from public, anon, authenticated, service_role;

-- Boleh memakai fitur komplain (dipakai kebijakan RLS tabel referensi).
create function public.komplain_boleh() returns boolean
language plpgsql stable security definer set search_path = '' as $f$
begin
  return clinic_private.komplain_actor() is not null;
end $f$;
revoke all on function public.komplain_boleh() from public, anon, service_role;
grant execute on function public.komplain_boleh() to authenticated;

-- Predikat visibilitas SATU-SATUNYA (kebijakan RLS dan semua fungsi baca memakainya).
create function public.komplain_visible(p_branch uuid, p_created_by uuid, p_assigned uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $f$
declare v_role text;
begin
  v_role := clinic_private.komplain_actor();
  if v_role is null then return false; end if;
  if not public.user_can_access_branch(p_branch) then return false; end if;
  if v_role in ('OWNER', 'ADMIN', 'FINANCE') then return true; end if;
  return coalesce(p_created_by = auth.uid(), false) or coalesce(p_assigned = auth.uid(), false) or clinic_private.komplain_kelola();
end $f$;
comment on function public.komplain_visible(uuid, uuid, uuid) is 'Boleh melihat komplain ini? Cabang harus boleh diakses; OWNER/ADMIN/FINANCE semua, lainnya hanya yang dibuat/ditugaskan kepadanya (atau pemegang izin kelola).';
revoke all on function public.komplain_visible(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.komplain_visible(uuid, uuid, uuid) to authenticated;

-- Pengguna ini boleh ditugaskan di cabang ini? (aktif, bukan Admin Online, punya akses cabang)
create function clinic_private.komplain_user_di_cabang(p_uid uuid, p_branch uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $f$
begin
  return exists (
    select 1 from public.profiles p left join public.role_capabilities c on c.role = p.role
    where p.id = p_uid and p.is_active and p.role::text in ('OWNER', 'ADMIN', 'FINANCE', 'STAFF', 'DOCTOR')
      and (p.role = 'OWNER' or coalesce(c.all_branches, p.role in ('ADMIN', 'FINANCE'))
           or exists (select 1 from public.user_branches u where u.user_id = p.id and u.branch_id = p_branch)));
end $f$;
revoke all on function clinic_private.komplain_user_di_cabang(uuid, uuid) from public, anon, authenticated, service_role;

-- Lampiran: array maks. 10 berkas di folder komplain/ (bucket dokumen), ukuran maks. 10 MB. Mengembalikan array bersih.
create function clinic_private.komplain_lampiran(p_lampiran jsonb) returns jsonb
language plpgsql stable set search_path = '' as $f$
declare v jsonb := coalesce(p_lampiran, '[]'::jsonb);
begin
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 10 then
    raise exception using errcode = '22023', message = 'KOMPLAIN_LAMPIRAN: lampiran maksimal 10 berkas.';
  end if;
  if exists (select 1 from jsonb_to_recordset(v) as x(path text, nama text, mime text, ukuran numeric)
             where path is null or path not like 'komplain/%' or position('..' in path) > 0 or length(path) > 500
                or nama is null or length(nama) not between 1 and 200 or length(mime) > 120
                or (ukuran is not null and (ukuran <= 0 or ukuran > 10485760 or ukuran <> trunc(ukuran)))) then
    raise exception using errcode = '22023', message = 'KOMPLAIN_LAMPIRAN: lampiran tidak valid (folder komplain/, maks. 10 MB per berkas).';
  end if;
  if (select count(distinct x.path) from jsonb_to_recordset(v) as x(path text)) <> jsonb_array_length(v) then
    raise exception using errcode = '22023', message = 'KOMPLAIN_LAMPIRAN: ada berkas yang sama dua kali.';
  end if;
  return v;
end $f$;
revoke all on function clinic_private.komplain_lampiran(jsonb) from public, anon, authenticated, service_role;

-- Tambah satu baris jejak (pemanggil sudah mengunci baris komplain FOR UPDATE, atau komplain baru).
create function clinic_private.komplain_log(p_complaint uuid, p_branch uuid, p_kind text, p_from text, p_to text, p_note text, p_changes jsonb, p_key uuid) returns void
language plpgsql volatile security definer set search_path = '' as $f$
declare v_seq integer; v_name text; v_role text;
begin
  select coalesce(max(h.seq), 0) + 1 into v_seq from public.customer_complaint_history h where h.complaint_id = p_complaint;
  select p.full_name, p.role::text into v_name, v_role from public.profiles p where p.id = auth.uid();
  insert into public.customer_complaint_history(complaint_id, branch_id, seq, kind, from_status, to_status, note, changes, actor, actor_name, actor_role, request_key)
  values (p_complaint, p_branch, v_seq, p_kind, p_from, p_to, p_note, p_changes, auth.uid(), v_name, v_role, p_key);
end $f$;
revoke all on function clinic_private.komplain_log(uuid, uuid, text, text, text, text, jsonb, uuid) from public, anon, authenticated, service_role;

-- ───────────── 4. Pagar tabel (RLS + pemicu) ─────────────
alter table public.complaint_categories enable row level security;
alter table public.complaint_settings enable row level security;
alter table public.complaint_counters enable row level security;
alter table public.complaint_config_log enable row level security;
alter table public.customer_complaints enable row level security;
alter table public.customer_complaint_history enable row level security;
alter table public.customer_complaint_files enable row level security;

create policy complaint_categories_baca on public.complaint_categories for select to authenticated using (public.komplain_boleh());
create policy complaint_settings_baca on public.complaint_settings for select to authenticated using (public.komplain_boleh());
create policy customer_complaints_baca on public.customer_complaints for select to authenticated
  using (public.komplain_visible(branch_id, created_by, assigned_to));
create policy customer_complaint_history_baca on public.customer_complaint_history for select to authenticated
  using (exists (select 1 from public.customer_complaints c where c.id = complaint_id));
create policy customer_complaint_files_baca on public.customer_complaint_files for select to authenticated
  using (exists (select 1 from public.customer_complaints c where c.id = complaint_id));

revoke all on public.complaint_categories, public.complaint_settings, public.complaint_counters, public.complaint_config_log,
  public.customer_complaints, public.customer_complaint_history, public.customer_complaint_files from public, anon, authenticated, service_role;
grant select on public.complaint_categories, public.complaint_settings, public.customer_complaints,
  public.customer_complaint_history, public.customer_complaint_files to authenticated;

-- Komplain: tidak bisa dihapus; kolom identitas/isi asli tidak bisa diubah (status/petugas/kategori dll. lewat fungsi).
create function clinic_private.komplain_guard_ubah() returns trigger
language plpgsql security invoker set search_path = '' as $f$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'KOMPLAIN_TETAP: komplain tidak bisa dihapus.';
  end if;
  if new.id is distinct from old.id or new.complaint_no is distinct from old.complaint_no or new.branch_id is distinct from old.branch_id
     or new.channel is distinct from old.channel or new.complained_at is distinct from old.complained_at or new.complaint_date is distinct from old.complaint_date
     or new.customer_id is distinct from old.customer_id or new.pet_id is distinct from old.pet_id
     or new.customer_name is distinct from old.customer_name or new.customer_phone is distinct from old.customer_phone or new.pet_name is distinct from old.pet_name
     or new.description is distinct from old.description or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or new.request_key is distinct from old.request_key or new.request_hash is distinct from old.request_hash then
    raise exception using errcode = '42501', message = 'KOMPLAIN_TETAP: nomor, cabang, tanggal, pelanggan, isi komplain dan pembuat tidak bisa diubah.';
  end if;
  return new;
end $f$;
revoke all on function clinic_private.komplain_guard_ubah() from public, anon, authenticated, service_role;
create trigger komplain_guard_ubah before update or delete on public.customer_complaints
  for each row execute function clinic_private.komplain_guard_ubah();

create function clinic_private.komplain_guard_tetap() returns trigger
language plpgsql security invoker set search_path = '' as $f$
begin
  raise exception using errcode = '42501', message = 'KOMPLAIN_JEJAK_TETAP: jejak, lampiran, dan komplain tidak bisa diubah atau dihapus.';
end $f$;
revoke all on function clinic_private.komplain_guard_tetap() from public, anon, authenticated, service_role;
create trigger komplain_history_tetap before update or delete on public.customer_complaint_history for each row execute function clinic_private.komplain_guard_tetap();
create trigger komplain_history_tetap_truncate before truncate on public.customer_complaint_history for each statement execute function clinic_private.komplain_guard_tetap();
create trigger komplain_files_tetap before update or delete on public.customer_complaint_files for each row execute function clinic_private.komplain_guard_tetap();
create trigger komplain_files_tetap_truncate before truncate on public.customer_complaint_files for each statement execute function clinic_private.komplain_guard_tetap();
create trigger komplain_tetap_truncate before truncate on public.customer_complaints for each statement execute function clinic_private.komplain_guard_tetap();
create trigger komplain_config_log_tetap before update or delete on public.complaint_config_log for each row execute function clinic_private.komplain_guard_tetap();

-- ───────────── 5. Fungsi tulis ─────────────
create function public.komplain_buat(
  p_request_key uuid, p_branch_id uuid, p_channel text, p_tanggal date, p_customer_id uuid, p_pet_id uuid,
  p_nama text, p_telepon text, p_ref_jenis text, p_ref_nomor text, p_category_id uuid, p_severity text,
  p_deskripsi text, p_harapan text, p_karyawan uuid[], p_nominal numeric, p_assigned uuid, p_lampiran jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s' as $f$
declare
  v_actor uuid := auth.uid(); v_role text; v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_at timestamptz; v_nama text; v_tel text; v_pet text; v_desk text; v_harapan text; v_refno text; v_ref_jenis text;
  v_inv jsonb; v_lamp jsonb; v_hash text; v_dup public.customer_complaints; v_period text; v_n integer; v_no text; v_id uuid; v_cat public.complaint_categories;
begin
  v_role := clinic_private.komplain_actor();
  if v_role is null then raise exception using errcode = '42501', message = 'KOMPLAIN_DITOLAK: akun ini tidak boleh memakai Komplain Pelanggan.'; end if;
  if p_request_key is null then raise exception using errcode = '22023', message = 'KOMPLAIN_KUNCI: muat ulang halaman lalu coba lagi.'; end if;
  if p_branch_id is null or not exists (select 1 from public.branches where id = p_branch_id and is_active) then
    raise exception using errcode = '22023', message = 'KOMPLAIN_CABANG: pilih cabang yang aktif.'; end if;
  if not public.user_can_access_branch(p_branch_id) then
    raise exception using errcode = '42501', message = 'KOMPLAIN_CABANG_DITOLAK: cabang ini tidak boleh Anda akses.'; end if;
  if p_channel is null or p_channel not in ('Petshop', 'Klinik', 'Grooming', 'Rawat Inap', 'Online Shopee', 'Lainnya') then
    raise exception using errcode = '22023', message = 'KOMPLAIN_KANAL: pilih asal komplain.'; end if;
  if p_severity is null or p_severity not in ('Rendah', 'Sedang', 'Tinggi', 'Kritis') then
    raise exception using errcode = '22023', message = 'KOMPLAIN_TINGKAT: pilih tingkat keparahan.'; end if;
  if p_tanggal is not null and (p_tanggal > v_today or p_tanggal < v_today - 180) then
    raise exception using errcode = '22023', message = 'KOMPLAIN_TANGGAL: tanggal komplain tidak boleh di masa depan atau lebih dari 180 hari lalu.'; end if;
  select * into v_cat from public.complaint_categories where id = p_category_id;
  if not found or not v_cat.is_active then raise exception using errcode = '22023', message = 'KOMPLAIN_KATEGORI: pilih kategori yang aktif.'; end if;
  v_desk := btrim(coalesce(p_deskripsi, ''));
  if length(v_desk) < 5 or length(v_desk) > 4000 then raise exception using errcode = '22023', message = 'KOMPLAIN_DESKRIPSI: isi komplain wajib diisi (5 sampai 4000 huruf).'; end if;
  v_harapan := nullif(btrim(coalesce(p_harapan, '')), '');
  if length(v_harapan) > 1000 then raise exception using errcode = '22023', message = 'KOMPLAIN_HARAPAN: harapan pelanggan maksimal 1000 huruf.'; end if;
  if p_nominal is not null and (p_nominal < 0 or p_nominal > 1000000000000) then
    raise exception using errcode = '22023', message = 'KOMPLAIN_NOMINAL: nilai rupiah tidak valid.'; end if;
  v_ref_jenis := nullif(btrim(coalesce(p_ref_jenis, '')), ''); v_refno := nullif(btrim(coalesce(p_ref_nomor, '')), '');
  if (v_ref_jenis is null) <> (v_refno is null) or (v_ref_jenis is not null and v_ref_jenis not in ('Invoice klinik', 'Struk petshop', 'Pesanan online', 'Lainnya')) or length(v_refno) > 60 then
    raise exception using errcode = '22023', message = 'KOMPLAIN_REFERENSI: isi jenis dan nomor dokumen bersama-sama (nomor maks. 60 huruf).'; end if;

  v_nama := nullif(btrim(coalesce(p_nama, '')), ''); v_tel := nullif(btrim(coalesce(p_telepon, '')), '');
  if p_customer_id is not null then
    select coalesce(v_nama, c.name::text), coalesce(v_tel, c.phone::text) into v_nama, v_tel from public.customers c where c.id = p_customer_id;
    if not found then raise exception using errcode = '22023', message = 'KOMPLAIN_PELANGGAN: pelanggan tidak ditemukan.'; end if;
  end if;
  if length(v_nama) > 120 or length(v_tel) > 40 then raise exception using errcode = '22023', message = 'KOMPLAIN_PELANGGAN: nama/telepon terlalu panjang.'; end if;
  if p_pet_id is not null then
    select pt.name::text into v_pet from public.pets pt where pt.id = p_pet_id and pt.customer_id = p_customer_id;
    if not found then raise exception using errcode = '22023', message = 'KOMPLAIN_HEWAN: hewan bukan milik pelanggan yang dipilih.'; end if;
  end if;

  if p_karyawan is not null and cardinality(p_karyawan) > 10 then raise exception using errcode = '22023', message = 'KOMPLAIN_KARYAWAN: maksimal 10 karyawan.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.nama) order by e.nama, e.id), '[]'::jsonb) into v_inv
    from public.employees e where e.id = any (coalesce(p_karyawan, '{}'::uuid[])) and e.trashed_at is null;
  if jsonb_array_length(v_inv) <> (select count(distinct x) from unnest(coalesce(p_karyawan, '{}'::uuid[])) x) then
    raise exception using errcode = '22023', message = 'KOMPLAIN_KARYAWAN: ada karyawan yang tidak ditemukan.'; end if;
  if p_assigned is not null and not clinic_private.komplain_user_di_cabang(p_assigned, p_branch_id) then
    raise exception using errcode = '22023', message = 'KOMPLAIN_PETUGAS: petugas harus akun aktif yang punya akses ke cabang ini.'; end if;
  v_lamp := clinic_private.komplain_lampiran(p_lampiran);

  v_hash := md5(jsonb_build_object('b', p_branch_id, 'c', p_channel, 'd', p_tanggal, 'cu', p_customer_id, 'p', p_pet_id, 'n', v_nama, 't', v_tel,
    'rj', v_ref_jenis, 'rn', v_refno, 'k', p_category_id, 's', p_severity, 'ds', v_desk, 'h', v_harapan, 'kw', v_inv, 'nm', p_nominal, 'a', p_assigned, 'l', v_lamp)::text);
  perform pg_advisory_xact_lock(hashtextextended('komplain-buat:' || v_actor::text || ':' || p_request_key::text, 0));
  select * into v_dup from public.customer_complaints where created_by = v_actor and request_key = p_request_key;
  if found then
    if v_dup.request_hash <> v_hash then
      raise exception using errcode = '22023', message = 'KOMPLAIN_KUNCI_DIPAKAI: permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman.'; end if;
    return jsonb_build_object('id', v_dup.id, 'nomor', v_dup.complaint_no, 'already_applied', true);
  end if;

  v_at := case when p_tanggal is null or p_tanggal = v_today then now()
               else ((p_tanggal::timestamp + (now() at time zone 'Asia/Jakarta')::time) at time zone 'Asia/Jakarta') end;
  v_period := to_char(now() at time zone 'Asia/Jakarta', 'YYYYMM');
  insert into public.complaint_counters as k(period, last_no) values (v_period, 1)
    on conflict (period) do update set last_no = k.last_no + 1 returning k.last_no into v_n;
  v_no := 'KMP-' || v_period || '-' || case when v_n < 10000 then lpad(v_n::text, 4, '0') else v_n::text end;

  insert into public.customer_complaints(complaint_no, branch_id, channel, complained_at, complaint_date, customer_id, pet_id, customer_name, customer_phone, pet_name,
      ref_kind, ref_no, category_id, severity, description, desired_resolution, involved, amount_at_stake, assigned_to, status, created_by, request_key, request_hash)
  values (v_no, p_branch_id, p_channel, v_at, (v_at at time zone 'Asia/Jakarta')::date, p_customer_id, p_pet_id, v_nama, v_tel, v_pet,
      v_ref_jenis, v_refno, p_category_id, p_severity, v_desk, v_harapan, v_inv, p_nominal, p_assigned, 'Baru', v_actor, p_request_key, v_hash)
  returning id into v_id;
  perform clinic_private.komplain_log(v_id, p_branch_id, 'dibuat', null, 'Baru', null,
    jsonb_build_object('nomor', v_no, 'kategori', v_cat.name, 'tingkat', p_severity, 'petugas', p_assigned), null);
  insert into public.customer_complaint_files(complaint_id, branch_id, path, nama, mime, ukuran, uploaded_by)
  select v_id, p_branch_id, x.path, x.nama, x.mime, x.ukuran::bigint, v_actor from jsonb_to_recordset(v_lamp) as x(path text, nama text, mime text, ukuran numeric);
  return jsonb_build_object('id', v_id, 'nomor', v_no, 'already_applied', false);
end $f$;
comment on function public.komplain_buat(uuid, uuid, text, date, uuid, uuid, text, text, text, text, uuid, text, text, text, uuid[], numeric, uuid, jsonb) is
  'Catat komplain pelanggan baru (nomor KMP-YYYYMM-NNNN). Tidak menyentuh uang/stok. Kunci anti-dobel per pembuat.';
revoke all on function public.komplain_buat(uuid, uuid, text, date, uuid, uuid, text, text, text, text, uuid, text, text, text, uuid[], numeric, uuid, jsonb) from public, anon, service_role;
grant execute on function public.komplain_buat(uuid, uuid, text, date, uuid, uuid, text, text, text, text, uuid, text, text, text, uuid[], numeric, uuid, jsonb) to authenticated;

create function public.komplain_ubah_status(p_id uuid, p_status text, p_catatan text, p_resolusi_jenis text, p_request_key uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s' as $f$
declare
  v_actor uuid := auth.uid(); v_role text; c public.customer_complaints; v_note text; v_tipe text; v_dup public.customer_complaint_history;
  v_tutup boolean; v_now timestamptz := clock_timestamp(); v_ok boolean;
begin
  v_role := clinic_private.komplain_actor();
  if v_role is null then raise exception using errcode = '42501', message = 'KOMPLAIN_DITOLAK: akun ini tidak boleh memakai Komplain Pelanggan.'; end if;
  if p_request_key is null then raise exception using errcode = '22023', message = 'KOMPLAIN_KUNCI: muat ulang halaman lalu coba lagi.'; end if;
  if p_status is null or p_status not in ('Dicek', 'Dalam penanganan', 'Menunggu pelanggan', 'Selesai', 'Ditolak') then
    raise exception using errcode = '22023', message = 'KOMPLAIN_STATUS: status tujuan tidak dikenal.'; end if;
  v_note := nullif(btrim(coalesce(p_catatan, '')), '');
  if length(v_note) > 4000 then raise exception using errcode = '22023', message = 'KOMPLAIN_CATATAN: catatan maksimal 4000 huruf.'; end if;
  select * into c from public.customer_complaints where id = p_id for update;
  if not found or not public.komplain_visible(c.branch_id, c.created_by, c.assigned_to) then
    raise exception using errcode = '42501', message = 'KOMPLAIN_TIDAK_ADA: komplain tidak ditemukan atau bukan untuk akun ini.'; end if;
  select * into v_dup from public.customer_complaint_history where complaint_id = c.id and request_key = p_request_key;
  if found then
    if v_dup.kind = 'status' and v_dup.to_status = p_status and v_dup.actor = v_actor then
      return jsonb_build_object('id', c.id, 'status', c.status, 'already_applied', true); end if;
    raise exception using errcode = '22023', message = 'KOMPLAIN_KUNCI_DIPAKAI: permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman.';
  end if;
  if not (coalesce(c.created_by = v_actor, false) or coalesce(c.assigned_to = v_actor, false) or clinic_private.komplain_kelola()) then
    raise exception using errcode = '42501', message = 'KOMPLAIN_BUKAN_PENANGANAN: hanya pembuat, petugas, atau pemegang izin kelola yang boleh mengubah status.'; end if;
  if c.status = p_status then raise exception using errcode = '22023', message = 'KOMPLAIN_STATUS_SAMA: komplain sudah berstatus ' || p_status || '.'; end if;
  if c.closed_at is not null then
    if p_status <> 'Dalam penanganan' then
      raise exception using errcode = '22023', message = 'KOMPLAIN_TRANSISI: komplain yang sudah ditutup hanya bisa dibuka kembali ke "Dalam penanganan".'; end if;
    if not clinic_private.komplain_kelola() then
      raise exception using errcode = '42501', message = 'KOMPLAIN_BUKA_KEMBALI: membuka kembali komplain yang sudah ditutup hanya untuk Owner atau pemegang izin kelola.'; end if;
    if length(v_note) is null or length(v_note) < 5 then
      raise exception using errcode = '22023', message = 'KOMPLAIN_ALASAN_BUKA: tulis alasan membuka kembali (minimal 5 huruf).'; end if;
  else
    v_ok := case c.status
      when 'Baru' then p_status in ('Dicek', 'Dalam penanganan', 'Menunggu pelanggan', 'Selesai', 'Ditolak')
      when 'Dicek' then p_status in ('Dalam penanganan', 'Menunggu pelanggan', 'Selesai', 'Ditolak')
      when 'Dalam penanganan' then p_status in ('Menunggu pelanggan', 'Selesai', 'Ditolak')
      when 'Menunggu pelanggan' then p_status in ('Dalam penanganan', 'Selesai', 'Ditolak')
      else false end;
    if not v_ok then raise exception using errcode = '22023', message = 'KOMPLAIN_TRANSISI: dari "' || c.status || '" tidak bisa langsung ke "' || p_status || '".'; end if;
  end if;
  v_tutup := p_status in ('Selesai', 'Ditolak');
  v_tipe := nullif(btrim(coalesce(p_resolusi_jenis, '')), '');
  if v_tutup then
    if length(v_note) is null or length(v_note) < 5 then
      raise exception using errcode = '22023', message = 'KOMPLAIN_CATATAN_PENYELESAIAN: menutup komplain wajib dengan catatan penyelesaian (minimal 5 huruf).'; end if;
    if v_tipe is null or v_tipe not in ('Maaf/penjelasan', 'Ganti barang', 'Refund', 'Diskon/voucher', 'Edukasi staf', 'Tidak valid') then
      raise exception using errcode = '22023', message = 'KOMPLAIN_JENIS_PENYELESAIAN: pilih jenis penyelesaian.'; end if;
    if p_status = 'Ditolak' and v_tipe <> 'Tidak valid' then
      raise exception using errcode = '22023', message = 'KOMPLAIN_PENYELESAIAN_TIDAK_COCOK: komplain yang ditolak berjenis penyelesaian "Tidak valid".'; end if;
    if p_status = 'Selesai' and v_tipe = 'Tidak valid' then
      raise exception using errcode = '22023', message = 'KOMPLAIN_PENYELESAIAN_TIDAK_COCOK: "Tidak valid" hanya untuk status Ditolak.'; end if;
  elsif v_tipe is not null then
    raise exception using errcode = '22023', message = 'KOMPLAIN_JENIS_PENYELESAIAN_TERLARANG: jenis penyelesaian hanya diisi saat menutup komplain.';
  end if;
  update public.customer_complaints set status = p_status,
    first_response_at = case when c.status = 'Baru' then v_now else first_response_at end,
    closed_at = case when v_tutup then v_now else null end, closed_by = case when v_tutup then v_actor else null end,
    resolution_type = case when v_tutup then v_tipe else null end, resolution_note = case when v_tutup then v_note else null end,
    updated_at = v_now where id = c.id;
  perform clinic_private.komplain_log(c.id, c.branch_id, 'status', c.status, p_status, v_note,
    case when v_tutup then jsonb_build_object('jenis_penyelesaian', v_tipe) else null end, p_request_key);
  return jsonb_build_object('id', c.id, 'status', p_status, 'already_applied', false);
end $f$;
revoke all on function public.komplain_ubah_status(uuid, text, text, text, uuid) from public, anon, service_role;
grant execute on function public.komplain_ubah_status(uuid, text, text, text, uuid) to authenticated;

create function public.komplain_catatan(p_id uuid, p_catatan text, p_lampiran jsonb, p_request_key uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s' as $f$
declare v_actor uuid := auth.uid(); v_role text; c public.customer_complaints; v_note text; v_lamp jsonb; v_dup public.customer_complaint_history;
begin
  v_role := clinic_private.komplain_actor();
  if v_role is null then raise exception using errcode = '42501', message = 'KOMPLAIN_DITOLAK: akun ini tidak boleh memakai Komplain Pelanggan.'; end if;
  if p_request_key is null then raise exception using errcode = '22023', message = 'KOMPLAIN_KUNCI: muat ulang halaman lalu coba lagi.'; end if;
  v_note := nullif(btrim(coalesce(p_catatan, '')), ''); v_lamp := clinic_private.komplain_lampiran(p_lampiran);
  if (v_note is null or length(v_note) < 2) and jsonb_array_length(v_lamp) = 0 then
    raise exception using errcode = '22023', message = 'KOMPLAIN_CATATAN: tulis catatan atau lampirkan berkas.'; end if;
  if length(v_note) > 4000 then raise exception using errcode = '22023', message = 'KOMPLAIN_CATATAN: catatan maksimal 4000 huruf.'; end if;
  select * into c from public.customer_complaints where id = p_id for update;
  if not found or not public.komplain_visible(c.branch_id, c.created_by, c.assigned_to) then
    raise exception using errcode = '42501', message = 'KOMPLAIN_TIDAK_ADA: komplain tidak ditemukan atau bukan untuk akun ini.'; end if;
  select * into v_dup from public.customer_complaint_history where complaint_id = c.id and request_key = p_request_key;
  if found then
    if v_dup.kind in ('catatan', 'lampiran') and v_dup.actor = v_actor and v_dup.note is not distinct from v_note then
      return jsonb_build_object('id', c.id, 'already_applied', true); end if;
    raise exception using errcode = '22023', message = 'KOMPLAIN_KUNCI_DIPAKAI: permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman.';
  end if;
  if c.closed_at is not null then
    raise exception using errcode = '22023', message = 'KOMPLAIN_SUDAH_DITUTUP: komplain sudah ditutup; buka kembali dulu untuk menambah catatan.'; end if;
  insert into public.customer_complaint_files(complaint_id, branch_id, path, nama, mime, ukuran, uploaded_by)
  select c.id, c.branch_id, x.path, x.nama, x.mime, x.ukuran::bigint, v_actor from jsonb_to_recordset(v_lamp) as x(path text, nama text, mime text, ukuran numeric);
  perform clinic_private.komplain_log(c.id, c.branch_id, case when v_note is null then 'lampiran' else 'catatan' end, null, null, v_note,
    case when jsonb_array_length(v_lamp) > 0 then jsonb_build_object('lampiran', (select jsonb_agg(x.nama) from jsonb_to_recordset(v_lamp) as x(nama text))) else null end, p_request_key);
  return jsonb_build_object('id', c.id, 'already_applied', false);
end $f$;
revoke all on function public.komplain_catatan(uuid, text, jsonb, uuid) from public, anon, service_role;
grant execute on function public.komplain_catatan(uuid, text, jsonb, uuid) to authenticated;

create function public.komplain_ubah_detail(
  p_id uuid, p_category_id uuid, p_severity text, p_assigned uuid, p_karyawan uuid[], p_nominal numeric, p_harapan text,
  p_ref_jenis text, p_ref_nomor text, p_catatan text, p_request_key uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s' as $f$
declare
  v_actor uuid := auth.uid(); v_role text; c public.customer_complaints; v_note text; v_dup public.customer_complaint_history; v_cat public.complaint_categories;
  v_inv jsonb; v_harapan text; v_ref_jenis text; v_refno text; v_ch jsonb := '{}'::jsonb; v_only_assign boolean; v_now timestamptz := clock_timestamp();
begin
  v_role := clinic_private.komplain_actor();
  if v_role is null then raise exception using errcode = '42501', message = 'KOMPLAIN_DITOLAK: akun ini tidak boleh memakai Komplain Pelanggan.'; end if;
  if p_request_key is null then raise exception using errcode = '22023', message = 'KOMPLAIN_KUNCI: muat ulang halaman lalu coba lagi.'; end if;
  v_note := nullif(btrim(coalesce(p_catatan, '')), '');
  if v_note is null or length(v_note) < 3 or length(v_note) > 4000 then
    raise exception using errcode = '22023', message = 'KOMPLAIN_ALASAN_UBAH: tulis alasan perubahan (minimal 3 huruf).'; end if;
  select * into c from public.customer_complaints where id = p_id for update;
  if not found or not public.komplain_visible(c.branch_id, c.created_by, c.assigned_to) then
    raise exception using errcode = '42501', message = 'KOMPLAIN_TIDAK_ADA: komplain tidak ditemukan atau bukan untuk akun ini.'; end if;
  select * into v_dup from public.customer_complaint_history where complaint_id = c.id and request_key = p_request_key;
  if found then
    if v_dup.kind in ('ubah', 'tugaskan') and v_dup.actor = v_actor then return jsonb_build_object('id', c.id, 'already_applied', true); end if;
    raise exception using errcode = '22023', message = 'KOMPLAIN_KUNCI_DIPAKAI: permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman.';
  end if;
  if not (coalesce(c.created_by = v_actor, false) or coalesce(c.assigned_to = v_actor, false) or clinic_private.komplain_kelola()) then
    raise exception using errcode = '42501', message = 'KOMPLAIN_BUKAN_PENANGANAN: hanya pembuat, petugas, atau pemegang izin kelola yang boleh mengubah komplain.'; end if;
  if c.closed_at is not null then
    raise exception using errcode = '22023', message = 'KOMPLAIN_SUDAH_DITUTUP: komplain sudah ditutup; buka kembali dulu untuk mengubahnya.'; end if;
  select * into v_cat from public.complaint_categories where id = p_category_id;
  if not found or (not v_cat.is_active and p_category_id is distinct from c.category_id) then
    raise exception using errcode = '22023', message = 'KOMPLAIN_KATEGORI: pilih kategori yang aktif.'; end if;
  if p_severity is null or p_severity not in ('Rendah', 'Sedang', 'Tinggi', 'Kritis') then
    raise exception using errcode = '22023', message = 'KOMPLAIN_TINGKAT: pilih tingkat keparahan.'; end if;
  if p_nominal is not null and (p_nominal < 0 or p_nominal > 1000000000000) then
    raise exception using errcode = '22023', message = 'KOMPLAIN_NOMINAL: nilai rupiah tidak valid.'; end if;
  v_harapan := nullif(btrim(coalesce(p_harapan, '')), '');
  if length(v_harapan) > 1000 then raise exception using errcode = '22023', message = 'KOMPLAIN_HARAPAN: harapan pelanggan maksimal 1000 huruf.'; end if;
  v_ref_jenis := nullif(btrim(coalesce(p_ref_jenis, '')), ''); v_refno := nullif(btrim(coalesce(p_ref_nomor, '')), '');
  if (v_ref_jenis is null) <> (v_refno is null) or (v_ref_jenis is not null and v_ref_jenis not in ('Invoice klinik', 'Struk petshop', 'Pesanan online', 'Lainnya')) or length(v_refno) > 60 then
    raise exception using errcode = '22023', message = 'KOMPLAIN_REFERENSI: isi jenis dan nomor dokumen bersama-sama (nomor maks. 60 huruf).'; end if;
  if p_karyawan is not null and cardinality(p_karyawan) > 10 then raise exception using errcode = '22023', message = 'KOMPLAIN_KARYAWAN: maksimal 10 karyawan.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.nama) order by e.nama, e.id), '[]'::jsonb) into v_inv
    from public.employees e where e.id = any (coalesce(p_karyawan, '{}'::uuid[])) and e.trashed_at is null;
  if jsonb_array_length(v_inv) <> (select count(distinct x) from unnest(coalesce(p_karyawan, '{}'::uuid[])) x) then
    raise exception using errcode = '22023', message = 'KOMPLAIN_KARYAWAN: ada karyawan yang tidak ditemukan.'; end if;
  if p_assigned is not null and p_assigned is distinct from c.assigned_to and not clinic_private.komplain_user_di_cabang(p_assigned, c.branch_id) then
    raise exception using errcode = '22023', message = 'KOMPLAIN_PETUGAS: petugas harus akun aktif yang punya akses ke cabang ini.'; end if;

  if p_category_id is distinct from c.category_id then v_ch := v_ch || jsonb_build_object('kategori', jsonb_build_object('dari', (select name from public.complaint_categories where id = c.category_id), 'ke', v_cat.name)); end if;
  if p_severity is distinct from c.severity then v_ch := v_ch || jsonb_build_object('tingkat', jsonb_build_object('dari', c.severity, 'ke', p_severity)); end if;
  if p_assigned is distinct from c.assigned_to then
    v_ch := v_ch || jsonb_build_object('petugas', jsonb_build_object('dari', (select full_name from public.profiles where id = c.assigned_to), 'ke', (select full_name from public.profiles where id = p_assigned))); end if;
  if v_inv is distinct from c.involved then v_ch := v_ch || jsonb_build_object('karyawan', jsonb_build_object('dari', c.involved, 'ke', v_inv)); end if;
  if p_nominal is distinct from c.amount_at_stake then v_ch := v_ch || jsonb_build_object('nominal', jsonb_build_object('dari', c.amount_at_stake, 'ke', p_nominal)); end if;
  if v_harapan is distinct from c.desired_resolution then v_ch := v_ch || jsonb_build_object('harapan', jsonb_build_object('dari', c.desired_resolution, 'ke', v_harapan)); end if;
  if v_ref_jenis is distinct from c.ref_kind or v_refno is distinct from c.ref_no then
    v_ch := v_ch || jsonb_build_object('referensi', jsonb_build_object('dari', c.ref_kind || ' ' || c.ref_no, 'ke', v_ref_jenis || ' ' || v_refno)); end if;
  if v_ch = '{}'::jsonb then raise exception using errcode = '22023', message = 'KOMPLAIN_TIDAK_ADA_PERUBAHAN: tidak ada yang berubah.'; end if;
  v_only_assign := (select count(*) from jsonb_object_keys(v_ch)) = 1 and v_ch ? 'petugas';

  update public.customer_complaints set category_id = p_category_id, severity = p_severity, assigned_to = p_assigned, involved = v_inv,
    amount_at_stake = p_nominal, desired_resolution = v_harapan, ref_kind = v_ref_jenis, ref_no = v_refno, updated_at = v_now where id = c.id;
  perform clinic_private.komplain_log(c.id, c.branch_id, case when v_only_assign then 'tugaskan' else 'ubah' end, null, null, v_note, v_ch, p_request_key);
  return jsonb_build_object('id', c.id, 'already_applied', false);
end $f$;
revoke all on function public.komplain_ubah_detail(uuid, uuid, text, uuid, uuid[], numeric, text, text, text, text, uuid) from public, anon, service_role;
grant execute on function public.komplain_ubah_detail(uuid, uuid, text, uuid, uuid[], numeric, text, text, text, text, uuid) to authenticated;

create function public.komplain_kategori_simpan(p_id uuid, p_nama text, p_urut integer, p_aktif boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s' as $f$
declare v_nama text; v_old public.complaint_categories; v_id uuid; v_urut integer;
begin
  if clinic_private.komplain_actor() is null then raise exception using errcode = '42501', message = 'KOMPLAIN_DITOLAK: akun ini tidak boleh memakai Komplain Pelanggan.'; end if;
  if not clinic_private.komplain_kelola() then
    raise exception using errcode = '42501', message = 'KOMPLAIN_KELOLA_DITOLAK: kategori hanya bisa diubah Owner atau pemegang izin kelola komplain.'; end if;
  v_nama := btrim(coalesce(p_nama, ''));
  if length(v_nama) < 2 or length(v_nama) > 60 then raise exception using errcode = '22023', message = 'KOMPLAIN_KATEGORI_NAMA: nama kategori 2 sampai 60 huruf.'; end if;
  if p_aktif is null then raise exception using errcode = '22023', message = 'KOMPLAIN_KATEGORI_AKTIF: tentukan aktif atau tidak.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('komplain-kategori', 0));
  if exists (select 1 from public.complaint_categories where lower(btrim(name)) = lower(v_nama) and id is distinct from p_id) then
    raise exception using errcode = '23505', message = 'KOMPLAIN_KATEGORI_KEMBAR: kategori dengan nama itu sudah ada.'; end if;
  if p_id is null then
    select coalesce(max(sort_order), 0) + 10 into v_urut from public.complaint_categories;
    insert into public.complaint_categories(name, sort_order, is_active, created_by) values (v_nama, least(coalesce(p_urut, v_urut), 9999), p_aktif, auth.uid()) returning id into v_id;
    insert into public.complaint_config_log(kind, ref, old_value, new_value, actor) values ('kategori', v_id::text, null, jsonb_build_object('nama', v_nama, 'aktif', p_aktif), auth.uid());
  else
    select * into v_old from public.complaint_categories where id = p_id for update;
    if not found then raise exception using errcode = '22023', message = 'KOMPLAIN_KATEGORI: kategori tidak ditemukan.'; end if;
    update public.complaint_categories set name = v_nama, sort_order = coalesce(p_urut, sort_order), is_active = p_aktif, updated_at = now() where id = p_id;
    v_id := p_id;
    insert into public.complaint_config_log(kind, ref, old_value, new_value, actor)
    values ('kategori', v_id::text, jsonb_build_object('nama', v_old.name, 'aktif', v_old.is_active, 'urut', v_old.sort_order), jsonb_build_object('nama', v_nama, 'aktif', p_aktif, 'urut', coalesce(p_urut, v_old.sort_order)), auth.uid());
  end if;
  return jsonb_build_object('id', v_id);
end $f$;
revoke all on function public.komplain_kategori_simpan(uuid, text, integer, boolean) from public, anon, service_role;
grant execute on function public.komplain_kategori_simpan(uuid, text, integer, boolean) to authenticated;

create function public.komplain_pengaturan_simpan(p_hari_telat integer) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s' as $f$
declare v_old integer;
begin
  if clinic_private.komplain_actor() is null then raise exception using errcode = '42501', message = 'KOMPLAIN_DITOLAK: akun ini tidak boleh memakai Komplain Pelanggan.'; end if;
  if not clinic_private.komplain_kelola() then
    raise exception using errcode = '42501', message = 'KOMPLAIN_KELOLA_DITOLAK: pengaturan hanya bisa diubah Owner atau pemegang izin kelola komplain.'; end if;
  if p_hari_telat is null or p_hari_telat < 1 or p_hari_telat > 90 then
    raise exception using errcode = '22023', message = 'KOMPLAIN_HARI_TELAT: batas terlambat 1 sampai 90 hari.'; end if;
  select overdue_days into v_old from public.complaint_settings where id for update;
  update public.complaint_settings set overdue_days = p_hari_telat, updated_by = auth.uid(), updated_at = now() where id;
  insert into public.complaint_config_log(kind, ref, old_value, new_value, actor)
  values ('pengaturan', 'overdue_days', to_jsonb(v_old), to_jsonb(p_hari_telat), auth.uid());
  return jsonb_build_object('hari_telat', p_hari_telat);
end $f$;
revoke all on function public.komplain_pengaturan_simpan(integer) from public, anon, service_role;
grant execute on function public.komplain_pengaturan_simpan(integer) to authenticated;

-- ───────────── 6. Fungsi baca ─────────────
-- Pilihan untuk formulir: kategori aktif, cabang yang boleh diakses, petugas yang bisa ditugaskan di cabang itu, dan hak akun ini.
create function public.komplain_pilihan(p_branch uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $f$
declare v_role text;
begin
  v_role := clinic_private.komplain_actor();
  if v_role is null then raise exception using errcode = '42501', message = 'KOMPLAIN_DITOLAK: akun ini tidak boleh memakai Komplain Pelanggan.'; end if;
  return jsonb_build_object(
    'peran', v_role, 'kelola', clinic_private.komplain_kelola(),
    'hari_telat', (select overdue_days from public.complaint_settings),
    'kategori', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'nama', k.name) order by k.sort_order, k.name), '[]'::jsonb) from public.complaint_categories k where k.is_active),
    'cabang', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'nama', b.name, 'kode', b.code) order by b.name, b.id), '[]'::jsonb)
               from public.branches b where b.is_active and public.user_can_access_branch(b.id)),
    'petugas', case when p_branch is null or not public.user_can_access_branch(p_branch) then '[]'::jsonb else
      (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nama', coalesce(p.full_name, 'Tanpa nama'), 'peran', p.role::text) order by p.full_name, p.id), '[]'::jsonb)
       from public.profiles p where p.is_active and clinic_private.komplain_user_di_cabang(p.id, p_branch)) end);
end $f$;
revoke all on function public.komplain_pilihan(uuid) from public, anon, service_role;
grant execute on function public.komplain_pilihan(uuid) to authenticated;

create function public.komplain_kategori_daftar() returns jsonb
language plpgsql stable security definer set search_path = '' as $f$
begin
  if clinic_private.komplain_actor() is null then raise exception using errcode = '42501', message = 'KOMPLAIN_DITOLAK: akun ini tidak boleh memakai Komplain Pelanggan.'; end if;
  return jsonb_build_object('kelola', clinic_private.komplain_kelola(), 'hari_telat', (select overdue_days from public.complaint_settings),
    'kategori', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'nama', k.name, 'urut', k.sort_order, 'aktif', k.is_active,
        'dipakai', (select count(*) from public.customer_complaints c where c.category_id = k.id and public.komplain_visible(c.branch_id, c.created_by, c.assigned_to)))
        order by k.sort_order, k.name), '[]'::jsonb) from public.complaint_categories k));
end $f$;
revoke all on function public.komplain_kategori_daftar() from public, anon, service_role;
grant execute on function public.komplain_kategori_daftar() to authenticated;

-- Bentuk satu baris komplain untuk daftar/detail/dashboard (tanpa akses tabel: murni).
create function clinic_private.komplain_json(c public.customer_complaints, p_kategori text, p_cabang text, p_petugas text, p_today date, p_hari integer) returns jsonb
language sql immutable security invoker set search_path = '' as $f$
  select jsonb_build_object(
    'id', c.id, 'nomor', c.complaint_no, 'cabang_id', c.branch_id, 'cabang', p_cabang, 'kanal', c.channel, 'tanggal', c.complaint_date, 'waktu', c.complained_at,
    'pelanggan_id', c.customer_id, 'hewan_id', c.pet_id, 'nama', c.customer_name, 'telepon', c.customer_phone, 'hewan', c.pet_name,
    'ref_jenis', c.ref_kind, 'ref_nomor', c.ref_no, 'kategori_id', c.category_id, 'kategori', p_kategori, 'tingkat', c.severity,
    'deskripsi', c.description, 'harapan', c.desired_resolution, 'karyawan', c.involved, 'nominal', c.amount_at_stake,
    'petugas_id', c.assigned_to, 'petugas', p_petugas, 'status', c.status, 'respons_pertama', c.first_response_at, 'ditutup', c.closed_at,
    'jenis_penyelesaian', c.resolution_type, 'catatan_penyelesaian', c.resolution_note, 'dibuat_oleh', c.created_by, 'dibuat', c.created_at,
    'umur_hari', case when c.closed_at is null then p_today - c.complaint_date end,
    'terlambat', c.closed_at is null and p_today - c.complaint_date > p_hari,
    'respons_jam', round(extract(epoch from c.first_response_at - c.complained_at) / 3600.0, 1),
    'selesai_hari', round(extract(epoch from c.closed_at - c.complained_at) / 86400.0, 1));
$f$;
revoke all on function clinic_private.komplain_json(public.customer_complaints, text, text, text, date, integer) from public, anon, authenticated, service_role;

-- Daftar komplain (disaring). Status khusus: 'terbuka' (belum ditutup) | 'ditutup'. Urutan: terbaru (bawaan) | umur | nomor.
create function public.komplain_daftar(
  p_dari date, p_sampai date, p_branch uuid, p_kategori uuid, p_severity text, p_status text, p_assigned uuid, p_channel text,
  p_q text, p_urut text, p_limit integer, p_offset integer
) returns jsonb
language plpgsql stable security definer set search_path = '' as $f$
declare v_today date := (now() at time zone 'Asia/Jakarta')::date; v_hari integer; v_q text; v_lim integer; v_off integer; v_urut text; v_total integer; v_rows jsonb;
begin
  if clinic_private.komplain_actor() is null then raise exception using errcode = '42501', message = 'KOMPLAIN_DITOLAK: akun ini tidak boleh memakai Komplain Pelanggan.'; end if;
  if p_severity is not null and p_severity not in ('Rendah', 'Sedang', 'Tinggi', 'Kritis') then raise exception using errcode = '22023', message = 'KOMPLAIN_TINGKAT: tingkat tidak dikenal.'; end if;
  if p_status is not null and p_status not in ('Baru', 'Dicek', 'Dalam penanganan', 'Menunggu pelanggan', 'Selesai', 'Ditolak', 'terbuka', 'ditutup') then
    raise exception using errcode = '22023', message = 'KOMPLAIN_STATUS: status tidak dikenal.'; end if;
  if p_channel is not null and p_channel not in ('Petshop', 'Klinik', 'Grooming', 'Rawat Inap', 'Online Shopee', 'Lainnya') then
    raise exception using errcode = '22023', message = 'KOMPLAIN_KANAL: asal komplain tidak dikenal.'; end if;
  if p_dari is not null and p_sampai is not null and p_sampai < p_dari then raise exception using errcode = '22023', message = 'KOMPLAIN_RENTANG: tanggal akhir sebelum tanggal awal.'; end if;
  v_urut := case when p_urut in ('umur', 'nomor') then p_urut else 'terbaru' end;
  v_lim := least(greatest(coalesce(p_limit, 50), 1), 5000); v_off := greatest(coalesce(p_offset, 0), 0);
  v_q := nullif(btrim(coalesce(p_q, '')), '');
  if v_q is not null then v_q := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  select overdue_days into v_hari from public.complaint_settings;
  select count(*) into v_total from public.customer_complaints c
   where public.komplain_visible(c.branch_id, c.created_by, c.assigned_to)
     and (p_dari is null or c.complaint_date >= p_dari) and (p_sampai is null or c.complaint_date <= p_sampai)
     and (p_branch is null or c.branch_id = p_branch) and (p_kategori is null or c.category_id = p_kategori)
     and (p_severity is null or c.severity = p_severity) and (p_assigned is null or c.assigned_to = p_assigned) and (p_channel is null or c.channel = p_channel)
     and (p_status is null or (p_status = 'terbuka' and c.closed_at is null) or (p_status = 'ditutup' and c.closed_at is not null) or c.status = p_status)
     and (v_q is null or c.complaint_no ilike v_q or c.customer_name ilike v_q or c.customer_phone ilike v_q or c.ref_no ilike v_q or c.description ilike v_q);
  select coalesce(jsonb_agg(x.j order by x.rn), '[]'::jsonb) into v_rows from (
    select row_number() over (order by
        case when v_urut = 'umur' then (c.closed_at is null)::integer else 0 end desc,
        case when v_urut = 'terbaru' then c.complained_at end desc, case when v_urut = 'umur' then c.complained_at end asc,
        case when v_urut = 'nomor' then c.complaint_no end desc, c.id) as rn,
      clinic_private.komplain_json(c, k.name, b.name, pa.full_name, v_today, v_hari) as j
    from public.customer_complaints c
    join public.complaint_categories k on k.id = c.category_id
    join public.branches b on b.id = c.branch_id
    left join public.profiles pa on pa.id = c.assigned_to
    where public.komplain_visible(c.branch_id, c.created_by, c.assigned_to)
      and (p_dari is null or c.complaint_date >= p_dari) and (p_sampai is null or c.complaint_date <= p_sampai)
      and (p_branch is null or c.branch_id = p_branch) and (p_kategori is null or c.category_id = p_kategori)
      and (p_severity is null or c.severity = p_severity) and (p_assigned is null or c.assigned_to = p_assigned) and (p_channel is null or c.channel = p_channel)
      and (p_status is null or (p_status = 'terbuka' and c.closed_at is null) or (p_status = 'ditutup' and c.closed_at is not null) or c.status = p_status)
      and (v_q is null or c.complaint_no ilike v_q or c.customer_name ilike v_q or c.customer_phone ilike v_q or c.ref_no ilike v_q or c.description ilike v_q)
    order by rn offset v_off limit v_lim) x;
  return jsonb_build_object('total', v_total, 'baris', v_rows, 'hari_telat', v_hari);
end $f$;
revoke all on function public.komplain_daftar(date, date, uuid, uuid, text, text, uuid, text, text, text, integer, integer) from public, anon, service_role;
grant execute on function public.komplain_daftar(date, date, uuid, uuid, text, text, uuid, text, text, text, integer, integer) to authenticated;

create function public.komplain_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $f$
declare v_today date := (now() at time zone 'Asia/Jakarta')::date; v_hari integer; c public.customer_complaints; v_actor uuid := auth.uid(); v_kelola boolean; v_buka boolean;
begin
  if clinic_private.komplain_actor() is null then raise exception using errcode = '42501', message = 'KOMPLAIN_DITOLAK: akun ini tidak boleh memakai Komplain Pelanggan.'; end if;
  select * into c from public.customer_complaints where id = p_id;
  if not found or not public.komplain_visible(c.branch_id, c.created_by, c.assigned_to) then
    raise exception using errcode = '42501', message = 'KOMPLAIN_TIDAK_ADA: komplain tidak ditemukan atau bukan untuk akun ini.'; end if;
  select overdue_days into v_hari from public.complaint_settings;
  v_kelola := clinic_private.komplain_kelola(); v_buka := coalesce(c.created_by = v_actor, false) or coalesce(c.assigned_to = v_actor, false) or v_kelola;
  return jsonb_build_object(
    'komplain', clinic_private.komplain_json(c, (select name from public.complaint_categories where id = c.category_id), (select name from public.branches where id = c.branch_id),
      (select full_name from public.profiles where id = c.assigned_to), v_today, v_hari)
      || jsonb_build_object('dibuat_nama', (select full_name from public.profiles where id = c.created_by)),
    'riwayat', (select coalesce(jsonb_agg(jsonb_build_object('seq', h.seq, 'jenis', h.kind, 'dari', h.from_status, 'ke', h.to_status, 'catatan', h.note,
        'perubahan', h.changes, 'oleh', h.actor_name, 'peran', h.actor_role, 'waktu', h.created_at) order by h.seq), '[]'::jsonb)
      from public.customer_complaint_history h where h.complaint_id = c.id),
    'berkas', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'path', f.path, 'nama', f.nama, 'mime', f.mime, 'ukuran', f.ukuran, 'waktu', f.created_at) order by f.created_at, f.id), '[]'::jsonb)
      from public.customer_complaint_files f where f.complaint_id = c.id),
    'boleh', jsonb_build_object('ubah', c.closed_at is null and v_buka, 'catatan', c.closed_at is null, 'buka_kembali', c.closed_at is not null and v_kelola and v_buka, 'kelola', v_kelola),
    'hari_telat', v_hari);
end $f$;
revoke all on function public.komplain_detail(uuid) from public, anon, service_role;
grant execute on function public.komplain_detail(uuid) to authenticated;

-- Dashboard. Rentang tanggal (tanggal komplain; bawaan = bulan ini) menentukan jumlah/rincian/tren; angka "terbuka / terlambat / kritis terbuka"
-- dan daftar umur dihitung dari SEMUA komplain yang belum ditutup (tidak dibatasi rentang) agar tunggakan lama tidak hilang dari layar.
create function public.komplain_dashboard(
  p_dari date, p_sampai date, p_branch uuid, p_kategori uuid, p_severity text, p_status text, p_assigned uuid, p_channel text
) returns jsonb
language plpgsql stable security definer set search_path = '' as $f$
declare v_today date := (now() at time zone 'Asia/Jakarta')::date; v_dari date; v_sampai date; v_hari integer; v_bulan date; v_res jsonb;
begin
  if clinic_private.komplain_actor() is null then raise exception using errcode = '42501', message = 'KOMPLAIN_DITOLAK: akun ini tidak boleh memakai Komplain Pelanggan.'; end if;
  if p_severity is not null and p_severity not in ('Rendah', 'Sedang', 'Tinggi', 'Kritis') then raise exception using errcode = '22023', message = 'KOMPLAIN_TINGKAT: tingkat tidak dikenal.'; end if;
  if p_status is not null and p_status not in ('Baru', 'Dicek', 'Dalam penanganan', 'Menunggu pelanggan', 'Selesai', 'Ditolak', 'terbuka', 'ditutup') then
    raise exception using errcode = '22023', message = 'KOMPLAIN_STATUS: status tidak dikenal.'; end if;
  if p_channel is not null and p_channel not in ('Petshop', 'Klinik', 'Grooming', 'Rawat Inap', 'Online Shopee', 'Lainnya') then
    raise exception using errcode = '22023', message = 'KOMPLAIN_KANAL: asal komplain tidak dikenal.'; end if;
  v_dari := coalesce(p_dari, date_trunc('month', v_today::timestamp)::date); v_sampai := coalesce(p_sampai, v_today);
  if v_sampai < v_dari or v_sampai - v_dari > 366 then
    raise exception using errcode = '22023', message = 'KOMPLAIN_RENTANG: rentang tanggal tidak valid (maksimal 367 hari).'; end if;
  select overdue_days into v_hari from public.complaint_settings;
  v_bulan := date_trunc('month', v_today::timestamp)::date;
  with vis as (
    select c.*, k.name as kat_nama, b.name as cab_nama, b.code as cab_kode, pa.full_name as petugas_nama
    from public.customer_complaints c
    join public.complaint_categories k on k.id = c.category_id
    join public.branches b on b.id = c.branch_id
    left join public.profiles pa on pa.id = c.assigned_to
    where public.komplain_visible(c.branch_id, c.created_by, c.assigned_to)
      and (p_branch is null or c.branch_id = p_branch) and (p_kategori is null or c.category_id = p_kategori)
      and (p_severity is null or c.severity = p_severity) and (p_assigned is null or c.assigned_to = p_assigned) and (p_channel is null or c.channel = p_channel)
  ), sel as (
    select * from vis where p_status is null or (p_status = 'terbuka' and closed_at is null) or (p_status = 'ditutup' and closed_at is not null) or status = p_status
  ), base as (
    select * from sel where complaint_date between v_dari and v_sampai
  ), backlog as (
    select * from sel where closed_at is null
  )
  select jsonb_build_object(
    'rentang', jsonb_build_object('dari', v_dari, 'sampai', v_sampai), 'hari_telat', v_hari, 'hari_ini', v_today,
    'kpi', jsonb_build_object(
      'total', (select count(*) from base),
      'terbuka', (select count(*) from backlog),
      'terlambat', (select count(*) from backlog where v_today - complaint_date > v_hari),
      'kritis_terbuka', (select count(*) from backlog where severity = 'Kritis'),
      'ditutup_rentang', (select count(*) from base where closed_at is not null),
      'ditutup_bulan_ini', (select count(*) from vis where closed_at is not null
          and (closed_at at time zone 'Asia/Jakarta')::date >= v_bulan and (closed_at at time zone 'Asia/Jakarta')::date < (v_bulan + interval '1 month')::date),
      'rata_respons_jam', (select round(avg(extract(epoch from first_response_at - complained_at) / 3600.0), 1) from base where first_response_at is not null),
      'rata_selesai_hari', (select round(avg(extract(epoch from closed_at - complained_at) / 86400.0), 1) from base where closed_at is not null)),
    'per_cabang', (select coalesce(jsonb_agg(jsonb_build_object('cabang_id', x.branch_id, 'cabang', x.cab, 'jumlah', x.n, 'terbuka', x.o) order by x.n desc, x.cab, x.branch_id), '[]'::jsonb)
      from (select branch_id, max(cab_nama) cab, count(*) n, count(*) filter (where closed_at is null) o from base group by branch_id) x),
    'per_kategori', (select coalesce(jsonb_agg(jsonb_build_object('kategori_id', x.category_id, 'kategori', x.kat, 'jumlah', x.n, 'terbuka', x.o) order by x.n desc, x.kat, x.category_id), '[]'::jsonb)
      from (select category_id, max(kat_nama) kat, count(*) n, count(*) filter (where closed_at is null) o from base group by category_id) x),
    'per_tingkat', (select coalesce(jsonb_agg(jsonb_build_object('tingkat', s.v, 'jumlah', (select count(*) from base where severity = s.v),
        'terbuka', (select count(*) from base where severity = s.v and closed_at is null)) order by s.o), '[]'::jsonb)
      from unnest(array['Kritis', 'Tinggi', 'Sedang', 'Rendah']) with ordinality as s(v, o)),
    'per_status', (select coalesce(jsonb_agg(jsonb_build_object('status', s.v, 'jumlah', (select count(*) from base where status = s.v)) order by s.o), '[]'::jsonb)
      from unnest(array['Baru', 'Dicek', 'Dalam penanganan', 'Menunggu pelanggan', 'Selesai', 'Ditolak']) with ordinality as s(v, o)),
    'per_kanal', (select coalesce(jsonb_agg(jsonb_build_object('kanal', s.v, 'jumlah', (select count(*) from base where channel = s.v)) order by s.o), '[]'::jsonb)
      from unnest(array['Petshop', 'Klinik', 'Grooming', 'Rawat Inap', 'Online Shopee', 'Lainnya']) with ordinality as s(v, o)),
    'tren_hari', (select coalesce(jsonb_agg(jsonb_build_object('tanggal', d::date, 'jumlah', (select count(*) from base where complaint_date = d::date)) order by d), '[]'::jsonb)
      from generate_series(v_dari::timestamp, v_sampai::timestamp, interval '1 day') d),
    'tren_minggu', (select coalesce(jsonb_agg(jsonb_build_object('minggu', w::date, 'jumlah', (select count(*) from base where date_trunc('week', complaint_date::timestamp) = w)) order by w), '[]'::jsonb)
      from (select distinct date_trunc('week', d) w from generate_series(v_dari::timestamp, v_sampai::timestamp, interval '1 day') d) wk),
    'pelanggan_berulang', (select coalesce(jsonb_agg(jsonb_build_object('pelanggan_id', x.cid, 'nama', x.nama, 'telepon', x.tel, 'jumlah', x.n, 'terakhir', x.last)
        order by x.n desc, x.last desc, x.nama, x.k), '[]'::jsonb)
      from (select coalesce(customer_id::text, 'n:' || lower(btrim(customer_name)) || '|' || regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g')) as k,
              min(customer_id::text) as cid, max(customer_name) as nama, max(customer_phone) as tel, count(*) as n, max(complaint_date) as last
            from base where customer_id is not null or customer_name is not null group by 1 having count(*) >= 2 order by count(*) desc, max(complaint_date) desc, 1 limit 10) x),
    'karyawan_disebut', (select coalesce(jsonb_agg(jsonb_build_object('karyawan_id', x.eid, 'nama', x.nama, 'jumlah', x.n, 'terakhir', x.last)
        order by x.n desc, x.nama, x.eid), '[]'::jsonb)
      from (select e ->> 'id' as eid, max(e ->> 'name') as nama, count(*) as n, max(b.complaint_date) as last
            from base b, jsonb_array_elements(b.involved) e group by e ->> 'id' order by count(*) desc, max(e ->> 'name'), e ->> 'id' limit 10) x),
    'umur_terbuka', (select coalesce(jsonb_agg(clinic_private.komplain_json(cc, x.kat_nama, x.cab_nama, x.petugas_nama, v_today, v_hari) order by cc.complained_at, cc.id), '[]'::jsonb)
      from (select b.id, b.kat_nama, b.cab_nama, b.petugas_nama from backlog b order by b.complained_at, b.id limit 50) x
      join public.customer_complaints cc on cc.id = x.id)
  ) into v_res;
  return v_res;
end $f$;
revoke all on function public.komplain_dashboard(date, date, uuid, uuid, text, text, uuid, text) from public, anon, service_role;
grant execute on function public.komplain_dashboard(date, date, uuid, uuid, text, text, uuid, text) to authenticated;

-- ───────────── 7. Pagar Admin Online (jalankan ulang bila ada tabel/fungsi baru) ─────────────
select admin_online_private.guard_all();
select admin_online_private.fence_all();

-- ───────────── 8. Pemeriksaan pasang: gagal = seluruh migrasi batal ─────────────
do $check$
declare t text; f record; v_n integer;
begin
  foreach t in array array['complaint_categories', 'complaint_settings', 'complaint_counters', 'complaint_config_log', 'customer_complaints', 'customer_complaint_history', 'customer_complaint_files'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'KOMPLAIN_CHECK: RLS mati di %', t; end if;
    if not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t)::regclass and g.tgname = 'zz_admin_online_write_fence' and g.tgenabled = 'O') then
      raise exception 'KOMPLAIN_CHECK: pagar tulis Admin Online tidak ada di %', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('service_role', 'public.' || t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('authenticated', 'public.' || t, 'insert,update,delete,truncate,references,trigger') then
      raise exception 'KOMPLAIN_CHECK: hak tabel bocor di %', t; end if;
    if not exists (select 1 from pg_policy p where p.polrelid = ('public.' || t)::regclass and p.polname = 'admin_online_fence_r' and not p.polpermissive) then
      raise exception 'KOMPLAIN_CHECK: pagar baca Admin Online tidak ada di %', t; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.complaint_counters', 'select') or has_table_privilege('authenticated', 'public.complaint_config_log', 'select') then
    raise exception 'KOMPLAIN_CHECK: penghitung/log konfigurasi tidak boleh dibaca klien'; end if;
  for f in select p.oid, p.oid::regprocedure::text sig, p.proname, p.prosecdef, p.proconfig, p.prosrc, n.nspname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname = 'public' and p.proname like 'komplain\_%') or (n.nspname = 'clinic_private' and p.proname like 'komplain\_%') loop
    if has_function_privilege('anon', f.oid, 'execute') or has_function_privilege('service_role', f.oid, 'execute') then raise exception 'KOMPLAIN_CHECK: anon/service_role bisa menjalankan %', f.sig; end if;
    if f.nspname = 'clinic_private' and has_function_privilege('authenticated', f.oid, 'execute') then raise exception 'KOMPLAIN_CHECK: fungsi privat terbuka: %', f.sig; end if;
    if f.nspname = 'public' and not has_function_privilege('authenticated', f.oid, 'execute') then raise exception 'KOMPLAIN_CHECK: authenticated tidak bisa menjalankan %', f.sig; end if;
    if f.prosecdef and (f.proconfig is null or not (f.proconfig @> array['search_path=""'])) then raise exception 'KOMPLAIN_CHECK: search_path tidak kosong di %', f.sig; end if;
    if f.nspname = 'public' and f.proname not in ('komplain_boleh', 'komplain_visible') and f.prosrc !~ 'admin_online_private\.deny_admin_online' then
      raise exception 'KOMPLAIN_CHECK: penjaga Admin Online tidak terpasang di %', f.sig; end if;
  end loop;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'komplain\_%';
  if v_n <> 13 then raise exception 'KOMPLAIN_CHECK: jumlah fungsi public % (harus 13)', v_n; end if;
  if (select count(*) from public.complaint_categories) <> 10 or (select overdue_days from public.complaint_settings) <> 3 then raise exception 'KOMPLAIN_CHECK: data awal salah'; end if;
  if (select count(*) from public.customer_complaints) <> 0 then raise exception 'KOMPLAIN_CHECK: tabel komplain harus kosong'; end if;
  if not exists (select 1 from role_settings_private.action_catalog where id = 'crm.komplain_kelola' and enforced)
     or not exists (select 1 from role_settings_private.action_modules where id = 'crm.komplain_kelola' and module_id = 'crm') then
    raise exception 'KOMPLAIN_CHECK: izin Akses Grup tidak terpasang'; end if;
end $check$;
