-- BAGIAN A: OWNER mengubah daftar BMHP (bahan habis pakai) baris tindakan yang MASIH PENDING di keranjang kasir rawat inap (8 Nov 2026).
--
-- Kasus (Andri, 7 Nov): "injeksi antibiotik ga bisa ke proses karena HPP nya lebih tinggi, mau diubah ke 3.4 lacto-B nya".
-- Baris 'Injeksi Antibiotik' (barang persediaan di pohon TINDAKAN, harga Rp50.000) membawa BMHP catatan dokter (mis. Lacto-B x5 =
-- HPP Rp60.000). P03 (assert_invoice_price_floor) menolak saat tagihan terbit karena harga neto < HPP, dan keranjang kasir
-- (clinic_save_inpatient_cashier) TIDAK pernah menulis bmhp_components (BMHP_LOCKED hanya mengunci item_id), sedangkan dokter tidak
-- bisa mengedit rekam medis setelah ada invoice (RECORD_POSTED). Jadi tidak ada orang yang bisa membetulkan komposisinya.
--
-- Rancangan (diputuskan dengan bukti, lihat owner-bmhp-tindakan-report.json):
--  * BMHP baris pending hidup di prescription_items.bmhp_components (catatan dokter; dinormalisasi guard_prescription_bmhp: nama, faktor,
--    base_qty dari master). Stok BMHP baru keluar saat invoice diposting (clinic_private.bmhp_issue membaca kolom itu), jadi mengoreksi
--    SEBELUM ditagih = menulis ulang rencana pemakaian; tidak ada stok/jurnal/HPP yang bergerak di sini.
--  * Karena posting (bmhp_issue), HPP baris (job_order_complete / biaya BMHP) dan lantai P03 semuanya membaca kolom yang SAMA, menulis
--    daftar baru ke kolom itu (lewat izin satu-transaksi record_edit_permits yang sudah dipakai kasir ranap) membuat posting mengeluarkan
--    TEPAT komponen hasil override pada FIFO saat itu dan membuat P03 menilai HPP BARU, tanpa mengganti satu fungsi hidup pun.
--  * Jejak tambah-saja clinic_private.owner_bmhp_cart_overrides (siapa/kapan/kunjungan/baris/daftar sebelum-sesudah-ASLI/HPP/alasan/kunci/
--    snapshot) + satu baris riwayat keranjang (clinic_pending_cart_edits, kunci 'bmhp:<kunci>'). Tanpa hak aplikasi.
--
-- Yang ditambahkan (HANYA objek baru; kasir ranap, draft keranjang, P03, clinic_post_invoice, bmhp_issue, guard BMHP, edit dokter,
-- clinic_write_journal tidak diganti satu byte pun; dibuktikan dengan digest native):
--  * clinic_private.owner_bmhp_normalize(p_components, p_original, p_current, p_keep_inactive): validasi + normalisasi (bahan aktif bertipe
--    Persediaan, jumlah > 0 maksimal 4 desimal (jumlah BARU minimal 0,01 satuan; jumlah yang tidak diubah dari daftar sekarang tetap diterima), tanpa duplikat, satuan dari item_units, batas <= 10x resep ASLI dokter per bahan / <= 1000
--    satuan dasar untuk bahan baru; BMHP_INVALID / BMHP_LIMIT).
--  * clinic_private.owner_bmhp_sim(...): simulasi biaya dan HPP baris seperti posting (bahan keluar FIFO, hasil tindakan masuk senilai bahan
--    lalu keluar FIFO) di sub-transaksi yang selalu dibatalkan.
--  * clinic_private.owner_correct_cart_bmhp(..., p_dry) + public.clinic_owner_correct_cart_bmhp(...) + public.clinic_owner_cart_bmhp_quote(...)
--    (pratinjau baca-saja: kode yang sama di sub-transaksi yang dibatalkan) + public.clinic_owner_cart_bmhp_history(p_visit_id).
--
-- Perilaku (ditegakkan di database):
--  * HANYA OWNER aktif (dibaca sebelum DAN sesudah kunci koordinator), akses cabang, shift klinik milik Owner terbuka (aturan kasir yang sama),
--    alasan >= 5 huruf bukan-spasi (maks 500), idempoten menurut p_request_key (balasan tersimpan walau snapshot sudah bergeser; isi lain
--    dengan kunci sama = IDEMPOTENCY_CONFLICT).
--  * snapshot keranjang (clinic_read_inpatient_cashier) wajib cocok dengan keranjang saat ini (CART_STALE); hasilnya membawa snapshot BARU
--    sehingga layar lanjut tanpa muat ulang, dan snapshot lama kasir/draft jadi CART_STALE (baris keranjang ikut dalam snapshot).
--  * baris wajib: pending (belum di invoice aktif, tidak ditarik), milik kunjungan itu, bukan racikan, SUDAH ber-BMHP (menambah BMHP ke baris
--    tanpa BMHP ditolak: ROW_INVALID), kunjungan rawat inap yang belum checkout/arsip/pulang+Selesai.
--  * P03 TIDAK diubah dan tidak dilonggarkan: pratinjau dan hasil melaporkan HPP sebelum/sesudah dan apakah lantai lolos; harga di bawah HPP BARU
--    tetap ditolak kasir saat terbit.
--
-- Kunci (urutan sama dengan kasir ranap): koordinator tagihan kunjungan (di dalam inpatient_payment_quote) -> shift -> pengaturan perusahaan ->
--   idempotensi (advisory) -> kunjungan -> baris resep. Balapan dengan kasir/draft/racikan/posting diuji dengan dua sesi nyata.
--
-- MEMBACA JEJAK: layar Owner memakai clinic_owner_cart_bmhp_history; atau SQL editor:
-- BACA_JEJAK_MULAI
--   select o.created_at, p.full_name as diubah_oleh, o.item_name, o.reason, o.before_components, o.after_components, o.original_components, o.hpp_before, o.hpp_after
--   from clinic_private.owner_bmhp_cart_overrides o join public.profiles p on p.id = o.actor_id order by o.created_at desc limit 100;
-- BACA_JEJAK_SELESAI
--
-- Apply as ONE transaction (tanpa begin/commit sendiri). Tidak ada backfill.

