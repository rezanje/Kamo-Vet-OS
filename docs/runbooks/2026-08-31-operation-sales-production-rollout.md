# Runbook Rollout Production Operation & Sales

**Disusun:** 1 September 2026
**Lingkup:** migrasi master Accurate, saldo awal, data operasional klinik, dashboard Operation & Sales, alert operasional
**Keputusan saat ini:** **NO-GO** — dicatat 1 September 2026 setelah pemeriksaan otomatis
**Akses pilot:** OWNER/ADMIN saja. Peran lain tetap terkunci sampai seluruh gate lulus.

## Aturan evidence

- Status `LULUS` hanya boleh dipakai jika ada referensi perintah, query, atau screenshot yang dapat diperiksa ulang.
- `BLOCKED BY DATA` berarti input eksternal belum lengkap; nilai tidak boleh dibuat atau ditebak.
- Tes otomatis membuktikan perilaku kode, bukan membuktikan rekonsiliasi data produksi.
- Kolom penanda tangan dibiarkan kosong sampai orang berwenang benar-benar menandatangani.

## Pemeriksaan otomatis

| Pemeriksaan | Hasil | Evidence |
|---|---|---|
| Tes kode penuh | LULUS | `npm test` pada 1 Sep 2026: 106 berkas, 1.043 tes lulus |
| Pemeriksaan kualitas | LULUS DENGAN CATATAN | `npm run lint` pada 1 Sep 2026: tidak ada error; 12 peringatan lama di luar lingkup rollout |
| Pemeriksaan tipe | LULUS | `npx tsc --noEmit` pada 1 Sep 2026 |
| Build produksi | LULUS | `npm run build` pada 1 Sep 2026: 174 halaman berhasil dibuat |
| Reset database lokal | BELUM LULUS — BLOCKED BY ENVIRONMENT | `supabase db reset` pada 1 Sep 2026: layanan database lokal tidak aktif |
| Uji browser | BELUM LULUS — BLOCKED BY ENVIRONMENT | Runtime browser otomatis belum tersedia dan database lokal tidak aktif; screenshot belum ada |

## Gate rollout

| # | Gate | Status | Evidence wajib / kondisi saat ini | Penanda tangan |
|---|---|---|---|---|
| 1 | Kesiapan data: lima ekspor master Accurate, komponen, saldo awal, target sales, kapasitas, tautan karyawan | **BLOCKED BY DATA** | Belum ada paket lengkap sumber klien di worktree ini. Parser dan preview sudah diuji otomatis, tetapi kelengkapan sumber belum dapat dibuktikan. | Belum ada |
| 2 | Pilot master: jumlah preview dan reject direkonsiliasi | **BLOCKED BY DATA** | Belum ada hasil preview terhadap lima ekspor aktual dan belum ada persetujuan jumlah/reject dari operator. | Belum ada |
| 3 | Pilot stok satu gudang: qty/nilai sumber = stok/layer/mutasi | **BLOCKED BY DATA** | File saldo awal, gudang pilot, dan tanggal cut-off belum dikonfirmasi. Posting dilarang sebelum konfirmasi manusia dan delta empat arah = 0. | Belum ada |
| 4 | Dashboard: rekonsiliasi laporan sumber dan aturan delta lulus | **BLOCKED BY DATA** | Rumus dashboard lulus tes otomatis. Rekonsiliasi ke laporan aktual per cabang/periode belum bisa dilakukan tanpa data pilot. | Belum ada |
| 5 | Operasional: booking, timestamp, provider, kapasitas, referral lulus smoke test | **BLOCKED BY DATA** | Struktur dan kalkulasi lulus tes otomatis. Data kapasitas, tautan provider/karyawan, serta skenario browser aktual belum tersedia. | Belum ada |
| 6 | Alert: setiap alert aktif dapat direproduksi dari detail | **BLOCKED BY DATA** | Ambang, prioritas, missing-state, dan tautan internal lulus tes. Reproduksi lima alert memakai data aktual belum dijalankan; selisih opname tetap missing sampai penilaian HPP dapat dipercaya. | Belum ada |
| 7 | Keamanan cabang: tes positif dan negatif lulus | **BELUM LULUS — BLOCKED BY ENVIRONMENT** | Penolakan cabang asing dan filter scope lulus tes kode. Kebijakan database nyata belum diuji karena database lokal tidak aktif; matriks OWNER, ADMIN, dan user satu cabang belum punya screenshot/query evidence. | Belum ada |
| 8 | Keputusan produksi: persetujuan OWNER/ADMIN dan waktu | **NO-GO** | Gate 1–7 belum seluruhnya lulus. Tidak ada persetujuan produksi. | Belum ada |

