import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  doc: {
    id: "transfer-one", no_pemindahan: "IT.FIKTIF.0001", proses: "Kirim Barang", tanggal: "2026-10-31",
    status: "Sedang dikirim", keterangan: "Barang untuk toko sendiri", source_transfer_id: null,
    cancelled_at: null, cancel_reason: null, pembatal: null,
    from: { code: "GDG", name: "Gudang Pusat Fiktif" }, to: { code: "TK", name: "Toko Fiktif" },
    stock_transfer_items: [{ item_id: "item-one", qty: 12, selected_qty: 1, satuan: "Dus", faktor: 12, items: { code: "SKU-1", name: "Barang Fiktif", unit: "Pcs" } }],
  },
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/app/(app)/pos/pemindahan/[id]/TerimaForm", () => ({ TerimaForm: () => null }));
vi.mock("@/app/(app)/pos/pemindahan/[id]/BatalKirimForm", () => ({ BatalKirimForm: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "staff" } }, error: null }) },
  from: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: state.doc, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
    return q;
  },
}) }));
import Page from "@/app/(app)/pos/pemindahan/[id]/page";
beforeEach(() => { state.doc.proses = "Kirim Barang"; });
it("opens a read-only PDF/copy view from the saved shipment without submitting a transfer", async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "transfer-one" }), searchParams: Promise.resolve({}) }));
  expect(html).toContain('href="/pos/pemindahan/transfer-one/cetak"');
  expect(html).toContain("Cetak / Simpan PDF");
});
