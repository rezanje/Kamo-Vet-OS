# Kasir Buta — Tutup Shift Design Spec

**Tanggal:** 2026-07-17
**Modul:** Klinik (shift) + POS Petshop (kasir) + middleware role gate + nav

## Masalah

Form tutup shift (klinik & petshop) menampilkan breakdown kas per metode bayar dan
"kas seharusnya" ke kasir sebelum dia input kas fisik. Petshop lebih parah — selisih
dihitung & ditampilkan real-time saat kasir mengetik. Ini bikin kasir bisa nyesuain
angka fisik yang diinput biar "pas", ngerusak fungsi kontrol internal (kas fisik
harus dihitung independen dari ekspektasi sistem).

Setelah submit, kasir juga di-redirect ke `/pos/shift/[id]` (Laporan Shift lengkap
manajer) — jadi walau form-nya disembunyikan, dia tetap lihat semua di layar berikutnya.

Sebaliknya, FINANCE (yang justru butuh liat selisih buat kontrol) sekarang sama
sekali gak bisa akses `/pos/shift` — cuma liat 1 baris jurnal nominal di buku besar,
tanpa breakdown per shift.

## Keputusan (hasil brainstorming)

- Kasir (klinik & petshop): form tutup shift cuma nampilin field kas fisik + tombol.
  Gak ada breakdown, gak ada "kas seharusnya", gak ada selisih real-time.
- Setelah submit: kasir balik ke menu utama masing-masing (`/klinik` / `/kasir`),
  bukan ke Laporan Shift.
- Backend (`shift-calc.ts`, kalkulasi `expected`/`selisih`, jurnal selisih akun 5901)
  **tidak berubah** — recompute server-side dari kas fisik yang diinput, tetap jalan.
  Ini murni UI-hide + redirect, bukan ubah logic.
- FINANCE + OWNER/ADMIN tetap/jadi bisa lihat selisih via `/pos/shift` (halaman existing,
  tidak dibuat baru). `/pos/shift/*` sengaja tidak disentuh — itu surface yang memang
  boleh nampilin data ke manajer.
- FINANCE dapat akses middleware ke `/pos/shift` (scope sempit — bukan seluruh `/pos`).
- FINANCE butuh nav link biar discoverable (bukan cuma tau URL) — tambah 1 tile
  "Shift kasir (selisih kas)" di modul Keuangan yang nunjuk ke `/pos/shift`.
  Pola cross-module href tile sudah ada di codebase (tile `buku-besar` nunjuk ke
  `/hris/penggajian`, `/keuangan/hutang`, dst).
- Scope: klinik DAN petshop dua-duanya.

## Perubahan per file

### 1. `src/app/(app)/klinik/shift/page.tsx`
Hapus blok "KAS DITERIMA PER METODE (INVOICE SHIFT INI)" (loop `PAYMENT_METHODS`) dan
baris "Kas seharusnya (modal + tunai)". Hapus import `expectedCash, invoiceCashRows,
methodBreakdown, PAYMENT_METHODS` dan query `invoices` + kalkulasi `breakdown`/`expected`
yang jadi tidak terpakai (bagian shift-berjalan). Form tutup jadi: judul "Shift Klinik
Berjalan" + cabang/jam buka (tetap, bukan data sensitif) + input kas fisik + tombol.
Bagian "mulai shift" (belum ada shift) **tidak berubah**.

### 2. `src/app/(app)/klinik/shift/actions.ts`
`tutupShiftKlinik`: ganti baris terakhir `redirect(\`/pos/shift/${shiftId}\`)` menjadi
`redirect("/klinik?success=close")`. Semua kalkulasi (`methodBreakdown`, `expectedCash`,
`cashVariance`, update `cashier_shifts`, `postJournal` selisih) **tidak berubah**.

