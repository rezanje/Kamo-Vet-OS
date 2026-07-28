# Modul Kas & Bank — Daftar Rekening + Transfer Bank (Design / Spec)

**Tanggal:** 2026-07-29
**Konteks:** Tahap 2 dari usulan urutan garap di `docs/GAP-MENU-ACCURATE-2026-07.md`
(§4 Kas & Bank). Tahap 1 (Master Data & Kategori) selesai & live 2026-07-28.

Keputusan boss (sesi brainstorm 2026-07-29):
- Kamo Group pakai **beberapa rekening bank** → butuh master rekening yang bisa dikelola sendiri.
- Transfer Bank mencakup **semua perpindahan uang**: setor tunai kasir → bank, tarik tunai,
  pindah antar rekening. Satu pintu, plus kolom **biaya admin bank**.
- **Opsi A**: rekening + transfer dulu. Kasir memilih rekening tujuan = pekerjaan lain.
- Payment Gateway **tidak** masuk spec ini (integrasi pihak ketiga = proyek sendiri).

## 0. Status awal (jangan dikerjakan ulang)

Audit lama menulis Kas & Bank 1/4. Setelah dicek ulang 2026-07-29, yang **sudah ada dan jalan**:

| Tile | Route | Keterangan |
|---|---|---|
| Pembayaran (bayar hutang pemasok) | `/keuangan/hutang` | sudah ber-`href` di nav |
| Penerimaan (terima piutang) | `/keuangan/piutang` | aging + `terimaPelunasan` |
| Rekonsiliasi Bank | `/keuangan/rekonsiliasi` | |
| Arus Kas | `/keuangan/arus-kas` | |

Yang benar-benar kosong: **Transfer Bank** (tile tanpa `href`) dan **Payment Gateway**.

Fakta lain yang membentuk desain ini:
- COA hanya punya **dua** akun kas/bank: `1101` Kas, `1102` Bank BCA. Tidak ada master rekening.
- Kode `1101`/`1102` **hardcoded di 20 file** server action (kasir, klinik, gaji, pembelian,
  retur, aset, dst). Spec ini **tidak menyentuh satu pun** dari itu.
- `postJournal` (`src/lib/posting.ts`) **best-effort dan tidak pernah melempar error**. Untuk
  transfer, jurnal ITU transaksinya — jadi butuh verifikasi eksplisit (lihat §4).
- Kunci periode tutup buku ditegakkan **trigger DB** (`0055`), yang bikin `postJournal` gagal
  diam-diam. Pola guard yang benar sudah ada di `penjualan/online/actions.ts` (baca
  `accounting_locks`, **fail-closed** kalau statusnya tidak terbaca) — dipakai ulang di sini.
- Nomor dokumen: pola per bulan `count+1` (IT/RB/RJ/FB). Transfer ikut pola ini.
- Guard master data: `assertMasterAdmin` / `bolehKelolaMaster` (`src/lib/master-guard.ts`, 0066).
- Halaman `/kas-bank/page.tsx` masih `ModuleHome` polos (grid tile).

## 1. Master Daftar Rekening

### Migrasi
```
cash_accounts(
  id uuid pk,
  nama varchar(80) not null,                 -- "BCA Operasional", "Kas Besar"
  jenis varchar(8) not null check (jenis in ('Kas','Bank')),
  coa_code varchar(12) not null unique references coa_accounts(code),
  bank_nama varchar(60),                     -- null untuk jenis Kas
  no_rekening varchar(40),                   -- null untuk jenis Kas
  branch_id uuid references branches(id) on delete set null,  -- opsional
  is_active boolean not null default true,
  created_at timestamptz not null default now()
)
```
RLS pola `brands`/`units` (permissive, guard peran di server action).

### Seed (bukan backfill — tidak ada data lama yang hilang)
Dua baris yang memetakan akun COA yang sudah dipakai 20 file itu:
`('Kas', 'Kas', '1101', null, null, null)` dan
`('Bank BCA', 'Bank', '1102', 'BCA', null, null)`.
Tanpa ini, saldo dari seluruh transaksi berjalan tidak akan muncul di layar rekening.

### Akun COA otomatis
Menambah rekening baru **membuat akun COA baru** (bukan memilih akun yang sudah ada):
kode berikutnya yang belum terpakai di rentang `1103`–`1199`, `type='ASET'`, `normal_balance='D'`,
nama = nama rekening. Rentang habis → tolak dengan pesan
"Nomor akun kas/bank sudah penuh (1103–1199) — hubungi developer".

Alasan satu-rekening-satu-akun: neraca & buku besar jadi bisa menampilkan saldo **per rekening**.
Kalau semua bank ditumpuk di satu akun, laporan tidak bisa memisahkan BCA dari Mandiri, dan
rekonsiliasi bank jadi tidak mungkin.

