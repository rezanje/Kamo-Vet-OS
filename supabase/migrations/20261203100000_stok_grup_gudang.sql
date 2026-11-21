-- Laporan stok (slow moving / harus order): filter "Semua petshop" / "Semua klinik" (permintaan Andaru, 21 Nov 2026).
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Fungsi laporan_stok_analisis hanya bisa satu gudang atau semua gudang. Ditambah parameter TERAKHIR
-- p_gudang_daftar uuid[] (bawaan null = tidak membatasi): bila diisi, stok/nilai/pemakaian/terakhir keluar dihitung
-- hanya dari gudang di daftar itu (aplikasi mengisinya dengan gudang toko RETAIL atau gudang klinik VET).
-- Dipakai bersama p_gudang: keduanya harus cocok (aplikasi tidak pernah mengisi keduanya).
-- Tidak berubah: isi perhitungan (sama persis dengan 20261128100000), awal riwayat global, SECURITY INVOKER (RLS pemanggil),
-- STABLE, search_path kosong, hak (authenticated + service_role saja).
--
-- Tanda tangan lama (uuid, integer, date) DIHAPUS lalu dibuat ulang dengan parameter tambahan, supaya PostgREST tidak
-- melihat dua fungsi bernama sama (panggilan lama {p_gudang, p_jendela_hari} tetap cocok dengan fungsi baru).
-- Pasang SEBELUM aplikasi: aplikasi lama tetap jalan dengan fungsi baru; aplikasi baru butuh parameter baru.
--
-- Batal: drop function public.laporan_stok_analisis(uuid, integer, date, uuid[]); lalu pasang lagi 20261128100000.
set local lock_timeout='5s';

drop function if exists public.laporan_stok_analisis(uuid, integer, date);

