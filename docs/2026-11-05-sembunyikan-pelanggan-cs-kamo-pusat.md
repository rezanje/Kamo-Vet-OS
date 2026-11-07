# Sembunyikan pelanggan dari kasir (kasus "CS Kamo Pusat") — 5 Nov 2026

Pelapor: Aldi (grup Kamo Group – ERP Dev, 17.05): "mau hide customer belum yah mas, makin banyak yg
transaksi di cs kamo pusat". Reza: "coba sambil cek kalo bisa dipisahin yg salah2".

## Yang dikerjakan

1. **Penanda sembunyi** di kartu pelanggan (`customers.hidden_at`, `hidden_by`, `hidden_reason`) —
   migrasi `20261107020000_pelanggan_disembunyikan.sql`.
   - Trigger `customers_guard_hidden`: hanya OWNER/ADMIN aktif yang boleh mengubah penanda; waktu & pelaku
     diisi server. Sesi tanpa pengguna (service/maintenance) tidak diperiksa.
   - Trigger `customers_guard_hidden_insert`: kartu baru dari sesi pengguna selalu lahir tampil.
   - Tidak ada data yang dihapus/diubah; riwayat, poin, piutang, laporan tetap utuh.
2. **Pencarian pelanggan** (`cariPelangganDb` → `/api/pelanggan?q=`) membuang kartu tersembunyi.
   Ini satu-satunya jalur pencarian untuk kasir petshop, POS back office, faktur penjualan, uang muka,
   voucher, anabul baru, dan transfer pemilik.
3. **Pengaman saat bayar**: kasir petshop (`checkoutKasir`) dan POS back office (`checkoutSale`) menolak
   pelanggan tersembunyi walau masih tersimpan di draf/keranjang. Pengecualian: transaksi **pengganti**
   di kasir (membetulkan struk lama) tetap boleh memakai pelanggan aslinya.
4. **CRM › Pelanggan** (OWNER/ADMIN): tombol "Sembunyikan dari kasir" (dengan alasan opsional) /
   "Tampilkan lagi", lencana "Disembunyikan", tombol "Lihat yang disembunyikan", dan rincian
   **transaksi per cabang** di blok Rincian Transaksi (Admin) — untuk melihat cabang mana yang memakai
   kartu umum.

## Urutan rilis aman

Kode tahan terhadap migrasi yang belum terpasang (`42703`/`PGRST204` → perilaku lama):
pencarian berjalan seperti dulu, tombol sembunyikan menampilkan "belum aktif di database".
Jadi kode boleh rilis lebih dulu; fitur aktif begitu migrasi dipasang.

Pasang migrasi secara terarah (jangan `supabase db push` massal — lihat runbook 2026-09-28).

## Belum dikerjakan — "pisahin yang salah"

Akses baca database produksi dari sesi ini ditolak (token kedaluwarsa), jadi jumlah transaksi yang salah
belum bisa dihitung. Kueri baca-saja untuk dijalankan begitu akses tersedia:

```sql
-- 1) Kartu-kartu "CS"/umum dan jumlah transaksinya per cabang
with kartu as (
  select id, name from customers where name ilike '%cs kamo%' or name ilike 'cs %'
)
select k.name as kartu, b.name as cabang, count(*) as trx, sum(s.total) as omzet,
       min(s.created_at) as pertama, max(s.created_at) as terakhir
from sales s join kartu k on k.id = s.customer_id
left join branches b on b.id = s.branch_id
where s.voided_at is null
group by 1, 2 order by 1, trx desc;

-- 2) Kunjungan klinik dengan kartu yang sama (biasanya ada nama anabul → petunjuk pemilik asli)
select b.name as cabang, v.created_at, p.name as anabul, i.total
from visits v join customers c on c.id = v.customer_id
left join pets p on p.id = v.pet_id
left join branches b on b.id = v.branch_id
left join invoices i on i.visit_id = v.id and i.voided_at is null
where c.name ilike '%cs kamo pusat%'
order by v.created_at desc;
```

Memindahkan transaksi ke pelanggan yang benar menyentuh poin, total belanja, tier, dan piutang,
jadi butuh keputusan bisnis dulu (lihat pilihan di ringkasan ke Reza):

- A. Kartu "CS" per cabang (mis. "CS Kamo Buah Batu") + transaksi cabang dipindah otomatis ke kartu
  cabangnya. Tanpa poin; aman untuk laporan per cabang.
- B. Dibetulkan satu-satu ke pelanggan asli lewat transaksi pengganti (yang ada sekarang). Akurat
  tetapi manual.
- C. Dibiarkan; cukup disembunyikan mulai sekarang.

## Hasil uji (sesi ini)

- `vitest run`: 815 file lulus, 2 dilewati (7.280 tes lulus).
- Uji baru: pencarian membuang kartu tersembunyi; jatuh ke perilaku lama bila kolom belum ada;
  `pelangganDisembunyikan` (tersembunyi / tampil / tanpa id / kolom belum ada / galat lain).
- Uji pembanding promo (kasir & POS): satu-satunya beda dari main adalah bacaan `customers.hidden_at`
  (baca-saja) — dinormalisasi seperti tambahan baca-saja tahap 3b/4.
- `tsc --noEmit`, `eslint` (berkas yang diubah), `next build`: lulus.
- Belum diuji: migrasi pada database sungguhan (staging/produksi), uji klik di browser.
