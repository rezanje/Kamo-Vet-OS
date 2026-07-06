# Staff Personal Dashboard — Design

## Goal
When a `STAFF`-role user logs in and reaches `/mulai`, they choose between a **Dashboard Pribadi** (`/me`) and **POS Kasir** (`/kasir`). The personal dashboard is the staff's own HR hub: quest summary, personal KPI, today's attendance (clock in/out), and leave requests. Non-staff roles (OWNER/ADMIN) keep the existing `/mulai` (Dashboard VetOS + POS).

## Context
- Login uses `profiles` (linked to `auth.users`); role lives on `profiles.role`.
- HR data lives on the `employees` table keyed by `employees.id`: `attendance`, `leave_requests`, `kpi_records` all FK to `employees.id`.
- Quest system (`staff_points`, `staff_streaks`, `staff_quest_progress`, `staff_points_ledger`) keys off `profiles.id` (the logged-in user) — already works without any employee link.
- **Gap:** there is no link between a login (`profiles`) and an HR record (`employees`). Demo employees use `@klinik.com` emails; demo logins use `@vetos.local`. Zero natural match.

## Architecture

### 1. `/mulai` role gate
`src/app/mulai/page.tsx` reads `profiles.role`. Tiles chosen by role:
- `STAFF` → **Dashboard Pribadi** (`/me`, icon `ti-user-heart`) + **POS Kasir** (`/kasir`).
- everyone else → unchanged: **Dashboard VetOS** (`/`) + **POS Kasir** (`/kasir`).

Copy for the personal tile: title "Dashboard Pribadi", desc "Quest, KPI, absensi & pengajuan cuti kamu."

### 2. New `/me` route (standalone personal shell)
- `src/app/me/layout.tsx` — light shell with its own blue top bar (mirrors kasir `.pos-topbar`), title "DASHBOARD PRIBADI · <nama>", links back to `/mulai`, plus a shortcut button to POS Kasir. Not the admin sidebar.
- `src/app/me/page.tsx` — server component that loads the logged-in user, resolves their employee record via `getMyEmployee`, and renders four sections.

Four sections (each a `.card`):

1. **Ringkasan Quest** — reuse quest queries keyed on `profiles.id`: total poin (`staff_points`), streak (`staff_streaks`), quest selesai count (`staff_quest_progress` where status != in_progress this period). 3 small stat cards + button "Buka Quest Lengkap" → `/kasir/quest`. Always shown (does not need employee link).

2. **KPI Pribadi** — read-only. `kpi_records` where `employee_id = myEmp.id`, latest `periode`. Table: metrik, target, realisasi, skor (0–100) with a small progress bar. Empty state if none.

3. **Absensi Hari Ini** — `attendance` row where `employee_id = myEmp.id` and `tanggal = today`. States driven by `lib/attendance.ts`:
   - no row / no `jam_masuk` → button **Clock In** (creates row, sets `jam_masuk = now`, `status='Hadir'`).
   - `jam_masuk` set, no `jam_pulang` → show masuk time + button **Clock Out** (sets `jam_pulang = now`).
   - both set → show masuk & pulang time, "Selesai hari ini".
   Server actions `clockIn` / `clockOut` in `src/app/me/actions.ts`.

4. **Pengajuan Cuti/Izin** — form to submit (`jenis`: Cuti/Izin/Sakit/Lembur, tanggal mulai/selesai, durasi, alasan) → insert `leave_requests` with `status='Menunggu'`. Below the form, list this employee's requests with status badges (Menunggu/Disetujui/Ditolak). Approval stays on the manager side (`/hris/cuti`, unchanged). Server action `ajukanCuti`.

Sections 2–4 require a linked employee. If `getMyEmployee` returns null, those three render a notice card: "Akun belum tertaut ke data karyawan — hubungi manajer." Quest section still renders.

### 3. Data wiring
- **Migration `0034_employee_profile_link.sql`:**
  - `alter table employees add column profile_id uuid references profiles(id) on delete set null;`
  - `create index on employees(profile_id);`
  - Demo seed inside the migration: link `staff@vetos.local` → one Kasir employee (`update employees set profile_id = (select id from auth.users where email='staff@vetos.local') where jabatan = 'Kasir' and profile_id is null` — limit to one via subselect on a single id), and insert a few demo rows so the dashboard is populated:
    - 1 `kpi_records` row (periode = current month, metrik "Target Penjualan", target/realisasi/skor).
    - Leave `attendance` empty so Clock In is demonstrable.
    - 1 `leave_requests` row (status Menunggu) for list demo.
  - Seed is idempotent (guard with `where not exists` / `on conflict do nothing` where a unique constraint exists; `attendance` has `unique(employee_id,tanggal)`).
- **Helper `src/lib/employee.ts`:** `getMyEmployee(supabase, userId)` → `{ id, nama, jabatan, branch_id } | null` via `employees.profile_id = userId`.

### 4. Pure logic + tests (`src/lib/attendance.ts`)
- `attendanceState(row: { jam_masuk?, jam_pulang? } | null): 'not_in' | 'in' | 'done'`.
- `nextAction(state)` → `'clockIn' | 'clockOut' | null`.
- Unit tests in `src/lib/__tests__/attendance.test.ts` covering the three states and action mapping.

### 5. POS Quest tab
Already present (Quest tab in `PosNav` → `/kasir/quest`). No change. Satisfies the "quest also reachable inside POS" requirement.

## Files
- Create: `supabase/migrations/0034_employee_profile_link.sql`
- Create: `src/lib/employee.ts`, `src/lib/attendance.ts`, `src/lib/__tests__/attendance.test.ts`
- Create: `src/app/me/layout.tsx`, `src/app/me/page.tsx`, `src/app/me/actions.ts`
- Create client bits as needed: `src/app/me/CutiForm.tsx` (leave form).
- Modify: `src/app/mulai/page.tsx` (role gate).

## Non-goals
- No approval UI on `/me` (managers approve in existing `/hris/cuti`).
- No geo/selfie attendance (that's HRIS "Verifikasi wajah", Fase 2, out of scope).
- No editing KPI from staff side (read-only).
- No new quest logic (reuse existing).

## Testing
- `npm test` — attendance state machine unit tests.
- Manual: log in as `staff@vetos.local`, land on `/mulai` (personal tile shown), open `/me`, clock in → clock out, submit a leave request, see quest summary, click through to `/kasir/quest`.
