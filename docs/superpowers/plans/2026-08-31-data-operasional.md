# Data Operasional Klinik Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menangkap outcome booking, sumber kunjungan, timestamp layanan, pelaksana, kapasitas rawat inap, follow-up compliance, dan referral agar KPI klinik dapat dihitung tanpa data rekaan.

**Architecture:** Kolom workflow ditambahkan ke tabel existing; audit perubahan masuk tabel append-only. Perhitungan metrik tetap pure TypeScript, server action hanya validasi akses dan persistensi. Semua data operasional membawa atau menurunkan `branch_id` dan memakai RLS `user_can_access_branch`.

**Tech Stack:** Next.js App Router 15, React 19, TypeScript, Supabase/Postgres RLS, Vitest.

---

### Task 1: Schema workflow klinik dan RLS cabang

**Files:**
- Create: `supabase/migrations/20260831232000_data_operasional_klinik.sql`
- Create: `src/lib/operasional-klinik.ts`
- Create: `src/lib/__tests__/operasional-klinik.test.ts`

- [ ] **Step 1: Read installed Next.js guidance before touching App Router code**

Run after dependencies exist:

```bash
rg --files node_modules/next/dist/docs | rg 'server-actions|forms|data-fetching|page' | head -20
```

Read the matching Server Actions/forms and page/data-fetching guides completely. If `node_modules` is absent, run `npm install` first; do not code against remembered Next APIs.

- [ ] **Step 2: Write failing tests for no-show and monotonic timestamps**

```ts
import { describe, expect, it } from "vitest";
import { bolehNoShow, validateServiceTimeline } from "../operasional-klinik";

describe("bolehNoShow", () => {
  it("hanya mengizinkan booking terkonfirmasi, lewat jadwal, tanpa visit", () => {
    const now = new Date("2026-08-31T10:00:00+07:00");
    expect(bolehNoShow({ status: "dikonfirmasi", outcome: "pending", scheduledAt: "2026-08-31T09:00:00+07:00", visitId: null }, now)).toBe(true);
    expect(bolehNoShow({ status: "baru", outcome: "pending", scheduledAt: "2026-08-31T09:00:00+07:00", visitId: null }, now)).toBe(false);
    expect(bolehNoShow({ status: "dikonfirmasi", outcome: "pending", scheduledAt: "2026-08-31T11:00:00+07:00", visitId: null }, now)).toBe(false);
  });
});

it("menolak urutan waktu layanan yang mundur", () => {
  expect(validateServiceTimeline({
    checkedInAt: "2026-08-31T09:00:00Z",
    serviceStartedAt: "2026-08-31T08:59:00Z",
    serviceFinishedAt: null,
    checkedOutAt: null,
  })).toMatch(/mulai layanan/);
});
```

- [ ] **Step 3: Run focused test and verify missing-module failure**

Run: `npm test -- src/lib/__tests__/operasional-klinik.test.ts`

Expected: FAIL with `Cannot find module '../operasional-klinik'`.

- [ ] **Step 4: Implement pure workflow contracts**

```ts
export type BookingOutcome = "pending" | "hadir" | "no_show";
export type VisitSource = "booking" | "walk_in";
export type Timeline = {
  checkedInAt: string | null;
  serviceStartedAt: string | null;
  serviceFinishedAt: string | null;
  checkedOutAt: string | null;
};
export type BookingForOutcome = {
  status: string; outcome: BookingOutcome; scheduledAt: string; visitId: string | null;
};

export function bolehNoShow(b: BookingForOutcome, now = new Date()) {
  return b.status === "dikonfirmasi" && b.outcome === "pending"
    && !b.visitId && new Date(b.scheduledAt).getTime() < now.getTime();
}

export function validateServiceTimeline(t: Timeline): string | null {
  const values = [t.checkedInAt, t.serviceStartedAt, t.serviceFinishedAt, t.checkedOutAt]
    .map((v) => v ? new Date(v).getTime() : null);
  const labels = ["check-in", "mulai layanan", "selesai layanan", "check-out"];
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== null && values[i - 1] !== null && values[i]! < values[i - 1]!) {
      return `${labels[i]} tidak boleh lebih awal dari ${labels[i - 1]}`;
    }
  }
  return null;
}
```

