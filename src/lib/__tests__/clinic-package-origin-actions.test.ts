import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// Real public actions and all business helpers run. Only the external Supabase
// transport and Next's runtime navigation/cache effects are replaced; no DB proof.
const state = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  selects: [] as { table: string; columns: string }[],
  prescriptions: [] as Record<string, unknown>[],
  error: null as { code: string; message: string } | null,
}));
vi.mock("next/navigation", () => ({ redirect: (href: string): never => { throw Error(`REDIRECT ${href}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fictional-user" } } }) },
  from(table: string) {
    const response = () => ({ data: table === "employees" ? { id: "doctor", nama: "Fictional doctor" }
      : table === "visits" ? { poli: "Poli Umum" }
      : table === "items" ? [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", unit: "pcs", sell_price: 100 }]
      : table === "medical_records" ? [{ id: "record" }]
      : table === "prescription_items" ? state.prescriptions
      : table === "cashier_shifts" ? { id: "shift", branches: null }
      : table === "company_settings" ? { mode_pkp: false, ppn_rate: 11 }
      : table === "accounting_locks" ? { closed_until: null } : [], error: null });
    const q = { select(columns: string) { state.selects.push({ table, columns }); return q; },
      eq() { return q; }, in() { return q; }, order() { return q; }, range() { return q; },
      maybeSingle: async () => response(), then(resolve: (value: unknown) => unknown) { return Promise.resolve(response()).then(resolve); } };
    return q;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args }); return { data: name.startsWith("clinic_edit_") ? "record" : true, error: state.error };
  },
}) }));
import { simpanRekamMedis, tambahItemRekamMedis, koreksiRekamMedisLengkap } from "@/app/(app)/klinik/rekam-medis/[visitId]/actions";
import { tagihSekarang } from "@/app/(app)/klinik/rawat-inap/[id]/tagihan/actions";

const PACKAGE = "ABCDEF12-abcd-4abc-8abc-abcdef123456";
const item = { item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nama_obat: "Explicit component", qty: 2, harga: 100, satuan: "pcs", jenis: "jasa", kategori: "Operasi" };
const ordinary = { nama_obat: item.nama_obat, item_id: item.item_id, qty: 2, satuan: "pcs", faktor: 1, harga: 100, aturan_pakai: null, jenis: "jasa", kategori: "Operasi" };
const queued = { prescription_item_id: null, item_id: item.item_id, nama_obat: item.nama_obat, qty: 2, harga: 100, satuan: "pcs", jenis: "jasa", kategori: "Operasi", aturan_pakai: null, compound_recipe_id: null, bmhp_components: [], service_performers: null };
function form(rows: unknown[]) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ visitId: "visit", petId: "pet", medical_record_id: "record", expected_revision: "0", correction_reason: "Fictional correction", request_key: "literal-key", doctor_id: "doctor", keluhan: "Fictional complaint",anamnesis: "Fictional history", gejala_klinis: "Fictional finding", diagnosis: "Fictional diagnosis",  resep: JSON.stringify(rows) })) f.set(k, v);
  return f;
}
const routes = [
  ["initial", simpanRekamMedis, "clinic_save_initial_record", "p_rows", ordinary],
  ["add", tambahItemRekamMedis, "clinic_add_record_items", "p_items", ordinary],
  ["queued", koreksiRekamMedisLengkap, "clinic_edit_queued_record_with_compounds", "p_rows", queued],
] as const;
beforeEach(() => { state.calls = []; state.selects = []; state.prescriptions = []; state.error = null; });

it.each(routes)("%s forwards explicit UI aliases without changing the literal UUID", async (_label, action, rpc, field, baseline) => {
  await expect(action(form([{ ...item, paket_id: PACKAGE, paket_qty: 2 }]))).resolves.toMatchObject({ saved: true });
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0].name).toBe(rpc);
  expect(state.calls[0].args[field]).toEqual([{ ...baseline, package_item_id: PACKAGE, package_qty: 2 }]);
});
it.each(routes)("%s keeps exact legacy row keys and repeat request fingerprint", async (_label, action, _rpc, field, baseline) => {
  await action(form([item]));
  expect(state.calls[0].args[field]).toEqual([baseline]);
  const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const first = fingerprint(state.calls[0]);
  await action(form([item]));
  expect(fingerprint(state.calls[1])).toBe(first);
  expect(state.calls[0].args[field]).not.toEqual([expect.objectContaining({ package_item_id: null })]);
});
const invalidOrigins = [
  { paket_id: PACKAGE }, { paket_qty: 2 }, { paket_id: ` ${PACKAGE}`, paket_qty: 2 },
  { paket_id: PACKAGE, paket_qty: "2" }, { paket_id: PACKAGE, paket_qty: 1.5 },
  { package_item_id: PACKAGE, package_qty: 2, paket_id: PACKAGE.toLowerCase(), paket_qty: 2 },
  { package_item_id: PACKAGE, package_qty: 2, paket_id: PACKAGE, paket_qty: 3 },
  { item_id: null, paket_id: PACKAGE, paket_qty: 2 },
  { nama_obat: " ", paket_id: PACKAGE, paket_qty: 2 },
  { jenis: "racikan", official_version_id: "formula", paket_id: PACKAGE, paket_qty: 2 },
];
for (const [label, action] of routes) {
  it.each(invalidOrigins)(`${label} rejects invalid origin before any RPC: %j`, async origin => {
    await expect(action(form([{ ...item, ...origin }]))).rejects.toThrow(/^REDIRECT .*error=/);
    expect(state.calls).toEqual([]);
  });
  it(`${label} forwards canonical origin and keeps an unrelated same-SKU sale untagged`, async () => {
    await action(form([{ ...item, package_item_id: PACKAGE, package_qty: 2 }, item]));
    const field = label === "add" ? "p_items" : "p_rows";
    const rows = state.calls[0].args[field] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ package_item_id: PACKAGE, package_qty: 2 });
    expect(rows[1]).not.toHaveProperty("package_item_id");
  });
}
function stageForm() {
  const f = new FormData();
  for (const [k, v] of Object.entries({ recordId: "stay", visitId: "visit", requestKey: "literal-stage-key", ids: '["prescription"]' })) f.set(k, v);
  return f;
}
it("legacy tagihSekarang selects durable origin and forwards it, ignoring form origin claims", async () => {
  state.prescriptions = [{ ...item, id: "prescription", package_item_id: PACKAGE, package_qty: 2 }];
  const f = stageForm(); f.set("package_item_id", "forged");
  await expect(tagihSekarang(f)).rejects.toThrow("?success=tagih");
  expect(state.selects.find(q => q.table === "prescription_items")?.columns.split(", ")).toEqual(expect.arrayContaining(["package_item_id", "package_qty"]));
  expect(state.calls[0]).toMatchObject({ name: "clinic_post_inpatient_stage_invoice", args: { p_lines: [{ description: item.nama_obat, qty: 2, price: 100, kind: "jasa", item_id: item.item_id, unit: "pcs", prescription_item_id: "prescription", recipe_id: null, discount_percent: 0, package_item_id: PACKAGE, package_qty: 2 }] } });
});
it.each([
  { package_item_id: PACKAGE }, { package_qty: 2 },
  { package_item_id: ` ${PACKAGE}`, package_qty: 2 },
  { package_item_id: PACKAGE, package_qty: "2" },
  { package_item_id: PACKAGE, package_qty: 1.5 },
  { item_id: null, package_item_id: PACKAGE, package_qty: 2 },
  { compound_recipe_id: "recipe", package_item_id: PACKAGE, package_qty: 2 },
])("legacy stage refuses malformed durable metadata before posting: %j", origin => {
  state.prescriptions = [{ ...item, id: "prescription", ...origin }];
  return expect(tagihSekarang(stageForm())).rejects.toThrow("error=").then(() => { expect(state.calls).toEqual([]); });
});
it.each(routes)("%s leaves database authority errors intact", async (_label, action) => {
  state.error = { code: "P0001", message: "CART_INVALID: fictional authoritative recipe mismatch" };
  await expect(action(form([{ ...item, paket_id: PACKAGE, paket_qty: 2 }]))).rejects.toThrow("error=");
  expect(state.calls).toHaveLength(1);
});
it("legacy stage keeps exact untagged line shape even when the DB returns paired NULLs", async () => {
  state.prescriptions = [{ ...item, id: "prescription", package_item_id: null, package_qty: null }];
  await expect(tagihSekarang(stageForm())).rejects.toThrow("?success=tagih");
  expect(state.calls[0].args.p_lines).toEqual([{ description: item.nama_obat, qty: 2, price: 100, kind: "jasa", item_id: item.item_id, unit: "pcs", prescription_item_id: "prescription", recipe_id: null, discount_percent: 0 }]);
});