### 3. `src/app/(app)/klinik/page.tsx`
File ini saat ini tidak menerima `searchParams` sama sekali (langsung render
`StaffKlinikHome` atau `ModuleHome` tanpa parameter). Tambah `searchParams: Promise<{
success?: string }>`, destructure `success`, render banner hijau (`p2ban`, pola sama
seperti `kasir/persediaan/page.tsx`) sebagai sibling sebelum komponen existing:
```tsx
export default async function Page({ searchParams }: { searchParams: Promise<{ success?: string }> }) {
  const { success } = await searchParams;
  // ...existing profile fetch...
  return (
    <>
      {success === "close" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Shift ditutup.
        </div>
      )}
      {profile?.role === "STAFF" ? <StaffKlinikHome fullName={profile.full_name ?? "Staff"} /> : <ModuleHome moduleId="klinik" />}
    </>
  );
}
```

### 4. `src/app/kasir/tutup/page.tsx`
Hapus blok "BREAKDOWN PER METODE BAYAR" (loop metode), "Grand total omset", dan
`Stat` grid (Modal awal kas / Kas seharusnya). Hapus import `expectedCash,
methodBreakdown, PAYMENT_METHODS` dan kalkulasi `breakdown`/`omset`/`expected`/
`extraMethods` yang jadi tidak terpakai. Fungsi `Stat` (didefinisikan di file ini,
baris ~80) hanya dipakai oleh 2 baris yang dihapus di atas — hapus juga definisinya.
Sisakan: judul "Selesai Shift" + cabang/jam buka/jumlah transaksi (bukan data
sensitif) + `<TutupForm shiftId={shift.id} />` (tanpa prop `expected`) + link batal.

### 5. `src/app/kasir/tutup/TutupForm.tsx`
Hapus prop `expected: number`, state `actual`/`num`/`selisih`/`touched`, dan blok
render banner selisih real-time + baris keterangan "Selisih ≠ 0 tetap bisa tutup...".
Form jadi: label "Total uang cash di kasir (fisik)" + input `closing_balance` (uncontrolled
atau controlled minimal tanpa live-diff) + `SubmitButton` teks "Tutup Shift" (bukan
"Tutup Shift & Lihat Laporan").

### 6. `src/app/kasir/actions.ts`
`tutupShiftKasir`: ganti baris terakhir `redirect(\`/pos/shift/${shiftId}\`)` menjadi
`redirect("/kasir?success=close")`. Kalkulasi (`methodBreakdown`, `expectedCash`,
`cashVariance`, update `cashier_shifts`, `postJournal` selisih) **tidak berubah**.

### 7. `src/app/kasir/page.tsx` + `src/app/kasir/KasirClient.tsx`
`kasir/page.tsx` sudah punya `searchParams: Promise<{ error?: string }>` dan meneruskan
`error` sebagai prop ke `<KasirClient error={error} />`, yang merender `p2ban` merah di
baris pertama JSX-nya. Tambah `success?: string` ke tipe `searchParams` dan ke props
`KasirClient`, teruskan sama seperti `error`:
```tsx
// kasir/page.tsx
searchParams: Promise<{ error?: string; success?: string }>
// ...
const { error, success } = await searchParams;
// ...
<KasirClient ... error={error} success={success} />
```
```tsx
// KasirClient.tsx — props: tambah `success?: string`.
// Render banner hijau sebagai sibling dari banner error yang sudah ada:
{success === "close" && (
  <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
    <i className="ti ti-circle-check" /> Shift ditutup.
  </div>
)}
```

### 8. `src/lib/supabase/middleware.ts`
`FINANCE_ALLOWED` (baris ~49) tambah `"/pos/shift"`:
```ts
const FINANCE_ALLOWED = ["/", "/buku-besar", "/keuangan", "/me", "/mulai", "/login", "/auth", "/pos/shift"];
```
Prefix-match existing (`path === p || path.startsWith(p + "/")`) otomatis meng-cover
`/pos/shift/[id]` juga karena `"/pos/shift"` cocok prefix. Sisa `/pos/*` (transaksi,
stok, permintaan, expense, quest) tetap terblokir buat FINANCE.

