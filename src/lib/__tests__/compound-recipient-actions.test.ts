import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  saved: null as Record<string, unknown> | null,
  filters: {} as Record<string, unknown>,
  error: null as { message: string } | null,
  available: true,
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: () => {
    const query = {
      update(value: Record<string, unknown>) { fixture.saved = value; return query; },
      eq(key: string, value: unknown) { fixture.filters[key] = value; return query; },
      in(key: string, value: unknown) { fixture.filters[key] = value; return query; },
      select() { return query; },
      maybeSingle: async () => ({ data: fixture.available ? { id: "recipe" } : null, error: fixture.error }),
    };
    return query;
  },
}) }));
import { updateRacikPemakaian, updateRacikPetunjuk } from "@/app/(app)/klinik/racik/actions";

beforeEach(() => { fixture.saved = null; fixture.filters = {}; fixture.error = null; fixture.available = true; });
function form(usage: string) {
  const data = new FormData();
  data.set("recipeId", "recipe"); data.set("dosage_instruction", usage); data.set("total_volume", " 7 ");
  data.set("compounding_steps", "Legacy text must not be read as usage");
  return data;
}
it("saves only explicitly supplied recipient instructions and quantity in existing fields", async () => {
  await expect(updateRacikPemakaian(form("  Instructions explicitly reviewed by clinician\nSecond line  "))).rejects.toThrow("success=pemakaian");
  expect(fixture.saved).toEqual({ dosage_instruction: "Instructions explicitly reviewed by clinician\nSecond line", total_volume: "7" });
  expect(fixture.filters).toEqual({ id: "recipe", status: ["pending", "ready"] });
});
it("preserves blank usage as null without falling back to old technical steps", async () => {
  await expect(updateRacikPemakaian(form("  "))).rejects.toThrow("success=pemakaian");
  expect(fixture.saved?.dosage_instruction).toBeNull();
});
it("rejects old internal-only form submissions instead of clearing recipient usage", async () => {
  const data = form(""); data.delete("dosage_instruction");
  await expect(updateRacikPemakaian(data)).rejects.toThrow("error=");
  expect(fixture.saved).toBeNull();
});
it("does not report success for inaccessible, handed-over or void rows", async () => {
  fixture.available = false;
  await expect(updateRacikPemakaian(form("Reviewed text"))).rejects.toThrow("error=");
});
it("surfaces database/official snapshot errors without claiming a save", async () => {
  fixture.error = { message: "RECIPE_LINKED: resep resmi tidak dapat diubah" };
  await expect(updateRacikPemakaian(form("Reviewed text"))).rejects.toThrow("error=");
});
it("internal saves cannot overwrite recipient usage or quantity from a restored old draft", async () => {
  const data = form("Must not overwrite recipient usage");
  await expect(updateRacikPetunjuk(data)).rejects.toThrow("success=petunjuk");
  expect(fixture.saved).toEqual({ compounding_steps: "Legacy text must not be read as usage" });
  expect(fixture.filters).toEqual({ id: "recipe", status: ["pending", "ready"] });
});
