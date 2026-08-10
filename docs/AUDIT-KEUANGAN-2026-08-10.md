# Audit Modul Keuangan — 10 Agustus 2026

Status: **selesai diperbaiki 2026-08-10.** 17 temuan audit + 2 temuan baru yang muncul
saat perbaikan diuji. Dokumen ini menyimpan temuan, perbaikannya, dan buktinya.

Cakupan: Keuangan (COA, Jurnal Umum, Buku Besar, Neraca Saldo, Neraca, Laba Rugi,
Arus Kas, Piutang, Hutang, PPN, Aset Tetap, Rekonsiliasi, Tutup Buku, Sinkron,
Jurnal Berulang, Saldo Awal), Kas & Bank, Buku Besar/Anggaran, plus semua jalur yang
menulis jurnal (POS, kasir, klinik, pembelian, penjualan, HRIS, opname).

Metode: baca kode seluruh jalur `postJournal` (37 file) + uji data produksi lewat SQL
+ uji manual di browser (login OWNER) + unit test.

---

## 1. Hasil akhir

| Cek | Sebelum | Sesudah |
|---|---|---|
| Unit test | 618 lulus | **636 lulus, 0 gagal** |
| `tsc --noEmit` | bersih | bersih |
| `next build` | bersih | bersih (0 error) |
| Total Aktiva di Neraca | **−17.083 (negatif)** | **12.795.000** |
| Persediaan (1301) | **−610.000** | **180.000** (= nilai stok fisik) |
| Aset Tetap (1501) | 0 (padahal disusutkan) | **12.000.000** |
| Akumulasi Penyusutan | +822.083 (menambah aktiva) | **−800.000** (mengurangi, benar) |
| Neraca seimbang | ya (tapi isinya salah) | ya, dan isinya benar |
| Transaksi tanpa jurnal | 0 terdeteksi (3 jenis) | 0, deteksi diperluas ke 7 jenis lagi |
| Tutup Buku mengunci periode | **tidak** (senyap) | **ya** (terbukti menolak transaksi) |

Migrasi baru: `supabase/migrations/0106_audit_keuangan.sql` (sudah diterapkan).

---

## 2. Temuan & perbaikannya

### T1 — Tidak ada mekanisme Saldo Awal (PEMBLOKIR) ✅
Aset bersumber "saldo-awal" tidak pernah dijurnal tapi tetap disusutkan; stok awal masuk
tanpa jurnal Dr 1301. Akibatnya Persediaan & Aset Tetap minus dan Total Aktiva negatif —
Neraca tetap "seimbang" karena selisihnya jatuh ke laba berjalan, jadi lampu hijaunya menipu.

**Perbaikan:** layar baru **Keuangan → Saldo Awal** (`/keuangan/saldo-awal`).
- Membandingkan kondisi nyata (sisa lapisan stok × modalnya, total harga perolehan aset,
  total penyusutan yang sudah jalan) dengan saldo akunnya, lalu menampilkan selisih yang
  perlu dimasukkan. Sudah cocok → selisih 0, tidak ada yang diposting.
- Harta & utang diisi, **selisihnya otomatis jadi Modal Pemilik (3101)** — itu memang
  definisi modal, sekaligus jaminan jurnalnya tidak mungkin timpang.
- Satu jurnal saja (dijaga unique index); bisa dihapus & diisi ulang sebelum go-live.
- Logika murni di `src/lib/saldo-awal.ts`, 8 test.

**Bukti:** jurnal `JRN-202608-0011` — Dr 1301 790.000, Dr 1501 12.000.000,
Dr 1509 22.083, Cr 3101 12.812.083. Neraca setelahnya: Aktiva = Pasiva = 12.795.000.

### T2 — Jurnal bisa gagal diam-diam di 20+ jalur ✅
`postJournal` sengaja *best-effort*; pengaman `cekPeriode` hanya ada di 11 jalur.

**Perbaikan:** `cekPeriode` dipasang di **semua** jalur yang menulis jurnal —
checkout kasir, POS transaksi, pembayaran & pengeluaran klinik, tutup shift (POS/klinik/kasir),
opname, koreksi stok, penerimaan barang, faktur & pembayaran & retur pembelian,
retur penjualan, pelunasan piutang, beban, rekonsiliasi, aset. Dicek **sebelum** baris
operasional ditulis, jadi tidak ada dokumen yatim.

