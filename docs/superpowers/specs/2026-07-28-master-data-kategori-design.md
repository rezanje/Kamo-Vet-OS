# Master Data & Kategori ala Accurate (Design / Spec)

**Tanggal:** 2026-07-28
**Konteks:** Tahap 1 dari usulan urutan garap di `docs/GAP-MENU-ACCURATE-2026-07.md`.
PDF spek (`Dokumen/UI ERP KAMO 2026.pdf`) menyebut master data barang/jasa harus
"serupa dengan Accurate agar saat migrasi mudah" → 4 master data terakhir di §7
audit itu **blocker migrasi**, bukan nice-to-have.

Keputusan boss (sesi brainstorm 2026-07-28):
- **Kategori Pelanggan: golongan + harga khusus.** Golongan dibuat sendiri oleh boss
  (Reseller, Member Grooming, Korporat), tiap golongan punya diskon sendiri, kasir
  otomatis dapat harga golongan itu.
- **Kategori Barang: bertingkat 2 tingkat** (induk → anak).
- **Kategori Aset: kategori biasa dulu** (umur penyusutan + akun jurnal per kategori).
  Golongan pajak fiskal **ditunda** ke tahap "Aset Tetap lengkap".
- **Rilis sekali jalan** (bukan dua gelombang).

Aturan bisnis yang dikunci:
- Diskon golongan = **persen dari subtotal**, bukan daftar harga per barang per golongan.
  Daftar harga per barang = pekerjaan lain, di luar spec ini.
- Kategori yang masih dipakai **tidak bisa dihapus**, hanya dinonaktifkan (pola `brands`).
- Hanya OWNER/ADMIN yang boleh ubah master data (pola `brands`/`item_units`).
- Semua data lama yang sudah diketik bebas di-backfill; nol data hilang.

## 0. Status awal (jangan dikerjakan ulang)

- **Merek Barang sudah SELESAI** (migrasi 0065, `/pos/merek`, commit 7fcbe74) —
  belum ter-push ke `origin/main`, jadi belum live. Push ikut rilis spec ini.
- `item_categories` sudah ada (0001): `id, name unique, track_expiry, track_batch`.
  `track_*` **tidak dipakai kode mana pun** (dicatat di spec 0065) — dibiarkan.
- `item_units` sudah ada (0063): satuan berjenjang **per barang**, `unit varchar(20)`
  teks bebas. `items.unit` = satuan dasar, juga teks bebas.
- `suppliers` (0021): `nama, kontak, telp, alamat` — tanpa kategori.
- `customers` (0001): punya `tier varchar(20)` (New→VIP) + `tier_settings` +
  `src/lib/customer-tier.ts`. **Strata belanja otomatis ini tetap jalan apa adanya**
  dan berdiri terpisah dari golongan baru.
- `fixed_assets` (0043): `kategori varchar(40) default 'Peralatan'` teks bebas,
  dropdown 4 opsi **hardcoded** di `/keuangan/aset/page.tsx`.
- Penyusutan (`src/lib/depreciation.ts`) posting **satu jurnal agregat** ke
  `5601` (beban) / `1509` (akumulasi) untuk semua aset.
- Kasir (`/pos/transaksi`): **satu** field diskon manual level transaksi
  (`sales.discount`, nominal Rp). Tidak ada diskon per item di UI. `pos-calc.ts`
  mendukung diskon item + voucher + poin tapi UI kasir tidak memakainya.
- Promo (`src/lib/promo.ts` + `matchPromos`) = **rekomendasi kasir, bukan auto-apply**.
  Jadi tidak ada "tumpuk otomatis" yang perlu dicegah — promo masuk lewat field
  diskon manual, diskon golongan lewat kolom terpisah (lihat §5).
- Tile nav untuk 5 master data sudah ada tapi **tanpa `href`** (`src/lib/nav.ts`
  baris ~170, 186, 187, 199, 200) — tinggal disambungkan.

## 1. Satuan Barang (master global)

**Masalah:** `items.unit` & `item_units.unit` teks bebas → "pcs" / "Pcs" / "PCS"
dianggap 3 satuan berbeda. Bikin laporan stok pecah dan migrasi dari Accurate kotor.

### Migrasi
```
units(id, nama varchar(20) not null unique, is_active boolean default true, created_at)
  RLS: pola brands.
```

### Backfill
Ambil `distinct` dari `items.unit` ∪ `item_units.unit`, normalisasi
(`trim` + `lower`), masukkan ke `units`. Lalu `update` `items.unit` &
`item_units.unit` ke nama kanonik hasil normalisasi.

