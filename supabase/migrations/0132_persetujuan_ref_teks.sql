-- ref_id pengajuan persetujuan jadi teks.
--
-- Pembayaran hutang menunjuk faktur yang sudah ada (uuid), tapi kas keluar BELUM punya
-- dokumen saat izinnya diminta — buktinya baru terbit setelah disetujui. Supaya dua-duanya
-- bisa memakai antrean yang sama, kuncinya disimpan sebagai teks: uuid faktur untuk yang
-- pertama, dan kunci turunan dari isi transaksinya untuk yang kedua. Konsekuensi yang
-- disengaja: mengubah nominal atau rekeningnya membuat kuncinya berbeda, jadi izinnya
-- harus diminta ulang — memang begitu seharusnya, itu pengeluaran yang berbeda.

alter table approval_requests alter column ref_id type varchar(120) using ref_id::text;
