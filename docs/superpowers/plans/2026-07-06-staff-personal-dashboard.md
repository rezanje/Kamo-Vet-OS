# Staff Personal Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `STAFF`-role users a personal HR hub at `/me` (quest summary, personal KPI, attendance clock in/out, leave requests), reached from a role-gated `/mulai`.

**Architecture:** New migration `0034` adds `employees.profile_id` FK to `profiles` and seeds a demo link for `staff@vetos.local`. Pure attendance state logic in `src/lib/attendance.ts` (unit-tested). New standalone `/me` route with its own light shell, four server-rendered sections, and colocated server actions. `/mulai` branches its tiles on `profiles.role`.

**Tech Stack:** Next.js 15 App Router (server components + server actions), Supabase (Postgres + RLS via existing `*_all` policies), vitest, plain CSS classes from `globals.css` (`.card`, `.fi`, `.flab`, `.tbl`, `.bge`, `.btn-acc`, `.pos-topbar`, `.mulai-tile`), tabler icons `ti ti-*`.

## Global Constraints

- Money columns `numeric(15,2)`; but this feature adds no money columns.
- New table/column naming `snake_case`, English; UI copy Bahasa Indonesia.
- All mutations via Next.js Server Actions (`"use server"`), reads via server components.
- RLS: HR tables (`attendance`, `leave_requests`, `kpi_records`, `employees`) already have permissive `*_all` policies for `authenticated` — no new policies needed.
- Migrations: sequential file `0034_*` applied via supabase MCP `apply_migration` with the same name as the file.
- Business logic gets vitest unit tests colocated in `src/lib/__tests__/`.
- Commit after each task: `feat(scope): …` / `chore: …` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Branch: `feat/staff-personal-dashboard` (already created).

## File Structure
- `supabase/migrations/0034_employee_profile_link.sql` — FK column + demo seed.
- `src/lib/attendance.ts` — pure attendance state machine.
- `src/lib/__tests__/attendance.test.ts` — its tests.
- `src/lib/employee.ts` — `getMyEmployee` helper.
- `src/app/me/layout.tsx` — light personal shell (blue top bar).
- `src/app/me/page.tsx` — server component, four sections.
- `src/app/me/actions.ts` — `clockIn`, `clockOut`, `ajukanCutiPribadi`.
- `src/app/me/CutiForm.tsx` — client leave form.
- `src/app/mulai/page.tsx` — role gate (modify).

---

### Task 1: Attendance state machine (pure logic + tests)

**Files:**
- Create: `src/lib/attendance.ts`
- Test: `src/lib/__tests__/attendance.test.ts`

**Interfaces:**
- Produces: `attendanceState(row: AttendanceRow | null): AttendanceState`, `nextAction(state: AttendanceState): AttendanceAction`, types `AttendanceRow = { jam_masuk?: string | null; jam_pulang?: string | null }`, `AttendanceState = "not_in" | "in" | "done"`, `AttendanceAction = "clockIn" | "clockOut" | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/attendance.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { attendanceState, nextAction } from "../attendance";

describe("attendanceState", () => {
  it("no row → not_in", () => {
    expect(attendanceState(null)).toBe("not_in");
  });
  it("row without jam_masuk → not_in", () => {
    expect(attendanceState({ jam_masuk: null, jam_pulang: null })).toBe("not_in");
  });
  it("jam_masuk set, no jam_pulang → in", () => {
    expect(attendanceState({ jam_masuk: "08:00", jam_pulang: null })).toBe("in");
  });
  it("both set → done", () => {
    expect(attendanceState({ jam_masuk: "08:00", jam_pulang: "17:00" })).toBe("done");
  });
});

describe("nextAction", () => {
  it("not_in → clockIn", () => expect(nextAction("not_in")).toBe("clockIn"));
  it("in → clockOut", () => expect(nextAction("in")).toBe("clockOut"));
  it("done → null", () => expect(nextAction("done")).toBeNull());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/attendance.test.ts`
Expected: FAIL — cannot find module `../attendance`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/attendance.ts`:
```ts
// Status absensi harian (pure) — dipakai /me untuk tombol Clock In / Clock Out.
export type AttendanceRow = { jam_masuk?: string | null; jam_pulang?: string | null };
export type AttendanceState = "not_in" | "in" | "done";
export type AttendanceAction = "clockIn" | "clockOut" | null;

export function attendanceState(row: AttendanceRow | null): AttendanceState {
  if (!row || !row.jam_masuk) return "not_in";
  if (!row.jam_pulang) return "in";
  return "done";
}

