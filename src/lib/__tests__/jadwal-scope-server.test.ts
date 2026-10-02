import { expect, it } from "vitest";
import { scopeJadwal } from "../jadwal-scope";
import type { createClient } from "../supabase/server";
function client(
  options: {
    branch?: string;
    employeeStart?: string;
    errorTable?: string;
    schedules?: {
      employee_id: string;
      tanggal: string;
      shift_id: string;
      id?: string;
      updated_at?: string;
    }[];
  } = {},
) {
  const tables: Record<string, unknown> = {
    profiles: { role: "ADMIN" },
    branches: [{ id: "b1", name: "Fiktif" }],
    user_branches: [
      { branch_id: options.branch ?? "b1", effective_date: "2026-01-01" },
    ],
    employees: [{ id: "e1", nama: "Fiktif", jabatan: null, branch_id: "b1" }],
    employee_branch_assignments: [
      {
        employee_id: "e1",
        branch_id: "b1",
        effective_date: options.employeeStart ?? "2026-10-01",
      },
    ],
    work_shifts: [{ id: "s1", nama: "Pagi", is_active: true }],
    employee_schedules: options.schedules ?? [],
  };
  if (options.schedules) {
    const ids = [...new Set(options.schedules.map((r) => r.employee_id))];
    tables.employees = ids.map((id) => ({
      id,
      nama: id,
      jabatan: null,
      branch_id: "b1",
    }));
    tables.employee_branch_assignments = ids.map((employee_id) => ({
      employee_id,
      branch_id: "b1",
      effective_date: "2026-01-01",
    }));
  }
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "admin" } }, error: null }),
    },
    from: (table: string) => {
      const result = {
        data: tables[table],
        error: table === options.errorTable ? { message: "unavailable" } : null,
      };
      let offset = 0,
        size = 1000;
      const q: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            ...result,
            data: Array.isArray(result.data)
              ? result.data.slice(offset, offset + size)
              : result.data,
          }).then(resolve),
        maybeSingle: async () => result,
      };
      for (const key of ["select", "eq", "or", "order", "in", "gte", "lte"])
        q[key] = () => q;
      q.range = (from: number, to: number) => {
        offset = from;
        size = to - from + 1;
        return q;
      };
      return q;
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>;
}
it("real server scope includes a midweek starter and carries per-day eligibility", async () => {
  const scope = await scopeJadwal(client(), "b1", "2026-09-28", "2026-10-04");
  expect(scope.employees).toEqual(["e1"]);
  expect(scope.employeeStarts).toEqual({ e1: "2026-10-01" });
});
it("real server scope rejects unauthorized branch despite primary employee branch", async () => {
  await expect(
    scopeJadwal(client({ branch: "other" }), "b1", "2026-10-01", "2026-10-31"),
  ).rejects.toThrow("Cabang tidak diizinkan");
});
it("real server scope fails closed on assignment read error", async () => {
  await expect(
    scopeJadwal(
      client({ errorTable: "employee_branch_assignments" }),
      "b1",
      "2026-10-01",
      "2026-10-31",
    ),
  ).rejects.toThrow("gagal dimuat");
});

it("reads every persisted schedule instead of silently truncating export at Supabase row limit", async () => {
  const schedules = Array.from({ length: 1200 }, (_, i) => ({
    employee_id: `e${Math.floor(i / 30)}`,
    tanggal: `2026-10-${String((i % 30) + 1).padStart(2, "0")}`,
    shift_id: "s1",
    id: `cell${i}`,
    updated_at: "2026-10-01T00:00:00.000001+00:00",
  }));
  const scope = await scopeJadwal(
    client({ schedules }),
    "b1",
    "2026-10-01",
    "2026-10-31",
  );
  expect(Object.keys(scope.existing)).toHaveLength(1200);
});

it("keeps the browser cell ID and exact microsecond version without JS date rounding", async () => {
  const cell = {
    employee_id: "e1",
    tanggal: "2026-10-02",
    shift_id: "s1",
    id: "cell1",
    updated_at: "2026-10-01T00:00:00.000001+00:00",
  };
  const scope = await scopeJadwal(
    client({ schedules: [cell] }),
    "b1",
    "2026-10-01",
    "2026-10-31",
  );
  expect(scope.existingVersions).toEqual({
    "e1|2026-10-02": {
      id: cell.id,
      updated_at: cell.updated_at,
      shift_id: cell.shift_id,
    },
  });
});
it("fails closed when a persisted cell has no usable version", async () => {
  await expect(
    scopeJadwal(
      client({
        schedules: [
          { employee_id: "e1", tanggal: "2026-10-02", shift_id: "s1" },
        ],
      }),
      "b1",
      "2026-10-01",
      "2026-10-31",
    ),
  ).rejects.toThrow("Versi jadwal");
});
