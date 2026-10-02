import { expect, it } from "vitest";
import { kumpulkanDataGaji } from "../payroll-data";
it("approved effective shift at 08:00 prevents lateness for arrival at 08:00 in the existing collector", async () => {
  const data: Record<string, Record<string, unknown>[]> = {
    payroll_settings:[{id:true,telat_mulai_menit:1,telat_blok_menit:5,telat_nominal_per_blok:0,telat_maks:0,bolos_per_hari:0,lembur_per_jam:0}],
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
        id: "source-1",
        employee_id: "e1",
        tanggal: "2026-10-01",
        work_shifts: { is_libur: false, jam_masuk: "07:00" },
      },
    ],
    attendance: [
      {
        id: "source-1",
        employee_id: "e1",
        tanggal: "2026-10-01",
        jam_masuk: "08:00",
        is_void: false,
      },
    ],
  };
  const client = {
    rpc: async (name:string) => ({ data:name==="hris_assert_payroll_scope"?true:{revision:0,version:0},error:null }),
    from: (table: string) => {
      let rows = data[table] ?? [];
      const q: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, count:rows.length,error:null }).then(resolve),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      q.eq = (key: string, value: unknown) => {
        rows = rows.filter((r) => r[key] === value);
        return q;
      };
      for (const method of [
        "range",
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
  expect(result[0].rincian.menitTelat).toBe(60);
  data.employee_schedules[0].work_shifts = {
    is_libur: false,
    jam_masuk: "08:00",
  };
  const approved = await kumpulkanDataGaji(client, "2026-10");
  expect(approved[0].rincian.menitTelat).toBe(0);
  expect(approved[0].rincian.potonganTelat).toBe(0);
});