**Baris transaksi TIDAK disentuh** — `sale_items.satuan`, `purchase_order_items.satuan`,
`prescription_items.satuan` adalah catatan historis "apa yang diketik saat itu".
Mengubahnya = mengubah struk lama.

### Logika murni — `src/lib/satuan-master.ts` + test
- `normalizeUnit(raw: string): string` — trim, collapse spasi ganda, lowercase.
- `dedupeUnits(raws: string[]): string[]` — hasil normalisasi unik, urut.

### Halaman `/pos/satuan`
Pola `/pos/merek` persis: form inline (tambah/ubah), tabel + kolom "Dipakai"
(jumlah barang memakai satuan itu, dari `items.unit` + `item_units.unit`),
toggle Aktif/Nonaktif, guard OWNER/ADMIN.

### Dampak ke form barang
`/pos/sku` — input satuan dasar & satuan turunan berubah dari teks bebas jadi
`<select>` dari `units` aktif. Satuan yang sudah kepakai tapi dinonaktifkan tetap
tampil di baris yang sudah ada (jangan sampai nilai lama hilang saat edit).

## 2. Kategori Barang bertingkat

### Migrasi
```
item_categories + parent_id uuid references item_categories(id) on delete restrict
                + is_active boolean not null default true
create index on item_categories(parent_id);
```
`on delete restrict` supaya induk tidak bisa dihapus selama masih punya anak.
Kategori yang ada sekarang jadi **induk semua** (`parent_id` null) — tanpa backfill.

**Batas 2 tingkat** ditegakkan di server action: kategori yang punya anak tidak boleh
diberi `parent_id`, dan kategori yang punya `parent_id` tidak boleh dijadikan induk
orang lain. Tidak pakai trigger DB (ponytail: satu pintu tulis, cukup dijaga di action).

### Logika murni — `src/lib/kategori.ts` + test
- `buildTree(rows): {induk, anak[]}[]` — urut nama, anak nempel ke induknya.
- `rootOf(id, rows): id` — dipakai laporan buat meringkas per induk.
- `labelPath(id, rows): string` — "Makanan › Makanan Kucing" untuk dropdown & tabel.
- `validateParent(id, parentId, rows): string | null` — pesan error kalau melanggar
  batas 2 tingkat atau bikin lingkaran (kategori jadi induk dirinya sendiri).

### Halaman `/pos/kategori`
Pola `/pos/merek` + kolom "Induk" (`<select>` induk, opsional = jadi induk sendiri).
Tabel ditampilkan bertingkat (induk lalu anaknya, indentasi). Kolom "Dipakai" =
jumlah barang, dihitung **langsung** (bukan termasuk anak) supaya jelas.
Nonaktifkan induk → anaknya ikut disembunyikan dari dropdown pemilihan barang.

### Dampak
- `/pos/sku`: dropdown kategori pakai `labelPath`, urut hasil `buildTree`.
- Laporan yang mengelompokkan per kategori: tambah pilihan "ringkas per induk"
  memakai `rootOf`. Tidak mengubah angka, cuma pengelompokan.

## 3. Kategori Pemasok

### Migrasi
```
supplier_categories(id, nama varchar(60) not null unique,
                    is_active boolean default true, created_at)
suppliers + category_id uuid references supplier_categories(id) on delete set null
```
Tanpa backfill (belum ada datanya). Seed 4 baris awal: Obat, Pakan, Alat, Jasa.

### Halaman `/pembelian/kategori-pemasok`
Pola `/pos/merek`. Kolom "Dipakai" = jumlah pemasok.

### Dampak
- Tab Pemasok di `/pembelian`: tambah kolom & dropdown Kategori.
- Laporan hutang (`/keuangan/hutang`): tambah filter kategori pemasok.

## 4. Kategori Aset

### Migrasi
```
asset_categories(id,
  nama varchar(60) not null unique,
  umur_bulan int not null check (umur_bulan > 0),
  akun_beban varchar(10) not null default '5601',
  akun_akumulasi varchar(10) not null default '1509',
  is_active boolean default true,
  created_at)
fixed_assets + category_id uuid references asset_categories(id) on delete set null
```
`fixed_assets.kategori` (teks) **dibiarkan** sebagai jejak historis, tidak dihapus.

### Backfill
Bikin 4 kategori dari dropdown hardcoded yang sekarang, dengan umur wajar
(Peralatan 48, Inventaris Kantor 48, Kendaraan 96, Bangunan 240 bulan) lalu
`update fixed_assets set category_id = ...` dengan pencocokan nama.

### Halaman `/keuangan/kategori-aset`
Pola `/pos/merek` + kolom umur (bulan) & dua kode akun. Kedua kode akun dipilih dari
`<select>` berisi `coa_accounts` (kode + nama), jadi tidak mungkin salah ketik dan
tidak perlu validasi teks bebas.

