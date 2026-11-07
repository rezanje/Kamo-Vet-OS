-- OWNER "Tarik baris dari tagihan lunas": menghapus BARIS PENUH dari tagihan RAWAT INAP yang sudah lunas (dibayar uang muka) DI TEMPAT,
-- nomor tagihan tetap sama, jurnal selisih bertanggal HARI INI, stok bahan kembali pada harga pokok tercatat, dan sisa uang menjadi
-- SALDO UANG MUKA pasien (tidak ada uang kas/bank yang bergerak di sini). 7 Nov 2026 (kasus INV-202611-0434, baris Infus Refill).
--
-- Hanya objek BARU (tidak ada fungsi lama yang diganti; clinic_post_invoice, clinic_save_inpatient_cashier, clinic_release_advance_application,
-- clinic_void_payment_receipt, clinic_write_journal, bmhp_edit_plan, assert_invoice_price_floor tidak tersentuh):
--  * clinic_private.owner_invoice_corrections: jejak tambah-saja (UPDATE/DELETE/TRUNCATE ditolak), tanpa hak aplikasi.
--  * clinic_private.owner_remove_invoice_lines(..., p_dry): inti. Konstanta keputusan ada di bagian declare (mudah dibalik).
--  * public.clinic_owner_remove_invoice_lines(p_invoice_id, p_lines, p_reason, p_request_key) -> jsonb   (tombol "Tarik baris (Owner)")
--  * public.clinic_owner_invoice_lines_quote(p_invoice_id, p_lines) -> jsonb   (pratinjau baca-saja: kode yang sama di sub-transaksi yang dibatalkan)
--  * public.clinic_owner_invoice_lines_check(p_invoice_id) -> jsonb   (daftar baris + boleh/tidak + alasan, untuk layar)
--
-- Aturan v1 (ditegakkan di database, semua tolak-tertutup):
--  * hanya OWNER aktif yang boleh (konstanta c_allowed_roles) dan cabangnya diizinkan; alasan wajib (>= 5 huruf bukan-spasi, maksimal 500);
--    kunci permintaan wajib; idempoten menurut kunci (isi beda = IDEMPOTENCY_CONFLICT);
--  * tagihan tahap rawat inap yang AKTIF dan LUNAS, dibayar HANYA lewat Uang Muka (satu atau beberapa pemakaian), tanpa diskon/pajak/DP kepala/
--    voucher/kampanye, tanpa refund/koreksi metode bayar, bukan hasil terbit ulang; tanpa poin loyalti (c_refuse_if_points);
--    periode akuntansi/persediaan terbuka (tanggal jurnal asli DAN hari ini);
--  * hanya baris PENUH (qty yang diminta, bila disebut, harus sama dengan qty baris), tidak boleh menarik semua baris, tidak boleh racikan,
--    paket, atau baris yang resepnya sudah ditarik; baris BMHP wajib hpp = jumlah biaya komponen (+-0,01), baris barang biasa wajib hpp = biaya
--    kartu stok-nya; kartu stok tagihan (per barang) wajib sama dengan rincian baris (STOCK_MISMATCH = tidak menebak);
--  * stok: komponen BMHP / barang biasa kembali sebagai lapisan BARU tanpa kedaluwarsa (sumber 'klinik-edit', ref nomor tagihan) pada biaya
--    tercatat; barang hasil tindakan (job order) bersih 0 sehingga tidak disentuh;
--  * jurnal hari ini: 'klinik-edit' Dr 510002 / Cr 150001; 'klinik-hpp-edit' Dr 170001 / Cr 600001; 'klinik-ar' Dr 150001 / Cr 314001 per
--    pemakaian uang muka yang dikurangi (sama dengan pelepasan uang muka); pembayaran: baris negatif 'Uang Muka' reversal_of baris asal,
--    clinic_advance_applications.amount dikurangi (atau dilepas bila habis), clinic_customer_advances.applied dikurangi = saldo uang muka pasien;
--  * rekam medis: baris resep TETAP ada tetapi ditarik dari penagihan (billing_withdrawn_*), jadi keranjang kasir tidak memunculkannya lagi;
--  * komisi/pelaksana dibaca dari baris tagihan sehingga ikut hilang (bila komisi bulan itu sudah dibayar, penyesuaian manual);
--  * urutan kunci: koordinator tagihan -> kunci idempotensi -> kunjungan -> tagihan -> baris -> resep -> uang muka -> stok -> jurnal.
--
-- MEMBACA JEJAK (belum ada layar; hak aplikasi dicabut, baca lewat SQL editor sebagai postgres):
-- BACA_JEJAK_MULAI
--   select c.created_at, p.full_name as diubah_oleh, c.invoice_no, c.total_before, c.total_after, c.hpp_removed, c.reason, c.request_key, c.removed_lines
--   from clinic_private.owner_invoice_corrections c join public.profiles p on p.id = c.actor_id order by c.created_at desc limit 100;
-- BACA_JEJAK_SELESAI
--
-- Apply as ONE transaction (tanpa begin/commit sendiri). Tidak ada backfill.

