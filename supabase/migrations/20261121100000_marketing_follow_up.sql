-- Marketing: Follow up pelanggan (permintaan Pak Andri, 14-15 Nov 2026).
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Satu halaman /crm/follow-up dengan empat daftar kerja untuk tim marketing:
--   1. Lama tidak balik  : pelanggan yang terakhir datang >= 60/90/180 hari lalu (urut nilai belanja, lalu jumlah kunjungan).
--   2. Grooming          : hewan yang waktunya grooming lagi (default 30 hari setelah grooming terakhir; 21/30/45).
--   3. Hari ini          : follow up klinik (follow_ups) yang jatuh tempo hari ini / terlewat, satu baris per pemilik.
--   4. Pelanggan baru    : baru datang satu kali, 30-60 hari lalu, belum balik.
-- Plus catatan "Sudah dihubungi" (tabel kecil, hanya bisa ditambah) supaya dua orang tidak menghubungi pelanggan yang sama.
-- TIDAK ADA pengiriman WhatsApp otomatis dan tidak ada yang menyentuh whatsapp_message_log / wa_engine.
--
-- Isi:
--   * Katalog Akses Grup: sub-menu crm.follow-up-pelanggan (bawaan MATI untuk selain OWNER; lihat marketing_followup_allowed).
--   * public.marketing_normalisasi_hp(text): nomor HP -> 62xxxxxxxxxx atau NULL (sama persis dengan aturan di aplikasi).
--   * public.marketing_followup_allowed(): OWNER selalu (tidak membaca tabel kebijakan); peran lain hanya bila kebijakan sub-menu
--     CRM yang tersimpan memuat crm.follow-up-pelanggan. Tanpa kebijakan = TIDAK (nomor HP adalah data pribadi).
--   * public.marketing_followup_log (append-only) + public.marketing_log_contact(...) (satu-satunya jalur menulis; kunci anti-dobel).
--   * public.marketing_followup_daftar(...) dan public.marketing_followup_ringkas(...): hanya BACA.
--   * clinic_private.marketing_grooming_jasa(...) dan clinic_private.marketing_kandidat(...): bahan hitung (tidak bisa dipanggil klien).
--
-- RANCANGAN PENTING
--   * Fungsi baca = SECURITY DEFINER (bukan INVOKER) dengan search_path kosong, karena "terakhir datang" harus melihat SEMUA
--     cabang. Dengan INVOKER, kunjungan impor lama (cabang kosong, dibatasi RLS) dan transaksi cabang lain tidak terbaca, sehingga
--     pelanggan yang kemarin baru dilayani cabang lain terlihat "lama tidak balik". Yang dikembalikan tetap dibatasi:
--     pemanggil harus lolos marketing_followup_allowed() DAN hanya melihat baris yang cabang TERAKHIR-nya boleh ia akses
--     (user_can_access_branch, termasuk pilihan cabang operasional). Baris tanpa cabang (riwayat impor) hanya untuk yang
--     boleh mengakses semua cabang.
--   * Cabang pelanggan = cabang transaksi TERAKHIR (penjualan petshop tidak batal atau kunjungan klinik tidak diarsipkan).
--     Kunjungan impor (7.906 dari 9.120 kunjungan, Production 15 Nov) tidak punya cabang -> kelompok "Tanpa cabang".
--   * Dikecualikan: pelanggan disembunyikan (hidden_at), nama jelas data percobaan (tes/test/dummy...), nomor HP tidak sah
--     (dihitung terpisah sebagai "tanpa nomor"), pemilik yang semua hewannya sudah tiada/pindah, pelanggan dengan kunjungan klinik
--     yang belum selesai. Baris yang sudah dihubungi dalam masa tunggu (14 hari; 90 hari bila hasilnya Tidak berminat / Nomor salah)
--     tersembunyi dari daftar "belum dihubungi" tetapi bisa dilihat lewat saringan "sudah".
--   * Grooming: baris layanan Jasa (invoice_items.jenis='jasa'; sale_items item Jasa/Grup) yang kategorinya 'Grooming' ATAU
--     namanya memuat "grooming" (kategori master 17 jasa itu masih 'Konsultasi'); nama "konsultasi"/"registrasi" tidak dihitung.
--     Sinyal tambahan: kunjungan klinik dengan poli Grooming / keluhan menyebut grooming ("riwayat kunjungan") dan jadwal
--     follow up jenis Grooming (follow_ups, status Menunggu: "dijadwalkan dokter").
--   * Hanya BACA kecuali satu INSERT ke tabel log baru. Tidak ada kolom/tabel lama yang diubah.
--
-- Batal (satu transaksi):
--   drop function public.marketing_followup_ringkas(integer, integer, integer, integer, date);
--   drop function public.marketing_followup_daftar(text, integer, uuid, boolean, text, text, integer, integer, integer, integer, date);
--   drop function public.marketing_log_contact(uuid, uuid, text, uuid, text, text, uuid);
--   drop function clinic_private.marketing_kandidat(text, date, integer, integer);
--   drop function clinic_private.marketing_grooming_jasa(text, text);
--   drop table public.marketing_followup_log;  drop function public.guard_marketing_followup_log();
--   drop function public.marketing_followup_allowed();  drop function public.marketing_normalisasi_hp(text);
--   delete from role_settings_private.submenu_catalog where id='crm.follow-up-pelanggan';
--   (setelah memastikan tidak ada kebijakan Akses Grup yang menyebutnya).
set local lock_timeout='5s';