### Dampak ke penyusutan (`src/lib/depreciation.ts`)
Jurnal penyusutan sekarang **dipecah per kategori**: aset dikelompokkan berdasarkan
`category_id`, tiap kelompok jadi sepasang baris `akun_beban` / `akun_akumulasi`
milik kategorinya, dalam **satu jurnal** yang sama. Aset tanpa kategori tetap pakai
`5601`/`1509`. Total jurnal tidak berubah, cuma rinciannya lebih benar.

Tes yang wajib ada: satu jurnal berisi 2 kategori dengan akun berbeda tetap seimbang,
dan aset tanpa kategori jatuh ke akun default.

### Dampak ke form aset
`/keuangan/aset`: dropdown Kategori jadi dari `asset_categories`; field
"umur (bulan)" **terisi otomatis** dari kategori terpilih, masih bisa ditimpa manual
(ponytail: kalibrasi tetap ada — umur riil bisa beda dari standar kategori).

## 5. Kategori Pelanggan + harga khusus

### Migrasi
```
customer_categories(id, nama varchar(60) not null unique,
                    diskon_persen numeric(5,2) not null default 0
                      check (diskon_persen >= 0 and diskon_persen <= 100),
                    is_active boolean default true, created_at)
customers + category_id uuid references customer_categories(id) on delete set null
sales + diskon_kategori numeric not null default 0
```
Seed: kosong (boss isi sendiri). Tanpa backfill — pelanggan lama tanpa golongan.

`customers.tier` **tidak disentuh**. Satu pelanggan punya dua atribut independen:
golongan (jenis, manual, memengaruhi harga) dan tier (strata belanja, otomatis,
memengaruhi poin/promo).

### Logika murni — `src/lib/harga-golongan.ts` + test
- `diskonGolongan(subtotal: number, persen: number): number`
  → `Math.min(subtotal, Math.round(subtotal * persen / 100))`, negatif/NaN → 0.

Kasus uji: persen 0, persen 100, pembulatan setengah rupiah, subtotal 0,
persen tidak wajar (negatif / >100 dari data kotor) → tetap ter-cap di `[0, subtotal]`.

### Kasir (`/pos/transaksi`)
- `page.tsx`: query pelanggan ikut ambil `category_id` + nama & persen golongannya.
- `PosClient.tsx`: begitu pelanggan dipilih, muncul **baris ringkasan sendiri**
  "Diskon Reseller (10%) − Rp x", dihitung dari subtotal. Field diskon manual tetap
  ada di bawahnya, terpisah, label diperjelas jadi "Diskon manual / promo".
  Total = `subtotal − diskon_kategori − diskon_manual`, di-floor ke 0.
- `actions.ts`: **server yang berwenang**. `diskon_kategori` dihitung ulang dari
  `customer_id` → `category_id` → `diskon_persen` di database, **tidak dibaca dari
  form** (kasir tidak bisa mengarang diskon golongan). Diskon manual tetap dari form.
- Poin & `total_spending` dihitung dari `total` akhir — otomatis ikut benar.

### Struk (`/pos/struk`)
Tambah baris "Diskon <nama golongan> (x%)" kalau `diskon_kategori > 0`, di atas
baris diskon manual. Struk lama (`diskon_kategori = 0`) tampil sama seperti sekarang.

### Halaman `/crm/kategori-pelanggan`
Pola `/pos/merek` + kolom Diskon (%). Kolom "Dipakai" = jumlah pelanggan.
Peringatan di halaman: diskon berlaku otomatis di kasir petshop.

### Dampak lain
- Tab/daftar pelanggan `/crm/pelanggan`: tambah kolom & dropdown Golongan + filter.

### Batas scope (sengaja TIDAK dikerjakan)
- Filter golongan di laporan penjualan. Halaman master sudah menunjukkan siapa masuk
  golongan apa; filter laporan menyusul kalau boss memang memintanya (YAGNI).
- **Invoice klinik** tidak ikut diskon golongan. Golongan ini harga retail; tagihan
  klinik punya alur & consent sendiri. Kalau nanti dibutuhkan, itu pekerjaan baru.
- **Order online** (`ONL-`) tidak ikut. Pembeli marketplace = teks bebas tanpa
  pelanggan (keputusan boss 2026-07-26); order WA yang ter-link pelanggan pun
  dibiarkan dulu supaya rilis ini tidak menyentuh jalur uang online yang baru diuji.
- Daftar harga per barang per golongan.

## 6. Navigasi

Sambungkan `href` 5 tile di `src/lib/nav.ts`:

