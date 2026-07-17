# Owner detail stat row (rata2 transaksi / poin / total transaksi)

## Problem

Halaman detail pasien klinik (`src/app/(app)/klinik/antrian/[id]/page.tsx`) menampilkan header owner (nama, telepon, kategori, alamat, cabang, tanggal daftar) tapi tidak menampilkan ringkasan transaksi customer. Petshop (kasir) sudah menampilkan poin dan total transaksi di strip customer-nya; owner mau info setara (rata-rata transaksi, poin, total transaksi) juga muncul di halaman klinik ini.

## Scope

Satu file diedit: `src/app/(app)/klinik/antrian/[id]/page.tsx`. Tidak ada migration, tidak ada dependency baru, tidak ada perubahan komponen lain (`RiwayatTabs.tsx` tidak disentuh).

## Data

- Tambah `id, points` ke select `customers(...)` pada query `visits` yang sudah ada (baris ~41).
- Setelah `cust` di-resolve, jika `cust?.id` ada, jalankan `Promise.all` dua query baru:
  - Petshop: `supabase.from("sales").select("total").eq("customer_id", cust.id)`
  - Klinik: `supabase.from("invoices").select("total, visits!inner(customer_id)").eq("paid_status", "Lunas").is("voided_at", null).eq("visits.customer_id", cust.id)`
- Gabungkan `total` dari kedua hasil jadi satu array angka → `count = array.length`, `sum = reduce(+)`, `avg = count ? sum / count : 0`.
- `poin = cust?.points ?? 0`.
- Pola aggregasi ini identik dengan `statByCust` di `src/app/(app)/crm/pelanggan/page.tsx:58-75`, cuma di-scope ke satu `customer_id` (bukan `.in(ids)` tapi `.eq(id)`), dan tidak di-gate admin-only (beda dari section RINCIAN TRANSAKSI di situ).

## Format

Tambah konstanta lokal `const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");` — mengikuti konvensi yang sudah dipakai di banyak file lain (mis. `src/app/(app)/keuangan/*/page.tsx`). File ini belum punya formatter rupiah sendiri.

## Render

Header card (`page.tsx:127-152`) saat ini satu baris grid 4 kolom (`Kategori | Alamat | Cabang | Tanggal Daftar`) memakai komponen `HeadCell` yang sudah ada. Tambah baris kedua di dalam card yang sama, grid 3 kolom, memakai `HeadCell` juga (reuse, tanpa komponen baru):

- `HeadCell icon="ti-trending-up" label="RATA-RATA TRANSAKSI" value={rp(avg)}`
- `HeadCell icon="ti-star" label="POIN" value={`${poin.toLocaleString("id-ID")} Poin`}`
- `HeadCell icon="ti-shopping-bag" label="TOTAL TRANSAKSI" value={`${count}x · ${rp(sum)}`}`

Baris kedua dipisah border tipis dari baris pertama (`borderTop: ".5px solid var(--bd)"`, `marginTop`/`paddingTop` kecil) supaya tidak menyatu visual dengan baris kategori/alamat/cabang/tanggal.

## Edge cases

- Customer tanpa transaksi sama sekali (`count === 0`): avg tampil `Rp 0`, total tampil `0x · Rp 0`. Tidak perlu state error/loading tambahan — ini server component, data sudah lengkap saat render.
- `cust` null (data tidak konsisten): skip kedua query tambahan, treat count/sum/avg/poin sebagai 0 — sama seperti field header lain yang sudah fallback ke `"—"`/`?? "—"`.

## Out of scope

- Tidak menambah gating admin-only (beda dari section "RINCIAN TRANSAKSI (ADMIN)" di `PelangganClient.tsx`) — stat ini tampil untuk semua role yang bisa akses halaman ini, sama seperti field header lain di halaman ini.
- Tidak mengubah `CustStat` komponen di kasir maupun `PelangganClient.tsx`.
- Tidak menyimpan hasil agregasi ke kolom baru di tabel manapun — dihitung on-the-fly tiap render, konsisten dengan pola yang sudah ada di `pelanggan/page.tsx`.
