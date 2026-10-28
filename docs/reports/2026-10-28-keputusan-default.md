# Keputusan default untuk butir checklist KAMO yang terbuka — 28 Oktober 2026

Disetujui Reza (pemilik) di sesi 28 Okt 2026: "pakai saran" untuk butir operasional **dan** keuangan/gaji,
rilis langsung termasuk perubahan database. Finance boleh mengoreksi aturan ini belakangan; tiap aturan
dibuat sesederhana mungkin agar mudah diganti.

## Operasional

| ID | Aturan |
|----|--------|
| K13 | Semua pengguna yang punya akses modul klinik boleh **membaca** riwayat medis pasien yang sama dari cabang lain. Tiap kunjungan diberi label cabang asal. Tidak ada hak ubah lintas cabang. Pasien dicocokkan per ID pasien, bukan nama. |
| P04 | Peringatan (bukan blokir) saat harga beli per satuan dasar menyimpang > 50% dari HPP rata-rata saat ini. Tidak ada peringatan bila HPP belum ada. Pengguna harus konfirmasi sebelum simpan. |
| U11 | Hanya OWNER boleh membuat cabang baru (kode, nama, jenis, status aktif). Cabang baru langsung bisa dipilih di form gudang. |
| K06 | Kunjungan rawat jalan yang sudah lunas/selesai boleh dilanjutkan ke rawat inap. Rawat inap tetap tertaut ke kunjungan & rekam medis yang sama. Tagihan rawat jalan lama tidak diubah; biaya rawat inap ditagih di invoice terpisah. |
| K14 | Rawat inap punya tipe: "Rawat inap (sakit)" dan "Pet hotel (sehat)". Pet hotel: catatan harian berisi makan, kondisi, catatan bebas oleh paramedis; pemeriksaan dokter/suhu tidak wajib. Tidak ada kirim WhatsApp otomatis. |
| P01 | Eksekutor koreksi pembelian tetap OWNER. Siapa pun yang bisa membuka dokumen pembelian boleh mengajukan permintaan koreksi (antrean dari PR #248). |
| K01 | Rekam medis yang sudah dibayar: dokter boleh menambah **adendum** diagnosa/terapi (teks, tercatat siapa & kapan). Tagihan, obat, stok tidak berubah. |

## Keuangan & gaji

| ID | Aturan |
|----|--------|
| J03 | Refund klinik per baris invoice, qty ≤ yang masih bisa direfund. Pembayaran balik tunai/transfer memakai alur yang sama dengan petshop (transfer: antrean pending→selesai). Tanpa biaya admin. Jasa/tindakan/racikan yang sudah terpakai: hanya uang kembali, stok tidak kembali. Obat utuh: stok kembali bila ditandai layak jual. Poin yang didapat dari transaksi dikurangi proporsional (tidak di bawah 0). Komisi dihitung dari penjualan bersih setelah refund pada periode refund terjadi. |
| I02 | Selisih stok opname di semua cabang (toko & klinik) diperlakukan sama: kurang = beban selisih persediaan, lebih = pengurang beban selisih persediaan (akun yang sama). Tidak lagi jadi piutang ke toko pusat. |
| R04 | Nilai stok minus dihitung dengan HPP rata-rata terakhir yang diketahui (bukan "tidak diketahui"), dan baris diberi tanda. |
| P02 | Koreksi harga pembelian setelah sebagian barang terjual (OWNER saja, dengan pratinjau dampak): selisih untuk sisa stok masuk nilai persediaan (rata-rata ulang); selisih untuk bagian yang sudah terjual masuk HPP periode berjalan via jurnal. Koreksi qty hanya boleh bila sisa stok cukup; hapus faktur tetap ditolak bila barang sudah terpakai. |
| H05 | Baris komponen yang berasal dari paket ditandai asal paketnya. Omzet & komisi paket dihitung dari baris paket; komponen paket tidak dihitung lagi sebagai penjualan/komisi normal. Contoh 3 bundle + 1 normal: komisi SKU normal = 1, aturan paket = 3. |
| H06 | Insentif visit ranap dihitung dari catatan visit dokter yang nyata: maksimal 1 visit terhitung per dokter per rawat inap per tanggal. Tarif per visit diatur di pengaturan komisi. Dasar = visit dikerjakan, bukan ditagih. |
| H02 | Template slip gaji per kelompok (mis. groomer, dokter lama). Karyawan ditautkan ke satu template; pengecualian per karyawan eksplisit dan tercatat. |
| H03/H04 | Lanjutkan draft PR #219/#226/#229/#232 (komponen gaji berbasis omzet, kelompok komisi + pengecualian, laporan dasar komisi). Tidak ada tarif contoh rapat yang di-hardcode. |
| C05 | Kode kampanye ditautkan ke voucher/promo yang ada; batas pemakaian per kode opsional; hanya OWNER/ADMIN yang membuat. Lanjutkan draft #225/#228/#236. |
| Q01 | Lanjutkan draft #197: struk Rp0 tidak dihitung customer baru; kartu pelanggan yang dibuat sebelum periode quest bukan customer baru; retur penuh tanpa void tidak membatalkan klaim. |
| I08/I09 | Lanjutkan draft #235 (biaya produksi moving average) dan #224 (jejak bahan produksi ke racikan). |

## Bukan pekerjaan kode

- M02 cutover: operasional 28 Okt–1 Nov sesuai runbook `docs/runbooks/2026-10-28-cutover-kamo.md`.
- O01 billing infrastruktur: keputusan pembelian langganan, di luar kode.
- O02 rekaman alur lapangan: menunggu rekaman dari klinik.
- C06 WhatsApp otomatis: ditunda oleh rapat sampai alur inti stabil.
