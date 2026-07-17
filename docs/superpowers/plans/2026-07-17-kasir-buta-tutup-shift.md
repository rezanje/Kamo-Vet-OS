# Kasir Buta — Tutup Shift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sembunyikan semua angka (breakdown per metode, kas seharusnya, selisih real-time) dari form tutup shift kasir klinik & petshop — kasir cuma isi kas fisik; setelah submit balik ke menu utama, bukan ke Laporan Shift. Selisih tetap dihitung server-side & hanya bisa dilihat FINANCE/OWNER/ADMIN via `/pos/shift` (existing).

**Architecture:** Murni UI-hide + ubah redirect + role gate + nav. Backend (`shift-calc.ts`, kalkulasi `expected`/`selisih`, jurnal 5901, update `cashier_shifts`) TIDAK diubah — cuma dipanggil apa adanya. FINANCE diberi akses middleware ke `/pos/shift` + tile discoverability di modul Keuangan.

**Tech Stack:** Next.js 15 App Router (server components + server actions), TypeScript, Supabase. Tidak ada test runner untuk task ini (perubahan presentational + redirect) — verifikasi via `npx tsc --noEmit`, browser preview, dan query DB untuk membuktikan backend tak berubah.

**Spec:** `docs/superpowers/specs/2026-07-17-kasir-buta-tutup-shift-design.md`

---

## File Structure

| File | Aksi | Tanggung jawab |
|------|------|----------------|
| `src/app/(app)/klinik/shift/page.tsx` | Modify | Buang breakdown+seharusnya dari view shift-berjalan |
| `src/app/(app)/klinik/shift/actions.ts` | Modify | Redirect tutup → `/klinik?success=close` |
| `src/app/(app)/klinik/page.tsx` | Modify | Banner sukses `success=close` |
| `src/app/kasir/tutup/page.tsx` | Modify | Buang breakdown/omset/Stat grid |
| `src/app/kasir/tutup/TutupForm.tsx` | Modify | Buang selisih real-time + prop `expected` |
| `src/app/kasir/actions.ts` | Modify | Redirect tutup → `/kasir?success=close` |
| `src/app/kasir/page.tsx` | Modify | Teruskan `success` ke KasirClient |
| `src/app/kasir/KasirClient.tsx` | Modify | Banner sukses `success=close` |
| `src/lib/supabase/middleware.ts` | Modify | `FINANCE_ALLOWED` += `/pos/shift` |
| `src/lib/nav.ts` | Modify | Tile "Shift kasir" di modul Keuangan |

Urutan task dikelompokkan: klinik (Task 1-2), petshop (Task 3-4), akses finance (Task 5), verifikasi (Task 6).

---

## Task 1: Klinik — buang angka dari form tutup shift + ubah redirect

**Files:**
- Modify: `src/app/(app)/klinik/shift/page.tsx`
- Modify: `src/app/(app)/klinik/shift/actions.ts`

- [ ] **Step 1: Ubah import di `page.tsx`**

Baris 5 saat ini:
```tsx
import { expectedCash, invoiceCashRows, methodBreakdown, PAYMENT_METHODS } from "@/lib/shift-calc";
```
Hapus baris ini seluruhnya (tidak ada lagi yang dipakai di file setelah Step 2).

- [ ] **Step 2: Ganti blok view "shift berjalan"**

