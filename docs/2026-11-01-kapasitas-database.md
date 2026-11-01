# 2026-11-01 — Pengukuran kapasitas database (Nano → Micro) & penyebab tumbang

Lanjutan `docs/2026-11-01-insiden-login-macet-database.md`. Semua angka dari produksi
(baca saja): edge log Supabase (`request.sb.auth_user`, `response.origin_time`,
`response.status_code`) dan `pg_stat_statements` (direset tiap restart Postgres).

## Koreksi temuan sebelumnya
Dashboard menunjukkan compute **NANO** (≤0,5 GB RAM, CPU shared, bisa burst sebentar), bukan
Micro, walau ditagih seharga Micro (organisasi PRO). Pemilik meng-upgrade ke **MICRO**
(1 GB RAM, shared; "Free Upgrade", harga sama) — Postgres start ulang 07:34:24 UTC.

## Linimasa (UTC; WIB = UTC+7)
| Waktu | Pengguna unik / 15 mnt | Permintaan / 15 mnt | p50 | Catatan |
|---|---|---|---|---|
| 00:30–02:30 | 6–14 | 2k–14k | 120–137 ms | normal (Nano) |
| 02:35 | 10 | — | 256 ms → 12 s (02:45) | live #386: kasir memuat semua 10.426 pelanggan; permintaan `customers` ±50 → ±370 per 5 mnt |
| 02:45–04:15 | 14–22 | 4k–6k | 3–51 s | tumbang; 04:17 database tidak menjawab sama sekali |
| 05:00 | — | — | — | live #388 (pelanggan dicari di server) |
| 05:36 / 06:22 | — | — | — | restart oleh pemilik; tiap kali pulih ±15–20 mnt lalu tumbang lagi pada 14–24 pengguna |
| 06:40 | — | — | — | live #390 (katalog kasir disimpan sementara) |
| 07:00–07:11 | 6–14 | ±1k / mnt | ±130 ms | sehat |
| 07:12–07:23 | 16–20 | 300–1.200 / mnt | 8–86 s | tumbang lagi di Nano (sebelum #391 live 07:18) |
| 07:34 | — | — | — | **upgrade ke Micro** |
| 07:45–08:45 | **23–25** | **14k–17,7k** | **114–117 ms** | p99 0,36–1,8 s, **0 error 5xx** |

## Beban database (waktu eksekusi total / waktu dinding)
- Nano, sebelum perbaikan kasir (06:22–06:42): ±0,65 core rata-rata; 07:13–07:20: ±0,8 core
  (perintah paling ringan `set_config` sampai 7,7 s → antre CPU).
- Nano, sesudah #390 (07:00–07:08, 14 pengguna): ±0,20 core.
- **Micro + #390 + #391 (07:34–08:48, 74 menit, 16–25 pengguna): 299,6 s / 4.456 s ≈ 0,07 core.**
  Penyumbang terbesar kini `cashier_post_stock_atomic` (posting penjualan, wajar), katalog
  barang, insert penjualan. `realtime.list_changes` hilang (0 langganan Realtime).

## Kesimpulan
1. **Pemicu awal** (09:35 WIB) adalah perubahan aplikasi #386 yang memuat seluruh pelanggan di
   kasir — bukan jumlah pengguna (saat itu 10–15 orang).
2. **Sesudah itu** database Nano tidak sanggup pulih: begitu tenaga burst habis, beban normal
   15–20 pengguna (±0,2–0,65 core, ditambah katalog kasir/klinik dan Realtime) sudah melampaui
   kemampuannya. Terbukti: koneksi tidak penuh (29/60), tetapi perintah sepele antre detikan.
3. **Micro + perbaikan aplikasi** menampung 23–25 pengguna/15 menit dengan beban rata-rata
   ±0,07 core dan respons p50 ±115 ms. Tidak bisa dipisahkan berapa bagian dari Micro dan
   berapa dari #391, karena keduanya live berdekatan (07:18 dan 07:34).

## Rekomendasi
- Tetap Micro; pantau di jam ramai berikutnya (target 25–30 pengguna). Naik ke Small
  (+±$5/bulan) bila p95 > 1 s berulang atau beban rata-rata > ±0,3 core.
- Sisa beban yang bisa dihemat berikutnya: cek shift (`cashier_shifts`) & bacaan middleware per
  navigasi; pencarian pelanggan `ilike '%..%'` tanpa indeks trigram (±30–500 ms).
- Kueri diagnosa berat ke produksi hanya di jam sepi dengan `statement_timeout`.
- Minta pengguna memuat ulang (F5) layar yang terbuka sejak pagi agar memakai versi terbaru.

## Belum diuji
- Puncak 25–30 pengguna bersamaan dalam satu 5 menit (tertinggi terukur: 20 per 5 menit,
  25 per 15 menit).
- UAT pengguna untuk #390/#391.
