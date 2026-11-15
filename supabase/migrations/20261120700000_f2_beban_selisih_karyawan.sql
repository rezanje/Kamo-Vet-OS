-- F2 (meeting 12 Nov 2026, keputusan Reza: A + "dicatat kasbon saja") — ringkasan selisih kurang opname & beban ke karyawan.
-- Apply as ONE transaction (seluruh file satu transaksi; file ini sengaja tanpa begin/commit sendiri).
-- Prasyarat: F1 20261118630000_f1_opname_akun_selisih.sql sudah terpasang (kebijakan 'variance-loss-expense-gain-income').
--
-- RANCANGAN
--  1. Izin Akses Grup baru 'persediaan.beban_selisih_karyawan' (izin khusus, bawaan MATI, modul 'pos' = Persediaan).
--     OWNER selalu (tidak membaca tabel kebijakan). Peran lain (FINANCE/ADMIN/...) HANYA bila kebijakan tersimpan memuat izinnya
--     DAN role_action_allowed() setuju (pola B2 clinic_private.invoice_void_actor). Cabang opname harus bisa diakses.
--  2. Baca ringkasan public.read_opname_variance_charge(result_id): baris selisih kurang (qty, HPP yang dijurnal, harga jual cabang,
--     nilai jual) dari snapshot posting (price_report F1), total HPP & harga jual, pratinjau jurnal, alasan penolakan (bahasa biasa),
--     dan riwayat beban (aktif/dibatalkan) + status kasbon. Boleh dibaca OWNER/FINANCE aktif atau pemegang izin.
--  3. Catat beban public.charge_opname_variance_to_employees(result_id, baris, alasan, kunci):
--     * Nilai = qty kurang x HARGA JUAL cabang (snapshot saat posting), SELURUH baris kurang satu opname (aturan paling sederhana &
--       aman: tidak ada pilih barang/potong sebagian). Dibagi ke 1-10 karyawan aktif; jumlah tiap orang > 0, maksimal 2 desimal,
--       totalnya WAJIB sama persis dengan nilai beban. Alasan wajib 3-300 huruf. Kunci permintaan wajib (idempoten: kunci sama + isi
--       sama = hasil lama; kunci sama + isi beda = ditolak).
--     * Satu beban AKTIF per opname (indeks unik parsial). Beban yang dibatalkan boleh dicatat ulang.
--     * Jurnal tanggal HARI INI (WIB), periode akuntansi harus terbuka, cabang = cabang gudang opname, sumber 'opname-beban-karyawan':
--         Dr 182001 Kasbon/Piutang Karyawan      = nilai jual (S)
--         Cr 720010 Beban Selisih Stok           = min(S, HPP kurang yang dijurnal) (mengurangi beban)
--         Cr 810004 Pendapatan Diluar Operasional = S - min(S, HPP) (selisih jual - HPP; tidak ada baris bila 0)
--       S dan HPP dibulatkan 2 desimal. Bila harga jual < HPP, karyawan tetap menanggung nilai jual; sisa HPP tetap beban perusahaan.
--     * Ditolak (bahasa biasa): opname lama / sebelum F1 (bukan kebijakan 'variance-loss-expense-gain-income' atau tanpa snapshot),
--       tanpa selisih kurang, HPP snapshot tidak lengkap / tidak cocok dengan jurnal kurang asal, opname sudah dikoreksi, sudah ada
--       beban aktif, nilai jual 0, periode hari ini sudah ditutup, karyawan tidak aktif, pembagian tidak sama dengan total.
--  4. Kasbon (HRIS): per karyawan satu baris public.cash_advances status BARU 'Dicatat' (tenor 1, alasan diawali "Beban selisih stok
--     opname <no hasil>"). Penggajian hanya membaca status 'Disetujui' (src/lib/payroll-data.ts), jadi kasbon 'Dicatat' TIDAK dipotong
--     gaji otomatis ("kasbon aja" — Reza). Tampil di HRIS > Pengajuan > Utang karyawan berjalan dan di layar karyawan (/me), dan tidak
--     memblokir karyawan mengajukan kasbon sendiri (pemblokir hanya 'Menunggu'/'Disetujui'). Status 'Batal' untuk beban yang dibatalkan.
--     CHECK status cash_advances diganti (nilai lama tetap sah).
--  5. Batalkan beban public.cancel_opname_variance_charge(charge_id, alasan, kunci): Owner/izin yang sama; hanya bila semua kasbonnya
--     masih 'Dicatat' tanpa cicilan. Jurnal pembalik persis (sumber 'opname-beban-batal') tanggal HARI INI (periode terbuka),
--     kasbon -> 'Batal'. Sesudahnya opname boleh dikoreksi / dibebankan ulang.
--  6. Koreksi stok opname yang masih punya beban aktif DITOLAK (trigger pada stock_document_corrections) dengan pesan "batalkan beban
--     karyawan dulu" — supaya kasbon tidak diam-diam berbeda dari hasil opname efektif. Kunci baris opname_results menyerialkan koreksi
--     dan pencatatan beban.
--  7. Jejak tetap public.opname_variance_charges (tidak bisa dihapus; hanya kolom pembatalan yang boleh diisi sekali) + Log Aktifitas
--     (sumber baru 'opname_variance_charges', modul pos, pembaca OWNER/FINANCE). Kasbon yang lahir ikut tercatat lewat sumber
--     'cash_advances' yang sudah ada.
--
-- DAMPAK
--  - Tidak ada data lama yang berubah. Tidak ada jurnal/stok yang bergerak sampai Owner/pemegang izin memakai fitur ini.
--  - CHECK status cash_advances diganti (tabel kecil, kunci singkat). Jalur kasbon lama (ajukan, setujui, potong gaji) tidak berubah.
--  - Koreksi stok atas opname yang sudah dibebankan ke karyawan kini ditolak sampai bebannya dibatalkan.
--
-- ROLLBACK (manual, satu transaksi; sebelum ada beban yang dicatat):
--  drop trigger opname_correction_charge_guard on public.stock_document_corrections; drop function public.guard_opname_correction_charge();
--  drop function public.cancel_opname_variance_charge(uuid,text,uuid), public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid),
--   public.read_opname_variance_charge(uuid), public.opname_variance_charge_basis(uuid), public.opname_variance_charge_allowed(),
--   public.opname_variance_charge_actor();
--  delete from public.activity_log_sources where entity='opname_variance_charges'; drop table public.opname_variance_charges;
--   drop function public.guard_opname_variance_charge();
--  delete from role_settings_private.action_modules where id='persediaan.beban_selisih_karyawan';
--  delete from role_settings_private.action_catalog where id='persediaan.beban_selisih_karyawan';
--  CHECK status cash_advances boleh dibiarkan (nilai lama tetap sah). Setelah ada beban dicatat: JANGAN drop tabel jejak; batalkan
--  bebannya lewat fungsi pembatalan, atau reklas manual oleh Finance.
set local lock_timeout = '5s';

