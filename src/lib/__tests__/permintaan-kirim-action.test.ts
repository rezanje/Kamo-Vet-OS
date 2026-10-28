import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  stok: [] as { id: string; warehouse_id: string; item_id: string; qty: number }[],
  request: null as Record<string, unknown> | null,
  role: "ADMIN",
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/warehouse-stock", () => ({ loadWarehouseStock: async () => state.stok }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "user-a" } } }) },
  rpc: state.rpc,
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, in: () => query, order: () => query, range: () => query,
      single: async () => ({
        data: table === "profiles" ? { role: state.role } : state.request,
        error: null,
      }),
      maybeSingle: async () => ({
        data: table === "profiles" ? { role: state.role } : state.request,
        error: null,
      }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  },
}) }));

import { kirimPermintaan, updateRequestStatus } from "@/app/(app)/pos/permintaan/actions";

const baris = (p: Record<string, unknown>) => ({
  id: "l1", item_id: "item-a", nama: "Obat A", satuan: "pcs", faktor: 1,
  qty_diminta: 500, qty_disetujui: 500, qty_dikirim: null, ...p,
});

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ id: "req-a", ...values }).forEach(([k, v]) => data.set(k, v));
  return data;
}

async function jalankan(fn: (f: FormData) => Promise<void>, f: FormData) {
  try { await fn(f); return ""; } catch (error) { return decodeURIComponent((error as Error).message); }
}

beforeEach(() => {
  state.rpc.mockReset(); state.rpc.mockResolvedValue({ data: null, error: null });
  state.role = "ADMIN";
  state.stok = [{ id: "s1", warehouse_id: "dc-a", item_id: "item-a", qty: 250 }];
  state.request = { status: "Disetujui", to_warehouse_id: "dc-a", stock_request_items: [baris({})] };
});

it("menolak kiriman 500 pcs saat gudang hanya punya 250 — sebelum RPC dipanggil", async () => {
  const tujuan = await jalankan(kirimPermintaan, form({ qty_l1: "500" }));
  expect(tujuan).toContain("/pos/permintaan/req-a?error=");
  expect(tujuan).toContain("Obat A butuh 500 pcs, tersedia 250 pcs");
  expect(state.rpc).not.toHaveBeenCalled();
});

it("mengirim sebanyak stok yang ada bila petugas memakai angka usulan", async () => {
  const tujuan = await jalankan(kirimPermintaan, form());
  expect(state.rpc).toHaveBeenCalledWith("ship_stock_request_atomic", {
    p_id: "req-a", p_rows: [{ id: "l1", qty: 250 }],
  });
  expect(tujuan).toContain("success=kirim");
});

it("kiriman sebagian di bawah stok tetap diteruskan apa adanya", async () => {
  const tujuan = await jalankan(kirimPermintaan, form({ qty_l1: "100" }));
  expect(state.rpc).toHaveBeenCalledWith("ship_stock_request_atomic", {
    p_id: "req-a", p_rows: [{ id: "l1", qty: 100 }],
  });
  expect(tujuan).toContain("success=kirim");
});

it("stok minus di gudang pengirim dianggap nol, bukan boleh dikirim", async () => {
  state.stok = [{ id: "s1", warehouse_id: "dc-a", item_id: "item-a", qty: -10 }];
  const tujuan = await jalankan(kirimPermintaan, form({ qty_l1: "1" }));
  expect(tujuan).toContain("tersedia 0 pcs");
  expect(state.rpc).not.toHaveBeenCalled();
});

it("penolakan dari database (balapan dua kiriman) tetap sampai ke layar", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "Stok gudang pengirim tidak cukup. Obat A butuh 250 pcs, tersedia 0 pcs" } });
  const tujuan = await jalankan(kirimPermintaan, form());
  expect(tujuan).toContain("Stok gudang pengirim tidak cukup");
  expect(tujuan).toContain("/pos/permintaan/req-a?error=");
});

it("hanya permintaan Disetujui yang bisa dikirim", async () => {
  state.request = { status: "Menunggu Persetujuan", to_warehouse_id: "dc-a", stock_request_items: [baris({})] };
  const tujuan = await jalankan(kirimPermintaan, form());
  expect(tujuan).toContain("Hanya permintaan Disetujui yang bisa dikirim");
  expect(state.rpc).not.toHaveBeenCalled();
});

it("kasir/staf tidak bisa mengirim", async () => {
  state.role = "STAFF";
  const tujuan = await jalankan(kirimPermintaan, form());
  expect(tujuan).toContain("Hanya Kepala Gudang / Manajer yang bisa mengirim");
  expect(state.rpc).not.toHaveBeenCalled();
});

it("tombol status lama tidak bisa lagi menandai Dikirim tanpa memeriksa stok", async () => {
  const tujuan = await jalankan(updateRequestStatus, form({ status: "Dikirim" }));
  expect(tujuan).toContain("Pengiriman dicatat lewat layar Kirim barang");
  expect(state.rpc).not.toHaveBeenCalled();
});
