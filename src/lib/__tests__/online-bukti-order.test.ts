import { beforeEach, expect, it, vi } from "vitest";

// Bukti order (screenshot Shopee / transfer) dilampirkan saat order online disimpan — Aldi 5 Nov 2026.
const state = vi.hoisted(() => ({
  rpc: vi.fn(), revalidate: vi.fn(),
  existing: [] as { path: string }[], readError: null as unknown, insertError: null as unknown,
  inserted: [] as Record<string, unknown>[], fromCalls: 0,
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: state.rpc,
    auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
    from(table: string) {
      state.fromCalls++;
      if (table !== "document_attachments") throw new Error(`Unexpected table ${table}`);
      const q = {
        select: () => q, eq: () => q, in: () => q,
        then: (ok: (v: unknown) => unknown) => ok({ data: state.existing, error: state.readError }),
        insert: async (rows: Record<string, unknown>[]) => { state.inserted.push(...rows); return { error: state.insertError }; },
      };
      return q;
    },
  }),
}));
import { buatPenjualanOnline } from "@/app/(app)/penjualan/online/actions";

const SALE = "00000000-0000-4000-8000-0000000000aa";
const bukti = (path: string) => ({ path, nama: "shopee.png", mime: "image/png", ukuran: 1234 });
function form(lampiran: unknown[] = []) {
  const f = new FormData();
  f.set("request_key", "online-key"); f.set("channel", "Shopee"); f.set("warehouse_id", "wh");
  f.set("items", JSON.stringify([{ item_id: "i", qty: 1, harga: 10, satuan: "pcs" }]));
  f.set("lampiran", JSON.stringify(lampiran));
  return f;
}
const pesan = async (f: FormData) => decodeURIComponent(await buatPenjualanOnline(f).then(() => "", (e: Error) => e.message));

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { existing: [], readError: null, insertError: null, inserted: [], fromCalls: 0 });
  state.rpc.mockResolvedValue({ data: { document_id: SALE, document_no: "ONL-1" }, error: null });
});

it("tanpa bukti: order tersimpan tanpa menyentuh tabel lampiran", async () => {
  expect(await pesan(form())).toContain("Order ONL-1 tersimpan.");
  expect(state.fromCalls).toBe(0);
});

it("bukti terlampir ke penjualan yang baru jadi (modul penjualan, pengunggah = pengguna)", async () => {
  const out = await pesan(form([bukti("penjualan-online/1-shopee.png")]));
  expect(out).toContain("1 bukti order terlampir");
  expect(state.inserted).toEqual([{ path: "penjualan-online/1-shopee.png", nama: "shopee.png", mime: "image/png", ukuran: 1234, modul: "penjualan", ref_id: SALE, uploaded_by: "actor" }]);
});

it("kirim ulang dengan kunci yang sama tidak menggandakan lampiran", async () => {
  state.existing = [{ path: "penjualan-online/1-shopee.png" }];
  await pesan(form([bukti("penjualan-online/1-shopee.png"), bukti("penjualan-online/2-transfer.png")]));
  expect(state.inserted.map((r) => r.path)).toEqual(["penjualan-online/2-transfer.png"]);
});

it("path di luar folder bukti order atau naik folder diabaikan", async () => {
  await pesan(form([bukti("pengeluaran/curian.png"), bukti("../x.png"), bukti("penjualan-online/ok.png")]));
  expect(state.inserted.map((r) => r.path)).toEqual(["penjualan-online/ok.png"]);
});

it("lampiran gagal dicatat: order tetap sah, operator diminta melampirkan lagi", async () => {
  state.insertError = { message: "boom" };
  const out = await pesan(form([bukti("penjualan-online/1-shopee.png")]));
  expect(out).toContain("success=");
  expect(out).toContain("Order ONL-1 tersimpan. Bukti order belum tercatat");
});

it("order gagal disimpan: lampiran tidak dicatat", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "Stok tidak cukup" } });
  expect(await pesan(form([bukti("penjualan-online/1-shopee.png")]))).toContain("Stok tidak cukup");
  expect(state.inserted).toEqual([]);
});
