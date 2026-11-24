# Rencana pindah domain ke subdomain klien (`erp.<domain-klien>`)

Status: **rencana** — belum dieksekusi. Menunggu nama domain + akses DNS dari pihak klien.

## Hasil cek kode (24 Nov 2026)

- Kode aplikasi **tidak menyimpan alamat domain** di mana pun (tidak ada `vercel.app`, `SITE_URL`,
  atau `redirectTo` yang dikunci). Semua tautan internal relatif → **tidak perlu ubah kode / tidak perlu deploy**.
- Login pakai email + password (`signInWithPassword`), bukan magic link / OAuth → tidak tergantung callback URL.
- Pembuatan akun karyawan pakai `auth.signUp` → kalau konfirmasi email aktif, tautan di email memakai
  **Site URL Supabase**, jadi Site URL tetap perlu diganti.
- Cron (`/api/cron/akhir-bulan`, `/api/cron/wa-engine`) dijalankan Vercel di project yang sama, dijaga
  `CRON_SECRET` → tidak terpengaruh domain.
- Hosting: Vercel, region `icn1`, deploy otomatis hanya dari `main`.

## Langkah eksekusi

1. **Vercel → Project → Settings → Domains → Add** `erp.<domain-klien>`.
   Vercel menampilkan record DNS yang harus dibuat (biasanya `CNAME erp → <nilai>.vercel-dns*.com`).
   Bila domain klien pernah dipakai di akun Vercel lain, Vercel juga minta record `TXT _vercel` untuk verifikasi.
2. **DNS klien** (dikerjakan IT/pemilik domain klien): buat record persis seperti yang ditampilkan Vercel.
   - Jika DNS di Cloudflare: set **DNS only (awan abu-abu)**, jangan proxied — supaya sertifikat SSL Vercel terbit.
   - Jangan ubah record lain (email/MX, website utama).
3. Tunggu status domain di Vercel jadi **Valid Configuration** + SSL terbit (menit s.d. beberapa jam).
4. **Supabase → Authentication → URL Configuration**:
   - Site URL → `https://erp.<domain-klien>`
   - Redirect URLs → tambah `https://erp.<domain-klien>/**`; biarkan alamat lama selama masa transisi.
5. **Alamat lama** (`kamo-vet-os.vercel.app`): di Vercel Domains set **Redirect to** `erp.<domain-klien>`
   (308) setelah domain baru terbukti jalan, supaya bookmark/QR lama tetap sampai.
6. Set domain baru sebagai domain utama (Primary) di Vercel.

## Dampak ke pengguna

- Sesi login tersimpan per alamat → **semua karyawan login ulang sekali** di alamat baru.
- Izin browser tersimpan per alamat → perlu diizinkan ulang di tiap perangkat:
  **lokasi (absensi mandiri)**, pop-up/cetak struk, dan pengaturan cetak otomatis/kiosk jika ada.
- Bookmark / shortcut layar utama di HP & PC kasir sebaiknya diganti ke alamat baru.
- Tautan booking publik (`/booking`) yang sudah tersebar tetap jalan lewat redirect (langkah 5).

## Uji setelah pindah (di alamat baru, Production)

- [ ] Login & logout, ganti cabang aktif
- [ ] Kasir: transaksi + cetak struk
- [ ] Klinik: antrian, rekam medis
- [ ] Absensi mandiri (izin lokasi)
- [ ] Unduh laporan (Excel/CSV)
- [ ] Halaman booking publik
- [ ] Alamat lama → otomatis pindah ke alamat baru
- [ ] Cron berikutnya (cek log Vercel setelah jadwal 02:00 UTC)

## Rollback

Hapus redirect di alamat lama (langkah 5) → aplikasi kembali bisa dipakai di `kamo-vet-os.vercel.app`
seperti sebelumnya. Tidak ada perubahan data atau kode yang perlu dibatalkan.
