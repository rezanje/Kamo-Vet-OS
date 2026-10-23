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
it("prints stored cashier and line performer names while keeping legacy attribution honest", async () => {
  state.lines = [
    { nama: "Jasa baru", qty: 1, harga: 100, service_performers: { version: 1, doctor_id: "doctor", staff_id: "staff", doctor_name: "Dokter saat transaksi", staff_name: "Staf saat transaksi" } },
    { nama: "Jasa lama", qty: 1, harga: 100, service_performers: null },
  ];
  const markup = renderToStaticMarkup(await Receipt({ params: Promise.resolve({ saleId: "sale" }) }));
  expect(markup).toContain("Kasir tersimpan"); expect(markup).toContain("Dokter saat transaksi"); expect(markup).toContain("Staf saat transaksi");
  expect(markup).toContain("Pelaksana per baris hanya ditampilkan jika tercatat; dokumen lama dapat belum memilikinya.");
  expect(markup).not.toContain("Pelaksana per baris belum tercatat (data lama)");
  expect(state.queries).toEqual(["sales", "sale_items"]);
});
it("keeps physical lines free from claims that a service performer is missing", async () => {
  state.lines = [{ nama: "Pakan", qty: 1, harga: 200, service_performers: null }];
  const markup = renderToStaticMarkup(await Receipt({ params: Promise.resolve({ saleId: "sale" }) }));
  expect(markup).not.toContain("Pelaksana per baris belum tercatat (data lama)");
  expect(markup.match(/Pelaksana per baris hanya ditampilkan/g)).toHaveLength(1);
});
it("shows a missing historical cashier snapshot without reconstructing an employee name", async () => {
  state.cashierName = null;
  const markup = renderToStaticMarkup(await Receipt({ params: Promise.resolve({ saleId: "sale" }) }));
  expect(markup).toContain("Kasir belum tercatat (data lama)");
  expect(state.queries).toEqual(["sales", "sale_items"]);
});
