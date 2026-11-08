-- BAGIAN B: OWNER mengoreksi BMHP (bahan habis pakai) baris tindakan yang SUDAH ada di tagihan rawat inap (lunas ATAU belum), 8 Nov 2026.
--
-- Kasus (Andri, 7 Nov): "injeksi antibiotik yang sudah jadi kenapa ga bisa diubah bmhp nya? kan minta sekalian juga kemarin".
-- Sesudah invoice terbit, snapshot BMHP baris (invoice_items.bmhp_components) dan HPP baris (invoice_items.hpp) tidak bisa diubah siapa pun
-- (guard_invoice_item_bmhp menolak mutlak; koreksi tagihan menolak baris ber-BMHP; owner_tarik_baris hanya menarik penuh dan menolak baris
-- yang HPP-nya tidak sama dengan biaya komponen). Padahal stok bahan, HPP baris, dan jurnal HPP-nya ikut salah.
--
-- Padanan dari clinic_owner_correct_compound_invoiced (racikan, 20261107160000) untuk BMHP:
--  * clinic_private.owner_bmhp_invoice_corrections: jejak tambah-saja (siapa/kapan/tagihan+baris/status bayar/daftar sebelum-sesudah-ASLI/
--    biaya & HPP sebelum-sesudah-selisih/jurnal/alasan/kunci/efek stok). Tanpa hak aplikasi.
--  * clinic_private.owner_correct_invoiced_bmhp(..., p_dry) + public.clinic_owner_correct_invoiced_bmhp(p_invoice_item_id, p_components,
--    p_reason, p_request_key) + public.clinic_owner_invoiced_bmhp_quote(p_invoice_item_id, p_components) (pratinjau baca-saja: kode yang sama
--    di sub-transaksi yang dibatalkan) + public.clinic_owner_invoice_bmhp_lines(p_invoice_id) (daftar baris ber-BMHP + riwayat untuk layar).
--  * clinic_private.owner_bmhp_invoice_permits: izin satu-transaksi (pola performer_change_permits) yang SATU-SATUNYA membuka guard snapshot.
--
-- SATU-SATUNYA fungsi hidup yang diganti: public.guard_invoice_item_bmhp() (trigger yang menolak mutlak perubahan snapshot BMHP). Penggantian
-- memakai jangkar eksak (pg_get_functiondef + replace, gagal bila jangkar tidak tepat satu) dan HANYA menambahkan syarat "kecuali ada izin
-- satu-transaksi atas baris itu oleh pengguna itu"; semua cabang lain (INSERT dari app, dll.) tidak berubah. Dibuktikan: digest native semua
-- objek lain identik, dan definisi baru == definisi lama dengan jangkar itu diganti (md5).
--
-- Perilaku (ditegakkan di database):
--  * stok bergerak HANYA sebesar selisih jumlah (satuan dasar) per bahan memakai primitif yang sama dengan posting dan koreksi tagihan:
--    pengurangan = stock_in_fifo pada biaya tercatat komponen itu (biaya komponen / base_qty, rata-rata bila dulu keluar dari beberapa lapisan;
--    sama dengan koreksi tagihan dan tarik baris), sumber 'klinik-edit'; penambahan atau bahan baru = stock_out_fifo pada FIFO SAAT INI,
--    sumber 'klinik-bmhp'; keduanya ref nomor tagihan, bertanggal hari ini. Kartu stok tagihan per bahan tetap sama dengan rincian baris.
--  * invoice_items.bmhp_components diganti di tempat (komponen baru + biaya baru, versi 1) dan invoice_items.hpp = hpp lama + selisih biaya
--    komponen (untuk baris jasa hpp = biaya komponen persis; untuk baris barang pesanan tindakan, yang HPP-nya bisa berbeda dari biaya
--    komponen karena job_order_complete menjual lapisan hasil tindakan tertua, selisih itu tetap dan dilaporkan: hpp_differs_from_cost);
--    prescription_items.bmhp_components disamakan (izin record_edit_permits) supaya void/tagih ulang memakai daftar yang benar.
--  * jurnal selisih bertanggal HARI INI lewat clinic_write_journal, sumber 'klinik-hpp-edit' (sumber yang sama yang dibalik void/koreksi lama),
--    source_ref nomor invoice: naik Dr 600001 / Cr 170001; turun Dr 170001 / Cr 600001. Seimbang.
--  * total tagihan, harga, diskon, pajak, pembayaran, kwitansi, status bayar, poin TIDAK disentuh. P03 TIDAK diubah: dinilai saat posting/koreksi
--    dokumen invoice, bukan saat koreksi HPP ini; bila HPP baru melewati harga neto, hasil melaporkannya (price_below_hpp_after) tanpa menolak.
--  * ditolak bila: bukan Owner/cabang lain; kunjungan bukan rawat inap; checkout/arsip/pulang+Selesai; baris resep ditarik; baris racikan
--    (RECIPE_LINKED); baris tanpa snapshot BMHP (NOT_BMHP); invoice void (INVOICE_VOID); menunggu koreksi kasir (INVOICE_PENDING); invoice
--    terbit ulang (INVOICE_ADJUSTED); sudah ada refund/permintaan refund (REFUND_EXISTS); metode persediaan rata-rata (AVERAGE_UNSUPPORTED);
--    riwayat tidak konsisten (HPP_INCONSISTENT / STOCK_MISMATCH / JOURNAL_MISMATCH: tidak menebak); periode akuntansi/persediaan terkunci s/d
--    hari ini; tanpa perubahan (NO_CHANGE); payload/stok tidak valid tanpa efek parsial.
--  * owner_tarik_baris_lunas, koreksi racikan, kasir ranap, posting, void, refund TIDAK diubah.
--
-- Kunci (urutan sama dengan kasir ranap dan koreksi racikan bertagihan): peran -> koordinator tagihan kunjungan (billing_lock) -> idempotensi
--   (advisory) -> kunjungan FOR UPDATE -> rawat inap -> baris resep -> baris invoice -> invoice -> bahan (urut item_id) -> stok -> lapisan.
--
-- MEMBACA JEJAK: layar Owner memakai clinic_owner_invoice_bmhp_lines; atau SQL editor:
-- BACA_JEJAK_MULAI
--   select c.created_at, p.full_name as diubah_oleh, c.invoice_no, c.paid_status, c.cost_before, c.cost_after, c.hpp_before, c.hpp_after, c.hpp_delta, c.reason, c.before_components, c.after_components
--   from clinic_private.owner_bmhp_invoice_corrections c join public.profiles p on p.id = c.actor_id order by c.created_at desc limit 100;
-- BACA_JEJAK_SELESAI
--
-- Apply as ONE transaction (tanpa begin/commit sendiri), SESUDAH 20261107230000 (bagian A). Tidak ada backfill.

