import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// U07: the inpatient log form starts its catalogue reads together with the stay read
// and sends the browser only the item fields the form uses.
const s = vi.hoisted(() => ({
  started: [] as string[], recGate: null as Promise<void> | null, rec: true, itemsThrow: false,
  formProps: null as null | Record<string, unknown>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm", () => ({ CatatanForm: (props: Record<string, unknown>) => { s.formProps = props; return <div>LOG FORM</div>; } }));
vi.mock("@/lib/service-performers-server", () => ({
  loadServiceStaff: async () => { s.started.push("serviceStaff"); return []; },
  loadBranchGroomingPolicy: async () => { s.started.push("grooming"); return { applies: false, doctorRequired: false }; },
}));
vi.mock("@/lib/dokter", () => ({ daftarDokter: async (_: unknown, k: { role: string }) => { s.started.push(`dokter:${k.role}`); return []; } }));
vi.mock("@/lib/katalog-racikan-server", () => ({
  loadKatalogRacikan: async () => { s.started.push("katalogRacikan"); return []; },
  bolehRacikKhusus: async () => { s.started.push("bolehRacik"); return false; },
}));
vi.mock("@/lib/inpatient-stay", () => ({ readStayTypesChecked: async () => { s.started.push("stay"); return { types: new Map(), failed: false }; } }));
vi.mock("@/lib/clinic-item-categories", async () => ({
  ...await vi.importActual<typeof import("@/lib/clinic-item-categories")>("@/lib/clinic-item-categories"),
  loadClinicItemCategories: async () => { s.started.push("categories"); return [{ id: "cat-jasa", name: "JASA" }]; },
}));
vi.mock("@/lib/clinic-compound-skus", () => ({
  loadClinicCompoundSkus: async () => { s.started.push("compoundSkus"); return [{ id: "mix", code: "MX", name: "Mix", unit: "btl", sell_price: 5, is_compound_material: false, item_type: "Persediaan", tindakan_kategori: null, category_id: null }]; },
  loadClinicSkuDetails: async (_: unknown, ids: string[], branchId: string | null) => {
    s.started.push(`skuDetails:${branchId}:${ids.length}`);
    return { stock: new Map([["drug", 7]]), units: new Map([["drug", [{ unit: "box", factor: 10, sell_price: 90, buy_price: 55 }]]]), prices: new Map(), warehouseId: "wh-vet" };
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => { s.started.push("user"); return { data: { user: { id: "actor" } } }; } },
  from(table: string) {
    const q = {
      select: () => q, eq: () => q, order: () => q, range: () => q,
      maybeSingle: async () => {
        s.started.push(table);
        if (s.recGate) await s.recGate;
        return { data: s.rec ? { id: "stay", condition_status: "stabil", doctor_name: "Drh", admitted_at: "2026-10-22T10:00:00Z", visit_id: "visit-a", visits: { created_at: "2026-10-22T08:00:00Z", branch_id: "branch-a", pets: { name: "Pet" }, customers: { name: "Owner" } } } : null, error: null };
      },
      then: (done: (v: unknown) => unknown, fail: (e: unknown) => unknown) => {
        s.started.push(table);
        if (s.itemsThrow) return Promise.reject(new Error("items transport failure")).then(done, fail);
        const data = [
          { id: "drug", code: "D1", upc: null, name: "Drug", unit: "tab", sell_price: 10, is_compound_material: true, item_type: "Persediaan", category_id: null, tindakan_kategori: null },
          { id: "service", code: null, upc: null, name: "Service", unit: "kali", sell_price: 20, is_compound_material: false, item_type: "Jasa", category_id: "cat-jasa", tindakan_kategori: "Grooming" },
        ];
        return Promise.resolve({ data, count: data.length, error: null }).then(done, fail);
      },
    };
    return q;
  },
}) }));
import Page from "@/app/(app)/klinik/rawat-inap/[id]/catatan/page";

const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "stay" }), searchParams: Promise.resolve({}) }));
beforeEach(() => {
  s.started = []; s.recGate = null; s.rec = true; s.itemsThrow = false; s.formProps = null;
  vi.spyOn(console, "info").mockImplementation(() => {});
});

it("starts catalogue, categories, compound catalogue, permission and stay-type reads before the stay record arrives", async () => {
  let release!: () => void;
  s.recGate = new Promise<void>((resolve) => { release = resolve; });
  const page = render();
  await vi.waitFor(() => expect(s.started).toEqual(expect.arrayContaining(
    ["user", "inpatient_records", "items", "categories", "compoundSkus", "katalogRacikan", "bolehRacik", "stay"])));
  // Branch-scoped reads wait for the stay's branch.
  expect(s.started.some((name) => name.startsWith("skuDetails") || name === "serviceStaff" || name.startsWith("dokter"))).toBe(false);
  release();
  expect(await page).toContain("LOG FORM");
  expect(s.started).toEqual(expect.arrayContaining(["serviceStaff", "dokter:doctor", "dokter:paramedic", "grooming", "skuDetails:branch-a:3"]));
  expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/^\[u07:catatanRawatInap\] stay rawatInap=\d+ms katalog=\d+ms total=\d+ms$/));
});

it("sends only the item fields the form uses, sharing one object per item across tabs", async () => {
  await render();
  const props = s.formProps as Record<string, Record<string, unknown>[]>;
  const drug = props.items.find((item) => item.id === "drug")!;
  expect(drug).toEqual({ id: "drug", code: "D1", name: "Drug", unit: "tab", sell_price: 10, stok: 7, item_type: "Persediaan",
    units: [{ unit: "tab", factor: 1, sell_price: 10 }, { unit: "box", factor: 10, sell_price: 90 }] });
  expect(props.bahanItems.find((item) => item.id === "drug")).toBe(drug);
  const service = props.jasaItems.find((item) => item.id === "service")!;
  expect(service).toMatchObject({ tindakan_kategori: "Grooming", item_type: "Jasa" });
  expect(service).not.toHaveProperty("code");
  expect(props.racikanItems.map((item) => item.id)).toEqual(["mix"]);
  for (const list of [props.items, props.jasaItems, props.tindakanItems, props.racikanItems, props.bahanItems]) {
    for (const item of list) {
      expect(item).not.toHaveProperty("category_id");
      expect(item).not.toHaveProperty("is_compound_material");
    }
  }
});

it("a missing stay is still not found, and an abandoned failing catalogue read does not leak", async () => {
  s.rec = false; s.itemsThrow = true;
  await expect(render()).rejects.toThrow("NOT_FOUND");
});

it("a failing catalogue read still fails the page instead of showing an empty catalogue", async () => {
  s.itemsThrow = true;
  await expect(render()).rejects.toThrow(/Barang klinik belum dapat dimuat lengkap/);
  expect(s.formProps).toBeNull();
});
