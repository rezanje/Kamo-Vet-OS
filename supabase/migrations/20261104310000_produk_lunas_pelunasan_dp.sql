-- Agen C (klinik): pembelian produk saja wajib lunas + pelunasan DP lama oleh kasir klinik.
--
-- 1) PRODUK SAJA WAJIB LUNAS — ditegakkan di writer asli `public.clinic_post_invoice`,
--    bukan hanya di tombol. Klasifikasi SEMPIT dari data alur yang tersimpan, bukan dari
--    Jenis Barang, nama layanan atau poli saja (Tindakan klinik sengaja ada yang
--    berjenis Persediaan). Sebuah tagihan disebut "pembelian produk saja" hanya bila:
--      * kunjungannya TIDAK punya rekam medis (tidak ada pemeriksaan dokter tersimpan)
--        dan TIDAK punya rawat inap, dan poli kunjungan bukan 'Vaksinasi';
--      * minimal satu baris adalah produk ritel: jenis 'obat', dari master barang
--        berjenis Persediaan, bukan master Tindakan (tindakan_kategori kosong dan tidak
--        berada di pohon kategori TINDAKAN), tidak tertaut resep/racikan, tanpa BMHP;
--      * semua baris lain hanya baris "Jasa Konsultasi" otomatis bernilai Rp 0 tanpa
--        master (isian bawaan layar Pembayaran untuk kunjungan tanpa rekam medis).
--    Baris jasa bernilai, Tindakan, racikan, resep dokter, barang bebas tanpa master,
--    barang Non-Persediaan atau paket jasa membuat tagihan TIDAK diklasifikasikan
--    produk saja — DP tetap boleh seperti sebelumnya.
--    Penjaga hanya berjalan pada posting biasa (tanpa konteks privat). Checkout campuran
--    (konteks 'split'), DEMO dan tahap rawat inap tidak diubah: checkout campuran membuat
--    invoice sementara Belum Lunas lalu langsung melunasinya di transaksi yang sama.
--    DP lalu Rawat Inap (#345) tetap sah: rawat inap selalu mensyaratkan rekam medis.
--    Invoice lama tidak diubah; replay kunci lama tetap mengembalikan invoice yang sama.
--
-- 2) PELUNASAN DP LAMA — pembungkus publik tipis `clinic_settle_outpatient_invoice`
--    di atas writer kwitansi ASLI `public.clinic_receive_visit_payment` (shift/laci
--    kasir sendiri, rekening metode->cabang, jurnal kas/bank vs piutang 1201,
--    idempotensi kwitansi). Pembungkus hanya menambah: akses modul klinik, tagihan rawat
--    jalan milik kunjungan yang sama, tidak batal/lunas/koreksi tertunda/tahap ranap,
--    dan sisa yang dilihat kasir harus sama dengan sisa di bawah kunci koordinator yang
--    sama (#343) serta uang baru tidak boleh melebihi sisa. Tidak ada invoice pengganti,
--    stok/HPP tidak disentuh, kelebihan tidak pernah menjadi saldo pemilik diam-diam.
--
-- Forward-only, exact-anchor patch yang gagal bila definisi berubah (drift).

create function clinic_private.invoice_product_only(p_invoice_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
    from public.invoices i
    join public.visits v on v.id = i.visit_id
    where i.id = p_invoice_id
      and v.poli is distinct from 'Vaksinasi'
      and not exists (select 1 from public.medical_records m where m.visit_id = v.id)
      and not exists (select 1 from public.inpatient_records r where r.visit_id = v.id)
      and exists (
        select 1 from public.invoice_items ii
        join public.items it on it.id = ii.item_id
        where ii.invoice_id = i.id
          and ii.jenis = 'obat' and ii.prescription_item_id is null
          and ii.compound_recipe_id is null and ii.bmhp_components is null
          and it.item_type = 'Persediaan' and it.tindakan_kategori is null
          and not clinic_private.item_under_tindakan(it.id))
      and not exists (
        select 1 from public.invoice_items ii
        left join public.items it on it.id = ii.item_id
        where ii.invoice_id = i.id
          -- NULL dihitung "bukan produk": baris yang tidak bisa dipastikan produk ritel
          -- membuat tagihan TIDAK diklasifikasikan produk saja.
          and not coalesce(
            -- produk ritel
            (ii.jenis = 'obat' and ii.item_id is not null and ii.prescription_item_id is null
              and ii.compound_recipe_id is null and ii.bmhp_components is null
              and it.item_type = 'Persediaan' and it.tindakan_kategori is null
              and not clinic_private.item_under_tindakan(it.id))
            -- baris "Jasa Konsultasi" otomatis Rp 0 tanpa master
            or (ii.jenis = 'jasa' and ii.item_id is null and ii.prescription_item_id is null
              and ii.compound_recipe_id is null and ii.harga = 0), false))
  );
$$;
revoke all on function clinic_private.invoice_product_only(uuid) from public, anon, authenticated, service_role;

create function clinic_private.enforce_product_only_paid(p_invoice_id uuid) returns void
language plpgsql set search_path = '' as $$
declare v_invoice public.invoices%rowtype;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found or v_invoice.paid_status = 'Lunas'
     or v_invoice.total <= clinic_private.invoice_received(p_invoice_id) then
    return;
  end if;
  if clinic_private.invoice_product_only(p_invoice_id) then
    raise exception using errcode = 'P0001',
      message = 'PRODUCT_ONLY_FULL_PAYMENT: pembelian produk saja wajib dibayar lunas';
  end if;
end $$;
revoke all on function clinic_private.enforce_product_only_paid(uuid) from public, anon, authenticated, service_role;

do $patch$
declare
  v_def text := pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure);
  v_anchor text := E'  if not clinic_private.dp_deferred(p_visit_id) then\n'
    || E'    perform clinic_private.enforce_min_dp(v_invoice_id, p_invoice ->> ''dp_override_reason'');\n'
    || E'  end if;\n';
  v_guard text := E'  -- PRODUCT_ONLY_FULL_PAYMENT_BEGIN (20261104310000): produk saja wajib lunas pada\n'
    || E'  -- posting biasa. Checkout campuran/DEMO/tahap rawat inap memakai konteks privat.\n'
    || E'  if clinic_private.posting_context(p_visit_id) is null then\n'
    || E'    perform clinic_private.enforce_product_only_paid(v_invoice_id);\n'
    || E'  end if;\n'
    || E'  -- PRODUCT_ONLY_FULL_PAYMENT_END\n';
