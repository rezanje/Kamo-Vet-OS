# Opname Granada — Meo Pouch Adult jadi +11 sesudah hitung ulang (25 Nov 2026)

Laporan: Faizal (grup Granada), OPO.00013 → hasil OPR.00012 (posting 24 Nov 18:49 WIB).

## Kronologi (stock_moves WH_GRND)
| Waktu WIB | Kejadian | Adult | Kitten |
|---|---|---|---|
| s.d. 24 Nov 17:56 | stok sistem | 11 | 1 |
| 24 Nov 17:56 | POS-20261124-0048-EQAN terjual 11 Adult + 1 Kitten | 0 | 0 |
| 24 Nov ±18:4x | Posting gagal: pesan "hitungan perlu diulang" (selisih kurang > stok sekarang) — perbaikan 24 Nov | | |
| 24 Nov 18:49 | Faizal buka kunci & kunci ulang: Adult fisik 11 (foto sistem 0), Kitten fisik 1 (foto 0) | | |
| 24 Nov 18:49 | OPR.00012: Adult +11, Kitten +1 (HPP 5.553,33/pcs) | 11 | 1 |
| 25 Nov 13:42 | Terima permintaan +48 Adult | 59 | 1 |

## Penyebab
- Kunci ulang = foto stok baru (stok saat itu = 0, sesudah penjualan 17:56). Itu memang rancangannya: hitungan
  = isi rak saat tombol Kunci ditekan; penjualan sesudahnya dipertahankan lewat selisih terhadap foto.
- Faizal mengisi 11 karena mengira hitungan = "stok awal saat opname dimulai", lalu sistem yang mengurangi
  penjualan. Karena fotonya sudah 0, angka 11 dibaca sebagai "di rak ada 11" → selisih lebih +11.
- Bukan salah hitung sistem; petunjuk "Buka kunci, hitung ulang fisiknya" ambigu dan layar hitung tidak
  menjelaskan bahwa yang diisi adalah isi rak sekarang.

## Dampak data
- Meo Pouch Adult: stok sistem kelebihan 11 (menurut keterangan Faizal fisik sesudah penjualan = 0).
  Nilai modal ±Rp 61.087 (11 × 5.553,33) tercatat sebagai selisih lebih; laporan menampilkan Rp 77.000 (harga jual).
- Meo Pouch Kitten: +1 (perlu dicek fisik).
- Stok sistem sekarang: Adult 59 (seharusnya ±48 bila tidak ada penjualan lain), Kitten 1.

## Koreksi yang disarankan (dilakukan toko, tidak ada ubah data langsung)
Buat opname kecil di Granada berisi Meo Pouch Adult & Kitten, hitung isi rak sekarang, simpan.
Selisih kurang −11 akan menetralkan selisih lebih kemarin (jurnal saling hapus). Membatalkan OPR.00012 utuh
tidak disarankan karena berisi 378 barang.

## Perbaikan produk (PR ini)
- Layar hitung: setelah tekan "Buka", muncul petunjuk "isi jumlah yang ada di rak SEKARANG… jangan isi stok awal
  opname"; teks judul & catatan bawah menegaskan barang yang laku sesudah dikunci otomatis diperhitungkan.
- Pesan gagal posting "perlu diulang" dipertegas di sisi server action (tanpa migrasi DB).
- Tes: opname-lock-confirmation + opname-posting-atomic-action (tes baru), seluruh tes opname 14 file / 90 tes lulus,
  tsc & eslint bersih.
