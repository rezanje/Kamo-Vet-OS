-- Struk kasir (POS/Online) + baris itemnya dibaca di database dalam SATU query per rentang, bukan 100+ query lewat RLS.
--
-- Masalah (diukur di Production 22 Nov 2026): Rincian Penjualan per Barang sumber Kasir (halaman dan unduhan Excel),
-- Penjualan per Tenaga Penjual, dan Transaksi per Cabang membaca `sales` per halaman 500 baris (tiap halaman menghitung
-- ulang jumlah pasti seluruh struk) lalu `sale_items` per 100 id struk. Pemeriksaan hak cabang RLS
-- (`user_can_access_branch`) dijalankan PER BARIS. 1-22 Nov (9.479 struk, ±16.000 baris item) = ±115 query, ±30 detik
-- waktu database; periode lebih panjang makin berat sampai melewati batas 8 detik per query dan laporan gagal dengan
-- "Laporan belum bisa dibaca".
--
-- Perubahan: satu fungsi baca-saja yang mengembalikan baris YANG SAMA dalam satu jsonb:
--   { n_struk, n_item, sales:[...struk urut id...], items:[...item urut id...] }
-- Hak baca SAMA dengan RLS (cermin pagar tabel `sales`/`sale_items`/`branches`/`customers`):
--   * Admin Online ditolak (pagar admin_online_fence_r), anon tidak punya hak eksekusi;
--   * struk hanya bila `public.user_can_access_branch(branch_id)` benar (kebijakan RESTRICTIVE
--     operational_branch_isolation) — dicek SEKALI per cabang, bukan sekali per baris (sales.branch_id wajib terisi).
--     Fungsi itu sendiri yang menentukan (peran, cabang pengguna, header cabang operasional, profil aktif);
--   * item hanya milik struk yang terlihat (operational_parent_isolation);
--   * nama cabang/pelanggan ikut seperti embed PostgREST `branches(name)` / `customers(name)` (kebijakan baca terbuka).
-- Filter: created_at inklusif p_from..p_to (sama dengan .gte/.lte pembaca lama), cabang opsional (null = semua).
-- p_dengan_item=false hanya mengembalikan struk (untuk pembaca yang tidak butuh item). Bentuk setiap kolom sama dengan
-- hasil PostgREST (jsonb angka/teks/null), jadi pemanggil lama tidak berubah selain sumbernya.
-- Tidak ada tabel, kebijakan, indeks, atau data yang diubah.
--
-- Aplikasi tetap berjalan sebelum migrasi ini dipasang: bila fungsi belum ada, pembaca lama dipakai.

create or replace function public.laporan_struk_kasir(
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id uuid default null,
  p_dengan_item boolean default true
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_boleh uuid[];
  v_sales jsonb;
  v_items jsonb;
begin
  perform admin_online_private.deny_admin_online();
  if p_from is null or p_to is null then
    raise exception 'LAPORAN_STRUK_PERIODE: tanggal awal dan akhir wajib diisi' using errcode = '22023';
  end if;
  -- Cabang yang boleh dilihat pemanggil: sekali per cabang, logika persis RLS operational_branch_isolation.
  select coalesce(array_agg(b.id), '{}'::uuid[]) into v_boleh
  from public.branches b
  where public.user_can_access_branch(b.id);

  with s as materialized (
    select x.id, x.branch_id, x.customer_id, x.no_struk, x.created_at, x.channel, x.total, x.merchant_fee_total,
           x.payment_plan, x.payments_finalized_at, x.voided_at, x.salesperson_id, x.cashier_id
    from public.sales x
    where x.created_at >= p_from and x.created_at <= p_to
      and (p_branch_id is null or x.branch_id = p_branch_id)
      and x.branch_id = any(v_boleh)
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'branch_id', s.branch_id,
        'customer_id', s.customer_id,
        'no_struk', s.no_struk,
        'created_at', s.created_at,
        'channel', s.channel,
        'total', s.total,
        'merchant_fee_total', s.merchant_fee_total,
        'payment_plan', s.payment_plan,
        'payments_finalized_at', s.payments_finalized_at,
        'voided_at', s.voided_at,
        'salesperson_id', s.salesperson_id,
        'cashier_id', s.cashier_id,
        'branches', case when b.id is null then null else jsonb_build_object('name', b.name) end,
        'customers', case when c.id is null then null else jsonb_build_object('name', c.name) end
      ) order by s.id), '[]'::jsonb)
     from s
     left join public.branches b on b.id = s.branch_id
     left join public.customers c on c.id = s.customer_id),
    (case when p_dengan_item then
      (select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id,
          'sale_id', i.sale_id,
          'nama', i.nama,
          'qty', i.qty,
          'harga', i.harga,
          'item_id', i.item_id,
          'satuan', i.satuan,
          'faktor', i.faktor,
          'item_discount_type', i.item_discount_type,
          'item_discount_value', i.item_discount_value,
          'promo_discount', i.promo_discount,
          'service_performers', i.service_performers
        ) order by i.id), '[]'::jsonb)
       from public.sale_items i
       join s on s.id = i.sale_id)
    else '[]'::jsonb end)
  into v_sales, v_items;

  return jsonb_build_object(
    'n_struk', jsonb_array_length(v_sales),
    'n_item', jsonb_array_length(v_items),
    'sales', v_sales,
    'items', v_items
  );
end;
$$;

revoke all on function public.laporan_struk_kasir(timestamptz, timestamptz, uuid, boolean) from public, anon;
grant execute on function public.laporan_struk_kasir(timestamptz, timestamptz, uuid, boolean) to authenticated;