export function nextAction(state: AttendanceState): AttendanceAction {
  if (state === "not_in") return "clockIn";
  if (state === "in") return "clockOut";
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/attendance.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/attendance.ts src/lib/__tests__/attendance.test.ts
git commit -m "feat(hris): attendance state machine (clock in/out) — pure + tested

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Migration — employees.profile_id + demo seed

**Files:**
- Create: `supabase/migrations/0034_employee_profile_link.sql`

**Interfaces:**
- Produces: `employees.profile_id uuid` (FK `profiles(id)`), and a demo link so `staff@vetos.local` resolves to a Kasir employee with sample KPI + a pending leave request; `attendance` left empty for today so Clock In is demonstrable.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0034_employee_profile_link.sql`:
```sql
-- Personal dashboard (/me): tautkan akun login (profiles) ke record karyawan (employees).
alter table employees add column profile_id uuid references profiles(id) on delete set null;
create index on employees(profile_id);

-- Demo: tautkan staff@vetos.local ke satu karyawan berjabatan Kasir yang belum tertaut.
update employees set profile_id = (select id from auth.users where email = 'staff@vetos.local')
where id = (select id from employees where jabatan = 'Kasir' and profile_id is null order by nama limit 1);

-- Demo KPI bulan berjalan untuk karyawan tertaut (idempotent: skip kalau sudah ada metrik sama).
insert into kpi_records (employee_id, periode, metrik, target, realisasi, skor, catatan)
select e.id, to_char(now(), 'YYYY-MM'), 'Target Penjualan', 20000000, 14500000, 72, 'Progres bulan berjalan'
from employees e
where e.profile_id = (select id from auth.users where email = 'staff@vetos.local')
  and not exists (
    select 1 from kpi_records k
    where k.employee_id = e.id and k.periode = to_char(now(), 'YYYY-MM') and k.metrik = 'Target Penjualan'
  );

-- Demo pengajuan cuti (status Menunggu) untuk list.
insert into leave_requests (employee_id, jenis, tanggal_mulai, tanggal_selesai, durasi, alasan, status)
select e.id, 'Cuti', (now() + interval '7 day')::date, (now() + interval '8 day')::date, 2, 'Acara keluarga', 'Menunggu'
from employees e
where e.profile_id = (select id from auth.users where email = 'staff@vetos.local')
  and not exists (
    select 1 from leave_requests l where l.employee_id = e.id and l.alasan = 'Acara keluarga'
  );
```

- [ ] **Step 2: Apply the migration**

Apply via supabase MCP `apply_migration` with name `0034_employee_profile_link` and the query above.

- [ ] **Step 3: Verify the link exists**

Run this SQL via supabase MCP `execute_sql`:
```sql
select e.nama, e.jabatan, u.email,
  (select count(*) from kpi_records k where k.employee_id = e.id) as kpi_rows,
  (select count(*) from leave_requests l where l.employee_id = e.id) as leave_rows
from employees e join auth.users u on u.id = e.profile_id
where u.email = 'staff@vetos.local';
```
Expected: one row, `kpi_rows >= 1`, `leave_rows >= 1`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0034_employee_profile_link.sql
git commit -m "feat(hris): link employees.profile_id to login + demo seed for /me

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: getMyEmployee helper

**Files:**
- Create: `src/lib/employee.ts`

**Interfaces:**
- Consumes: `employees.profile_id` from Task 2.
- Produces: `getMyEmployee(supabase, userId: string): Promise<MyEmployee | null>` where `MyEmployee = { id: string; nama: string; jabatan: string | null; branch_id: string | null }`.

- [ ] **Step 1: Write the helper**

Create `src/lib/employee.ts`:
```ts
// Karyawan yang tertaut ke akun login (untuk dashboard pribadi /me).
type AnyClient = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type MyEmployee = { id: string; nama: string; jabatan: string | null; branch_id: string | null };

export async function getMyEmployee(supabase: AnyClient, userId: string): Promise<MyEmployee | null> {
  const { data } = await supabase
    .from("employees")
    .select("id, nama, jabatan, branch_id")
    .eq("profile_id", userId)
    .maybeSingle();
  return data ?? null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `No errors found` (helper compiles; it is consumed in Task 5).

- [ ] **Step 3: Commit**

```bash
git add src/lib/employee.ts
git commit -m "feat(hris): getMyEmployee helper (login -> employee record)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: /mulai role gate

**Files:**
- Modify: `src/app/mulai/page.tsx`

**Interfaces:**
- Consumes: `profiles.role` (already loaded in the page).
- Produces: for `role === "STAFF"`, first tile is "Dashboard Pribadi" → `/me`; otherwise first tile is "Dashboard VetOS" → `/`. Second tile "POS Kasir" → `/kasir` unchanged.

- [ ] **Step 1: Replace the tiles block**

In `src/app/mulai/page.tsx`, replace the two-`Link` grid (the `<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, ...` block containing both tiles) with:
```tsx
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 260px))", gap: 16, justifyContent: "center" }}>
        {profile?.role === "STAFF" ? (
          <Link href="/me" style={{ textDecoration: "none" }}>
            <div className="mulai-tile">
              <i className="ti ti-user-heart" style={{ fontSize: 40, color: "var(--sb)" }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)" }}>Dashboard Pribadi</div>
              <div style={{ fontSize: 11, color: "var(--tm)", textAlign: "center" }}>Quest, KPI, absensi & pengajuan cuti kamu.</div>
            </div>
          </Link>
        ) : (
          <Link href="/" style={{ textDecoration: "none" }}>
            <div className="mulai-tile">
              <i className="ti ti-layout-dashboard" style={{ fontSize: 40, color: "var(--sb)" }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)" }}>Dashboard VetOS</div>
              <div style={{ fontSize: 11, color: "var(--tm)", textAlign: "center" }}>Klinik, CRM, Keuangan, HRIS, laporan — semua modul.</div>
            </div>
          </Link>
        )}
        <Link href="/kasir" style={{ textDecoration: "none" }}>
          <div className="mulai-tile">
            <i className="ti ti-cash-register" style={{ fontSize: 40, color: "var(--acc)" }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx)" }}>POS Kasir</div>
            <div style={{ fontSize: 11, color: "var(--tm)", textAlign: "center" }}>Mulai shift, transaksi kasir, pengeluaran & persediaan toko.</div>
          </div>
        </Link>
      </div>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Commit**