-- ───────────── 1. Katalog Akses Grup (dipasang SEBELUM aplikasi dideploy) ─────────────
insert into role_settings_private.submenu_catalog(id,module_id) values
('crm.follow-up-pelanggan','crm')
on conflict (id) do nothing;

-- ───────────── 2. Nomor HP -> format WhatsApp (62...) ─────────────
create function public.marketing_normalisasi_hp(p_hp text) returns text
language plpgsql immutable security invoker set search_path = '' as $fn$
declare d text := regexp_replace(coalesce(p_hp, ''), '\D', '', 'g');
begin
  if d like '00%' then d := substr(d, 3); end if;
  if d like '620%' then d := '62' || substr(d, 4);
  elsif d like '0%' then d := '62' || substr(d, 2);
  elsif d like '8%' then d := '62' || d;
  end if;
  if d ~ '^628[0-9]{7,11}$' then return d; end if;
  return null;
end $fn$;
comment on function public.marketing_normalisasi_hp(text) is 'Nomor HP Indonesia -> 62xxxxxxxxxx (10-14 digit, mulai 628) atau NULL bila bukan nomor HP yang sah.';
revoke all on function public.marketing_normalisasi_hp(text) from public, anon;
grant execute on function public.marketing_normalisasi_hp(text) to authenticated, service_role;

-- ───────────── 3. Siapa boleh ─────────────
create function public.marketing_followup_allowed() returns boolean
language plpgsql stable security definer set search_path = '' as $fn$
declare v_role public.user_role; v_allowed text[];
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then return false; end if;
  select role into v_role from public.profiles where id = auth.uid() and is_active;
  if v_role is null then return false; end if;
  -- OWNER: tidak membaca tabel kebijakan sama sekali, jadi galat/penguncian kebijakan tidak bisa menolaknya.
  if v_role = 'OWNER' then return true; end if;
  begin
    if not exists (select 1 from role_settings_private.submenu_catalog where id = 'crm.follow-up-pelanggan') then return false; end if;
    select s.allowed into v_allowed from role_settings_private.submenu_policies s where s.role = v_role and s.module_id = 'crm';
    -- Tanpa kebijakan tersimpan: bawaan TIDAK (nomor HP pelanggan = data pribadi; Owner mencentangnya per peran).
    if not found then return false; end if;
    return 'crm.follow-up-pelanggan' = any (v_allowed);
  exception when others then return false;
  end;
end $fn$;
comment on function public.marketing_followup_allowed() is 'Boleh membuka Follow up pelanggan (nomor HP)? OWNER selalu; peran lain hanya bila sub-menu CRM "Follow up pelanggan" dicentang di Akses Grup.';
revoke all on function public.marketing_followup_allowed() from public, anon, service_role;
grant execute on function public.marketing_followup_allowed() to authenticated;

-- ───────────── 4. Catatan "Sudah dihubungi" (hanya bisa ditambah) ─────────────
create table public.marketing_followup_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  pet_id uuid,
  jenis text not null check (jenis in ('lama_tidak_balik', 'grooming', 'followup_klinik', 'baru_belum_balik')),
  branch_id uuid references public.branches(id),
  hasil text not null check (hasil in ('Tertarik', 'Tidak diangkat', 'Nanti', 'Tidak berminat', 'Nomor salah')),
  catatan text check (catatan is null or length(catatan) <= 500),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  request_key uuid not null unique
);
comment on table public.marketing_followup_log is 'Catatan pelanggan yang sudah dihubungi tim marketing (tanpa kirim otomatis). Hanya ditambah lewat marketing_log_contact; tidak bisa diubah/dihapus.';
-- customer_id / pet_id sengaja tanpa kunci asing: catatan ini jejak, tidak boleh menghalangi penggabungan/penghapusan data pelanggan.
create index marketing_followup_log_cust_idx on public.marketing_followup_log (customer_id, jenis, created_at desc);

