import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), writes: [] as unknown[] }));
const db = {
  rpc: fixture.rpc,
  from() {
    const q = { update(v: unknown) { fixture.writes.push(v); return q; }, select() { return q; }, eq() { return q; } };
    return q;
  },
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
vi.mock("@/lib/posting", () => ({ postJournal: async (...a: unknown[]) => { fixture.writes.push(a); } }));
vi.mock("@/lib/kas-akun", () => ({ kodeAkunBayar: async () => "120002" }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { cairkanSekaligus } from "@/app/(app)/penjualan/online/actions";

const form = (extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.append("sale_id", "s1"); f.append("sale_id", "s2");
  Object.entries({ nominal: "170000", tanggal: "2026-11-05", account_id: "rek-bca", request_key: "k1", ...extra })
    .forEach(([k, v]) => f.set(k, v));
  return f;
};

beforeEach(() => { fixture.rpc.mockReset(); fixture.writes = []; });

it("posts all selected orders through the single atomic RPC and reports the result", async () => {
  fixture.rpc.mockResolvedValue({ data: { reference: "CAIR-20261105-001", orders: 2, channel: "Shopee", nominal: 170000, komisi: 13333 }, error: null });
  await expect(cairkanSekaligus(form())).rejects.toThrow("success=");
  expect(fixture.rpc).toHaveBeenCalledWith("online_disburse_batch", {
    p_request_key: "k1", p_sale_ids: ["s1", "s2"], p_nominal: 170000, p_tanggal: "2026-11-05", p_account_id: "rek-bca",
  });
  expect(fixture.writes).toEqual([]);
});

it("passes no rekening when the form leaves it on the payment map", async () => {
  fixture.rpc.mockResolvedValue({ data: { reference: "R", orders: 2, channel: "Shopee", nominal: 1, komisi: 0 }, error: null });
  await expect(cairkanSekaligus(form({ account_id: "" }))).rejects.toThrow("success=");
  expect(fixture.rpc).toHaveBeenCalledWith("online_disburse_batch", expect.objectContaining({ p_account_id: null }));
});

it("shows the database refusal and never writes outside the RPC", async () => {
  fixture.rpc.mockResolvedValue({ data: null, error: { message: "Ada order yang sudah dicairkan. Muat ulang halaman." } });
  await expect(cairkanSekaligus(form())).rejects.toThrow("error=");
  expect(fixture.writes).toEqual([]);
});

it.each([
  ["no order ticked", (f: FormData) => f.delete("sale_id")],
  ["empty amount", (f: FormData) => f.set("nominal", "")],
  ["zero amount", (f: FormData) => f.set("nominal", "0")],
  ["missing request key", (f: FormData) => f.set("request_key", "")],
])("rejects %s before calling the database", async (_label, mutate) => {
  const f = form(); mutate(f);
  await expect(cairkanSekaligus(f)).rejects.toThrow("error=");
  expect(fixture.rpc).not.toHaveBeenCalled();
});
