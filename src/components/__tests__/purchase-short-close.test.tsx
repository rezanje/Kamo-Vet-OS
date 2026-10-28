import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ status: "Dipesan", received: 5, closure: null as unknown, profile: { role: "OWNER", is_active: true } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); }, useSearchParams: () => new URLSearchParams() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/components/dokumen/DokumenPanel", () => ({ DokumenPanel: () => null }));
vi.mock("@/components/ActivityHistoryLink", () => ({ ActivityHistoryLink: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) }, from(table: string) {
  let from = 0, to = Infinity;
  const q = { select: () => q, eq: () => q, in: () => q, order: () => q, range: (start:number,end:number) => { from=start;to=end;return q; }, maybeSingle: () => q, then(resolve: (value: unknown) => void) {
    const data = table === "purchase_orders" ? { id: "po", no_po: "PO.FICTION", tanggal: "2026-10-23", status: state.status, total: 1000, revision: 0, branch_id: "branch", to_warehouse_id: "warehouse", supplier_id: "supplier" }
      : table === "purchase_order_items" ? [{ id: "line", item_id: "item", nama: "Fiction item", qty: 10, qty_terima: state.received, qty_rusak: 0, harga_beli: 100, satuan: "pcs", faktor: 1 }]
      : table === "goods_receipts" ? [{ id: "receipt", no_terima: "TB.FICTION", tanggal:"2026-10-23" }]
      : table === "profiles" ? state.profile : table === "purchase_order_receipt_closures" ? state.closure : [];
    resolve({ data:Array.isArray(data)?data.slice(from,to+1):data, count:Array.isArray(data)?data.length:null, error: null });
  } }; return q;
} }) }));
import PODetailPage from "@/app/(app)/pembelian/[id]/page";
beforeEach(() => { state.status = "Dipesan"; state.received = 5; state.closure = null; state.profile = { role: "OWNER", is_active: true }; });
it("offers explicit final short-close for a temporary partial PO without relabelling it complete", async () => {
  const html = renderToStaticMarkup(await PODetailPage({ params: Promise.resolve({ id: "po" }), searchParams: Promise.resolve({}) }));
  expect(html).toContain("Terima barang");
  expect(html).toContain("Tutup sisa penerimaan");
  expect(html).toContain("tidak akan dikirim");
  expect(html).toContain("Alasan tutup sisa");
});
it("shows immutable final-partial evidence and an invoice link after short-close", async () => {
  state.status = "Diterima"; state.closure = { po_id: "po", actor_id: "owner", actor_name: "Fiction owner", closed_at: "2026-10-23T00:00:00Z", reason: "Supplier cannot supply the remainder", lines: [{ id: "line", ordered_qty: 10, received_qty: 5, closed_qty: 5, satuan: "pcs", faktor: 1 }] };
  const html = renderToStaticMarkup(await PODetailPage({ params: Promise.resolve({ id: "po" }), searchParams: Promise.resolve({}) }));
  expect(html).toContain("Supplier cannot supply");
  expect(html).toContain("Selesai parsial");
  expect(html).toContain("Buat faktur dari PO");
  expect(html).not.toContain("Terima barang");
});
it("keeps final-closing controls away from ordinary receiving roles", async () => {
  state.profile = { role: "STAFF", is_active: true };
  const html = renderToStaticMarkup(await PODetailPage({ params: Promise.resolve({ id: "po" }), searchParams: Promise.resolve({}) }));
  expect(html).not.toContain("Tutup sisa penerimaan");
});