- [ ] **Step 5: Add migration with exact tables, indexes, and policies**

Migration must add:

```sql
alter table bookings
  add column attendance_outcome text not null default 'pending'
    check (attendance_outcome in ('pending','hadir','no_show')),
  add column outcome_by uuid references profiles(id),
  add column outcome_at timestamptz;

alter table visits
  add column source text not null default 'walk_in' check (source in ('booking','walk_in')),
  add column checked_in_at timestamptz,
  add column service_started_at timestamptz,
  add column service_finished_at timestamptz,
  add column checked_out_at timestamptz,
  add column service_provider_id uuid references employees(id);

alter table follow_ups
  add column completed_at timestamptz,
  add column completed_by uuid references profiles(id);

create table branch_capacity_periods (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete cascade,
  capacity_type text not null default 'rawat_inap' check (capacity_type in ('rawat_inap')),
  capacity int not null check (capacity > 0),
  valid_from date not null,
  valid_until date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from),
  exclude using gist (branch_id with =, capacity_type with =,
    daterange(valid_from, coalesce(valid_until + 1, 'infinity'::date), '[)') with &&)
);

create table visit_referrals (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete restrict,
  direction text not null check (direction in ('masuk','keluar')),
  facility text not null,
  reason text not null,
  notes text,
  referred_at timestamptz not null default now(),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table visit_operational_events (
  id bigint generated always as identity primary key,
  visit_id uuid references visits(id) on delete cascade,
  booking_id uuid references bookings(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete restrict,
  event_type text not null check (event_type in (
    'booking_hadir','booking_no_show','check_in','service_started',
    'service_finished','check_out','provider_changed','referral_created'
  )),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_by uuid not null references profiles(id),
  check ((visit_id is not null)::int + (booking_id is not null)::int >= 1)
);
```

Run `create extension if not exists btree_gist;` before exclusion constraint. Add indexes on booking outcome/date/branch, visit source/created/branch, capacity branch/date, referral branch/date, and event branch/date. Replace broad `bookings_staff_all` with branch-scoped authenticated select/write policies using `user_can_access_branch(branch_id)` while preserving `bookings_public_insert`.

Enable RLS on three new tables. Read/write policies use `user_can_access_branch(branch_id)`; capacity write also requires `public.is_admin()`. Event table permits SELECT and INSERT only—no UPDATE/DELETE policy. Replace broad `fu_all` policy with branch-scoped SELECT/INSERT/UPDATE predicates: direct `follow_ups.branch_id` when present, otherwise branch derived through `visit_id`; no authenticated-wide policy remains.

- [ ] **Step 6: Verify migration and domain tests**

Run: `supabase db reset && npm test -- src/lib/__tests__/operasional-klinik.test.ts`

