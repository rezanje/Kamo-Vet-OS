# Koreksi tagihan rawat inap yang sudah lunas: hari inap dikurangi, selisih jadi item lain (11 Nov 2026)

## Pertanyaan (rekaman suara, 56 detik)
Tagihan rawat inap sudah dibayar (mis. 3 hari), ternyata pasien hanya 1–2 hari. Hari inap diubah 3 → 2,
selisihnya (mis. Rp100.000) dipindah ke item yang benar-benar dipakai pasien (pakan, konsumsi, dll).
Di mana caranya? Kasus ini sering di lapangan.

Catatan transkrip: "nyoksi" dibaca "konsumsi"; "kemasajik" tidak jelas, diasumsikan nama item/jasa lain.

## Jawaban: jalurnya sudah ada (tanpa kode baru)
Alur yang sudah terpasang, hanya untuk peran OWNER / ADMIN / FINANCE, shift klinik terbuka:

1. Klinik → Pembayaran pasien itu (layar Tagihan rawat inap).
2. Riwayat tagihan → buka nomor tagihannya → **Kelola dokumen ini (alur koreksi terpisah)**.
3. **Void & Terbitkan Ulang**, isi alasan. Uang yang sudah masuk (termasuk uang muka) dipindah ke tagihan
   pengganti; nomor lama batal, tanggal transaksi tetap tanggal asli (migrasi 20261111035704).
4. Kembali ke riwayat tagihan → buka tagihan pengganti (status menunggu koreksi) → **Kelola dokumen ini** →
   form koreksi: ubah qty jasa rawat inap 3 → 2, tambah baris pakan/konsumsi dari master, isi alasan, simpan.
5. Bila total baru = uang yang sudah masuk → tagihan langsung Lunas lagi. Stok pakan terpotong, jurnal
   koreksi dan HPP bertanggal hari koreksi, jejak tersimpan di Riwayat perubahan.

Dasar kode: `clinic_void_reissue_invoice` (+ `_core`), `clinic_edit_invoice_with_record` →
`clinic_edit_invoice` (`supabase/migrations/20260929120000_clinic_billing_lifecycle.sql`, ditambal
`20261103010000_ranap_mitigasi_audit.sql`), layar `src/app/(app)/klinik/pembayaran/[visitId]/page.tsx`
(VoidReissueForm, PembayaranForm `editMode`) dan tautan "Kelola dokumen ini" di `InpatientPaymentPage.tsx`.
Tes ranap: `scripts/test-ranap-mitigasi-postgres.py` (FIN-02/FIN-03: terbit ulang tagihan tahap membawa kwitansi).

## Batasan yang ditegakkan database
- **Total baru tidak boleh lebih kecil dari uang yang sudah masuk** (`INVOICE_INVALID: nilai koreksi tidak
  konsisten`, syarat `v_total >= dp_amount + credit`). Kalau selisih tidak diganti item apa pun (murni
  kelebihan bayar), jalur ini menolak. Jalan lain yang ada: "Tarik baris (Owner)" — tapi hanya baris PENUH,
  tidak bisa mengurangi qty 3 → 2; sisanya jadi saldo uang muka lalu bisa dikembalikan lewat
  "Kembalikan saldo uang muka".
- **Tagihan yang berisi racikan** (atau obat tanpa kode barang) ditolak terbit ulang/koreksi
  (`INVOICE_INVALID: tagihan ini perlu pemeriksaan keuangan`). Banyak tagihan ranap berisi racikan.
- Tagihan yang sudah dikoreksi metode bayar / sedang direfund tidak menampilkan tombol terbit ulang.
- Langkahnya 2 kali bolak-balik ke riwayat tagihan (sesudah terbit ulang, layar kembali ke kasir ranap,
  bukan langsung ke form koreksi).

## Belum diverifikasi
- Belum dicoba klik langsung di Production (akses database Production tidak tersedia di sesi ini).
  Kesimpulan di atas dari pembacaan kode + tes otomatis yang ada.

## Usulan bila ingin dipermudah (belum dikerjakan, menunggu keputusan)
Satu tombol "Ubah tagihan ranap lunas (Owner)" di halaman koreksi yang sudah ada: ubah qty baris dan tambah
baris dalam satu layar; selisih kurang otomatis jadi saldo uang muka; mendukung tagihan berisi racikan
(racikan tetap tidak diubah, hanya baris lain). Pola sama dengan "Tarik baris (Owner)"
(`20261107150000_owner_tarik_baris_lunas.sql`).
