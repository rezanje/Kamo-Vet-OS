# Temuan B1 — "tidak bisa menambah beberapa obat racikan sekaligus" (rawat inap)

Status: investigasi selesai; Reza memilih **A** (12 Nov) — sudah dikerjakan di commit "B1: …".

## Kesimpulan
Bukan batasan desain dan bukan error di database. Formulir rawat inap (baik "Tambah obat / BMHP ke tagihan" maupun
"Laporan visit") **mendukung banyak racikan dalam satu simpan**. Yang paling mungkin terjadi adalah **jebakan alur di
layar**: racikan yang sedang disusun hilang tanpa peringatan bila dokter memilih racikan berikutnya sebelum menekan
"Tambah ke keranjang".

## Bukti
1. **Kode formulir** (`src/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm.tsx`):
   - racikan disusun di satu "builder"; tombol **"Tambah ke keranjang"** memindahkannya ke keranjang lalu builder dikosongkan
     (`addRacikanToCart` → `resetRacikan`), sehingga racikan kedua, ketiga, dst. bisa disusun dan masuk keranjang;
   - saat simpan, semua racikan di keranjang dikirim sekaligus (`saveInpatientEntry` → `compounds`, maks. 50 per simpan
     di database).
2. **Data Production 30 hari terakhir** (hanya baca): di rawat inap ada **20 kali simpan berisi lebih dari satu racikan**
   (paling banyak 8 racikan sekaligus), selain 65 kali simpan berisi satu racikan. Jadi jalurnya bekerja.
3. **Jebakan yang ditemukan** (`selectRacikan`): bila racikan A masih disusun (bahan sudah diisi) lalu dokter memilih racikan
   B dari daftar, isian racikan A **langsung dibuang** tanpa konfirmasi; yang masuk keranjang hanya racikan terakhir.
   Dari sudut pandang dokter: "hanya bisa satu racikan". Hal yang sama terjadi bila dokter memilih Tindakan saat racikan
   belum dimasukkan keranjang.

## Usulan perbaikan (bila disetujui)
- A (saran): saat memilih racikan/tindakan lain sementara racikan sebelumnya belum masuk keranjang, **tanyakan dulu**:
  "Masukkan racikan X ke keranjang dulu?" (Masukkan & lanjut / Buang / Batal). Plus teks bantu kecil di builder:
  "Klik Tambah ke keranjang untuk tiap racikan, lalu Simpan sekali di akhir."
- B: otomatis memasukkan racikan yang sudah lengkap ke keranjang saat dokter berpindah (tanpa tanya); yang belum lengkap tetap
  ditanya.

## Perlu konfirmasi ke pelapor
Mohon tim klinik (dokter pelapor) memastikan langkahnya: apakah racikan pertama "hilang" setelah memilih racikan kedua,
atau muncul pesan galat tertentu? Bila ada pesan galat, kirim screenshot pesannya — itu akan jalur lain dari temuan di atas.
