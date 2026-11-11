import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ orderInsert: null as Record<string, unknown> | null }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null, canUseBranch: () => true }));
vi.mock("@/lib/penjualan-server", () => ({
  bacaBaris: () => [{ item_id: "item", nama: "Kimia Darah", satuan: "PCS", faktor: 1, qty: 1, harga: 550000 }],
  nextNoDokumen: async () => "SO-1", totalBaris: () => 550000,
}));
vi.mock("@/lib/penjualan-satuan", () => ({ validasiSatuanJual: async (_db: unknown, rows: unknown) => ({ rows, error: null }) }));
vi.mock("@/lib/hpp-warning-server", () => ({ grosirHppWarnings: async () => [] }));
vi.mock("@/lib/hpp-warning", () => ({ hppWarningConfirmed: () => true, hppWarningQuery: () => "" }));
vi.mock("@/lib/transaction-draft-ack", () => ({ transactionDraftAck: () => "" }));
vi.mock("@/lib/master-guard", () => ({ assertRole: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string) => name === "user_can_access_branch" ? { data: true, error: null }
    : { data: { document_id: `${name}-id`, document_no: `${name}-no` }, error: null },
  from: (table: string) => {
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: { id: "wh", branch_id: "branch", is_active: true }, error: null }),
      single: async () => ({ data: { id: "order" }, error: null }),
      insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
        if (table === "sales_orders") state.orderInsert = row as Record<string, unknown>;
        return table === "sales_order_items"
          ? { select: async () => ({ data: [{ id: "order-item", qty: 1 }], error: null }) }
          : q;
      },
    };
    return q;
  },
}) }));

import { buatFakturLangsung } from "./actions";

const form = (extra: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ request_key: "key", customer_id: "cust", branch_id: "branch", warehouse_id: "wh", items: "[]", ...extra })) data.set(key, value);
  return data;
};

beforeEach(() => { state.orderInsert = null; });

it("menyimpan tenaga penjual pilihan di pesanan dasar faktur langsung", async () => {
  const dokter = "11111111-2222-3333-4444-555555555555";
  await expect(buatFakturLangsung(form({ salesperson_id: dokter }))).rejects.toThrow("REDIRECT:/penjualan/faktur/sales_create_invoice-id");
  expect(state.orderInsert).toMatchObject({ salesperson_id: dokter, created_by: "actor" });
});

it("tanpa pilihan, pesanan tidak membawa tenaga penjual (laporan memakai pembuat faktur)", async () => {
  await expect(buatFakturLangsung(form({}))).rejects.toThrow("REDIRECT:/penjualan/faktur/sales_create_invoice-id");
  expect(state.orderInsert).not.toHaveProperty("salesperson_id");
});

it("menolak nilai tenaga penjual yang bukan pilihan daftar", async () => {
  await expect(buatFakturLangsung(form({ salesperson_id: "bukan-id" }))).rejects.toThrow("Pilih%20tenaga%20penjual");
  expect(state.orderInsert).toBeNull();
});
