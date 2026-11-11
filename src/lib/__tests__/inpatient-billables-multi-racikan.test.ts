// Anisa/Babibu 11 Nov: Obat Khusus rawat inap menolak keranjang berisi 2 racikan
// ("Simpan satu racikan per penambahan"). Database tetap satu racikan per transaksi;
// aksi server memecah keranjang menjadi simpanan berurutan dengan kunci turunan.
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], failAt: -1 }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${decodeURIComponent(href)}`); } }));
vi.mock("@/lib/inpatient-stay", async () => ({ ...await vi.importActual<typeof import("@/lib/inpatient-stay")>("@/lib/inpatient-stay"),
  readStayTypesChecked: async () => ({ types: new Map([["stay", "sakit"]]), failed: false }) }));
vi.mock("@/lib/satuan", async () => ({ ...await vi.importActual<typeof import("@/lib/satuan")>("@/lib/satuan"),
  loadUnitOptions: async () => new Map([["10000000-0000-4000-8000-000000000002", [{ unit: "pcs", factor: 1, sell_price: 1, buy_price: 0 }]]]) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name !== "clinic_add_inpatient_billables") return { data: true, error: null };
    const index = state.calls.push(args) - 1;
    return index === state.failAt
      ? { data: null, error: { code: "P0001", message: "STOCK_SHORT: Lacto-B (stok 1, butuh 4)" } }
      : { data: "entry", error: null };
  },
  from() { const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: { condition_status: "stabil", visit_id: "visit", medical_record_id: "mr" }, error: null }) }; return q; },
}) }));
import { addInpatientBillables } from "../../app/(app)/klinik/rawat-inap/actions";

const obat = { item_id: "10000000-0000-4000-8000-000000000002", nama_obat: "Spuit", qty: 1, satuan: "pcs", harga: 1, jenis: "obat" };
const racikan = (n: number) => ({ jenis: "racikan", nama_obat: `Obat Racik Probiotik ${n}`, qty: 1, harga: 50000, key: `rx-${n}`,
  official_version_id: `20000000-0000-4000-8000-00000000000${n}` });
function form(resep: unknown[]) {
  const data = new FormData();
  data.set("recordId", "stay"); data.set("request_key", "draft-key"); data.set("entry_reason", "Penambahan obat");
  data.set("resep", JSON.stringify(resep));
  return data;
}
beforeEach(() => { state.calls.length = 0; state.failAt = -1; });

it("keranjang 2 racikan + obat disimpan sebagai 2 simpanan berurutan, obat ikut simpanan pertama", async () => {
  const result = await addInpatientBillables(form([obat, racikan(1), racikan(2)]));
  expect(result.saved).toBe(true);
  expect(state.calls).toHaveLength(2);
  expect(state.calls.map(c => c.p_request_key)).toEqual(["draft-key", "draft-key:racikan-2"]);
  expect((state.calls[0].p_rows as unknown[])).toHaveLength(1);
  expect((state.calls[1].p_rows as unknown[])).toHaveLength(0);
  expect(state.calls.map(c => (c.p_compounds as { request_key: string }[]).map(x => x.request_key))).toEqual([["rx-1"], ["rx-2"]]);
});

it("satu racikan tetap satu simpanan dengan kunci draf asli (perilaku lama)", async () => {
  await addInpatientBillables(form([obat, racikan(1)]));
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0].p_request_key).toBe("draft-key");
  expect(state.calls[0].p_compounds as unknown[]).toHaveLength(1);
});

it("gagal di racikan kedua: berhenti, menyebut yang sudah masuk dan yang belum", async () => {
  state.failAt = 1;
  await expect(addInpatientBillables(form([racikan(1), racikan(2), racikan(3)])))
    .rejects.toThrow(/Obat Racik Probiotik 1 sudah masuk tagihan\. Obat Racik Probiotik 2 belum tersimpan/);
  expect(state.calls).toHaveLength(2);
});

it("gagal di simpanan pertama: pesan biasa, tidak lanjut ke racikan berikutnya", async () => {
  state.failAt = 0;
  await expect(addInpatientBillables(form([racikan(1), racikan(2)]))).rejects.toThrow(/REDIRECT/);
  expect(state.calls).toHaveLength(1);
});
