import { beforeEach, describe, expect, it, vi } from "vitest";
import { buatRecurring } from "../../app/(app)/keuangan/jurnal-berulang/actions";

const { saved } = vi.hoisted(() => ({ saved: [] as Record<string, unknown>[] }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/recurring", async () => await import("../recurring"));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fiction-owner" } } }) },
  from: () => ({ insert: async (row: Record<string, unknown>) => { saved.push(row); return { error: null }; } }),
}) }));
function form(count?: string) {
  const data = new FormData();
  data.set("nama", "Fiction rent"); data.set("day_of_month", "1");
  data.set("lines", JSON.stringify([{ code: "FIC-D", debit: 100, credit: 0 }, { code: "FIC-K", debit: 0, credit: 100 }]));
  if (count !== undefined) data.set("max_occurrences", count);
  return data;
}
beforeEach(() => { saved.length = 0; });
describe("recurring form repeat-count server action", () => {
  it("persists the chosen repeat count", async () => {
    await expect(buatRecurring(form("12"))).rejects.toThrow("?success=");
    expect(saved[0].max_occurrences).toBe(12);
  });
  it("preserves unlimited monthly posting when omitted", async () => {
    await expect(buatRecurring(form())).rejects.toThrow("?success=");
    expect(saved[0].max_occurrences).toBeNull();
  });
  it("rejects a fractional count before saving", async () => {
    await expect(buatRecurring(form("1.5"))).rejects.toThrow("?error=");
    expect(saved).toEqual([]);
  });
});