Di `page.tsx`, cari blok `if (shift) { ... }`. Ganti dari awal `if (shift) {` sampai `return ( ... );`-nya berakhir (baris `}` penutup if, tepat sebelum `const { data: branches }`). Blok saat ini:
```tsx
  if (shift) {
    // shift berjalan → ringkasan + tutup shift.
    const { data: invoices } = await supabase
      .from("invoices").select("total, dp_amount, paid_status, metode_bayar").eq("shift_id", shift.id);
    const breakdown = methodBreakdown(invoiceCashRows(invoices ?? []));
    const expected = expectedCash(Number(shift.opening_balance), breakdown);

    return (
      <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--sb)" }}>Shift Klinik Berjalan</div>
          <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 2 }}>
            {shift.branchName} · dibuka {new Date(shift.opened_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        {error && (
          <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", maxWidth: 440 }}>
            <i className="ti ti-alert-circle" /> {error}
          </div>
        )}
        <div className="card" style={{ width: "100%", maxWidth: 460, padding: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tm)", letterSpacing: ".04em", marginBottom: 8 }}>
            KAS DITERIMA PER METODE (INVOICE SHIFT INI)
          </div>
          {PAYMENT_METHODS.map((m) => (
            <div key={m} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: ".5px dashed var(--bd)" }}>
              <span style={{ fontSize: 12, color: "var(--tm)" }}>{m}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{rp(breakdown[m] ?? 0)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>Kas seharusnya (modal + tunai)</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: "var(--acc)" }}>{rp(expected)}</span>
          </div>
          <form action={tutupShiftKlinik}>
            <input type="hidden" name="shiftId" value={shift.id} />
            <label className="flab">Uang kas dihitung (fisik) *</label>
            <input className="fi" name="closing_balance" type="number" min={0} step={500} placeholder="Hitung uang di kasir" required style={{ marginBottom: 10 }} />
            <SubmitButton className="pay-btn" icon="ti-lock" pendingText="Menutup shift…">Tutup Shift Klinik</SubmitButton>
          </form>
          <Link href="/klinik" className="back-btn" style={{ marginTop: 12, justifyContent: "center", width: "100%" }}>
            <i className="ti ti-arrow-left" /> Kembali ke menu klinik
          </Link>
        </div>
      </div>
    );
  }
```
Ganti dengan (buang query invoices, breakdown, expected, blok "KAS DITERIMA PER METODE" + "Kas seharusnya"):
```tsx
  if (shift) {
    // Kasir buta: hanya input kas fisik, tanpa breakdown/ekspektasi (spec 2026-07-17).
    return (
      <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--sb)" }}>Shift Klinik Berjalan</div>
          <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 2 }}>
            {shift.branchName} · dibuka {new Date(shift.opened_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        {error && (
          <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", maxWidth: 440 }}>
            <i className="ti ti-alert-circle" /> {error}
          </div>
        )}
        <div className="card" style={{ width: "100%", maxWidth: 460, padding: 22 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <i className="ti ti-cash-banknote" style={{ fontSize: 20, color: "var(--sb)" }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>HITUNG UANG DI KASIR</div>
              <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>
                Hitung total uang tunai fisik di laci, lalu masukkan jumlahnya untuk menutup shift.
              </div>
            </div>
          </div>
          <form action={tutupShiftKlinik}>
            <input type="hidden" name="shiftId" value={shift.id} />
            <label className="flab">Uang kas dihitung (fisik) *</label>
            <input className="fi" name="closing_balance" type="number" min={0} step={500} placeholder="Hitung uang di kasir" required style={{ marginBottom: 10 }} />
            <SubmitButton className="pay-btn" icon="ti-lock" pendingText="Menutup shift…">Tutup Shift Klinik</SubmitButton>
          </form>
          <Link href="/klinik" className="back-btn" style={{ marginTop: 12, justifyContent: "center", width: "100%" }}>
            <i className="ti ti-arrow-left" /> Kembali ke menu klinik
          </Link>
        </div>
      </div>
    );
  }
```

- [ ] **Step 3: Ubah redirect di `actions.ts`**

Di `tutupShiftKlinik`, baris terakhir saat ini:
```ts
  redirect(`/pos/shift/${shiftId}`);
```
Ganti dengan:
```ts
  redirect("/klinik?success=close");
```
JANGAN ubah bagian lain fungsi (kalkulasi `breakdown`/`expected`/`selisih`, update `cashier_shifts`, `postJournal`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `TypeScript: No errors found`. (Kalau ada "declared but never used" untuk `rp` di page.tsx — `rp` masih dipakai? Setelah Step 2, `rp` tidak lagi dipakai di klinik/shift/page.tsx. Hapus juga baris `const rp = ...` di dekat atas file kalau typecheck/lint mengeluh. Cek: setelah edit, `grep -n "rp(" src/app/(app)/klinik/shift/page.tsx` harus 0 hasil → kalau 0, hapus definisi `const rp`.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/klinik/shift/page.tsx" "src/app/(app)/klinik/shift/actions.ts"
git commit -m "feat(shift): kasir buta tutup shift klinik + redirect ke menu"
```

---

## Task 2: Klinik — banner sukses di menu utama

**Files:**
- Modify: `src/app/(app)/klinik/page.tsx`

- [ ] **Step 1: Terima searchParams + render banner**

File saat ini:
```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ModuleHome } from "@/components/ModuleHome";
import { StaffKlinikHome } from "@/components/StaffKlinikHome";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).single();

  // STAFF dapat layar sambutan klinik; admin/owner tetap tile-grid.
  if (profile?.role === "STAFF") {
    return <StaffKlinikHome fullName={profile.full_name ?? "Staff"} />;
  }

  return <ModuleHome moduleId="klinik" />;
}
```
Ganti seluruhnya dengan:
```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ModuleHome } from "@/components/ModuleHome";
import { StaffKlinikHome } from "@/components/StaffKlinikHome";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const { success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).single();

  return (
    <>
      {success === "close" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Shift ditutup.
        </div>
      )}
      {/* STAFF dapat layar sambutan klinik; admin/owner tetap tile-grid. */}
      {profile?.role === "STAFF"
        ? <StaffKlinikHome fullName={profile.full_name ?? "Staff"} />
        : <ModuleHome moduleId="klinik" />}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/klinik/page.tsx"