do $guard$
begin
  if to_regclass('clinic_private.owner_bmhp_cart_overrides') is not null
     or to_regprocedure('public.clinic_owner_correct_cart_bmhp(uuid,uuid,uuid,jsonb,text,text,text)') is not null then
    raise exception 'Override BMHP keranjang Owner: objek sudah ada; periksa urutan migrasi';
  end if;
  if to_regprocedure('clinic_private.inpatient_payment_quote(uuid,uuid,jsonb)') is null
     or to_regprocedure('clinic_private.pending_cashier_rows(uuid)') is null
     or to_regprocedure('clinic_private.inpatient_cashier_snapshot(jsonb,jsonb)') is null
     or to_regprocedure('public.clinic_record_correction_immutable()') is null
     or to_regprocedure('clinic_private.job_order_complete(uuid,uuid,numeric,numeric,text,date)') is null
     or to_regprocedure('clinic_private.bmhp_issue(uuid,uuid,text,date)') is null
     or to_regprocedure('public.guard_prescription_bmhp()') is null
     or to_regclass('clinic_private.record_edit_permits') is null
     or to_regclass('public.clinic_pending_cart_edits') is null
     or to_regclass('public.prescription_items') is null then
    raise exception 'Override BMHP keranjang Owner: prasyarat tidak ditemukan';
  end if;
end $guard$;

create table clinic_private.owner_bmhp_cart_overrides (
  id uuid primary key,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references public.profiles(id),
  visit_id uuid not null references public.visits(id),
  record_id uuid not null references public.inpatient_records(id),
  medical_record_id uuid not null references public.medical_records(id),
  prescription_item_id uuid not null references public.prescription_items(id),
  item_id uuid references public.items(id),
  item_name text not null,
  reason text not null check (length(regexp_replace(btrim(reason), '\s', '', 'g')) >= 5 and length(btrim(reason)) <= 500),
  request_key text not null unique check (length(request_key) between 1 and 100),
  request_hash text not null,
  snapshot_before text not null,
  snapshot_after text not null,
  original_components jsonb not null,
  before_components jsonb not null,
  after_components jsonb not null,
  cost_before numeric(15,2),
  cost_after numeric(15,2),
  hpp_before numeric(15,2),
  hpp_after numeric(15,2),
  price numeric(15,2) not null,
  net_price numeric(15,2) not null,
  floor_applies boolean,
  price_below_hpp_before boolean,
  price_below_hpp_after boolean,
  result jsonb not null
);
create index owner_bmhp_cart_overrides_rx_idx on clinic_private.owner_bmhp_cart_overrides(prescription_item_id, created_at);
create index owner_bmhp_cart_overrides_visit_idx on clinic_private.owner_bmhp_cart_overrides(visit_id, created_at);
alter table clinic_private.owner_bmhp_cart_overrides enable row level security;
revoke all on clinic_private.owner_bmhp_cart_overrides from public, anon, authenticated, service_role;
create trigger owner_bmhp_cart_overrides_immutable before update or delete on clinic_private.owner_bmhp_cart_overrides
  for each row execute function public.clinic_record_correction_immutable();
