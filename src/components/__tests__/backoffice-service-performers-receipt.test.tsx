import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: [] as string[], lines: [] as unknown[], cashierName: "Kasir tersimpan" as string | null }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/components/PrintButton", () => ({ PrintButton: () => null }));
vi.mock("@/components/ClearPosDraft", () => ({ ClearPosDraft: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  state.queries.push(table);
  const query = { select: () => query, eq: () => query, is: () => query, order: () => query,
    maybeSingle: async () => ({ data: { id: "sale", no_struk: "POS", cashier_name: state.cashierName, total: 200, subtotal: 200, metode_bayar: "Transfer", bayar: 200, sale_payments: [{ method: "Transfer", amount: 200 }], payments_finalized_at: "2026-10-23", created_at: "2026-10-23" } }),
    then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: state.lines }).then(resolve),
  }; return query;
} }) }));
import Receipt from "@/app/(app)/pos/struk/[saleId]/page";
beforeEach(() => { state.queries = []; state.cashierName = "Kasir tersimpan"; state.lines = []; });
// Permintaan Andri 29 Okt 2026: struk petshop tidak menyebut nama tenaga penjual
// sama sekali. Struk kasir juga tidak terhubung ke kunjungan, jadi tidak ada dokter PJ.
it("prints the stored cashier but never a line performer name", async () => {
  state.lines = [
    { nama: "Jasa baru", qty: 1, harga: 100, service_performers: { version: 1, doctor_id: "doctor", staff_id: "staff", doctor_name: "Dokter saat transaksi", staff_name: "Staf saat transaksi" } },
    { nama: "Jasa lama", qty: 1, harga: 100, service_performers: null },
  ];
  const markup = renderToStaticMarkup(await Receipt({ params: Promise.resolve({ saleId: "sale" }) }));
  expect(markup).toContain("Kasir tersimpan");
  expect(markup).not.toContain("Dokter saat transaksi"); expect(markup).not.toContain("Staf saat transaksi");
  expect(markup).not.toContain("Pelaksana");
  expect(markup).not.toContain("Dokter PJ");
  expect(state.queries).toEqual(["sales", "sale_items"]);
});
it("keeps physical lines free from claims that a service performer is missing", async () => {
  state.lines = [{ nama: "Pakan", qty: 1, harga: 200, service_performers: null }];
  const markup = renderToStaticMarkup(await Receipt({ params: Promise.resolve({ saleId: "sale" }) }));
  expect(markup).not.toContain("Pelaksana");
});
it("shows a missing historical cashier snapshot without reconstructing an employee name", async () => {
  state.cashierName = null;
  const markup = renderToStaticMarkup(await Receipt({ params: Promise.resolve({ saleId: "sale" }) }));
  expect(markup).toContain("Kasir belum tercatat (data lama)");
  expect(state.queries).toEqual(["sales", "sale_items"]);
});
