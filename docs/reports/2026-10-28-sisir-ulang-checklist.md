# Sisir ulang checklist KAMO — 28 Oktober 2026

Sumber: Google Sheet "KAMO — Checklist Feedback Meeting — 85 Butir" (tab Checklist), termasuk kolom audit
"Audit 29 Okt 2026" (aturan centang baru: G hanya bila seluruh cakupan teknis selesai & live). Dicocokkan dengan
main `66c7672`.

Hasil: 85 butir; 56 Live, 29 belum Live (Parsial 26, Belum mulai 2, Terhalang 1).

## A. Celah kode tanpa keputusan baru — dikerjakan di batch ini

| ID | Celah dari audit | Tindakan |
|----|------------------|----------|
| R02 | Omzet klinik per cabang/hari belum dikurangi refund klinik (J03) | Kurangi refund klinik di laporan omzet harian |
| A02 | Peringatan pending di dashboard tidak menghitung refund transfer klinik | Masukkan refund transfer klinik ke alert |
| A01 | Tabel baru setelah 24 Okt belum masuk log aktivitas umum | Pasang trigger audit + tes cakupan |
| K08 | Pemulangan ranap ulang hanya menagih periode terakhir; tes SQL pemulangan gagal | Perbaiki tagihan + tes |
| C05 | Kode kampanye ditolak di bayar rombongan klinik & belum ada di POS back-office | Dukung di kedua jalur |
| Q01 | Progres quest bisa hilang bila langkah terpisah gagal; tidak jalan dari POS back-office | Progres bisa dipulihkan, panggil dari POS back-office |

## B. Keputusan pemilik/finance

**Disetujui Reza 29 Okt 2026: "A" — semua rekomendasi di kolom kanan dipakai.** Finance boleh mengoreksi belakangan.

| ID | Pertanyaan audit | Rekomendasi |
|----|------------------|-------------|
| P02 | Koreksi satuan & qty faktur dari PO setelah terjual: cukup lewat Retur, atau dibangun? | Cukup lewat Retur Pembelian |
| P03 | Kasir klinik & paket Grup ikut diblok di bawah HPP? Back office/grosir boleh di bawah HPP? | Klinik ikut diblok (obat/barang saja, jasa bebas); grosir/back office boleh dengan peringatan |
| J02 | Koreksi metode bayar setelah shift ditutup dibuka? Klinik ikut? | Buka untuk OWNER/FINANCE dengan jurnal koreksi; klinik ikut |
| I02 | Opname lama tanpa jurnal & jurnal 5101/piutang lama | Dijurnal manual sekali oleh finance, sistem tidak mengubah otomatis |
| M04/M01 | Pembulatan sen nilai stok saat posting 31 Okt | Bulatkan ke rupiah penuh per baris, selisih total dicatat |
| H05 | Komisi paket yang dijual >1 penjual | Dibagi rata antar penjual baris paket |
| K07 | Perlu alur bayar ranap harian di muka? | Tidak sekarang; tetap tagih saat pulang |
| J01 | Batal-terbit ulang/refund/retur diterima sebagai alur koreksi final? | Ya |
| N01 | Retur pembelian dialokasikan ke faktur tertentu? | Cukup per PO dulu |
| N01 | Retur faktur grosir/B2B: sistem belum punya dokumen retur grosir (retur hanya untuk struk POS), jadi tautan faktur↔retur tidak bisa dibuat tanpa skema baru | Buat dokumen retur grosir tertaut faktur (stok kembali, piutang/saldo pelanggan dikurangi) |
| K08 | Kunjungan dengan invoice belum lunas masih bisa langsung masuk ranap, lalu tidak bisa dipulangkan selama invoice aktif | Wajib lunasi/batalkan invoice dulu sebelum masuk ranap |
| A01 | Riwayat permintaan refund (petshop & klinik) tampil di log untuk OWNER/ADMIN walau tabelnya tertutup | Pertahankan (sesuai desain refund) |
| C05 | Kode voucher asli yang ditautkan ke kampanye boleh dipakai langsung? | Diblok, wajib lewat kode kampanye |
| K06 | Terima "kunjungan lanjutan tertaut" pengganti "kunjungan yang sama"? | Terima |
| I09 | Definisi masuk/keluar induk racikan nonstok; halaman histori per SKU induk? | Masuk = racikan dibuat, keluar = racikan terjual; buat halaman histori |
| R06 | Grooming lewat kasir petshop ikut dihitung? | Ya, ikut dihitung |
| K14 | Pet hotel check-in tanpa dokter? Tarif tersendiri? | Boleh tanpa dokter (paramedis); tarif pet hotel tersendiri |
| T01 | Siapa uji reboot printer | Kasir cabang, dicatat di formulir PR209 |
| A02 | WhatsApp tetap di luar cakupan? | Ya |

## C. Bukan pekerjaan kode / menunggu data atau UAT

M01, M02 (cutover 28 Okt–1 Nov sesuai runbook), M04 (impor file target sampai posting), R04 (sisa butuh data
histori), U07 (ukur di production setelah transaksi nyata), I08 (biaya non-bahan & lintas cabang = keputusan
finance), O01, O02, C06.

## Catatan sheet

Kolom "Yang sudah jadi"/"Sisa" pada T01, R02, R06, A02, O01, O02, C06 masih berisi teks butir lain (tergeser).
Status/checkbox sesuai ID. Perlu dirapikan pemegang sheet (Wowo).

## Hasil batch ini (branch `claude/dazzling-hawking-q1a4b6`)

| ID | Perubahan | Migrasi |
|----|-----------|---------|
| R02 | Omzet per cabang & per hari (dan rincian penjualan) dikurangi refund klinik, pada tanggal/cabang invoice asal — sama dengan perlakuan retur petshop | — |
| A02 | Alert pending dashboard & notice Kas-Bank menghitung refund transfer klinik | — |
| K08 | Pemulangan ulang menagih total hari semua periode dikurangi yang sudah ditagih; buka ulang ranap ditolak bila ada invoice aktif; skrip review kunjungan lunas-belum-selesai (tidak dijalankan) | `20261030110000_k08_inpatient_redischarge_days.sql` |
| A01 | 16 tabel bisnis baru masuk log aktivitas + tes cakupan semua tabel | `20261030111000_a01_activity_audit_new_sources.sql` |
| C05 | Kode kampanye di bayar rombongan klinik (dihitung sekali per kedatangan) & POS back-office | — |
| Q01 | Progres quest yang gagal dipulihkan otomatis tanpa hitung ganda; POS back-office ikut | `20261030112000_q01_staff_effects_recovery.sql` |

Verifikasi gabungan: lint 0 error; typecheck lulus; vitest 567 berkas/4.203 tes lulus; build lulus; SQL lokal
PostgreSQL 16 (semua migrasi): A01 coverage, K08 (6 suite + skrip review), C05/Q01 (12 suite + 2 uji konkurensi)
lulus. Belum: apply migrasi production, UAT pengguna.
