-- Laporan Operation & Sales: data mentah tiap bagian dibaca di database dalam SATU panggilan, bukan ratusan query berhalaman.
--
-- Masalah (diukur di Production 25 Nov 2026): halaman /laporan/operasional-penjualan menghitung 8 blok (sales, cabang,
-- pelanggan, stok, pembelian, klinik, perbandingan cabang, nilai stok). Semua bacaan memakai halaman 500 baris, tiap halaman
-- dengan hitungan pasti, lewat RLS (`user_can_access_branch` dijalankan per baris), dan hampir semuanya berurutan:
-- riwayat penjualan pelanggan (±10.600 baris) = 22 halaman berurutan, stok + mutasi stok + barang = ±50 halaman,
-- dokumen penjualan bulan ini dan bulan lalu masing-masing ±58 query (struk, item, retur per 100 id, invoice, refund per 100 id),
-- nilai stok = 3 query x 29 gudang. Bulan berjalan semua cabang = ±350 query. Karena pembacaan lama, data yang berubah di antara
-- dua halaman juga memunculkan blok galat acak ("Data laporan berubah atau terpotong").
--
-- Perubahan: satu fungsi baca-saja `public.laporan_operasional_penjualan(p_bagian, ...)` yang mengembalikan baris mentah YANG SAMA
-- (kolom, nilai, urutan id) untuk satu bagian per panggilan. Perhitungan angka tetap dikerjakan kode aplikasi yang sama seperti
-- sebelumnya; fungsi hanya mengganti cara membaca. Bagian: dokumen (struk kasir + retur, invoice klinik + refund, faktur reseller),
-- grooming, pelanggan, stok, klinik, nilai_stok.
--
-- Hak baca SAMA dengan RLS (cermin kebijakan tabel yang dibaca pembaca lama):
--   * Admin Online ditolak (deny_admin_online); anon tidak punya hak eksekusi; hanya authenticated;
--   * cabang: `public.user_can_access_branch` dicek SEKALI per cabang (bukan per baris) dan hanya cabang yang diminta pemanggil
--     (p_cabang) yang dibaca; user_can_access_branch sendiri yang menentukan peran, cabang pengguna, profil aktif, dan header
--     cabang operasional;
--   * sales/sale_items/sales_returns: cabang struk boleh diakses (operational_branch_isolation + kebijakan anak);
--   * invoices/invoice_items: cabang kunjungan boleh diakses; clinic_refunds: user_can_access_branch(clinic_refunds.branch_id);
--   * sales_invoices + item: cabang boleh diakses DAN profil pemanggil aktif (si_all_read / sii_all_read);
--   * gudang, stok: cabang gudang boleh diakses; lapisan dan mutasi stok terbuka (slay_all/smov_all) tetapi hanya gudang yang
--     terbaca yang diambil;
--   * visit_referrals / inpatient_records: cabang boleh diakses DAN kunjungan induk terlihat (operational_parent_isolation +
--     kebijakan visits, termasuk kunjungan impor tanpa cabang);
--   * bookings, follow_ups, branch_capacity_periods, visits: cabang boleh diakses.
-- Tidak ada tabel, kebijakan, indeks, atau data yang diubah. Aplikasi tetap berjalan sebelum migrasi ini dipasang: bila fungsi
-- belum ada atau melewati batas waktu, pembaca lama dipakai.