Expected: migrations apply; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260831232000_data_operasional_klinik.sql src/lib/operasional-klinik.ts src/lib/__tests__/operasional-klinik.test.ts
git commit -m "feat: add audited clinic operations data"
```

### Task 2: Booking outcome and visit source

**Files:**
- Modify: `src/app/(app)/klinik/booking/actions.ts`
- Modify: `src/app/(app)/klinik/booking/page.tsx`
- Modify: `src/app/(app)/klinik/registrasi/actions.ts`
- Modify: `src/app/(app)/klinik/registrasi/RegistrasiForm.tsx`
- Modify: `src/lib/booking.ts`
- Modify: `src/lib/__tests__/booking.test.ts`

- [ ] **Step 1: Add failing tests for scheduled timestamp composition**

Add test proving `tanggal=2026-08-31`, `jam=09:30`, Asia/Jakarta becomes a past/future comparable instant without relying on browser locale.

- [ ] **Step 2: Implement `markBookingNoShow` action**

Action must load booking by ID, assert branch access from returned row, build schedule in Asia/Jakarta, call `bolehNoShow`, atomically update only when `status='dikonfirmasi'`, `attendance_outcome='pending'`, and `visit_id is null`, then append `booking_no_show` event. Return validation error on zero updated rows.

- [ ] **Step 3: Add guarded UI action**

Booking list shows outcome badge. `No-show` button appears only for confirmed past bookings without visit. Browser confirmation text: `Tandai booking ini tidak hadir?`.

- [ ] **Step 4: Mark registration source and attendance**

When form carries booking ID, registration action creates visit with `source='booking'`, `checked_in_at=now()`, links `bookings.visit_id`, sets outcome `hadir`, records user/time, and appends both `booking_hadir` and `check_in` events. Without booking ID, visit uses `source='walk_in'` and appends `check_in` only. These writes must use one Postgres RPC or rollback on any failure; no partial visit/booking state.

- [ ] **Step 5: Test and commit**

Run: `npm test -- src/lib/__tests__/booking.test.ts src/lib/__tests__/operasional-klinik.test.ts && npm run build`

Expected: PASS and build exit 0.

```bash
git add src/app/(app)/klinik/booking src/app/(app)/klinik/registrasi src/lib/booking.ts src/lib/__tests__/booking.test.ts
git commit -m "feat: record booking attendance and visit source"
```

### Task 3: Service timeline and provider workflow

**Files:**
- Modify: `src/app/(app)/klinik/antrian/actions.ts`
- Modify: `src/app/(app)/klinik/antrian/page.tsx`
- Modify: `src/app/(app)/klinik/antrian/[id]/page.tsx`
- Modify: `src/app/(app)/klinik/rekam-medis/[visitId]/actions.ts`
- Modify: `src/app/(app)/klinik/rekam-medis/[visitId]/RekamForm.tsx`
- Modify: `src/app/(app)/klinik/follow-up/actions.ts`
- Modify: `src/lib/operasional-klinik.ts`
- Modify: `src/lib/__tests__/operasional-klinik.test.ts`

- [ ] **Step 1: Add failing tests for duration and provider eligibility**

```ts
it("menghitung menit tunggu dan layanan tanpa mengubah null menjadi nol", () => {
  expect(serviceDurations({ checkedInAt: "2026-08-31T01:00:00Z", serviceStartedAt: "2026-08-31T01:15:00Z", serviceFinishedAt: "2026-08-31T02:00:00Z", checkedOutAt: null }))
    .toEqual({ waitMinutes: 15, serviceMinutes: 45 });
  expect(serviceDurations({ checkedInAt: "2026-08-31T01:00:00Z", serviceStartedAt: null, serviceFinishedAt: null, checkedOutAt: null }))
    .toEqual({ waitMinutes: null, serviceMinutes: null });
});
```

- [ ] **Step 2: Implement pure duration helper**

Return `null` unless both endpoints exist. Reject negative duration through `validateServiceTimeline`.

- [ ] **Step 3: Add start/finish/check-out actions**

Each action loads visit and validates branch. Start requires status `Menunggu`, sets `service_started_at` once and status `Diperiksa`. Finish requires started timestamp, sets `service_finished_at` once and status `Selesai`. Existing payment/finish flow sets `checked_out_at` once. Each mutation appends matching event with same authenticated user.

When follow-up action changes status to `Selesai`, set `completed_at=now()` and `completed_by=auth.uid()`. When moved away from `Selesai`, clear both. This timestamp is required for on-time compliance; `reminded_at` is not completion time.

- [ ] **Step 4: Add provider picker**

Load active employees assigned to visit branch. Save `service_provider_id` only if selected employee is active and belongs to that branch. Doctor field remains existing doctor source; provider is fallback for grooming/non-doctor service. Append `provider_changed` audit event.

- [ ] **Step 5: Add buttons and timestamps to queue UI**

Show check-in, service start, finish, and calculated minutes. Disable invalid next actions. Historical null stays `Belum tercatat`.

- [ ] **Step 6: Test and commit**

Run: `npm test -- src/lib/__tests__/operasional-klinik.test.ts && npm run lint && npm run build`

Expected: all exit 0.

```bash
git add src/app/(app)/klinik/antrian src/app/(app)/klinik/rekam-medis src/lib/operasional-klinik.ts src/lib/__tests__/operasional-klinik.test.ts
git commit -m "feat: track clinic service timeline and provider"
```

### Task 4: Capacity, referral, and clinical metrics

**Files:**
- Create: `src/app/(app)/pengaturan/operasional-klinik/page.tsx`
- Create: `src/app/(app)/pengaturan/operasional-klinik/actions.ts`
- Create: `src/app/(app)/klinik/rekam-medis/[visitId]/ReferralPanel.tsx`
- Modify: `src/app/(app)/klinik/rekam-medis/[visitId]/page.tsx`
- Modify: `src/app/(app)/klinik/rekam-medis/[visitId]/actions.ts`
- Create: `src/lib/operasional-klinik-server.ts`
- Modify: `src/lib/operasional-klinik.ts`
- Modify: `src/lib/__tests__/operasional-klinik.test.ts`
- Modify: `src/lib/nav.ts`

- [ ] **Step 1: Add failing metric tests**

Test exact rules:

- follow-up denominator includes due rows except `Batal`; numerator requires `Selesai` at/before due-date end;
- occupancy = occupied bed-days / available bed-days, clipped per admission/discharge and capacity effective period;
- capacity missing returns `{ status: "missing" }`, never `0`;
- referral count groups `masuk` and `keluar` separately.

- [ ] **Step 2: Implement pure metric functions**

Export `followUpCompliance`, `calculateOccupancy`, and `countReferrals` with explicit input/output types. Use date-only Asia/Jakarta boundaries for due-date and bed-day calculations.

- [ ] **Step 3: Add capacity settings page**

OWNER/ADMIN can create non-overlapping effective periods per accessible branch. Server action rechecks role with `assertMasterAdmin`, branch access, positive integer capacity, and valid date range. Page lists history; never overwrites an old effective period.

- [ ] **Step 4: Add referral panel and actions**

Panel records direction, facility, reason, date/time, and notes. Action derives branch from visit, ignores client-supplied branch ID, inserts referral plus `referral_created` event. List is newest-first and branch-scoped through visit/RLS.

- [ ] **Step 5: Add server collector**

`operasional-klinik-server.ts` accepts `{ from, to, branchIds }`, validates requested branches against current user, applies those filters at query time, and returns aggregate DTO only. No foreign branch row may be fetched then filtered in JS.

- [ ] **Step 6: Add navigation and verify**

Add `Operasional Klinik` under Pengaturan and keep role visibility OWNER/ADMIN.

Run: `npm test -- src/lib/__tests__/operasional-klinik.test.ts && npm run lint && npm run build && supabase db reset`

Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/(app)/pengaturan/operasional-klinik src/app/(app)/klinik/rekam-medis src/lib/operasional-klinik.ts src/lib/operasional-klinik-server.ts src/lib/__tests__/operasional-klinik.test.ts src/lib/nav.ts
git commit -m "feat: add clinic capacity referral and metrics"
```

### Task 5: Security, backfill, and acceptance verification

**Files:**
- Modify: `docs/PAPAN-KERJA.md`

- [ ] **Step 1: Run full automated checks**

Run: `npm test && npm run lint && npm run build && supabase db reset`

Expected: all exit 0.

- [ ] **Step 2: Verify RLS with two users**

Using one branch-only user and one OWNER, query bookings, visits, capacity, referrals, and operational events for two branches. Branch user must get own rows only and must fail foreign inserts. OWNER sees both. Record test IDs and results in project board.

- [ ] **Step 3: Verify no synthetic backfill**

Run SQL counts proving pre-migration visits retain null timestamps and existing bookings keep outcome `pending`; do not infer `hadir` from old status.

- [ ] **Step 4: Browser smoke test**

Run: `npm run dev`

Verify confirmed past booking → no-show; booking registration → hadir; walk-in source; start/finish sequence; invalid reverse action blocked; capacity effective periods; referral input; metrics reconcile to detail.

- [ ] **Step 5: Record evidence and commit**

```bash
git add docs/PAPAN-KERJA.md
git commit -m "docs: verify clinic operations data"
```