```bash
git add src/app/mulai/page.tsx
git commit -m "feat(mulai): STAFF sees Dashboard Pribadi tile instead of admin dashboard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: /me shell + server actions + page

**Files:**
- Create: `src/app/me/layout.tsx`
- Create: `src/app/me/actions.ts`
- Create: `src/app/me/CutiForm.tsx`
- Create: `src/app/me/page.tsx`

**Interfaces:**
- Consumes: `getMyEmployee` (Task 3), `attendanceState`/`nextAction` (Task 1), quest tables (`staff_points`, `staff_streaks`, `staff_quest_progress`), `kpi_records`, `attendance`, `leave_requests`.
- Produces: route `/me` with four sections; server actions `clockIn(formData)`, `clockOut(formData)`, `ajukanCutiPribadi(formData)`.

- [ ] **Step 1: Create the shell layout**

Create `src/app/me/layout.tsx`:
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Shell ringan dashboard pribadi (top bar biru, bukan sidebar admin).
export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const nama = (profile?.full_name ?? user.email ?? "Staff").split(" ")[0];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <div className="pos-topbar no-print">
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Link href="/mulai" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }} title="Kembali ke pilihan mode">
            <div style={{ width: 34, height: 34, background: "#fff", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <i className="ti ti-user-heart" style={{ fontSize: 17, color: "var(--posb)" }} />
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>DASHBOARD PRIBADI</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,.65)" }}>{nama}</div>
            </div>
          </Link>
        </div>
        <Link href="/kasir" className="pos-tab" style={{ border: "1px solid rgba(255,255,255,.35)" }}>
          <i className="ti ti-cash-register" style={{ fontSize: 13 }} /> Ke POS Kasir
        </Link>
      </div>
      <div style={{ flex: 1, padding: 16, overflowY: "auto", maxWidth: 900, width: "100%", margin: "0 auto" }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Create the server actions**

Create `src/app/me/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/employee";

function todayJakarta(): string {
  // WIB (UTC+7) date string YYYY-MM-DD.
  const wib = new Date(new Date().getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}
function nowTimeJakarta(): string {
  const wib = new Date(new Date().getTime() + 7 * 3600 * 1000);
  return wib.toISOString().slice(11, 16); // HH:MM
}

export async function clockIn() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const emp = user ? await getMyEmployee(supabase as never, user.id) : null;
  if (!emp) redirect(`/me?error=${encodeURIComponent("Akun belum tertaut ke data karyawan")}`);

  // upsert: buat / isi jam_masuk untuk hari ini (pola sama dgn hris/absensi).
  await supabase.from("attendance").upsert(
    { employee_id: emp!.id, tanggal: todayJakarta(), jam_masuk: nowTimeJakarta(), status: "Hadir" },
    { onConflict: "employee_id,tanggal" },
  );
  redirect("/me?success=in");
}

