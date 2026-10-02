import { expect, it } from "vitest";
import { kumpulkanDataGaji } from "../payroll-data";
function client(failedTable: string | null = null) {
  return {
    rpc: async (name: string) => ({
      data: name === "hris_assert_payroll_scope" ? true : { revision: 5 },
      error: null,
    }),
    from: (table: string) => {
      const rows: Record<string, unknown>[] =
        table === "payroll_settings"
          ? [
              {
                id: true,
                telat_mulai_menit: 1,
                telat_blok_menit: 5,
                telat_nominal_per_blok: 0,
                telat_maks: 0,
                bolos_per_hari: 0,
                lembur_per_jam: 0,
              },
            ]
          : table === "employees"
            ? [{ id: "e1", nama: "Fiction", status: "Aktif", gaji_pokok: 100 }]
            : [];
      const q: Record<string, unknown> = {
        maybeSingle: async () => ({
          data: table === "payroll_settings" ? { telat_blok_menit: 5 } : null,
          error:
            table === failedTable
              ? { message: "fiction source failure" }
              : null,
        }),
        then: (r: (x: unknown) => unknown) =>
          Promise.resolve({
            data: rows,
            count: rows.length,
            error:
              table === failedTable
                ? { message: "fiction source failure" }
                : null,
          }).then(r),
      };
      for (const method of [
        "select",
        "order",
        "gte",
        "lte",
        "lt",
        "in",
        "not",
        "is",
        "neq",
        "range",
        "eq",
      ])
        q[method] = () => q;
      return q;
    },
  };
}
it.each([
  "attendance",
  "payroll_settings",
  "commission_rules",
  "sales",
  "cash_advance_installments",
])(
  "source %s failure refuses to calculate instead of using zero",
  async (table) => {
    await expect(kumpulkanDataGaji(client(table), "2026-10")).rejects.toThrow(
      table,
    );
  },
);
