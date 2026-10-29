import { beforeEach, describe, expect, it, vi } from "vitest";

// Server action tagihan berjalan rawat inap. Database tetap pemegang aturan uangnya
// (tagih-sekali, alokasi, uang muka minimal, shift); yang diperiksa di sini adalah
// penyaring isian, pemetaan baris resep ke rincian tagihan, dan penerjemah errornya.
const state = vi.hoisted(() => ({
  calls: [] as { name: string; params: Record<string, unknown> }[],
  rpcError: null as { code?: string; message: string } | null,
  rpcData: "inv-1" as unknown,
  periode: null as string | null,
  shift: { id: "shift-1" } as { id: string } | null,
  resep: [] as Record<string, unknown>[],
  resepError: null as unknown,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => state.periode }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => state.shift }));
vi.mock("@/lib/pajak", async () => {
  const asli = await vi.importActual<typeof import("@/lib/pajak")>("@/lib/pajak");
  return { ...asli, getPajakSettings: async () => ({ mode_pkp: false, ppn_rate: 11 }) };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "kasir-1" } } }) },
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain, eq: chain, in: chain, order: chain, limit: chain,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(
          table === "medical_records"
            ? { data: [{ id: "mr-1" }], error: null }
            : { data: state.resep, error: state.resepError },
        ).then(resolve),
      });
      return q;
    },
    rpc: async (name: string, params: Record<string, unknown>) => {
      state.calls.push({ name, params });
      return { data: state.rpcError ? null : state.rpcData, error: state.rpcError };
    },
  }),
}));

import { batalkanKwitansi, tagihSekarang, terimaPembayaran } from "../actions";

const RECORD = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const BACK = `/klinik/rawat-inap/${RECORD}/tagihan`;

const barisResep = (id: string, patch: Record<string, unknown> = {}) => ({
  id, nama_obat: `Obat ${id}`, qty: 2, harga: 50_000, jenis: "obat", kategori: null,
  item_id: null, satuan: "tablet", compound_recipe_id: null, ...patch,
});

function formTagih(patch: Record<string, string> = {}) {
  const f = new FormData();
  f.set("recordId", RECORD); f.set("visitId", VISIT); f.set("requestKey", "key-1");
  f.set("ids", JSON.stringify(["p1"]));
  for (const [k, v] of Object.entries(patch)) { if (v === "") f.delete(k); else f.set(k, v); }
  return f;
}
function formBayar(patch: Record<string, string> = {}) {
  const f = new FormData();
  f.set("recordId", RECORD); f.set("visitId", VISIT); f.set("requestKey", "key-2");
  f.set("parts", JSON.stringify([{ method: "Tunai", amount: 120_000 }, { method: "QRIS", amount: 130_000 }]));
  for (const [k, v] of Object.entries(patch)) { if (v === "") f.delete(k); else f.set(k, v); }
  return f;
}
function formBatal(patch: Record<string, string> = {}) {
  const f = new FormData();
  f.set("recordId", RECORD); f.set("receiptId", "kwt-1");
  f.set("requestKey", "key-3"); f.set("reason", "Salah nominal");
  for (const [k, v] of Object.entries(patch)) { if (v === "") f.delete(k); else f.set(k, v); }
  return f;
}

beforeEach(() => {
  state.calls = []; state.rpcError = null; state.rpcData = "inv-1"; state.periode = null;
  state.shift = { id: "shift-1" }; state.resep = [barisResep("p1")]; state.resepError = null;
});