do $guard$
begin
  if to_regclass('clinic_private.owner_invoice_corrections') is not null
     or to_regprocedure('public.clinic_owner_remove_invoice_lines(uuid,jsonb,text,text)') is not null then
    raise exception 'Tarik baris tagihan lunas: objek sudah ada; periksa urutan migrasi';
  end if;
  if to_regprocedure('public.clinic_record_correction_immutable()') is null
     or to_regprocedure('clinic_private.billing_lock(text[])') is null
     or to_regprocedure('clinic_private.billing_keys_invoice(uuid)') is null
     or to_regprocedure('clinic_private.sync_paid_status(uuid)') is null
     or to_regprocedure('public.clinic_write_journal(date,text,text,text,uuid,jsonb)') is null
     or to_regprocedure('public.stock_in_fifo(uuid,uuid,numeric,numeric,text,text,date,date)') is null
     or to_regclass('clinic_private.record_edit_permits') is null
     or to_regclass('public.clinic_advance_applications') is null or to_regclass('public.clinic_payment_corrections') is null
     or to_regclass('public.clinic_refunds') is null or to_regclass('public.clinic_refund_requests') is null then
    raise exception 'Tarik baris tagihan lunas: prasyarat tidak ditemukan';
  end if;
end $guard$;

create table clinic_private.owner_invoice_corrections (
  id uuid primary key,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references public.profiles(id),
  visit_id uuid not null references public.visits(id),
  invoice_id uuid not null references public.invoices(id),
  invoice_no text not null,
  reason text not null check (length(regexp_replace(btrim(reason), '\s', '', 'g')) >= 5 and length(btrim(reason)) <= 500),
  request_key text not null unique check (length(request_key) between 1 and 100),
  request_hash text not null,
  removed_lines jsonb not null,
  total_before numeric(15,2) not null,
  total_after numeric(15,2) not null,
  hpp_removed numeric(15,2) not null,
  stock_effects jsonb not null,
  journal_ids jsonb not null,
  advance_balance_before numeric(15,2) not null,
  advance_balance_after numeric(15,2) not null,
  result jsonb not null
);
create index owner_invoice_corrections_invoice_idx on clinic_private.owner_invoice_corrections(invoice_id, created_at);
alter table clinic_private.owner_invoice_corrections enable row level security;
revoke all on clinic_private.owner_invoice_corrections from public, anon, authenticated, service_role;
create trigger owner_invoice_corrections_immutable before update or delete on clinic_private.owner_invoice_corrections
  for each row execute function public.clinic_record_correction_immutable();
create trigger owner_invoice_corrections_no_truncate before truncate on clinic_private.owner_invoice_corrections
  for each statement execute function public.clinic_record_correction_immutable();