-- ───────────────────────── 0. Pagar prasyarat (gagal tertutup) ─────────────────────────
do $guard$
begin
  if to_regclass('public.opname_variance_charges') is not null
     or to_regprocedure('public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)') is not null
     or exists (select 1 from public.activity_log_sources where entity = 'opname_variance_charges') then
    raise exception 'F2_PRECONDITION: objek F2 sudah ada; periksa urutan migrasi';
  end if;
  if to_regprocedure('public.post_opname_atomic(uuid,date,jsonb)') is null
     or to_regprocedure('public.opname_posting_journal(date,uuid,text,text,text,jsonb)') is null
     or to_regprocedure('public.stock_opname_account(text)') is null
     or to_regprocedure('public.role_action_allowed(text)') is null
     or to_regprocedure('public.user_can_access_branch(uuid)') is null
     or to_regprocedure('public.capture_activity_log()') is null
     or to_regclass('public.opname_posting_receipts') is null
     or to_regclass('public.opname_results') is null
     or to_regclass('public.stock_document_corrections') is null
     or to_regclass('public.cash_advances') is null
     or to_regclass('public.cash_advance_installments') is null
     or to_regclass('public.employees') is null
     or to_regclass('public.accounting_locks') is null
     or to_regclass('role_settings_private.action_catalog') is null
     or to_regclass('role_settings_private.action_policies') is null then
    raise exception 'F2_PRECONDITION: prasyarat tidak lengkap; periksa urutan migrasi';
  end if;
  -- F1 wajib sudah terpasang: kurang -> 720010, lebih -> 810004, bukti posting memakai kebijakan baru.
  if public.stock_opname_account('variance') is distinct from '720010'
     or public.stock_opname_account('gain') is distinct from '810004'
     or position('''variance-loss-expense-gain-income''' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure)) = 0 then
    raise exception 'F2_PRECONDITION: F1 (akun selisih opname) belum terpasang';
  end if;
  if not exists (select 1 from public.coa_accounts where code = '182001' and not is_header) then
    raise exception 'F2_PRECONDITION: akun 182001 Kasbon/Piutang Karyawan belum ada sebagai akun rincian';
  end if;
end $guard$;

-- ───────────────────────── 1. Izin Akses Grup (izin khusus, bawaan MATI) ─────────────────────────
-- (bentuk "select" supaya tidak terbaca sebagai sumber Log Aktifitas oleh tes sinkron daftar sumber)
insert into role_settings_private.action_catalog(id, label, "group", enforced)
select 'persediaan.beban_selisih_karyawan', 'Bebankan selisih kurang stok opname ke karyawan (dicatat kasbon, tidak potong gaji); bawaan hanya Owner', 'Persediaan', true
on conflict (id) do nothing;
insert into role_settings_private.action_modules(id, module_id)
select 'persediaan.beban_selisih_karyawan', 'pos'
on conflict (id) do nothing;

create function public.opname_variance_charge_actor() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.user_role; v_ok boolean := false;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then return null; end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_role is null then return null; end if;
  -- Owner tidak pernah dikunci oleh tabel kebijakan.
  if v_role = 'OWNER' then return 'OWNER'; end if;
  begin
    v_ok := exists (select 1 from role_settings_private.action_policies a
                    where a.role = v_role and 'persediaan.beban_selisih_karyawan' = any (a.allowed))
            and public.role_action_allowed('persediaan.beban_selisih_karyawan');
  exception when others then
    v_ok := false;
  end;
  return case when v_ok then 'GRANT' else null end;
