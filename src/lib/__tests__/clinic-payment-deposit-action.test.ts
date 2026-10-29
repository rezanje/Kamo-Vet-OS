import { beforeEach, describe, expect, it, vi } from "vitest";

// Tagihan pulang yang memakai deposit rawat inap. Yang dijaga di sini: layar tidak
// pernah menentukan berapa titipan yang dipotong, dan uang di meja tidak pernah
// dilaporkan lebih besar daripada sisa tagihan setelah deposit.
const state = vi.hoisted(() => ({
  calls: [] as { name: string; params: Record<string, unknown> }[],
  visitWrites: [] as unknown[],
  saldo: 0 as number | null,
  saldoReads: 0,
  inpatient: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/deposit-ranap-server", () => ({
  bacaSaldoDepositVisit: async () => { state.saldoReads += 1; return state.saldo; },
}));
vi.mock("@/lib/deposit-ranap", async () => await import("../deposit-ranap"));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "cashier" } } }) },
  from(table: string) {
    // `invoices` dibaca dua kali: per kunjungan (invoice aktif) dan per id setelah
    // posting. Hanya pembacaan per id yang boleh menemukan invoice.
    let byId = false;
    const q = {
      select: () => q, eq: (key: string) => { if (key === "id") byId = true; return q; },
      is: () => q, order: () => q, limit: () => q,
      update: (patch: unknown) => { if (table === "visits") state.visitWrites.push(patch); return q; },
      insert: () => q,
      maybeSingle: async () => ({
        data: table === "medical_records" ? { id: "record" }
          : table === "visits" ? { branch_id: "branch", customer_id: null, doctor_id: null, service_provider_id: null }
          : table === "inpatient_records" ? (state.inpatient ? { id: "inpat" } : null)
          : table === "invoices" ? (byId ? { invoice_no: "INV-0001" } : null)
          : null,
        error: null,
      }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return q;
  },
  rpc: async (name: string, params: Record<string, unknown>) => {
    state.calls.push({ name, params });
    return { data: "invoice", error: null };
  },
}) }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/tindakan", () => ({ bolehBayar: () => true, kategoriBerisiko: () => [] }));
vi.mock("@/lib/consent-server", () => ({ bacaAturanConsent: async () => [] }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/tanggal", async () => await import("../tanggal"));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({}), tambahPpn: (dpp: number) => ({ tax: 0, total: dpp }) }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: vi.fn() }));
vi.mock("@/lib/tagihan-klinik", () => ({
  nilaiBaris: (r: { qty: number; harga: number }) => r.qty * r.harga,
  hargaNetto: (r: { harga: number }) => r.harga,
  hitungPotonganKlinik: async () => ({ total: 0, tolakVoucher: null }),
  barisTagihanVisit: vi.fn(), bagiPotongan: vi.fn(),
}));
vi.mock("@/lib/voucher", () => ({ normalizeKode: () => "", pesanVoucherDitolak: vi.fn(), potonganVoucher: vi.fn() }));
vi.mock("@/lib/kode-kampanye", () => ({ bacaKodeKampanye: vi.fn() }));
vi.mock("@/lib/kas-akun", () => ({ kodeAkunBayar: async () => "1101", METODE_BAYAR: ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"] }));
vi.mock("@/lib/clinic-payment", () => ({ resolveClinicSalesperson: async () => null }));
vi.mock("@/lib/poin-klinik", () => ({
  bacaPoinPelanggan: async () => ({ saldo: 0, rupiahPerPoin: 1 }),
  catatPoinKlinik: vi.fn(), catatPoinNota: vi.fn(), poinTerpakai: () => 0, RUPIAH_PER_POIN: 1,
}));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: vi.fn() }));
vi.mock("@/lib/wa-engine", () => ({ kirimStrukWa: vi.fn() }));
vi.mock("@/lib/klinik-posting", async () => await import("../klinik-posting"));
import { bayarVisit } from "../../app/(app)/klinik/pembayaran/[visitId]/actions";

function form(patch: Record<string, string> = {}) {
  const f = new FormData();
  f.set("visitId", "visit"); f.set("requestKey", "request");
  f.set("items", JSON.stringify([{ deskripsi: "Rawat inap", qty: 1, harga: 500000, jenis: "jasa" }]));
  f.set("metode_bayar", "Tunai"); f.set("paid_status", "Belum Lunas"); f.set("cash_received", "0");
  for (const [k, v] of Object.entries(patch)) { if (v === "") f.delete(k); else f.set(k, v); }
  return f;
}
const posting = () => state.calls.find((c) => c.name.startsWith("clinic_post"));

beforeEach(() => { state.calls = []; state.visitWrites = []; state.saldo = 0; state.saldoReads = 0; state.inpatient = true; });

describe("tagihan pulang dengan deposit", () => {
  it("memakai RPC gabungan dan melaporkan hanya uang yang benar-benar diterima di meja", async () => {
    state.saldo = 300000;
    await expect(bayarVisit(form({ cash_received: "200000", paid_status: "Lunas" }))).resolves.toMatchObject({ saved: true });
    expect(posting()).toMatchObject({
      name: "clinic_post_invoice_with_deposit",
      params: { p_invoice: { total: 500000, cash_received: 200000 } },
    });
  });

  it("uang berlebih (kembalian) tidak pernah dilaporkan sebagai pembayaran", async () => {
    state.saldo = 300000;
    await expect(bayarVisit(form({ cash_received: "999999", finalize: "1" }))).resolves.toMatchObject({ saved: true });
    expect((posting()!.params.p_invoice as { cash_received: number }).cash_received).toBe(200000);
  });

  it("deposit yang menutup seluruh tagihan menyelesaikan kunjungan tanpa menerima uang lagi", async () => {
    state.saldo = 900000;
    await expect(bayarVisit(form())).resolves.toMatchObject({ saved: true });
    expect((posting()!.params.p_invoice as { cash_received: number }).cash_received).toBe(0);
    // Status kunjungan diselesaikan atomik di dalam RPC, bukan ditulis ulang di sini.
    expect(state.visitWrites).toEqual([]);
  });

  it("deposit sebagian tanpa uang tunai menyisakan kunjungan di tahap pembayaran", async () => {
    state.saldo = 100000;
    await expect(bayarVisit(form())).resolves.toMatchObject({ saved: true });
    expect(state.visitWrites).toEqual([{ status: "Pembayaran" }]);
  });

  it("tanpa deposit, jalur posting lama tidak berubah sama sekali", async () => {
    await expect(bayarVisit(form({ cash_received: "500000", finalize: "1" }))).resolves.toMatchObject({ saved: true });
    expect(posting()!.name).toBe("clinic_post_invoice");
    expect(posting()!.params.p_invoice).not.toHaveProperty("cash_received");
  });

  it("kunjungan tanpa rawat inap tidak pernah membaca saldo deposit", async () => {
    state.inpatient = false;
    await expect(bayarVisit(form({ cash_received: "500000", finalize: "1" }))).resolves.toMatchObject({ saved: true });
    expect(state.saldoReads).toBe(0);
    expect(posting()!.name).toBe("clinic_post_invoice");
  });

  it("saldo deposit yang tidak terbaca menghentikan pembayaran, bukan dianggap nol", async () => {
    state.saldo = null;
    await expect(bayarVisit(form({ cash_received: "500000", finalize: "1" }))).rejects.toThrow(/REDIRECT:.*error=/);
    expect(state.calls).toEqual([]);
  });

  it("deposit belum bisa digabung dengan pembayaran campuran", async () => {
    state.saldo = 300000;
    const data = form({ finalize: "1" });
    data.set("split_payments", JSON.stringify([{ method: "Tunai", amount: 200000 }, { method: "Transfer", amount: 300000 }]));
    await expect(bayarVisit(data)).rejects.toThrow(/pembayaran%20campuran/);
    expect(state.calls).toEqual([]);
  });

  it("deposit belum bisa digabung dengan aturan DEMO", async () => {
    state.saldo = 300000;
    await expect(bayarVisit(form({ demo_policy_id: "policy", finalize: "1" }))).rejects.toThrow(/aturan%20DEMO/);
    expect(state.calls).toEqual([]);
  });
});
