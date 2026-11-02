# Lampiran pengeluaran klinik · Stok opname gudang klinik/DC · Rekap closing semua cabang — 2 November 2026

Laporan grup klinik (Anisa 16.18 & 17.58, Andri 17.04).

| # | Laporan | Status |
|---|---|---|
| 1 | Permintaan barang klinik tidak bisa disimpan ("menunggu persetujuan") | Sudah dibetulkan di PR #414 (live 16.31 WIB). Di Production sudah ada permintaan klinik baru tersimpan 18.04 WIB. Tidak ada perubahan di batch ini. |
| 2 | Pengeluaran klinik tidak bisa melampirkan bukti | **Batch ini** |
| 3 | Menu hasil closing semua cabang klinik & petshop | Menu Riwayat Tutup Shift sudah ada sejak PR #411. **Batch ini** menambah rekap per cabang. |
| 4 | Item grouping belum muncul di klinik | Kode sudah live (PR #413). Akar sisa = data: 160 barang Grup hasil impor Accurate **nonaktif** dan hanya 2 yang punya isi paket. Perlu diisi + diaktifkan oleh tim (lihat bawah). |
| – | Perintah stok opname belum bisa dipakai untuk klinik / gudang | **Batch ini** |

## 2. Lampiran bukti pengeluaran klinik

Akar: layar klinik menulis `expenses` langsung dengan `bukti_url: null`; kasir petshop sudah memakai
`post_expense_atomic` (dokumen + lampiran + jurnal dalam satu transaksi, lampiran wajib).

- Migrasi `20261106060000_pengeluaran_klinik_lampiran.sql`: `post_expense_atomic` menerima konteks baru
  `clinic` = laci shift **klinik** milik pemanggil (cabang dari shift, bukan dari browser). Perilaku konteks
  `cashier` / `backoffice` tidak berubah. Deskripsi jurnal klinik tetap diawali "Pengeluaran klinik:".
- Akun tidak berubah: dicek di Production, `expense_account_code` = peta lama layar klinik
  (760003 / 720002 / 740001 / 740003 / 740007) dan `unit_posting_cash` = `kodeAkunBayar` (peta cabang → pusat →
  110003/120002).
- `klinik/pengeluaran`: form memakai `ExpenseForm` + `LampiranPicker wajib` (sama dengan kasir), request key
  idempoten, tombol "Periksa Hasil Simpan" kembali ke `/klinik/pengeluaran`. Tanpa shift klinik → form diganti
  pesan "Mulai shift klinik dulu".
- Daftar pengeluaran klinik punya kolom **Bukti** (signed URL 1 jam; gagal memuat lampiran tidak menjatuhkan halaman).
- Kartu "hari ini / bulan / tahun" kini memakai tanggal WIB (dulu tanggal server UTC → salah sebelum 07.00 WIB).

## Stok opname gudang klinik & DC

Akar: `/pos/opname` hanya daftar baca; membuat & menghitung hanya dari layar kasir **petshop**
(keputusan meeting 14 Agustus, satu pintu). Gudang klinik (VET) dan DC tidak punya kasir petshop → buntu.

- Tombol **Buat Perintah** → `/pos/opname/baru`: pilih gudang (yang boleh diakses, aktif, bukan TRANSIT),
  lingkup (bawaan "seluruh gudang" untuk non-toko, "otomatis" untuk toko), penanggung jawab, dikerjakan oleh.
  Barang gudang dibaca lengkap (lebih dari 1.000 baris aman).
- `/pos/opname/[id]`: perintah **Terbuka** untuk gudang **non-RETAIL** langsung menampilkan layar hitung yang sama
  dengan kasir (kunci per barang, simpan & sesuaikan stok). Gudang toko tetap dihitung dari kasir (aturan satu pintu).
- Tidak ada perubahan database: `bolehGudang`, `opname_posting_access`, `cancel_opname_draft` sudah mengizinkan
  pengguna dengan modul POS / Persediaan di cabang yang boleh diakses. Jurnal selisih memakai kebijakan seragam I02.
- Belum termasuk: staf klinik menghitung sendiri dari shift klinik (butuh perluasan izin di 4 fungsi basis data
  yang kini hanya mengenal shift petshop). Opsi lanjutan bila pemilik mau.

## Rekap closing semua cabang

`/pos/shift/riwayat` (menu Laporan / POS → Riwayat Tutup Shift) kini punya tabel **Rekap closing per cabang**
di atas daftar: per cabang × jenis (petshop/klinik) — jumlah shift, omset, tunai, non-tunai, selisih kas, plus
total semua cabang. Menjumlah **seluruh** rentang filter (bukan hanya halaman), dengan batas cabang yang sama.
Akun Anisa = OWNER, jadi melihat semua cabang.

## Paket (Grup) — tindak lanjut data

- Production: 160 barang `Grup`, semuanya `is_active = false` (impor Accurate 11 Sep: "Grup masuk nonaktif sampai
  rincian komponennya tersedia"). Hanya 2 yang punya isi paket: "Promo Vaccine F4" dan "Kimia Darah Lengkap".
- Cara mengaktifkan: Persediaan → Barang & Jasa → tampilkan nonaktif → buka paket → isi rincian isi paket → simpan
  → Aktifkan. Atau impor rincian Grup dari Accurate (Impor Barang) yang otomatis mengaktifkan.

## Tes

- `src/lib/__tests__/expense-actions.test.ts` — klinik memakai RPC atomik konteks `clinic` tanpa cabang dari browser;
  tanpa lampiran ditolak sebelum menyentuh basis data.
- `src/components/__tests__/transaction-correction-entrypoints.test.tsx` — link bukti tampil di daftar klinik.
- `src/components/__tests__/opname-gudang-klinik-dc.test.tsx` — VET & DC dihitung di backoffice; RETAIL tetap lewat kasir.
- `src/components/__tests__/rincian-tutup-shift.test.tsx` — rekap per cabang + filter cabang ikut.
