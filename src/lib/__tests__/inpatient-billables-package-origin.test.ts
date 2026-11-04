// BUG 1 Rawat Inap "Obat Khusus": asal paket (Grup) harus sampai ke clinic_add_inpatient_billables.
// Migration 20261106110000 sudah membuat clinic_add_inpatient_billables menerima package_item_id/package_qty.
import { expect, it, vi } from "vitest";
const rpcArgs = vi.hoisted(() => ({ calls: [] as { name: string; args: Record<string, unknown> }[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${href}`); } }));
vi.mock("@/lib/inpatient-stay", async () => ({ ...await vi.importActual<typeof import("@/lib/inpatient-stay")>("@/lib/inpatient-stay"),
  readStayTypesChecked: async () => ({ types: new Map([["stay", "sakit"]]), failed: false }) }));
vi.mock("@/lib/satuan", async () => ({ ...await vi.importActual<typeof import("@/lib/satuan")>("@/lib/satuan"),
  loadUnitOptions: async () => new Map([["10000000-0000-4000-8000-000000000002", [{ unit: "pcs", factor: 1, sell_price: 1, buy_price: 0 }]]]) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => { rpcArgs.calls.push({ name, args }); return { data: "ok", error: null }; },
  from() { const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: { condition_status: "stabil", visit_id: "visit", medical_record_id: "mr" }, error: null }) }; return q; },
}) }));
import { addInpatientBillables } from "../../app/(app)/klinik/rawat-inap/actions";
it("billables meneruskan package_item_id/package_qty ke clinic_add_inpatient_billables", async () => {
  const data = new FormData();
  data.set("recordId", "stay"); data.set("request_key", "rk"); data.set("entry_reason", "paket");
  data.set("resep", JSON.stringify([{ item_id: "10000000-0000-4000-8000-000000000002", nama_obat: "Spuit", qty: 2, satuan: "pcs", harga: 1, jenis: "obat",
    paket_id: "10000000-0000-4000-8000-000000000001", paket_qty: 1 }]));
  await addInpatientBillables(data);
  const call = rpcArgs.calls.find(c => c.name === "clinic_add_inpatient_billables")!;
  expect((call.args.p_rows as Record<string, unknown>[])[0]).toMatchObject({ package_item_id: "10000000-0000-4000-8000-000000000001", package_qty: 1 });
});
it("baris biasa tanpa asal paket tidak diberi package_item_id/package_qty", async () => {
  rpcArgs.calls.length = 0;
  const data = new FormData();
  data.set("recordId", "stay"); data.set("request_key", "rk2"); data.set("entry_reason", "obat");
  data.set("resep", JSON.stringify([{ item_id: "10000000-0000-4000-8000-000000000002", nama_obat: "Spuit", qty: 1, satuan: "pcs", harga: 1, jenis: "obat" }]));
  await addInpatientBillables(data);
  const row = (rpcArgs.calls.find(c => c.name === "clinic_add_inpatient_billables")!.args.p_rows as Record<string, unknown>[])[0];
  expect(row).not.toHaveProperty("package_item_id");
  expect(row).not.toHaveProperty("package_qty");
});
it("asal paket yang rusak ditolak sebelum RPC, bukan dibuang diam-diam", async () => {
  rpcArgs.calls.length = 0;
  const data = new FormData();
  data.set("recordId", "stay"); data.set("request_key", "rk3"); data.set("entry_reason", "paket");
  data.set("resep", JSON.stringify([{ item_id: "10000000-0000-4000-8000-000000000002", nama_obat: "Spuit", qty: 1, satuan: "pcs", harga: 1, jenis: "obat", paket_id: "bukan-uuid", paket_qty: 1 }]));
  await expect(addInpatientBillables(data)).rejects.toThrow(/REDIRECT .*Asal%20paket%20tidak%20valid/);
  expect(rpcArgs.calls.find(c => c.name === "clinic_add_inpatient_billables")).toBeUndefined();
});
