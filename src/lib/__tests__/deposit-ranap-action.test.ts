import { beforeEach, describe, expect, it, vi } from "vitest";

// Server action deposit rawat inap. Database tetap pemegang aturan uangnya;
// yang diperiksa di sini adalah penyaring isian dan penerjemah errornya.
const state = vi.hoisted(() => ({
  calls: [] as { name: string; params: Record<string, unknown> }[],
  rpcError: null as { code?: string; message: string } | null,
  rpcData: "deposit-1" as unknown,
  periode: null as string | null,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => state.periode }));
vi.mock("@/lib/tanggal", async () => await import("../tanggal"));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, params: Record<string, unknown>) => {
      state.calls.push({ name, params });
      return { data: state.rpcError ? null : state.rpcData, error: state.rpcError };
    },
  }),
}));
import { batalkanDeposit, catatDeposit, kembalikanDeposit } from "../../app/(app)/klinik/rawat-inap/deposit-actions";

const RECORD = "11111111-1111-4111-8111-111111111111";
const DEPOSIT = "22222222-2222-4222-8222-222222222222";

function formCatat(patch: Record<string, string> = {}) {
  const f = new FormData();
  f.set("recordId", RECORD); f.set("request_key", "key-1");
  f.set("jumlah", "500000"); f.set("metode", "Tunai");
  for (const [k, v] of Object.entries(patch)) { if (v === "") f.delete(k); else f.set(k, v); }
  return f;
}
function formKelola(patch: Record<string, string> = {}) {
  const f = new FormData();
  f.set("recordId", RECORD); f.set("deposit_id", DEPOSIT);
  f.set("request_key", "key-2"); f.set("alasan", "Salah input");
  for (const [k, v] of Object.entries(patch)) { if (v === "") f.delete(k); else f.set(k, v); }
  return f;
}

beforeEach(() => { state.calls = []; state.rpcError = null; state.rpcData = "deposit-1"; state.periode = null; });

describe("catat deposit", () => {
  it("mengirim nominal, metode, dan kunci permintaan apa adanya ke RPC atomik", async () => {
    await expect(catatDeposit(formCatat({ catatan: "titipan kakak" }))).rejects.toThrow("REDIRECT:/klinik/rawat-inap/" + RECORD + "?success=deposit");
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({
      name: "clinic_record_inpatient_deposit",
      params: { p_record_id: RECORD, p_request_key: "key-1", p_amount: 500000, p_metode: "Tunai", p_catatan: "titipan kakak" },
    });
  });

  it("mengirim kunci yang sama saat dicoba ulang — database yang menolak deposit kedua", async () => {
    const data = formCatat();
    await expect(catatDeposit(data)).rejects.toThrow("REDIRECT:");
    await expect(catatDeposit(formCatat())).rejects.toThrow("REDIRECT:");
    expect(state.calls.map((c) => c.params.p_request_key)).toEqual(["key-1", "key-1"]);
  });

  it.each([
    ["nominal nol", { jumlah: "0" }],
    ["nominal negatif", { jumlah: "-1000" }],
    ["nominal bukan angka", { jumlah: "banyak" }],
    ["metode di luar daftar", { metode: "Barter" }],
    ["tanpa kunci permintaan", { request_key: "" }],
  ])("menolak %s tanpa menyentuh uang", async (_label, patch) => {
    await expect(catatDeposit(formCatat(patch))).rejects.toThrow("?error=");
    expect(state.calls).toEqual([]);
  });

  it("periode yang sudah ditutup menghentikan penerimaan uang", async () => {
    state.periode = "Periode akuntansi s/d 2026-09-30 sudah ditutup — tidak bisa posting tanggal ini.";
    await expect(catatDeposit(formCatat())).rejects.toThrow(/sudah%20ditutup/);
    expect(state.calls).toEqual([]);
  });

  it("tanpa shift klinik terbuka, kasir diberi tahu memulai shift lebih dulu", async () => {
    state.rpcError = { code: "P0001", message: "SHIFT_INVALID: shift klinik aktif tidak ditemukan" };
    await expect(catatDeposit(formCatat())).rejects.toThrow(/shift%20klinik/i);
  });

  it("pasien yang sudah pulang diarahkan ke layar pembayaran, bukan deposit baru", async () => {
    state.rpcError = { code: "P0001", message: "DEPOSIT_CLOSED: pasien sudah pulang" };
    await expect(catatDeposit(formCatat())).rejects.toThrow(/layar%20Pembayaran/);
  });

  it("akun tanpa hak ditolak dengan kalimat yang jelas", async () => {
    state.rpcError = { code: "P0001", message: "ACCESS_DENIED: akun tidak aktif" };
    await expect(catatDeposit(formCatat())).rejects.toThrow(/tidak%20berhak/);
  });

  it("respons tanpa id dianggap gagal — tidak ada pesan berhasil palsu", async () => {
    state.rpcData = null;
    await expect(catatDeposit(formCatat())).rejects.toThrow("?error=");
  });
});

describe("batal deposit", () => {
  it("meneruskan alasan dan kunci pembatalan", async () => {
    await expect(batalkanDeposit(formKelola())).rejects.toThrow("?success=depositbatal");
    expect(state.calls[0]).toMatchObject({
      name: "clinic_cancel_inpatient_deposit",
      params: { p_deposit_id: DEPOSIT, p_request_key: "key-2", p_reason: "Salah input" },
    });
  });
  it("tanpa alasan tidak pernah sampai ke database", async () => {
    await expect(batalkanDeposit(formKelola({ alasan: "" }))).rejects.toThrow("?error=");
    expect(state.calls).toEqual([]);
  });
  it("deposit yang sudah terpakai diarahkan ke void tagihan", async () => {
    state.rpcError = { code: "P0001", message: "DEPOSIT_USED: deposit sudah terpakai" };
    await expect(batalkanDeposit(formKelola())).rejects.toThrow(/void%20tagihan/i);
  });
  it("peran di luar pemilik/admin/keuangan ditolak database dan dilaporkan apa adanya", async () => {
    state.rpcError = { code: "P0001", message: "ACCESS_DENIED: pembatalan deposit hanya untuk pemilik, admin, atau keuangan" };
    await expect(batalkanDeposit(formKelola())).rejects.toThrow(/tidak%20berhak/);
  });
});

describe("kembalikan sisa deposit", () => {
  it("meneruskan alasan pengembalian", async () => {
    await expect(kembalikanDeposit(formKelola())).rejects.toThrow("?success=depositkembali");
    expect(state.calls[0]).toMatchObject({ name: "clinic_refund_inpatient_deposit", params: { p_reason: "Salah input" } });
  });
  it("tanpa alasan ditolak di aplikasi", async () => {
    await expect(kembalikanDeposit(formKelola({ alasan: "" }))).rejects.toThrow("?error=");
    expect(state.calls).toEqual([]);
  });
  it("deposit tanpa sisa dilaporkan jelas", async () => {
    state.rpcError = { code: "P0001", message: "DEPOSIT_EMPTY: tidak ada sisa" };
    await expect(kembalikanDeposit(formKelola())).rejects.toThrow(/sisa%20deposit/);
  });
  it("id deposit yang bukan uuid tidak diteruskan", async () => {
    await expect(kembalikanDeposit(formKelola({ deposit_id: "bukan-uuid" }))).rejects.toThrow("?error=");
    expect(state.calls).toEqual([]);
  });
});
