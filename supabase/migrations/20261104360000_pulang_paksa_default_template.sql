-- Template bawaan form Pulang Paksa. Kepulangan paksa mewajibkan form kategori
-- 'Pulang Paksa' yang ditandatangani (20261025180000), tetapi belum pernah ada
-- template kategori itu, sehingga staf tidak bisa membuat formnya sama sekali.
-- Hanya menambah satu template berlaku semua cabang bila klinik belum punya
-- template Pulang Paksa yang AKTIF (template nonaktif, mis. sisa demo, tidak dihitung);
-- template, dokumen dan aturan lain tidak disentuh.
-- OWNER/ADMIN tetap bisa mengubah isi atau menonaktifkannya di Form persetujuan.
insert into public.consent_templates(nama, isi, branch_id, kategori, is_active)
select 'Surat Pernyataan Pulang Paksa', $isi$SURAT PERNYATAAN PULANG PAKSA
(Pulang atas permintaan sendiri sebelum diizinkan dokter)

Saya yang bertanda tangan di bawah ini, {nama_pemilik}, selaku pemilik / penanggung jawab hewan:
Nama hewan : {nama_hewan}
Jenis hewan : {jenis_hewan}
yang sedang menjalani rawat inap di {cabang} di bawah penanganan {dokter},

dengan ini atas kehendak sendiri meminta agar hewan tersebut dipulangkan sebelum dinyatakan sembuh atau diizinkan pulang oleh dokter hewan yang merawat.
Keterangan / alasan: {tindakan}

Saya menyatakan bahwa:
1. Dokter hewan telah menjelaskan kondisi terkini hewan saya, perawatan yang belum selesai, serta risiko bila perawatan dihentikan, termasuk kemungkinan kondisi memburuk hingga kematian.
2. Saya memahami penjelasan tersebut dan tetap memutuskan membawa pulang hewan saya.
3. Segala akibat yang timbul setelah hewan dibawa pulang menjadi tanggung jawab saya sepenuhnya, dan saya tidak akan menuntut klinik, dokter hewan, maupun staf atas akibat tersebut.
4. Saya bersedia melunasi seluruh biaya perawatan yang telah diberikan sampai saat kepulangan.
5. Saya akan mengikuti anjuran perawatan lanjutan di rumah dan bersedia membawa kembali hewan saya bila diperlukan.

Demikian pernyataan ini saya buat dengan sadar dan tanpa paksaan dari pihak mana pun.

{cabang}, {tanggal}$isi$, null, 'Pulang Paksa', true
where not exists (
  select 1 from public.consent_templates
  where kategori = 'Pulang Paksa' and is_active
);