### 9. `src/lib/nav.ts`
Tambah 1 tile baru di array `TILES.keuangan` (posisi bebas, sarankan di akhir sebelum
"Lap. HPP" atau setelahnya):
```ts
{ label: "Shift kasir (selisih kas)", icon: "ti-clock-dollar", ...B, href: "/pos/shift" },
```
Pakai warna `B` (biru) yang sudah didefinisikan di file yang sama. Tile ini muncul di
`ModuleHome` modul Keuangan untuk semua role yang bisa akses modul `keuangan`
(FINANCE, OWNER, ADMIN) — tidak ada role-filter tambahan di `ModuleHome`, jadi cukup
menambah entry data.

## Yang TIDAK disentuh

- `src/lib/shift-calc.ts` — kalkulasi `expectedCash`/`cashVariance`/`methodBreakdown`
  sudah benar, dipakai apa adanya oleh actions.
- `src/app/(app)/pos/shift/page.tsx` dan `[id]/page.tsx` — surface manajer/finance
  yang memang boleh nampilin breakdown & selisih. `isManager` gate (OWNER/ADMIN) di
  dalamnya tetap: FINANCE bisa lihat data tapi tidak dapat tombol force-close (aksi
  manajerial), yang memang benar secara desain.
- Skema database, RLS, jurnal posting — tidak ada perubahan data model.

## Data flow (sebelum vs sesudah)

**Sebelum:** Kasir isi kas fisik (lihat ekspektasi) → submit → redirect ke Laporan
Shift (lihat semua lagi).

**Sesudah:** Kasir isi kas fisik buta (satu-satunya input) → submit → server hitung
`expected`/`selisih` (tidak berubah) → simpan + jurnal 5901 kalau selisih ≠ 0 (tidak
berubah) → redirect ke menu utama kasir (`/klinik` atau `/kasir`) dengan banner sukses
singkat, tanpa angka selisih. FINANCE/OWNER/ADMIN cek selisih kapan saja lewat
`/pos/shift` (existing), FINANCE sekarang nemu via tile baru di modul Keuangan.

## Error handling

Tidak ada perubahan pada jalur error existing (shift tidak valid, shift sudah
ditutup) — pesan error tetap redirect ke halaman tutup masing-masing dengan
`?error=`, itu bagian dari flow yang sudah ada dan tidak sensitif (tidak membocorkan
selisih).

## Testing

- Verifikasi visual: buka `/klinik/shift` dan `/kasir/tutup` saat shift berjalan —
  pastikan tidak ada angka breakdown/ekspektasi/selisih di halaman atau saat mengetik.
- Submit tutup shift (klinik & petshop) — verifikasi redirect ke `/klinik`/`/kasir`
  (bukan `/pos/shift/[id]`), banner sukses muncul.
- Verifikasi DB: `cashier_shifts.expected_cash`/`selisih`/`closing_breakdown` tetap
  terisi benar setelah submit (backend tidak berubah) — query langsung.
- Verifikasi jurnal: kalau `closing_balance` dibuat beda dari ekspektasi (sengaja),
  cek entry akun 5901 tetap ter-post seperti sebelumnya.
- Role gate: login sebagai FINANCE, akses `/pos/shift` — harus berhasil (sebelumnya
  redirect ke `/`). Cek tile "Shift kasir (selisih kas)" muncul di `/keuangan`.
  Akses `/pos/transaksi` sebagai FINANCE — harus tetap terblokir (redirect ke `/`).
- Role gate: login sebagai STAFF, pastikan `/klinik/shift` dan `/kasir/tutup` masih
  bisa diakses seperti biasa (STAFF_ALLOWED tidak berubah).

## Out of scope

- Perubahan kalkulasi selisih atau jurnal posting.
- Halaman Laporan Shift baru — pakai `/pos/shift` yang sudah ada.
- Force-close shift atau kemampuan manajerial lain untuk FINANCE — tetap OWNER/ADMIN only.
- Notifikasi/alert otomatis ke Finance saat ada selisih besar (bisa jadi fitur lanjutan,
  tidak diminta sekarang).
