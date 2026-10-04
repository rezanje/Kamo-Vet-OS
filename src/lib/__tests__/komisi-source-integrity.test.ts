import { expect, it } from "vitest";
import { komisiPeriode } from "../komisi-data";
// Only the external database boundary is replaced; real paging, collector and formula run.
function client(data: Record<string, Record<string, unknown>[]>) {
  return {
    from: (table: string) => {
      let rows = [...(data[table] ?? [])],
        start = 0,
        end = 499;
      const q = {
        select: () => q,
        order: () => q,
        range: (a: number, b: number) => {
          start = a;
          end = b;
          return q;
        },
        eq: (k: string, v: unknown) => {
          rows = rows.filter((r) => r[k] === v);
          return q;
        },
        is: (k: string, v: unknown) => {
          rows = rows.filter((r) => r[k] === v);
          return q;
        },
        not: (k: string, _op: string, v: unknown) => {
          rows = rows.filter((r) => r[k] !== v);
          return q;
        },
        neq: (k: string, v: unknown) => {
          rows = rows.filter((r) => r[k] !== v);
          return q;
        },
        in: (k: string, v: unknown[]) => {
          rows = rows.filter((r) => v.includes(r[k]));
          return q;
        },
        gte: (k: string, v: string) => {
          rows = rows.filter((r) => Date.parse(String(r[k])) >= Date.parse(v));
          return q;
        },
        lte: (k: string, v: string) => {
          rows = rows.filter((r) => Date.parse(String(r[k])) <= Date.parse(v));
          return q;
        },
        lt: (k: string, v: string) => {
          rows = rows.filter((r) => Date.parse(String(r[k])) < Date.parse(v));
          return q;
        },
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({
            data: rows.slice(start, end + 1),
            count: rows.length,
            error: null,
          }).then(r),
      };
      return q;
    },
  };
}
it("1102 child sale lines are retained, attributed on their WIB date and commissioned once", async () => {
  const data = {
    sales: [
      {
        id: "sale1",
        created_at: "2026-09-30T17:30:00Z",
        branch_id: "branch",
        cashier_id: "u1",
        salesperson_id: "e1",
        total: 110200,
      },
    ],
    sale_items: Array.from({ length: 1102 }, (_, i) => ({
      id: "line" + i,
      sale_id: "sale1",
      item_id: null,
      qty: 1,
      harga: 100,
      item_discount_type: null,
      item_discount_value: 0,
      hpp: 0,
    })),
    employees: [{ id: "e1", profile_id: "u1" }],
    commission_rules: [
      {
        id: "r1",
        nama: "Fiction ten percent",
        tipe: "persen",
        basis: "omzet",
        sumber: "kasir",
        persen: 10,
        nominal: 0,
        min_omzet: 0,
        is_active: true,
      },
    ],
  };
  const result = await komisiPeriode(client(data), "2026-10");
  expect(result.baris).toHaveLength(1102);
  expect(result.baris.every((r) => r.tanggal === "2026-10-01")).toBe(true);
  expect(result.hasil[0].komisi).toBe(11020);
});
it("voided paid clinical invoices cannot earn commission", async () => {
  const data = {
    invoices: [
      {
        id: "void-invoice",
        paid_status: "Lunas",
        paid_at: "2026-10-01T08:00:00+07:00",
        voided_at: "2026-10-02T08:00:00+07:00",
        total: 100,
        salesperson_id: "e1",
        visits: { branch_id: "branch", doctor_id: "e1" },
      },
    ],
    invoice_items: [
      {
        id: "void-line",
        invoice_id: "void-invoice",
        item_id: null,
        qty: 1,
        harga: 100,
        hpp: 0,
      },
    ],
  };
  const result = await komisiPeriode(client(data), "2026-10");
  expect(result.baris).toEqual([]);
  expect(result.hasil).toEqual([]);
});

it.each(["kasir", "reseller"] as const)(
  "visible %s source maps rolling employee without reading sensitive HR rows",
  async (source) => {
    const data = {
      employees: [], // RLS hides the sensitive rolling employee card.
      employee_profile_directory: [{ id: "rolling", profile_id: "seller" }],
      sales:
        source === "kasir"
          ? [
              {
                id: "sale",
                created_at: "2026-10-01T08:00:00+07:00",
                branch_id: "branch",
                cashier_id: "seller",
                salesperson_id: null,
                total: 100,
              },
            ]
          : [],
      sale_items:
        source === "kasir"
          ? [
              {
                id: "line",
                sale_id: "sale",
                item_id: null,
                qty: 1,
                harga: 100,
                hpp: 0,
              },
            ]
          : [],
      sales_invoices:
        source === "reseller"
          ? [
              {
                id: "invoice",
                tanggal: "2026-10-01",
                branch_id: "branch",
                created_by: "seller",
                dpp: 100,
                status: "terbit",
              },
            ]
          : [],
      sales_invoice_items:
        source === "reseller"
          ? [
              {
                id: "line",
                invoice_id: "invoice",
                item_id: null,
                order_item_id: null,
                qty: 1,
                harga: 100,
              },
            ]
          : [],
      commission_rules: [
        {
          id: "rule",
          nama: "Fiction ten percent",
          tipe: "persen",
          basis: "omzet",
          sumber: source,
          persen: 10,
          nominal: 0,
          min_omzet: 0,
          is_active: true,
        },
      ],
    };
    const result = await komisiPeriode(client(data), "2026-10");
    expect(result.hasil[0]?.employeeId).toBe("rolling");
    expect(result.hasil[0]?.komisi).toBe(10);
    expect(result.omzetTanpaPenjual).toBe(0);
  },
);
