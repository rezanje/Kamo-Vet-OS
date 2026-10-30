import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ name: "Vitamin B12", code: "SKU-REF" }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  const query = {
    select() { return query; }, eq() { return query; }, is() { return query; }, order() { return query; }, limit() { return query; },
    maybeSingle: async () => ({ data: table === "visits" ? { id: "visit", created_at: "2026-10-23T00:00:00Z", poli: "Umum", dokter: "Fictional doctor", pets: { name: "Fictional pet", species: "Kucing" }, customers: { name: "Fictional owner" }, branches: { name: "Fictional branch" } }
      : table === "medical_records" ? { id: "record", diagnosis: "Fictional finding" }
      : table === "invoices" ? { id: "invoice", invoice_no: "INV-FICTION", created_at: "2026-10-23T00:00:00Z", subtotal: 200, discount: 0, tax: 0, total: 200, dp_amount: 0, paid_status: "Belum Lunas" } : null, error: null, count: 1 }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "prescription_items" ? [{ nama_obat: state.name, code: state.code, qty: 2, satuan: "btl", aturan_pakai: "Fictional instructions" }]
      : table === "invoice_items" ? [{ deskripsi: state.name, code: state.code, qty: 2, harga: 100, diskon_persen: 0 }] : [], error: null }).then(resolve),
  };
  return query;
} }) }));
import Prescription from "@/app/(app)/klinik/rekam-medis/[visitId]/resep/page";
import Invoice from "@/app/(app)/klinik/pembayaran/[visitId]/invoice/page";
beforeEach(() => { state.name = "Vitamin B12"; });
it.each([["prescription", Prescription], ["invoice", Invoice]] as const)("%s displays a new stored item name without adding its separate reference code", async (_name, page) => {
  const html = renderToStaticMarkup(await page({ params: Promise.resolve({ visitId: "visit" }) }));
  expect(html).toContain("Vitamin B12"); expect(html).not.toContain("SKU-REF —"); expect(html).not.toContain("SKU-REF ·");
});
it.each([["prescription", Prescription], ["invoice", Invoice]] as const)("%s retains legitimate digits and historical free text without heuristic stripping", async (_name, page) => {
  for (const name of ["B12 24/7 Formula 123", "SKU-REF — Legacy custom 123"]) {
    state.name = name;
    const html = renderToStaticMarkup(await page({ params: Promise.resolve({ visitId: "visit" }) }));
    expect(html).toContain(name);
  }
});