create trigger owner_bmhp_cart_overrides_no_truncate before truncate on clinic_private.owner_bmhp_cart_overrides
  for each statement execute function public.clinic_record_correction_immutable();

-- Validasi + normalisasi daftar BMHP. Nama, satuan dasar, faktor dan base_qty selalu dari master (angka klien hanya jumlah/satuan).
-- Aturan sama dengan guard_prescription_bmhp + batas Owner. Dipakai juga oleh bagian B (baris yang sudah ditagih).
create function clinic_private.owner_bmhp_normalize(p_components jsonb, p_original jsonb, p_current jsonb, p_keep_inactive boolean)
returns jsonb language plpgsql stable set search_path = '' as $function$
declare
  c_max_multiple constant numeric := 10;      -- batas per bahan: <= 10x jumlah ASLI catatan dokter
  c_max_new constant numeric := 1000;         -- bahan yang tidak ada di resep asli: <= 1000 satuan dasar
  v_row jsonb; v_out jsonb := '[]'::jsonb; v_id uuid; v_qty numeric; v_unit text; v_item public.items%rowtype;
  v_cur jsonb; v_factor numeric; v_base numeric; v_orig numeric; v_seen uuid[] := array[]::uuid[];
begin
  if jsonb_typeof(p_components) is distinct from 'array' or jsonb_array_length(p_components) not between 1 and 50 then
    raise exception using errcode = 'P0001', message = 'BMHP_INVALID: minimal satu bahan dan maksimal 50 bahan';
  end if;
  for v_row in select value from jsonb_array_elements(p_components) loop
    begin
      if jsonb_typeof(v_row) <> 'object' then raise exception 'shape'; end if;
      v_id := nullif(v_row ->> 'item_id', '')::uuid;
      v_qty := nullif(btrim(v_row ->> 'qty'), '')::numeric;
      v_unit := nullif(btrim(v_row ->> 'unit'), '');
    exception when others then
      raise exception using errcode = 'P0001', message = 'BMHP_INVALID: bahan atau jumlah BMHP tidak valid';
    end;
    if v_id is null or v_qty is null or v_qty::text in ('NaN', 'Infinity', '-Infinity') or v_qty <= 0 or v_qty > 100000
       or v_qty <> round(v_qty, 4) or v_id = any(v_seen) then
      raise exception using errcode = 'P0001', message = 'BMHP_INVALID: bahan atau jumlah BMHP tidak valid (jumlah > 0, maksimal 4 desimal, tanpa bahan ganda)';
    end if;
    v_seen := v_seen || v_id;
    select * into v_item from public.items i where i.id = v_id and i.item_type = 'Persediaan';
    if not found then
      raise exception using errcode = 'P0001', message = 'BMHP_INVALID: BMHP harus barang persediaan yang ada di master';
    end if;
    v_cur := (select e.value from jsonb_array_elements(coalesce(p_current, '[]'::jsonb)) e where e.value ->> 'item_id' = v_id::text limit 1);
    -- Batas bawah: jumlah baru minimal 0,01 satuan bahan (0,0001 hampir menghapus modal tanpa mengeluarkan bahan). Jumlah yang TIDAK diubah
    -- dari daftar saat ini tetap diterima (daftar dokter yang sudah ada tidak boleh membuat Owner tersangkut).
    if v_qty < 0.01 and not (v_cur is not null and (v_cur ->> 'qty') ~ '^[0-9.]+$' and v_qty = (v_cur ->> 'qty')::numeric) then
      raise exception using errcode = 'P0001', message = format('BMHP_INVALID: jumlah %s kurang dari batas minimal 0,01 satuan; keluarkan bahan dari daftar bila memang tidak dipakai', v_item.name);
    end if;
    v_unit := coalesce(v_unit, v_cur ->> 'unit', v_item.unit);
    if v_unit = v_item.unit then v_factor := 1;
    else
      select iu.factor into v_factor from public.item_units iu where iu.item_id = v_id and iu.unit = v_unit;
      if v_factor is null or v_factor <= 0 then
        raise exception using errcode = 'P0001', message = format('BMHP_INVALID: satuan %s untuk %s tidak ditemukan', v_unit, v_item.name);
      end if;
    end if;
    v_base := round(v_qty * v_factor, 4);
    if v_base <= 0 then
      raise exception using errcode = 'P0001', message = format('BMHP_INVALID: jumlah %s terlalu kecil', v_item.name);
    end if;
    if not v_item.is_active and not (coalesce(p_keep_inactive, false) and v_cur is not null and v_base <= (v_cur ->> 'base_qty')::numeric) then
      raise exception using errcode = 'P0001', message = format('BMHP_INVALID: %s tidak aktif; keluarkan dari daftar atau aktifkan di master', v_item.name);
    end if;
    select sum((e.value ->> 'base_qty')::numeric) into v_orig from jsonb_array_elements(coalesce(p_original, '[]'::jsonb)) e where e.value ->> 'item_id' = v_id::text;
    if (v_orig is null and v_base > c_max_new) or (v_orig is not null and v_base > c_max_multiple * v_orig) then
      raise exception using errcode = 'P0001', message = format('BMHP_LIMIT: jumlah %s (%s) melewati batas %s %s dari resep asli dokter', v_item.name, trim_scale(v_base),
        case when v_orig is null then 'bahan baru maksimal' else '10x' end, case when v_orig is null then trim_scale(c_max_new)::text else trim_scale(v_orig)::text end);
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('item_id', v_id, 'name', v_item.name, 'qty', v_qty, 'unit', v_unit, 'factor', v_factor, 'base_qty', v_base));
  end loop;
  return v_out;
