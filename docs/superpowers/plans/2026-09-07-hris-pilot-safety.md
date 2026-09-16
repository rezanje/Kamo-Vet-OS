# HRIS Pilot Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Menjadikan HRIS VetOS aman diuji memakai data demo dan siap masuk pilot terkontrol, dengan data karyawan, absensi, dan payroll terbatas sesuai peran serta cabang.

**Architecture:** Mesin HRIS yang sudah ada tidak dibangun ulang. Pekerjaan malam ini mengunci akses data di database dan server action, lalu membuktikan perilakunya memakai akun demo terpisah. Payroll tetap dipusatkan pada OWNER selama pilot agar satu periode gaji tidak terpecah antar-cabang.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/Postgres RLS, Vitest, database demo terpisah.

---

## Ruang Lingkup Malam Ini

### Dikerjakan

1. Pisahkan hak OWNER, ADMIN cabang, STAFF/DOCTOR, dan FINANCE pada HRIS.
2. Staf hanya melihat serta mengajukan data miliknya sendiri.
3. ADMIN hanya mengelola staf pada cabang penugasannya.
4. Payroll, aturan gaji, komponen gaji, dan aturan komisi hanya diproses OWNER selama pilot.
5. Siapkan bukti uji akses per peran dan alur demo staf → admin → draft gaji.

### Tidak dikerjakan

- PPh 21 otomatis.
- BPJS otomatis.
- Verifikasi wajah.
- Dokter lintas cabang.
- Pembayaran atau pengesahan gaji nyata.
- Data Kamo pada server yang belum pasti merupakan lingkungan demo.

## Aturan Hak Akses Pilot

| Peran | Data yang boleh dibuka | Aksi yang boleh dilakukan |
| --- | --- | --- |
| OWNER | Semua cabang dan seluruh data HRIS | Semua, termasuk aturan dan draft payroll |
| ADMIN cabang | Hanya karyawan serta pengajuan cabang penugasannya | Kelola staf, shift, jadwal, absensi manual, KPI, dan persetujuan cabangnya |
| STAFF / DOCTOR | Data HRIS miliknya sendiri | Absen serta mengajukan cuti, lembur, kasbon, dan reimburse sendiri |
| FINANCE | Tidak mendapat data HRIS pada fase pilot | Tidak ada aksi HRIS |

**Keputusan rancangan:** ADMIN tidak menghitung atau mengesahkan payroll pada fase pilot. OWNER memproses satu periode payroll agar aturan, komisi, dan pembukuan tidak terpecah antar-cabang.

## Peta File

| File | Tanggung jawab |
| --- | --- |
| supabase/migrations/20260907010000_secure_hris_access.sql | Pagar data HRIS per peran, cabang, dan karyawan |
| supabase/verify_hris_rls.sql | Bukti positif/negatif akses OWNER, ADMIN cabang, STAFF, dan DOCTOR |
| src/lib/hris-access.ts | Aturan murni untuk tampilan dan guard HRIS |
| src/lib/__tests__/hris-access.test.ts | Uji aturan tampilan serta aksi HRIS |
| src/lib/master-guard.ts | Guard khusus pengelola HRIS dan payroll OWNER |
| src/app/(app)/hris/karyawan/actions.ts | Tambah karyawan dengan cabang wajib |
| src/app/(app)/hris/absensi/actions.ts | Absensi manual pengelola cabang |
| src/app/(app)/hris/cuti/actions.ts | Pengajuan admin dan keputusan cuti |
| src/app/(app)/hris/jadwal/actions.ts | Jadwal shift cabang |
| src/app/(app)/hris/pengajuan/actions.ts | Keputusan lembur, kasbon, dan reimburse |
| src/app/(app)/hris/komponen-gaji/actions.ts | Komponen gaji OWNER |
| src/app/(app)/hris/shift/actions.ts | Master shift per cabang |
| src/app/(app)/hris/kpi/actions.ts | KPI cabang |
| src/app/(app)/hris/penggajian/actions.ts | Hitung, koreksi, dan sahkan payroll OWNER |
| src/app/(app)/hris/penggajian/page.tsx | Tombol payroll hanya OWNER |
| docs/HRIS-DEMO-UAT.md | Skenario demo serta bukti penerimaan pilot |