Halaman **Sinkron** dapat bagian kedua: *Dokumen Lain Tanpa Jurnal* — faktur pembelian,
pembayaran hutang, penggajian, kas masuk/keluar, transfer rekening, retur jual & beli.
Sengaja **deteksi saja tanpa posting ulang otomatis**: akun lawannya tergantung isi
dokumen, menebaknya justru menghasilkan jurnal salah yang terlihat beres.

**Bukti:** dengan periode dikunci s/d 2026-08-31, mencatat beban ditolak dengan pesan
"Periode akuntansi s/d 2026-08-31 sudah ditutup" dan **0 baris tertulis** di tabel expenses.

### T3 + T10 — Dashboard baca sumber usang ✅
Kartu "Pembelian belum lunas" membaca `po_payments` yang sudah tidak ditulis layar mana pun
→ semua PO selalu dilaporkan belum dibayar. Kartu "Saldo Kas" masih kode mati 1101/1102.

**Perbaikan:** pembelian dihitung dari `purchase_invoice_payments` + retur; saldo kas dari
`kodeSemuaRekening()` — sama sumbernya dengan laporan Arus Kas.

### T4 — Retur penjualan salah akun & abaikan PPN ✅
Refund selalu Cr 1101 Kas walau struk aslinya transfer/QRIS; PPN Keluaran tidak dibalik.

**Perbaikan:** memakai `kodeKasJurnalAsal()` (akun yang benar-benar dipakai jurnal aslinya)
+ `splitPpnInklusif`. Baris `expenses` refund juga mengikuti metode bayar aslinya, dan
hanya refund TUNAI yang ditempel ke shift kasir.

### T5 — Edit invoice klinik tidak sinkron HPP & stok ✅
Jurnal pendapatan di-resync, tapi jurnal HPP tidak dan stok obat tidak disesuaikan.

**Perbaikan:** fungsi `kembalikanStokObat()` mengembalikan obat baris lama ke gudang
dengan modal yang tercatat di barisnya, lalu stok baru dipotong; jurnal `klinik-hpp-edit`
membalik HPP lama dan memposting yang baru. Sekalian diperbaiki: baris hasil edit dan
hasil Void & Reissue dulu kehilangan `item_id`/`hpp` sehingga tidak bisa diretur/dinilai.

### T6 — Rekonsiliasi bank tidak memfilter tanggal ✅
Saldo buku dijumlah dari SELURUH mutasi lalu dibandingkan dengan rekening koran per
tanggal tertentu. **Perbaikan:** dibatasi `<= tanggal rekonsiliasi`.

### T7 — Buku Besar detail: saldo berjalan mulai dari nol ✅
**Perbaikan:** `getAccountOpening()` di `lib/ledger.ts` + baris "Saldo awal per <tanggal>"
di layar. **Bukti:** akun 1301 difilter dari 5 Agu kini berakhir di Rp 180.000, sama
dengan saldo akunnya.

### T8 — Jurnal bulan berjalan bertanggal masa depan ✅
Penyusutan diposting `periode-28` dan jurnal berulang `periode-day_of_month`, walau
tanggalnya belum tiba (terbukti: jurnal 28 Agustus sudah ada pada 10 Agustus).

**Perbaikan:** `periodeBelumSelesai()` — penyusutan hanya untuk bulan yang SUDAH lewat
(satu penjaga untuk cron, catch-up, dan tombol manual). Jurnal berulang melewatkan bulan
berjalan sampai tanggal jatuhnya terlewati.

### T9 — Jurnal berulang: `last_posted` naik walau gagal ✅
**Perbaikan:** hanya maju sejauh periode yang jurnalnya terbukti ada (`jurnalTersimpan`),
dan berhenti di periode pertama yang gagal.

### T11 — Zona waktu server UTC, bukan WIB ✅
68 tempat memakai `new Date().toISOString()` sebagai "hari ini" → transaksi 00:00–07:00 WIB
tercatat mundur sehari.

**Perbaikan:** helper tunggal `hariIniWIB()` di `lib/tanggal.ts`, dipakai di **60 file**;
`TZ=Asia/Jakarta` ditambahkan di `vercel.json`. Sekalian: `hariIniWIB` yang dulu numpang
di `lib/followup.ts` dipindah ke `lib/tanggal.ts` supaya tidak ada dua sumber kebenaran.

