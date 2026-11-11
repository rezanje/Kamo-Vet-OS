import { beforeEach, expect, it, vi } from "vitest";

// C05 in clinic group payment ("pembayaran rombongan"): one arrival = one use of the campaign
// code. The discount is shared across the pets' invoices like a voucher, but the code itself
// rides on ONE invoice (posted first), so the database counts and caps it once.
const state = vi.hoisted(() => ({ posts: [] as { visit: string; invoice: Record<string, unknown>; lines: { description: string; promo_discount?: number }[] }[], capReached: false, kampanye: {} as Record<string, unknown> }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/tindakan", () => ({ bolehBayar: () => true, kategoriBerisiko: () => [] }));
vi.mock("@/lib/consent-server", () => ({ bacaAturanConsent: async () => [] }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({}), tambahPpn: (dpp: number) => ({ tax: 0, total: dpp }) }));
vi.mock("@/lib/clinic-payment", () => ({ resolveClinicSalesperson: async () => null }));
vi.mock("@/lib/poin-klinik", () => ({ RUPIAH_PER_POIN: 1, bacaPoinPelanggan: async () => ({ saldo: 0, rupiahPerPoin: null }), poinTerpakai: () => 0, catatPoinKlinik: async () => undefined, catatPoinNota: async () => undefined }));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: async () => true }));
vi.mock("@/lib/wa-engine", () => ({ kirimStrukWa: vi.fn() }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: async () => ({ customerId: "customer", customerName: "Owner",
  baris: [{ visitId: "pet-a", hewan: "Alpha", invoiceNo: null }, { visitId: "pet-b", hewan: "Beta", invoiceNo: null }] }) }));
// Pet A: Rp100.000 of item-a; pet B: Rp50.000 of item-b. The code's promo (20%) only covers item-b.
vi.mock("@/lib/tagihan-klinik", async (original) => ({ ...await original<typeof import("@/lib/tagihan-klinik")>(),
  barisTagihanVisit: async (_s: unknown, visitId: string): Promise<{ deskripsi: string; qty: number; harga: number; jenis: string; item_id: string; satuan: string | null }[]> => [visitId === "pet-a"
    ? { deskripsi: "Rawat A", qty: 1, harga: 100000, jenis: "jasa", item_id: "item-a", satuan: null }
    : { deskripsi: "Rawat B", qty: 1, harga: 50000, jenis: "jasa", item_id: "item-b", satuan: null }]
    .concat(visitId === "pet-b" ? [{ deskripsi: "Anthel Cat", qty: 1, harga: 18000, jenis: "obat", item_id: "item-anthel", satuan: "pcs" }] : []),
  hitungPotonganKlinik: async (_s: unknown, opts: { rows: { item_id: string; harga: number }[]; promoKampanyeId?: string | null }) => {
    const kena = opts.promoKampanyeId === "promo-b" && opts.rows.some((r) => r.item_id === "item-b");
    return { promo: kena ? 10000 : 0, voucher: 0, golongan: 0, total: kena ? 10000 : 0, tolakVoucher: null,
      rincianPromo: kena ? [{ item_id: "item-b", promo_id: "promo-b", promo_name: "Promo B", potongan: 10000 }] : [],
      ...(opts.promoKampanyeId ? { promoKampanyeTerpakai: kena, promoKampanyeTersedia: true } : {}) };
  } }));
const VOUCHER = { code: "HEMAT10", tipe: "persen", nilai: 10, is_active: true, valid_from: null, valid_until: null, max_potongan: null, min_belanja: 0, boleh_gabung_promo: true, customer_id: null, category_id: null };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "kasir" } } }) },
  from(table: string) {
    let key: unknown = null;
    let linked: unknown = null;
    const row = () => table === "campaign_codes" ? state.kampanye[key as string] ?? null
      : table === "vouchers" ? (key === "HEMAT10" ? VOUCHER : null)
      : table === "customers" ? { category_id: null }
      : table === "visits" ? { branch_id: "branch", customer_id: "customer", doctor_id: null, service_provider_id: null, poli: "Poli Umum" }
      : table === "invoices" ? { invoice_no: `INV-${key}` } : null;
    const q = {
      select: () => q, eq: (k: string, v: unknown) => { if (k === "code" || k === "id") key = v; if (k === "vouchers.code") linked = v; return q; },
      is: () => q, order: () => q, limit: () => q, in: () => q,
      maybeSingle: async () => ({ data: row(), error: null }),
      // Raw-voucher check (cekVoucherLewatKampanye): active campaign rows bound to this voucher.
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === "campaign_codes" && linked !== null
        ? Object.values(state.kampanye).filter((k) => { const r = k as { is_active: boolean; vouchers: { code: string } | null }; return r.is_active && r.vouchers?.code === linked; })
        : [], error: null }).then(resolve),
    };
    return q;
  },
  rpc: async (name: string, params: { p_visit_id: string; p_invoice: Record<string, unknown>; p_lines: { description: string; promo_discount?: number }[] }) => {
    // Pengaman keranjang basi (Klinik-D): versi dibaca server sebelum baris tagihan.
    if (name === "clinic_outpatient_cart_version") return { data: `v1:${"0".repeat(32)}`, error: null };
    if (name !== "clinic_post_invoice" && name !== "clinic_post_invoice_with_record") throw Error(`Unexpected RPC ${name}`);
    if (state.capReached && params.p_invoice.campaign_code) {
      return { data: null, error: { code: "P0001", message: `KODE_KAMPANYE: Kode ${params.p_invoice.campaign_code} sudah mencapai batas pemakaian (1 kali)` } };
    }
    state.posts.push({ visit: params.p_visit_id, invoice: params.p_invoice, lines: params.p_lines });
    return { data: `id-${params.p_visit_id}`, error: null };
  },
}) }));
import { bayarRombongan } from "../actions";

beforeEach(() => {
  state.posts = []; state.capReached = false;
  state.kampanye = { DISKON20: { code: "DISKON20", voucher_id: null, promo_id: "promo-b", is_active: true, max_uses: 1, vouchers: null } };
});
const pay = (code: string) => {
  const f = new FormData(); f.set("visitId", "visit"); f.set("requestKey", "group"); f.set("metode_bayar", "Tunai"); f.set("voucherCode", code);
  return bayarRombongan(f).then(() => "unexpected success", (e: Error) => decodeURIComponent(e.message));
};

it("pembayaran rombongan: potongan promo kampanye dikirim per baris hanya di baris barang yang kena promo (Anthel tidak)", async () => {
  expect(await pay("DISKON20")).toContain("success=rombongan");
  const petB = state.posts.find((p) => p.visit === "pet-b")!;
  expect(petB.invoice.discount).toBe(10000);
  expect(petB.lines.find((l) => l.description === "Rawat B")?.promo_discount).toBe(10000);
  expect("promo_discount" in petB.lines.find((l) => l.description === "Anthel Cat")!).toBe(false);
  // hewan yang tidak kena promo: tidak ada kunci promo_discount sama sekali
  const petA = state.posts.find((p) => p.visit === "pet-a")!;
  expect(petA.lines.every((l) => !("promo_discount" in l))).toBe(true);
});