## Matriks browser yang wajib dijalankan setelah environment siap

| Skenario | Evidence yang harus dilampirkan | Status |
|---|---|---|
| OWNER dan ADMIN membuka dashboard/pengaturan | Screenshot per peran | Belum dijalankan |
| User satu cabang hanya melihat cabangnya | Screenshot + query negatif cabang lain | Belum dijalankan |
| Ambang perusahaan dan override cabang | Screenshot sebelum/sesudah | Belum dijalankan |
| Lima alert bawaan | Screenshot kartu + rincian sumber yang menghasilkan angka sama | Belum dijalankan |
| Satu aturan nonaktif | Screenshot tanpa alert | Belum dijalankan |
| Sumber data missing | Screenshot status missing, bukan nol | Belum dijalankan |
| Drill-down terfilter | Screenshot filter tanggal/cabang di halaman tujuan | Belum dijalankan |

## Urutan pilot setelah data tersedia

1. Aktifkan database lokal dan jalankan reset seluruh migrasi sampai bersih.
2. Muat lima master Accurate serta file komponen; jalankan preview dan rekonsiliasi count/reject.
3. Pilih satu cabang, satu gudang, dan tanggal cut-off; minta konfirmasi manusia.
4. Posting saldo awal satu kali, lalu buktikan delta qty dan nilai pada sumber, stok, layer, dan mutasi = 0.
5. Isi target sales, kapasitas, dan tautan karyawan/provider untuk cabang pilot.
6. Jalankan rekonsiliasi laporan, matriks browser, reproduksi alert, dan tes keamanan cabang.
7. Minta OWNER/ADMIN mengisi penanda tangan dan waktu. Hanya ubah keputusan menjadi `GO` jika seluruh gate berstatus `LULUS`.

## Rollback

Code/dashboard rollback: redeploy prior production commit. Configuration rollback: deactivate rules. Posted opening stock is never deleted; correction uses Penyesuaian Persediaan referencing import run ID.

## Catatan keputusan final

- **Keputusan:** NO-GO.
- **Gate gagal/belum lulus:** 1–7.
- **Penyebab utama:** data eksternal pilot belum lengkap; database lokal dan uji browser belum siap.
- **Pemilik remediasi data:** Kamo Group untuk ekspor Accurate, saldo awal, target, kapasitas, dan tautan karyawan/provider.
- **Pemilik remediasi teknis:** tim implementasi VetOS untuk mengaktifkan database lokal, menjalankan migrasi, matriks keamanan, dan bukti browser.
- **Review berikutnya:** 2 September 2026, atau segera setelah paket data lengkap tersedia.
- **Larangan:** jangan aktifkan multi-cabang, jangan menganggap missing sebagai nol, dan jangan menghapus saldo awal yang sudah diposting.

## Percobaan melanjutkan opsi A — 1 September 2026

- Pencarian workspace tidak menemukan paket data impor.
- Pencarian folder unduhan menemukan tiga kandidat ekspor Accurate: dua ekspor barang dan satu ekspor kategori.
- Pemeriksaan workbook menunjukkan masing-masing hanya memiliki satu kepala kolom dan nol baris data. Ketiganya tidak dapat dipakai sebagai sumber pilot.
- Berkas komponen Grup, saldo awal, target sales, kapasitas, dan tautan karyawan/provider tidak ditemukan.
- Pemeriksaan environment tidak menemukan Docker Desktop, Colima, OrbStack, Podman, atau Rancher. Reset database lokal belum dapat dijalankan sampai runtime container dipasang.
- Tidak ada preview, posting saldo awal, perubahan database, atau rekonsiliasi yang dilakukan pada percobaan ini.
