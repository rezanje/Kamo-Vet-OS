import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { roundTripClient, filterOf, paged, type Call } from "@/lib/__tests__/helpers/round-trip-client";

// BUG 1: halaman Rawat Inap "Obat Khusus" harus menawarkan barang tipe Grup (paket) di daftar Obat,
// dengan resep isinya dan stok = jumlah paket yang bisa dibuat (sama seperti Rekam Medis).
const s = vi.hoisted(() => ({ rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>, props: null as null | Record<string, unknown> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm", () => ({ CatatanForm: (props: Record<string, unknown>) => { s.props = props; return null; } }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ addDailyLogPos: vi.fn() }));
import { InpatientEntryPage } from "@/app/(app)/klinik/rawat-inap/[id]/InpatientEntryPage";

const item = (id: string, name: string, item_type: string, extra = {}) => ({ id, code: null, upc: null, name, unit: "pcs", sell_price: 5000,
  is_compound_material: false, item_type, tindakan_kategori: null, category_id: null, ...extra });
const catalogue = [
  item("grup-ok", "Paket Steril", "Grup", { unit: "paket", sell_price: 300000 }),
  item("grup-rusak", "Paket Rusak", "Grup", { unit: "paket" }),
  item("grup-kosong", "Paket Tanpa Resep", "Grup", { unit: "paket" }),
  item("spuit", "Spuit", "Persediaan"),
  item("jasa", "Jasa Steril", "Jasa", { unit: "x" }),
];
const komponen = (group: string, id: string, name: string, type: string, qty: number) => ({
  id: `${group}-${id}`, group_item_id: group, component_item_id: id, qty, unit: "pcs", factor: 1, sort_order: 1,
  items: { name: group === "grup-ok" ? "Paket Steril" : "Paket Rusak", is_active: true, item_type: "Grup" },
  component: { id, code: null, name, unit: "pcs", item_type: type, is_active: true, tindakan_kategori: null },
});
function respond(call: Call) {
  if (call.kind !== "from") return {};
  switch (call.name) {
    case "inpatient_records":
      return filterOf(call, "eq", "id") ? { data: { id: "stay", condition_status: "Stabil", doctor_name: "Drh", admitted_at: "2026-10-30T00:00:00Z", visit_id: "visit-a", visits: { created_at: "2026-10-30T00:00:00Z", branch_id: "branch-a", doctor_id: null, pets: { name: "Milo" }, customers: { name: "Pemilik" } } } } : { data: [] };
    case "items": return paged(call, call.ops.some(([op]) => op === "or") ? [] : catalogue);
    case "item_group_components": return paged(call, [
      komponen("grup-ok", "spuit", "Spuit", "Persediaan", 2), komponen("grup-ok", "jasa", "Jasa Steril", "Jasa", 1),
      { ...komponen("grup-rusak", "spuit", "Spuit", "Persediaan", 1), component: null },
    ] as never);
    case "stock": return paged(call, [{ id: "s1", item_id: "spuit", qty: 11 }] as never);
    case "profiles": return { data: { role: "DOCTOR", is_active: true } };
    case "warehouses": return { data: { id: "wh-a" } };
    case "branches": return { data: { type: "KLINIK" } };
    default: return undefined;
  }
}

it("Obat Khusus rawat inap menawarkan Grup utuh dengan resep dan stok = jumlah paket yang bisa dibuat", async () => {
  s.rt = roundTripClient(respond);
  renderToStaticMarkup(await InpatientEntryPage({ params: Promise.resolve({ id: "stay" }), mode: "billables" }));
  const items = s.props!.items as { id: string; item_type: string; stok: number | null; units: unknown[]; sell_price: number }[];
  const grup = items.find(row => row.id === "grup-ok");
  expect(grup, "Grup lengkap harus tampil di daftar Obat").toBeDefined();
  expect(grup).toMatchObject({ item_type: "Grup", stok: 5, units: [], sell_price: 300000 }); // 11 spuit / 2 per paket
  expect(items.map(row => row.id)).toContain("spuit");
  expect(items.map(row => row.id)).not.toContain("jasa");
  // Resep tidak utuh / tidak terbaca tidak boleh ditawarkan (apalagi jatuh jadi SKU biasa).
  expect(items.map(row => row.id)).not.toContain("grup-rusak");
  expect(items.map(row => row.id)).not.toContain("grup-kosong");
  const resep = s.props!.paketResep as Record<string, { komponen: { item_id: string }[] }>;
  expect(Object.keys(resep)).toEqual(["grup-ok"]);
  expect(resep["grup-ok"].komponen.map(k => k.item_id).sort()).toEqual(["jasa", "spuit"]);
  // Urutan master (nama) dipertahankan; Grup tidak masuk daftar BMHP/bahan.
  expect((s.props!.bahanItems as { id: string }[]).some(row => row.id === "grup-ok")).toBe(false);
});

it("gagal membaca paket = paket tidak ditawarkan, form Obat tetap berjalan", async () => {
  s.rt = roundTripClient(call => call.name === "item_group_components" ? { error: { message: "boom" } } : respond(call));
  renderToStaticMarkup(await InpatientEntryPage({ params: Promise.resolve({ id: "stay" }), mode: "billables" }));
  const items = s.props!.items as { id: string }[];
  expect(items.map(row => row.id)).toContain("spuit");
  expect(items.map(row => row.id)).not.toContain("grup-ok");
  expect(s.props!.paketResep).toEqual({});
});