describe("tagih sekarang", () => {
  it("menagih pasien yang masih dirawat lewat RPC tahap, bukan jalur invoice tunggal", async () => {
    await expect(tagihSekarang(formTagih())).rejects.toThrow(`REDIRECT:${BACK}?success=tagih`);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].name).toBe("clinic_post_inpatient_stage_invoice");
    expect(state.calls[0].params).toMatchObject({
      p_visit_id: VISIT, p_request_key: "key-1",
      p_invoice: expect.objectContaining({ subtotal: 100_000, total: 100_000, paid_status: "Belum Lunas", dp_amount: 0, shift_id: "shift-1" }),
      p_lines: [expect.objectContaining({ description: "Obat p1", qty: 2, price: 50_000, prescription_item_id: "p1", unit: "tablet" })],
    });
  });

  it("hanya baris yang dicentang yang masuk tagihan tahap ini", async () => {
    state.resep = [barisResep("p1"), barisResep("p2")];
    await expect(tagihSekarang(formTagih({ ids: JSON.stringify(["p1", "p2"]) }))).rejects.toThrow("REDIRECT:");
    const lines = state.calls[0].params.p_lines as { prescription_item_id: string }[];
    expect(lines.map((l) => l.prescription_item_id)).toEqual(["p1", "p2"]);
  });

  it("mengirim kunci yang sama saat dicoba ulang — database yang menolak tagihan kedua", async () => {
    await expect(tagihSekarang(formTagih())).rejects.toThrow("REDIRECT:");
    await expect(tagihSekarang(formTagih())).rejects.toThrow("REDIRECT:");
    expect(state.calls.map((c) => c.params.p_request_key)).toEqual(["key-1", "key-1"]);
  });

  it("tidak ada yang dicentang: pesan ramah, tanpa menyentuh uang", async () => {
    await expect(tagihSekarang(formTagih({ ids: JSON.stringify([]) })))
      .rejects.toThrow(/Pilih%20minimal%20satu%20baris/);
    expect(state.calls).toEqual([]);
  });

  it("baris yang sudah berubah atau bukan milik kunjungan ini ditolak sebelum posting", async () => {
    state.resep = [];
    await expect(tagihSekarang(formTagih())).rejects.toThrow(/Muat%20ulang%20daftarnya/);
    expect(state.calls).toEqual([]);
  });

  it("tanpa shift klinik terbuka, kasir diarahkan membuka shift lebih dulu", async () => {
    state.shift = null;
    await expect(tagihSekarang(formTagih())).rejects.toThrow("REDIRECT:/klinik/shift?error=");
    expect(state.calls).toEqual([]);
  });

  it("periode yang sudah ditutup menghentikan penagihan", async () => {
    state.periode = "Periode akuntansi s/d 2026-09-30 sudah ditutup — tidak bisa posting tanggal ini.";
    await expect(tagihSekarang(formTagih())).rejects.toThrow(/sudah%20ditutup/);
    expect(state.calls).toEqual([]);
  });

  it("alasan penerobosan uang muka minimal ikut dikirim ke database", async () => {
    await expect(tagihSekarang(formTagih({ dp_override_reason: "Pemilik transfer besok" }))).rejects.toThrow("REDIRECT:");
    expect(state.calls[0].params.p_invoice).toMatchObject({ dp_override_reason: "Pemilik transfer besok" });
  });

  it("tanpa alasan, kolom penerobosan tidak dikirim sama sekali", async () => {
    await expect(tagihSekarang(formTagih())).rejects.toThrow("REDIRECT:");
    expect(state.calls[0].params.p_invoice).not.toHaveProperty("dp_override_reason");
  });

  it("penolakan uang muka minimal dari database ditampilkan apa adanya ke kasir", async () => {
    state.rpcError = { code: "P0001", message: "DP_MINIMAL: minimal 50% = Rp 50000, baru diterima Rp 0" };
    await expect(tagihSekarang(formTagih())).rejects.toThrow(/Uang%20muka%20belum%20cukup/);
  });

  it("baris yang sudah ditagih ditolak database dan diterjemahkan jelas", async () => {
    state.rpcError = { code: "P0001", message: "LINE_BILLED: Obat p1 sudah masuk tagihan aktif lain" };
    await expect(tagihSekarang(formTagih())).rejects.toThrow(/Baris%20resep%20sudah%20ditagih/);
  });
});

