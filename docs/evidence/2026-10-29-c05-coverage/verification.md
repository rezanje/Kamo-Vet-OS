# C05 lanjutan — kode kampanye di pembayaran rombongan & POS back-office (verifikasi)

Checklist: **C05**, temuan audit 29 Okt. Status: kode + tes selesai di branch kerja; **belum** diterapkan ke
database production, **belum** deploy, **belum** UAT pengguna.

## Celah yang ditutup

| Celah | Sebelum | Sesudah |
|---|---|---|
| (a) Pembayaran rombongan klinik | kode kampanye ditolak ("dipakai per kunjungan") | diterima; satu kedatangan = satu pemakaian |
| (b) POS back-office `/pos/transaksi` | tidak ada kolom kode | kolom "Kode kampanye"; aturan & batas sama dengan `/kasir` |

## Aturan rombongan (dipilih & ditegakkan database)

- Satu pemilik membayar beberapa hewan sekaligus pada satu hari (WIB) = **satu** pemakaian kode, sama seperti
  voucher di jalur ini ("berlaku sekali untuk satu kedatangan").
- Kode terikat voucher: voucher tujuan dihitung dari gabungan tagihan lalu dibagi proporsional ke nota tiap hewan
  (mesin rombongan yang sudah ada). Kode terikat promo: promo itu ikut dipotong di tagihan tiap hewan; kode ditolak
  bila tidak memotong apa pun di seluruh rombongan.
- Hanya nota yang benar-benar kebagian potongan dari kode yang menyimpan kode (sama dengan `voucher_code` lama).
  Nota itu juga menyimpan kunci grup `<id pemilik>:<tanggal WIB>`.
- Database menghitung pemakaian = struk POS final non-void + **grup** invoice non-void (invoice tanpa grup = grup
  sendiri). Nota pertama grup mengambil satu pemakaian (batas dicek, baris kode dikunci); nota berikutnya di grup
  yang sama ikut pemakaian itu dan tidak ditolak batas.
- Kunci grup tidak bisa dikarang: database hanya menerima kunci milik pemilik kunjungan itu untuk hari ini, tidak
  bisa diubah setelah tersimpan, dan diwarisi saat void+terbit ulang.
- Retry: kunci permintaan per hewan tetap `<requestKey>:<visitId>` → invoice tersimpan diputar ulang, tidak menambah
  pemakaian; percobaan baru untuk hewan sisa di hari yang sama ikut grup yang sama.
- Void: pemakaian grup kembali hanya bila tidak ada lagi invoice hidup di grup itu yang memuat kode.
- Pembayaran per kunjungan dan struk POS tetap satu dokumen = satu pemakaian (tidak berubah).

## POS back-office

- Kolom menerima **kode kampanye saja**; voucher biasa ditolak dengan pesan "dipakai lewat layar kasir"
  (back-office memang belum pernah punya voucher — tidak dibuka di sini).
- Rumus layar = rumus server (`src/lib/kode-kampanye-pos.ts`): promo (+ promo tujuan kode) → voucher tujuan dari
  nilai setelah promo → diskon golongan & manual. Kode yang ditolak tidak meninggalkan potongan di total.
- Struk menyimpan `campaign_code` + `voucher_code` tujuan; batas dicek database saat struk ditulis dan dicek ulang
  saat dibayar (`finalize_pos_sale`). Kode ikut identitas draft (sudah bagian sidik transaksi) dan kini ikut
  dipulihkan dari draft browser.
- Tanpa langkah database tambahan (trigger C05 dasar sudah menjaga tabel `sales`).

## Tidak diubah (keputusan terbuka)

Kode voucher asli yang terikat ke kampanye **masih bisa diketik langsung** di `/kasir` dan klinik, melewati kuota
kampanye. Perilaku ini sengaja dibiarkan apa adanya menunggu keputusan owner. Back-office tidak menerima voucher
biasa, jadi celah ini tidak bertambah lewat layar baru.

## Perubahan

- `supabase/migrations/20261029154000_c05_campaign_rombongan_backoffice.sql` — kolom `invoices.campaign_group`
  (+ check "butuh kode", index), tambalan ber-jangkar (gagal bila definisi berubah) pada `campaign_code_used`,
  `guard_campaign_code_use`, `clinic_post_invoice` (kolom ditambahkan di sebelah tambalan C05; tambalan migrasi
  lain tetap utuh), trigger invoice ikut menjaga `campaign_group`.
- `src/app/(app)/klinik/pembayaran/[visitId]/actions.ts`, `LunasiRombonganForm.tsx` — rombongan menerima kode.
- `src/lib/tagihan-klinik.ts` — `hitungPotonganKlinik` menerima `promoKodeId` (promo kode untuk tiap hewan) dan
  melaporkan potongan promo kode.
- `src/lib/kode-kampanye.ts` — `kunciGrupKampanye`, `notaMemuatKampanye`, `pesanBukanKampanye`.
- `src/lib/kode-kampanye-pos.ts` (baru), `src/app/(app)/pos/transaksi/{actions.ts,PosClient.tsx,page.tsx}`,
  `src/lib/pos-draft.ts` — kode kampanye di POS back-office.
- `src/lib/klinik-posting.ts` — tipe `campaign_group`.

## Hasil tes (lokal, data fiktif)

- SQL, PostgreSQL 16.15 native, semua 304 migrasi berurutan → `native-pg16.log`:
  suite baru `c05_campaign_rombongan_backoffice.sql` (kuota grup, retry idempoten, kunci palsu/hari lain ditolak,
  void sebagian/penuh, terbit ulang mewarisi grup, kode promo di grup, back-office: draft tidak memakai kode, final
  memakai, retry finalizer, cek batas saat bayar, void membebaskan) + C05/Q01 lama + 10 regresi invoice klinik/POS +
  6 suite ber-prelude + 3 race (2 struk cap 1; 2 pemilik berbeda cap 1 → 1 lolos; 2 hewan satu grup cap 1 → 2 invoice,
  1 pemakaian). Semua lulus. Migrasi baru diterapkan ulang: fungsi identik byte-per-byte.
- Drift: definisi fungsi diubah sedikit → preflight `false` dan migrasi berhenti `C05_GROUP_DRIFT` (diuji manual).
- Paket owner: `owner-apply/rehearsal-pg16.log`.
- Vitest: `npx vitest run` → 560 file lulus, 1 dilewati; 4138 tes lulus, 1 dilewati (termasuk 3 file baru:
  `clinic-group-campaign-code`, `backoffice-campaign-checkout`, `kode-kampanye-coverage`).
- `npx eslint <file berubah>` bersih; `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` bersih.
- Belum: `npm run build`, Technical checks CI, UAT pengguna, penerapan production.

## Sisa kendala (sudah ada sebelumnya, di luar perubahan ini)

- Struk POS yang memakai voucher/promo (termasuk kode kampanye) tidak bisa dibatalkan lewat aplikasi
  (`cancel_posted_sale` menolak: "Rekonsiliasi kuota promo diperlukan"); "void membebaskan kuota" di POS hanya lewat
  void yang disetujui owner di database. Di klinik, jalur aplikasi hanya void+terbit ulang (pemakaian tetap).
- Rombongan yang sebagian gagal lalu diulang menghitung voucher lagi atas hewan yang tersisa (perilaku voucher lama);
  pemakaian kode kampanye tetap satu karena grup sama.
- Menjalankan ulang `apply.sql` C05 dasar setelah langkah ini menghapus tambalan; jalankan ulang paket ini (lihat
  `owner-apply/README.md`).