| Tile | Modul | Route |
|---|---|---|
| Satuan Barang | Persediaan | `/pos/satuan` |
| Kategori Barang | Persediaan | `/pos/kategori` |
| Kategori Pemasok | Pembelian | `/pembelian/kategori-pemasok` |
| Kategori Aset | Aset Tetap | `/keuangan/kategori-aset` |
| Kategori Pelanggan | CRM | `/crm/kategori-pelanggan` |

`Kategori Pelanggan` sekarang menunjuk `/pengaturan/tier` — dipindah ke halaman baru.
Tile `Konfigurasi loyalty` (Pengaturan) tetap ke `/pengaturan/tier`, jadi strata
belanja tidak kehilangan pintu masuk.

## 7. Arsitektur & pola

**Enam halaman berdiri sendiri, bukan satu komponen generik.** Empat dari enam punya
field tambahan yang berbeda (induk; persen diskon; umur + 2 akun; polos), jadi
abstraksi generik akan butuh lubang darurat di mayoritas kasus. Pola `/pos/merek`
(server component + `actions.ts` di folder yang sama, ±150 baris) sudah terbukti,
tiap halaman muat dibaca sekali lihat, dan diff-nya paling pendek.

Yang **dibagi** cuma logika murni di `src/lib/` (`satuan-master.ts`, `kategori.ts`,
`harga-golongan.ts`) — masing-masing dengan test, sesuai pola proyek.

Bentuk tiap halaman master, sama semua:
1. Guard: `getUser` → `profiles.role` ∈ {OWNER, ADMIN}, kalau bukan → banner
   read-only (bukan redirect, biar staf tetap bisa lihat daftarnya).
2. Form inline tambah/ubah (`?edit=<id>`), tombol Batal.
3. Tabel: No, Nama, field khusus, Dipakai, Status, Aksi (Ubah / Nonaktifkan).
4. Server action: validasi nama wajib + tangkap pelanggaran unik jadi pesan
   "Nama sudah dipakai", `revalidatePath`, redirect balik dengan `?success=1`.

**Penanganan error:** semua kegagalan jadi pesan Indonesia di banner halaman, tidak
ada error Postgres mentah ke user (pelajaran dari bug `items.code` di spec 0065).

**Migrasi:** satu file `0066_master_data_kategori.sql` — semua tabel di atas +
backfill, dijalankan sekali. RLS pola `brands` (permissive, guard peran di action).

## 8. Tes

Logika murni (wajib, pola proyek — `npm test`):
- `satuan-master.test.ts` — normalisasi & dedupe.
- `kategori.test.ts` — pohon, `rootOf`, `labelPath`, `validateParent` (termasuk
  tolak 3 tingkat & tolak lingkaran).
- `harga-golongan.test.ts` — diskon persen, pembulatan, cap `[0, subtotal]`.
- `depreciation` (tambahan di test yang sudah ada) — jurnal 2 kategori tetap
  seimbang; aset tanpa kategori jatuh ke `5601`/`1509`.

Uji manual sebelum rilis (dicatat di ringkasan setelah lolos):
1. Tambah/ubah/nonaktifkan di enam halaman; nama kembar ditolak dengan pesan jelas.
2. Kategori barang: bikin induk + 2 anak; coba bikin tingkat ke-3 → ditolak.
3. Satuan: pastikan "PCS" dan "pcs" jadi satu setelah backfill, dan jumlah stok
   barang tidak berubah sebelum-sesudah migrasi.
4. Kasir: pelanggan Reseller 10% → baris diskon golongan muncul, total benar,
   poin ikut turun sesuai total akhir, struk mencetak dua baris diskon.
5. Kasir: pelanggan tanpa golongan → tampilan & total sama seperti sekarang.
6. Aset: bikin kategori umur 96 bulan → form aset terisi otomatis; jalankan
   penyusutan → jurnal seimbang dan akunnya sesuai kategori.
7. Staf (bukan OWNER/ADMIN) buka enam halaman → banner read-only, tombol tidak ada.

## 9. Rilis

Sekali jalan (keputusan boss). Urutan aman: migrasi → 6 halaman + nav → dampak
(form barang, form aset, kasir, struk, penyusutan) → `npm test` + `tsc --noEmit`
→ uji manual §8 → push `main` (sekalian membawa commit merek 7fcbe74 yang belum live).

Setelah lolos: perbarui `docs/GAP-MENU-ACCURATE-2026-07.md` (§7 Persediaan 9/14 → 11/14,
§6 Pembelian 5/9 → 6/9, §8 Aset Tetap 1/6 → 2/6, CRM 2/4 → 3/4) dan
`docs/RINGKASAN-KLONING-ACCURATE-2026-07.md`.
