-- Kasir petshop: barang yang stoknya tidak cukup TIDAK BOLEH terjual (stok tidak boleh minus).
--
-- Laporan Andri (10 Nov 2026, grup KAMO): kartu stok barang di WH_CMGG turun 2 -> 0 -> -4 lewat
-- "Faktur Penjualan" kasir (POS-20261110-0022). Di klinik barang stok 0 sudah tidak bisa diproses,
-- tapi kasir petshop masih lolos. Keputusan grup (Aldi, Reza): "Item 0 ga bisa transaksi saja";
-- saldo yang terlanjur minus dibiarkan dulu, dicek manual oleh tim (TIDAK ada data yang diubah di sini).
--
-- Penyebab: semua jalur kasir mengeluarkan stok lewat public.sale_stock_out_fifo -> stock_out_fifo,
-- dan stock_out_fifo sengaja mengizinkan kekurangan (shortfall) dengan HPP perkiraan. Layar kasir
-- hanya memberi peringatan oranye "Boleh dilanjut kalau barangnya memang ada di rak".
--
-- Perbaikan: satu gerbang di public.sale_stock_out_fifo, pembungkus yang HANYA dipakai penjualan
-- kasir/POS (source sale / sale-group, channel null):
--   * cashier_post_stock_atomic      (kasir /kasir, termasuk komponen paket Grup)
--   * pos_post_promo_atomic          (POS back-office, promo syarat-hasil)
--   * quantity_pool_post_backoffice_atomic (POS back-office, promo kolam)
--   * lib/inventory stockOut         (POS back-office biasa)
-- Sebelum stok keluar, baris saldo gudang dikunci (FOR UPDATE, urutan kunci sama dengan
-- stock_out_fifo: saldo dulu, baru lapisan) lalu dibandingkan dengan jumlah yang mau keluar.
-- Kurang = transaksi ditolak seluruhnya (rollback), pesan per barang dibaca popup "Stok tidak cukup".
--
-- Yang TIDAK berubah: stock_out_fifo itu sendiri (dipakai klinik, pemindahan, produksi, koreksi, dll.
-- yang punya penjagaannya sendiri), penjualan daring/marketplace (channel tidak null), penjualan
-- grosir, dan barang non-Persediaan (Jasa/Non-Persediaan tidak punya stok).
-- Tambalan memakai jangkar eksak di atas definisi berjalan (pg_get_functiondef + replace) dan gagal
-- tertutup bila definisinya sudah berubah.

begin;

create function public.sale_stock_assert_available(p_warehouse_id uuid, p_item_id uuid, p_qty numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare
 v_item record;
 v_available numeric;
begin
 select name, item_type, coalesce(nullif(trim(unit), ''), '') as unit into v_item
 from public.items where id = p_item_id;
 -- Barang tak dikenal / jumlah tak sah ditolak oleh stock_out_fifo dengan pesannya sendiri.
 if not found or p_qty is null or p_qty <= 0 then return; end if;
 if v_item.item_type is not null and v_item.item_type <> 'Persediaan' then return; end if;
 select qty into v_available from public.stock
 where warehouse_id = p_warehouse_id and item_id = p_item_id
 for update;
 v_available := coalesce(v_available, 0);
 if v_available < p_qty then
  -- Bentuk kalimat dibaca kembali oleh lib/stok-kurang (uraiKekuranganStok) menjadi popup per barang.
  -- Saldo yang sudah minus ditampilkan 0: yang bisa dijual memang 0.
  raise exception '%', 'Stok gudang cabang tidak cukup: '
   || replace(v_item.name, ';', ',') || ' butuh ' || public.stock_qty_text(p_qty)
   || case when v_item.unit = '' then '' else ' ' || v_item.unit end
   || ', tersedia ' || public.stock_qty_text(greatest(v_available, 0))
   || case when v_item.unit = '' then '' else ' ' || v_item.unit end
   using errcode = '55000';
 end if;
end $$;
revoke all on function public.sale_stock_assert_available(uuid, uuid, numeric) from public, anon, authenticated, service_role;
comment on function public.sale_stock_assert_available(uuid, uuid, numeric) is
 'Kasir/POS: tolak pengeluaran stok penjualan bila saldo gudang kurang (stok tidak boleh minus). Dipanggil sale_stock_out_fifo.';

do $$
declare
 signature regprocedure := 'public.sale_stock_out_fifo(uuid,uuid,numeric,text,text,date,uuid)'::regprocedure;
 definition text := pg_get_functiondef(signature);
 old_text constant text := $old$ return query select * from public.stock_out_fifo(p_warehouse_id,p_item_id,p_qty,p_source,p_source_ref,p_tanggal);$old$;
 new_text constant text := $new$ perform public.sale_stock_assert_available(p_warehouse_id,p_item_id,p_qty); -- KASIR_KUNCI_STOK
 return query select * from public.stock_out_fifo(p_warehouse_id,p_item_id,p_qty,p_source,p_source_ref,p_tanggal);$new$;
begin
 if position('KASIR_KUNCI_STOK' in definition) > 0 then
  raise exception 'KASIR_KUNCI_STOK_DRIFT: kunci stok kasir sudah terpasang';
 end if;
 if (length(definition) - length(replace(definition, old_text, ''))) / length(old_text) <> 1 then
  raise exception 'KASIR_KUNCI_STOK_DRIFT: sale_stock_out_fifo berubah; tinjau sebelum rilis';
 end if;
 execute replace(definition, old_text, new_text);
end $$;
revoke all on function public.sale_stock_out_fifo(uuid,uuid,numeric,text,text,date,uuid) from public, anon, service_role;
grant execute on function public.sale_stock_out_fifo(uuid,uuid,numeric,text,text,date,uuid) to authenticated;

commit;
