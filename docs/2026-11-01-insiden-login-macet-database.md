# 2026-11-01 — Insiden: login muter terus (database Supabase hang)

## Gejala
Sekitar 12.10 WIB: tombol "Masuk" berputar terus. Halaman lain yang membaca data juga macet.

## Temuan (log Supabase + pg_stat_activity, baca saja)
- Edge log Supabase: normal sampai 04:16 UTC (11:16 WIB). Mulai 04:17 UTC hampir semua permintaan
  REST/Auth gagal 522/504 (origin tidak menjawab). Realtime log 04:28–04:50: pool koneksi DB tidak
  tersedia (`queue_timeout`) dan `statement timeout` pada pemeriksaan internal.
- 05:22–05:23 UTC sempat pulih ±2 menit lalu jatuh lagi.
- Koneksi SQL lewat Management API pun timeout sampai project di-restart pemilik. Postgres start ulang
  05:36:41 UTC; sesudahnya /booking ±0,4 s dan aksi login (kredensial salah) ±0,5–0,9 s.
- Volume permintaan saat jatuh (±800/5 menit) lebih kecil dari puncak pagi (±6.100/5 menit pukul
  02:20 UTC) — jadi bukan murni lonjakan trafik aplikasi.
- Ukuran instance: `max_connections`=60, `shared_buffers`=224 MB (kelas Micro, RAM ±1 GB).
- pg_stat_statements (kumulatif sejak Juni, tidak bisa dipotong per jam) menunjukkan kueri berat
  dari Management API (sesi agen/diagnosa) di hari yang sama, mis. pengecekan duplikat no. HP
  pelanggan `exists(... regexp_replace(o.phone) = regexp_replace(c.phone))` — self-join O(n²) atas
  ±10.400 pelanggan, 25 s sekali jalan; `query_to_xml` hitung semua tabel (317 MB temp); dump
  `activity_log` per halaman. Statistik hanya mencatat kueri yang selesai, jadi kueri yang macet
  sampai restart tidak terlihat.
- Tidak ada pg_cron; cron Vercel akhir-bulan jalan 01:00 UTC dan selesai jauh sebelum insiden.

## Kesimpulan
Penyebab pasti tidak bisa dibuktikan (log Postgres tidak tersedia lewat API log, kueri yang
macet hilang saat restart). Paling mungkin: instance Micro kehabisan CPU/RAM karena gabungan beban
hari itu (impor 10 ribu+ pelanggan, layar yang sempat memuat semua pelanggan — PR #387, sudah
diganti #388 — dan kueri diagnosa berat lewat Management API). Kode login tidak bermasalah:
tombol hanya menunggu Supabase Auth yang tidak menjawab.

## Tindak lanjut
- Kueri diagnosa ke produksi: wajib `set statement_timeout` pendek dan hindari self-join O(n²)
  atas tabel pelanggan; jalankan di jam sepi.
- Pertimbangkan naik kelas compute (keputusan biaya ada di pemilik).
- Opsional: tombol login diberi batas waktu + pesan "server sedang sibuk", supaya tidak berputar
  tanpa akhir.
