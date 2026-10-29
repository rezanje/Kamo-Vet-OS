-- P02 Koreksi pembelian: rincian penerimaan barang hanya berubah lewat proses resmi.
--
-- goods_receipts / goods_receipt_items masih memakai kebijakan awal (gr_all / gri_all)
-- yang mengizinkan INSERT/UPDATE/DELETE langsung lewat API bagi siapa pun dengan
-- akses cabang, apa pun perannya. Mengubah qty_terima/harga atau menghapus baris
-- dengan cara itu tidak menyentuh stok, lapisan FIFO, maupun jurnal 1301/2102,
-- sehingga dokumen sumber, kartu stok, dan neraca bisa tidak cocok tanpa jejak.
--
-- Semua penulis resmi sudah berupa RPC SECURITY DEFINER (receive_purchase_order,
-- correct_purchase_order_line, correct_purchase_invoice_line, cancel_goods_receipt,
-- create_purchase_invoice_from_po, recover_purchase_operation), dan aplikasi hanya
-- membaca kedua tabel ini. Pola ini sama dengan purchase_invoices/_items
-- (20261021004732). Hak baca dan data lama tidak berubah.
do $$ begin
 if to_regclass('public.goods_receipts') is null or to_regclass('public.goods_receipt_items') is null
  or to_regprocedure('public.receive_purchase_order(uuid,text,text,integer,date,text,text,jsonb)') is null
 then raise exception 'P02_GR_SOURCE_CHANGED: review goods receipt writer contract';end if;
end $$;

revoke insert,update,delete on public.goods_receipts,public.goods_receipt_items from authenticated,anon,service_role;