create or replace function public.laporan_operasional_penjualan(
  p_bagian text,
  p_mulai timestamptz,
  p_akhir timestamptz,
  p_dari date,
  p_sampai date,
  p_cabang uuid[],
  p_kanal text default 'all',
  p_rata_rata boolean default false
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_semua uuid[];
  v_boleh uuid[];
  v_null_ok boolean;
  v_legacy_ok boolean;
  v_dok_ok boolean;
  v_aktif boolean;
  v_kanal text := coalesce(p_kanal, 'all');
  v_hasil jsonb;
  v_a jsonb; v_b jsonb; v_c jsonb; v_d jsonb; v_e jsonb; v_f jsonb;
begin
  perform admin_online_private.deny_admin_online();
  if p_bagian is null or p_bagian not in ('dokumen', 'grooming', 'pelanggan', 'stok', 'klinik', 'nilai_stok') then
    raise exception 'LAPORAN_OPERASIONAL_BAGIAN: bagian tidak dikenal' using errcode = '22023';
  end if;
  if p_mulai is null or p_akhir is null or p_dari is null or p_sampai is null then
    raise exception 'LAPORAN_OPERASIONAL_PERIODE: tanggal awal dan akhir wajib diisi' using errcode = '22023';
  end if;

  -- Cabang yang boleh dilihat pemanggil: sekali per cabang, logika persis RLS (user_can_access_branch).
  select coalesce(array_agg(b.id), '{}'::uuid[]) into v_semua
  from public.branches b
  where public.user_can_access_branch(b.id);
  select coalesce(array_agg(x), '{}'::uuid[]) into v_boleh
  from unnest(v_semua) x
  where x = any (coalesce(p_cabang, '{}'::uuid[]));
  -- Baris tanpa cabang: kebijakan asli memanggil user_can_access_branch(null); jawabannya sama untuk semua baris.
  v_null_ok := coalesce(public.user_can_access_branch(null::uuid), false);

  if p_bagian = 'dokumen' then
    -- Struk kasir (+ retur), invoice klinik (+ refund), faktur reseller: aturan kanal sama dengan loadSalesDocuments.
    if v_kanal not in ('klinik', 'reseller') then
      with s as materialized (
        select x.id, x.branch_id, x.customer_id, x.total, x.merchant_fee_total, x.channel, x.created_at,
               x.payment_plan, x.payments_finalized_at, x.voided_at
        from public.sales x
        where x.branch_id = any (v_boleh)
          and x.created_at >= p_mulai and x.created_at <= p_akhir
          and case when v_kanal = 'pos' then x.channel is null when v_kanal = 'online' then x.channel is not null else true end
      )
      select
        (select coalesce(jsonb_agg(jsonb_build_object(
            'id', s.id, 'branch_id', s.branch_id, 'customer_id', s.customer_id, 'total', s.total,
            'merchant_fee_total', s.merchant_fee_total, 'channel', s.channel, 'created_at', s.created_at,
            'payment_plan', s.payment_plan, 'payments_finalized_at', s.payments_finalized_at, 'voided_at', s.voided_at,
            'sale_items', coalesce((
              select jsonb_agg(jsonb_build_object(
                'item_id', si.item_id, 'qty', si.qty, 'hpp', si.hpp, 'harga', si.harga,
                'items', case when it.id is null then null else jsonb_build_object('item_type', it.item_type, 'tindakan_kategori', it.tindakan_kategori) end
              ) order by si.ctid)
              from public.sale_items si
              left join public.items it on it.id = si.item_id
              where si.sale_id = s.id), '[]'::jsonb)
          ) order by s.id), '[]'::jsonb) from s),
        -- Retur dibaca hanya untuk struk yang selesai (aturan isCompletedSale), tanpa batas tanggal retur, retur batal dibuang.
        (select coalesce(jsonb_agg(jsonb_build_object('sale_id', r.sale_id, 'total', r.total) order by r.id), '[]'::jsonb)
         from public.sales_returns r
         where r.voided_at is null
           and r.sale_id in (select s2.id from s s2
                             where s2.voided_at is null
                               and (s2.payment_plan is null or jsonb_typeof(s2.payment_plan) = 'null' or s2.payments_finalized_at is not null)))
      into v_a, v_b;
    else
      v_a := '[]'::jsonb; v_b := '[]'::jsonb;
    end if;

    if v_kanal not in ('pos', 'online', 'reseller') then
      with iv as materialized (
        select i.id, i.visit_id, i.total, i.created_at, i.voided_at, v.branch_id as v_branch_id, v.customer_id as v_customer_id
        from public.invoices i
        join public.visits v on v.id = i.visit_id
        where v.branch_id = any (v_boleh)
          and i.voided_at is null
          and i.created_at >= p_mulai and i.created_at <= p_akhir
      )
      select
        (select coalesce(jsonb_agg(jsonb_build_object(
            'id', iv.id, 'visit_id', iv.visit_id, 'total', iv.total, 'created_at', iv.created_at, 'voided_at', iv.voided_at,
            'visits', jsonb_build_object('branch_id', iv.v_branch_id, 'customer_id', iv.v_customer_id),
            'invoice_items', coalesce((
              select jsonb_agg(jsonb_build_object(
                'item_id', x.item_id, 'qty', x.qty, 'hpp', x.hpp, 'harga', x.harga, 'jenis', x.jenis
              ) order by x.ctid)
              from public.invoice_items x
              where x.invoice_id = iv.id), '[]'::jsonb)
          ) order by iv.id), '[]'::jsonb) from iv),
        -- Refund klinik: tanpa batas tanggal refund, hanya yang cabang refundnya boleh diakses (clinic_refunds_branch_read).
        (select coalesce(jsonb_agg(jsonb_build_object('invoice_id', r.invoice_id, 'total', r.total) order by r.id), '[]'::jsonb)
         from public.clinic_refunds r
         where r.invoice_id in (select iv2.id from iv iv2)
           and (r.branch_id = any (v_semua) or (r.branch_id is null and v_null_ok)))
      into v_c, v_d;
    else
      v_c := '[]'::jsonb; v_d := '[]'::jsonb;
    end if;

    if v_kanal in ('all', 'reseller') then
      -- Faktur reseller: kebijakan si_all_read/sii_all_read mewajibkan profil pemanggil aktif.
      v_aktif := exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_active is true);
      if v_aktif then
        select coalesce(jsonb_agg(jsonb_build_object(
            'id', q.id, 'branch_id', q.branch_id, 'customer_id', q.customer_id, 'dpp', q.dpp, 'tanggal', q.tanggal, 'status', q.status,
            'sales_invoice_items', coalesce((
              select jsonb_agg(jsonb_build_object('item_id', x.item_id, 'qty', x.qty, 'harga', x.harga) order by x.ctid)
              from public.sales_invoice_items x
              where x.invoice_id = q.id), '[]'::jsonb)
          ) order by q.id), '[]'::jsonb)
        into v_e
        from public.sales_invoices q
        where q.branch_id = any (v_boleh)
          and q.status <> 'batal'
          and q.opening_batch_id is null
          and q.tanggal >= p_dari and q.tanggal <= p_sampai;
      else
        v_e := '[]'::jsonb;
      end if;
    else
      v_e := '[]'::jsonb;
    end if;

    return jsonb_build_object(
      'n_sales', jsonb_array_length(v_a), 'n_retur', jsonb_array_length(v_b),
      'n_invoice', jsonb_array_length(v_c), 'n_refund', jsonb_array_length(v_d), 'n_reseller', jsonb_array_length(v_e),
      'sales', v_a, 'returns', v_b, 'invoices', v_c, 'refunds', v_d, 'reseller', v_e);

  elsif p_bagian = 'grooming' then
    -- Kunjungan poli grooming (semua status, tanpa yang diarsipkan) + layanan grooming dari kasir (struk batal dibuang).
    select coalesce(jsonb_agg(jsonb_build_array(v.branch_id) order by v.id), '[]'::jsonb) into v_a
    from public.visits v
    where v.archived_at is null and v.poli ilike '%grooming%'
      and v.branch_id = any (v_boleh)
      and v.created_at >= p_mulai and v.created_at <= p_akhir;
    select coalesce(jsonb_agg(jsonb_build_array(s.branch_id, si.qty) order by si.id), '[]'::jsonb) into v_b
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    join public.items it on it.id = si.item_id
    where it.item_type = 'Jasa' and it.tindakan_kategori = 'Grooming'
      and s.voided_at is null
      and s.branch_id = any (v_boleh)
      and s.created_at >= p_mulai and s.created_at <= p_akhir;
    return jsonb_build_object('n_visits', jsonb_array_length(v_a), 'n_kasir', jsonb_array_length(v_b), 'visits', v_a, 'kasir', v_b);

  elsif p_bagian = 'pelanggan' then
    -- Riwayat struk selesai sampai akhir periode, hanya yang punya pelanggan (tanpa pelanggan tidak memengaruhi hasil).
    select coalesce(jsonb_agg(jsonb_build_array(s.id, s.customer_id, s.created_at, s.total, s.merchant_fee_total) order by s.id), '[]'::jsonb)
    into v_a
    from public.sales s
    where s.branch_id = any (v_boleh)
      and s.created_at <= p_akhir
      and s.customer_id is not null
      and s.voided_at is null
      and (s.payment_plan is null or jsonb_typeof(s.payment_plan) = 'null' or s.payments_finalized_at is not null);
    return jsonb_build_object('n', jsonb_array_length(v_a), 'rows', v_a);

  elsif p_bagian = 'stok' then
    with w as materialized (
      select g.id from public.warehouses g where g.branch_id = any (v_boleh) and g.is_active
    ), st as materialized (
      select s.id, s.item_id, s.qty
      from public.stock s
      where s.warehouse_id in (select w.id from w) and s.updated_at <= p_akhir
    )
    select
      (select coalesce(jsonb_agg(jsonb_build_array(st.item_id, st.qty) order by st.id), '[]'::jsonb) from st),
      (select coalesce(jsonb_agg(jsonb_build_array(m.item_id, m.qty, m.tanggal) order by m.id), '[]'::jsonb)
       from public.return_record_effective_stock_moves m
       where m.warehouse_id in (select w.id from w)
         and m.tanggal >= p_dari and m.tanggal <= p_sampai
         and m.qty < 0),
      (select coalesce(jsonb_agg(jsonb_build_array(it.id, it.min_stock) order by it.id), '[]'::jsonb)
       from public.items it
       where it.is_active and it.id in (select st2.item_id from st st2))
    into v_a, v_b, v_c;
    return jsonb_build_object('n_stok', jsonb_array_length(v_a), 'n_mutasi', jsonb_array_length(v_b), 'stok', v_a, 'mutasi', v_b, 'barang', v_c);

  elsif p_bagian = 'klinik' then
    v_legacy_ok := coalesce(public.can_read_legacy_medical_history(), false);
    v_dok_ok := coalesce(public.dokter_aktif_baca_impor(), false);
    select
      (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'branch_id', x.branch_id, 'status', x.status,
          'attendance_outcome', x.attendance_outcome, 'tanggal', x.tanggal) order by x.id), '[]'::jsonb)
       from public.bookings x
       where x.branch_id = any (v_boleh) and x.tanggal >= p_dari and x.tanggal <= p_sampai),
      (select coalesce(jsonb_agg(jsonb_build_array(x.branch_id, x.status, x.checked_in_at, x.service_started_at,
          x.service_finished_at, x.checked_out_at) order by x.id), '[]'::jsonb)
       from public.visits x
       where x.branch_id = any (v_boleh) and x.archived_at is null
         and x.created_at >= p_mulai and x.created_at <= p_akhir),
      (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'branch_id', x.branch_id, 'status', x.status,
          'tanggal', x.tanggal, 'completed_at', x.completed_at) order by x.id), '[]'::jsonb)
       from public.follow_ups x
       where x.branch_id = any (v_boleh) and x.tanggal <= p_sampai),
      (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'branch_id', x.branch_id, 'direction', x.direction,
          'referred_at', x.referred_at) order by x.id), '[]'::jsonb)
       from public.visit_referrals x
       where x.branch_id = any (v_boleh)
         and x.referred_at >= p_mulai and x.referred_at <= p_akhir
         and exists (select 1 from public.visits pv
                     where pv.id = x.visit_id
                       and (pv.branch_id = any (v_semua)
                            or (pv.branch_id is null and (v_null_ok or (pv.legacy_source_key is not null and v_legacy_ok and v_dok_ok)))))),
      (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'branch_id', x.branch_id, 'admitted_at', x.admitted_at,
          'discharged_at', x.discharged_at) order by x.id), '[]'::jsonb)
       from public.inpatient_records x
       where x.branch_id = any (v_boleh)
         and x.admitted_at < p_akhir
         and exists (select 1 from public.visits pv
                     where pv.id = x.visit_id
                       and (pv.branch_id = any (v_semua)
                            or (pv.branch_id is null and (v_null_ok or (pv.legacy_source_key is not null and v_legacy_ok and v_dok_ok)))))),
      (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'branch_id', x.branch_id, 'capacity', x.capacity,
          'valid_from', x.valid_from, 'valid_until', x.valid_until) order by x.id), '[]'::jsonb)
       from public.branch_capacity_periods x
       where x.branch_id = any (v_boleh) and x.valid_from <= p_sampai)
    into v_a, v_b, v_c, v_d, v_e, v_f;
    return jsonb_build_object('n_visits', jsonb_array_length(v_b), 'bookings', v_a, 'visits', v_b, 'follow_ups', v_c,
                              'referrals', v_d, 'admissions', v_e, 'capacities', v_f);

  else
    -- nilai_stok: gudang VET/RETAIL/ONLINE per cabang; p_sampai = tanggal pembanding (mutasi sesudahnya dibawa).
    with w as materialized (
      select g.id, g.branch_id, g.type
      from public.warehouses g
      where g.branch_id = any (v_boleh)
    ), wd as materialized (
      select w.id from w where w.type::text in ('VET', 'RETAIL', 'ONLINE')
    )
    select
      (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'branch_id', w.branch_id, 'type', w.type) order by w.id), '[]'::jsonb) from w),
      (select coalesce(jsonb_agg(jsonb_build_array(s.warehouse_id, s.item_id, s.qty,
          case when p_rata_rata then s.average_cost else null end) order by s.warehouse_id, s.id), '[]'::jsonb)
       from public.stock s where s.warehouse_id in (select wd.id from wd)),
      (select coalesce(jsonb_agg(jsonb_build_array(l.warehouse_id, l.item_id, l.qty_left, l.unit_cost) order by l.warehouse_id, l.id), '[]'::jsonb)
       from public.stock_layers l where l.warehouse_id in (select wd.id from wd) and l.qty_left > 0),
      (select coalesce(jsonb_agg(jsonb_build_array(m.warehouse_id, m.tanggal, m.qty, m.unit_cost, m.valuation_adjustment) order by m.warehouse_id, m.id), '[]'::jsonb)
       from public.stock_moves m where m.warehouse_id in (select wd.id from wd) and m.tanggal > p_sampai)
    into v_a, v_b, v_c, v_d;
    return jsonb_build_object('n_stok', jsonb_array_length(v_b), 'n_lapisan', jsonb_array_length(v_c), 'n_mutasi', jsonb_array_length(v_d),
                              'gudang', v_a, 'stok', v_b, 'lapisan', v_c, 'mutasi', v_d);
  end if;
end;
$$;

revoke all on function public.laporan_operasional_penjualan(text, timestamptz, timestamptz, date, date, uuid[], text, boolean) from public, anon;
grant execute on function public.laporan_operasional_penjualan(text, timestamptz, timestamptz, date, date, uuid[], text, boolean) to authenticated;