do $guard$
begin
  if to_regclass('clinic_private.owner_bmhp_invoice_corrections') is not null
     or to_regprocedure('public.clinic_owner_correct_invoiced_bmhp(uuid,jsonb,text,text)') is not null then
    raise exception 'Koreksi BMHP bertagihan Owner: objek sudah ada; periksa urutan migrasi';
  end if;
  if to_regprocedure('clinic_private.owner_bmhp_normalize(jsonb,jsonb,jsonb,boolean)') is null
     or to_regclass('clinic_private.owner_bmhp_cart_overrides') is null
     or to_regprocedure('public.clinic_record_correction_immutable()') is null
     or to_regprocedure('clinic_private.billing_lock(text[])') is null
     or to_regprocedure('clinic_private.billing_keys_visit(uuid)') is null
     or to_regprocedure('public.clinic_write_journal(date,text,text,text,uuid,jsonb)') is null
     or to_regprocedure('public.inventory_assert_open_date(date)') is null
     or to_regprocedure('public.stock_in_fifo(uuid,uuid,numeric,numeric,text,text,date,date)') is null
     or to_regprocedure('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)') is null
     or to_regprocedure('public.guard_invoice_item_bmhp()') is null
     or to_regclass('clinic_private.record_edit_permits') is null
     or to_regclass('public.clinic_refunds') is null or to_regclass('public.clinic_refund_requests') is null
     or to_regclass('public.invoice_items') is null or to_regclass('public.invoices') is null then
    raise exception 'Koreksi BMHP bertagihan Owner: prasyarat tidak ditemukan';
  end if;
end $guard$;

create table clinic_private.owner_bmhp_invoice_permits (
  transaction_id bigint primary key,
  actor uuid not null,
  invoice_item_id uuid not null
);
revoke all on clinic_private.owner_bmhp_invoice_permits from public, anon, authenticated, service_role;

-- Guard snapshot BMHP: tetap menolak mutlak, KECUALI satu transaksi yang memegang izin atas baris itu (ditulis hanya oleh fungsi Owner di bawah).
do $patch$
declare
  signature regprocedure := 'public.guard_invoice_item_bmhp()'::regprocedure;
  definition text := pg_get_functiondef(signature);
  old_text text := E'  if tg_op = ''UPDATE'' and new.bmhp_components is distinct from old.bmhp_components then';
  new_text text := E'  if tg_op = ''UPDATE'' and new.bmhp_components is distinct from old.bmhp_components\n'
    || E'     and not exists (select 1 from clinic_private.owner_bmhp_invoice_permits pp where pp.transaction_id = txid_current()\n'
    || E'       and pp.actor = auth.uid() and pp.invoice_item_id = new.id) then';