### T12 — Tidak ada kunci anti-jurnal-dobel ✅
**Perbaikan:** unique index **parsial** `journal_entries_sekali_saja` pada
(source, source_ref) untuk 20 jenis dokumen yang wajib dijurnal tepat sekali. Sengaja
parsial: `klinik-ar` (cicilan), `klinik-edit` (pasangan balik+ulang), dan `depreciation`
(aset baru menyusul periode yang sama) memang sah punya lebih dari satu.

### T13 — Akumulasi Penyusutan diberi saldo normal Debit ✅
**Perbaikan:** master dibetulkan jadi Kredit; laporan memakai `nilaiSeksi()` yang membuat
akun kontra otomatis jadi PENGURANG kelompoknya — tanpa daftar kode akun yang harus
dirawat manual. Diuji termasuk kasus neraca tetap seimbang.

### T14 — Umur piutang klinik dari tanggal invoice — **bukan bug** ⚠️
Diperiksa ulang: tagihan klinik tidak punya termin (bayar saat itu juga), jadi tanggal
invoice MEMANG tanggal jatuh temponya. Hutang & faktur reseller sudah pakai `jatuh_tempo`,
dan `agingDays` menjepit nilai negatif ke 0 sehingga faktur yang belum jatuh tempo masuk
"Berjalan". Tidak ada yang diubah.

### T15 — Kode mati jalur hutang ✅
`keuangan/hutang/actions.ts` (`bayarHutang` → `po_payments`) dihapus. Guard di retur
pembelian yang juga membaca `po_payments` dipindah ke `purchase_invoice_payments` —
sebelumnya PO yang sudah lunas dianggap masih berhutang penuh.

### T16 — Refund retur muncul juga di daftar pengeluaran ✅
Buku besar sudah benar (tidak dobel). Baris `expenses` memang perlu ada supaya kas keluar
dari laci ikut terhitung saat tutup shift. Yang diperbaiki: metode bayarnya kini mengikuti
struk aslinya, dan hanya yang tunai yang ditempel ke shift — jadi refund transfer tidak
lagi mengurangi kas fisik kasir secara keliru.

### T17 — Neraca tanpa filter cabang + `branchIds` hilang di arus kas ✅
**Perbaikan:** Neraca dapat filter cabang; `getCashMovements` meneruskan `branchIds`
saat menghitung saldo awal.

---

## 3. Temuan BARU saat perbaikan diuji

### T18 — Tutup Buku tidak mengunci apa pun (PARAH) ✅
Tabel `accounting_locks` adalah tabel satu-baris, dan **barisnya tidak ada** di database.
`update ... where id` karenanya mengenai 0 baris tanpa error: layar melaporkan
"periode dikunci" padahal tidak ada yang terkunci, dan trigger pengamannya membaca null
(= periode selalu terbuka). Seluruh fitur Tutup Buku praktis mati, dan melapor sukses.

**Perbaikan:** barisnya dibuat (migrasi 0106) + kode pindah dari `update` ke **upsert**,
dan kegagalan mengunci setelah jurnal penutup diposting kini dilaporkan sebagai error,
bukan didiamkan.

### T19 — Tanggal "hari ini" dipaku mati di 4 layar ✅
`const today = "2026-07-01"` di layar Pengeluaran (POS & kasir) dan dua form persediaan
kasir — ringkasan "hari ini"/"bulan ini" berhenti di 1 Juli 2026 selamanya.
**Perbaikan:** diganti `hariIniWIB()`.

---

## 4. Catatan sisa (tidak diubah, perlu keputusan)

- Jurnal penyusutan **28 Agustus 2026** (Rp 222.083) sudah terlanjur ada di database dari
  sebelum perbaikan T8, dan periode 2026-08 sudah tercatat di `asset_depreciations`.
  Tidak dihapus — menghapus jurnal historis bukan keputusan teknis. Kalau angkanya mau
  bersih, hapus jurnal itu beserta baris penyusutan Agustus lalu jalankan ulang 1 September.
- Nilai Rp 22.083 di saldo awal berasal dari dua aset lama yang sudah dihapus tapi
  jurnal penyusutannya tertinggal. Sudah dinetralkan lewat saldo awal.