### Saldo awal (opsional, saat menambah rekening)
Kolom "Saldo awal" boleh diisi. Kalau > 0, sistem posting
`Dr <coa_code baru>` / `Cr 3101 Modal Pemilik`, bertanggal hari itu, `source='cash-account-opening'`.

**Keputusan boss yang dikunci:** lawan saldo awal = **Modal Pemilik**. Kalau uang itu sebenarnya
laba tertahan, koreksinya lewat jurnal umum — bukan diubah di sini.

Saldo awal tunduk pada guard periode & verifikasi jurnal yang sama seperti transfer (§4).

### Halaman `/kas-bank/rekening`
Pola `/pos/merek` + `MasterPage` (0066). Guard `assertMasterAdmin` — hanya OWNER/ADMIN.
Kolom tabel: Nama · Jenis · Bank / No. rekening · Akun COA · Cabang · **Saldo** · Status · Aksi.
Rekening **tidak bisa dihapus**, hanya dinonaktifkan (akun COA-nya sudah dipakai jurnal).
Nonaktif = tidak muncul di dropdown transfer, tapi saldonya tetap tampil (uangnya masih ada).
Menonaktifkan rekening **tidak** menonaktifkan akun COA-nya: buku besar & neraca harus tetap
bisa membaca saldo dan riwayatnya.

## 2. Transfer Bank

### Migrasi
```
cash_transfers(
  id uuid pk,
  no_transfer varchar(24) not null unique,   -- TF.YYYY.MM.NNNNN
  tanggal date not null default current_date,
  from_account_id uuid not null references cash_accounts(id) on delete restrict,
  to_account_id   uuid not null references cash_accounts(id) on delete restrict,
  jumlah numeric(15,2) not null check (jumlah > 0),
  biaya_admin numeric(15,2) not null default 0 check (biaya_admin >= 0),
  branch_id uuid references branches(id) on delete set null,
  keterangan text,
  created_by uuid references profiles(id) on delete set null,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_account_id <> to_account_id)
)
```

### Jurnal
Biaya admin ditanggung **rekening sumber** (uang keluar = jumlah + biaya):
```
Dr  <akun tujuan>          jumlah
Dr  5501 Beban Adm. Bank   biaya_admin      (baris ini hilang kalau biaya = 0)
Cr  <akun sumber>          jumlah + biaya_admin
```
`source='transfer'`, `sourceRef=no_transfer`, `branchId` = cabang yang dipilih.

### Pembatalan
Transfer **tidak dihapus** — dibatalkan (`voided_at` diisi) dan sistem posting **jurnal balik**
bertanggal **sama dengan transfer aslinya** (bukan tanggal hari ini), `source='transfer-void'`.
Alasan tanggal sama: kalau reversal jatuh di bulan lain, laporan dua bulan itu jadi salah dua-duanya.
Konsekuensinya pembatalan ikut ditolak kalau periode transfer itu sudah tutup buku — itu memang benar.
Transfer yang sudah dibatalkan tidak bisa dibatalkan lagi (predikat `voided_at is null` ada di
`UPDATE`-nya sendiri, bukan cuma di pembacaan sebelumnya — pola anti double-submit dari 0062).

### Halaman `/kas-bank/transfer`
Satu halaman: form di atas, daftar transfer di bawah (50 terakhir).
Form: Tanggal · Dari rekening · Ke rekening · Jumlah · Biaya admin · Cabang (opsional) · Keterangan.
**Saldo berjalan tiap rekening ditampilkan di dropdown** (mis. "BCA Operasional — Rp 12.400.000"),
sesuai keputusan boss: saldo minus tidak dilarang, tapi harus kelihatan sebelum disimpan.
Daftar: No · Tanggal · Dari → Ke · Jumlah · Biaya · Cabang · Status · tombol Batalkan.

Guard peran: OWNER, ADMIN, **FINANCE** (modul `kas-bank` sudah masuk `FINANCE_MODULES`).
Bukan `assertMasterAdmin` — ini transaksi, bukan master data.

## 3. Saldo tiap rekening di halaman modul

`/kas-bank/page.tsx` berhenti memakai `ModuleHome` polos: di atas grid tile ditambah baris kartu
saldo per rekening aktif (nama, jenis, saldo hari ini), plus total. Grid tile tetap di bawahnya.

Saldo dihitung dari `journal_lines` (`sum(debit) - sum(credit)`) yang di-join ke `coa_accounts`
untuk kode-kode milik `cash_accounts` — **satu query agregat**, bukan per rekening (hindari N+1).

## 4. Jurnal wajib berhasil (bukan best-effort)

`postJournal` menelan semua error. Untuk uang yang berpindah, itu tidak boleh. Urutan di
`buatTransfer`, `batalkanTransfer`, dan saldo awal rekening:

