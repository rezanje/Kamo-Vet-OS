# Komisi Penjual & Target Penjualan

Tanggal: 2026-08-03 · Status: dipilih boss (opsi A, 2026-08-03)

## Masalah

Dua tile Accurate di modul Penjualan masih kosong: **Komisi Penjual** dan **Target Penjualan**.
Akibatnya:

1. **Insentif dihitung di luar sistem.** Tidak ada aturan komisi tersimpan, tidak ada jejak
   angka komisi seseorang dari mana. Yang ada di kode cuma `komisi` marketplace di
   `/penjualan/online` — itu biaya platform, bukan insentif karyawan.
2. **Tidak ada target.** Tidak bisa jawab "cabang ini sudah berapa persen dari target bulan ini".
3. **Slip gaji belum punya baris komisi**, padahal mesin gaji otomatis (migrasi 0087–0090)
   sudah jalan dan tinggal disambung.

## Keputusan

- **Basis komisi diatur per aturan**: `omzet` (default) atau `laba` (omzet − HPP).
  `sale_items.hpp` sudah ada sejak migrasi 0084, jadi basis laba bisa dihitung.
  Boss belum mengunci pilihannya → default `omzet`, tinggal ganti per aturan di layar.
- **Sumber angka = tabel `sales`** (kasir petshop + penjualan online), dikurangi retur
  penjualan. Invoice klinik awalnya dinyatakan tidak ikut — **keputusan itu dibatalkan di
  fase 5 di bawah** setelah dicek ulang; tagihan klinik ternyata bisa dipetakan ke produk.
- **Atribusi penjual = kasir yang menutup struk** (`sales.cashier_id` → `employees.profile_id`).
  Tidak menambah pemilih "penjual" di layar kasir dulu — struk yang tidak punya karyawan
  terkait dilaporkan sebagai "tanpa penjual", tidak diam-diam hilang.
- **Komisi masuk slip gaji sebagai penambah**, sejajar dengan lembur dan reimburse.
  Jurnalnya tetap Beban Gaji — tidak ada akun baru.
- **Import Excel belum**. Aturan & target diketik di layar dulu; import ditambah kalau
  jumlah barisnya sudah menyiksa.

## Rancangan

### Fase 1 — Master aturan & target (migrasi 0091)

| Tabel baru | Isi |
|---|---|
| `commission_rules` | nama, tipe (`persen`/`nominal`), basis (`omzet`/`laba`), persen, nominal per unit, cakupan (employee_id / branch_id / category_id / item_id — null = semua), min_omzet (ambang cair), masa berlaku, is_active |
| `sales_targets` | periode `YYYY-MM`, cakupan (employee_id / branch_id / category_id), basis, target |

`payrolls` dapat kolom `komisi`.

Satu aturan bisa dibatasi berlapis (mis. "karyawan X, kategori Makanan Kucing, 2% dari laba").
Beberapa aturan boleh kena ke struk yang sama — itu memang diminta: persen omzet global +
nominal tetap per produk + persen per kategori bisa jalan bersamaan.

`min_omzet` = ambang. Komisi aturan itu baru cair kalau realisasi karyawan (sesuai basisnya)
di periode tersebut sudah melewati ambang. 0 = tanpa ambang.

### Fase 2 — Mesin hitung (`src/lib/komisi.ts`, murni & teruji)

Masukan: baris penjualan periode itu (sudah termasuk baris retur bernilai negatif) +
daftar aturan aktif. Keluaran per karyawan: omzet, laba, komisi total, dan rincian per aturan.

```
untuk tiap baris jual (qty, omzet, laba, cabang, produk, kategori):
  untuk tiap aturan yang cakupannya cocok:
    tipe persen  → komisi += persen% × (omzet | laba)
    tipe nominal → komisi += nominal × qty
lalu: aturan yang realisasi karyawannya di bawah min_omzet → dinolkan
```

Aturan pencocokan kategori ikut **kategori induk** — aturan di kategori induk kena juga ke
produk di anaknya (kategori barang 2 tingkat sejak migrasi 0066).

Baris retur memakai HPP dari struk aslinya supaya basis laba tidak melenceng. Baris yang
HPP-nya kosong **tidak dipakai** untuk aturan basis laba, dan jumlahnya ditampilkan di layar
supaya ketahuan, bukan diam-diam dianggap laba penuh.

### Fase 3 — Layar

- `/penjualan/komisi` — daftar aturan (CRUD) + hitungan per karyawan untuk satu periode,
  bisa dibuka untuk melihat rincian per aturan.
- `/penjualan/target` — set target per periode (per karyawan / cabang / kategori) +
  monitor realisasi & persentase capai.
- Tile "Komisi Penjual" & "Target Penjualan" di `nav.ts` diberi `href`.

### Fase 4 — Sambung ke slip gaji

`kumpulkanDataGaji` menarik komisi periode itu → `hitungGaji` menambahkannya ke gaji bersih →
kolom `payrolls.komisi` menyimpan angkanya sebagai potret. Slip yang sudah disahkan tidak ikut
berubah kalau ada retur belakangan — itu memang disengaja, sama seperti kolom rincian lain.

### Fase 5 — Insentif dokter dari klinik (migrasi 0092, 2026-08-03)

Keputusan awal "invoice klinik tidak ikut" **dibatalkan** setelah dicek ulang: `invoice_items`
sudah punya `item_id` dan `hpp` sejak migrasi 0084, jadi baris klinik bisa dipetakan ke produk
dan kategori seperti struk kasir.

Penghalang sebenarnya ada di tempat lain: `visits.dokter` cuma teks bebas. Ditambah
`visits.doctor_id` (FK ke `employees`, di-backfill dari nama yang persis sama), dan layar
registrasi + rekam medis sekarang **memilih dokter dari daftar karyawan**, bukan mengetik.
Nama tetap disimpan di kolom lama supaya resep, dokumen, dan surat persetujuan tidak berubah.

Ikut ketahuan & diperbaiki: `simpanRekamMedis` membaca field `dokter` yang tidak pernah dikirim
formnya, jadi **setiap simpan rekam medis menghapus nama dokter** yang diisi saat registrasi.

`commission_rules.sumber` (`semua` / `kasir` / `klinik`) menjaga aturan insentif dokter tidak
ikut membayar penjualan petshop kalau dokternya kebetulan pernah menutup struk kasir.

Baris klinik diambil dari tagihan **berstatus Lunas**, dipatok pada tanggal bayar — yang
dikomisikan adalah uang yang benar-benar masuk. Baris jasa tidak punya modal barang, jadi
labanya dianggap utuh, bukan "tidak diketahui".

## Yang sengaja tidak dikerjakan
- Import Excel aturan & target.
- Komisi berjenjang bertingkat (mis. 2% sampai 50 juta, 3% di atasnya) — `min_omzet` sudah
  menutup kasus "cair kalau target tercapai"; tingkatan penuh menyusul kalau memang dipakai.
- Pemilih "penjual" manual di layar kasir.

## Uji

- Vitest `komisi.test.ts`: cocok-cakupan (semua/cabang/karyawan/kategori induk & anak/produk),
  tipe persen vs nominal, basis omzet vs laba, baris retur mengurangi, ambang `min_omzet`,
  baris tanpa HPP dikecualikan dari basis laba.
- Manual di browser: buat aturan → transaksi di kasir → angka komisi muncul di layar komisi →
  hitung gaji → baris komisi ikut di slip.
