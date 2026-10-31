# Integrasi semantik paket klinik A + C + D

Branch `claude/klinik-integrasi-acd`, dari `origin/main@291bb8c8`, hanya merge biasa (tanpa
rebase/penulisan ulang). Cabang paket tidak diubah. Bukan izin rilis: tidak ada merge ke main,
deploy, migrasi hosted, impor, atau transaksi Production.

| Paket | Head | Migrasi |
|---|---|---|
| C — produk saja wajib lunas + pelunasan DP lama | `6a958d3a` | `20261104310000` |
| D — item susulan + versi keranjang (CART_STALE) | `c3116dd7` | `20261104340000` |
| A — loading (bacaan paralel) | `988eb2e1` | — |

Tidak ada migrasi di rentang cadangan Wowo `20261104250000`–`20261104290000`.

## Urutan merge: C → D → A

1. **C dulu**: perubahan uang di database (patch jangkar `clinic_post_invoice`, RPC pelunasan)
   dan versinya paling awal. Dengan C sudah di dasar, D dan A diuji di atas aturan uang final.
2. **D kedua**: migrasi `0434` sesudah `0431` (urutan nama = urutan pasang). D tidak menulis
   ulang `clinic_post_invoice`; pembungkusnya memanggil RPC yang sudah ditambal C, jadi aturan
   produk-saja C tetap berlaku lewat jalur D.
3. **A terakhir**: tanpa migrasi, hanya menata ulang bacaan. Digabung di atas konten semantik
   final supaya konflik kontrak A↔D terlihat dan diperbaiki di satu tempat.

## Resolusi per merge

- **C** (`36eed037`): tanpa konflik.
- **D** (`bb9c7eaa`): tanpa konflik teks. `pembayaran/[visitId]/page.tsx` (4 hunk C +
  versi keranjang D) dan `src/lib/klinik-posting.ts` (pesan `PRODUCT_ONLY_FULL_PAYMENT` C +
  `CART_STALE`/`RECORD_LOCKED` D) tergabung otomatis.
- **A** (`bbb00290`, resolusi naif yang sengaja dicatat): konflik di `pembayaran/[visitId]/page.tsx`.
  1. `Promise.all` DEMO/koreksi: blok bacaan paralel A dipertahankan; destructuring memakai
     elemen ke-5 D (`clinic_outpatient_cart_version`).
  2. Sesudah `const lunas`: `sisaPelunasan` + `pelunasanTerbuka` C dipertahankan; refund memakai
     bacaan awal A (`refundDataP`, syaratnya sama dengan `lunas`).
  `rekam-medis/[visitId]/page.tsx` tergabung otomatis (kolom susulan D tetap dibaca). A tidak
  menyentuh `actions.ts`, jadi urutan versi→baris pada pembayaran rombongan (D) tetap.
- **Perbaikan kontrak A↔D** (`db1bc789`): lihat di bawah.

## Kontrak A↔D: versi keranjang sebelum baris resep

Pada resolusi naif, bacaan resep A (`resepP`) berangkat di gelombang 2, sedangkan versi D di
gelombang 3. Bila dokter menambah item di antara keduanya, layar menampilkan keranjang lama
dengan versi yang sudah "segar" → server menerima, item dokter tak tertagih.

Perbaikan: `cartVersionP` berangkat di gelombang awal bersama invoice (semua kunjungan rawat
jalan; untuk invoice tersimpan hasilnya diabaikan, galatnya tidak memblokir), dan `resepP`
baru berangkat setelah `cartVersionP` dijawab. Versi yang dikirim form sama dengan baris yang
tampil, atau lebih lama (server lalu menolak `CART_STALE`).

Bukti (`src/components/__tests__/klinik-integrasi-ad-urutan-keranjang.test.tsx`, klien tiruan
bergelombang dengan "database" berstatus yang menyisipkan item dokter tepat sesudah bacaan
pertama dari pasangan {resep, versi} dijawab):
- RED pada `bbb00290`: 2 gagal — keranjang `['rx-a']` dengan versi segar; resep gelombang 2,
  versi gelombang 3.
- GREEN: 3/3 (termasuk urutan nyata: resep gelombang > versi; versi segelombang dengan invoice).

Kedalaman round-trip Pembayaran (klien tiruan A, katalog 3.600 SKU): sebelum integrasi (A saja)
baru 11 / lunas 5 / rawat inap 9; sesudah perbaikan 11 / 5 / 9. Bacaan resep pindah dari
gelombang 2 ke 3 di luar jalur kritis (katalog); +1 bacaan (RPC versi) per halaman rawat jalan.
Tes A dan D disesuaikan: mock A menjawab RPC versi; tes D "invoice tersimpan" kini memeriksa
galat versi diabaikan (versi dibaca sebelum invoice diketahui).

Sisa batas: identitas rekam medis (`mr`) tetap dibaca di gelombang 1 sebelum versi. Rekam medis
BARU yang dibuat untuk kunjungan rawat jalan di tahap Pembayaran di antara dua bacaan tidak akan
tampil; penulis yang ada (simpan pemeriksaan awal) tidak berjalan pada tahap itu, tetapi ini
tidak dibuktikan dengan tes. Versi D juga mencakup baris dari SEMUA rekam medis kunjungan,
sedangkan layar menampilkan rekam medis terbaru — untuk kunjungan rawat jalan normal hanya ada satu.

## C × D

- Pelunasan DP lama (`clinic_settle_outpatient_invoice`) bekerja pada invoice yang sudah ada.
  Sejak invoice terbit, jalur tambah item dokter tertutup (`RECORD_LOCKED`), jadi tidak ada baris
  tertunda yang bisa lolos lewat pelunasan; pelunasan juga tidak membentuk keranjang. Karena itu
  tidak ada kontrak versi baru untuk pelunasan. Dibuktikan E4a/E4b pada skema gabungan.
- Klasifikasi produk-saja C mensyaratkan kunjungan tanpa rekam medis. Pembungkus D tidak
  membuat baris resep bila rekam medis tidak ada, jadi klasifikasi tidak bergeser (E3a/E3b).
  Aturan C tidak diperluas atau dipersempit.