create function clinic_private.owner_remove_invoice_lines(p_invoice_id uuid, p_lines jsonb, p_reason text, p_request_key text, p_dry boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  -- Keputusan v1 (Andri belum menjawab: dibangun sebagai konstanta supaya mudah dibalik).
  c_allowed_roles constant text[] := array['OWNER'];       -- siapa yang boleh
  c_min_reason constant int := 5;                          -- huruf bukan-spasi minimal untuk alasan
  c_refuse_if_points constant boolean := true;             -- poin loyalti ada -> tolak (jangan menebak)
  c_cost_tolerance constant numeric := 0.01;               -- selisih hpp baris vs biaya tercatat yang masih dianggap sama
  c_max_lines constant int := 50;
  v_user uuid := auth.uid();
  v_role text;
  v_visit public.visits%rowtype; v_inv public.invoices%rowtype;
  v_reason text := btrim(coalesce(p_reason, '')); v_key text := btrim(coalesce(p_request_key, ''));
  v_hash text; v_prior clinic_private.owner_invoice_corrections%rowtype;
  v_row jsonb; v_id uuid; v_ids uuid[] := array[]::uuid[]; v_qtys jsonb := '[]'::jsonb; v_req_qty numeric;
  v_line public.invoice_items%rowtype; v_rx public.prescription_items%rowtype;
  v_removed numeric(15,2) := 0; v_hpp numeric(15,2) := 0; v_line_amount numeric(15,2);
  v_comp jsonb; v_comp_cost numeric; v_comp_qty numeric; v_touch uuid[] := array[]::uuid[]; v_item uuid;
  v_ledger numeric; v_expected numeric; v_cost_ledger numeric; v_wh uuid; v_wh_count int; v_plain_count int;
  v_restores jsonb := '[]'::jsonb; v_r jsonb; v_effects jsonb := '[]'::jsonb; v_name text;
  v_closed date; v_jdate date; v_cdate date; v_total_lines int; v_lines_json jsonb := '[]'::jsonb; v_all_amount numeric;
  v_left numeric(15,2); v_take numeric(15,2); v_app record; v_pay uuid; v_adv_before numeric := 0; v_adv_after numeric := 0; v_adv_json jsonb := '[]'::jsonb;
  v_applied_before numeric; v_applied_after numeric; v_first_adv uuid; v_first_no text;
  v_journals jsonb := '[]'::jsonb; v_jid uuid; v_audit_id uuid := gen_random_uuid(); v_result jsonb; v_rx_ids uuid[] := array[]::uuid[];
  v_total_before numeric(15,2); v_total_after numeric(15,2);
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('role', true), 'none'));
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  -- Cek peran SEBELUM mengambil kunci apa pun (bukan-Owner tidak boleh membuat Owner menunggu).
  if not exists (select 1 from public.profiles p where p.id = v_user and p.is_active and p.role::text = any(c_allowed_roles)) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: menarik baris dari tagihan lunas hanya untuk Owner';
  end if;
  if not p_dry and (length(regexp_replace(v_reason, '\s', '', 'g')) < c_min_reason or length(v_reason) > 500) then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED: alasan wajib diisi (minimal 5 huruf, maksimal 500)';
  end if;
  if not p_dry and (v_key = '' or length(v_key) > 100) then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED: kunci permintaan wajib diisi (1-100 karakter)';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and c_max_lines then
    raise exception using errcode = 'P0001', message = 'LINE_INVALID: pilih minimal satu baris';
  end if;
  -- Baris yang diminta: id valid, tidak dobel, qty (opsional) dicatat untuk dicocokkan setelah baris terkunci.
  for v_row in select value from jsonb_array_elements(p_lines) loop
    begin
      v_id := nullif(v_row ->> 'invoice_item_id', '')::uuid;
      v_req_qty := nullif(v_row ->> 'qty', '')::numeric;
    exception when others then
      raise exception using errcode = 'P0001', message = 'LINE_INVALID: baris tidak valid';
    end;
    if jsonb_typeof(v_row) is distinct from 'object' or v_id is null or v_id = any(v_ids) or (v_req_qty is not null and v_req_qty::text in ('NaN', 'Infinity', '-Infinity')) then
      raise exception using errcode = 'P0001', message = 'LINE_INVALID: baris tidak valid atau dobel';
    end if;
    v_ids := v_ids || v_id;
    v_qtys := v_qtys || jsonb_build_array(jsonb_build_object('id', v_id::text, 'qty', v_req_qty));
  end loop;

  select i.visit_id into v_inv.visit_id from public.invoices i where i.id = p_invoice_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: tagihan tidak ditemukan';
  end if;
  -- Koordinator tagihan kunjungan lebih dulu (kunci yang sama dengan kasir ranap, posting, pelepasan uang muka dan pembatalan kwitansi).
  perform clinic_private.billing_lock(clinic_private.billing_keys_invoice(p_invoice_id));
  -- Baca ulang peran dan cabang SESUDAH menunggu.
  if not exists (select 1 from public.profiles p where p.id = v_user and p.is_active and p.role::text = any(c_allowed_roles)) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: menarik baris dari tagihan lunas hanya untuk Owner';
  end if;
  if not public.user_can_access_branch((select v.branch_id from public.visits v where v.id = v_inv.visit_id)) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang tagihan tidak diizinkan';
  end if;

  v_hash := md5(jsonb_build_array(p_invoice_id::text, v_reason, (
    select coalesce(jsonb_agg(jsonb_build_array(t.id, t.qty) order by t.id), '[]'::jsonb) from (
      select e.value ->> 'id' as id, e.value ->> 'qty' as qty from jsonb_array_elements(v_qtys) e) t))::text);
  if not p_dry then
    perform pg_advisory_xact_lock(hashtextextended('owner-tarik-baris:' || v_key, 0));
    select * into v_prior from clinic_private.owner_invoice_corrections where request_key = v_key;
    if found then
      if v_prior.actor_id is distinct from v_user or v_prior.invoice_id is distinct from p_invoice_id or v_prior.request_hash is distinct from v_hash then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci permintaan sudah dipakai untuk koreksi yang berbeda';
      end if;
      return v_prior.result || jsonb_build_object('replayed', true);
    end if;
  end if;

  select * into v_visit from public.visits v where v.id = v_inv.visit_id for update;
  if v_visit.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'INVOICE_ADJUSTED: kunjungan sudah diarsipkan';
  end if;
  select * into v_inv from public.invoices i where i.id = p_invoice_id for update;
  if v_inv.voided_at is not null then
    raise exception using errcode = 'P0001', message = 'INVOICE_VOID: tagihan sudah dibatalkan';
  end if;
  if v_inv.request_key is null or v_inv.invoice_no is null or not v_inv.stage_billing or v_inv.reissued_from is not null or v_inv.correction_pending
     or coalesce(v_inv.discount, 0) <> 0 or coalesce(v_inv.tax, 0) <> 0 or coalesce(v_inv.dp_amount, 0) <> 0
     or v_inv.voucher_code is not null or v_inv.campaign_code is not null
     or exists (select 1 from public.clinic_payment_corrections c where c.invoice_id = p_invoice_id) then
    raise exception using errcode = 'P0001', message = 'INVOICE_ADJUSTED: v1 hanya untuk tagihan tahap rawat inap tanpa diskon, pajak, DP kepala, voucher, kampanye, terbit ulang atau koreksi metode bayar';
  end if;
  if exists (select 1 from public.clinic_refunds f where f.invoice_id = p_invoice_id)
     or exists (select 1 from public.clinic_refund_requests f where f.invoice_id = p_invoice_id) then
    raise exception using errcode = 'P0001', message = 'REFUND_EXISTS: tagihan ini sudah punya refund atau permintaan refund';
  end if;
  if v_inv.paid_status is distinct from 'Lunas' or clinic_private.invoice_received(p_invoice_id) < v_inv.total or v_inv.total <= 0 then
    raise exception using errcode = 'P0001', message = 'INVOICE_NOT_PAID: tagihan belum lunas; hanya tagihan lunas yang bisa ditarik barisnya dari sini';
  end if;
  -- Pembayaran: HANYA Uang Muka (positif tiap pemakaian punya baris pemakaian yang belum dilepas; negatif membalik baris positif).
  if not exists (select 1 from public.invoice_payments p where p.invoice_id = p_invoice_id and p.amount > 0)
     or exists (select 1 from public.invoice_payments p where p.invoice_id = p_invoice_id
                and (p.metode is distinct from 'Uang Muka' or p.kas_code is distinct from '314001' or p.transferred_from is not null or p.amount = 0
                     or (p.amount > 0 and (p.reversal_of is not null or (not exists (select 1 from public.clinic_advance_applications a where a.payment_id = p.id and a.invoice_id = p_invoice_id and a.released_at is null)
                          and p.amount + coalesce((select sum(n.amount) from public.invoice_payments n where n.reversal_of = p.id), 0) <> 0)))
                     or (p.amount < 0 and not exists (select 1 from public.invoice_payments o where o.id = p.reversal_of and o.invoice_id = p_invoice_id and o.amount > 0))))
     or (select coalesce(sum(p.amount), 0) from public.invoice_payments p where p.invoice_id = p_invoice_id) <> v_inv.total then
    raise exception using errcode = 'P0001', message = 'PAYMENT_METHOD: v1 hanya untuk tagihan yang dibayar penuh lewat uang muka (bukan tunai/transfer/DP kepala)';
  end if;
  if public.inventory_is_average() then
    raise exception using errcode = 'P0001', message = 'AVERAGE_UNSUPPORTED: metode persediaan rata-rata belum didukung untuk tarik baris';
  end if;
  if c_refuse_if_points and v_visit.customer_id is not null
     and exists (select 1 from public.point_ledger l where l.customer_id = v_visit.customer_id and l.ref = v_inv.invoice_no) then
    raise exception using errcode = 'P0001', message = 'POINTS_PRESENT: tagihan ini menghasilkan poin loyalti; v1 tidak menebak penyesuaian poin';
  end if;
  -- Periode: tanggal jurnal asli DAN hari ini harus di atas tanggal kunci (laporan periode tertutup tidak boleh berubah).
  select closed_until into v_closed from public.accounting_locks where id;
  select min(e.tanggal) into v_jdate from public.journal_entries e where e.source in ('klinik', 'klinik-reissue') and e.source_ref = v_inv.invoice_no and e.voided_at is null;
  v_cdate := (v_inv.created_at at time zone 'Asia/Jakarta')::date;
  if v_closed is not null and (v_closed >= current_date or v_closed >= least(coalesce(v_jdate, v_cdate), v_cdate)) then
    raise exception using errcode = 'P0001', message = format('PERIOD_LOCKED: periode akuntansi sampai %s sudah ditutup', v_closed);
  end if;
  begin
    perform public.inventory_assert_open_date(current_date);
  exception when others then
    raise exception using errcode = 'P0001', message = 'PERIOD_LOCKED: ' || sqlerrm;
  end;

  -- Baris: kunci, cocokkan qty, tolak racikan/paket/ditarik, hitung nilai dan hpp.
  select count(*), coalesce(round(sum(round(ii.qty * ii.harga * (1 - coalesce(ii.diskon_persen, 0) / 100), 2)), 2), 0)
    into v_total_lines, v_all_amount from public.invoice_items ii where ii.invoice_id = p_invoice_id;
  if v_all_amount is distinct from v_inv.subtotal or v_inv.subtotal is distinct from v_inv.total
     or exists (select 1 from public.invoice_items ii where ii.invoice_id = p_invoice_id and coalesce(ii.diskon_persen, 0) <> 0) then
    raise exception using errcode = 'P0001', message = 'INVOICE_ADJUSTED: rincian baris tidak sama dengan total tagihan; perlu pemeriksaan keuangan';
  end if;
  for v_id in select x from unnest(v_ids) x order by x loop
    select * into v_line from public.invoice_items ii where ii.id = v_id and ii.invoice_id = p_invoice_id for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'LINE_INVALID: baris tidak ditemukan pada tagihan ini';
    end if;
    v_req_qty := nullif((select e.value ->> 'qty' from jsonb_array_elements(v_qtys) e where e.value ->> 'id' = v_id::text), '')::numeric;
    if v_req_qty is not null and v_req_qty is distinct from v_line.qty then
      raise exception using errcode = 'P0001', message = format('PARTIAL_NOT_ALLOWED: baris %s hanya bisa ditarik penuh (jumlah %s), bukan sebagian', v_line.deskripsi, v_line.qty);
    end if;
    if v_line.compound_recipe_id is not null then
      raise exception using errcode = 'P0001', message = format('RECIPE_LINKED: baris racikan %s tidak bisa ditarik dari sini', v_line.deskripsi);
    end if;
    if v_line.package_item_id is not null or v_line.prescription_item_id is null or (v_line.jenis = 'obat' and v_line.item_id is null) then
      raise exception using errcode = 'P0001', message = format('LINE_INVALID: baris %s (paket/tanpa resep/tanpa master) tidak bisa ditarik', v_line.deskripsi);
    end if;
    select * into v_rx from public.prescription_items pi where pi.id = v_line.prescription_item_id for update;
    if not found or v_rx.billing_withdrawn_at is not null then
      raise exception using errcode = 'P0001', message = format('LINE_WITHDRAWN: resep baris %s sudah ditarik dari penagihan', v_line.deskripsi);
    end if;
    v_line_amount := round(v_line.qty * v_line.harga, 2);
    v_removed := v_removed + v_line_amount; v_hpp := v_hpp + coalesce(v_line.hpp, 0); v_rx_ids := v_rx_ids || v_rx.id;
    v_lines_json := v_lines_json || jsonb_build_array(jsonb_build_object('invoice_item_id', v_line.id, 'deskripsi', v_line.deskripsi, 'qty', v_line.qty, 'harga', v_line.harga,
      'amount', v_line_amount, 'hpp', coalesce(v_line.hpp, 0), 'jenis', v_line.jenis, 'prescription_item_id', v_line.prescription_item_id, 'row', to_jsonb(v_line)));
    if v_line.bmhp_components is not null then
      -- Tindakan ber-BMHP: kembalikan KOMPONEN pada biaya tercatat; hpp baris harus sama dengan jumlah biaya komponen.
      v_comp_cost := 0;
      for v_comp in select value from jsonb_array_elements(v_line.bmhp_components -> 'components') loop
        v_comp_qty := (v_comp ->> 'base_qty')::numeric;
        if v_comp_qty is null or v_comp_qty <= 0 or (v_comp ->> 'cost') is null or (v_comp ->> 'cost')::numeric <= 0 then
          raise exception using errcode = 'P0001', message = format('COST_MISMATCH: biaya komponen BMHP baris %s tidak lengkap', v_line.deskripsi);
        end if;
        v_comp_cost := v_comp_cost + (v_comp ->> 'cost')::numeric;
        v_touch := v_touch || (v_comp ->> 'item_id')::uuid;
      end loop;
      if abs(coalesce(v_line.hpp, 0) - v_comp_cost) > c_cost_tolerance then
        raise exception using errcode = 'P0001', message = format('COST_MISMATCH: HPP baris %s (%s) tidak sama dengan biaya BMHP-nya (%s); tidak ditebak', v_line.deskripsi, coalesce(v_line.hpp, 0), round(v_comp_cost, 2));
      end if;
      if v_line.item_id is not null and v_line.jenis = 'obat' then v_touch := v_touch || v_line.item_id; end if;
    elsif v_line.jenis = 'obat' then
      v_touch := v_touch || v_line.item_id;
    elsif coalesce(v_line.hpp, 0) <> 0 then
      raise exception using errcode = 'P0001', message = format('COST_MISMATCH: baris jasa %s punya HPP tanpa bahan tercatat', v_line.deskripsi);
    end if;
  end loop;
  if v_total_lines = array_length(v_ids, 1) then
    raise exception using errcode = 'P0001', message = 'LAST_LINE: tidak boleh menarik semua baris; batalkan atau terbitkan ulang tagihan untuk itu';
  end if;

  -- Kartu stok tagihan per barang harus sama dengan rincian baris SAAT INI (tidak menebak).
  for v_item in select distinct x from unnest(v_touch) x order by x loop
    select coalesce(-sum(m.qty), 0) into v_ledger from public.stock_moves m
      where m.source_ref = v_inv.invoice_no and m.item_id = v_item and m.source in ('klinik', 'klinik-bmhp', 'pesanan-selesai', 'klinik-edit');
    select coalesce(sum(ii.qty * coalesce(ii.faktor, 1)), 0) into v_expected from public.invoice_items ii
      where ii.invoice_id = p_invoice_id and ii.item_id = v_item and ii.bmhp_components is null and ii.jenis = 'obat' and ii.compound_recipe_id is null;
    v_expected := v_expected + coalesce((select sum((c.value ->> 'base_qty')::numeric) from public.invoice_items ii
      cross join lateral jsonb_array_elements(ii.bmhp_components -> 'components') c where ii.invoice_id = p_invoice_id and (c.value ->> 'item_id')::uuid = v_item), 0);
    if v_ledger is distinct from v_expected then
      raise exception using errcode = 'P0001', message = format('STOCK_MISMATCH: kartu stok tagihan untuk %s (%s) tidak sama dengan rincian baris (%s)',
        coalesce((select i.name from public.items i where i.id = v_item), v_item::text), v_ledger, v_expected);
    end if;
  end loop;

  -- Rencana pengembalian stok (urut barang) dari baris yang ditarik.
  for v_id in select x from unnest(v_ids) x order by x loop
    select * into v_line from public.invoice_items ii where ii.id = v_id;
    if v_line.bmhp_components is not null then
      for v_comp in select value from jsonb_array_elements(v_line.bmhp_components -> 'components') loop
        select count(distinct m.warehouse_id), min(m.warehouse_id::text)::uuid into v_wh_count, v_wh from public.stock_moves m
          where m.source = 'klinik-bmhp' and m.source_ref = v_inv.invoice_no and m.item_id = (v_comp ->> 'item_id')::uuid;
        if v_wh_count <> 1 then
          raise exception using errcode = 'P0001', message = 'STOCK_MISMATCH: gudang asal komponen BMHP tidak ditemukan atau tidak tunggal';
        end if;
        v_restores := v_restores || jsonb_build_array(jsonb_build_object('item_id', v_comp ->> 'item_id', 'warehouse_id', v_wh, 'qty', (v_comp ->> 'base_qty')::numeric,
          'cost', (v_comp ->> 'cost')::numeric, 'line_id', v_line.id));
      end loop;
    elsif v_line.jenis = 'obat' then
      select count(*) into v_plain_count from public.invoice_items ii where ii.invoice_id = p_invoice_id and ii.item_id = v_line.item_id and ii.bmhp_components is null and ii.jenis = 'obat' and ii.compound_recipe_id is null;
      select round(-sum(m.qty * m.unit_cost), 2), count(distinct m.warehouse_id), min(m.warehouse_id::text)::uuid into v_cost_ledger, v_wh_count, v_wh from public.stock_moves m
        where m.source = 'klinik' and m.source_ref = v_inv.invoice_no and m.item_id = v_line.item_id;
      if v_plain_count <> 1 or v_wh_count <> 1 or v_cost_ledger is null then
        raise exception using errcode = 'P0001', message = format('STOCK_MISMATCH: kartu stok barang %s tidak jelas (baris ganda atau gudang tidak tunggal)', v_line.deskripsi);
      end if;
      if abs(coalesce(v_line.hpp, 0) - v_cost_ledger) > c_cost_tolerance or coalesce(v_line.hpp, 0) <= 0 then
        raise exception using errcode = 'P0001', message = format('COST_MISMATCH: HPP baris %s (%s) tidak sama dengan biaya kartu stoknya (%s); tidak ditebak', v_line.deskripsi, coalesce(v_line.hpp, 0), v_cost_ledger);
      end if;
      v_restores := v_restores || jsonb_build_array(jsonb_build_object('item_id', v_line.item_id::text, 'warehouse_id', v_wh, 'qty', v_line.qty * coalesce(v_line.faktor, 1),
        'cost', coalesce(v_line.hpp, 0), 'line_id', v_line.id));
    end if;
  end loop;

  -- Uang muka yang membayar tagihan ini: terkunci SEBELUM stok dan jurnal. Pemakaian terbaru dikurangi lebih dulu.
  v_left := v_removed;
  v_total_before := v_inv.total; v_total_after := v_inv.total - v_removed;
  for v_app in
    select a.id, a.advance_id, a.payment_id, a.amount from public.clinic_advance_applications a
    where a.invoice_id = p_invoice_id and a.released_at is null order by (select ca.created_at from public.clinic_customer_advances ca where ca.id = a.advance_id) desc, a.created_at desc, a.id desc for update
  loop
    exit when v_left <= 0;
    perform 1 from public.clinic_customer_advances ca where ca.id = v_app.advance_id for update;
  end loop;
  -- Stok: kunci saldo urut barang, lalu lapisan baru (stock_in_fifo menulis kartu stok).
  for v_r in select value from jsonb_array_elements(v_restores) order by (value ->> 'item_id'), (value ->> 'line_id') loop
    perform 1 from public.stock s where s.warehouse_id = (v_r ->> 'warehouse_id')::uuid and s.item_id = (v_r ->> 'item_id')::uuid for update;
  end loop;
  for v_r in select value from jsonb_array_elements(v_restores) order by (value ->> 'item_id'), (value ->> 'line_id') loop
    perform public.stock_in_fifo((v_r ->> 'warehouse_id')::uuid, (v_r ->> 'item_id')::uuid, (v_r ->> 'qty')::numeric, (v_r ->> 'cost')::numeric / (v_r ->> 'qty')::numeric,
      'klinik-edit', v_inv.invoice_no, current_date, null);
    select i.name into v_name from public.items i where i.id = (v_r ->> 'item_id')::uuid;
    v_effects := v_effects || jsonb_build_array(jsonb_build_object('item_id', v_r ->> 'item_id', 'name', v_name, 'qty', (v_r ->> 'qty')::numeric,
      'cost', round((v_r ->> 'cost')::numeric, 2), 'unit_cost', round((v_r ->> 'cost')::numeric / (v_r ->> 'qty')::numeric, 4), 'line_id', v_r ->> 'line_id', 'arah', 'kembali'));
  end loop;

  -- Baris tagihan dihapus; total mengikuti sisa (tanpa diskon/pajak, subtotal = total).
  delete from public.invoice_items where invoice_id = p_invoice_id and id = any(v_ids);
  update public.invoices set subtotal = subtotal - v_removed, total = total - v_removed where id = p_invoice_id;
  insert into public.invoice_edit_log (invoice_id, edited_by, field_changed, old_value, new_value, reason)
    values (p_invoice_id, v_user, 'total', v_total_before::text, v_total_after::text, 'Tarik baris (Owner): ' || v_reason);
  -- Rekam medis: baris resep tetap ada, tetapi ditarik dari penagihan (keranjang kasir tidak memunculkannya lagi).
  insert into clinic_private.record_edit_permits values (txid_current(), v_user, v_visit.id);
  update public.prescription_items set billing_withdrawn_at = clock_timestamp(), billing_withdrawn_by = v_user,
    billing_withdrawal_reason = left('Tarik baris tagihan lunas (Owner): ' || v_reason, 1000)
    where id = any(v_rx_ids);
  delete from clinic_private.record_edit_permits where transaction_id = txid_current();

  -- Pembayaran: kurangi pemakaian uang muka (terbaru dulu); selisih menjadi saldo uang muka pasien.
  for v_app in
    select a.id, a.advance_id, a.payment_id, a.amount from public.clinic_advance_applications a
    where a.invoice_id = p_invoice_id and a.released_at is null order by (select ca.created_at from public.clinic_customer_advances ca where ca.id = a.advance_id) desc, a.created_at desc, a.id desc for update
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_app.amount);
    select ca.amount - ca.applied, ca.applied into v_applied_before, v_applied_after from public.clinic_customer_advances ca where ca.id = v_app.advance_id for update;
    insert into public.invoice_payments (invoice_id, tanggal, amount, metode, catatan, kas_code, created_by, reversal_of)
      values (p_invoice_id, current_date, -v_take, 'Uang Muka', 'Tarik baris tagihan ' || v_inv.invoice_no || ' (Owner)', '314001', v_user, v_app.payment_id)
      returning id into v_pay;
    if v_take = v_app.amount then
      update public.clinic_advance_applications set released_at = now(), released_by = v_user,
        release_reason = left('Tarik baris tagihan (Owner): ' || v_reason, 500), release_payment_id = v_pay where id = v_app.id;
    else
      update public.clinic_advance_applications set amount = amount - v_take where id = v_app.id;
    end if;
    update public.clinic_customer_advances set applied = applied - v_take where id = v_app.advance_id;
    v_jid := public.clinic_write_journal(current_date, 'Tarik baris tagihan ' || v_inv.invoice_no || ': kurangi pemakaian uang muka', 'klinik-ar', v_inv.invoice_no, v_visit.branch_id,
      jsonb_build_array(jsonb_build_object('code', '150001', 'debit', v_take, 'credit', 0), jsonb_build_object('code', '314001', 'debit', 0, 'credit', v_take)));
    v_journals := v_journals || jsonb_build_array(jsonb_build_object('id', v_jid, 'source', 'klinik-ar', 'amount', v_take));
    v_adv_before := v_adv_before + v_applied_before; v_adv_after := v_adv_after + v_applied_before + v_take;
    v_adv_json := v_adv_json || jsonb_build_array(jsonb_build_object('id', v_app.advance_id, 'no_uang_muka', (select ca.no_uang_muka from public.clinic_customer_advances ca where ca.id = v_app.advance_id),
      'reduced', v_take, 'balance_before', v_applied_before, 'balance_after', v_applied_before + v_take));
    if v_first_adv is null then v_first_adv := v_app.advance_id; v_first_no := (select ca.no_uang_muka from public.clinic_customer_advances ca where ca.id = v_app.advance_id); end if;
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    raise exception using errcode = 'P0001', message = 'ADVANCE_INSUFFICIENT: pemakaian uang muka tidak cukup untuk dikurangi';
  end if;

  -- Jurnal selisih bertanggal HARI INI (pendapatan, HPP). Jurnal uang muka sudah ditulis per pemakaian di atas.
  v_jid := public.clinic_write_journal(current_date, 'Tarik baris tagihan ' || v_inv.invoice_no || ': pembalikan pendapatan', 'klinik-edit', v_inv.invoice_no, v_visit.branch_id,
    jsonb_build_array(jsonb_build_object('code', '510002', 'debit', v_removed, 'credit', 0), jsonb_build_object('code', '150001', 'debit', 0, 'credit', v_removed)));
  v_journals := v_journals || jsonb_build_array(jsonb_build_object('id', v_jid, 'source', 'klinik-edit', 'amount', v_removed));
  if v_hpp > 0 then
    v_jid := public.clinic_write_journal(current_date, 'Tarik baris tagihan ' || v_inv.invoice_no || ': pembalikan HPP', 'klinik-hpp-edit', v_inv.invoice_no, v_visit.branch_id,
      jsonb_build_array(jsonb_build_object('code', '170001', 'debit', v_hpp, 'credit', 0), jsonb_build_object('code', '600001', 'debit', 0, 'credit', v_hpp)));
    v_journals := v_journals || jsonb_build_array(jsonb_build_object('id', v_jid, 'source', 'klinik-hpp-edit', 'amount', v_hpp));
  end if;
  perform clinic_private.sync_paid_status(p_invoice_id);
  if (select i.paid_status from public.invoices i where i.id = p_invoice_id) is distinct from 'Lunas' then
    raise exception using errcode = 'P0001', message = 'INVOICE_NOT_PAID: status tagihan tidak tetap Lunas setelah koreksi';
  end if;

  v_result := jsonb_build_object('status', 'OK', 'dry', p_dry, 'invoice_id', p_invoice_id, 'invoice_no', v_inv.invoice_no, 'visit_id', v_visit.id,
    'total_before', v_total_before, 'total_after', v_total_after, 'removed_total', v_removed, 'hpp_removed', v_hpp,
    'lines', (select jsonb_agg(e.value - 'row') from jsonb_array_elements(v_lines_json) e), 'stock', v_effects, 'journals', v_journals,
    'advance', jsonb_build_object('id', v_first_adv, 'no_uang_muka', v_first_no, 'balance_before', v_adv_before, 'balance_after', v_adv_after, 'items', v_adv_json),
    'audit_id', v_audit_id);
  if p_dry then
    -- Pratinjau: seluruh efek di atas dibatalkan oleh pemanggil (sub-transaksi), hasilnya dibawa lewat DETAIL.
    raise exception using errcode = 'P0Z99', message = 'QUOTE', detail = v_result::text;
  end if;
  perform public.refresh_customer_spending(v_visit.customer_id) where v_visit.customer_id is not null;
  insert into clinic_private.owner_invoice_corrections (id, actor_id, visit_id, invoice_id, invoice_no, reason, request_key, request_hash, removed_lines,
    total_before, total_after, hpp_removed, stock_effects, journal_ids, advance_balance_before, advance_balance_after, result)
  values (v_audit_id, v_user, v_visit.id, p_invoice_id, v_inv.invoice_no, v_reason, v_key, v_hash, v_lines_json,
    v_total_before, v_total_after, v_hpp, v_effects, (select jsonb_agg(e.value -> 'id') from jsonb_array_elements(v_journals) e), v_adv_before, v_adv_after, v_result);
  return v_result;
