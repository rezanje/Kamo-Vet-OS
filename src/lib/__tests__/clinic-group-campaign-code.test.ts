import { beforeEach, describe, expect, it, vi } from "vitest";

// C05 follow-up: a campaign code typed in the clinic group payment (rombongan) form.
// Real code parsing, voucher rules and proportional split; fictional database reads.
const state = vi.hoisted(() => ({
  calls: [] as { name: string; params: Record<string, unknown> }[],
  postError: {} as Record<string, string>,
  potonganOpts: [] as Record<string, unknown>[],
  promoCut: {} as Record<string, number>,
}));
const { KAMPANYE, VOUCHER } = vi.hoisted(() => ({
  KAMPANYE: {
    PROMO10: { code: "PROMO10", voucher_id: "v1", promo_id: null, is_active: true, max_uses: 2, vouchers: { code: "HEMAT10" } },
    DISKON20: { code: "DISKON20", voucher_id: null, promo_id: "p-kode", is_active: true, max_uses: 1, vouchers: null },
    MATI: { code: "MATI", voucher_id: "v1", promo_id: null, is_active: false, max_uses: null, vouchers: { code: "HEMAT10" } },
  } as Record<string, unknown>,
  VOUCHER: { code: "HEMAT10", tipe: "persen", nilai: 10, is_active: true, valid_from: null, valid_until: null, max_potongan: null,
    min_belanja: 0, boleh_gabung_promo: true, customer_id: null, category_id: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/tindakan", () => ({ bolehBayar: () => true, kategoriBerisiko: () => [] }));
vi.mock("@/lib/consent-server", () => ({ bacaAturanConsent: async () => [] }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({}), tambahPpn: (dpp: number) => ({ tax: 0, total: dpp }) }));
vi.mock("@/lib/clinic-payment", () => ({ resolveClinicSalesperson: async () => null }));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: vi.fn(async () => true) }));
vi.mock("@/lib/wa-engine", () => ({ kirimStrukWa: vi.fn() }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: async () => ({
  customerId: "owner-1", customerName: "Pemilik", tanggal: "2026-10-29",
  baris: [{ visitId: "pet-a", hewan: "Alpha", invoiceNo: null }, { visitId: "pet-b", hewan: "Beta", invoiceNo: null }],
}) }));
vi.mock("@/lib/tagihan-klinik", async (original) => ({
  ...await original<typeof import("@/lib/tagihan-klinik")>(),
  barisTagihanVisit: async (_s: unknown, visitId: string) => [{ deskripsi: `Jasa ${visitId}`, qty: 1,
    harga: visitId === "pet-a" ? 100000 : 50000, jenis: "jasa", item_id: "item", satuan: "pcs", prescription_item_id: "", recipe_id: null }],
  // Promo tujuan kode dipotong per hewan; tanpa kode tidak ada promo otomatis di fiksi ini.
  hitungPotonganKlinik: async (_s: unknown, opts: { promoKodeId?: string | null; rows: { harga: number }[] } & Record<string, unknown>) => {
    state.potonganOpts.push(opts);
    const cut = opts.promoKodeId ? state.promoCut[String(opts.rows[0].harga)] ?? 0 : 0;
    return { promo: cut, voucher: 0, golongan: 0, total: cut, tolakVoucher: null,
      ...(opts.promoKodeId ? { promoKode: { tersedia: true, potongan: cut } } : {}) };
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "doctor" } } }) },
  from(table: string) {
    let code: unknown = null;
    const q = {
      select: () => q, eq: (key: string, value: unknown) => { if (key === "code") code = value; return q; }, is: () => q, order: () => q, limit: () => q,
      insert: () => q, update: () => q,
      maybeSingle: async () => ({ error: null, data:
        table === "campaign_codes" ? KAMPANYE[code as string] ?? null
        : table === "vouchers" ? (code === "HEMAT10" ? VOUCHER : null)
        : table === "visits" ? { branch_id: "branch", customer_id: "owner-1", doctor_id: null, service_provider_id: null, poli: "Poli Umum" }
        : table === "customers" ? { points: 0, category_id: null, customer_categories: null }
        : table === "invoices" ? { invoice_no: "INV-FIKSI" } : null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return q;
  },
  rpc: async (name: string, params: Record<string, unknown>) => {
    state.calls.push({ name, params });
    const visit = String(params.p_visit_id ?? "");
    if (state.postError[visit]) return { data: null, error: { code: "P0001", message: state.postError[visit] } };
    return { data: `invoice-${visit}`, error: null };
  },
}) }));
import { bayarRombongan } from "../../app/(app)/klinik/pembayaran/[visitId]/actions";
import { hariIniWIB } from "../tanggal";