git commit -m "feat(shift): banner sukses tutup shift di menu klinik"
```

---

## Task 3: Petshop — buang angka dari page tutup shift

**Files:**
- Modify: `src/app/kasir/tutup/page.tsx`

- [ ] **Step 1: Ganti seluruh isi `page.tsx`**

Ganti seluruh file `src/app/kasir/tutup/page.tsx` dengan (buang import shift-calc, kalkulasi breakdown/omset/expected/extraMethods, blok breakdown, Stat grid, fungsi Stat; `expected` tidak lagi diteruskan ke TutupForm):
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { TutupForm } from "./TutupForm";

// Selesai shift (kasir buta): kasir hanya input kas fisik; tanpa breakdown/ekspektasi
// (spec 2026-07-17). Selisih dihitung server-side, hanya terlihat manajer/finance.
export default async function TutupShiftPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const { data: sales } = await supabase
    .from("sales").select("id").eq("shift_id", shift.id);
  const trx = (sales ?? []).length;

  return (
    <div style={{ minHeight: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "24px 0" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--sb)" }}>Selesai Shift</div>
        <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 2 }}>
          {shift.branchName} · dibuka {new Date(shift.opened_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} · {trx} transaksi
        </div>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", maxWidth: 460 }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="card" style={{ width: "100%", maxWidth: 480, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className="ti ti-cash-banknote" style={{ fontSize: 20, color: "var(--sb)" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>HITUNG UANG DI LACI</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>
              Hitung total uang tunai fisik di laci kasir, lalu masukkan jumlahnya untuk menutup shift.
            </div>
          </div>
        </div>

        <TutupForm shiftId={shift.id} />

        <Link href="/kasir" className="back-btn" style={{ marginTop: 12, justifyContent: "center", width: "100%" }}>
          <i className="ti ti-arrow-left" /> Batal, kembali ke kasir
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck (akan error di TutupForm — belum tanpa prop expected)**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: error "Property 'expected' is missing" pada `<TutupForm ... />` — normal, diperbaiki di Task 4. Jangan commit dulu; lanjut Task 4.

---

## Task 4: Petshop — buang selisih real-time dari TutupForm + ubah redirect

**Files:**
- Modify: `src/app/kasir/tutup/TutupForm.tsx`
- Modify: `src/app/kasir/actions.ts`

- [ ] **Step 1: Ganti seluruh isi `TutupForm.tsx`**

Ganti seluruh file `src/app/kasir/tutup/TutupForm.tsx` dengan (buang prop `expected`, state selisih, banner warna, keterangan; teks tombol jadi "Tutup Shift"):
```tsx
"use client";

import { tutupShiftKasir } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

// Kasir buta: hanya input kas fisik, tanpa perbandingan selisih (spec 2026-07-17).
export function TutupForm({ shiftId }: { shiftId: string }) {
  return (
    <form action={tutupShiftKasir}>
      <input type="hidden" name="shiftId" value={shiftId} />
      <label className="flab">Total uang cash di kasir (fisik) *</label>
      <input
        className="fi" name="closing_balance" type="number" min={0} step={500}
        placeholder="Hitung uang di laci" required style={{ marginBottom: 12 }}
      />
      <SubmitButton className="pay-btn" icon="ti-lock" pendingText="Menutup shift…">Tutup Shift</SubmitButton>
    </form>
  );
}
```

- [ ] **Step 2: Ubah redirect di `actions.ts`**

Di `src/app/kasir/actions.ts` fungsi `tutupShiftKasir`, baris terakhir saat ini:
```ts
  // laporan shift (Addendum §1: bisa dicetak, masuk dashboard manajer).
  redirect(`/pos/shift/${shiftId}`);
```
Ganti dengan:
```ts
  // Kasir buta: balik ke menu kasir dgn banner sukses; laporan shift hanya utk manajer/finance.
  redirect("/kasir?success=close");
