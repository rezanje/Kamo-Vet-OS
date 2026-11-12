-- Harga beli PO wajib maksimal 2 angka desimal (sen), begitu juga nilai baris qty x harga.
--
-- Latar: PO-20261102-DC-0004 dibuat dengan harga 541,666667/ml dan 222,225/tab. Pembuatan & revisi PO
-- belum menolak harga seperti itu, padahal penerimaan lalu faktur menuntut nilai baris tepat sen
-- ("Qty dan harga faktur tidak valid" / "Harga atau satuan PO memerlukan rekonsiliasi"), dan koreksi
-- harga PO pun sudah membatasi 2 desimal. Akibatnya PO bisa dibuat & diterima, tapi tidak bisa difakturkan.
--
-- Penjaga dipasang di tabel (bukan per fungsi) agar semua jalur tulis baris PO ikut: buat PO, revisi PO,
-- koreksi harga PO, edit baris PO. Hanya berlaku saat baris baru atau saat harga/qty BERUBAH, jadi
-- pembaruan kolom lain (qty diterima, dsb.) pada baris lama tidak ikut terblokir.
create or replace function public.purchase_order_item_price_cents() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and new.harga_beli is not distinct from old.harga_beli and new.qty is not distinct from old.qty then
  return new;
 end if;
 if new.harga_beli is not null and new.harga_beli::text not in ('NaN','Infinity','-Infinity') and new.harga_beli<>round(new.harga_beli,2) then
  raise exception 'Harga beli % maksimal 2 angka desimal. Kalau beli per botol/box, pilih satuan botol/box dan isi harga per botol/box', coalesce(new.nama,'')
   using errcode='22023';
 end if;
 if new.harga_beli is not null and new.qty is not null and new.qty::text not in ('NaN','Infinity','-Infinity')
  and new.harga_beli::text not in ('NaN','Infinity','-Infinity') and new.qty*new.harga_beli<>round(new.qty*new.harga_beli,2) then
  raise exception 'Nilai baris % (qty x harga) harus tepat sampai sen. Ubah qty atau harganya', coalesce(new.nama,'')
   using errcode='22023';
 end if;
 return new;
end$$;
revoke all on function public.purchase_order_item_price_cents() from public,anon,authenticated,service_role;

drop trigger if exists purchase_order_item_price_cents on public.purchase_order_items;
create trigger purchase_order_item_price_cents before insert or update of harga_beli,qty on public.purchase_order_items
 for each row execute function public.purchase_order_item_price_cents();
