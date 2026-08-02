-- Pelunasan piutang klinik menyimpan rekening yang dipakai.
--
-- Sejak layar piutang boleh memilih rekening manual, metode bayar saja TIDAK cukup untuk
-- menebak akun kas saat void: dua pelunasan bermetode "Transfer" bisa masuk rekening berbeda.
-- Void invoice membalik jurnal pelunasan satu per satu, jadi kodenya harus tercatat.
-- Kosong = pelunasan lama, dibaca dengan aturan bawaan (Tunai→1101, selain itu→1102).
alter table invoice_payments add column kas_code varchar(12);
