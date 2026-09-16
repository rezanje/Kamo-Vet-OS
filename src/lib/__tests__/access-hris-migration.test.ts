import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260916090000_access_hris_scope.sql"),
  "utf8",
);

describe("migrasi akses operasional", () => {
  it("tidak lagi memberi ADMIN akses cabang global", () => {
    const branchFunction = migration.slice(
      migration.indexOf("create or replace function public.user_can_access_branch"),
      migration.indexOf("create or replace function public.current_employee_id"),
    );
    expect(branchFunction).toContain("role in ('OWNER', 'FINANCE')");
    expect(branchFunction).not.toContain("'ADMIN'");
  });

  it("mengikat kunjungan ke cabang atau dokter yang ditugaskan", () => {
    expect(migration).toContain("public.user_can_access_visit(branch_id, doctor_id)");
    expect(migration).toContain("e.id = p_doctor_id");
  });

  it("mengganti policy HRIS terbuka dengan scope karyawan", () => {
    expect(migration).toContain("drop policy if exists employees_all");
    expect(migration).toContain("using (public.user_can_access_employee(id))");
    expect(migration).toContain("drop policy if exists attendance_all");
    expect(migration).toContain("using (public.user_can_access_employee(employee_id))");
  });
});

