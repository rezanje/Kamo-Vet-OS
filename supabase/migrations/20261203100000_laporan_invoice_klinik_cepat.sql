-- Invoice klinik + baris itemnya (+ kunjungan, snapshot biaya admin DEMO, nama racikan resep, refund) dibaca di database dalam
-- SATU query per rentang, bukan puluhan query lewat RLS.
--
-- Masalah (diukur di Production 22 Nov 2026): laporan Rincian Penjualan per Barang sumber Klinik (halaman dan unduhan Excel),
-- Transaksi per Cabang, dan Penjualan per Tenaga Penjual (bagian Klinik) membaca `invoices` per halaman 500 baris,
-- `invoice_items` per 100 id invoice (hitungan pasti + halaman), `clinic_demo_invoice_snapshots` per 100 id,
-- `medical_records` + `compounding_recipes` per 100 kunjungan, dan `clinic_refunds` per 100 id. Pemeriksaan hak cabang RLS
-- (`user_can_access_branch`, berlapis lewat kunjungan induk) dijalankan PER BARIS pada tiap query:
-- 1-22 Nov (±1.700 invoice, ±6.800 baris item) = 44 query, ±45 dtk waktu pernyataan.
--
-- Perubahan: satu fungsi baca-saja yang mengembalikan baris YANG SAMA dalam satu jsonb:
--   { n_invoice, n_item, invoices:[...urut id, tiap invoice membawa n_item dan kunjungannya...],
--     items:[...urut id...], demo:[...], racikan:[...], refunds:[...] }
-- Hak baca SAMA dengan RLS (cermin pagar tabel `invoices`/`invoice_items`/`visits`/`clinic_demo_invoice_snapshots`/
-- `medical_records`/`compounding_recipes`/`clinic_refunds`/`clinic_refund_items`):
--   * Admin Online ditolak (pagar admin_online_fence_r), anon tidak punya hak eksekusi;
--   * invoice hanya bila `public.user_can_access_branch(visits.branch_id)` benar (kebijakan inv_all + visits operational_branch_isolation);
--     fungsi itu sendiri yang menentukan (peran, cabang pengguna, header cabang operasional, profil aktif). Dicek SEKALI per cabang
--     (dan sekali untuk kunjungan tanpa cabang, karena OWNER/ADMIN lolos untuk cabang null di kebijakan asli), bukan sekali per baris;
--   * item, rekam medis (nama racikan), resep: hanya milik invoice/kunjungan yang terlihat (operational_parent_isolation + mr_select);
--   * snapshot DEMO: tambahan user_can_access_branch(snapshot.branch_id) seperti kebijakan clinic_demo_snapshot_read;
--   * refund: user_can_access_branch(clinic_refunds.branch_id) seperti kebijakan clinic_refunds_branch_read (item refund ikut induknya);
--   * nama cabang/pelanggan/hewan ikut seperti embed PostgREST `branches(name)` / `customers(name)` / `pets(name)` (kebijakan baca terbuka;
--     cabang kunjungan yang terlihat pasti boleh diakses, jadi pagar `operational_branch_selection` pada `branches` selalu lolos).
-- Filter: created_at inklusif p_from..p_to (sama dengan .gte/.lte pembaca lama), invoice dibatalkan (voided_at) dibuang,
-- cabang opsional pada kunjungan (null = semua). p_dengan_item=false hanya mengembalikan invoice dengan jumlah itemnya (n_item) —
-- untuk Transaksi per Cabang. Bentuk setiap kolom sama dengan hasil PostgREST (jsonb angka/teks/null).
-- Tidak ada tabel, kebijakan, indeks, atau data yang diubah.
--
-- Aplikasi tetap berjalan sebelum migrasi ini dipasang: bila fungsi belum ada, pembaca lama dipakai.