end $$;
revoke all on function public.opname_variance_charge_actor() from public, anon, authenticated, service_role;

create function public.opname_variance_charge_allowed() returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  return public.opname_variance_charge_actor() is not null;
end $$;
comment on function public.opname_variance_charge_allowed() is 'Untuk layar: boleh menampilkan form "Bebankan ke karyawan"? OWNER selalu; peran lain hanya bila izin persediaan.beban_selisih_karyawan dicentang. Bukan otorisasi.';
revoke all on function public.opname_variance_charge_allowed() from public, anon, service_role;
grant execute on function public.opname_variance_charge_allowed() to authenticated;

-- ───────────────────────── 2. Status kasbon baru: 'Dicatat' (tidak dipotong gaji) & 'Batal' ─────────────────────────
do $status$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.cash_advances'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%status%' and pg_get_constraintdef(oid) like '%Lunas%' loop
    execute format('alter table public.cash_advances drop constraint %I', c.conname);
  end loop;
end $status$;
alter table public.cash_advances add constraint cash_advances_status_check
  check (status in ('Menunggu', 'Disetujui', 'Ditolak', 'Lunas', 'Dicatat', 'Batal'));
comment on column public.cash_advances.status is
  'Menunggu/Disetujui/Ditolak/Lunas (kasbon biasa; Disetujui dipotong gaji otomatis). Dicatat = utang tercatat TANPA potong gaji otomatis (F2: beban selisih stok opname). Batal = beban dibatalkan.';

-- ───────────────────────── 3. Jejak tetap ─────────────────────────
create table public.opname_variance_charges (
  id uuid primary key,
  request_key uuid not null unique,
  request_payload jsonb not null,
  actor_id uuid not null references public.profiles(id),
  actor_role text not null check (actor_role in ('OWNER', 'GRANT')),
  result_id uuid not null references public.opname_results(id),
  no_hasil text not null,
  branch_id uuid not null references public.branches(id),
  warehouse_id uuid not null references public.warehouses(id),
  tanggal date not null,
  reason text not null check (length(btrim(reason)) between 3 and 300),
  total numeric(15,2) not null check (total > 0),
  hpp_total numeric(15,2) not null check (hpp_total >= 0),
  hpp_part numeric(15,2) not null check (hpp_part >= 0),
  gain_part numeric(15,2) not null check (gain_part >= 0),
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 10),
  minus_lines jsonb not null check (jsonb_typeof(minus_lines) = 'array'),
  advance_ids uuid[] not null,
  journal_id uuid not null references public.journal_entries(id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancel_reason text check (cancel_reason is null or length(btrim(cancel_reason)) between 3 and 300),
  cancel_request_key uuid unique,
  cancel_journal_id uuid references public.journal_entries(id),
  log_label text generated always as (
    'Beban selisih stok ' || no_hasil || ' ke karyawan Rp ' || total::text || ' — alasan: ' || reason
    || case when cancel_reason is null then '' else ' — DIBATALKAN: ' || cancel_reason end) stored,
  created_at timestamptz not null default clock_timestamp(),
  constraint opname_variance_charges_split check (hpp_part + gain_part = total and hpp_part <= hpp_total),
  constraint opname_variance_charges_cancel check (
    (cancelled_at is null) = (cancelled_by is null) and (cancelled_at is null) = (cancel_reason is null)
    and (cancelled_at is null) = (cancel_request_key is null) and (cancelled_at is null) = (cancel_journal_id is null))
);
create unique index opname_variance_charges_active on public.opname_variance_charges (result_id) where cancelled_at is null;
create index opname_variance_charges_result on public.opname_variance_charges (result_id);
alter table public.opname_variance_charges enable row level security;
revoke all on public.opname_variance_charges from public, anon, authenticated, service_role;
comment on table public.opname_variance_charges is 'F2: jejak tetap beban selisih kurang stok opname ke karyawan (kasbon status Dicatat). Dibaca lewat read_opname_variance_charge.';

create function public.guard_opname_variance_charge() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_cancel text[] := array['cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_request_key', 'cancel_journal_id', 'log_label'];
begin
  if tg_op = 'DELETE' then raise exception 'BEBAN_KARYAWAN_JEJAK: jejak beban karyawan tidak dapat dihapus.'; end if;
  -- Hanya pembatalan (sekali) yang boleh mengisi kolom pembatalan; isi lainnya tetap.
  if old.cancelled_at is not null or new.cancelled_at is null
     or (to_jsonb(new) - v_cancel) is distinct from (to_jsonb(old) - v_cancel) then
    raise exception 'BEBAN_KARYAWAN_JEJAK: jejak beban karyawan tidak dapat diubah.';
  end if;
  return new;
end $$;
revoke all on function public.guard_opname_variance_charge() from public, anon, authenticated, service_role;
create trigger opname_variance_charges_guard before update or delete on public.opname_variance_charges
  for each row execute function public.guard_opname_variance_charge();

