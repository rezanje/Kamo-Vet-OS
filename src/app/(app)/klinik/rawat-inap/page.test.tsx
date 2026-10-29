import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  filters: [] as { table: string; op: string; args: unknown[] }[],
  counterRows: [] as { condition_status: string; admitted_at: string; discharged_at: string | null }[],
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/operational-branch", () => ({ availableOperationalBranches: async () => [{ id: "b1", code: "K1", name: "Klinik", type: "KLINIK" }] }));
vi.mock("@/lib/inpatient-stay", () => ({ readStayTypes: async () => new Map(), STAY_TYPE_LABEL: { sakit: "Rawat inap", hotel: "Pet hotel" } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from(table: string) {
      let counter = false;
      const q = {
        select: (cols: string) => { counter = cols === "condition_status, admitted_at, discharged_at"; return q; },
        eq: (...args: unknown[]) => { state.filters.push({ table, op: "eq", args }); return q; },
        in: () => q, is: () => q, order: () => q,
        or: (...args: unknown[]) => { state.filters.push({ table, op: "or", args }); return q; },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: counter ? state.counterRows : [], error: null }).then(resolve),
      };
      return q;
    },
  }),
}));

import RawatInapPage from "./page";

describe("Status Rawat Inap — kartu penghitung", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T03:00:00Z")); // 10.00 WIB
    state.filters = [];
    state.counterRows = [];
  });
  afterEach(() => vi.useRealTimers());

  it("hanya membaca pasien yang masih dirawat atau masuk sejak tengah malam WIB", async () => {
    await RawatInapPage({ searchParams: Promise.resolve({}) });
    expect(state.filters).toContainEqual({ table: "inpatient_records", op: "or", args: ['discharged_at.is.null,admitted_at.gte."2026-10-28T17:00:00.000Z"'] });
  });

  it("menghitung kartu dari baris yang dibaca", async () => {
    state.counterRows = [
      { condition_status: "kritis", admitted_at: "2026-10-20T02:00:00Z", discharged_at: null },
      { condition_status: "sembuh", admitted_at: "2026-10-28T18:00:00Z", discharged_at: null },
      { condition_status: "sembuh", admitted_at: "2026-10-28T20:00:00Z", discharged_at: "2026-10-29T01:00:00Z" },
    ];
    const text = renderToStaticMarkup(await RawatInapPage({ searchParams: Promise.resolve({}) })).replace(/<[^>]+>/g, "|");
    const kartu = (label: string) => text.split(label)[1]?.split("|").find(Boolean);
    // Masih dirawat 2, masuk hari ini (WIB) 2, sembuh belum pulang 1, kritis 1.
    expect([kartu("TOTAL RAWAT INAP"), kartu("RAWAT INAP HARI INI"), kartu("SEMBUH / BOLEH PULANG"), kartu("KRITIS")]).toEqual(["2", "2", "1", "1"]);
  });
});
