import { expect, it } from "vitest";
import { kumpulkanDataGaji } from "../payroll-data";
it("voided attendance does not count as worked attendance in the existing payroll collector", async () => {
  const data: Record<string, Record<string, unknown>[]> = {
    employees: [
      {
        id: "e1",
        nama: "Fiksi",
        jabatan: "Staff",
        gaji_pokok: 100,
        status: "Aktif",
      },
    ],
    employee_schedules: [
      {
        employee_id: "e1",
        tanggal: "2026-10-01",
        work_shifts: { is_libur: false, jam_masuk: "08:00" },
      },
    ],
    attendance: [
      {
        employee_id: "e1",
        tanggal: "2026-10-01",
        jam_masuk: "08:00",
        is_void: true,
      },
    ],
  };
  const client = {
    from: (table: string) => {
      let rows = data[table] ?? [];
      const q: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      q.eq = (key: string, value: unknown) => {
        rows = rows.filter((r) => r[key] === value);
        return q;
      };
      for (const method of [
        "select",
        "order",
        "in",
        "gte",
        "lte",
        "is",
        "neq",
        "lt",
        "limit",
        "not",
      ])
        q[method] = () => q;
      return q;
    },
  };
  const result = await kumpulkanDataGaji(client, "2026-10");
  expect(result[0].rincian.hariHadir).toBe(0);
  expect(result[0].rincian.hariBolos).toBe(1);
});