```
JANGAN ubah bagian lain fungsi (kalkulasi `breakdown`/`expected`/`selisih`, update `cashier_shifts`, `postJournal`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `TypeScript: No errors found`.

- [ ] **Step 4: Commit (Task 3 + 4 bersama — saling bergantung)**

```bash
git add src/app/kasir/tutup/page.tsx src/app/kasir/tutup/TutupForm.tsx src/app/kasir/actions.ts
git commit -m "feat(shift): kasir buta tutup shift petshop + redirect ke menu"
```

---

## Task 5: Petshop — banner sukses di menu kasir

**Files:**
- Modify: `src/app/kasir/page.tsx`
- Modify: `src/app/kasir/KasirClient.tsx`

- [ ] **Step 1: Teruskan `success` di `page.tsx`**

Di `src/app/kasir/page.tsx`, ubah tipe searchParams (baris ~15) dari:
```tsx
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
```
menjadi:
```tsx
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
```
Lalu di JSX return (akhir file), ubah `<KasirClient ... error={error} />` menjadi menambah prop `success`:
```tsx
    <KasirClient
      branchName={shift.branchName}
      items={itemRows}
      customers={custRows}
      vouchers={(vouchers ?? []) as unknown as VoucherRow[]}
      promos={promosActive as unknown as PromoRow[]}
      error={error}
      success={success}
    />
