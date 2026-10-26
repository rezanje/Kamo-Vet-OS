// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/ActivityHistoryLink", () => ({ ActivityHistoryLink: () => null }));
vi.mock("@/app/(app)/pos/sku/BarangForm", () => ({ BarangForm: () => null }));
vi.mock("@/app/(app)/pos/sku/data", () => ({
  siapkanFormBarang: async () => ({ supabase: {}, categories: [], brands: [], units: [], suppliers: [], barangLain: [], kandidatGrup: [] }),
  loadBarang: async () => ({ id: "sku", name: "Fictional output", code: "SKU", item_type: "Persediaan", is_active: true }),
}));
vi.mock("@/lib/production-sku-history", () => ({ loadProductionSkuHistory: async () => [
  { id: "job", no_produksi: "PRD.FICTION.001", status: "selesai", tanggal: "2026-10-25", qty_jadi: 5, nilai_bahan: 20 },
] }));
import Page from "@/app/(app)/pos/sku/[id]/page";

it("opens a related output-SKU job without claiming clinical batch consumption", async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "sku" }), searchParams: Promise.resolve({}) }));
  document.body.innerHTML = html;
  const section = document.querySelector('[aria-label="Pekerjaan produksi SKU"]');
  expect(section?.querySelector('a[href="/pos/produksi?nomor=PRD.FICTION.001#selected-production"]')).not.toBeNull();
  expect(section?.textContent).toContain("bukan bukti bahwa suatu racikan klinik memakai batch produksi tertentu");
});