1. Validasi input (pesan Indonesia).
2. **Guard periode** — baca `accounting_locks.closed_until`; gagal baca = **fail-closed**
   ("Gagal memeriksa status tutup buku, coba lagi"), pola `penjualan/online/actions.ts`.
3. Tulis baris transaksi (`cash_transfers` / `cash_accounts`).
4. `postJournal(...)`.
5. **Verifikasi**: query `journal_entries` untuk `source` + `source_ref` barusan.
   Tidak ketemu → **rollback manual** (hapus baris yang baru ditulis di langkah 3) dan tampilkan
   "Jurnal gagal tersimpan, transfer dibatalkan — coba lagi".

Langkah 5 satu-satunya cara menutup celah "uang pindah di layar tapi tidak ada di pembukuan"
tanpa menulis ulang `postJournal` (yang dipakai 20 jalur lain dan sedang stabil).

## 5. Logika murni — `src/lib/transfer-kas.ts` + test

- `validasiTransfer(d): string | null` — jumlah harus > 0; dari ≠ ke; biaya admin ≥ 0;
  tanggal tidak boleh di masa depan; rekening wajib dipilih.
- `jurnalTransfer(kodeDari, kodeKe, jumlah, biayaAdmin): {code,debit,credit}[]` —
  selalu seimbang; baris biaya hilang kalau 0.
- `jurnalBalik(lines): {code,debit,credit}[]` — tukar debit/kredit.
- `nomorTransfer(tanggal, jumlahBulanIni): string` — `TF.YYYY.MM.NNNNN`.
- `kodeAkunBerikutnya(kodeTerpakai: string[]): string | null` — kode bebas pertama di 1103–1199,
  `null` kalau habis.

## 6. Navigasi

| Tile | Modul | Route |
|---|---|---|
| Transfer Bank | Kas & Bank | `/kas-bank/transfer` (tile sudah ada, tinggal `href`) |
| Daftar Rekening | Kas & Bank | `/kas-bank/rekening` (**tile baru**, warna master data) |

## 7. Batas scope (sengaja TIDAK dikerjakan)

- **Payment Gateway** — integrasi pihak ketiga, kunci rahasia, webhook. Proyek sendiri.
- **Kasir/klinik/gaji memilih rekening** — 20 file masih hardcode `1101`/`1102` dan sengaja
  dibiarkan (keputusan boss: opsi A). Transaksi berjalan tetap masuk Kas / BCA seperti sekarang.
- **Larangan saldo minus** — sengaja tidak diblok; saldo ditampilkan supaya salah input kelihatan.
- **Rekonsiliasi bank per rekening baru** — halaman rekonsiliasi yang ada belum dipecah per
  rekening; itu pekerjaan lanjutan setelah rekening punya saldo masing-masing.

## 8. Tes

Logika murni (`npm test`, pola proyek):
- `transfer-kas.test.ts` — validasi (jumlah 0/negatif, dari=ke, tanggal masa depan, biaya negatif) ·
  jurnal seimbang dengan & tanpa biaya admin · biaya admin dibebankan ke sumber (kredit sumber =
  jumlah + biaya) · jurnal balik seimbang & benar-benar terbalik · penomoran (bulan berganti →
  nomor mulai dari 1 lagi) · `kodeAkunBerikutnya` (lompati kode terpakai, kembalikan null saat penuh).

Uji manual sebelum rilis:
1. Tambah rekening "Uji Mandiri" + saldo awal → akun COA baru lahir, saldo muncul, jurnal
   Dr akun baru / Cr 3101 seimbang.
2. Transfer Kas → Uji Mandiri Rp 1.000.000 biaya Rp 6.500 → saldo sumber turun 1.006.500,
   tujuan naik 1.000.000, beban 5501 naik 6.500, jurnal seimbang.
3. Batalkan transfer itu → saldo kedua rekening kembali persis seperti sebelumnya.
4. Coba transfer dari & ke rekening yang sama → ditolak dengan pesan Indonesia.
5. Coba transfer bertanggal di periode yang sudah tutup buku → ditolak, dan **tidak ada** baris
   `cash_transfers` yatim yang tertinggal.
6. Login FINANCE → bisa buka & pakai Transfer Bank, tapi halaman Daftar Rekening read-only.
7. Hapus seluruh data uji; bandingkan jumlah jurnal & saldo sebelum-sesudah harus identik.

## 9. Rilis

Sekali jalan (pola tahap 1). Urutan: migrasi → logika murni + test → master rekening →
transfer → saldo di halaman modul → nav → `npm test` + `tsc` + `lint` + `build` → uji manual §8
→ push `main` (auto-deploy Vercel).

Setelah lolos: perbarui `docs/GAP-MENU-ACCURATE-2026-07.md` §4 (Kas & Bank 1/4 → 4/4 wajib
Accurate; catat Payment Gateway sebagai permintaan PDF yang masih terbuka) dan
`docs/RINGKASAN-KLONING-ACCURATE-2026-07.md`.