-- ───────────────────────── 4. Dasar hitungan (internal; dipakai baca & catat) ─────────────────────────
create function public.opname_variance_charge_basis(p_result_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_res public.opname_results%rowtype; v_order public.opname_orders%rowtype; v_wh public.warehouses%rowtype;
  v_rec public.opname_posting_receipts%rowtype; v_rep jsonb; v_lines jsonb := '[]'; v_hpp numeric := 0; v_jual numeric := 0;
  v_count integer := 0; v_missing integer := 0; v_loss numeric; v_journal_loss numeric; v_code text; v_msg text;
  v_closed date; v_today date := (now() at time zone 'Asia/Jakarta')::date; v_total numeric; v_hpp_total numeric; v_hpp_part numeric;
begin
  select * into v_res from public.opname_results where id = p_result_id;
  if not found then return null; end if;
  select * into v_order from public.opname_orders where id = v_res.order_id;
  select * into v_wh from public.warehouses where id = v_order.warehouse_id;
  select * into v_rec from public.opname_posting_receipts where result_id = v_res.id and order_id = v_res.order_id;
  if v_rec.result_id is not null and jsonb_typeof(v_rec.source_snapshot->'price_report'->'rows') = 'array' then
    v_rep := v_rec.source_snapshot->'price_report';
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', e->>'item_id', 'code', e->>'code', 'name', e->>'name', 'unit', e->>'unit',
             'qty', -(e->>'selisih')::numeric,
             'hpp', case when jsonb_typeof(e->'nilai_selisih_modal') = 'string' then -(e->>'nilai_selisih_modal')::numeric end,
             'harga_jual', (e->>'harga_jual_cabang')::numeric,
             'jual', -(e->>'nilai_selisih_jual')::numeric) order by e->>'name', e->>'item_id'), '[]'::jsonb),
           coalesce(sum(-(e->>'nilai_selisih_modal')::numeric) filter (where jsonb_typeof(e->'nilai_selisih_modal') = 'string'), 0),
           coalesce(sum(-(e->>'nilai_selisih_jual')::numeric), 0),
           count(*),
           count(*) filter (where jsonb_typeof(e->'nilai_selisih_modal') is distinct from 'string')
      into v_lines, v_hpp, v_jual, v_count, v_missing
      from jsonb_array_elements(v_rep->'rows') e
     where (e->>'selisih')::numeric < 0;
  end if;
  v_total := round(v_jual, 2);
  v_hpp_total := round(v_hpp, 2);
  v_hpp_part := least(v_total, v_hpp_total);

  -- Penolakan berurutan; kalimat bahasa biasa untuk layar.
  if v_rep is null then
    v_code := 'LAMA'; v_msg := 'Opname ini belum punya catatan nilai saat diposting (opname lama), jadi beban ke karyawan tidak bisa dicatat lewat sistem. Catat manual lewat Finance bila perlu.';
  elsif v_rec.source_snapshot->>'warehouse_policy' is distinct from 'variance-loss-expense-gain-income'
     or v_rec.source_snapshot->>'variance_account' is distinct from '720010' then
    v_code := 'LAMA'; v_msg := 'Opname ini diposting sebelum aturan akun selisih baru berlaku, jadi beban ke karyawan tidak bisa dicatat lewat sistem. Catat manual lewat Finance bila perlu.';
  elsif v_count = 0 then
    v_code := 'TANPA_KURANG'; v_msg := 'Opname ini tidak punya selisih kurang, jadi tidak ada yang bisa dibebankan.';
  elsif v_missing > 0 then
    v_code := 'HPP_KOSONG'; v_msg := 'Nilai modal sebagian barang selisih kurang tidak tercatat saat posting. Hubungi Finance; beban belum bisa dicatat.';
  else
    v_loss := (v_rec.source_snapshot->>'loss_cost')::numeric;
    select coalesce(sum(l.debit), 0) into v_journal_loss
      from public.journal_lines l join public.coa_accounts a on a.id = l.account_id
      join public.journal_entries j on j.id = l.entry_id
     where l.entry_id = any (v_rec.journal_ids) and a.code = '720010' and j.voided_at is null;
    if v_loss is distinct from v_hpp or v_journal_loss is distinct from v_hpp then
      v_code := 'TIDAK_COCOK'; v_msg := 'Nilai modal selisih kurang tidak cocok dengan jurnal opname asal. Hubungi Finance untuk diperiksa dulu.';
    elsif exists (select 1 from public.stock_document_corrections c where c.kind = 'opname' and c.document_id = v_res.id) then
      v_code := 'DIKOREKSI'; v_msg := 'Opname ini sudah dikoreksi sesudah diposting. Beban ke karyawan hanya untuk hasil asal yang belum dikoreksi; catat manual lewat Finance bila perlu.';
    elsif exists (select 1 from public.opname_variance_charges c where c.result_id = v_res.id and c.cancelled_at is null) then
      v_code := 'SUDAH'; v_msg := 'Selisih kurang opname ini sudah dibebankan ke karyawan. Batalkan beban yang ada dulu bila ingin mengubahnya.';
    elsif v_total <= 0 then
      v_code := 'HARGA_JUAL_KOSONG'; v_msg := 'Harga jual barang yang kurang Rp0, jadi tidak ada nilai yang bisa dibebankan ke karyawan.';
    else
      select closed_until into v_closed from public.accounting_locks where id;
      if v_closed is not null and v_today <= v_closed then
        v_code := 'PERIODE'; v_msg := format('Periode akuntansi sampai %s sudah ditutup, jadi beban hari ini belum bisa dicatat. Minta Owner membuka periodenya dulu.', to_char(v_closed, 'DD-MM-YYYY'));
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'result_id', v_res.id, 'no_hasil', v_res.no_hasil, 'tanggal_opname', v_res.tanggal,
    'order_id', v_order.id, 'no_opname', v_order.no_opname,
    'branch_id', v_wh.branch_id, 'warehouse_id', v_wh.id, 'warehouse', v_wh.name,
    'method', v_rep->>'method', 'policy', v_rec.source_snapshot->>'warehouse_policy',
    'minus_lines', v_lines, 'minus_count', v_count,
    'hpp_total', v_hpp_total, 'jual_total', v_total,
    'hpp_part', v_hpp_part, 'gain_part', v_total - v_hpp_part,
    'today', v_today,
    'refuse', case when v_code is null then null else jsonb_build_object('code', v_code, 'message', v_msg) end);