end;
$function$;
revoke all on function clinic_private.owner_bmhp_normalize(jsonb, jsonb, jsonb, boolean) from public, anon, authenticated, service_role;

-- Simulasi HPP baris seperti posting, di sub-transaksi yang SELALU dibatalkan (stok/lapisan tidak berubah): bahan keluar FIFO pada biaya
-- saat ini (bmhp_issue); baris barang persediaan (jenis 'obat', pesanan tindakan): hasil tindakan masuk senilai bahan lalu keluar FIFO
-- (job_order_complete, jadi HPP baris bisa berbeda dari biaya bahan bila ada lapisan hasil yang lebih tua); baris jasa: HPP = biaya bahan.
create function clinic_private.owner_bmhp_sim(p_warehouse uuid, p_line_item uuid, p_line_base_qty numeric, p_jenis text, p_components jsonb)
returns jsonb language plpgsql set search_path = '' as $function$
declare
  v_c jsonb; v_item public.items%rowtype; v_stock numeric; v_out record; v_cost numeric(15,2);
  v_total numeric(15,2) := 0; v_hpp numeric(15,2); v_detail text; v_parts jsonb := '[]'::jsonb;
begin
  begin
    if p_warehouse is null then
      raise exception using errcode = 'P0001', message = 'WAREHOUSE_MISSING: gudang klinik aktif tidak ditemukan';
    end if;
    for v_c in select value from jsonb_array_elements(p_components) loop
      select * into v_item from public.items i where i.id = (v_c ->> 'item_id')::uuid and i.is_active and i.item_type = 'Persediaan';
      if not found then
        raise exception using errcode = 'P0001', message = format('BMHP_INVALID: %s tidak aktif', v_c ->> 'name');
      end if;
      select s.qty into v_stock from public.stock s where s.warehouse_id = p_warehouse and s.item_id = v_item.id;
      if coalesce(v_stock, 0) < (v_c ->> 'base_qty')::numeric then
        raise exception using errcode = 'P0001', message = format('STOCK_SHORT: %s (stok %s, butuh %s)', v_item.name, trim_scale(coalesce(v_stock, 0)), trim_scale((v_c ->> 'base_qty')::numeric));
      end if;
      select * into v_out from public.stock_out_fifo(p_warehouse, v_item.id, (v_c ->> 'base_qty')::numeric, 'klinik-bmhp', 'SIMULASI', current_date);
      if v_out.shortfall > 0 or v_out.cost is null or v_out.cost <= 0 or (not public.inventory_is_average() and exists (
        select 1 from jsonb_array_elements(v_out.takes) t where (t.value ->> 'unit_cost')::numeric <= 0)) then
        raise exception using errcode = 'P0001', message = format('COST_MISSING: %s', v_item.name);
      end if;
      v_cost := round(v_out.cost, 2);
      v_total := v_total + v_cost;
      v_parts := v_parts || jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'name', v_item.name, 'base_qty', (v_c ->> 'base_qty')::numeric, 'cost', v_cost));
    end loop;
    if p_jenis = 'obat' and p_line_item is not null then
      v_hpp := clinic_private.job_order_complete(p_warehouse, p_line_item, p_line_base_qty, v_total, 'SIMULASI', current_date);
    else
      v_hpp := v_total;
    end if;
    raise exception using errcode = 'P0Z98', message = 'SIM',
      detail = jsonb_build_object('ok', true, 'cost', v_total, 'hpp', v_hpp, 'components', v_parts)::text;
  exception
    when sqlstate 'P0Z98' then
      get stacked diagnostics v_detail = pg_exception_detail;
      return v_detail::jsonb;
    when others then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