create or replace function public.laporan_invoice_klinik(
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
  v_null_ok boolean;
  v_invoices jsonb;
  v_items jsonb;
  v_demo jsonb;
  v_racikan jsonb;
  v_refunds jsonb;
begin
  perform admin_online_private.deny_admin_online();
  if p_from is null or p_to is null then
    raise exception 'LAPORAN_INVOICE_PERIODE: tanggal awal dan akhir wajib diisi' using errcode = '22023';
  end if;
  -- Cabang yang boleh dilihat pemanggil: sekali per cabang, logika persis RLS (user_can_access_branch).
  select coalesce(array_agg(b.id), '{}'::uuid[]) into v_boleh
  from public.branches b
  where public.user_can_access_branch(b.id);
  -- Kunjungan tanpa cabang: kebijakan asli memanggil user_can_access_branch(null); jawabannya sama untuk semua baris.
  v_null_ok := coalesce(public.user_can_access_branch(null::uuid), false);

  with s as materialized (
    select i.id, i.visit_id, i.invoice_no, i.created_at, i.paid_status, i.subtotal, i.discount, i.total, i.salesperson_id,
           i.voided_at, v.branch_id as v_branch_id, v.customer_id as v_customer_id, v.doctor_id as v_doctor_id, v.pet_id as v_pet_id
    from public.invoices i
    join public.visits v on v.id = i.visit_id
    where i.created_at >= p_from and i.created_at <= p_to
      and i.voided_at is null
      and (p_branch_id is null or v.branch_id = p_branch_id)
      and (v.branch_id = any(v_boleh) or (v.branch_id is null and v_null_ok))
  ), ix as materialized (
    select x.id, x.invoice_id, x.deskripsi, x.qty, x.harga, x.diskon_persen, x.jenis, x.item_id, x.compound_recipe_id,
           x.bmhp_components, x.service_performers, x.salesperson_id
    from public.invoice_items x
    join s on s.id = x.invoice_id
  ), n as materialized (
    select invoice_id, count(*) as c from ix group by invoice_id
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'visit_id', s.visit_id,
        'invoice_no', s.invoice_no,
        'created_at', s.created_at,
        'paid_status', s.paid_status,
        'subtotal', s.subtotal,
        'discount', s.discount,
        'total', s.total,
        'salesperson_id', s.salesperson_id,
        'voided_at', s.voided_at,
        'n_item', coalesce(n.c, 0),
        'visits', jsonb_build_object(
          'branch_id', s.v_branch_id,
          'customer_id', s.v_customer_id,
          'doctor_id', s.v_doctor_id,
          'branches', case when b.id is null then null else jsonb_build_object('name', b.name) end,
          'customers', case when c.id is null then null else jsonb_build_object('name', c.name) end,
          'pets', case when p.id is null then null else jsonb_build_object('name', p.name) end)
      ) order by s.id), '[]'::jsonb)
     from s
     left join n on n.invoice_id = s.id
     left join public.branches b on b.id = s.v_branch_id
     left join public.customers c on c.id = s.v_customer_id
     left join public.pets p on p.id = s.v_pet_id),
    (case when p_dengan_item then
      (select coalesce(jsonb_agg(jsonb_build_object(
          'id', ix.id,
          'invoice_id', ix.invoice_id,
          'deskripsi', ix.deskripsi,
          'qty', ix.qty,
          'harga', ix.harga,
          'diskon_persen', ix.diskon_persen,
          'jenis', ix.jenis,
          'item_id', ix.item_id,
          'compound_recipe_id', ix.compound_recipe_id,
          'bmhp_components', ix.bmhp_components,
          'service_performers', ix.service_performers,
          'salesperson_id', ix.salesperson_id
        ) order by ix.id), '[]'::jsonb)
       from ix)
    else '[]'::jsonb end),
    (case when p_dengan_item then
      (select coalesce(jsonb_agg(jsonb_build_object(
          'invoice_id', d.invoice_id, 'fee_amount', d.fee_amount, 'fee_bearer', d.fee_bearer
        ) order by d.invoice_id), '[]'::jsonb)
       from public.clinic_demo_invoice_snapshots d
       join s on s.id = d.invoice_id
       where public.user_can_access_branch(d.branch_id))
    else '[]'::jsonb end),
    -- Nama resep racikan per kunjungan: hanya untuk kunjungan yang punya baris tanpa tautan racikan/barang
    -- (perluCocokNamaRacikan di aplikasi: tanpa compound_recipe_id, jenis bukan 'jasa', tanpa item_id).
    (case when p_dengan_item then
      (select coalesce(jsonb_agg(jsonb_build_object(
          'visit_id', mr.visit_id, 'recipe_name', cr.recipe_name
        ) order by mr.visit_id, cr.id), '[]'::jsonb)
       from public.medical_records mr
       join public.compounding_recipes cr on cr.medical_record_id = mr.id
       where mr.visit_id in (
         select s.visit_id from s join ix on ix.invoice_id = s.id
         where ix.compound_recipe_id is null and ix.jenis is distinct from 'jasa' and ix.item_id is null))
    else '[]'::jsonb end),
    (case when p_dengan_item then
      (select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'invoice_id', r.invoice_id, 'tanggal', r.tanggal,
          'clinic_refund_items', coalesce((select jsonb_agg(jsonb_build_object(
              'id', ri.id, 'invoice_item_id', ri.invoice_item_id, 'qty', ri.qty) order by ri.id)
            from public.clinic_refund_items ri where ri.refund_id = r.id), '[]'::jsonb)
        ) order by r.id), '[]'::jsonb)
       from public.clinic_refunds r
       join s on s.id = r.invoice_id
       where public.user_can_access_branch(r.branch_id))
    else '[]'::jsonb end)
  into v_invoices, v_items, v_demo, v_racikan, v_refunds;

  return jsonb_build_object(
    'n_invoice', jsonb_array_length(v_invoices),
    'n_item', jsonb_array_length(v_items),
    'invoices', v_invoices,
    'items', v_items,
    'demo', v_demo,
    'racikan', v_racikan,
    'refunds', v_refunds
  );
end;
$$;

revoke all on function public.laporan_invoice_klinik(timestamptz, timestamptz, uuid, boolean) from public, anon;
grant execute on function public.laporan_invoice_klinik(timestamptz, timestamptz, uuid, boolean) to authenticated;