export async function clockOut() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const emp = user ? await getMyEmployee(supabase as never, user.id) : null;
  if (!emp) redirect(`/me?error=${encodeURIComponent("Akun belum tertaut ke data karyawan")}`);

  await supabase.from("attendance")
    .update({ jam_pulang: nowTimeJakarta() })
    .eq("employee_id", emp!.id).eq("tanggal", todayJakarta());
  redirect("/me?success=out");
}

export async function ajukanCutiPribadi(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const emp = user ? await getMyEmployee(supabase as never, user.id) : null;
  if (!emp) redirect(`/me?error=${encodeURIComponent("Akun belum tertaut ke data karyawan")}`);

  const jenis = String(formData.get("jenis") ?? "").trim();
  const tanggalMulai = String(formData.get("tanggal_mulai") ?? "").trim();
  const tanggalSelesai = String(formData.get("tanggal_selesai") ?? "").trim() || null;
  const durasi = formData.get("durasi") ? Number(formData.get("durasi")) : null;
  const alasan = String(formData.get("alasan") ?? "").trim() || null;
  if (!jenis || !tanggalMulai) redirect(`/me?error=${encodeURIComponent("Jenis & tanggal mulai wajib diisi")}`);

  const { error } = await supabase.from("leave_requests").insert({
    employee_id: emp!.id, jenis, tanggal_mulai: tanggalMulai, tanggal_selesai: tanggalSelesai,
    durasi, alasan, status: "Menunggu",
  });
  if (error) redirect(`/me?error=${encodeURIComponent("Gagal simpan pengajuan")}`);
  redirect("/me?success=cuti");
}
```

- [ ] **Step 3: Create the leave form client component**

Create `src/app/me/CutiForm.tsx`:
```tsx
"use client";

import { useState } from "react";
import { ajukanCutiPribadi } from "./actions";