end;
$function$;
revoke all on function clinic_private.owner_bmhp_sim(uuid, uuid, numeric, text, jsonb) from public, anon, authenticated, service_role;

create function clinic_private.owner_correct_cart_bmhp(p_record_id uuid, p_visit_id uuid, p_rx_id uuid, p_components jsonb, p_reason text, p_request_key text, p_snapshot text, p_dry boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_key text := btrim(coalesce(p_request_key, ''));
  v_quote jsonb; v_shift uuid; v_visit public.visits%rowtype; v_rx public.prescription_items%rowtype;
  v_before_rows jsonb; v_after_rows jsonb; v_snapshot_after text;
  v_hash text; v_prior clinic_private.owner_bmhp_cart_overrides%rowtype;
  v_original jsonb; v_before jsonb; v_after jsonb; v_changes int;
  v_warehouse uuid; v_line_base numeric; v_sim_b jsonb; v_sim_a jsonb;
  v_net numeric; v_floor boolean; v_below_b boolean; v_below_a boolean; v_can_b boolean; v_can_a boolean;
  v_audit_id uuid := gen_random_uuid(); v_result jsonb;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('role', true), 'none'));
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  -- Cek peran SEBELUM mengambil kunci apa pun (bukan-Owner tidak boleh membuat Owner menunggu).
  if not exists (select 1 from public.profiles p where p.id = v_user and p.is_active and p.role = 'OWNER') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: mengubah BMHP baris keranjang hanya untuk Owner';
  end if;
  if not p_dry and (length(regexp_replace(v_reason, '\s', '', 'g')) < 5 or length(v_reason) > 500) then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED: alasan perubahan wajib diisi (minimal 5 huruf, maksimal 500)';
  end if;
  if not p_dry and (v_key = '' or length(v_key) > 100) then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED: kunci permintaan wajib diisi (1-100 karakter)';
  end if;

  -- Koordinator tagihan kunjungan + peran/cabang/rawat inap/shift kasir (kode yang sama dengan kasir ranap), SEBELUM kunci baris apa pun.
  v_quote := clinic_private.inpatient_payment_quote(p_record_id, p_visit_id, '[]'::jsonb);
  if not exists (select 1 from public.profiles p where p.id = v_user and p.is_active and p.role = 'OWNER') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: mengubah BMHP baris keranjang hanya untuk Owner';
  end if;
  v_shift := (v_quote ->> 'shift_id')::uuid;
  perform 1 from public.cashier_shifts s where s.id = v_shift for update;
  perform 1 from public.company_settings cs where cs.id = true for share;
  v_quote := clinic_private.inpatient_payment_quote(p_record_id, p_visit_id, '[]'::jsonb);
  if v_shift is distinct from (v_quote ->> 'shift_id')::uuid then
    raise exception using errcode = 'P0001', message = 'SHIFT_INVALID: shift berubah; muat ulang';
  end if;

  -- Idempoten: kunci yang sama dan isi yang sama mengembalikan hasil tersimpan; isi beda ditolak (sebelum cek snapshot, seperti kasir).
  v_hash := md5(jsonb_build_array(p_record_id::text, p_visit_id::text, p_rx_id::text, v_reason, (
    select coalesce(jsonb_agg(jsonb_build_array(t.item_id, t.qty, t.unit) order by t.item_id), '[]'::jsonb) from (
      select e.value ->> 'item_id' as item_id, e.value ->> 'qty' as qty, e.value ->> 'unit' as unit
      from jsonb_array_elements(case when jsonb_typeof(p_components) = 'array' then p_components else '[]'::jsonb end) e) t))::text);
  if not p_dry then
    perform pg_advisory_xact_lock(hashtextextended('owner-bmhp-cart:' || v_key, 0));
    select * into v_prior from clinic_private.owner_bmhp_cart_overrides o where o.request_key = v_key;
    if found then
      if v_prior.actor_id is distinct from v_user or v_prior.prescription_item_id is distinct from p_rx_id or v_prior.request_hash is distinct from v_hash then
        raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci permintaan sudah dipakai untuk perubahan yang berbeda';
      end if;
      return v_prior.result || jsonb_build_object('replayed', true);
    end if;
  end if;

  select * into v_visit from public.visits v where v.id = p_visit_id for update;
  if v_visit.checked_out_at is not null or v_visit.archived_at is not null
     or (v_visit.status = 'Selesai' and not exists (select 1 from public.inpatient_records ir where ir.visit_id = p_visit_id and ir.discharged_at is null)) then
    raise exception using errcode = 'P0001', message = 'VISIT_CLOSED: kunjungan sudah selesai/checkout, BMHP baris keranjang tidak bisa diubah lagi';
  end if;
  v_before_rows := clinic_private.pending_cashier_rows(p_visit_id);
  if nullif(p_snapshot, '') is null or p_snapshot is distinct from clinic_private.inpatient_cashier_snapshot(v_before_rows, v_quote) then
    raise exception using errcode = 'P0001', message = 'CART_STALE: keranjang berubah; muat ulang dan periksa ulang sebelum mengubah BMHP';
  end if;

  select pi.* into v_rx from public.prescription_items pi join public.medical_records mr on mr.id = pi.medical_record_id
  where pi.id = p_rx_id and mr.visit_id = p_visit_id for update of pi;
  if not found or not exists (select 1 from jsonb_array_elements(v_before_rows) e where e.value ->> 'id' = p_rx_id::text) then
    raise exception using errcode = 'P0001', message = 'ROW_INVALID: baris tidak ditemukan di keranjang pending kunjungan ini (mungkin sudah ditagih atau ditarik)';
  end if;
  if v_rx.compound_recipe_id is not null then
    raise exception using errcode = 'P0001', message = 'ROW_INVALID: baris racikan dikoreksi lewat koreksi racikan Owner, bukan BMHP';
  end if;
  if v_rx.bmhp_components is null or v_rx.item_id is null then
    raise exception using errcode = 'P0001', message = 'ROW_INVALID: baris ini tidak punya BMHP tercatat; BMHP tidak bisa ditambahkan ke baris tanpa BMHP dari sini';
  end if;

  v_before := v_rx.bmhp_components;
  v_original := coalesce((select o.original_components from clinic_private.owner_bmhp_cart_overrides o where o.prescription_item_id = p_rx_id order by o.created_at desc, o.id desc limit 1), v_before);
  v_after := clinic_private.owner_bmhp_normalize(p_components, v_original, v_before, false);
  select count(*) into v_changes from (
    (select t.item_id, t.qty, t.unit from jsonb_to_recordset(v_before) as t(item_id uuid, qty numeric, unit text)
     except select t.item_id, t.qty, t.unit from jsonb_to_recordset(v_after) as t(item_id uuid, qty numeric, unit text))
    union all
    (select t.item_id, t.qty, t.unit from jsonb_to_recordset(v_after) as t(item_id uuid, qty numeric, unit text)
     except select t.item_id, t.qty, t.unit from jsonb_to_recordset(v_before) as t(item_id uuid, qty numeric, unit text))) d;
  if v_changes = 0 then
    raise exception using errcode = 'P0001', message = 'NO_CHANGE: daftar BMHP sama dengan yang sekarang, tidak ada yang diubah';
  end if;

  -- Biaya dan HPP baris seperti posting, sebelum dan sesudah (stok tidak berubah: sub-transaksi dibatalkan).
  select w.id into v_warehouse from public.warehouses w where w.branch_id = v_visit.branch_id and w.type = 'VET' and w.is_active order by w.created_at, w.id limit 1;
  v_line_base := v_rx.qty * coalesce(v_rx.faktor, 1);
  v_sim_b := clinic_private.owner_bmhp_sim(v_warehouse, v_rx.item_id, v_line_base, v_rx.jenis, v_before);
  v_sim_a := clinic_private.owner_bmhp_sim(v_warehouse, v_rx.item_id, v_line_base, v_rx.jenis, v_after);
  -- Lantai P03 (assert_invoice_price_floor): baris jenis 'obat' bertaut barang, di luar paket, harga neto (tahap tanpa diskon) >= HPP. Jasa bebas.
  v_net := round(v_rx.qty * v_rx.harga, 2);
  v_floor := v_rx.jenis = 'obat' and v_rx.item_id is not null and v_rx.package_item_id is null;
  v_below_b := v_floor and coalesce((v_sim_b ->> 'ok')::boolean, false) and (v_net <= 0 or v_net < (v_sim_b ->> 'hpp')::numeric);
  v_below_a := v_floor and coalesce((v_sim_a ->> 'ok')::boolean, false) and (v_net <= 0 or v_net < (v_sim_a ->> 'hpp')::numeric);
  v_can_b := coalesce((v_sim_b ->> 'ok')::boolean, false) and not coalesce(v_below_b, false);
  v_can_a := coalesce((v_sim_a ->> 'ok')::boolean, false) and not coalesce(v_below_a, false);

  -- Tulis daftar baru lewat izin satu-transaksi (pola kasir ranap): guard_prescription_bmhp menormalisasi ulang dari master.
  insert into clinic_private.record_edit_permits values (txid_current(), v_user, p_visit_id);
  update public.prescription_items set bmhp_components = v_after where id = p_rx_id;
  delete from clinic_private.record_edit_permits where transaction_id = txid_current();
  if (select pi.bmhp_components from public.prescription_items pi where pi.id = p_rx_id) is distinct from v_after then
    raise exception using errcode = 'P0001', message = 'BMHP_INVALID: daftar BMHP tidak tersimpan seperti yang divalidasi';
  end if;
  v_after_rows := clinic_private.pending_cashier_rows(p_visit_id);
  v_snapshot_after := clinic_private.inpatient_cashier_snapshot(v_after_rows, clinic_private.inpatient_payment_quote(p_record_id, p_visit_id, '[]'::jsonb));

  v_result := jsonb_build_object('status', 'OK', 'visit_id', p_visit_id, 'prescription_item_id', p_rx_id, 'item_id', v_rx.item_id, 'item_name', v_rx.nama_obat,
    'jenis', v_rx.jenis, 'qty', v_rx.qty, 'price', v_rx.harga, 'net_price', v_net, 'floor_applies', v_floor,
    'before', v_before, 'after', v_after, 'original', v_original,
    'cost_before', v_sim_b -> 'cost', 'cost_after', v_sim_a -> 'cost', 'hpp_before', v_sim_b -> 'hpp', 'hpp_after', v_sim_a -> 'hpp',
    'price_below_hpp_before', v_below_b, 'price_below_hpp_after', v_below_a, 'can_post_before', v_can_b, 'can_post_after', v_can_a,
    'sim_error_before', v_sim_b -> 'error', 'sim_error_after', v_sim_a -> 'error', 'snapshot_after', v_snapshot_after, 'audit_id', v_audit_id);
  if p_dry then
    -- Pratinjau: seluruh efek di atas dibatalkan oleh pemanggil (sub-transaksi); hasilnya dibawa lewat DETAIL.
    raise exception using errcode = 'P0Z99', message = 'QUOTE', detail = v_result::text;
  end if;
  insert into clinic_private.owner_bmhp_cart_overrides (id, actor_id, visit_id, record_id, medical_record_id, prescription_item_id, item_id, item_name, reason, request_key, request_hash,
    snapshot_before, snapshot_after, original_components, before_components, after_components, cost_before, cost_after, hpp_before, hpp_after, price, net_price, floor_applies,
    price_below_hpp_before, price_below_hpp_after, result)
  values (v_audit_id, v_user, p_visit_id, p_record_id, v_rx.medical_record_id, p_rx_id, v_rx.item_id, v_rx.nama_obat, v_reason, v_key, v_hash,
    p_snapshot, v_snapshot_after, v_original, v_before, v_after, (v_sim_b ->> 'cost')::numeric, (v_sim_a ->> 'cost')::numeric, (v_sim_b ->> 'hpp')::numeric, (v_sim_a ->> 'hpp')::numeric,
    v_rx.harga, v_net, v_floor, v_below_b, v_below_a, v_result);
  insert into public.clinic_pending_cart_edits (visit_id, created_by, reason, before_rows, after_rows, request_key)
  values (p_visit_id, v_user, 'BMHP diubah Owner: ' || v_reason, v_before_rows, v_after_rows, 'bmhp:' || v_key);
  return v_result;