## Task 1: Kunci Aturan Hak Akses di Aplikasi

**Files:**
- Create: src/lib/hris-access.ts
- Create: src/lib/__tests__/hris-access.test.ts
- Modify: src/lib/master-guard.ts

- [ ] **Step 1: Tulis tes gagal untuk aturan hak akses.**

~~~ts
import { describe, expect, it } from "vitest";
import { bolehKelolaHris, bolehKelolaPayroll, bolehLihatDataPribadi } from "../hris-access";

describe("hak akses HRIS pilot", () => {
  it("OWNER mengelola seluruh HRIS dan payroll", () => {
    expect(bolehKelolaHris("OWNER")).toBe(true);
    expect(bolehKelolaPayroll("OWNER")).toBe(true);
  });

  it("ADMIN mengelola HRIS cabang tetapi bukan payroll", () => {
    expect(bolehKelolaHris("ADMIN")).toBe(true);
    expect(bolehKelolaPayroll("ADMIN")).toBe(false);
  });

  it("STAFF dan DOCTOR hanya memakai data pribadi", () => {
    expect(bolehKelolaHris("STAFF")).toBe(false);
    expect(bolehLihatDataPribadi("STAFF")).toBe(true);
    expect(bolehLihatDataPribadi("DOCTOR")).toBe(true);
  });

  it("FINANCE tidak mendapat akses HRIS pada pilot", () => {
    expect(bolehKelolaHris("FINANCE")).toBe(false);
    expect(bolehKelolaPayroll("FINANCE")).toBe(false);
  });
});
~~~

- [ ] **Step 2: Jalankan tes dan pastikan gagal.**

Run: npm test -- src/lib/__tests__/hris-access.test.ts

Expected: gagal karena modul akses HRIS belum ada.

- [ ] **Step 3: Tambahkan aturan murni.**

~~~ts
export const PERAN_PENGELOLA_HRIS = ["OWNER", "ADMIN"] as const;

export function bolehKelolaHris(role: string): boolean {
  return PERAN_PENGELOLA_HRIS.includes(role as (typeof PERAN_PENGELOLA_HRIS)[number]);
}

export function bolehKelolaPayroll(role: string): boolean {
  return role === "OWNER";
}

export function bolehLihatDataPribadi(role: string): boolean {
  return role === "STAFF" || role === "DOCTOR";
}
~~~

- [ ] **Step 4: Tambahkan guard server.**

Di src/lib/master-guard.ts, buat assertHrisManager untuk OWNER/ADMIN dan assertPayrollOwner untuk OWNER. Keduanya memakai sesi yang sama seperti assertRole dan memberi pesan: “Kamu tidak punya hak mengubah data HRIS cabang ini.”

- [ ] **Step 5: Jalankan tes aturan akses.**

Run: npm test -- src/lib/__tests__/hris-access.test.ts src/lib/__tests__/akses.test.ts

Expected: seluruh tes lulus.

- [ ] **Step 6: Commit.**

~~~bash
git add src/lib/hris-access.ts src/lib/__tests__/hris-access.test.ts src/lib/master-guard.ts
git commit -m "feat(hris): define pilot access roles"
~~~

## Task 2: Kunci Data HRIS di Database

**Files:**
- Create: supabase/migrations/20260907010000_secure_hris_access.sql
- Modify: supabase/verify_hris_rls.sql

- [ ] **Step 1: Buat fungsi akses khusus HRIS tanpa mengubah user_can_access_branch.**

user_can_access_branch dipakai modul lain dan sekarang memberi akses global kepada ADMIN/FINANCE. Jangan diubah. Migration baru membuat fungsi SECURITY DEFINER dengan search path kosong:

~~~sql
create function public.is_hris_owner()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'OWNER'
  );
$$;

create function public.can_manage_hris_branch(target_branch uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select public.is_hris_owner()
    or exists (
      select 1
      from public.profiles p
      join public.user_branches ub on ub.user_id = p.id
      where p.id = auth.uid()
        and p.role = 'ADMIN'
        and ub.branch_id = target_branch
    );
$$;

create function public.is_own_employee(target_employee uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.employees e
    where e.id = target_employee and e.profile_id = auth.uid()
  );
$$;
~~~

Tambahkan can_manage_hris_employee(target_employee uuid), yang memuat employees.branch_id dan memanggil can_manage_hris_branch. Karyawan tanpa cabang hanya bisa dikelola OWNER sampai datanya lengkap.

- [ ] **Step 2: Hapus policy longgar.**

Drop policy berikut sebelum membuat policy baru: employees_all, attendance_all, leave_all, payrolls_all, work_shifts_all, employee_schedules_all, salary_components_all, emp_salary_components_all, payroll_settings_all, overtime_requests_all, cash_advances_all, cash_advance_inst_all, reimbursements_all, kpi_all, commission_rules_all, dan sales_targets_all.

- [ ] **Step 3: Pasang policy baru.**

| Tabel | STAFF/DOCTOR | ADMIN cabang | OWNER |
| --- | --- | --- | --- |
| employees | baca diri sendiri | baca/tulis cabang sendiri | penuh |
| attendance | baca, masuk, pulang milik sendiri | baca/tulis cabang sendiri | penuh |
| leave_requests, overtime_requests, cash_advances, reimbursements | baca dan buat milik sendiri; tidak menyetujui | baca serta putuskan cabang sendiri | penuh |
| employee_schedules, kpi_records | baca milik sendiri | baca/tulis cabang sendiri | penuh |
| payrolls, employee_salary_components, salary_components, payroll_settings, commission_rules, sales_targets | tidak ada | tidak ada | penuh |
| work_shifts | baca | baca; tulis shift cabang sendiri | penuh |

Policy attendance dipisah INSERT, UPDATE, DELETE: staf boleh membuat/memperbarui baris dirinya, tidak menghapus. Semua pengajuan dipisah INSERT milik sendiri dari UPDATE pengelola cabang.

- [ ] **Step 4: Tambahkan bukti RLS nyata ke supabase/verify_hris_rls.sql.**

Gunakan empat akun demo: OWNER, ADMIN Cabang A, STAFF Cabang A, dan STAFF Cabang B. Dengan JWT simulasi, script harus gagal bila salah satu hasil ini tidak cocok:

~~~sql
-- STAFF Cabang A hanya melihat dirinya dan nol payroll.
select count(*) from public.employees;
select count(*) from public.payrolls;

-- ADMIN Cabang A tidak melihat satu pun karyawan Cabang B dan nol payroll.
select count(*) from public.employees where branch_id = :'branch_b';
select count(*) from public.payrolls;

-- OWNER melihat semua fixture demo HRIS.
select count(*) from public.employees;
select count(*) from public.payrolls;
~~~

Jalankan hanya terhadap database demo lokal atau proyek demo yang sudah dikonfirmasi.

- [ ] **Step 5: Periksa hak fungsi.**

Pastikan anon tidak dapat memanggil fungsi baru. Authenticated hanya memakainya melalui policy sesuai JWT.

- [ ] **Step 6: Commit.**

~~~bash
git add supabase/migrations/20260907010000_secure_hris_access.sql supabase/verify_hris_rls.sql
git commit -m "fix(hris): isolate employee and payroll data"
~~~

## Task 3: Kunci Semua Aksi HRIS di Server

**Files:**
- Modify: src/app/(app)/hris/karyawan/actions.ts
- Modify: src/app/(app)/hris/absensi/actions.ts
- Modify: src/app/(app)/hris/cuti/actions.ts
- Modify: src/app/(app)/hris/jadwal/actions.ts
- Modify: src/app/(app)/hris/pengajuan/actions.ts
- Modify: src/app/(app)/hris/komponen-gaji/actions.ts
- Modify: src/app/(app)/hris/shift/actions.ts
- Modify: src/app/(app)/hris/kpi/actions.ts
- Modify: src/app/(app)/hris/penggajian/actions.ts
- Modify: src/app/(app)/hris/penggajian/page.tsx

- [ ] **Step 1: Ganti createClient langsung pada aksi admin HRIS dengan guard.**

Gunakan assertHrisManager untuk tambah karyawan, absensi manual, pengajuan dari halaman admin, jadwal, shift, KPI, dan keputusan pengajuan. Database tetap menjadi pagar terakhir agar cabang yang dikirim browser tidak bisa dipalsukan.

- [ ] **Step 2: Jadikan payroll khusus OWNER.**

Di src/app/(app)/hris/penggajian/actions.ts:

~~~ts
const BOLEH = ["OWNER"];
~~~

Di src/app/(app)/hris/penggajian/page.tsx, ganti pemeriksaan tombol dari bolehKelolaMaster menjadi bolehKelolaPayroll. ADMIN tidak melihat daftar gaji, tombol hitung, koreksi, rekening, atau pengesahan.

- [ ] **Step 3: Wajibkan cabang untuk karyawan aktif.**

Di simpanKaryawan, tolak karyawan berstatus Aktif tanpa branch_id. Pesan: “Pilih cabang utama sebelum mengaktifkan karyawan.” OWNER masih dapat menyimpan karyawan Nonaktif sebagai arsip tanpa cabang.

- [ ] **Step 4: Pertahankan identitas sesi untuk pengajuan pribadi.**

Jangan ubah src/app/me/actions.ts. Aksi ini sudah mengambil employee_id dari akun yang sedang masuk; setelah RLS dipersempit, clock-in, clock-out, dan pengajuan pribadi wajib tetap lulus untuk pemilik data sendiri.

- [ ] **Step 5: Jalankan tes dan build.**

~~~bash
npm test -- src/lib/__tests__/hris-access.test.ts src/lib/__tests__/akses.test.ts src/lib/__tests__/attendance.test.ts src/lib/__tests__/lokasi.test.ts src/lib/__tests__/payroll.test.ts src/lib/__tests__/payroll-aturan.test.ts src/lib/__tests__/laporan-hris.test.ts src/lib/__tests__/komisi.test.ts
npm run build
~~~

Expected: seluruh tes lulus dan build selesai tanpa error baru.

- [ ] **Step 6: Commit.**

~~~bash
git add src/lib/master-guard.ts src/lib/hris-access.ts src/lib/__tests__/hris-access.test.ts src/app/(app)/hris
git commit -m "fix(hris): enforce pilot permissions in actions"
~~~

## Task 4: Siapkan Demo Terpisah dan Uji Peran

**Files:**
- Create: docs/HRIS-DEMO-UAT.md

- [ ] **Step 1: Verifikasi target sebelum membuat data.**

Target harus database demo lokal atau proyek demo yang sudah dikonfirmasi. Bila target tidak dapat dipastikan, hentikan dan laporkan BLOCKED BY DATA. Jangan menyentuh server Kamo yang saat ini terhubung.

- [ ] **Step 2: Buat fixture demo.**

| Akun | Cabang | Tujuan |
| --- | --- | --- |
| OWNER Demo | Semua | Payroll dan pengaturan pusat |
| ADMIN Pandu Demo | Pandu | Kelola staf serta pengajuan Cabang Pandu |
| STAFF Pandu Demo | Pandu | Absen dan pengajuan pribadi |
| STAFF Cabang B Demo | Cabang B | Bukti data Pandu tidak terlihat |

- [ ] **Step 3: Jalankan UAT.**

1. OWNER membuat dua karyawan demo, satu per cabang.
2. ADMIN Pandu hanya melihat dan mengubah karyawan Pandu.
3. STAFF Pandu absen lalu mengajukan lembur serta reimburse.
4. ADMIN Pandu menyetujui pengajuan Pandu dan tidak dapat membuka Cabang B.
5. OWNER mengatur komponen/aturan demo lalu menghitung payroll draft satu periode.
6. OWNER memeriksa slip draft; jangan mengesahkan atau membayar.
7. STAFF Pandu tidak dapat membuka payroll, komponen gaji, atau data karyawan lain.

- [ ] **Step 4: Catat bukti.**

Setiap baris di docs/HRIS-DEMO-UAT.md mencatat tanggal, akun demo, skenario, hasil harapan, hasil aktual, dan status LULUS/GAGAL. Jangan tulis nama, nomor, atau gaji Kamo.

- [ ] **Step 5: Bersihkan data demo secara terbatas.**

Jika lingkungan dipakai presentasi besok, pertahankan fixture dan tandai DEMO. Jika tidak, hapus hanya fixture yang dibuat Task 4, kemudian ulangi uji akses negatif.

## Task 5: Gerbang Pilot dan Laporan Akhir

**Files:**
- Modify: docs/LAPORAN-UJI-HRIS-KAMO-2026-09-07.md
- Modify: docs/HRIS-DEMO-UAT.md

- [ ] **Step 1: Perbarui laporan hanya dengan bukti selesai.**

Status Belum terbukti hanya menjadi Lulus setelah UAT per peran selesai. Bila database demo belum tersedia, pertahankan status tertahan dan jelaskan bahwa data Kamo tidak disentuh.

- [ ] **Step 2: Putuskan pilot dengan tiga gerbang.**

| Gerbang | Lulus bila |
| --- | --- |
| Akses | Semua uji negatif antar-cabang/peran lulus |
| Data | Data karyawan, shift, komponen gaji, serta aturan insentif Kamo disetujui |
| Angka | Parallel run satu periode cocok dengan perhitungan Kamo tanpa pembayaran otomatis |

- [ ] **Step 3: Jalankan pemeriksaan akhir.**

~~~bash
npm test
npm run build
git diff --check
~~~

Expected: seluruh tes lulus, build lulus, dan tidak ada kesalahan format.

- [ ] **Step 4: Commit dokumentasi.**

~~~bash
git add docs/LAPORAN-UJI-HRIS-KAMO-2026-09-07.md docs/HRIS-DEMO-UAT.md
git commit -m "docs(hris): record pilot readiness evidence"
~~~

## Urutan Eksekusi Malam Ini

1. Task 1 — aturan peran.
2. Task 2 — pagar database dan bukti RLS.
3. Task 3 — pagar tombol serta aksi aplikasi.
4. Task 4 — hanya setelah lingkungan demo aman dikonfirmasi.
5. Task 5 — laporan akhir serta keputusan pilot.

## Kriteria Selesai

- STAFF/DOCTOR tidak bisa membuka data HRIS orang lain atau payroll.
- ADMIN tidak bisa membuka atau mengubah data cabang lain.
- ADMIN tidak bisa menghitung, mengoreksi, atau mengesahkan payroll.
- OWNER tetap dapat menjalankan alur demo lengkap pada data demo.
- Seluruh pengujian otomatis, build, dan cek RLS lulus.
- Tidak ada data Kamo atau pembayaran nyata disentuh.

## Self-Review

- Cakupan: semua temuan audit HRIS ditangani; fitur di luar kebutuhan pilot tetap di luar scope.
- Kelengkapan langkah: tidak ada pekerjaan yang dibiarkan tanpa definisi.
- Konsistensi: database menjadi pagar utama; guard aplikasi memperjelas pengalaman pengguna.

## Execution Handoff

Plan complete and saved to docs/superpowers/plans/2026-09-07-hris-pilot-safety.md. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