export function CutiForm() {
  const [jenis, setJenis] = useState("Cuti");
  return (
    <form action={ajukanCutiPribadi} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <div>
        <label className="flab">Jenis *</label>
        <select className="fi" name="jenis" value={jenis} onChange={(e) => setJenis(e.target.value)}>
          <option>Cuti</option><option>Izin</option><option>Sakit</option><option>Lembur</option>
        </select>
      </div>
      <div>
        <label className="flab">Durasi ({jenis === "Lembur" ? "jam" : "hari"})</label>
        <input className="fi" name="durasi" type="number" min={0} step="any" placeholder="0" />
      </div>
      <div>
        <label className="flab">Tanggal mulai *</label>
        <input className="fi" name="tanggal_mulai" type="date" required />
      </div>
      <div>
        <label className="flab">Tanggal selesai</label>
        <input className="fi" name="tanggal_selesai" type="date" />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label className="flab">Alasan</label>
        <input className="fi" name="alasan" placeholder="mis. acara keluarga" />
      </div>
      <button type="submit" className="btn-acc" style={{ gridColumn: "1 / -1", justifyContent: "center" }}>
        <i className="ti ti-send" /> Ajukan
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Create the page**

Create `src/app/me/page.tsx`:
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/employee";
import { attendanceState, nextAction } from "@/lib/attendance";
import { clockIn, clockOut } from "./actions";
import { CutiForm } from "./CutiForm";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const LEAVE_BADGE: Record<string, string> = { Menunggu: "o", Disetujui: "g", Ditolak: "r" };

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const emp = await getMyEmployee(supabase as never, user.id);
  const now = new Date();
  const wibDate = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const monthKey = wibDate.slice(0, 7);

  // Quest ringkasan (keying profiles.id — tak butuh employee).
  const [{ data: points }, { data: streak }, { data: qprog }] = await Promise.all([
    supabase.from("staff_points").select("total_points").eq("staff_id", user.id).maybeSingle(),
    supabase.from("staff_streaks").select("current_streak_days").eq("staff_id", user.id).maybeSingle(),
    supabase.from("staff_quest_progress").select("status").eq("staff_id", user.id).neq("status", "in_progress"),
  ]);
  const totalPoin = points?.total_points ?? 0;
  const streakDays = streak?.current_streak_days ?? 0;
  const questSelesai = (qprog ?? []).length;

  // Data HR (butuh employee tertaut).
  let kpi: { metrik: string; target: number | null; realisasi: number | null; skor: number }[] = [];
  let att: { jam_masuk: string | null; jam_pulang: string | null } | null = null;
  let leaves: { jenis: string; tanggal_mulai: string; tanggal_selesai: string | null; durasi: number | null; status: string }[] = [];
  if (emp) {
    const [{ data: k }, { data: a }, { data: l }] = await Promise.all([
      supabase.from("kpi_records").select("metrik, target, realisasi, skor").eq("employee_id", emp.id).eq("periode", monthKey).order("metrik"),
      supabase.from("attendance").select("jam_masuk, jam_pulang").eq("employee_id", emp.id).eq("tanggal", wibDate).maybeSingle(),
      supabase.from("leave_requests").select("jenis, tanggal_mulai, tanggal_selesai, durasi, status").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(10),
    ]);
    kpi = k ?? [];
    att = a ?? null;
    leaves = l ?? [];
  }
  const attState = attendanceState(att);
  const action = nextAction(attState);

  return (
    <>
      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "in" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-login-2" /> Clock-in tercatat. Selamat bekerja!</div>}
      {success === "out" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-logout-2" /> Clock-out tercatat. Sampai jumpa!</div>}
      {success === "cuti" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pengajuan terkirim — menunggu persetujuan manajer.</div>}

      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--posb)", marginBottom: 4 }}>Halo, {emp?.nama?.split(" ")[0] ?? "Staff"}!</div>
      <div style={{ fontSize: 11.5, color: "var(--tm)", marginBottom: 14 }}>{emp?.jabatan ?? "Staff Kasir"} · ringkasan pribadi kamu hari ini.</div>

      {/* 1. Ringkasan Quest */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em" }}><i className="ti ti-trophy" /> RINGKASAN QUEST</span>
          <Link href="/kasir/quest" className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>Buka Quest Lengkap <i className="ti ti-arrow-right" /></Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          <Stat icon="ti-star" bg="#eff6ff" color="#1d4ed8" label="Total Poin" val={totalPoin.toLocaleString("id-ID")} />
          <Stat icon="ti-flame" bg="#fffbeb" color="#d97706" label="Streak Harian" val={`${streakDays} Hari`} />
          <Stat icon="ti-circle-check" bg="#e8f5ee" color="#15803d" label="Quest Selesai" val={`${questSelesai}`} />
        </div>
      </div>

      {!emp ? (
        <div className="card" style={{ marginBottom: 12, borderColor: "#fcd34d", background: "#fffbeb" }}>
          <div style={{ fontSize: 11.5, color: "#92400e" }}><i className="ti ti-alert-triangle" /> Akun kamu belum tertaut ke data karyawan. Hubungi manajer untuk aktivasi absensi, KPI & pengajuan cuti.</div>
        </div>
      ) : (
        <>
          {/* 2. KPI Pribadi */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em", marginBottom: 8 }}><i className="ti ti-target" /> KPI PRIBADI · {monthKey}</div>
            {kpi.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--td)" }}>Belum ada penilaian KPI bulan ini.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Metrik</th><th style={{ textAlign: "right" }}>Target</th><th style={{ textAlign: "right" }}>Realisasi</th><th style={{ width: 130 }}>Skor</th></tr></thead>
                <tbody>
                  {kpi.map((k, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{k.metrik}</td>
                      <td style={{ textAlign: "right", fontSize: 11 }}>{k.target != null ? rp(Number(k.target)) : "—"}</td>
                      <td style={{ textAlign: "right", fontSize: 11 }}>{k.realisasi != null ? rp(Number(k.realisasi)) : "—"}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ flex: 1, height: 6, background: "var(--sf1)", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(100, Number(k.skor))}%`, height: "100%", background: "var(--posb)" }} />
                          </div>
                          <span style={{ fontSize: 10.5, fontWeight: 700 }}>{Number(k.skor)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 3. Absensi Hari Ini */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em", marginBottom: 8 }}><i className="ti ti-clock" /> ABSENSI HARI INI</div>
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11.5 }}>Masuk: <b>{att?.jam_masuk ?? "—"}</b></div>
              <div style={{ fontSize: 11.5 }}>Pulang: <b>{att?.jam_pulang ?? "—"}</b></div>
              <div style={{ marginLeft: "auto" }}>
                {action === "clockIn" && (
                  <form action={clockIn}><button type="submit" className="btn-acc"><i className="ti ti-login-2" /> Clock In</button></form>
                )}
                {action === "clockOut" && (
                  <form action={clockOut}><button type="submit" className="btn-acc" style={{ background: "var(--am)" }}><i className="ti ti-logout-2" /> Clock Out</button></form>
                )}
                {action === null && <span className="bge g">Selesai hari ini</span>}
              </div>
            </div>
          </div>

          {/* 4. Pengajuan Cuti/Izin */}
          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em", marginBottom: 8 }}><i className="ti ti-calendar-plus" /> PENGAJUAN CUTI / IZIN</div>
            <CutiForm />
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tm)", margin: "12px 0 6px" }}>RIWAYAT PENGAJUAN</div>
            {leaves.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--td)" }}>Belum ada pengajuan.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Jenis</th><th>Mulai</th><th>Selesai</th><th>Durasi</th><th>Status</th></tr></thead>
                <tbody>
                  {leaves.map((l, i) => (
                    <tr key={i}>
                      <td>{l.jenis}</td>
                      <td style={{ fontSize: 11 }}>{l.tanggal_mulai}</td>
                      <td style={{ fontSize: 11 }}>{l.tanggal_selesai ?? "—"}</td>
                      <td style={{ fontSize: 11 }}>{l.durasi ?? "—"}</td>
                      <td><span className={`bge ${LEAVE_BADGE[l.status] ?? "o"}`}>{l.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}

function Stat({ icon, bg, color, label, val }: { icon: string; bg: string; color: string; label: string; val: string }) {
  return (
    <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: "9px 11px", background: bg }}>
      <i className={`ti ${icon}`} style={{ color, fontSize: 15 }} />
      <div style={{ fontSize: 16, fontWeight: 800, marginTop: 3 }}>{val}</div>
      <div style={{ fontSize: 8.5, color: "var(--tm)" }}>{label}</div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `No errors found`; all tests PASS (attendance tests included).

- [ ] **Step 6: Commit**

```bash
git add src/app/me
git commit -m "feat(me): personal dashboard — quest summary, KPI, absensi clock in/out, pengajuan cuti

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end verification + build

**Files:** none (verification only).

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: compiles successfully, `/me` appears in the route list, no lint/type errors.

- [ ] **Step 2: Manual browser check (preview tools)**

Start dev server, log in as `staff@vetos.local` / `password123`:
1. Land on `/mulai` — confirm the first tile reads "Dashboard Pribadi" (not "Dashboard VetOS").
2. Open `/me` — confirm blue top bar, Halo greeting, quest stat cards populated, KPI table shows the seeded "Target Penjualan" row, absensi shows a **Clock In** button, leave history shows the seeded "Cuti / Menunggu" row.
3. Click **Clock In** → success banner, masuk time filled, button becomes **Clock Out**.
4. Click **Clock Out** → success banner, "Selesai hari ini" badge.
5. Submit the leave form (Izin, tomorrow) → success banner, new row appears in riwayat.
6. Click "Buka Quest Lengkap" → lands on `/kasir/quest`.
Take a screenshot as proof.

- [ ] **Step 3: Clean up test data**

Via supabase MCP `execute_sql`, remove rows created during the manual check so demo stays clean (delete today's `attendance` row for the linked employee and any leave request with `alasan` other than the seeded 'Acara keluarga' created during test).

- [ ] **Step 4: No commit** (verification task; any code fixes discovered here are committed under the task they belong to).

---

## Self-Review Notes
- Spec §1 (/mulai role gate) → Task 4. §2 sections 1–4 (/me) → Task 5. §3 wiring (migration + getMyEmployee) → Tasks 2, 3. §4 pure logic + tests → Task 1. §5 POS quest tab → no code (already exists), verified in Task 6 step 2.6.
- Type consistency: `getMyEmployee` returns `MyEmployee { id, nama, jabatan, branch_id }`, used in actions (`emp.id`) and page (`emp.nama`, `emp.jabatan`, `emp.id`). `attendanceState`/`nextAction` signatures match Task 1 → Task 5 usage. Attendance row shape `{ jam_masuk, jam_pulang }` consistent.
- Timezone: WIB (UTC+7) helpers used consistently in actions and page for today/month keys, matching the quest system's WIB convention.
- No new RLS policies needed — existing `*_all` policies on `employees`/`attendance`/`leave_requests`/`kpi_records` cover authenticated reads/writes (prototype posture, consistent with rest of app).