end;
$function$;
revoke all on function clinic_private.owner_correct_cart_bmhp(uuid, uuid, uuid, jsonb, text, text, text, boolean) from public, anon, authenticated, service_role;

create function public.clinic_owner_correct_cart_bmhp(p_record_id uuid, p_visit_id uuid, p_prescription_item_id uuid, p_components jsonb, p_reason text, p_request_key text, p_snapshot text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
begin
  return clinic_private.owner_correct_cart_bmhp(p_record_id, p_visit_id, p_prescription_item_id, p_components, p_reason, p_request_key, p_snapshot, false);
end;
$function$;
revoke all on function public.clinic_owner_correct_cart_bmhp(uuid, uuid, uuid, jsonb, text, text, text) from public, anon, service_role;
grant execute on function public.clinic_owner_correct_cart_bmhp(uuid, uuid, uuid, jsonb, text, text, text) to authenticated;

create function public.clinic_owner_cart_bmhp_quote(p_record_id uuid, p_visit_id uuid, p_prescription_item_id uuid, p_components jsonb, p_snapshot text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
declare v_detail text;
begin
  begin
    perform clinic_private.owner_correct_cart_bmhp(p_record_id, p_visit_id, p_prescription_item_id, p_components, null, null, p_snapshot, true);
  exception when sqlstate 'P0Z99' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return v_detail::jsonb;
  end;
  raise exception using errcode = 'P0001', message = 'BMHP_INVALID: pratinjau tidak menghasilkan hasil';
end;
$function$;
revoke all on function public.clinic_owner_cart_bmhp_quote(uuid, uuid, uuid, jsonb, text) from public, anon, service_role;
grant execute on function public.clinic_owner_cart_bmhp_quote(uuid, uuid, uuid, jsonb, text) to authenticated;

-- Riwayat untuk layar Owner (jejak tambah-saja tidak punya hak aplikasi; pembacaan lewat fungsi ini, hanya Owner cabang kunjungan).
create function public.clinic_owner_cart_bmhp_history(p_visit_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role = 'OWNER')
     or not exists (select 1 from public.visits v where v.id = p_visit_id and public.user_can_access_branch(v.branch_id)) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: riwayat perubahan BMHP hanya untuk Owner cabang kunjungan';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'created_at', o.created_at, 'actor_name', p.full_name, 'prescription_item_id', o.prescription_item_id,
      'item_name', o.item_name, 'reason', o.reason, 'before_components', o.before_components, 'after_components', o.after_components, 'original_components', o.original_components,
      'hpp_before', o.hpp_before, 'hpp_after', o.hpp_after, 'price', o.price) order by o.created_at desc, o.id desc)
    from clinic_private.owner_bmhp_cart_overrides o join public.profiles p on p.id = o.actor_id where o.visit_id = p_visit_id), '[]'::jsonb);
end;
$function$;
revoke all on function public.clinic_owner_cart_bmhp_history(uuid) from public, anon, service_role;
grant execute on function public.clinic_owner_cart_bmhp_history(uuid) to authenticated;

do $check$
declare d text;
begin
  d := pg_get_functiondef('clinic_private.owner_correct_cart_bmhp(uuid,uuid,uuid,jsonb,text,text,text,boolean)'::regprocedure);
  if position('inpatient_payment_quote' in d) = 0 or position('p.role = ''OWNER''' in d) = 0 or position('owner_bmhp_cart_overrides' in d) = 0
     or position('record_edit_permits' in d) = 0 or position('inpatient_cashier_snapshot' in d) = 0 or position('CART_STALE' in d) = 0
     or position('stock_in_fifo' in d) > 0 or position('stock_out_fifo' in d) > 0 or position('clinic_write_journal' in d) > 0
     or position('update public.invoices' in d) > 0 or position('invoice_items' in d) > 0 then
    raise exception 'Override BMHP keranjang Owner: definisi tidak sesuai setelah dipasang';
  end if;
end $check$;