end $$;
revoke all on function public.opname_variance_charge_basis(uuid) from public, anon, authenticated, service_role;

-- Siapa boleh membaca ringkasan: OWNER/FINANCE aktif atau pemegang izin; cabang opname harus bisa diakses.
create function public.read_opname_variance_charge(p_result_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_role text; v_actor text; v_basis jsonb; v_charges jsonb;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or p_result_id is null then
    raise exception 'BEBAN_KARYAWAN_DITOLAK: akses ringkasan selisih opname ditolak.' using errcode = '42501';
  end if;
  select role::text into v_role from public.profiles where id = auth.uid() and is_active;
  v_actor := public.opname_variance_charge_actor();
  if v_role is null or (v_role not in ('OWNER', 'FINANCE') and v_actor is null) then
    raise exception 'BEBAN_KARYAWAN_DITOLAK: ringkasan nilai selisih opname hanya untuk Owner/Finance.' using errcode = '42501';
  end if;
  v_basis := public.opname_variance_charge_basis(p_result_id);
  if v_basis is null or not public.user_can_access_branch((v_basis->>'branch_id')::uuid) then
    raise exception 'BEBAN_KARYAWAN_DITOLAK: hasil opname tidak ditemukan atau cabangnya tidak dapat diakses.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'tanggal', c.tanggal, 'reason', c.reason, 'total', c.total, 'hpp_part', c.hpp_part, 'gain_part', c.gain_part,
           'actor_name', (select p.full_name from public.profiles p where p.id = c.actor_id), 'created_at', c.created_at,
           'journal_id', c.journal_id, 'cancelled_at', c.cancelled_at, 'cancel_reason', c.cancel_reason, 'cancel_journal_id', c.cancel_journal_id,
           'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                        'employee_id', x.employee_id, 'nama', e.nama, 'amount', x.amount, 'advance_id', x.advance_id,
                        'status', ca.status,
                        'dibayar', coalesce((select sum(i.jumlah) from public.cash_advance_installments i where i.advance_id = x.advance_id), 0))
                      order by e.nama, x.employee_id), '[]'::jsonb)
                     from jsonb_to_recordset(c.lines) x(employee_id uuid, amount numeric, advance_id uuid)
                     left join public.employees e on e.id = x.employee_id
                     left join public.cash_advances ca on ca.id = x.advance_id))
         order by c.created_at desc), '[]'::jsonb)
    into v_charges
    from public.opname_variance_charges c where c.result_id = p_result_id;
  return v_basis || jsonb_build_object('can_charge', v_actor is not null, 'charges', v_charges);
end $$;
comment on function public.read_opname_variance_charge(uuid) is 'F2: ringkasan selisih kurang opname (HPP & harga jual), pratinjau jurnal beban karyawan, penolakan, dan riwayat beban. OWNER/FINANCE atau izin persediaan.beban_selisih_karyawan.';
revoke all on function public.read_opname_variance_charge(uuid) from public, anon, service_role;
grant execute on function public.read_opname_variance_charge(uuid) to authenticated;

