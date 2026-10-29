import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  transfer: null as Record<string, unknown> | null,
  request: null as Record<string, unknown> | null,
  role: "ADMIN",
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/warehouse-stock", () => ({ loadWarehouseStock: async () => [] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "user-a" } } }) },
  rpc: state.rpc,
  from: (table: string) => {
    const data = table === "profiles" ? { role: state.role }
      : table === "stock_transfers" ? state.transfer : state.request;
    const query = {
      select: () => query, eq: () => query, in: () => query, order: () => query, range: () => query,
      single: async () => ({ data, error: null }),
      maybeSingle: async () => ({ data, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  },
}) }));

import { batalkanPengiriman } from "@/app/(app)/pos/pemindahan/actions";
import { batalkanPengirimanPermintaan } from "@/app/(app)/pos/permintaan/actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([k, v]) => data.set(k, v));
  return data;
}

async function jalankan(fn: (f: FormData) => Promise<void>, f: FormData) {
  try { await fn(f); return ""; } catch (error) { return decodeURIComponent((error as Error).message); }
}

const KUNCI = "11111111-2222-4333-8444-555555555555";
const KUNCI2 = "66666666-7777-4888-8999-aaaaaaaaaaaa";

const kirimForm = (extra: Record<string, string> = {}) =>
  form({ transfer_id: "trf-a", alasan: "salah barang", draft_key: KUNCI, ...extra });

beforeEach(() => {
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: { transfer_id: "trf-a", request_id: "req-a", already_cancelled: false }, error: null });
  state.role = "ADMIN";
  state.transfer = { proses: "Kirim Barang", status: "Sedang dikirim" };
  state.request = { status: "Dikirim" };
});

it("membatalkan pengiriman yang belum diterima, dengan alasan apa adanya", async () => {
  const tujuan = await jalankan(batalkanPengiriman, kirimForm());
  expect(state.rpc).toHaveBeenCalledWith("cancel_stock_transfer", {
    p_transfer_id: "trf-a", p_request_key: KUNCI, p_reason: "salah barang",
  });
  expect(tujuan).toContain("/pos/pemindahan/trf-a?success=");
  expect(tujuan).toContain("kembali ke gudang asal");
});

it("alasan kosong ditolak sebelum menyentuh database", async () => {
  const tujuan = await jalankan(batalkanPengiriman, kirimForm({ alasan: "  " }));
  expect(tujuan).toContain("Alasan pembatalan wajib diisi");
  expect(state.rpc).not.toHaveBeenCalled();
});

it("kiriman yang sudah diterima sebagian tidak bisa dibatalkan", async () => {
  state.transfer = { proses: "Kirim Barang", status: "Diterima Sebagian" };
  const tujuan = await jalankan(batalkanPengiriman, kirimForm());
  expect(tujuan).toContain("sudah diterima gudang tujuan");
  expect(state.rpc).not.toHaveBeenCalled();
});

it("dokumen Terima Barang tidak punya tombol batal", async () => {
  state.transfer = { proses: "Terima Barang", status: null };
  const tujuan = await jalankan(batalkanPengiriman, kirimForm());
  expect(tujuan).toContain("Hanya dokumen Kirim Barang");
  expect(state.rpc).not.toHaveBeenCalled();
});

it("kiriman ulang atas dokumen yang sudah dibatalkan dijawab database, bukan ditolak layar", async () => {
  state.transfer = { proses: "Kirim Barang", status: "Dibatalkan" };
  state.rpc.mockResolvedValue({ data: { transfer_id: "trf-a", already_cancelled: true }, error: null });
  const tujuan = await jalankan(batalkanPengiriman, kirimForm());
  expect(state.rpc).toHaveBeenCalled();
  expect(tujuan).toContain("sudah dibatalkan sebelumnya");
});

it("penolakan database (balapan dengan penerimaan) tetap sampai ke layar", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "Sebagian barang kiriman ini sudah diterima gudang tujuan" } });
  const tujuan = await jalankan(batalkanPengiriman, kirimForm());
  expect(tujuan).toContain("/pos/pemindahan/trf-a?error=");
  expect(tujuan).toContain("sudah diterima gudang tujuan");
});

it("tanpa kunci kiriman yang sah, pembatalan tidak pernah sampai ke database", async () => {
  const tujuan = await jalankan(batalkanPengiriman, kirimForm({ draft_key: "" }));
  expect(tujuan).toContain("Identitas pembatalan tidak lengkap");
  expect(state.rpc).not.toHaveBeenCalled();
});

it("permintaan Dikirim bisa dibatalkan pengirimannya dan kembali bisa dikirim", async () => {
  const tujuan = await jalankan(batalkanPengirimanPermintaan,
    form({ id: "req-a", alasan: "salah kirim", draft_key: KUNCI2 }));
  expect(state.rpc).toHaveBeenCalledWith("cancel_stock_request_shipment", {
    p_id: "req-a", p_request_key: KUNCI2, p_reason: "salah kirim",
  });
  expect(tujuan).toContain("/pos/permintaan/req-a?success=batal-kirim");
});

it("permintaan yang sudah Selesai tidak bisa dibatalkan pengirimannya", async () => {
  state.request = { status: "Selesai" };
  const tujuan = await jalankan(batalkanPengirimanPermintaan,
    form({ id: "req-a", alasan: "salah kirim", draft_key: KUNCI2 }));
  expect(tujuan).toContain("Hanya permintaan berstatus Dikirim");
  expect(state.rpc).not.toHaveBeenCalled();
});

it("kasir/staf tidak bisa membatalkan pengiriman permintaan", async () => {
  state.role = "STAFF";
  const tujuan = await jalankan(batalkanPengirimanPermintaan,
    form({ id: "req-a", alasan: "salah kirim", draft_key: KUNCI2 }));
  expect(tujuan).toContain("Hanya Kepala Gudang / Manajer yang bisa membatalkan pengiriman");
  expect(state.rpc).not.toHaveBeenCalled();
});
