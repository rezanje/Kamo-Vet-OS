// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  usage: null as string | null, steps: "habiskan, sebelum makan", status: "pending", official: false,
  saleBinding: null as null | { recipe_id: string; visit_id: string; sale_item_id: string; sale_name: string },
  saleBindingError: false, materialId: null as string | null,
  productionTrace: [] as Array<{ ingredient_id: string; material_item_id: string; production_order_id: string; no_produksi: string; restored: boolean }>,
  productionTraceError: false,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/klinik/racik/actions", () => ({ advanceRecipeStatus: vi.fn(), voidRecipe: vi.fn(), updateRacikPetunjuk: vi.fn(), updateRacikPemakaian: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async () => ({ data: fixture.productionTrace, error: fixture.productionTraceError ? { message: "denied" } : null }),
  from: (table: string) => {
  const record = () => ({ id: "recipe", recipe_name: "Fictional compound", dosage_instruction: fixture.usage,
    compounding_steps: fixture.steps, total_volume: "7", dosage_form: "kapsul", status: fixture.status,
    compound_official_usage: fixture.official ? [{ recipe_id: "recipe" }] : [], compounding_ingredients: [{ ingredient_name: "Fictional material", item_id: fixture.materialId, quantity: 2, unit: "ml" }],
    medical_records: { id: "record", visit_id: "visit", visits: { id: "visit", created_at: "2026-10-24T00:00:00Z" } },
  });
  const query = { select() { return query; }, eq() { return query; }, order() { return query; },
    maybeSingle: async () => table === "clinic_compound_sales"
      ? { data: fixture.saleBinding, error: fixture.saleBindingError ? { message: "unavailable" } : null }
      : { data: record() },
    then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: [record()] }).then(resolve); },
  };
  return query;
} }) }));
import Page from "@/app/(app)/klinik/racik/[recipeId]/page";

beforeEach(() => { fixture.usage = null; fixture.steps = "habiskan, sebelum makan"; fixture.status = "pending"; fixture.official = false; fixture.saleBinding = null; fixture.saleBindingError = false; fixture.materialId = null; fixture.productionTrace = []; fixture.productionTraceError = false; });
async function render() {
  document.body.innerHTML = renderToStaticMarkup(await Page({ params: Promise.resolve({ recipeId: "recipe" }), searchParams: Promise.resolve({}) }));
  return document;
}
it("keeps legacy mixed text out of the recipient field and labels it for review", async () => {
  const doc = await render();
  const field = doc.querySelector<HTMLTextAreaElement>('textarea[name="dosage_instruction"]');
  expect(field?.value).toBe("");
  expect(doc.querySelector("tbody tr td:nth-child(4)")?.textContent).toBe("belum diisi");
  expect(doc.querySelector("tbody tr td:last-child")?.textContent).toContain(fixture.steps);
  expect(doc.body.textContent).toContain("perlu ditinjau");
  expect(doc.body.textContent).toContain("ISI PETUNJUK PEMAKAIAN");
  expect(field?.closest("form")?.textContent).toContain("pemilik hewan");
  expect(field?.closest("form")?.textContent).toContain("Simpan Petunjuk Pemakaian");
  expect(field?.closest("form")?.querySelector('[name="compounding_steps"]')).toBeNull();
  expect(field?.closest("form")?.querySelector<HTMLInputElement>('[name="draft_scope"]')?.value).toBe("clinic-racik-usage:recipe");
});
it("reads saved recipient usage back verbatim while preserving separate internal preparation", async () => {
  fixture.usage = "Reviewed fictional instruction\nSecond line";
  fixture.steps = "1. Internal preparation\n2. Internal check";
  const doc = await render();
  expect(doc.querySelector<HTMLTextAreaElement>('[name="dosage_instruction"]')?.value).toBe(fixture.usage);
  expect(doc.querySelector("tbody tr td:nth-child(4)")?.textContent).toBe(fixture.usage);
  expect(doc.querySelector<HTMLTextAreaElement>('details [name="compounding_steps"]')?.value).toBe(fixture.steps);
});
it("does not fabricate instructions for a new blank record", async () => {
  fixture.steps = "";
  const doc = await render();
  expect(doc.querySelector<HTMLTextAreaElement>('[name="dosage_instruction"]')?.value).toBe("");
  expect(doc.querySelector("tbody tr td:nth-child(4)")?.textContent).toBe("belum diisi");
});
it("keeps official formula instructions read-only", async () => {
  fixture.official = true; fixture.usage = "Official stored text";
  const doc = await render();
  expect(doc.querySelector<HTMLTextAreaElement>('[name="dosage_instruction"]')?.readOnly).toBe(true);
  expect(doc.body.textContent).toContain("resep resmi");
});
it.each(["handed_over", "void"])("does not open recipient or internal editing for %s records", async status => {
  fixture.status = status;
  const doc = await render();
  expect(doc.querySelector('[name="dosage_instruction"]')).toBeNull();
  expect(doc.querySelector('[name="compounding_steps"]')).toBeNull();
});
it("links stored selling parent, visit, and physical ingredient without inventing parent stock", async () => {
  fixture.saleBinding = { recipe_id: "recipe", visit_id: "visit", sale_item_id: "parent", sale_name: "Stored selling name" };
  fixture.materialId = "material";
  const doc = await render();
  const trace = doc.querySelector('[aria-label="Jejak sumber racikan"]');
  expect(trace?.textContent).toContain("nonstok");
  expect(trace?.querySelector('a[href="/pos/sku/parent"]')?.textContent).toBe("Stored selling name");
  expect(trace?.querySelector('a[href="/klinik/rekam-medis/visit"]')).not.toBeNull();
  expect(doc.querySelector('a[href="/pos/kartu-stok?item=material"]')).not.toBeNull();
  expect(doc.querySelector('a[href*="kartu-stok?item=parent"]')).toBeNull();
});
it("does not link a mismatched or unreadable selling parent", async () => {
  fixture.saleBinding = { recipe_id: "recipe", visit_id: "other-visit", sale_item_id: "parent", sale_name: "Wrong patient" };
  let doc = await render();
  expect(doc.querySelector('a[href="/pos/sku/parent"]')).toBeNull();
  fixture.saleBindingError = true;
  doc = await render();
  expect(doc.querySelector('[aria-label="Jejak sumber racikan"]')?.textContent).toContain("belum dapat diperiksa");
});
it("opens an exact produced material source and labels restored consumption", async () => {
  fixture.productionTrace = [{ ingredient_id: "ingredient", material_item_id: "material", production_order_id: "job", no_produksi: "PRD.I09.00001", restored: true }];
  const doc = await render();
  const section = doc.querySelector('[aria-label="Asal produksi bahan racikan"]');
  expect(section?.querySelector('a[href="/pos/produksi?nomor=PRD.I09.00001#selected-production"]')).not.toBeNull();
  expect(section?.textContent).toContain("pemakaian dibatalkan dan stok dipulihkan");
  expect(section?.textContent).toContain("tidak diberi saldo stok virtual");
});
it("does not render production links when the private source reader denies access", async () => {
  fixture.productionTraceError = true;
  const doc = await render();
  expect(doc.querySelector('[aria-label="Asal produksi bahan racikan"] a')).toBeNull();
  expect(doc.querySelector('[aria-label="Asal produksi bahan racikan"] [role="alert"]')).not.toBeNull();
});
