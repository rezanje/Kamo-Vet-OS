# Rawat Inap · Obat Khusus: beberapa racikan sekali Simpan (11 Nov 2026)

## Laporan
Grup klinik (Babibu, Kamo Pets Clinic Ciomas): "saya gak bisa nambah BPHM". Screenshot layar
Rawat Inap → Obat Khusus pasien Dulaf, keranjang berisi 2× "Obat Racik Probiotik" (racikan).
Tombol Simpan ditahan dengan pesan kuning "Simpan satu racikan per penambahan…".

## Akar masalah
`clinic_add_inpatient_billables` (migrasi 20261104120000) menolak `p_compounds` > 1
(`COMPOUND_BATCH_UNSUPPORTED`) — checkpoint sengaja: banyak racikan dalam satu transaksi memegang
kunci stok bahan berbeda sampai COMMIT, dan urutan kunci global antar pasien belum diverifikasi
(risiko deadlock). Form klien meniru penolakan itu, jadi pengguna harus menyimpan racikan satu per satu.

## Perubahan (tanpa migrasi, database tidak diubah)
- `saveInpatientEntry` (jalur Obat Khusus / billables): keranjang dengan >1 racikan dipecah menjadi
  simpanan berurutan — simpanan 1 = semua obat/jasa/tindakan+BMHP + racikan pertama (kunci draf asli),
  simpanan k = racikan ke-k saja (kunci `<kunci draf>:racikan-k`). Tiap simpanan tetap satu transaksi
  satu racikan, sesuai batas database.
- Idempoten: kunci draf dipulihkan setelah redirect galat, jadi Simpan ulang memutar ulang simpanan yang
  sudah masuk (hash sama) dan hanya melanjutkan yang belum. Bila baris yang sudah masuk diubah, database
  menolak dengan IDEMPOTENCY_CONFLICT (gagal aman, tidak tertagih dua kali).
- Gagal di tengah: pesan menyebut racikan yang sudah masuk tagihan dan yang belum beserta alasannya;
  halaman tagihan/stok direvalidasi.
- Penolakan klien "Simpan satu racikan per penambahan" dihapus; teks bantuan diperbarui.
- Jalur Laporan Visit (log harian) tidak berubah.

## Uji
- `src/lib/__tests__/inpatient-billables-multi-racikan.test.ts` (baru): pemecahan, kunci turunan,
  satu racikan tetap satu simpanan, gagal di tengah, gagal di awal.
- `clinic-tindakan-racikan-form.test.tsx`: keranjang 2 racikan kini terkirim.
- Full vitest 890 file lulus; tsc bersih; eslint 0 error; `next build` lulus.

## Belum diuji
- Simulasi di Production dengan racikan sungguhan (perlu dicoba staf klinik setelah deploy).
