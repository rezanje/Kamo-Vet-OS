// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Racikan: tombol "Void" diganti menu "Aksi" (ubah komposisi + kembalikan bahan).
// Keduanya wajib beralasan; validasi aksi server diperiksa sebelum RPC dipanggil.
const fixture = vi.hoisted(() => ({
  status: "pending",
  calls: [] as { name: string; args: Record<string, unknown> }[],
  rpcError: null as null | { code: string; message: string },
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (href: string) => { throw new Error(`REDIRECT ${href}`); },
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    fixture.calls.push({ name, args });
    return { data: null, error: name === "read_compound_trace" ? { message: "denied" } : fixture.rpcError };
  },
  from: (table: string) => {
    const record = () => ({ id: "recipe", recipe_name: "Racikan fiktif", dosage_instruction: null,
      compounding_steps: "", total_volume: "7", dosage_form: "kapsul", status: fixture.status,
      compound_official_usage: [], branch_id: "branch",
      compounding_ingredients: [{ ingredient_name: "Bahan fiktif", item_id: "bahan", quantity: 2, unit: "ml" }],
      medical_records: { id: "record", visit_id: "visit", visits: { id: "visit", created_at: "2026-10-24T00:00:00Z" } },
    });
    const query = { select() { return query; }, eq() { return query; }, order() { return query; }, in() { return query; },
      range() { return query; }, limit() { return query; },
      maybeSingle: async () => ({ data: table === "clinic_compound_sales" ? null : record(), error: null }),
      then(resolve: (result: unknown) => unknown) {
        return Promise.resolve({ data: table === "items"
          ? [{ id: "bahan", name: "Bahan fiktif", unit: "ml", sell_price: 1000 }, { id: "bahan2", name: "Bahan kedua", unit: "ml", sell_price: 2000 }]
          : [record()], count: table === "items" ? 2 : 1, error: null }).then(resolve);
      },
    };
    return query;
  },
}) }));
vi.mock("@/lib/clinic-compound-skus", () => ({ loadClinicCompoundSkus: async () => [], loadClinicSkuDetails: async () => ({ stock: new Map(), prices: [] }) }));
import Page from "@/app/(app)/klinik/racik/[recipeId]/page";
import { ubahKomposisiRacikan, kembalikanBahanRacikan } from "@/app/(app)/klinik/racik/actions";

beforeEach(() => { fixture.status = "pending"; fixture.calls = []; fixture.rpcError = null; });
async function render() {
  document.body.innerHTML = renderToStaticMarkup(await Page({
    params: Promise.resolve({ recipeId: "recipe" }), searchParams: Promise.resolve({}),
  }));
  return document;
}
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

it("replaces the Void button with an Aksi menu offering both compound corrections", async () => {
  const doc = await render();
  expect(doc.body.textContent).not.toContain("Void (resep berubah)");
  const aksi = doc.querySelector('details[aria-label="Aksi racikan"]')!;
  expect(aksi).not.toBeNull();
  expect(aksi.querySelector("summary")?.textContent).toContain("Aksi");
  expect(aksi.textContent).toContain("Ubah komposisi");
  expect(aksi.textContent).toContain("Kembalikan bahan");
  // Alasan wajib pada kedua aksi, bukan hanya diminta di teks bantuan.
  const reasons = [...aksi.querySelectorAll<HTMLTextAreaElement>('textarea[name="reason"]')];
  expect(reasons).toHaveLength(2);
  expect(reasons.every(field => field.required)).toBe(true);
  expect(aksi.querySelector<HTMLInputElement>('input[name="ingredients"]')?.value)
    .toBe(JSON.stringify([{ item_id: "bahan", quantity: 2 }]));
});

it("hides the Aksi menu once the compound is handed over or void", async () => {
  fixture.status = "handed_over";
  expect((await render()).querySelector('details[aria-label="Aksi racikan"]')).toBeNull();
  fixture.status = "void";
  expect((await render()).querySelector('details[aria-label="Aksi racikan"]')).toBeNull();
});

it("sends only ingredient IDs and quantities to the composition RPC", async () => {
  await expect(ubahKomposisiRacikan(form({ recipeId: "recipe", visitId: "visit", reason: "Dosis disesuaikan",
    ingredients: JSON.stringify([{ item_id: "bahan", quantity: 3, nama: "FORGED", harga: 99 }]) }))).rejects.toThrow("REDIRECT");
  const call = fixture.calls.find(row => row.name === "clinic_adjust_compound")!;
  expect(call.args).toEqual({ p_recipe_id: "recipe", p_ingredients: [{ item_id: "bahan", quantity: 3 }], p_reason: "Dosis disesuaikan" });
  expect(JSON.stringify(call.args)).not.toContain("FORGED");
});

it.each([
  ["", "Alasan perubahan komposisi wajib diisi"],
  ["ok", "Alasan perubahan komposisi wajib diisi"],
])("refuses a composition change without a usable reason (%s)", async (reason, message) => {
  await expect(ubahKomposisiRacikan(form({ recipeId: "recipe", visitId: "visit", reason,
    ingredients: JSON.stringify([{ item_id: "bahan", quantity: 1 }]) }))).rejects.toThrow(encodeURIComponent(message));
  expect(fixture.calls.some(row => row.name === "clinic_adjust_compound")).toBe(false);
});

it.each([
  ["[]", "minimal"],
  [JSON.stringify([{ item_id: "bahan", quantity: 0 }]), "jumlah"],
  [JSON.stringify([{ item_id: "bahan", quantity: 1 }, { item_id: "bahan", quantity: 2 }]), "bahan"],
])("refuses an invalid composition before any write", async ingredients => {
  await expect(ubahKomposisiRacikan(form({ recipeId: "recipe", visitId: "visit", reason: "Alasan cukup", ingredients })))
    .rejects.toThrow("REDIRECT");
  expect(fixture.calls.some(row => row.name === "clinic_adjust_compound")).toBe(false);
});

it("returns every ingredient through the compound return RPC with its reason", async () => {
  await expect(kembalikanBahanRacikan(form({ recipeId: "recipe", visitId: "visit", reason: "Resep dibatalkan dokter" })))
    .rejects.toThrow("REDIRECT /klinik/rekam-medis/visit?racikan=kembali");
  expect(fixture.calls.find(row => row.name === "clinic_return_compound")!.args)
    .toEqual({ p_recipe_id: "recipe", p_reason: "Resep dibatalkan dokter" });
});

it("refuses a return without a reason and surfaces a rejected database rule", async () => {
  await expect(kembalikanBahanRacikan(form({ recipeId: "recipe", visitId: "visit", reason: " " })))
    .rejects.toThrow(encodeURIComponent("Alasan pengembalian bahan wajib diisi"));
  expect(fixture.calls.some(row => row.name === "clinic_return_compound")).toBe(false);
  fixture.rpcError = { code: "P0001", message: "INVOICE_PAID: tagihan kunjungan sudah dibayar" };
  await expect(kembalikanBahanRacikan(form({ recipeId: "recipe", visitId: "visit", reason: "Salah racik" })))
    .rejects.toThrow("REDIRECT /klinik/racik/recipe?error=");
});
