import { beforeEach, expect, it, vi } from "vitest";

// Cermin TypeScript dari jangkar SQL pada migrasi 20261031170000: pembayaran
// klinik harus MENGIRIM atribusi per program (promo per baris, voucher dan
// diskon golongan di kepala invoice), dan koreksi tidak boleh mengirimnya —
// database yang membawa atribusi lama supaya jejaknya tidak hilang (audit S-4).

const state = vi.hoisted(() => ({ existing: false, calls: [] as { name: string; params: Record<string, unknown> }[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    const invoice = { id: "invoice", visit_id: "visit", invoice_no: "INV-1", request_key: "original",
      subtotal: 100, discount: 0, tax: 0, total: 100, dp_amount: 0, paid_status: "Belum Lunas",
      metode_bayar: "Tunai", voucher_code: null, correction_pending: false, service_pricing_version: 1, salesperson_id: null };
    const q = {
      select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => q, update: () => q, insert: () => q,
      maybeSingle: async () => ({ data: table === "medical_records" ? { id: "record" }
        : table === "visits" ? { branch_id: "branch", customer_id: null, doctor_id: null, service_provider_id: null }
        : table === "invoices" ? (state.existing ? invoice : state.calls.length ? { invoice_no: "INV-1" } : null) : null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return q;
  },
  rpc: async (name: string, params: Record<string, unknown>) => {
    state.calls.push({ name, params });
    return { data: name.includes("post") ? "invoice" : null, error: null };
  },
}) }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/tindakan", () => ({ bolehBayar: () => true, kategoriBerisiko: () => [] }));
vi.mock("@/lib/consent-server", () => ({ bacaAturanConsent: async () => [] }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({}), tambahPpn: (dpp: number) => ({ tax: 0, total: dpp }) }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: vi.fn() }));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: vi.fn() }));
vi.mock("@/lib/wa-engine", () => ({ kirimStrukWa: vi.fn() }));
vi.mock("@/lib/voucher", async original => ({ ...await original<typeof import("../voucher")>(), normalizeKode: () => "HEMAT" }));
vi.mock("@/lib/tagihan-klinik", async original => ({
  ...await original<typeof import("../tagihan-klinik")>(),
  barisTagihanVisit: vi.fn(),
  hitungPotonganKlinik: async () => ({
    promo: 6000, voucher: 2000, golongan: 1000, total: 9000, tolakVoucher: null,
    voucherCode: "HEMAT", campaignCode: "KAMPANYE1",
    rincianPromo: [
      { lineIndex: 0, promoId: "promo-tindakan", promoName: "DISKON TINDAKAN", potongan: 5000 },
      { lineIndex: 1, promoId: "promo-obat", promoName: "DISKON OBAT", potongan: 1000 },
    ],
  }),
}));
import { bayarVisit } from "../../app/(app)/klinik/pembayaran/[visitId]/actions";

const ITEMS = [
  { deskripsi: "Grooming lengkap", qty: 1, harga: 100000, jenis: "jasa", item_id: "tindakan-1", satuan: "jasa" },
  { deskripsi: "Obat kutu", qty: 1, harga: 20000, jenis: "obat", item_id: "obat-1", satuan: "box" },
];

function form(over: Record<string, string> = {}, items = ITEMS) {
  const data = new FormData();
  data.set("visitId", "visit");
  data.set("requestKey", "request");
  data.set("items", JSON.stringify(items));
  data.set("edit_reason", "Koreksi");
  Object.entries(over).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => { state.existing = false; state.calls = []; });

it("mengirim promo per baris dan potongan program di kepala invoice", async () => {
  await expect(bayarVisit(form())).resolves.toMatchObject({ saved: true });
  const params = state.calls[0].params as { p_invoice: Record<string, unknown>; p_lines: Record<string, unknown>[] };
  expect(state.calls[0].name).toBe("clinic_post_invoice");
  expect(params.p_invoice).toMatchObject({
    discount: 9000, voucher_discount: 2000, diskon_kategori: 1000,
    voucher_code: "HEMAT", campaign_code: "KAMPANYE1",
  });
  expect(params.p_lines[0]).toMatchObject({ item_id: "tindakan-1", promo_id: "promo-tindakan", promo_discount: 5000 });
  expect(params.p_lines[1]).toMatchObject({ item_id: "obat-1", promo_id: "promo-obat", promo_discount: 1000 });
});

it("tidak menempelkan promo pada baris yang tidak kena promo", async () => {
  const items = [...ITEMS, { deskripsi: "Vitamin", qty: 1, harga: 5000, jenis: "obat", item_id: "obat-2", satuan: "box" }];
  await expect(bayarVisit(form({}, items))).resolves.toMatchObject({ saved: true });
  const params = state.calls[0].params as { p_lines: Record<string, unknown>[] };
  expect(params.p_lines[2]).not.toHaveProperty("promo_id");
  expect(params.p_lines[2]).not.toHaveProperty("promo_discount");
});

it("koreksi tidak mengirim atribusi: database mempertahankan jejak program lama", async () => {
  state.existing = true;
  const items = ITEMS.map((row, index) => ({ ...row, source_invoice_item_id: `line-${index}` }));
  await expect(bayarVisit(form({ discount: "9000" }, items))).resolves.toMatchObject({ saved: true });
  const call = state.calls[0];
  expect(call.name).toBe("clinic_edit_invoice");
  const params = call.params as { p_invoice: Record<string, unknown>; p_lines: Record<string, unknown>[] };
  expect(params.p_invoice).not.toHaveProperty("voucher_discount");
  expect(params.p_invoice).not.toHaveProperty("diskon_kategori");
  for (const line of params.p_lines) {
    expect(line).not.toHaveProperty("promo_id");
    expect(line.source_invoice_item_id).toMatch(/^line-/);
  }
});