begin
  if position('PRODUCT_ONLY_FULL_PAYMENT' in v_def) > 0 then
    raise exception 'clinic_post_invoice sudah memuat penjaga produk saja';
  end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'clinic_post_invoice berubah: jangkar uang muka minimal tidak ditemukan tepat sekali';
  end if;
  execute replace(v_def, v_anchor, v_guard || v_anchor);
  if position('PRODUCT_ONLY_FULL_PAYMENT_BEGIN' in
      pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure)) = 0 then
    raise exception 'penjaga produk saja gagal dipasang';
  end if;
end
$patch$;

create function public.clinic_settle_outpatient_invoice(
  p_visit_id uuid, p_invoice_id uuid, p_request_key text, p_parts jsonb, p_expected_remaining numeric
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_key text := nullif(btrim(p_request_key), '');
  v_visit public.visits%rowtype;
  v_invoice public.invoices%rowtype;
  v_existing public.clinic_payment_receipts%rowtype;
  v_part jsonb;
  v_amount numeric;
  v_sum numeric := 0;
  v_remaining numeric(15,2);
begin
  if coalesce(auth.role(), '') <> 'authenticated' or v_user is null
     or not public.inpatient_clinic_module_access() then
    raise exception using errcode = 'P0001',
      message = 'ACCESS_DENIED: pengguna tidak aktif atau tidak memiliki akses kasir klinik';
  end if;
  if v_key is null or length(v_key) > 100 then
    raise exception using errcode = 'P0001', message = 'PAYMENT_INVALID: kunci pelunasan tidak valid';
  end if;
  select * into v_visit from public.visits where id = p_visit_id;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: kunjungan atau cabang tidak dapat diakses';
  end if;

  -- Urutan kunci sama dengan writer kwitansi asli: koordinator, kunci kwitansi, kunjungan.
  perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));
  perform pg_advisory_xact_lock(hashtextextended('clinic-receipt:' || v_key, 0));
  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: kunjungan atau cabang tidak dapat diakses';
  end if;

  -- Ulangan permintaan yang sama: writer asli memeriksa cabang, laci kasir dan sidik
  -- permintaannya lalu mengembalikan kwitansi yang sudah ada tanpa uang baru.
  select * into v_existing from public.clinic_payment_receipts where request_key = v_key;
  if found then
    if v_existing.visit_id is distinct from p_visit_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci pelunasan dipakai untuk data berbeda';
    end if;
    return public.clinic_receive_visit_payment(p_visit_id, v_key, v_existing.tanggal, p_parts, p_invoice_id, null);
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found or v_invoice.visit_id is distinct from p_visit_id then
    raise exception using errcode = 'P0001', message = 'SETTLE_INVALID: tagihan tidak ditemukan pada kunjungan ini';
  end if;
  if v_invoice.voided_at is not null then
    raise exception using errcode = 'P0001', message = 'SETTLE_INVALID: tagihan sudah dibatalkan';
  end if;
  if v_invoice.stage_billing or exists (select 1 from public.inpatient_records r where r.visit_id = p_visit_id) then
    raise exception using errcode = 'P0001',
      message = 'STAGE_RECEIPT: terima uang rawat inap lewat layar Tagihan rawat inap';
  end if;
  if v_invoice.correction_pending then
    raise exception using errcode = 'P0001', message = 'SETTLE_INVALID: selesaikan koreksi tagihan lebih dulu';
  end if;
  if v_invoice.paid_status = 'Lunas' then
    raise exception using errcode = 'P0001', message = 'SETTLE_INVALID: tagihan sudah lunas';
  end if;
  if v_invoice.invoice_no is null or v_invoice.request_key is null then
    raise exception using errcode = 'P0001', message = 'SETTLE_INVALID: tagihan belum selesai tersimpan';
  end if;

  if jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts) not between 1 and 6 then
    raise exception using errcode = 'P0001', message = 'PAYMENT_INVALID: isi satu sampai enam bagian pembayaran';
  end if;
  for v_part in select value from jsonb_array_elements(p_parts) loop
    if jsonb_typeof(v_part) is distinct from 'object'
       or jsonb_typeof(v_part -> 'amount') is distinct from 'number'
       or coalesce(v_part ->> 'method', '') not in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') then
      raise exception using errcode = 'P0001', message = 'PAYMENT_INVALID: metode atau nominal pembayaran tidak valid';
    end if;
    v_amount := (v_part ->> 'amount')::numeric;
    if v_amount <= 0 or v_amount <> trunc(v_amount) or v_amount > 9007199254740991 then
      raise exception using errcode = 'P0001', message = 'PAYMENT_INVALID: nominal pembayaran harus rupiah bulat positif';
    end if;
    v_sum := v_sum + v_amount;
  end loop;

  v_remaining := (v_invoice.total - clinic_private.invoice_received(p_invoice_id))::numeric(15,2);
  if v_remaining <= 0 then
    raise exception using errcode = 'P0001', message = 'SETTLE_INVALID: tagihan sudah lunas';
  end if;
  if p_expected_remaining is null or p_expected_remaining <> v_remaining then
    raise exception using errcode = 'P0001', message = format(
      'REMAINING_CHANGED: sisa tagihan sekarang Rp %s', trim(to_char(v_remaining, 'FM999999999990')));
  end if;
  if v_sum > v_remaining then
    raise exception using errcode = 'P0001', message = 'PAYMENT_INVALID: pelunasan melebihi sisa tagihan';
  end if;

  -- Writer asli: laci shift kasir sendiri, rekening metode->cabang, jurnal kas/bank
  -- vs piutang pada nomor invoice yang SAMA, status bayar dihitung ulang.
  return public.clinic_receive_visit_payment(
    p_visit_id, v_key, (now() at time zone 'Asia/Jakarta')::date, p_parts, p_invoice_id, null);
end $$;
revoke all on function public.clinic_settle_outpatient_invoice(uuid, uuid, text, jsonb, numeric)
  from public, anon, service_role;
grant execute on function public.clinic_settle_outpatient_invoice(uuid, uuid, text, jsonb, numeric) to authenticated;
