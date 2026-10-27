// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Fictional fixtures only: IDs and names below do not exist in any environment.
type Ingredient = { ingredient_name: string; item_id: string | null; quantity: number; unit: string };
type Sibling = { id: string; recipe_name: string; created_at: string; status: string; compounding_ingredients: Ingredient[] };
const fixture = vi.hoisted(() => ({
  recipe: null as null | Record<string, unknown>, recipeError: null as null | { message: string },
  siblings: [] as Sibling[], siblingsError: null as null | { message: string },
  binding: null as null | Record<string, unknown>,
  invoiceLines: [] as Record<string, unknown>[], invoiceError: null as null | { message: string },
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/klinik/racik/actions", () => ({ advanceRecipeStatus: vi.fn(), voidRecipe: vi.fn(), updateRacikPetunjuk: vi.fn(), updateRacikPemakaian: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const query = {
    select: () => query, eq: () => query, order: () => query,
    range: async (from: number, to: number) => fixture.invoiceError ? { data: null, count: null, error: fixture.invoiceError }
      : { data: fixture.invoiceLines.slice(from, to + 1), count: fixture.invoiceLines.length, error: null },
    maybeSingle: async () => table === "clinic_compound_sales" ? { data: fixture.binding, error: null }
      : { data: fixture.recipe, error: fixture.recipeError },
    then(resolve: (result: unknown) => unknown) {
      return Promise.resolve(fixture.siblingsError ? { data: null, error: fixture.siblingsError } : { data: fixture.siblings, error: null }).then(resolve);
    },
  };
  return query;
} }) }));
import Page from "@/app/(app)/klinik/racik/[recipeId]/page";

const visit = { id: "visit-a", poli: "Umum", dokter: "Fictional doctor", keluhan: null, created_at: "2026-09-15T02:00:00Z",
  pets: { name: "Fictional pet", species: "Kucing", breed: null, photo_url: null }, customers: { name: "Fictional owner", phone: "000", address: null } };
const current: Sibling = { id: "recipe-a", recipe_name: "Same name", created_at: "2026-09-15T03:00:00Z", status: "handed_over",
  compounding_ingredients: [{ ingredient_name: "Same material", item_id: "material-1", quantity: 2, unit: "ml" }] };

beforeEach(() => {
  fixture.recipe = { ...current, dosage_instruction: "", total_volume: "7", dosage_form: "kapsul", compounding_steps: "",
    medical_record_id: "record-a", compound_official_usage: [],
    medical_records: { id: "record-a", diagnosis: null, anamnesis: null, catatan_resep: null, visit_id: "visit-a", visits: visit } };
  fixture.recipeError = null; fixture.siblings = [current]; fixture.siblingsError = null;
  fixture.binding = { recipe_id: "recipe-a", visit_id: "visit-a", sale_item_id: "parent-sku", sale_name: "Stored nonstock parent" };
  fixture.invoiceLines = [{ id: "line-1", invoice_id: "invoice-a", invoices: { id: "invoice-a", visit_id: "visit-a", invoice_no: "INV-FICTION-1", voided_at: null } }];
  fixture.invoiceError = null;
});
async function render() {
  document.body.innerHTML = renderToStaticMarkup(await Page({ params: Promise.resolve({ recipeId: "recipe-a" }), searchParams: Promise.resolve({}) }));
  return document;
}

it("follows a valid sale → visit → ingredient ledger chain by stored IDs", async () => {
  const doc = await render();
  const trace = doc.querySelector('[aria-label="Jejak sumber racikan"]');
  expect(trace?.querySelector('a[href="/pos/sku/parent-sku"]')?.textContent).toBe("Stored nonstock parent");
  expect(trace?.querySelector('a[href="/klinik/rekam-medis/visit-a"]')).not.toBeNull();
  expect(doc.querySelector('[aria-label="Invoice terkait"] a[href="/klinik/pembayaran/visit-a/invoice?invoice_id=invoice-a"]')?.textContent).toBe("INV-FICTION-1");
  expect(doc.body.textContent).toContain("Fictional owner");
  // The ledger link starts at the recipe's issue date so its stored `racik` movement is in range.
  expect(doc.querySelector('a[href="/pos/kartu-stok?item=material-1&dari=2026-09-15"]')).not.toBeNull();
  expect(doc.querySelector('a[href*="kartu-stok?item=parent-sku"]')).toBeNull();
});

it("keeps same-name recipes and materials distinct by their stored IDs", async () => {
  fixture.siblings = [current, { id: "recipe-b", recipe_name: "Same name", created_at: "2026-09-16T01:00:00Z", status: "pending",
    compounding_ingredients: [{ ingredient_name: "Same material", item_id: "material-2", quantity: 1, unit: "ml" }] }];
  const doc = await render();
  expect(doc.querySelector('a[href="/pos/kartu-stok?item=material-1&dari=2026-09-15"]')).not.toBeNull();
  expect(doc.querySelector('a[href="/pos/kartu-stok?item=material-2&dari=2026-09-16"]')).not.toBeNull();
  expect(doc.querySelector('a[href="/klinik/racik/recipe-b"]')?.textContent).toContain("Same name");
  expect(doc.querySelector('a[href="/klinik/racik/recipe-a"]')).toBeNull();
});

it("does not link any source when the stored visit/record is missing or deleted", async () => {
  fixture.recipe = { ...fixture.recipe, medical_records: null };
  const doc = await render();
  expect(doc.querySelector('a[href="/pos/sku/parent-sku"]')).toBeNull();
  expect(doc.querySelector('a[href^="/klinik/rekam-medis/"]')).toBeNull();
  expect(doc.querySelector('[aria-label="Invoice terkait"]')).toBeNull();
});

it("treats a recipe hidden by branch access as not found without leaking linked documents", async () => {
  fixture.recipe = null;
  await expect(render()).rejects.toThrow("NOT_FOUND");
});

it("does not present a failed recipe read as a missing document", async () => {
  fixture.recipe = null; fixture.recipeError = { message: "unavailable" };
  await expect(render()).rejects.toThrow("belum dapat dimuat");
});

it("does not fabricate an empty composition when the composition read fails", async () => {
  fixture.siblingsError = { message: "unavailable" };
  const doc = await render();
  const list = doc.querySelector('[aria-label="Daftar obat racikan"]');
  expect(list?.querySelector('[role="alert"]')?.textContent).toContain("belum dapat dimuat");
  expect(list?.querySelector("tbody tr")).toBeNull();
  expect(doc.querySelector('a[href^="/pos/kartu-stok"]')).toBeNull();
});

it("does not link invoices when the invoice read fails", async () => {
  fixture.invoiceError = { message: "unavailable" };
  const doc = await render();
  expect(doc.querySelector('[aria-label="Invoice terkait"] [role="alert"]')).not.toBeNull();
  expect(doc.querySelector('a[href*="/invoice?invoice_id="]')).toBeNull();
});
