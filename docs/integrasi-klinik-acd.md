# Integrasi semantik paket klinik A + C + D (+ B, E, COA)

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

## Lanjutan: B, E, COA (merge biasa di branch yang sama)

| Paket | Head | Migrasi | Merge |
|---|---|---|---|
| B — stok terlihat di jalur input klinik | `0ca1ba3e` | — | `681d9bcb` |
| E — laci kasir milik pemiliknya | `fe614f88` | `20261104320000` | `dc6c8a5c` |
| COA — impor bagan akun atomik | `6f98cf92` | `20261104330000` | `42fe2d32` |

Urutan B → E → COA: B tanpa migrasi tetapi beririsan dengan bacaan A (diperiksa lebih dulu
selagi diff A segar); E dan COA mengikuti urutan versi migrasi. Ketiganya tanpa konflik teks.

Pemeriksaan semantik:
- B menambah `stokGudang` di `loadClinicPaymentMaster` dan `warehouseId` di `loadClinicSkuDetails`.
  Di Pembayaran hasil master mengalir utuh lewat `masterP` paket A; katalog A dimuat untuk
  keranjang baru dan koreksi, yaitu semua tempat `PembayaranForm` (dan baris stok B) dirender.
  Tampilan invoice terkunci tidak merender keranjang, jadi tidak ada stok "0" palsu; nilai
  "belum terbaca" (null) B tetap null. Rekam Medis memakai `skuDetails` B di atas bacaan A.
- E hanya memasang pemicu pada `cashier_shifts`/`expenses` dan fungsi tutup paksa; tidak
  menyentuh writer posting (C) maupun pembungkus (D). Pelunasan C tetap memakai laci kasir
  sendiri (diuji ulang di harness C pada skema penuh).
- COA hanya menyentuh `coa_accounts` (kebijakan `coa_write`) dan fungsi impor akun.

Urutan pasang migrasi akhir: main …`20261104140000` → `0431` C → `0432` E → `0433` COA →
`0434` D. Tidak ada berkas di rentang cadangan Wowo `0425`–`0429`. Dua prefiks ganda
(`20261029140000`, `20261029150000`) sudah ada di main sebelum integrasi ini.

## Catatan pemasangan migrasi (untuk sesi utama)

Semua migrasi dijalankan sebagai satu transaksi; kunci di bawah ditahan sampai COMMIT.

| Berkas | SHA-256 | DDL pada tabel yang sudah ada | Kunci |
|---|---|---|---|
| `20261104310000_produk_lunas_pelunasan_dp.sql` | `c20bdec1…2c7ac0` | tidak ada; `create or replace` `clinic_post_invoice` (tambal jangkar) + fungsi baru | katalog fungsi saja |
| `20261104320000_shift_laci_milik_kasir.sql` | `966f0d6c…dc79df` | trigger di `cashier_shifts`, `expenses`; tabel baru ber-FK ke `cashier_shifts` | SHARE ROW EXCLUSIVE `cashier_shifts`, `expenses` (blok tulis) |
| `20261104330000_coa_import_atomic.sql` | `24856c8a…916dd4` | drop/create policy `coa_write` di `coa_accounts` | ACCESS EXCLUSIVE `coa_accounts` (blok baca juga — posting menunggu sesaat) |
| `20261104340000_item_susulan_rekam_medis.sql` | `299e76e1…cbc50a` | `prescription_items`: 4 kolom nullable, CHECK (dipindai), indeks parsial, trigger; tabel baru ber-FK ke `visits` & `medical_records`; tambal jangkar `clinic_edit_queued_record` | ACCESS EXCLUSIVE `prescription_items` (pindai CHECK + indeks); SHARE ROW EXCLUSIVE `visits`, `medical_records` (blok INSERT/UPDATE) |

Paparan ke impor rekam medis yang sedang berjalan (menulis `customers`, `pets`, `visits`,
`medical_records`): hanya `0434` yang mengunci `visits` dan `medical_records`. Saran: pasang
`0434` di jeda antar-batch impor dengan `set lock_timeout = '5s'` (ulang bila timeout); jangan
biarkan menunggu kunci sambil memegang `prescription_items`. `customers`/`pets` tidak disentuh.

SECURITY DEFINER: semua fungsi baru dimiliki peran yang menjalankan migrasi (di hosted
kemungkinan `postgres`, sama dengan fungsi klinik lain). Penjaga `guard_prescription_susulan`
membedakan tulisan API (`current_user` = authenticated/anon/service_role) dari fungsi definer;
penulis impor (`kamo_legacy_import_writer`) tidak memberi penanda. E mengandalkan pemilik fungsi
yang memiliki/melewati RLS `cashier_shifts` seperti writer uang yang sudah ada.

PostgreSQL: semua bukti di PG16.15; live 17.6 belum diuji di sini. Tambal jangkar (C, D) membaca
teks `pg_get_functiondef` yang berasal dari `prosrc` (tidak bergantung versi); bila definisi live
berbeda dari repo, migrasi gagal tertutup sebelum mengubah apa pun.

Kompatibilitas dengan aplikasi live lama (migrasi dipasang beberapa menit sebelum deploy):
- `0431` C: aturan produk-saja langsung berlaku di writer; aplikasi lama menampilkan pesan umum
  "Transaksi belum tersimpan…" untuk penolakan ini sampai deploy (pesan khusus ada di kode baru).
  Pelunasan baru belum terlihat sampai deploy.
- `0432` E: tutup paksa laci orang lain dari aplikasi lama (update langsung) DITOLAK sampai deploy
  (jalur baru lewat `cashier_shift_supervisor_close`); menutup laci orang lain juga ditolak
  (memang tujuannya). Pengeluaran yang ditempel ke laci di cabang lain ditolak. Tutup laci sendiri
  tetap jalan.
- `0433` COA: tulis langsung `coa_accounts` kini butuh profil aktif OWNER/ADMIN — aplikasi lama
  tetap jalan bagi pengguna itu.
- `0434` D: hanya menambah; aplikasi lama tetap memanggil RPC posting asli (tanpa cek versi
  keranjang sampai deploy). Koreksi penuh dokter di aplikasi lama tetap jalan dan kini memberi
  penanda susulan.