```

- [ ] **Step 2: Terima `success` + render banner di `KasirClient.tsx`**

Ubah signature props (baris 29-31) dari:
```tsx
export function KasirClient({ branchName, items, customers, vouchers, promos = [], error }: {
  branchName: string; items: ItemRow[]; customers: CustRow[]; vouchers: VoucherRow[]; promos?: PromoRow[]; error?: string;
}) {
```
menjadi:
```tsx
export function KasirClient({ branchName, items, customers, vouchers, promos = [], error, success }: {
  branchName: string; items: ItemRow[]; customers: CustRow[]; vouchers: VoucherRow[]; promos?: PromoRow[]; error?: string; success?: string;
}) {
```
Lalu di JSX return, cari blok banner error (sekitar baris 124):
```tsx
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
```
Tambahkan banner sukses tepat SETELAH blok error itu:
```tsx
      {success === "close" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Shift ditutup.
        </div>
      )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `TypeScript: No errors found`.

- [ ] **Step 4: Commit**

```bash
git add src/app/kasir/page.tsx src/app/kasir/KasirClient.tsx
git commit -m "feat(shift): banner sukses tutup shift di menu kasir"
```

---

## Task 6: Akses Finance ke Laporan Shift (middleware + nav)

**Files:**
- Modify: `src/lib/supabase/middleware.ts`
- Modify: `src/lib/nav.ts`

- [ ] **Step 1: Tambah `/pos/shift` ke `FINANCE_ALLOWED`**

Di `src/lib/supabase/middleware.ts` baris ~49:
```ts
  const FINANCE_ALLOWED = ["/", "/buku-besar", "/keuangan", "/me", "/mulai", "/login", "/auth"];
```
Ganti dengan:
```ts
  const FINANCE_ALLOWED = ["/", "/buku-besar", "/keuangan", "/me", "/mulai", "/login", "/auth", "/pos/shift"];
```
Prefix-match existing (`path === p || path.startsWith(p + "/")`) otomatis meng-cover `/pos/shift/[id]`. `/pos/transaksi`, `/pos/stok`, dll tetap terblokir untuk FINANCE.

- [ ] **Step 2: Tambah tile "Shift kasir" di modul Keuangan**

Di `src/lib/nav.ts`, cari array `TILES.keuangan` (baris ~104-117). Tambahkan tile baru sebagai entry TERAKHIR array (setelah `{ label: "Lap. HPP", ... }`, baris ~116). Ubah:
```ts
    { label: "Lap. HPP", icon: "ti-report", ...G },
  ],
```
menjadi:
```ts
    { label: "Lap. HPP", icon: "ti-report", ...G },
    { label: "Shift kasir (selisih kas)", icon: "ti-clock-dollar", ...B, href: "/pos/shift" },
  ],
```
(`B` = biru, sudah didefinisikan di file yang sama baris ~45.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: `TypeScript: No errors found`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/middleware.ts src/lib/nav.ts
git commit -m "feat(shift): akses finance ke laporan shift (middleware + tile keuangan)"
```

---

## Task 7: Verifikasi end-to-end (browser + DB)

**Files:** none.

- [ ] **Step 1: Typecheck penuh + build**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```
Expected: No errors; build sukses (warning Edge Runtime Supabase yang sudah ada boleh diabaikan).

- [ ] **Step 2: Verifikasi kasir buta — petshop**

Login sebagai STAFF (`staff@vetos.local` / `password123`). Mulai shift kasir kalau belum. Buka `/kasir/tutup`. Konfirmasi: TIDAK ada "BREAKDOWN PER METODE BAYAR", "Grand total omset", "Modal awal", "Kas seharusnya". Hanya ada judul + info cabang/jam/transaksi + 1 input kas fisik + tombol "Tutup Shift". Ketik angka di input → TIDAK muncul banner selisih.

- [ ] **Step 3: Verifikasi submit → redirect + banner**

Submit tutup shift. Konfirmasi URL jadi `/kasir?success=close` (bukan `/pos/shift/[id]`) dan banner hijau "Shift ditutup." muncul di halaman kasir. (Catatan: setelah shift ditutup, `/kasir` akan redirect ke `/kasir/mulai` karena hard-gate `getOpenShift`. Verifikasi banner via network/URL sesaat, atau cek bahwa redirect final adalah `/kasir/mulai` — yang penting BUKAN `/pos/shift`.)

- [ ] **Step 4: Verifikasi backend tak berubah — DB**

Sebelum submit di Step 3, catat `shift.id`. Setelah submit, query (via Supabase MCP `execute_sql` atau psql):
```sql
select closing_balance, expected_cash, selisih, closing_breakdown, status
from cashier_shifts where id = '<shift_id>';
```
Expected: `expected_cash` dan `selisih` terisi benar (server tetap hitung meski UI tidak menampilkan), `closing_breakdown` berisi JSON per metode, `status = 'closed'`. Kalau `selisih != 0`, cek jurnal (skema: `journal_entries.source_ref`, `journal_lines.entry_id` + `account_id` → join `coa_accounts` by code, sesuai `src/lib/posting.ts`):
```sql
select je.deskripsi, ca.code, jl.debit, jl.credit
from journal_entries je
join journal_lines jl on jl.entry_id = je.id
join coa_accounts ca on ca.id = jl.account_id
where je.source_ref = '<shift_id>' order by jl.debit desc;
```
Expected: ada baris akun `5901` (deskripsi "Selisih kas tutup shift" / "...klinik").

- [ ] **Step 5: Verifikasi kasir buta — klinik**

Login STAFF, mulai shift klinik, buka `/klinik/shift` saat shift berjalan. Konfirmasi: TIDAK ada "KAS DITERIMA PER METODE" / "Kas seharusnya". Hanya info + input kas fisik + tombol. Submit → redirect ke `/klinik?success=close` + banner "Shift ditutup.".

- [ ] **Step 6: Verifikasi akses Finance**

Login sebagai FINANCE (`finance@vetos.local` / `password123`). Buka `/keuangan` — konfirmasi tile "Shift kasir (selisih kas)" muncul. Klik → sampai di `/pos/shift` (TIDAK redirect ke `/`). Konfirmasi halaman Laporan Shift tampil dengan selisih. Coba akses `/pos/transaksi` langsung via URL → HARUS redirect ke `/` (tetap terblokir).

- [ ] **Step 7: Selesai**

Kalau semua lolos, fitur selesai. Merge branch sesuai alur finishing.

---

## Self-Review (penulis plan)

- **Spec coverage:** §1 klinik page → Task 1 Step 1-2. §2 klinik actions redirect → Task 1 Step 3. §3 klinik banner → Task 2. §4 kasir tutup page → Task 3. §5 TutupForm → Task 4 Step 1. §6 kasir actions redirect → Task 4 Step 2. §7 kasir page + KasirClient banner → Task 5. §8 middleware → Task 6 Step 1. §9 nav tile → Task 6 Step 2. "Tidak disentuh" (shift-calc, /pos/shift/*) → tidak ada task menyentuhnya. ✔ Semua tercakup.
- **Placeholder scan:** tak ada TBD/TODO; semua step berisi kode konkret. SQL verifikasi jurnal di Task 7.4 sudah pakai nama tabel/kolom sebenarnya (`journal_entries`/`journal_lines`/`coa_accounts`, `account_id`) hasil verifikasi `src/lib/posting.ts`. ✔
- **Type consistency:** `TutupForm` prop berubah dari `{ shiftId, expected }` (Task 3 masih pakai lama → sengaja error) ke `{ shiftId }` (Task 4 hapus expected + Task 3 sudah panggil tanpa expected) — konsisten, di-commit bareng. `KasirClient` prop `success?: string` ditambah di page.tsx (Task 5.1) dan diterima di KasirClient (Task 5.2) — cocok. `success === "close"` string konsisten dgn redirect `?success=close` di Task 1.3 & 4.2. ✔
