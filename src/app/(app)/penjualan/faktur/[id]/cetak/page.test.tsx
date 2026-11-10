import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const ID = "fe7455fb-5a5f-4956-9934-b62901c74a5a";
const state = vi.hoisted(() => ({
  invoice: null as Record<string, unknown> | null,
  items: [] as Record<string, unknown>[],
  receipts: [] as Record<string, unknown>[],
  company: { nama_perusahaan: "PT Kamo Group", alamat: "Jl. Fiktif 1", npwp: null } as Record<string, unknown> | null,
  selected: [] as string[],
}));

vi.mock("@/components/PrintButton", () => ({ PrintButton: ({ label }: { label: string }) => <button>{label}</button> }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const q = {
        select: (cols: string) => { state.selected.push(`${table}:${cols}`); return q; },
        eq: () => q, order: () => q,
        range: async () => {
          const rows = table === "sales_invoice_items" ? state.items : state.receipts;
          return { data: rows, error: null, count: rows.length };
        },
        maybeSingle: async () => ({ data: table === "sales_invoices" ? state.invoice : state.company, error: null }),
      };
      return q;
    },
  }),
}));

import Page from "./page";

beforeEach(() => {
  state.selected = [];
  state.invoice = {
    id: ID, no_faktur: "FJ.2026.11.00002", tanggal: "2026-11-06", jatuh_tempo: "2026-11-06",
    total: 1_889_600, dpp: 1_889_600, ppn: 0, carried_paid: 0, returned_ar: 0, status: "berjalan",
    customers: { name: "AA Petshop Group", phone: "0812", address: "Bogor", npwp: null },
    branches: { name: "DC", code: "DC" },
  };
  state.items = [
    { id: "a", nama: "Pasir Lala 5,5L Pink", qty: 35, harga: 14_206, diskon: 0, satuan: "PCS" },
    { id: "b", nama: "Pasir Lala 25L Coffee", qty: 2, harga: 67_000, diskon: 0, satuan: "PCS" },
  ];
  state.receipts = [];
});

const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ id: ID }) }));

it("prints a customer-facing invoice without internal cost (HPP)", async () => {
  const html = await render();
  expect(html).toContain("FAKTUR PENJUALAN");
  expect(html).toContain("FJ.2026.11.00002");
  expect(html).toContain("AA Petshop Group");
  expect(html).toContain("Pasir Lala 5,5L Pink");
  expect(html).toContain("Rp 497.210");
  expect(html).toContain("Cetak / Simpan PDF");
  expect(html).not.toMatch(/HPP/i);
  expect(state.selected.some((s) => s.startsWith("sales_invoice_items:") && s.includes("hpp"))).toBe(false);
});

it("shows payments, returns and the remaining balance", async () => {
  state.invoice = { ...state.invoice!, returned_ar: 89_600 };
  state.receipts = [{ id: "r1", jumlah: 1_000_000 }];
  const html = await render();
  expect(html).toContain("Sudah dibayar");
  expect(html).toContain("Retur barang");
  expect(html).toContain("Rp 800.000");
  expect(html).toContain("BELUM LUNAS");
});

it("marks a fully paid invoice as LUNAS", async () => {
  state.receipts = [{ id: "r1", jumlah: 1_889_600 }];
  const html = await render();
  expect(html).toContain("LUNAS");
  expect(html).not.toContain("BELUM LUNAS");
});