end;
$function$;
revoke all on function clinic_private.owner_remove_invoice_lines(uuid, jsonb, text, text, boolean) from public, anon, authenticated, service_role;

create function public.clinic_owner_remove_invoice_lines(p_invoice_id uuid, p_lines jsonb, p_reason text, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
begin
  return clinic_private.owner_remove_invoice_lines(p_invoice_id, p_lines, p_reason, p_request_key, false);
end;
$function$;
revoke all on function public.clinic_owner_remove_invoice_lines(uuid, jsonb, text, text) from public, anon, service_role;
grant execute on function public.clinic_owner_remove_invoice_lines(uuid, jsonb, text, text) to authenticated;

create function public.clinic_owner_invoice_lines_quote(p_invoice_id uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
declare v_detail text;
begin
  begin
    perform clinic_private.owner_remove_invoice_lines(p_invoice_id, p_lines, null, null, true);
  exception when sqlstate 'P0Z99' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return v_detail::jsonb;
  end;
  raise exception using errcode = 'P0001', message = 'LINE_INVALID: pratinjau tidak menghasilkan hasil';
end;
$function$;
revoke all on function public.clinic_owner_invoice_lines_quote(uuid, jsonb) from public, anon, service_role;
grant execute on function public.clinic_owner_invoice_lines_quote(uuid, jsonb) to authenticated;

-- Daftar baris tagihan + boleh/tidak ditarik + alasan (untuk layar). Tiap baris dicoba lewat pratinjau yang sama (dibatalkan).
create function public.clinic_owner_invoice_lines_check(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
declare v_rows jsonb := '[]'::jsonb; v_line record; v_detail text; v_msg text; v_ok boolean; v_quote jsonb; v_inv public.invoices%rowtype;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role = 'OWNER') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: menarik baris dari tagihan lunas hanya untuk Owner';
  end if;
  select * into v_inv from public.invoices i where i.id = p_invoice_id;
  if not found or not public.user_can_access_branch((select v.branch_id from public.visits v where v.id = v_inv.visit_id)) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: tagihan tidak ditemukan';
  end if;
  for v_line in select ii.id, ii.deskripsi, ii.qty, ii.harga, ii.hpp from public.invoice_items ii where ii.invoice_id = p_invoice_id order by ii.id loop
    v_ok := false; v_msg := null; v_quote := null;
    begin
      perform clinic_private.owner_remove_invoice_lines(p_invoice_id, jsonb_build_array(jsonb_build_object('invoice_item_id', v_line.id)), null, null, true);
    exception
      when sqlstate 'P0Z99' then
        get stacked diagnostics v_detail = pg_exception_detail; v_ok := true; v_quote := v_detail::jsonb;
      when others then
        get stacked diagnostics v_msg = message_text;
    end;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('invoice_item_id', v_line.id, 'deskripsi', v_line.deskripsi, 'qty', v_line.qty, 'harga', v_line.harga,
      'hpp', coalesce(v_line.hpp, 0), 'eligible', v_ok, 'message', v_msg, 'quote', v_quote));
  end loop;
  return jsonb_build_object('invoice_id', p_invoice_id, 'invoice_no', v_inv.invoice_no, 'total', v_inv.total, 'paid_status', v_inv.paid_status, 'lines', v_rows);
end;
$function$;
revoke all on function public.clinic_owner_invoice_lines_check(uuid) from public, anon, service_role;
grant execute on function public.clinic_owner_invoice_lines_check(uuid) to authenticated;

do $check$
declare d text;
begin
  d := pg_get_functiondef('clinic_private.owner_remove_invoice_lines(uuid,jsonb,text,text,boolean)'::regprocedure);
  if position('billing_lock' in d) = 0 or position('c_allowed_roles' in d) = 0 or position('array[''OWNER'']' in d) = 0 or position('owner_invoice_corrections' in d) = 0
     or position('stock_in_fifo' in d) = 0 or position('accounting_locks' in d) = 0 then
    raise exception 'Tarik baris tagihan lunas: definisi tidak sesuai setelah dipasang';
  end if;
end $check$;
