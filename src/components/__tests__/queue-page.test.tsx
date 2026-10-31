import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ all: false, authorized: true, fail: false, payment: false, inpatient: false, calls: [] as Array<[string, string, unknown]> }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(fixture.all ? { "x-kamo-operational-branch": "all" } : {}) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/operational-branch", () => ({
  resolveOperationalBranch: async () => fixture.authorized ? { id: "all", name: "Semua cabang" } : null,
  availableOperationalBranches: async () => [{ id: "branch-a", name: "Cabang A" }, { id: "branch-b", name: "Cabang B" }],
}));
vi.mock("@/lib/operational-branch-server", () => ({ requireOperationalBranch: async () => ({ id: "branch-a", name: "Cabang A" }) }));
vi.mock("@/app/(app)/klinik/antrian/LiveRefresh", () => ({ LiveRefresh: () => null }));
vi.mock("@/lib/tanggal", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/tanggal")>(), hariIniWIB: () => "2026-10-14" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "staff-a" } } }) },
  from(table: string) {
    let selection = "";
    const q = {
      select: (columns: string) => { selection = columns; return q; }, order: () => q,
      eq: (key: string, value: unknown) => { if (table === "visits") fixture.calls.push(["eq", key, value]); return q; },
      in: (key: string, value: unknown) => { fixture.calls.push(["in", key, value]); return q; },
      neq: () => q,
      gte: (key: string, value: unknown) => { fixture.calls.push(["gte", key, value]); return q; },
      lt: (key: string, value: unknown) => { fixture.calls.push(["lt", key, value]); return q; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: fixture.payment && table === "visits" && selection.includes("status") ? [{id:"visit-payment",status:"Pembayaran",created_at:"2026-10-14T01:00:00Z",poli:"Umum",inpatient_records:fixture.inpatient?[{id:"stay",discharged_at:null}]:[],pets:null,customers:null,branches:null}] : [], error: table === "visits" && fixture.fail ? { message: "private DB detail" } : null }).then(resolve),
    }; return q;
  },
}) }));
import Page from "@/app/(app)/klinik/antrian/page";
beforeEach(() => { fixture.calls = []; fixture.inpatient = false; fixture.payment = false; fixture.fail = false; fixture.all = false; fixture.authorized = true; });
async function render(params: Record<string, string> = {}) { return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) })); }
it("removes active inpatient from operational queue but preserves explicit all-history view", async () => {
 fixture.payment=true;fixture.inpatient=true;
 const active=await render();expect(active).not.toContain('href="/klinik/rekam-medis/visit-payment"');
 const history=await render({filter:"semua"});expect(history).toContain('href="/klinik/rekam-medis/visit-payment"');
});
it("reads each queue/counter under the same active branch and WIB date", async () => {
  const html = await render({ tanggal: "2026-10-14" });
  expect(fixture.calls.filter(([method, key, value]) => method === "in" && key === "branch_id" && Array.isArray(value) && value[0] === "branch-a")).toHaveLength(3);
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

it("shows all authorized clinic branches and keeps counters in the same scope", async () => {
  fixture.all = true;
  const html = await render();
  expect(html).toContain("Semua cabang");
  expect(html).toContain('name="cabang"');
  expect(fixture.calls.filter(([method, key, value]) => method === "in" && key === "branch_id" && JSON.stringify(value) === '["branch-a","branch-b"]')).toHaveLength(3);
});
it("filters all queue reads and preserves the selected branch in status links", async () => {
  fixture.all = true;
  const html = await render({ cabang: "branch-b" });
  expect(fixture.calls.filter(([method, key, value]) => method === "in" && key === "branch_id" && JSON.stringify(value) === '["branch-b"]')).toHaveLength(3);
  expect(html).toContain("cabang=branch-b");
});
it("rejects all-branch monitoring after permission is revoked", async () => {
  fixture.all = true; fixture.authorized = false;
  await expect(render()).rejects.toThrow("/mulai/cabang?mode=klinik");
  expect(fixture.calls).toHaveLength(0);
});

it("opens the existing medical record from a payment-stage queue row using its exact visit ID", async () => {
  fixture.payment = true; const html = await render();
  expect(html).toContain('href="/klinik/rekam-medis/visit-payment"');
  expect(html).toContain('Buka rekam medis');
  expect(html).toContain('href="/klinik/pembayaran/visit-payment"');
  expect(html).not.toContain('name="status" value="Diperiksa"');
});
