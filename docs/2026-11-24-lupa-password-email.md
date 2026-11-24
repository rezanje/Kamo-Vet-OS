# 2026-11-24 — Lupa password lewat email (pilihan C)

Pemicu: tim rekrutmen (grup "Kamo Group - ERP Dev", 15.30) bertanya cara menangani karyawan lupa password,
membandingkan dengan tombol "Reset & Kirim Password" di GajiHub. Reza memilih opsi C: link reset dikirim ke email.

## Yang dibangun
- **Halaman masuk**: tautan "Lupa password?" di bawah kolom password; pesan hijau `?reset=ok` setelah berhasil.
- **`/login/lupa-password`** (publik): isi email → `resetPasswordForEmail`. Jawaban "terkirim" sama untuk email
  terdaftar/tidak (tidak bisa dipakai menebak akun). Domain cadangan (`.local`, `.test`, …, mis. akun lama
  `@vetos.local`) ditolak dengan arahan ke admin, karena tidak bisa menerima email.
- **`/login/password-baru`** (publik): dibuka dari link email. Token pemulihan dibaca dari bagian `#` alamat sekali,
  lalu dihapus dari alamat. Server action memasang sesi pemulihan di klien Supabase tanpa cookie, `updateUser`,
  lalu `signOut({scope:"global"})` (semua perangkat keluar — sama dengan reset Super Admin U13).
- **Pengaturan → Pengguna → Edit → Reset Login (Super Admin)**: tombol "Reset & kirim link ke email". Email login
  dibaca via `get_user_login_email` (sudah khusus OWNER), lalu link dikirim. Admin tidak pernah melihat password.
- Cadangan: bila alamat `/login/password-baru` belum terdaftar di Supabase, link jatuh ke Site URL → middleware
  membelokkan ke `/login` dengan `#` terbawa → `TerusanPemulihan` meneruskannya ke `/login/password-baru`.

## Keputusan teknis
- Alur **implicit** (bukan PKCE bawaan `@supabase/ssr`): PKCE menyimpan code-verifier di cookie perangkat peminta,
  jadi link gagal bila diminta di laptop tapi dibuka di HP, dan gagal total untuk tombol admin (verifier tersimpan
  di browser admin). Token implicit ada di `#`, tidak pernah terkirim ke server lewat URL/log.
- Tidak ada kunci service-role; tidak ada migrasi database.
- `redirectTo` dibangun dari header `x-forwarded-host`/`host` (divalidasi pola host); Supabase tetap hanya menerima
  alamat yang ada di daftar Redirect URLs.

## Wajib diatur di Supabase (bukan kode) — sebelum fitur benar-benar jalan
1. **SMTP sendiri** — Authentication → Emails → SMTP Settings. Pengirim email bawaan Supabase hanya mengirim ke
   alamat anggota tim project dan dibatasi beberapa email/jam, jadi karyawan biasa tidak akan menerima link.
   Butuh akun layanan email (mis. Resend/Brevo) + verifikasi domain pengirim (DNS).
2. **Redirect URLs** — Authentication → URL Configuration: tambah `https://kamo-vet-os.vercel.app/login/password-baru`.
   Site URL = `https://kamo-vet-os.vercel.app`.
3. **Template email "Reset Password"** (bahasa Indonesia), tetap memakai `{{ .ConfirmationURL }}`. Usulan:
   - Subjek: `Buat password baru VetOS Kamo Group`
   - Isi: `Halo, ada permintaan membuat password baru untuk akun VetOS kamu. Klik link berikut (berlaku 1 jam,
     sekali pakai): <a href="{{ .ConfirmationURL }}">Buat password baru</a>. Kalau kamu tidak memintanya, abaikan email ini.`
4. Setelah SMTP aktif: Authentication → Rate Limits → naikkan batas email per jam sesuai kebutuhan.

Sebelum langkah 1 selesai, permintaan link ke email karyawan akan muncul sebagai "Link belum bisa dikirim"
(galat Supabase dicatat di log server dengan kode saja, tanpa alamat email).

## Tes
- `src/lib/__tests__/lupa-password.test.ts` — aturan murni, minta link, simpan password (Supabase di-mock).
- `src/lib/__tests__/owner-reset-login-action.test.ts` — tombol kirim link Super Admin.
- Uji browser lokal halaman login / lupa password / password baru (tanpa Supabase asli).
- Belum diuji: pengiriman email sungguhan & klik link asli (menunggu SMTP + Redirect URL di Supabase produksi).
