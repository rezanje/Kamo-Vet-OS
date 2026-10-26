import { expect, it, vi } from "vitest";

vi.mock("../komisi-data", () => ({ komisiPeriode: async () => ({ hasil: [], baris: [] }) }));
import { kumpulkanDataGaji } from "../payroll-data";

const rules = {
  id: true, telat_mulai_menit: 1, telat_blok_menit: 5, telat_nominal_per_blok: 0,
  telat_maks: 0, bolos_per_hari: 0, lembur_per_jam: 0,
};

function fixture(fail = "", truncate = "") {
  const reads: { table: string; from: number }[] = [];
  const tables: Record<string, Record<string, unknown>[]> = {
    payroll_settings: [rules],
    employees: [{ id: "employee", nama: "Fictional", jabatan: "Dokter", gaji_pokok: 1000, status: "Aktif" }],
    employee_schedules: [{ id: "schedule", employee_id: "employee", tanggal: "2026-10-01", work_shifts: { is_libur: false, jam_masuk: "08:00" } }],
    attendance: [{ id: "attendance", employee_id: "employee", tanggal: "2026-10-01", jam_masuk: "08:00" }],
    leave_requests: Array.from({ length: 501 }, (_, i) => ({ id: `leave-${i}`, employee_id: "employee", tanggal_mulai: "2026-10-02", tanggal_selesai: "2026-10-02", status: "Disetujui" })),
    overtime_requests: [],
    employee_salary_components: [{ id: "component", employee_id: "employee", nominal: null, salary_components: { tipe: "tunjangan", nominal: 500, is_active: true } }],
    cash_advances: [], reimbursements: [],
  };
  const client = { from(table: string) {
    let rows = tables[table] ?? [];
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return q; },
      in: (key: string, values: string[]) => { rows = rows.filter(row => values.includes(String(row[key]))); return q; },
      gte: (key: string, value: string) => { rows = rows.filter(row => String(row[key]) >= value); return q; },
      lte: (key: string, value: string) => { rows = rows.filter(row => String(row[key]) <= value); return q; },
      is: (key: string, value: null) => { rows = rows.filter(row => row[key] == value); return q; },
      order: (key: string) => { rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key]))); return q; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: table === fail ? { message: "fixture error" } : null }),
      range: async (from: number, to: number) => {
        reads.push({ table, from });
        return { data: table === truncate ? [] : rows.slice(from, to + 1), count: rows.length,
          error: table === fail ? { message: "fixture error" } : null };
      },
    };
    return q;
  } };
  return { client, reads };
}

it("reads all source pages and includes configured pay without a 500-row cutoff", async () => {
  const { client, reads } = fixture();
  const [result] = await kumpulkanDataGaji(client, "2026-10");
  expect(result.rincian.tunjangan).toBe(500);
  expect(result.rincian.total).toBe(1500);
  expect(reads.filter(read => read.table === "leave_requests").map(read => read.from)).toEqual([0, 500]);
});

it.each(["employees", "employee_schedules", "attendance", "leave_requests", "overtime_requests", "employee_salary_components", "cash_advances", "reimbursements"])("blocks payroll when %s fails", async table => {
  await expect(kumpulkanDataGaji(fixture(table).client, "2026-10")).rejects.toThrow("belum dapat dimuat lengkap");
});

it("blocks payroll when a source returns fewer rows than its verified count", async () => {
  await expect(kumpulkanDataGaji(fixture("", "employee_salary_components").client, "2026-10"))
    .rejects.toThrow("belum dimuat lengkap");
});