alter table public.marketing_followup_log enable row level security;
create policy marketing_followup_log_baca on public.marketing_followup_log for select to authenticated
  using (public.marketing_followup_allowed() and public.user_can_access_branch(branch_id));
revoke all on table public.marketing_followup_log from public, anon, authenticated, service_role;
grant select on table public.marketing_followup_log to authenticated;

create function public.guard_marketing_followup_log() returns trigger
language plpgsql security invoker set search_path = '' as $fn$
begin
  raise exception using errcode = '42501', message = 'MARKETING_LOG_TETAP: catatan sudah dihubungi tidak bisa diubah atau dihapus.';
end $fn$;
revoke all on function public.guard_marketing_followup_log() from public, anon, authenticated, service_role;
create trigger marketing_followup_log_append_only before update or delete on public.marketing_followup_log
  for each row execute function public.guard_marketing_followup_log();

create function public.marketing_log_contact(
  p_customer_id uuid, p_pet_id uuid, p_jenis text, p_branch_id uuid, p_hasil text, p_catatan text, p_request_key uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s' as $fn$
declare v_actor uuid := auth.uid(); v_catatan text; v_dup public.marketing_followup_log; v_id uuid; v_at timestamptz;
begin
  if not public.marketing_followup_allowed() then
    raise exception using errcode = '42501', message = 'MARKETING_DITOLAK: hanya Owner atau peran yang diberi akses Follow up pelanggan.';
  end if;
  if p_request_key is null then raise exception using errcode = '22023', message = 'MARKETING_KUNCI: muat ulang halaman lalu coba lagi.'; end if;
  if p_jenis is null or p_jenis not in ('lama_tidak_balik', 'grooming', 'followup_klinik', 'baru_belum_balik') then
    raise exception using errcode = '22023', message = 'MARKETING_JENIS: jenis daftar tidak dikenal.';
  end if;
  if p_hasil is null or p_hasil not in ('Tertarik', 'Tidak diangkat', 'Nanti', 'Tidak berminat', 'Nomor salah') then
    raise exception using errcode = '22023', message = 'MARKETING_HASIL: pilih hasil menghubungi.';
  end if;
  v_catatan := nullif(btrim(coalesce(p_catatan, '')), '');
  if v_catatan is not null and length(v_catatan) > 500 then
    raise exception using errcode = '22023', message = 'MARKETING_CATATAN: catatan maksimal 500 huruf.';
  end if;
  if p_customer_id is null or not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception using errcode = '22023', message = 'MARKETING_PELANGGAN: pelanggan tidak ditemukan.';
  end if;
  if p_pet_id is not null and not exists (select 1 from public.pets where id = p_pet_id and customer_id = p_customer_id) then
    raise exception using errcode = '22023', message = 'MARKETING_HEWAN: hewan bukan milik pelanggan ini.';
  end if;
  if p_branch_id is not null and not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception using errcode = '22023', message = 'MARKETING_CABANG: cabang tidak ditemukan.';
  end if;
  if not public.user_can_access_branch(p_branch_id) then
    raise exception using errcode = '42501', message = 'MARKETING_CABANG_DITOLAK: cabang ini tidak boleh Anda akses.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('marketing-log:' || p_request_key::text, 0));
  select * into v_dup from public.marketing_followup_log where request_key = p_request_key;
  if found then
    if v_dup.customer_id is distinct from p_customer_id or v_dup.pet_id is distinct from p_pet_id or v_dup.jenis <> p_jenis
       or v_dup.branch_id is distinct from p_branch_id or v_dup.hasil <> p_hasil or v_dup.catatan is distinct from v_catatan
       or v_dup.created_by is distinct from v_actor then
      raise exception using errcode = '22023', message = 'MARKETING_KUNCI_DIPAKAI: permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman.';
    end if;
    return jsonb_build_object('id', v_dup.id, 'created_at', v_dup.created_at, 'already_applied', true);
  end if;

  insert into public.marketing_followup_log(customer_id, pet_id, jenis, branch_id, hasil, catatan, created_by, request_key)
  values (p_customer_id, p_pet_id, p_jenis, p_branch_id, p_hasil, v_catatan, v_actor, p_request_key)
  returning id, created_at into v_id, v_at;
  return jsonb_build_object('id', v_id, 'created_at', v_at, 'already_applied', false);
end $fn$;
comment on function public.marketing_log_contact(uuid, uuid, text, uuid, text, text, uuid) is 'Catat pelanggan sudah dihubungi (hasil + catatan). Owner atau peran dengan akses Follow up pelanggan; kunci anti-dobel; tidak mengirim apa pun.';
revoke all on function public.marketing_log_contact(uuid, uuid, text, uuid, text, text, uuid) from public, anon, service_role;
grant execute on function public.marketing_log_contact(uuid, uuid, text, uuid, text, text, uuid) to authenticated;

-- ───────────── 5. Aturan "jasa grooming" (satu definisi) ─────────────
create function clinic_private.marketing_grooming_jasa(p_nama text, p_kategori text) returns boolean
language sql immutable security invoker set search_path = '' as $fn$
  select p_kategori = 'Grooming'
      or (coalesce(p_nama, '') ilike '%grooming%' and coalesce(p_nama, '') !~* '(konsultasi|registrasi)');
$fn$;
revoke all on function clinic_private.marketing_grooming_jasa(text, text) from public, anon, authenticated, service_role;

-- ───────────── 6. Bahan hitung per daftar (hanya dipanggil fungsi baca) ─────────────
create function clinic_private.marketing_kandidat(p_tab text, p_hari_ini date, p_interval integer, p_depan integer)
returns table (
  customer_id uuid, pet_id uuid, branch_id uuid, nama text, hp text, wa text,
  terakhir timestamptz, jenis text, total_belanja numeric, kunjungan integer, hari integer,
  sumber text, jadwal date, groomer text, item jsonb, kunjungan_terbuka boolean, hewan_tiada boolean,
  u1 numeric, u2 numeric, u3 numeric
)
language plpgsql stable security definer set search_path = '' as $fn$
#variable_conflict use_column
declare
  c_tiada constant text := '\m(mati|meninggal|deceased|pindah|nonaktif|non-aktif|tidak aktif|hilang)\M';
  c_percobaan constant text[] := array['test', 'tes', 'testing', 'dummy', 'coba', 'uji', 'test test', 'tes tes'];
  c_batas_lama constant integer := 730;  -- lebih dari 2 tahun tidak dianggap bahan follow up
  c_batas_grooming constant integer := 365;
begin
  if p_tab in ('lama', 'baru') then
    return query
    with ev as (
      select s.customer_id, s.branch_id, 'Petshop'::text as jenis, s.created_at as t
        from public.sales s where s.voided_at is null and s.customer_id is not null
      union all
      select v.customer_id, v.branch_id, 'Klinik'::text, v.created_at
        from public.visits v where v.archived_at is null and v.customer_id is not null
    ),
    agg as (
      select e.customer_id, count(*)::integer as n, min(e.t) as pertama, max(e.t) as terakhir from ev e group by e.customer_id
    ),
    lst as (
      select distinct on (e.customer_id) e.customer_id, e.branch_id, e.jenis, e.t
        from ev e order by e.customer_id, e.t desc, e.jenis desc, e.branch_id
    ),
    terbuka as (
      select distinct v.customer_id from public.visits v
       where v.archived_at is null and v.status <> 'Selesai' and v.customer_id is not null
    ),
    hw as (
      select p.customer_id, count(*) as semua, count(*) filter (where coalesce(p.status, '') !~* c_tiada) as hidup
        from public.pets p group by p.customer_id
    )
    select c.id, null::uuid, l.branch_id, btrim(c.name)::text, c.phone::text, public.marketing_normalisasi_hp(c.phone),
           a.terakhir, l.jenis, coalesce(c.total_spending, 0), a.n,
           (p_hari_ini - (a.terakhir at time zone 'Asia/Jakarta')::date),
           null::text, null::date, null::text, null::jsonb,
           (tb.customer_id is not null), (coalesce(h.semua, 0) > 0 and coalesce(h.hidup, 0) = 0),
           -coalesce(c.total_spending, 0), -a.n::numeric, -extract(epoch from a.terakhir)::numeric
      from agg a
      join lst l on l.customer_id = a.customer_id
      join public.customers c on c.id = a.customer_id
      left join terbuka tb on tb.customer_id = a.customer_id
      left join hw h on h.customer_id = a.customer_id
     where c.hidden_at is null
       and lower(btrim(c.name)) <> all (c_percobaan)
       and case
             when p_tab = 'lama' then
               (p_hari_ini - (a.terakhir at time zone 'Asia/Jakarta')::date) between 60 and c_batas_lama
             else
               a.n = 1
               and (p_hari_ini - (a.pertama at time zone 'Asia/Jakarta')::date) between 30 and 60
           end;

  elsif p_tab = 'grooming' then
    return query
    with gev as (
      -- A. tagihan klinik (rincian baris hanya ada sejak 1 Nov 2026)
      select v.customer_id as cid, v.pet_id as pid, v.branch_id as bid, i.created_at as t, 'belanja'::text as sumber,
             nullif(btrim(coalesce(ii.service_performers ->> 'staff_name', ii.service_performers ->> 'doctor_name', '')), '') as groomer
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id and i.voided_at is null
        join public.visits v on v.id = i.visit_id and v.archived_at is null
        left join public.items it on it.id = ii.item_id
       where ii.jenis = 'jasa' and v.customer_id is not null
         and (it.id is null or it.item_type in ('Jasa', 'Grup'))
         and clinic_private.marketing_grooming_jasa(ii.deskripsi, it.tindakan_kategori)
      union all
      -- B. kasir petshop (penjualan petshop tidak mencatat hewan)
      select s.customer_id, null::uuid, s.branch_id, s.created_at, 'belanja'::text,
             nullif(btrim(coalesce(si.service_performers ->> 'staff_name', si.service_performers ->> 'doctor_name', '')), '')
        from public.sale_items si
        join public.sales s on s.id = si.sale_id and s.voided_at is null
        left join public.items it on it.id = si.item_id
       where s.customer_id is not null
         and (it.id is null or it.item_type in ('Jasa', 'Grup'))
         and clinic_private.marketing_grooming_jasa(si.nama, it.tindakan_kategori)
    ),
    gvis as (
      -- C. riwayat kunjungan (termasuk impor): poli Grooming / keluhan menyebut grooming. Bila hewan yang sama juga punya
      --    tagihan grooming pada saat yang sama, tagihan (belanja) yang dipakai: lihat urutan di CTE gl.
      select v.customer_id, v.pet_id, v.branch_id, v.created_at, 'riwayat kunjungan'::text, null::text
        from public.visits v
       where v.archived_at is null and v.customer_id is not null
         and (v.poli = 'Grooming' or coalesce(v.keluhan, '') ilike '%grooming%')
    ),
    hw as (
      select p.customer_id, count(*) as semua, count(*) filter (where coalesce(p.status, '') !~* c_tiada) as hidup,
             (array_agg(p.id) filter (where coalesce(p.status, '') !~* c_tiada))[1] as satu
        from public.pets p group by p.customer_id
    ),
    gall as (
      -- penjualan petshop tanpa hewan: bila pemilik hanya punya SATU hewan hidup, itu hewannya
      select x.cid, coalesce(x.pid, case when h.hidup = 1 then h.satu end) as pid, x.bid, x.t, x.sumber, x.groomer
        from (select * from gev union all select * from gvis) x
        left join hw h on h.customer_id = x.cid
    ),
    gl as (
      select distinct on (g.cid, g.pid) g.cid, g.pid, g.bid, g.t, g.sumber, g.groomer
        from gall g order by g.cid, g.pid, g.t desc, (g.sumber = 'belanja') desc
    ),
    jd as (
      select f.customer_id as cid, f.pet_id as pid, min(f.tanggal) as jadwal,
             (array_agg(coalesce(f.branch_id, vv.branch_id) order by f.tanggal))[1] as bid
        from public.follow_ups f
        left join public.visits vv on vv.id = f.visit_id
       where f.jenis = 'Grooming' and f.status = 'Menunggu' and f.customer_id is not null
       group by f.customer_id, f.pet_id
    ),
    u as (
      select coalesce(a.cid, b.cid) as cid, coalesce(a.pid, b.pid) as pid, coalesce(a.bid, b.bid) as bid,
             a.t, a.sumber, a.groomer,
             case when b.jadwal is not null and (a.t is null or (a.t at time zone 'Asia/Jakarta')::date < b.jadwal - 7) then b.jadwal end as jadwal
        from gl a
        full join jd b on b.cid = a.cid and b.pid is not distinct from a.pid
    ),
    terbuka as (
      select distinct v.customer_id from public.visits v
       where v.archived_at is null and v.status <> 'Selesai' and v.customer_id is not null
    ),
    uj as (
      select u.*,
             least((u.t at time zone 'Asia/Jakarta')::date + p_interval, u.jadwal) as jatuh_tempo
        from u
    )
    select c.id, uj.pid, uj.bid, btrim(c.name)::text, c.phone::text, public.marketing_normalisasi_hp(c.phone),
           uj.t, null::text, coalesce(c.total_spending, 0), null::integer,
           (p_hari_ini - uj.jatuh_tempo),
           case when uj.jadwal is not null and uj.jadwal = uj.jatuh_tempo then 'dijadwalkan dokter' else uj.sumber end,
           uj.jadwal, uj.groomer, null::jsonb,
           (tb.customer_id is not null), (coalesce(h.semua, 0) > 0 and coalesce(h.hidup, 0) = 0)
             or (uj.pid is not null and exists (select 1 from public.pets p where p.id = uj.pid and coalesce(p.status, '') ~* c_tiada)),
           -(p_hari_ini - uj.jatuh_tempo)::numeric, 0::numeric, 0::numeric
      from uj
      join public.customers c on c.id = uj.cid
      left join terbuka tb on tb.customer_id = uj.cid
      left join hw h on h.customer_id = uj.cid
     where c.hidden_at is null
       and lower(btrim(c.name)) <> all (c_percobaan)
       and uj.jatuh_tempo <= p_hari_ini + p_depan
       and (uj.jadwal is not null or (p_hari_ini - (uj.t at time zone 'Asia/Jakarta')::date) <= c_batas_grooming);

  elsif p_tab = 'hari_ini' then
    return query
    with fu as (
      select f.customer_id as cid, coalesce(f.branch_id, v.branch_id) as bid, f.jenis, f.tanggal, f.catatan, p.name as hewan,
             (p.id is not null and coalesce(p.status, '') ~* c_tiada) as mati
        from public.follow_ups f
        left join public.visits v on v.id = f.visit_id
        left join public.pets p on p.id = f.pet_id
       where f.status = 'Menunggu' and f.tanggal <= p_hari_ini + p_depan and f.customer_id is not null
    ),
    fh as (
      select fu.cid, (array_agg(fu.bid order by fu.tanggal, fu.jenis))[1] as bid, min(fu.tanggal) as tgl, count(*)::integer as n,
             jsonb_agg(jsonb_build_object('jenis', fu.jenis, 'tanggal', fu.tanggal, 'catatan', fu.catatan, 'hewan', fu.hewan)
                       order by fu.tanggal, fu.jenis, fu.hewan) as item
        from fu where not fu.mati group by fu.cid
    )
    select c.id, null::uuid, fh.bid, btrim(c.name)::text, c.phone::text, public.marketing_normalisasi_hp(c.phone),
           null::timestamptz, null::text, coalesce(c.total_spending, 0), fh.n,
           (p_hari_ini - fh.tgl), null::text, fh.tgl, null::text, fh.item, false, false,
           -(p_hari_ini - fh.tgl)::numeric, 0::numeric, 0::numeric
      from fh
      join public.customers c on c.id = fh.cid
     where c.hidden_at is null and lower(btrim(c.name)) <> all (c_percobaan);
  else
    raise exception using errcode = '22023', message = 'MARKETING_TAB: daftar tidak dikenal.';
  end if;
end $fn$;
revoke all on function clinic_private.marketing_kandidat(text, date, integer, integer) from public, anon, authenticated, service_role;

-- ───────────── 7. Fungsi baca untuk halaman ─────────────
create function public.marketing_followup_daftar(
  p_tab text default 'lama',
  p_hari integer default 90,
  p_cabang uuid default null,
  p_cabang_kosong boolean default false,
  p_status text default 'belum',
  p_cari text default null,
  p_interval integer default 30,
  p_depan integer default 0,
  p_cooldown integer default 14,
  p_limit integer default 200,
  p_hari_ini date default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
#variable_conflict use_column
declare
  v_hari date := coalesce(p_hari_ini, (now() at time zone 'Asia/Jakarta')::date);
  c_senyap constant integer := 90;  -- hasil Tidak berminat / Nomor salah: jangan dihubungi lagi selama ini
  v_jenis text;
  v_vis uuid[];
  v_null_ok boolean;
  v_cari text := nullif(btrim(coalesce(p_cari, '')), '');
  v_cari_like text;
  v_cari_digit text;
  v_out jsonb;
begin
  if not public.marketing_followup_allowed() then
    raise exception using errcode = '42501', message = 'MARKETING_DITOLAK: hanya Owner atau peran yang diberi akses Follow up pelanggan.';
  end if;
  if p_tab is null or p_tab not in ('lama', 'grooming', 'hari_ini', 'baru') then
    raise exception using errcode = '22023', message = 'MARKETING_TAB: daftar tidak dikenal.';
  end if;
  if p_hari is null or p_hari not in (60, 90, 180) then
    raise exception using errcode = '22023', message = 'MARKETING_HARI: pilih 60, 90 atau 180 hari.';
  end if;
  if p_interval is null or p_interval not in (21, 30, 45) then
    raise exception using errcode = '22023', message = 'MARKETING_INTERVAL: pilih 21, 30 atau 45 hari.';
  end if;
  if p_depan is null or p_depan < 0 or p_depan > 14 then
    raise exception using errcode = '22023', message = 'MARKETING_DEPAN: 0 sampai 14 hari ke depan.';
  end if;
  if p_cooldown is null or p_cooldown < 1 or p_cooldown > 90 then
    raise exception using errcode = '22023', message = 'MARKETING_MASA_TUNGGU: 1 sampai 90 hari.';
  end if;
  if p_limit is null or p_limit < 0 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'MARKETING_BATAS: 0 sampai 500 baris per cabang.';
  end if;
  if p_status is null or p_status not in ('belum', 'sudah', 'semua') then
    raise exception using errcode = '22023', message = 'MARKETING_STATUS: belum, sudah atau semua.';
  end if;
  if v_cari is not null and length(v_cari) > 60 then
    raise exception using errcode = '22023', message = 'MARKETING_CARI: maksimal 60 huruf.';
  end if;
  if v_cari is not null then
    v_cari_like := '%' || replace(replace(replace(v_cari, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_cari_digit := regexp_replace(v_cari, '\D', '', 'g');
    if length(v_cari_digit) < 4 then v_cari_digit := null; end if;
  end if;

  v_jenis := case p_tab when 'lama' then 'lama_tidak_balik' when 'grooming' then 'grooming'
                        when 'hari_ini' then 'followup_klinik' else 'baru_belum_balik' end;
  select coalesce(array_agg(b.id), '{}') into v_vis from public.branches b where public.user_can_access_branch(b.id);
  v_null_ok := coalesce(public.user_can_access_branch(null::uuid), false);

  with k as (
    select x.* from clinic_private.marketing_kandidat(p_tab, v_hari, p_interval, p_depan) x
     where (x.branch_id is null and v_null_ok) or x.branch_id = any (v_vis)
  ),
  lg as (
    select distinct on (l.customer_id, l.pet_id) l.customer_id, l.pet_id, l.created_at, l.hasil, l.catatan, l.created_by
      from public.marketing_followup_log l
     where l.jenis = v_jenis
     order by l.customer_id, l.pet_id, l.created_at desc
  ),
  kj as (
    select k.*, g.created_at as g_at, g.hasil as g_hasil, g.catatan as g_catatan, g.created_by as g_oleh,
           (g.created_at is not null and (g.created_at at time zone 'Asia/Jakarta')::date
              > v_hari - case when g.hasil in ('Tidak berminat', 'Nomor salah') then c_senyap else p_cooldown end) as sudah
      from k
      left join lg g on g.customer_id = k.customer_id and g.pet_id is not distinct from k.pet_id
     where (v_cari is null
            or k.nama ilike v_cari_like escape '\'
            or (v_cari_digit is not null and (regexp_replace(coalesce(k.hp, ''), '\D', '', 'g') like '%' || v_cari_digit || '%'
                                              or coalesce(k.wa, '') like '%' || ltrim(v_cari_digit, '0') || '%')))
       and (p_tab <> 'lama' or k.hari >= 60)
  ),
  kp as (select * from kj where p_tab <> 'lama' or hari >= p_hari),
  ok0 as (select * from kj where wa is not null and not kunjungan_terbuka and not hewan_tiada),
  st0 as (select * from ok0 where p_status = 'semua' or (p_status = 'belum' and not sudah) or (p_status = 'sudah' and sudah)),
  per as (select * from st0 where p_tab <> 'lama' or hari >= p_hari),
  cab as (select branch_id, count(*) as n from per group by branch_id),
  fil as (
    select * from per
     where (p_cabang is null and not p_cabang_kosong) or (p_cabang is not null and branch_id = p_cabang)
        or (p_cabang_kosong and branch_id is null)
  ),
  rk as (
    select fil.*, row_number() over (partition by coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
                                     order by u1, u2, u3, customer_id, pet_id) as rn
      from fil
  ),
  top as (select * from rk where rn <= p_limit),
  rows_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'customer_id', t.customer_id, 'pet_id', t.pet_id, 'nama', t.nama, 'hp', t.hp, 'wa', t.wa,
             'hewan', coalesce(hw.nama, '[]'::jsonb), 'hewan_total', coalesce(hw.total, 0),
             'cabang_id', t.branch_id, 'cabang', b.name, 'terakhir', t.terakhir, 'jenis_terakhir', t.jenis,
             'total_belanja', t.total_belanja, 'kunjungan', t.kunjungan, 'hari', t.hari,
             'sumber', t.sumber, 'jadwal', t.jadwal, 'groomer', t.groomer, 'item', t.item,
             'dihubungi', case when t.g_at is null then null else jsonb_build_object(
                'at', t.g_at, 'hasil', t.g_hasil, 'catatan', t.g_catatan, 'oleh', pr.full_name, 'sudah', t.sudah,
                'hari_lalu', v_hari - (t.g_at at time zone 'Asia/Jakarta')::date) end
           ) order by b.name nulls last, t.u1, t.u2, t.u3, t.customer_id, t.pet_id), '[]'::jsonb) as baris
      from top t
      left join public.branches b on b.id = t.branch_id
      left join public.profiles pr on pr.id = t.g_oleh
      left join lateral (
        select jsonb_agg(q.name order by q.nr) as nama, max(q.total)::integer as total
          from (select p.name, count(*) over () as total,
                       row_number() over (order by (case when p.id is not distinct from t.pet_id then 0 else 1 end), p.created_at, p.id) as nr
                  from public.pets p
                 where p.customer_id = t.customer_id
                   and coalesce(p.status, '') !~* '\m(mati|meninggal|deceased|pindah|nonaktif|non-aktif|tidak aktif|hilang)\M') q
         where q.nr <= case when t.pet_id is null then 4 else 1 end
      ) hw on true
  )
  select jsonb_build_object(
    'tab', p_tab, 'hari_ini', v_hari, 'periode', p_hari, 'interval', p_interval, 'depan', p_depan, 'cooldown', p_cooldown,
    'status', p_status,
    'total', (select count(*) from fil),
    'ditampilkan', (select count(*) from top),
    'belum', (select count(*) from ok0 where not sudah and (p_tab <> 'lama' or hari >= p_hari)),
    'sudah', (select count(*) from ok0 where sudah and (p_tab <> 'lama' or hari >= p_hari)),
    'bucket', jsonb_build_object(
        '60', (select count(*) from st0 where hari >= 60), '90', (select count(*) from st0 where hari >= 90),
        '180', (select count(*) from st0 where hari >= 180)),
    'cabang', coalesce((select jsonb_agg(jsonb_build_object('id', c.branch_id, 'nama', b.name, 'jumlah', c.n)
                                          order by b.name nulls last) from cab c left join public.branches b on b.id = c.branch_id), '[]'::jsonb),
    'tanpa_nomor', (select count(*) from kp where wa is null and not kunjungan_terbuka and not hewan_tiada),
    'dikecualikan', jsonb_build_object(
        'kunjungan_belum_selesai', (select count(*) from kp where kunjungan_terbuka and wa is not null),
        'hewan_tiada', (select count(*) from kp where hewan_tiada and not kunjungan_terbuka and wa is not null),
        'disembunyikan', (select count(*) from public.customers where hidden_at is not null)),
    'riwayat_belanja_mulai', (select min((s.created_at at time zone 'Asia/Jakarta')::date) from public.sales s where s.voided_at is null),
    'baris', (select baris from rows_json)
  ) into v_out;
  return v_out;
end $fn$;
comment on function public.marketing_followup_daftar(text, integer, uuid, boolean, text, text, integer, integer, integer, integer, date)
  is 'Hanya baca. Daftar kerja marketing (lama tidak balik / grooming / hari ini / pelanggan baru). Owner atau akses Follow up pelanggan; baris dibatasi cabang terakhir yang boleh diakses.';
revoke all on function public.marketing_followup_daftar(text, integer, uuid, boolean, text, text, integer, integer, integer, integer, date) from public, anon, service_role;
grant execute on function public.marketing_followup_daftar(text, integer, uuid, boolean, text, text, integer, integer, integer, integer, date) to authenticated;

create function public.marketing_followup_ringkas(
  p_cooldown integer default 14, p_interval integer default 30, p_depan integer default 0, p_hari integer default 90, p_hari_ini date default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare r jsonb := '{}'::jsonb; t text; h jsonb;
begin
  if not public.marketing_followup_allowed() then
    raise exception using errcode = '42501', message = 'MARKETING_DITOLAK: hanya Owner atau peran yang diberi akses Follow up pelanggan.';
  end if;
  foreach t in array array['lama', 'grooming', 'hari_ini', 'baru'] loop
    h := public.marketing_followup_daftar(t, p_hari, null, false, 'belum', null, p_interval, p_depan, p_cooldown, 0, p_hari_ini);
    r := r || jsonb_build_object(t, (h ->> 'total')::integer);
  end loop;
  return r;
end $fn$;
comment on function public.marketing_followup_ringkas(integer, integer, integer, integer, date) is 'Hanya baca. Jumlah "belum dihubungi" per daftar untuk kartu dashboard.';
revoke all on function public.marketing_followup_ringkas(integer, integer, integer, integer, date) from public, anon, service_role;
grant execute on function public.marketing_followup_ringkas(integer, integer, integer, integer, date) to authenticated;

-- ───────────── 8. Pemeriksaan pasang ─────────────
do $check$
begin
  if not exists (select 1 from role_settings_private.submenu_catalog where id = 'crm.follow-up-pelanggan' and module_id = 'crm') then
    raise exception 'marketing: katalog sub-menu belum ada';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.marketing_followup_log'::regclass and tgname = 'marketing_followup_log_append_only') <> 1 then
    raise exception 'marketing: penjaga log belum terpasang';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.marketing_followup_log'::regclass) then
    raise exception 'marketing: RLS log belum aktif';
  end if;
end $check$;
