-- Dashboard stok: "Item slow moving / stok berlebih" dan "Item harus order" (permintaan Pak Andri, 13 Nov 2026).
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Hanya BACA. Tidak ada tabel baru, tidak ada kolom baru, tidak ada data uang/stok yang berubah.
-- Isi:
--   1. Fungsi public.laporan_stok_analisis(gudang, jendela_hari, hari_ini): satu agregasi per barang
--      (stok sekarang, nilai stok dari lapisan FIFO, pemakaian bersih dalam jendela, tanggal terakhir keluar).
--      SECURITY INVOKER: hak baca tabel dan batas cabang/gudang (RLS) tetap milik pemanggil.
--   2. Dua baris katalog Akses Grup: laporan.stok-slow-moving dan laporan.stok-harus-order.
--      Dipasang SEBELUM aplikasi dideploy: tanpa baris ini menyimpan Akses Grup yang mencentang keduanya ditolak.
--
-- Sumber pemakaian = stock_moves (satuan DASAR, sudah dikali faktor), hanya sumber yang berarti barang
-- terpakai/terjual: kasir (sale, sale-group, sale-online), faktur grosir (sales-delivery), klinik, BMHP klinik, racikan,
-- plus pembaliknya (sale-void, retur, koreksi) sehingga struk batal dan retur MENGURANGI pemakaian.
-- Tidak dihitung: pembelian, mutasi antar gudang, permintaan gudang, produksi, opname, penyesuaian.
--
-- Batal: drop function public.laporan_stok_analisis(uuid, integer, date);
--        delete from role_settings_private.submenu_catalog where id in ('laporan.stok-slow-moving','laporan.stok-harus-order');
--        (setelah memastikan tidak ada kebijakan Akses Grup yang menyebutnya).
set local lock_timeout='5s';

create or replace function public.laporan_stok_analisis(
  p_gudang uuid default null,
  p_jendela_hari integer default 90,
  p_hari_ini date default null
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
    'wholesale-return', 'wholesale-return-void'
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
    select w.id from public.warehouses w where p_gudang is null or w.id = p_gudang
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
    'baris', v_baris
  );
end
$fn$;

revoke all on function public.laporan_stok_analisis(uuid, integer, date) from public, anon;
grant execute on function public.laporan_stok_analisis(uuid, integer, date) to authenticated, service_role;

comment on function public.laporan_stok_analisis(uuid, integer, date) is
  'Hanya baca. Agregasi per barang untuk dashboard stok slow moving / harus order: stok, nilai FIFO, pemakaian bersih, terakhir keluar.';

insert into role_settings_private.submenu_catalog(id,module_id) values
('laporan.stok-slow-moving','laporan'),
('laporan.stok-harus-order','laporan')
on conflict (id) do nothing;