create or replace function public.laporan_stok_analisis(
  p_gudang uuid default null,
  p_jendela_hari integer default 90,
  p_hari_ini date default null,
  p_gudang_daftar uuid[] default null
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_hari date := coalesce(p_hari_ini, (now() at time zone 'Asia/Jakarta')::date);
  v_sumber constant text[] := array[
    'sale', 'sale-group', 'sale-online', 'sales-delivery',
    'klinik', 'klinik-bmhp', 'klinik-edit',
    'racik', 'racik-koreksi', 'racik-kembali',
    'sale-void', 'retur-jual', 'retur-jual-group', 'retur-klinik',
    'wholesale-return', 'wholesale-return-void',
    'pesanan-selesai', 'klinik-void', 'return-record-void'
  ];
  v_batas date;
  v_awal date;
  v_baris jsonb;
begin
  if auth.uid() is null then
    raise exception 'LOGIN_DIPERLUKAN' using errcode = '28000';
  end if;
  if p_jendela_hari is null or p_jendela_hari < 1 or p_jendela_hari > 400 then
    raise exception 'JENDELA_TIDAK_VALID' using errcode = '22023';
  end if;
  v_batas := v_hari - (p_jendela_hari - 1);

  -- Awal riwayat = hari pertama ada barang keluar karena dipakai/dijual (seluruh gudang, bukan hanya gudang terpilih).
  select min(m.tanggal) into v_awal
    from public.stock_moves m
   where m.source = any (v_sumber) and m.qty < 0 and m.tanggal <= v_hari;

  with gud as (
    select w.id from public.warehouses w
     where (p_gudang is null or w.id = p_gudang)
       and (p_gudang_daftar is null or w.id = any (p_gudang_daftar))
  ),
  stk as (
    select s.item_id, sum(s.qty) as qty
      from public.stock s join gud on gud.id = s.warehouse_id
     group by s.item_id
  ),
  lay as (
    select l.item_id, sum(l.qty_left) as qty, sum(l.qty_left * l.unit_cost) as nilai, min(l.tanggal) as sejak
      from public.stock_layers l join gud on gud.id = l.warehouse_id
     where l.qty_left > 0
     group by l.item_id
  ),
  -- Pengeluaran 'klinik' yang seluruhnya dibatalkan pasangannya 'pesanan-selesai' (tagihan + gudang + barang sama): bukan pemakaian nyata.
  psl as (
    select m.source_ref, m.warehouse_id, m.item_id
      from public.stock_moves m
     where m.source in ('klinik', 'pesanan-selesai') and m.tanggal <= v_hari
       and m.source_ref in (select x.source_ref from public.stock_moves x where x.source = 'pesanan-selesai' and x.tanggal <= v_hari)
     group by m.source_ref, m.warehouse_id, m.item_id
    having sum(m.qty) >= 0
  ),
  mv as (
    select m.item_id, -sum(m.qty) as keluar, -sum(m.qty * m.unit_cost) as modal
      from public.stock_moves m join gud on gud.id = m.warehouse_id
     where m.source = any (v_sumber) and m.tanggal between v_batas and v_hari
     group by m.item_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'kode', i.code, 'nama', i.name, 'satuan', i.unit,
           'kategori_id', i.category_id, 'aktif', i.is_active,
           'min_stock', i.min_stock, 'supplier_id', i.supplier_id,
           'buy_unit', i.buy_unit, 'min_buy', i.min_buy, 'buy_price', i.buy_price,
           'stok', round(coalesce(stk.qty, 0), 4),
           'nilai', round(coalesce(lay.nilai, 0), 2),
           'stok_sejak', lay.sejak,
           'keluar', round(coalesce(mv.keluar, 0), 4),
           'modal_keluar', round(coalesce(mv.modal, 0), 2),
           'terakhir', t.d,
           'biaya_terakhir', round(coalesce(c.biaya, 0), 4)
         ) order by i.name, i.id), '[]'::jsonb)
    into v_baris
    from public.items i
    left join stk on stk.item_id = i.id
    left join lay on lay.item_id = i.id
    left join mv on mv.item_id = i.id
    left join lateral (
      select max(m.tanggal) as d
        from public.stock_moves m
       where m.item_id = i.id and m.qty < 0 and m.source = any (v_sumber) and m.tanggal <= v_hari
         and m.warehouse_id in (select id from gud)
         and not (m.source = 'klinik' and exists (
               select 1 from psl p where p.source_ref = m.source_ref and p.warehouse_id = m.warehouse_id and p.item_id = m.item_id))
    ) t on true
    left join lateral (
      -- Biaya per satuan dasar pada masuk barang terakhir (hanya untuk perkiraan nilai saran order).
      select m.unit_cost as biaya
        from public.stock_moves m
       where m.item_id = i.id and m.qty > 0 and m.unit_cost > 0
       order by m.tanggal desc, m.created_at desc
       limit 1
    ) c on true
   where i.item_type = 'Persediaan' and i.trashed_at is null
     and (coalesce(lay.nilai, 0) > 0 or coalesce(stk.qty, 0) <> 0 or coalesce(mv.keluar, 0) <> 0
          or (i.is_active and i.min_stock > 0));

  return jsonb_build_object(
    'hari_ini', v_hari,
    'jendela_hari', p_jendela_hari,
    'riwayat_mulai', v_awal,
    'riwayat_hari', case when v_awal is null then 0 else (v_hari - v_awal) + 1 end,
    'gudang_id', p_gudang,
    'gudang_daftar', to_jsonb(p_gudang_daftar),
    'baris', v_baris
  );
end
$fn$;

revoke all on function public.laporan_stok_analisis(uuid, integer, date, uuid[]) from public, anon;
grant execute on function public.laporan_stok_analisis(uuid, integer, date, uuid[]) to authenticated, service_role;

comment on function public.laporan_stok_analisis(uuid, integer, date, uuid[]) is
  'Hanya baca. Agregasi per barang untuk dashboard stok slow moving / harus order: stok, nilai FIFO, pemakaian bersih (pasangan klinik + pesanan-selesai, batal, retur dinetto), terakhir keluar. Satu gudang (p_gudang), sekelompok gudang (p_gudang_daftar), atau semua.';