begin
  if position('owner_bmhp_invoice_permits' in definition) > 0 then
    raise exception 'Guard snapshot BMHP: izin Owner sudah terpasang; periksa urutan migrasi';
  end if;
  if (length(definition) - length(replace(definition, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'GUARD_DRIFT: guard_invoice_item_bmhp berubah; tinjau sebelum rilis';
  end if;
  execute replace(definition, old_text, new_text);
end $patch$;
revoke all on function public.guard_invoice_item_bmhp() from public, anon, authenticated, service_role;

create table clinic_private.owner_bmhp_invoice_corrections (
  id uuid primary key,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references public.profiles(id),
  visit_id uuid not null references public.visits(id),
  prescription_item_id uuid not null references public.prescription_items(id),
  invoice_id uuid not null references public.invoices(id),
  invoice_item_id uuid not null references public.invoice_items(id),
  invoice_no text not null,
  paid_status text not null,
  reason text not null check (length(regexp_replace(btrim(reason), '\s', '', 'g')) >= 5 and length(btrim(reason)) <= 500),
  request_key text not null unique check (length(request_key) between 1 and 100),
  request_hash text not null,
  original_components jsonb not null,
  before_components jsonb not null,
  after_components jsonb not null,
  cost_before numeric(15,2) not null,
  cost_after numeric(15,2) not null,
  hpp_before numeric(15,2) not null,
  hpp_after numeric(15,2) not null,
  hpp_delta numeric(15,2) not null,
  price numeric(15,2) not null,
  invoice_total numeric(15,2) not null,
  price_below_hpp_before boolean not null,
  price_below_hpp_after boolean not null,
  journal_entry_id uuid references public.journal_entries(id),
  stock_effects jsonb not null,
  result jsonb not null
);
create index owner_bmhp_invoice_corrections_item_idx on clinic_private.owner_bmhp_invoice_corrections(invoice_item_id, created_at);
create index owner_bmhp_invoice_corrections_invoice_idx on clinic_private.owner_bmhp_invoice_corrections(invoice_id, created_at);
alter table clinic_private.owner_bmhp_invoice_corrections enable row level security;
revoke all on clinic_private.owner_bmhp_invoice_corrections from public, anon, authenticated, service_role;
create trigger owner_bmhp_invoice_corrections_immutable before update or delete on clinic_private.owner_bmhp_invoice_corrections
  for each row execute function public.clinic_record_correction_immutable();
create trigger owner_bmhp_invoice_corrections_no_truncate before truncate on clinic_private.owner_bmhp_invoice_corrections
  for each statement execute function public.clinic_record_correction_immutable();

create function clinic_private.owner_correct_invoiced_bmhp(p_invoice_item_id uuid, p_components jsonb, p_reason text, p_request_key text, p_dry boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_key text := btrim(coalesce(p_request_key, ''));
  v_visit_id uuid; v_visit public.visits%rowtype; v_line public.invoice_items%rowtype; v_inv public.invoices%rowtype; v_rx public.prescription_items%rowtype;
  v_hash text; v_prior clinic_private.owner_bmhp_invoice_corrections%rowtype;
  v_snap jsonb; v_before jsonb; v_original jsonb; v_new jsonb; v_after_snap jsonb := '[]'::jsonb; v_entry jsonb;
  v_cost_before numeric; v_cost_after numeric := 0; v_hpp_before numeric; v_hpp_after numeric; v_delta numeric; v_changes int;
  v_item_ids uuid[]; v_target record; v_item public.items%rowtype; v_name text; v_cur jsonb; v_cur_base numeric; v_cur_cost numeric; v_tgt_base numeric; v_d numeric; v_new_cost numeric;
  v_stock numeric; v_out record; v_restore_val numeric; v_warehouse uuid; v_wh_count int; v_ledger numeric; v_expected numeric; v_effects jsonb := '[]'::jsonb;
  v_net_hpp numeric; v_share numeric; v_net numeric; v_floor boolean; v_below_b boolean; v_below_a boolean; v_costs jsonb := '{}'::jsonb;
  v_jlines jsonb := '[]'::jsonb; v_journal_id uuid; v_journal jsonb; v_audit_id uuid := gen_random_uuid(); v_result jsonb;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('role', true), 'none'));
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  -- Cek peran SEBELUM mengambil kunci apa pun (bukan-Owner tidak boleh membuat Owner menunggu).
  if not exists (select 1 from public.profiles p where p.id = v_user and p.is_active and p.role = 'OWNER') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: koreksi BMHP baris yang sudah ditagih hanya untuk Owner';
  end if;
  if not p_dry and (length(regexp_replace(v_reason, '\s', '', 'g')) < 5 or length(v_reason) > 500) then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED: alasan koreksi wajib diisi (minimal 5 huruf, maksimal 500)';
  end if;
  if not p_dry and (v_key = '' or length(v_key) > 100) then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED: kunci permintaan wajib diisi (1-100 karakter)';
  end if;
  if jsonb_typeof(p_components) is distinct from 'array' or jsonb_array_length(p_components) not between 1 and 50 then
    raise exception using errcode = 'P0001', message = 'BMHP_INVALID: minimal satu bahan dan maksimal 50 bahan';
  end if;

  select i.visit_id into v_visit_id from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id where ii.id = p_invoice_item_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'LINE_INVALID: baris tagihan tidak ditemukan';
  end if;
  -- Koordinator tagihan kunjungan lebih dulu (kunci yang sama dengan kasir ranap, penerimaan pembayaran, void invoice, posting, koreksi racikan).
  perform clinic_private.billing_lock(clinic_private.billing_keys_visit(v_visit_id));
  -- Baca ulang peran dan cabang SESUDAH menunggu.
  if not exists (select 1 from public.profiles p where p.id = v_user and p.is_active and p.role = 'OWNER') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: koreksi BMHP baris yang sudah ditagih hanya untuk Owner';
  end if;
  select * into v_visit from public.visits v where v.id = v_visit_id;
  if v_visit.id is null or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang tagihan tidak diizinkan';
  end if;

  -- Idempoten: kunci yang sama dan isi yang sama mengembalikan hasil tersimpan; isi beda ditolak.
  v_hash := md5(jsonb_build_array(p_invoice_item_id::text, v_reason, (
    select coalesce(jsonb_agg(jsonb_build_array(t.item_id, t.qty, t.unit) order by t.item_id), '[]'::jsonb) from (
      select e.value ->> 'item_id' as item_id, e.value ->> 'qty' as qty, e.value ->> 'unit' as unit from jsonb_array_elements(p_components) e) t))::text);
  if not p_dry then
    perform pg_advisory_xact_lock(hashtextextended('owner-bmhp-invoiced:' || v_key, 0));
    select * into v_prior from clinic_private.owner_bmhp_invoice_corrections c where c.request_key = v_key;
    if found then
      if v_prior.actor_id is distinct from v_user or v_prior.invoice_item_id is distinct from p_invoice_item_id or v_prior.request_hash is distinct from v_hash then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci permintaan sudah dipakai untuk koreksi yang berbeda';
      end if;
      return v_prior.result || jsonb_build_object('replayed', true);
    end if;
  end if;

  select * into v_visit from public.visits v where v.id = v_visit_id for update;
  if not exists (select 1 from public.inpatient_records ir where ir.visit_id = v_visit_id) then
    raise exception using errcode = 'P0001', message = 'NOT_INPATIENT: koreksi Owner ini hanya untuk tagihan rawat inap';
  end if;
  perform 1 from public.inpatient_records ir where ir.visit_id = v_visit_id order by ir.id for update;
  if v_visit.checked_out_at is not null or v_visit.archived_at is not null
     or (v_visit.status = 'Selesai' and not exists (select 1 from public.inpatient_records ir where ir.visit_id = v_visit_id and ir.discharged_at is null)) then
    raise exception using errcode = 'P0001', message = 'VISIT_CLOSED: kunjungan sudah selesai/checkout, BMHP baris tagihan tidak bisa diubah lagi';
  end if;
  select ii.* into v_line from public.invoice_items ii where ii.id = p_invoice_item_id;
  select * into v_rx from public.prescription_items pi where pi.id = v_line.prescription_item_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LINE_INVALID: baris tagihan ini tidak bertaut ke baris resep';
  end if;
  if v_rx.billing_withdrawn_at is not null then
    raise exception using errcode = 'P0001', message = 'LINE_INVALID: baris resep sudah ditarik dari tagihan';
  end if;
  select * into v_line from public.invoice_items ii where ii.id = p_invoice_item_id for update;
  select * into v_inv from public.invoices i where i.id = v_line.invoice_id for update;
  if v_inv.visit_id is distinct from v_visit_id then
    raise exception using errcode = 'P0001', message = 'LINE_INVALID: baris tagihan tidak cocok dengan kunjungan';
  end if;
  if v_inv.voided_at is not null then
    raise exception using errcode = 'P0001', message = 'INVOICE_VOID: tagihan ini sudah dibatalkan (void), BMHP-nya tidak dikoreksi';
  end if;
  if v_inv.correction_pending then
    raise exception using errcode = 'P0001', message = 'INVOICE_PENDING: tagihan ini menunggu koreksi kasir; selesaikan koreksi kasir dulu';
  end if;
  if v_inv.reissued_from is not null or v_inv.invoice_no is null or v_inv.request_key is null then
    raise exception using errcode = 'P0001', message = 'INVOICE_ADJUSTED: hanya tagihan asli yang diterbitkan kasir (bukan terbit ulang) yang bisa dikoreksi BMHP-nya';
  end if;
  if exists (select 1 from public.clinic_refunds f where f.invoice_id = v_inv.id) or exists (select 1 from public.clinic_refund_requests f where f.invoice_id = v_inv.id) then
    raise exception using errcode = 'P0001', message = 'REFUND_EXISTS: tagihan ini sudah punya refund atau permintaan refund';
  end if;
  if v_line.compound_recipe_id is not null then
    raise exception using errcode = 'P0001', message = 'RECIPE_LINKED: baris racikan dikoreksi lewat koreksi racikan Owner, bukan BMHP';
  end if;
  if v_line.bmhp_components is null or jsonb_typeof(v_line.bmhp_components -> 'components') is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'NOT_BMHP: baris tagihan ini tidak punya snapshot BMHP';
  end if;
  if public.inventory_is_average() then
    raise exception using errcode = 'P0001', message = 'AVERAGE_UNSUPPORTED: metode persediaan rata-rata belum didukung untuk koreksi BMHP bertagihan';
  end if;
  -- Periode akuntansi/persediaan: jurnal dan mutasi stok koreksi bertanggal hari ini.
  perform public.inventory_assert_open_date(current_date);

  -- Riwayat harus utuh (tidak menebak): biaya komponen = biaya snapshot; baris jasa HPP = biaya; kartu stok tagihan per bahan = rincian baris;
  -- jurnal HPP bersih tagihan = jumlah HPP baris.
  v_snap := v_line.bmhp_components -> 'components';
  select coalesce(sum((e.value ->> 'cost')::numeric), 0) into v_cost_before from jsonb_array_elements(v_snap) e;
  if exists (select 1 from jsonb_array_elements(v_snap) e where (e.value ->> 'base_qty') is null or (e.value ->> 'base_qty')::numeric <= 0 or (e.value ->> 'cost') is null or (e.value ->> 'cost')::numeric <= 0)
     or abs(v_cost_before - (v_line.bmhp_components ->> 'cost')::numeric) > 0.01 then
    raise exception using errcode = 'P0001', message = 'HPP_INCONSISTENT: snapshot BMHP baris tidak lengkap atau biayanya tidak cocok; hubungi Reza sebelum mengubah apa pun';
  end if;
  v_hpp_before := coalesce(v_line.hpp, 0);
  if not (v_line.jenis = 'obat' and v_line.item_id is not null) and abs(v_hpp_before - v_cost_before) > 0.01 then
    raise exception using errcode = 'P0001', message = format('HPP_INCONSISTENT: HPP baris tagihan %s tidak sama dengan biaya BMHP-nya %s; hubungi Reza', v_hpp_before, round(v_cost_before, 2));
  end if;
  if v_hpp_before <= 0 then
    raise exception using errcode = 'P0001', message = 'HPP_INCONSISTENT: HPP baris tagihan kosong; hubungi Reza';
  end if;
  v_before := v_snap;
  v_original := coalesce((select z.original_components from (
      select o.created_at, o.id, o.original_components from clinic_private.owner_bmhp_cart_overrides o where o.prescription_item_id = v_rx.id
      union all select c2.created_at, c2.id, c2.original_components from clinic_private.owner_bmhp_invoice_corrections c2 where c2.prescription_item_id = v_rx.id) z
    order by z.created_at desc, z.id desc limit 1), v_snap);
  -- Bahan yang kini nonaktif tidak boleh dipertahankan: daftar baris resep ikut ditulis ulang dan guard BMHP menolak bahan nonaktif; keluarkan dari daftar.
  v_new := clinic_private.owner_bmhp_normalize(p_components, v_original, v_snap, false);
  select count(*) into v_changes from (
    (select t.item_id, t.qty, t.unit from jsonb_to_recordset(v_snap) as t(item_id uuid, qty numeric, unit text)
     except select t.item_id, t.qty, t.unit from jsonb_to_recordset(v_new) as t(item_id uuid, qty numeric, unit text))
    union all
    (select t.item_id, t.qty, t.unit from jsonb_to_recordset(v_new) as t(item_id uuid, qty numeric, unit text)
     except select t.item_id, t.qty, t.unit from jsonb_to_recordset(v_snap) as t(item_id uuid, qty numeric, unit text))) d;
  if v_changes = 0 then
    raise exception using errcode = 'P0001', message = 'NO_CHANGE: daftar BMHP sama dengan yang sekarang, tidak ada yang diubah';
  end if;

  select coalesce(array_agg(distinct x.item_id order by x.item_id), array[]::uuid[]) into v_item_ids from (
    select (e.value ->> 'item_id')::uuid as item_id from jsonb_array_elements(v_snap) e union select (e.value ->> 'item_id')::uuid from jsonb_array_elements(v_new) e) x;
  -- Kartu stok tagihan (per bahan, sumber BMHP) harus sama dengan rincian SEMUA baris tagihan saat ini.
  for v_target in select unnest(v_item_ids) as item_id loop
    select coalesce(-sum(m.qty), 0) into v_ledger from public.stock_moves m
      where m.source_ref = v_inv.invoice_no and m.item_id = v_target.item_id and m.source in ('klinik-bmhp', 'klinik-edit');
    select coalesce(sum((c.value ->> 'base_qty')::numeric), 0) into v_expected from public.invoice_items ii
      cross join lateral jsonb_array_elements(ii.bmhp_components -> 'components') c where ii.invoice_id = v_inv.id and ii.bmhp_components is not null
      and (c.value ->> 'item_id')::uuid = v_target.item_id;
    if v_ledger is distinct from v_expected then
      raise exception using errcode = 'P0001', message = format('STOCK_MISMATCH: kartu stok tagihan untuk %s (%s) tidak sama dengan rincian baris (%s); hubungi Reza',
        coalesce((select i.name from public.items i where i.id = v_target.item_id), v_target.item_id::text), v_ledger, v_expected);
    end if;
  end loop;
  select count(distinct m.warehouse_id), min(m.warehouse_id::text)::uuid into v_wh_count, v_warehouse from public.stock_moves m
    where m.source in ('klinik-bmhp', 'klinik-edit') and m.source_ref = v_inv.invoice_no and m.item_id = any(v_item_ids);
  if v_wh_count <> 1 then
    raise exception using errcode = 'P0001', message = 'STOCK_MISMATCH: gudang asal bahan BMHP tidak ditemukan atau tidak tunggal';
  end if;
  select coalesce(sum(l.debit - l.credit), 0) into v_net_hpp from public.journal_entries e join public.journal_lines l on l.entry_id = e.id
    join public.coa_accounts a on a.id = l.account_id
    where e.source in ('klinik-hpp', 'klinik-hpp-edit') and e.source_ref = v_inv.invoice_no and e.voided_at is null and a.code = '600001';
  if abs(v_net_hpp - coalesce((select sum(ii.hpp) from public.invoice_items ii where ii.invoice_id = v_inv.id), 0)) > 0.01 then
    raise exception using errcode = 'P0001', message = format('JOURNAL_MISMATCH: jurnal HPP tagihan (%s) tidak sama dengan jumlah HPP baris (%s); hubungi Reza', v_net_hpp,
      coalesce((select sum(ii.hpp) from public.invoice_items ii where ii.invoice_id = v_inv.id), 0));
  end if;

  -- Selisih per bahan, urut item_id (sama dengan penerbitan dan posting): kunci stok dulu, lalu primitif stok yang sama.
  for v_target in select unnest(v_item_ids) as item_id loop
    perform 1 from public.stock s where s.warehouse_id = v_warehouse and s.item_id = v_target.item_id for update;
  end loop;
  for v_target in select unnest(v_item_ids) as item_id loop
    select i.name into v_name from public.items i where i.id = v_target.item_id;
    v_cur := (select e.value from jsonb_array_elements(v_snap) e where (e.value ->> 'item_id')::uuid = v_target.item_id limit 1);
    v_entry := (select e.value from jsonb_array_elements(v_new) e where (e.value ->> 'item_id')::uuid = v_target.item_id limit 1);
    v_cur_base := coalesce((v_cur ->> 'base_qty')::numeric, 0);
    v_cur_cost := coalesce((v_cur ->> 'cost')::numeric, 0);
    v_tgt_base := coalesce((v_entry ->> 'base_qty')::numeric, 0);
    v_d := v_tgt_base - v_cur_base;
    v_new_cost := v_cur_cost;
    if v_d > 0 then
      select s.qty into v_stock from public.stock s where s.warehouse_id = v_warehouse and s.item_id = v_target.item_id;
      if coalesce(v_stock, 0) < v_d then
        raise exception using errcode = 'P0001', message = format('STOCK_SHORT: %s', coalesce(v_name, 'bahan BMHP'));
      end if;
      select * into v_out from public.stock_out_fifo(v_warehouse, v_target.item_id, v_d, 'klinik-bmhp', v_inv.invoice_no, current_date);
      if v_out.shortfall > 0 or v_out.cost is null or v_out.cost <= 0 or exists (
        select 1 from jsonb_array_elements(v_out.takes) t where (t.value ->> 'unit_cost')::numeric <= 0) then
        raise exception using errcode = 'P0001', message = format('COST_MISSING: %s', coalesce(v_name, 'bahan BMHP'));
      end if;
      v_new_cost := v_cur_cost + round(v_out.cost, 2);
      v_effects := v_effects || jsonb_build_array(jsonb_build_object('item_id', v_target.item_id::text, 'name', v_name, 'delta', v_d, 'cost', round(v_out.cost, 2), 'direction', 'keluar'));
    elsif v_d < 0 then
      -- Dikembalikan pada biaya tercatat komponen (biaya / base_qty); seluruh biaya bila bahan dikeluarkan dari daftar.
      v_restore_val := case when v_tgt_base = 0 then v_cur_cost else round((-v_d) * v_cur_cost / v_cur_base, 2) end;
      if v_restore_val <= 0 then
        raise exception using errcode = 'P0001', message = format('COST_MISSING: biaya tercatat %s tidak tersedia', coalesce(v_name, 'bahan BMHP'));
      end if;
      perform public.stock_in_fifo(v_warehouse, v_target.item_id, -v_d, v_restore_val / (-v_d), 'klinik-edit', v_inv.invoice_no, current_date, null);
      v_new_cost := v_cur_cost - v_restore_val;
      v_effects := v_effects || jsonb_build_array(jsonb_build_object('item_id', v_target.item_id::text, 'name', v_name, 'delta', v_d, 'cost', v_restore_val, 'direction', 'kembali'));
    end if;
    if v_tgt_base > 0 then
      if v_new_cost <= 0 then
        raise exception using errcode = 'P0001', message = format('COST_MISSING: biaya baru %s nol', coalesce(v_name, 'bahan BMHP'));
      end if;
      v_costs := v_costs || jsonb_build_object(v_target.item_id::text, v_new_cost);
    end if;
  end loop;
  -- Snapshot baru: komponen lama (urutan lama, nama snapshot lama) lalu komponen baru (urutan daftar); biaya dari catatan di atas.
  select coalesce(jsonb_agg(z.entry order by z.grp, z.ord), '[]'::jsonb) into v_after_snap from (
    select jsonb_build_object('item_id', n.value ->> 'item_id', 'name', coalesce(o.value ->> 'name', n.value ->> 'name'), 'qty', (n.value ->> 'qty')::numeric, 'unit', n.value ->> 'unit',
        'factor', (n.value ->> 'factor')::numeric, 'base_qty', (n.value ->> 'base_qty')::numeric, 'cost', (v_costs ->> (n.value ->> 'item_id'))::numeric) as entry,
      case when o.value is null then 1 else 0 end as grp, coalesce(o.ordinality, n.ordinality) as ord
    from jsonb_array_elements(v_new) with ordinality as n(value, ordinality)
    left join jsonb_array_elements(v_snap) with ordinality as o(value, ordinality) on o.value ->> 'item_id' = n.value ->> 'item_id') z;
  select coalesce(sum((e.value ->> 'cost')::numeric), 0) into v_cost_after from jsonb_array_elements(v_after_snap) e;
  if jsonb_array_length(v_after_snap) <> jsonb_array_length(v_new) or exists (select 1 from jsonb_array_elements(v_after_snap) e where (e.value ->> 'cost')::numeric <= 0) then
    raise exception using errcode = 'P0001', message = 'COST_MISSING: biaya BMHP baru tidak lengkap setelah koreksi';
  end if;
  v_delta := v_cost_after - v_cost_before;
  v_hpp_after := v_hpp_before + v_delta;
  if v_hpp_after <= 0 then
    raise exception using errcode = 'P0001', message = format('COST_MISSING: HPP baris menjadi %s setelah koreksi; HPP baris ini berasal dari lapisan hasil tindakan lama, koreksi tidak bisa diteruskan', v_hpp_after);
  end if;

  -- Tulis di tempat: snapshot + HPP baris (izin satu-transaksi membuka guard snapshot), lalu daftar di baris resep (izin kasir ranap).
  insert into clinic_private.owner_bmhp_invoice_permits values (txid_current(), v_user, v_line.id);
  update public.invoice_items set hpp = v_hpp_after, bmhp_components = jsonb_build_object('version', 1, 'cost', v_cost_after, 'components', v_after_snap) where id = v_line.id;
  delete from clinic_private.owner_bmhp_invoice_permits where transaction_id = txid_current();
  insert into clinic_private.record_edit_permits values (txid_current(), v_user, v_visit_id);
  update public.prescription_items set bmhp_components = v_new where id = v_rx.id;
  delete from clinic_private.record_edit_permits where transaction_id = txid_current();

  -- Jurnal selisih HPP bertanggal HARI INI (naik: Dr 600001 / Cr 170001; turun: kebalikannya).
  if v_delta > 0 then
    v_jlines := jsonb_build_array(jsonb_build_object('code', '600001', 'debit', v_delta, 'credit', 0), jsonb_build_object('code', '170001', 'debit', 0, 'credit', v_delta));
  elsif v_delta < 0 then
    v_jlines := jsonb_build_array(jsonb_build_object('code', '170001', 'debit', -v_delta, 'credit', 0), jsonb_build_object('code', '600001', 'debit', 0, 'credit', -v_delta));
  end if;
  if v_delta <> 0 then
    v_journal_id := public.clinic_write_journal(current_date, 'Koreksi HPP BMHP (Owner) ' || v_inv.invoice_no, 'klinik-hpp-edit', v_inv.invoice_no, v_visit.branch_id, v_jlines);
  end if;
  v_journal := jsonb_build_object('date', current_date, 'source', 'klinik-hpp-edit', 'source_ref', v_inv.invoice_no, 'lines', v_jlines);
  if not p_dry then v_journal := v_journal || jsonb_build_object('entry_id', v_journal_id); end if;

  -- Bendera harga < HPP memakai rumus lantai P03 (harga neto baris setelah porsi diskon invoice); hanya dilaporkan, tidak menolak.
  v_share := case when v_inv.subtotal > 0 then (v_inv.subtotal - v_inv.discount) / v_inv.subtotal else 1 end;
  v_net := round(round(v_line.qty * v_line.harga * (1 - coalesce(v_line.diskon_persen, 0) / 100), 2) * v_share, 2);
  v_floor := v_line.jenis = 'obat' and v_line.item_id is not null and v_line.package_item_id is null;
  v_below_b := v_floor and v_net < v_hpp_before;
  v_below_a := v_floor and v_net < v_hpp_after;

  v_result := jsonb_build_object('status', 'OK', 'visit_id', v_visit_id, 'prescription_item_id', v_rx.id, 'invoice_id', v_inv.id, 'invoice_no', v_inv.invoice_no,
    'invoice_item_id', v_line.id, 'item_name', v_line.deskripsi, 'jenis', v_line.jenis, 'paid_status', v_inv.paid_status, 'invoice_total', v_inv.total, 'price', v_line.harga, 'net_price', v_net,
    'floor_applies', v_floor, 'cost_before', v_cost_before, 'cost_after', v_cost_after, 'hpp_before', v_hpp_before, 'hpp_after', v_hpp_after, 'hpp_delta', v_delta,
    'hpp_differs_from_cost', abs(v_hpp_before - v_cost_before) > 0.01, 'price_below_hpp_before', v_below_b, 'price_below_hpp_after', v_below_a,
    'journal', v_journal, 'before', v_before, 'after', v_after_snap, 'stock', v_effects, 'audit_id', v_audit_id);
  if p_dry then
    -- Pratinjau: seluruh efek di atas (termasuk stok dan jurnal) dibatalkan oleh pemanggil (sub-transaksi), hasilnya dibawa lewat DETAIL.
    raise exception using errcode = 'P0Z99', message = 'QUOTE', detail = v_result::text;
  end if;
  insert into clinic_private.owner_bmhp_invoice_corrections (id, actor_id, visit_id, prescription_item_id, invoice_id, invoice_item_id, invoice_no, paid_status, reason, request_key, request_hash,
    original_components, before_components, after_components, cost_before, cost_after, hpp_before, hpp_after, hpp_delta, price, invoice_total, price_below_hpp_before, price_below_hpp_after,
    journal_entry_id, stock_effects, result)
  values (v_audit_id, v_user, v_visit_id, v_rx.id, v_inv.id, v_line.id, v_inv.invoice_no, v_inv.paid_status, v_reason, v_key, v_hash,
    v_original, v_before, v_after_snap, v_cost_before, v_cost_after, v_hpp_before, v_hpp_after, v_delta, v_line.harga, v_inv.total, v_below_b, v_below_a,
    v_journal_id, v_effects, v_result);
  return v_result;
end;
$function$;
revoke all on function clinic_private.owner_correct_invoiced_bmhp(uuid, jsonb, text, text, boolean) from public, anon, authenticated, service_role;

create function public.clinic_owner_correct_invoiced_bmhp(p_invoice_item_id uuid, p_components jsonb, p_reason text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
begin
  return clinic_private.owner_correct_invoiced_bmhp(p_invoice_item_id, p_components, p_reason, p_request_key, false);
end;
$function$;
revoke all on function public.clinic_owner_correct_invoiced_bmhp(uuid, jsonb, text, text) from public, anon, service_role;
grant execute on function public.clinic_owner_correct_invoiced_bmhp(uuid, jsonb, text, text) to authenticated;

create function public.clinic_owner_invoiced_bmhp_quote(p_invoice_item_id uuid, p_components jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
declare v_detail text;
begin
  begin
    perform clinic_private.owner_correct_invoiced_bmhp(p_invoice_item_id, p_components, null, null, true);
  exception when sqlstate 'P0Z99' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return v_detail::jsonb;
  end;
  raise exception using errcode = 'P0001', message = 'BMHP_INVALID: pratinjau tidak menghasilkan hasil';
end;
$function$;
revoke all on function public.clinic_owner_invoiced_bmhp_quote(uuid, jsonb) from public, anon, service_role;
grant execute on function public.clinic_owner_invoiced_bmhp_quote(uuid, jsonb) to authenticated;

-- Daftar baris ber-BMHP sebuah tagihan untuk layar Owner (baca-saja; kelayakan akhir diputuskan pratinjau/koreksi).
create function public.clinic_owner_invoice_bmhp_lines(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_inv public.invoices%rowtype;
begin
  select * into v_inv from public.invoices i where i.id = p_invoice_id;
  if auth.uid() is null or v_inv.id is null or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role = 'OWNER')
     or not exists (select 1 from public.visits v where v.id = v_inv.visit_id and public.user_can_access_branch(v.branch_id)) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: koreksi BMHP tagihan hanya untuk Owner cabang tagihan';
  end if;
  return jsonb_build_object('invoice_id', v_inv.id, 'invoice_no', v_inv.invoice_no, 'paid_status', v_inv.paid_status, 'total', v_inv.total, 'voided', v_inv.voided_at is not null,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('invoice_item_id', ii.id, 'deskripsi', ii.deskripsi, 'qty', ii.qty, 'harga', ii.harga, 'hpp', ii.hpp, 'jenis', ii.jenis,
        'bmhp', ii.bmhp_components,
        'history', coalesce((select jsonb_agg(jsonb_build_object('created_at', c.created_at, 'actor_name', p.full_name, 'reason', c.reason, 'hpp_before', c.hpp_before, 'hpp_after', c.hpp_after,
            'before_components', c.before_components, 'after_components', c.after_components) order by c.created_at desc, c.id desc)
          from clinic_private.owner_bmhp_invoice_corrections c join public.profiles p on p.id = c.actor_id where c.invoice_item_id = ii.id), '[]'::jsonb))
      order by ii.created_at, ii.id) from public.invoice_items ii where ii.invoice_id = v_inv.id and ii.bmhp_components is not null and ii.compound_recipe_id is null), '[]'::jsonb));
end;
$function$;
revoke all on function public.clinic_owner_invoice_bmhp_lines(uuid) from public, anon, service_role;
grant execute on function public.clinic_owner_invoice_bmhp_lines(uuid) to authenticated;

do $check$
declare d text; g text;
begin
  d := pg_get_functiondef('clinic_private.owner_correct_invoiced_bmhp(uuid,jsonb,text,text,boolean)'::regprocedure);
  if position('billing_lock' in d) = 0 or position('p.role = ''OWNER''' in d) = 0 or position('owner_bmhp_invoice_corrections' in d) = 0
     or position('clinic_write_journal' in d) = 0 or position('inventory_assert_open_date' in d) = 0 or position('stock_in_fifo' in d) = 0 or position('stock_out_fifo' in d) = 0
     or position('owner_bmhp_invoice_permits' in d) = 0 or position('update public.invoices' in d) > 0 or position('invoice_payments' in d) > 0 or position('stock_moves (' in d) > 0 then
    raise exception 'Koreksi BMHP bertagihan Owner: definisi tidak sesuai setelah dipasang';
  end if;
  g := pg_get_functiondef('public.guard_invoice_item_bmhp()'::regprocedure);
  if position('owner_bmhp_invoice_permits' in g) = 0 or position('BMHP_INVALID: snapshot BMHP invoice tidak dapat diubah' in g) = 0 or position('snapshot BMHP hanya dari posting invoice' in g) = 0 then
    raise exception 'Koreksi BMHP bertagihan Owner: guard snapshot tidak sesuai setelah dipasang';
  end if;
end $check$;
