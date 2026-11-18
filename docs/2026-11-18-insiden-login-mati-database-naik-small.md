# 2026-11-18 — Insiden: semua user gagal login (instance Supabase hang), compute naik ke Small

Kelanjutan insiden serupa: `2026-11-01-insiden-login-macet-database.md`.

## Gejala
Sekitar 17.12 WIB tidak ada user yang bisa login. Halaman yang membaca data juga tidak bisa dibuka.

## Temuan (log Supabase + Management API)
- 10:00–10:07 UTC: Auth mulai `504 request_timeout`, `500 unexpected_failure` (`i/o timeout` /
  `dial tcp [::1]:5432: operation was canceled` ke Postgres), `409` refresh token bersamaan.
  Postgres: 16× `canceling statement due to statement timeout` dalam 5 menit (10:05–10:10).
- ±10:12 UTC: semua log (Postgres, Auth, PgBouncer) berhenti. Edge log 10:15–10:48 UTC hampir semuanya
  `522` (origin tidak menjawab). Health API: auth/db/rest/storage `UNHEALTHY`, pooler sehat.
  `get_project` tetap `ACTIVE_HEALTHY`, dan status.supabase.com "All Systems Operational", jadi
  masalahnya ada di instance kita sendiri, bukan gangguan di sisi Supabase.
- Trafik sebelum jatuh normal (±5.300 permintaan edge/5 menit, sama seperti sepanjang hari). Bukan lonjakan.
- Ukuran: compute **Micro** (RAM 1 GB, CPU shared, baseline disk IO 87 MB/s), database **928 MB**,
  disk **2 GB** (terpakai 1,3 GB sesudah restart). Data hampir sebesar RAM, jadi cache sering meleset
  dan beban pindah ke disk.
- Tidak ada pesan OOM di log Postgres (OOM kill tidak terlihat dari API log). pg_stat_statements
  ter-reset oleh restart, jadi kueri yang macet tidak bisa dilacak.
- Pola per halaman: tiap muat halaman ±8 kueri cek akses (profiles ×2, branches, get_my_submenu_policy,
  role_modules, get_my_access_override, cashier_shifts, role_capabilities, user_branches). Tidak salah,
  tapi itu yang memenuhi volume REST.
- Error `sales_no_struk_key` (duplikat nomor struk) muncul konsisten 16–84×/jam sepanjang 17–18 Nov,
  jadi bukan pemicu insiden ini. Perlu dicek terpisah.

## Tindakan (dengan izin pemilik: "acc semua keputusan")
1. 10:48:33 UTC — `POST /v1/projects/{ref}/restart`. Status RESTARTING lalu ACTIVE_HEALTHY 10:53:23 UTC.
   Auth health 200 (±1 s), SQL jalan, koneksi 20/60.
2. 10:55:13 UTC — compute Micro → **Small** (`PATCH billing/addons ci_small`; RAM 2 GB, baseline IO
   174 MB/s, koneksi direct 90 / pooler 400; ±$15/bulan, naik ±$5). Status RESIZING ±1 menit, lalu
   ACTIVE_HEALTHY 10:56:07 UTC.
3. 10:56:41 UTC — disk 2 GB → **8 GB** gp3 (3000 IOPS, 125 MiB/s), online tanpa downtime. Setelah
   resize, disk tidak bisa diubah lagi selama ±6 jam.
4. Verifikasi 10:57 UTC: edge ±490 permintaan 200/menit, 0 error 5xx, event login/refresh token
   masuk lagi.

## Tindak lanjut
- Pantau besok jam ramai, pastikan tidak ada lagi `statement timeout` atau 522.
- Kalau database terus tumbuh mendekati 2 GB, pertimbangkan Medium (RAM 4 GB, ±$60/bulan).
- Opsional: cache hasil cek akses per sesi supaya tiap halaman tidak menembak ±8 kueri.
- Opsional (sudah dicatat 1 Nov): tombol login diberi batas waktu dan pesan "server sedang sibuk".
- Cek sumber error duplikat nomor struk.
