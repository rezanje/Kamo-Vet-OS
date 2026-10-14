import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ fail: false, calls: [] as Array<[string, string, unknown]> }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/operational-branch-server", () => ({ requireOperationalBranch: async () => ({ id: "branch-a", name: "Cabang A" }) }));
vi.mock("@/app/(app)/klinik/antrian/LiveRefresh", () => ({ LiveRefresh: () => null }));
vi.mock("@/lib/tanggal", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/tanggal")>(), hariIniWIB: () => "2026-10-14" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "staff-a" } } }) },
  from(table: string) {
    const q = {
      select: () => q, order: () => q,
      eq: (key: string, value: unknown) => { if (table === "visits") fixture.calls.push(["eq", key, value]); return q; },
      neq: () => q,
      gte: (key: string, value: unknown) => { fixture.calls.push(["gte", key, value]); return q; },
      lt: (key: string, value: unknown) => { fixture.calls.push(["lt", key, value]); return q; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: table === "visits" && fixture.fail ? { message: "private DB detail" } : null }).then(resolve),
    }; return q;
  },
}) }));
import Page from "@/app/(app)/klinik/antrian/page";
beforeEach(() => { fixture.calls = []; fixture.fail = false; });
async function render(params: Record<string, string> = {}) { return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) })); }
it("reads each queue/counter under the same active branch and WIB date", async () => {
  const html = await render({ tanggal: "2026-10-14" });
  expect(fixture.calls.filter(([method, key, value]) => method === "eq" && key === "branch_id" && value === "branch-a")).toHaveLength(3);
  expect(fixture.calls.filter(([method, , value]) => method === "lt" && value === "2026-10-14T17:00:00.000Z")).toHaveLength(3);
  expect(html).toContain('aria-label="Cabang aktif"'); expect(html).not.toContain("Semua cabang");
});
it("explains completed-filter emptiness and does not change status behind the user's back", async () => {
  const html = await render({ filter: "selesai" });
  expect(html).toContain("Pasien baru ada di tab Menunggu atau Aktif");
  expect(fixture.calls).toContainEqual(["eq", "status", "Selesai"]);
});
it("makes failed reads distinct from an empty queue and hides internal errors", async () => {
  fixture.fail = true; const html = await render();
  expect(html).toContain('role="alert"'); expect(html).toContain("Antrian gagal dimuat");
  expect(html).not.toContain("TOTAL ANTRIAN"); expect(html).not.toContain("Tidak ada pasien"); expect(html).not.toContain("private DB detail");
});
it("reports invalid date and stale branch links while keeping active branch isolation", async () => {
  const html = await render({ tanggal: "2026-02-30", cabang: "branch-b" });
  expect(html).toContain("Tanggal tidak valid"); expect(html).toContain("Filter cabang pada tautan berbeda");
  expect(fixture.calls).not.toContainEqual(["eq", "branch_id", "branch-b"]);
  expect(fixture.calls).toContainEqual(["gte", "created_at", "2026-10-13T17:00:00.000Z"]);
});