-- ───────────────────────── 5. Catat beban ke karyawan ─────────────────────────
create function public.charge_opname_variance_to_employees(p_result_id uuid, p_lines jsonb, p_reason text, p_request_key uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_actor text := public.opname_variance_charge_actor(); v_uid uuid := auth.uid(); v_reason text; v_norm jsonb; v_payload jsonb;
  v_prior public.opname_variance_charges%rowtype; v_basis jsonb; v_branch uuid; v_count integer; v_distinct integer; v_sum numeric;
  v_total numeric; v_hpp_part numeric; v_gain_part numeric; v_today date; v_id uuid := gen_random_uuid(); v_lines jsonb := '[]';
  v_advances uuid[] := '{}'; v_line record; v_adv uuid; v_journal uuid; v_jl jsonb; v_desc text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'BEBAN_KARYAWAN_DITOLAK: hanya Owner atau peran yang diberi izin "Bebankan selisih opname ke karyawan".';
  end if;
  v_reason := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
  if length(v_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_ALASAN: alasan wajib diisi 3 sampai 300 huruf.';
  end if;
  if p_request_key is null then raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_KUNCI: muat ulang halaman lalu coba lagi.'; end if;
  if p_result_id is null then raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_OPNAME: hasil opname tidak ditemukan.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 10
     or exists (select 1 from jsonb_array_elements(p_lines) e
                where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'amount') <> 'number'
                   or coalesce(e->>'employee_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_BAGI: pilih 1 sampai 10 karyawan dan isi jumlah untuk tiap orang.';
  end if;
  select jsonb_agg(jsonb_build_object('employee_id', x.employee_id, 'amount', x.amount) order by x.employee_id),
         count(*), count(distinct x.employee_id), sum(x.amount)
    into v_norm, v_count, v_distinct, v_sum
    from jsonb_to_recordset(p_lines) x(employee_id uuid, amount numeric);
  if v_distinct <> v_count then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_BAGI: satu karyawan hanya boleh dipilih sekali.';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(employee_id uuid, amount numeric)
             where x.amount <= 0 or x.amount <> round(x.amount, 2) or x.amount > 1000000000000) then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_BAGI: jumlah tiap karyawan harus lebih dari 0 (maksimal 2 angka di belakang koma).';
  end if;
  v_payload := jsonb_build_object('result_id', p_result_id, 'lines', v_norm, 'reason', v_reason);

  -- Kunci permintaan: sama + isi sama = hasil lama; sama + isi beda = ditolak.
  perform pg_advisory_xact_lock(hashtextextended('opname-beban-karyawan:' || p_request_key::text, 0));
  select * into v_prior from public.opname_variance_charges where request_key = p_request_key;
  if found then
    if v_prior.request_payload is distinct from v_payload or v_prior.actor_id is distinct from v_uid then
      raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_KUNCI_DIPAKAI: permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman.';
    end if;
    return jsonb_build_object('charge_id', v_prior.id, 'result_id', v_prior.result_id, 'no_hasil', v_prior.no_hasil, 'total', v_prior.total,
      'hpp_part', v_prior.hpp_part, 'gain_part', v_prior.gain_part, 'journal_id', v_prior.journal_id, 'advance_ids', to_jsonb(v_prior.advance_ids),
      'tanggal', v_prior.tanggal, 'already_applied', true);
  end if;

  -- Serialkan per opname (dengan koreksi stok dan pencatatan beban lain).
  perform 1 from public.opname_results where id = p_result_id for update;
  if not found then raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_OPNAME: hasil opname tidak ditemukan.'; end if;
  perform 1 from public.accounting_locks where id for share;
  v_basis := public.opname_variance_charge_basis(p_result_id);
  v_branch := (v_basis->>'branch_id')::uuid;
  if not public.user_can_access_branch(v_branch) then
    raise exception using errcode = '42501', message = 'BEBAN_KARYAWAN_DITOLAK: cabang opname ini tidak dapat diakses.';
  end if;
  if v_basis->'refuse' is not null and jsonb_typeof(v_basis->'refuse') = 'object' then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_' || (v_basis->'refuse'->>'code') || ': ' || (v_basis->'refuse'->>'message');
  end if;
  v_total := (v_basis->>'jual_total')::numeric;
  v_hpp_part := (v_basis->>'hpp_part')::numeric;
  v_gain_part := (v_basis->>'gain_part')::numeric;
  v_today := (v_basis->>'today')::date;
  if v_sum is distinct from v_total then
    raise exception using errcode = '22023', message = format('BEBAN_KARYAWAN_TOTAL: jumlah pembagian (Rp %s) harus sama dengan nilai beban (Rp %s).',
      trim_scale(v_sum)::text, trim_scale(v_total)::text);
  end if;
  perform 1 from public.employees e
   where e.id in (select x.employee_id from jsonb_to_recordset(v_norm) x(employee_id uuid, amount numeric)) order by e.id for share;
  if (select count(*) from public.employees e
       where e.id in (select x.employee_id from jsonb_to_recordset(v_norm) x(employee_id uuid, amount numeric))
         and e.status = 'Aktif' and e.trashed_at is null) <> v_count then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_KARYAWAN: karyawan yang dipilih tidak ditemukan atau sudah tidak aktif.';
  end if;
  if (select count(*) from public.coa_accounts where code in ('182001', public.stock_opname_account('variance'), public.stock_opname_account('gain'))
       and is_active and not is_header) <> 3 then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_AKUN: akun 182001 Kasbon Karyawan / 720010 Beban Selisih Stok / 810004 Pendapatan Lain-lain belum aktif. Hubungi Finance.';
  end if;

  -- Kasbon per karyawan: status 'Dicatat' = tercatat, TIDAK dipotong gaji otomatis.
  for v_line in select x.employee_id, x.amount from jsonb_to_recordset(v_norm) x(employee_id uuid, amount numeric) order by x.employee_id loop
    v_adv := gen_random_uuid();
    insert into public.cash_advances(id, employee_id, tanggal, jumlah, tenor_bulan, status, alasan, approved_by, approved_at, disbursed_at)
    values (v_adv, v_line.employee_id, v_today, v_line.amount, 1, 'Dicatat',
            left('Beban selisih stok opname ' || (v_basis->>'no_hasil') || ' — ' || v_reason, 500), v_uid, now(), now());
    v_advances := v_advances || v_adv;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('employee_id', v_line.employee_id, 'amount', v_line.amount, 'advance_id', v_adv));
  end loop;

  v_jl := jsonb_build_array(
            jsonb_build_object('code', '182001', 'debit', v_total, 'credit', 0),
            jsonb_build_object('code', public.stock_opname_account('variance'), 'debit', 0, 'credit', v_hpp_part))
          || case when v_gain_part > 0 then jsonb_build_array(jsonb_build_object('code', public.stock_opname_account('gain'), 'debit', 0, 'credit', v_gain_part))
                  else '[]'::jsonb end;
  v_desc := 'Beban selisih stok opname ' || (v_basis->>'no_hasil') || ' ke karyawan (' || (v_basis->>'no_opname') || ') #' || left(v_id::text, 8);
  v_journal := public.opname_posting_journal(v_today, v_branch, 'opname-beban-karyawan', v_basis->>'no_hasil', v_desc, v_jl);

  insert into public.opname_variance_charges(id, request_key, request_payload, actor_id, actor_role, result_id, no_hasil, branch_id, warehouse_id,
    tanggal, reason, total, hpp_total, hpp_part, gain_part, lines, minus_lines, advance_ids, journal_id)
  values (v_id, p_request_key, v_payload, v_uid, v_actor, p_result_id, v_basis->>'no_hasil', v_branch, (v_basis->>'warehouse_id')::uuid,
    v_today, v_reason, v_total, (v_basis->>'hpp_total')::numeric, v_hpp_part, v_gain_part, v_lines, v_basis->'minus_lines', v_advances, v_journal);

  return jsonb_build_object('charge_id', v_id, 'result_id', p_result_id, 'no_hasil', v_basis->>'no_hasil', 'total', v_total,
    'hpp_part', v_hpp_part, 'gain_part', v_gain_part, 'journal_id', v_journal, 'advance_ids', to_jsonb(v_advances),
    'tanggal', v_today, 'already_applied', false);
end $$;
comment on function public.charge_opname_variance_to_employees(uuid, jsonb, text, uuid) is 'F2: bebankan seluruh selisih kurang opname (qty x harga jual) ke karyawan sebagai kasbon status Dicatat (tidak potong gaji). Jurnal Dr 182001 / Cr 720010 (HPP) / Cr 810004 (jual-HPP), tanggal hari ini.';
revoke all on function public.charge_opname_variance_to_employees(uuid, jsonb, text, uuid) from public, anon, service_role;
grant execute on function public.charge_opname_variance_to_employees(uuid, jsonb, text, uuid) to authenticated;

-- ───────────────────────── 6. Batalkan beban ─────────────────────────
create function public.cancel_opname_variance_charge(p_charge_id uuid, p_reason text, p_request_key uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_actor text := public.opname_variance_charge_actor(); v_uid uuid := auth.uid(); v_reason text; v_charge public.opname_variance_charges%rowtype;
  v_result uuid; v_closed date; v_today date := (now() at time zone 'Asia/Jakarta')::date; v_jl jsonb; v_journal uuid; v_desc text; v_no_opname text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'BEBAN_KARYAWAN_DITOLAK: hanya Owner atau peran yang diberi izin "Bebankan selisih opname ke karyawan".';
  end if;
  v_reason := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
  if length(v_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_ALASAN: alasan pembatalan wajib diisi 3 sampai 300 huruf.';
  end if;
  if p_request_key is null or p_charge_id is null then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_KUNCI: muat ulang halaman lalu coba lagi.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('opname-beban-karyawan-batal:' || p_request_key::text, 0));
  select * into v_charge from public.opname_variance_charges where cancel_request_key = p_request_key;
  if found then
    if v_charge.id is distinct from p_charge_id or v_charge.cancel_reason is distinct from v_reason or v_charge.cancelled_by is distinct from v_uid then
      raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_KUNCI_DIPAKAI: permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman.';
    end if;
    return jsonb_build_object('charge_id', v_charge.id, 'cancel_journal_id', v_charge.cancel_journal_id, 'already_applied', true);
  end if;

  select result_id into v_result from public.opname_variance_charges where id = p_charge_id;
  if not found then raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_TIDAK_ADA: beban karyawan tidak ditemukan.'; end if;
  perform 1 from public.opname_results where id = v_result for update;
  select * into v_charge from public.opname_variance_charges where id = p_charge_id for update;
  if not public.user_can_access_branch(v_charge.branch_id) then
    raise exception using errcode = '42501', message = 'BEBAN_KARYAWAN_DITOLAK: cabang opname ini tidak dapat diakses.';
  end if;
  if v_charge.cancelled_at is not null then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_SUDAH_BATAL: beban karyawan ini sudah dibatalkan.';
  end if;
  perform 1 from public.cash_advances where id = any (v_charge.advance_ids) order by id for update;
  if (select count(*) from public.cash_advances ca where ca.id = any (v_charge.advance_ids) and ca.status = 'Dicatat') <> cardinality(v_charge.advance_ids)
     or exists (select 1 from public.cash_advance_installments i where i.advance_id = any (v_charge.advance_ids)) then
    raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_KASBON_JALAN: kasbon dari beban ini sudah diubah atau mulai dibayar, jadi tidak bisa dibatalkan otomatis. Hubungi Finance.';
  end if;
  perform 1 from public.accounting_locks where id for share;
  select closed_until into v_closed from public.accounting_locks where id;
  if v_closed is not null and v_today <= v_closed then
    raise exception using errcode = '22023', message = format('BEBAN_KARYAWAN_PERIODE: periode akuntansi sampai %s sudah ditutup, jadi pembatalan hari ini belum bisa dicatat. Minta Owner membuka periodenya dulu.', to_char(v_closed, 'DD-MM-YYYY'));
  end if;

  -- Pembalik persis jurnal beban asal (per akun), tanggal hari ini.
  select jsonb_agg(jsonb_build_object('code', t.code, 'debit', t.credit, 'credit', t.debit) order by t.code) into v_jl
    from (select a.code, sum(l.debit) debit, sum(l.credit) credit
            from public.journal_lines l join public.coa_accounts a on a.id = l.account_id
           where l.entry_id = v_charge.journal_id group by a.code) t;
  if v_jl is null then raise exception using errcode = '22023', message = 'BEBAN_KARYAWAN_JURNAL: jurnal beban asal tidak ditemukan. Hubungi Finance.'; end if;
  select o.no_opname into v_no_opname from public.opname_results r join public.opname_orders o on o.id = r.order_id where r.id = v_charge.result_id;
  v_desc := 'Batal beban selisih stok opname ' || v_charge.no_hasil || ' ke karyawan (' || coalesce(v_no_opname, '-') || ') #' || left(v_charge.id::text, 8);
  v_journal := public.opname_posting_journal(v_today, v_charge.branch_id, 'opname-beban-batal', v_charge.no_hasil, v_desc, v_jl);

  update public.cash_advances set status = 'Batal', catatan_penyetuju = left('Beban selisih opname dibatalkan: ' || v_reason, 300)
   where id = any (v_charge.advance_ids);
  update public.opname_variance_charges
     set cancelled_at = clock_timestamp(), cancelled_by = v_uid, cancel_reason = v_reason, cancel_request_key = p_request_key, cancel_journal_id = v_journal
   where id = v_charge.id;
  return jsonb_build_object('charge_id', v_charge.id, 'cancel_journal_id', v_journal, 'tanggal', v_today, 'already_applied', false);
end $$;
comment on function public.cancel_opname_variance_charge(uuid, text, uuid) is 'F2: batalkan beban selisih opname ke karyawan (kasbon masih Dicatat tanpa cicilan). Jurnal pembalik persis tanggal hari ini, kasbon -> Batal.';
revoke all on function public.cancel_opname_variance_charge(uuid, text, uuid) from public, anon, service_role;
grant execute on function public.cancel_opname_variance_charge(uuid, text, uuid) to authenticated;

-- ───────────────────────── 7. Koreksi stok opname yang sudah dibebankan: ditolak ─────────────────────────
create function public.guard_opname_correction_charge() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'opname' then
    -- Kunci yang sama dengan pencatatan beban (opname_results) supaya keduanya berurutan.
    perform 1 from public.opname_results where id = new.document_id for update;
    if exists (select 1 from public.opname_variance_charges c where c.result_id = new.document_id and c.cancelled_at is null) then
      raise exception 'Selisih opname ini sudah dibebankan ke karyawan (kasbon). Batalkan beban karyawan dulu di halaman opname, lalu koreksi.';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_opname_correction_charge() from public, anon, authenticated, service_role;
create trigger opname_correction_charge_guard before insert on public.stock_document_corrections
  for each row execute function public.guard_opname_correction_charge();

-- ───────────────────────── 8. Log Aktifitas ─────────────────────────
insert into public.activity_log_sources
 (entity, module_id, label_key, value_keys, scope_kind, parent_entity, parent_key, identity_keys, branch_columns, scope_parents, metadata_only, reader_roles)
values
 ('opname_variance_charges', 'pos', 'log_label', array['total', 'hpp_part', 'gain_part', 'tanggal', 'cancelled_at'], 'refs', null, null,
  array['id'], array['branch_id'], '[{"entity":"opname_results","key":"result_id"}]'::jsonb, false, array['OWNER', 'FINANCE']);
create trigger a01_activity_change after insert or update on public.opname_variance_charges for each row execute function public.capture_activity_log();
create trigger a01_activity_delete before delete on public.opname_variance_charges for each row execute function public.capture_activity_log();

-- ───────────────────────── 9. Pemeriksaan akhir ─────────────────────────
do $check$
begin
  if not exists (select 1 from role_settings_private.action_catalog where id = 'persediaan.beban_selisih_karyawan' and enforced)
     or not exists (select 1 from role_settings_private.action_modules where id = 'persediaan.beban_selisih_karyawan' and module_id = 'pos') then
    raise exception 'F2: izin persediaan.beban_selisih_karyawan belum terpasang';
  end if;
  if position('''Dicatat''' in (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.cash_advances'::regclass and conname = 'cash_advances_status_check')) = 0 then
    raise exception 'F2: status kasbon Dicatat belum terpasang';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.stock_document_corrections'::regclass and tgname = 'opname_correction_charge_guard') <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.opname_variance_charges'::regclass and tgname in ('opname_variance_charges_guard', 'a01_activity_change', 'a01_activity_delete')) <> 3 then
    raise exception 'F2: trigger penjaga belum lengkap';
  end if;
  if not has_function_privilege('authenticated', 'public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.opname_variance_charge_basis(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.opname_variance_charge_actor()', 'EXECUTE') then
    raise exception 'F2: ACL fungsi beban karyawan salah';
  end if;
end $check$;
