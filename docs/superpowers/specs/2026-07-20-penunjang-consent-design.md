# Foto Penunjang + Form Persetujuan — Design Spec

**Tanggal:** 2026-07-20
**Modul:** Klinik (rekam medis, dokumen, rawat inap) + storage

## Masalah

Dua kekurangan di form rekam medis:

1. **Hasil pemeriksaan penunjang cuma teks.** Lab, rontgen, dan USG hasilnya gambar —
   dokter tidak bisa melampirkan apa pun, hanya mengetik ringkasan.
2. **Form persetujuan tidak ada.** Halaman dokumen menampilkan
   `Form Persetujuan: Ditandatangani` yang **hardcoded** — tidak ada tabel, tidak ada
   form, tidak ada tanda tangan. PRD v2.0 §6.3 mensyaratkan consent digital untuk
   tindakan operasi/bedah.

## Keputusan (hasil brainstorming)

- TTD **digital di layar** (canvas), bukan upload scan TTD basah.
- Template consent berupa **teks yang diedit di aplikasi**, mendukung placeholder yang
  terisi otomatis. Bukan upload file PDF/DOCX.
- Consent ditujukan untuk **tindakan berisiko** saja, bukan semua kunjungan.
- Bucket storage baru yang **privat** untuk foto medis; TTD tidak masuk storage sama
  sekali (lihat bagian Keamanan).
- Halaman kelola template ada di **modul Klinik**, bukan Pengaturan.

## A. Foto hasil pemeriksaan penunjang

### Data

Kolom baru `medical_records.penunjang_urls text[]`, bukan tabel terpisah.

Alasan: foto di-upload saat form masih diisi, sementara baris `medical_records` baru
dibuat ketika form disubmit. Dengan array kolom, URL cukup ditampung di state klien
lalu dikirim bersama form — persis pola `photo_url` di registrasi pasien. Tabel
terpisah akan memaksa insert dua tahap tanpa manfaat yang dipakai sekarang.

### Alur

Di `RekamForm`, baris "Hasil Pemeriksaan Penunjang" dapat tombol upload. Bisa lebih
dari satu file. Setiap file di-upload langsung ke storage, URL-nya masuk state, dan
thumbnail-nya tampil dengan tombol hapus. URL dikirim sebagai hidden input JSON.

Foto ikut tampil di halaman dokumen (`/klinik/rekam-medis/[visitId]/dokumen`).

## B. Form persetujuan

### Data

**`consent_templates`** — dikelola admin.

| Kolom | Keterangan |
|---|---|
| `nama` | Nama template, mis. "Persetujuan Tindakan Operasi" |
| `isi` | Teks isi, mendukung placeholder |
| `branch_id` | Kosong = berlaku semua cabang |
| `is_active` | Nonaktifkan tanpa menghapus |

Placeholder yang didukung: `{nama_pemilik}`, `{nama_hewan}`, `{jenis_hewan}`,
`{tindakan}`, `{dokter}`, `{cabang}`, `{tanggal}`.

**`consents`** — satu baris per form persetujuan.

| Kolom | Keterangan |
|---|---|
| `visit_id` | Kunjungan terkait |
| `template_id` | Referensi template, boleh null kalau template dihapus |
| `tindakan` | Nama tindakan yang disetujui |
| `isi_snapshot` | **Salinan teks hasil render saat form dibuat** |
| `signer_name` | Nama penanda tangan |
| `signature_data` | Gambar TTD (data URL PNG dari canvas) |
| `signed_at` | Waktu TTD, null = belum ditandatangani |
| `status` | `belum_ttd` / `sudah_ttd` |

`isi_snapshot` wajib ada dan tidak boleh diganti. Kalau admin mengedit template bulan
depan, form yang sudah ditandatangani harus tetap menunjukkan apa yang benar-benar
disetujui saat itu. Menyimpan hanya `template_id` akan membuat isi dokumen berubah
surut — tidak bisa diterima untuk dokumen berkekuatan hukum.

### Alur

1. Staff klik "Buat Form Persetujuan" di rekam medis.
2. Pilih template, isi nama tindakan.
3. Placeholder ter-render otomatis dari data kunjungan, hasilnya disimpan sebagai
   `isi_snapshot` dengan status `belum_ttd`.
4. Pemilik membaca di layar lalu tanda tangan di canvas.
5. Status berubah jadi `sudah_ttd`, tersimpan bersama nama dan waktu.

Status tampil sebagai badge: **Belum TTD** (merah) atau **Sudah TTD** (hijau, dengan
nama penanda tangan dan waktu). Tersedia tampilan cetak.

### Soal "wajib untuk tindakan berisiko"

Sistem belum punya kategori tindakan — jasa masih teks bebas (`nama_obat` di
`prescription_items`), jadi tidak mungkin mendeteksi otomatis mana yang operasi.

Karena itu consent **dibuat atas inisiatif staff**, tapi halaman rawat inap
menampilkan peringatan kalau pasien diinapkan tanpa consent yang sudah ditandatangani.

Consent yang benar-benar **memblokir** tindakan butuh kategorisasi tindakan lebih
dulu (PRD §6.3: Konsultasi/Vaksinasi/Operasi/Grooming/Rawat Inap/Lab) — itu pekerjaan
terpisah dan sengaja tidak dikerjakan di sini.

## Keamanan

Bucket `pet-photos` yang ada sekarang **publik** — siapa pun yang tahu URL bisa
membukanya. Foto rontgen dan hasil lab tidak boleh diperlakukan begitu.

- Bucket baru **`medical-docs`, privat**. Dibaca lewat signed URL yang dibuat
  server-side saat halaman dirender. Upload tetap dari klien, dibatasi RLS
  `storage.objects` untuk pengguna terautentikasi.
- **Tanda tangan tidak masuk storage.** Canvas menghasilkan PNG kecil (±5–15 KB),
  disimpan sebagai data URL di kolom `signature_data`. Dengan begitu TTD terlindungi
  RLS tabel `consents` dan tidak pernah punya URL sendiri yang bisa bocor.

## Halaman

| Rute | Isi |
|---|---|
| `/klinik/persetujuan` | Kelola template (admin) — daftar, buat, edit, aktif/nonaktif |
| `/klinik/rekam-medis/[visitId]` | Bagian consent: buat, tanda tangan, status |
| `/klinik/rekam-medis/[visitId]/dokumen` | Status consent asli (ganti yang hardcoded) + foto penunjang |
| `/klinik/rawat-inap/[id]` | Peringatan kalau belum ada consent bertanda tangan |

## Yang tidak dikerjakan

- Kategorisasi tindakan dan pemblokiran consent — butuh perubahan model data resep.
- Migrasi `pet-photos` ke bucket privat — di luar cakupan, foto hewan bukan data medis.
- Upload file selain gambar (PDF hasil lab) — tambahkan kalau memang diminta.