describe("terima pembayaran", () => {
  it("mengirim seluruh bagian metode apa adanya ke RPC kwitansi", async () => {
    await expect(terimaPembayaran(formBayar({ catatan: "DP pertama" }))).rejects.toThrow(`REDIRECT:${BACK}?success=bayar`);
    expect(state.calls[0]).toMatchObject({
      name: "clinic_receive_visit_payment",
      params: {
        p_visit_id: VISIT, p_request_key: "key-2", p_catatan: "DP pertama", p_invoice_id: null,
        p_parts: [{ method: "Tunai", amount: 120_000 }, { method: "QRIS", amount: 130_000 }],
      },
    });
  });

  it("tagihan yang dipilih kasir diteruskan supaya didahulukan", async () => {
    await expect(terimaPembayaran(formBayar({ invoice_id: "inv-2" }))).rejects.toThrow("REDIRECT:");
    expect(state.calls[0].params.p_invoice_id).toBe("inv-2");
  });

  it("mengirim kunci yang sama saat dicoba ulang — database yang menolak kwitansi kedua", async () => {
    await expect(terimaPembayaran(formBayar())).rejects.toThrow("REDIRECT:");
    await expect(terimaPembayaran(formBayar())).rejects.toThrow("REDIRECT:");
    expect(state.calls.map((c) => c.params.p_request_key)).toEqual(["key-2", "key-2"]);
  });

  it.each([
    ["tanpa bagian sama sekali", { parts: JSON.stringify([]) }],
    ["nominal nol", { parts: JSON.stringify([{ method: "Tunai", amount: 0 }]) }],
    ["nominal pecahan", { parts: JSON.stringify([{ method: "Tunai", amount: 1000.5 }]) }],
    ["metode di luar daftar", { parts: JSON.stringify([{ method: "Barter", amount: 1000 }]) }],
    ["lebih dari enam bagian", { parts: JSON.stringify(Array.from({ length: 7 }, () => ({ method: "Tunai", amount: 1000 }))) }],
    ["tanpa kunci permintaan", { requestKey: "" }],
  ])("menolak %s tanpa menyentuh uang", async (_label, patch) => {
    await expect(terimaPembayaran(formBayar(patch))).rejects.toThrow("?error=");
    expect(state.calls).toEqual([]);
  });

  it("tanpa shift klinik terbuka, uang tidak boleh diterima", async () => {
    state.shift = null;
    await expect(terimaPembayaran(formBayar())).rejects.toThrow("REDIRECT:/klinik/shift?error=");
    expect(state.calls).toEqual([]);
  });

  it("kelebihan uang tanpa data pemilik ditolak database dengan pesan yang bisa ditindaklanjuti", async () => {
    state.rpcError = { code: "P0001", message: "ADVANCE_INVALID: kelebihan uang tidak dapat disimpan tanpa data pemilik" };
    await expect(terimaPembayaran(formBayar())).rejects.toThrow(/Lengkapi%20data%20pelanggan/);
  });
});

describe("batalkan kwitansi", () => {
  it("meneruskan kwitansi, kunci, dan alasannya ke RPC pembalik", async () => {
    await expect(batalkanKwitansi(formBatal())).rejects.toThrow(`REDIRECT:${BACK}?success=batal`);
    expect(state.calls[0]).toMatchObject({
      name: "clinic_void_payment_receipt",
      params: { p_receipt_id: "kwt-1", p_request_key: "key-3", p_reason: "Salah nominal" },
    });
  });

  it.each([["tanpa alasan", { reason: "" }], ["tanpa kwitansi", { receiptId: "" }], ["tanpa kunci", { requestKey: "" }]])
    ("menolak %s tanpa membalik apa pun", async (_label, patch) => {
      await expect(batalkanKwitansi(formBatal(patch))).rejects.toThrow("?error=");
      expect(state.calls).toEqual([]);
    });

  it("peran di luar keuangan ditolak database, bukan hanya disembunyikan layar", async () => {
    state.rpcError = { code: "P0001", message: "ACCESS_DENIED: hanya OWNER, ADMIN, atau FINANCE boleh membatalkan kwitansi" };
    await expect(batalkanKwitansi(formBatal())).rejects.toThrow(/Akses%20cabang%20atau%20kunjungan%20tidak%20diizinkan/);
    expect(state.calls).toHaveLength(1);
  });

  it("uang muka yang sudah menempel di tagihan tidak bisa dibatalkan dari layar kwitansi", async () => {
    state.rpcError = { code: "P0001", message: "ADVANCE_USED: uang muka dari kwitansi ini sudah dipakai; batalkan tagihannya lebih dulu" };
    await expect(batalkanKwitansi(formBatal())).rejects.toThrow(/Batalkan%20tagihannya%20lebih%20dulu/);
  });

  it("tanpa shift klinik terbuka, kwitansi tidak bisa dibatalkan", async () => {
    state.shift = null;
    await expect(batalkanKwitansi(formBatal())).rejects.toThrow("REDIRECT:/klinik/shift?error=");
    expect(state.calls).toEqual([]);
  });
});