function groupForm(code: string, requestKey = "group-1") {
  const f = new FormData();
  f.set("visitId", "pet-a"); f.set("requestKey", requestKey); f.set("metode_bayar", "Tunai"); f.set("voucherCode", code);
  return f;
}
const posts = () => state.calls.filter((c) => c.name === "clinic_post_invoice");
const invoice = (i: number) => posts()[i].params.p_invoice as Record<string, unknown>;
const outcome = (code: string, key?: string) => bayarRombongan(groupForm(code, key)).then(() => "unexpected success", (e: Error) => decodeURIComponent(e.message));

beforeEach(() => { state.calls = []; state.postError = {}; state.potonganOpts = []; state.promoCut = {}; });

describe("campaign code in clinic group payment", () => {
  it("voucher-bound code: bound voucher split over both pets, every carrying invoice shares one owner/day group", async () => {
    expect(await outcome(" promo 10")).toContain("success=rombongan&lunas=2");
    expect(posts()).toHaveLength(2);
    const group = `owner-1:${hariIniWIB()}`;
    expect(invoice(0)).toMatchObject({ voucher_code: "HEMAT10", campaign_code: "PROMO10", campaign_group: group, discount: 10000, total: 90000 });
    expect(invoice(1)).toMatchObject({ voucher_code: "HEMAT10", campaign_code: "PROMO10", campaign_group: group, discount: 5000, total: 45000 });
    expect(state.potonganOpts.every((o) => !("promoKodeId" in o))).toBe(true);
  });

  it("retrying the same group payment sends identical invoices (same request keys, same group key)", async () => {
    await outcome("PROMO10");
    const first = posts().map((c) => c.params);
    state.calls = [];
    await outcome("PROMO10");
    expect(posts().map((c) => c.params)).toEqual(first);
    expect(first.map((p) => p.p_request_key)).toEqual(["group-1:pet-a", "group-1:pet-b"]);
  });

  it("promo-bound code: promo forced per pet; only invoices the promo actually cut carry the code, no voucher", async () => {
    state.promoCut = { "100000": 20000 };   // the promo targets only pet A's service
    expect(await outcome("diskon20")).toContain("success=rombongan&lunas=2");
    expect(state.potonganOpts.every((o) => o.promoKodeId === "p-kode")).toBe(true);
    expect(invoice(0)).toMatchObject({ voucher_code: null, campaign_code: "DISKON20", campaign_group: `owner-1:${hariIniWIB()}`, discount: 20000 });
    expect(invoice(1)).toMatchObject({ voucher_code: null, discount: 0 });
    expect(invoice(1)).not.toHaveProperty("campaign_code");
    expect(invoice(1)).not.toHaveProperty("campaign_group");
  });

  it("promo-bound code that cuts nothing in the whole group is refused before any invoice", async () => {
    expect(await outcome("DISKON20")).toContain("Kode DISKON20 belum memberi potongan");
    expect(posts()).toEqual([]);
  });

  it("inactive code is refused before any invoice", async () => {
    expect(await outcome("MATI")).toContain("Kode MATI sedang dinonaktifkan");
    expect(posts()).toEqual([]);
  });

  it("the database cap refusal is shown per pet and nothing is reported as paid", async () => {
    state.postError = { "pet-a": "KODE_KAMPANYE: Kode PROMO10 sudah mencapai batas pemakaian (2 kali)",
      "pet-b": "KODE_KAMPANYE: Kode PROMO10 sudah mencapai batas pemakaian (2 kali)" };
    const result = await outcome("PROMO10");
    expect(result).toContain("Tidak ada tagihan yang bisa diselesaikan sekaligus");
    expect(result).toContain("Alpha: Kode PROMO10 sudah mencapai batas pemakaian (2 kali)");
  });

  it("plain voucher codes keep their old behaviour: no campaign fields", async () => {
    expect(await outcome("hemat10")).toContain("success=rombongan&lunas=2");
    expect(invoice(0)).toMatchObject({ voucher_code: "HEMAT10", discount: 10000 });
    expect(invoice(0)).not.toHaveProperty("campaign_code");
    expect(invoice(0)).not.toHaveProperty("campaign_group");
  });
});
