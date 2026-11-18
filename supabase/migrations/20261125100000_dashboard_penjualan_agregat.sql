-- Dashboard Keuangan: penjualan kasir dan tagihan klinik dijumlah di database, bukan ditarik baris per baris.
--
-- Masalah (laporan Reza, 18 Nov 2026): dashboard lama sekali terbuka — layar kerangka abu-abu dulu, baru
-- angka muncul. Sejak 9 Nov (perbaikan "penjualan terpotong 1.000 baris") dashboard membaca SELURUH
-- transaksi kasir sejak 1 Januari ke aplikasi, 500 baris per permintaan, berurutan, dan tiap permintaan
-- menghitung ulang jumlah pasti baris (count exact). Kasir ±500 struk/hari → ±150.000 baris per
-- November = ±300 permintaan berurutan sebelum halaman bisa tampil. Tagihan klinik dan seluruh riwayat
-- pembayarannya dibaca dengan cara yang sama. Makin akhir tahun, makin lambat.
--
-- Perubahan: dua fungsi baca-saja yang mengembalikan angka yang sama dalam satu panggilan.
-- Tidak ada tabel, kebijakan, atau data yang diubah.
--
--   1. public.dashboard_kasir_ringkas — struk kasir. SECURITY DEFINER dengan hak baca SAMA dengan RLS
--      tabel sales (kebijakan sales_all = true DAN pembatas operational_branch_isolation =
--      user_can_access_branch(branch_id)); bedanya pengecekan cabang dilakukan sekali per cabang
--      (beberapa baris di branches), bukan sekali per struk (±12 µs × 150.000 struk). Pola sama dengan
--      ledger_account_totals (20261109084230). sales.branch_id wajib diisi dan merujuk branches, jadi setiap
--      struk yang lolos RLS pasti cabangnya ada di daftar. Pemanggil tidak bisa memilih cabang.
--   2. public.dashboard_penjualan_ringkas — yang dipanggil aplikasi. SECURITY INVOKER: tagihan klinik dan
--      pembayarannya dibaca dengan RLS pemanggil apa adanya (volumenya jauh lebih kecil), lalu digabung
--      dengan hasil (1).
--
-- Kesetaraan dengan pembaca lama (aturan + hak baca, beberapa pengguna dan pilihan cabang operasional)
-- dibuktikan di scripts/test-dashboard-penjualan-agregat-postgres.py.
--
set local lock_timeout = '5s';

create or replace function public.dashboard_kasir_ringkas(
  p_awal_tahun date,
  p_awal7 date,
  p_hari_ini date
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_boleh uuid[];
  v_awal_tahun timestamptz := p_awal_tahun::timestamp at time zone 'UTC';
  v_awal_baca timestamptz := least(p_awal_tahun, p_awal7)::timestamp at time zone 'UTC';
begin
  if p_awal_tahun is null or p_awal7 is null or p_hari_ini is null then
    raise exception 'TANGGAL_WAJIB' using errcode = '22023';
  end if;
  -- Cabang yang boleh dilihat pemanggil: sekali per cabang, logika persis RLS operational_branch_isolation.
  select coalesce(array_agg(b.id), '{}'::uuid[]) into v_boleh
    from public.branches b
   where public.user_can_access_branch(b.id);

  return (
    with struk as (
      select s.total, s.created_at, s.marketplace_status
        from public.sales s
       where s.branch_id = any(v_boleh)
         and s.created_at >= v_awal_baca
         and s.voided_at is null
         and (s.payment_plan is null or s.payment_plan = 'null'::jsonb or s.payments_finalized_at is not null)
    ),
    harian as (
      select (st.created_at at time zone 'UTC')::date as tanggal, sum(coalesce(st.total, 0)) as total
        from struk st
       where (st.created_at at time zone 'UTC')::date between p_awal7 and p_hari_ini
       group by 1
    )
    select jsonb_build_object(
      'kasir_total', coalesce(sum(coalesce(st.total, 0)) filter (where st.created_at >= v_awal_tahun), 0),
      'kasir_piutang', coalesce(sum(coalesce(st.total, 0)) filter (where st.created_at >= v_awal_tahun and st.marketplace_status = 'piutang'), 0),
      'kasir_harian', coalesce((select jsonb_agg(jsonb_build_object('tanggal', h.tanggal, 'total', h.total) order by h.tanggal) from harian h), '[]'::jsonb)
    )
    from struk st
  );
end;
$fn$;

revoke all on function public.dashboard_kasir_ringkas(date, date, date) from public, anon;
grant execute on function public.dashboard_kasir_ringkas(date, date, date) to authenticated;

create or replace function public.dashboard_penjualan_ringkas(
  p_awal_tahun date,
  p_awal7 date,
  p_hari_ini date
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  with tagihan as (
    select coalesce(i.total, 0) as total,
           coalesce(i.dp_amount, 0) + coalesce((select sum(coalesce(p.amount, 0)) from public.invoice_payments p where p.invoice_id = i.id), 0) as dibayar
      from public.invoices i
     where i.voided_at is null
       and i.created_at >= (p_awal_tahun::timestamp at time zone 'UTC')
  ),
  klinik as (
    select coalesce(sum(t.total), 0) as total,
           coalesce(sum(greatest(0, t.total - t.dibayar)), 0) as belum
      from tagihan t
  )
  select public.dashboard_kasir_ringkas(p_awal_tahun, p_awal7, p_hari_ini)
         || jsonb_build_object('klinik_total', klinik.total, 'klinik_belum', klinik.belum)
    from klinik;
$fn$;

revoke all on function public.dashboard_penjualan_ringkas(date, date, date) from public, anon;
grant execute on function public.dashboard_penjualan_ringkas(date, date, date) to authenticated;
