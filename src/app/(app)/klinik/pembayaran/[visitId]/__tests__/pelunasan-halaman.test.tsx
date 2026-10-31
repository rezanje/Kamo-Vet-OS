// Layar Pembayaran rawat jalan: tagihan DP/Belum Lunas lama punya pintu pelunasan
// untuk kasir klinik. DP sebelumnya tampil SEKALI, sisa benar, invoice yang sama.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

type Pembayaran = { amount: number; transferred_from: string | null };
const state = vi.hoisted(() => ({
  paidStatus: "DP",
  dp: 30000,
  correctionPending: false,
  payments: [] as { amount: number; transferred_from: string | null }[],
  paymentsError: false,
  layak: false,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "kasir" } } }) },
  rpc: async (name: string) => {
    if (name === "clinic_invoice_correction_eligible") return { data: state.layak, error: null };
    return { data: false, error: null };
  },
  from(table: string) {
    let single = false; let selected = "";
    const q: Record<string, unknown> = { then: (resolve: (v: unknown) => void) => {
      let data: unknown = [];
      let error: unknown = null;
      if (table === "visits") data = { id: "visit", status: "Pembayaran", poli: "Poli Umum", created_at: "2026-10-31T00:00:00Z", branch_id: "branch", pets: { name: "Pasien Fiktif" }, customers: { name: "Pemilik Fiktif" } };
      if (table === "medical_records") data = null;
      if (table === "inpatient_records") data = null;
      if (table === "profiles") data = { role: "STAFF" };
      if (table === "invoices") data = selected.includes("reissued_from")
        ? [{ id: "tagihan-lama", invoice_no: "INV-PRODUK-1", subtotal: 50000, discount: 0, tax: 0, total: 50000, dp_amount: state.dp, dp_date: "2026-10-30", paid_status: state.paidStatus, metode_bayar: "Tunai", paid_at: null, reissued_from: null, correction_pending: state.correctionPending, created_at: "2026-10-30T00:00:00Z", request_key: "lama", salesperson_id: null, cashier_name: "Kasir Fiktif", service_pricing_version: 1 }]
        : [{ id: "tagihan-lama", invoice_no: "INV-PRODUK-1" }];
      if (table === "invoice_items") data = [{ id: "baris", deskripsi: "Obat Fiktif", qty: 2, harga: 25000, jenis: "obat", item_id: "obat", diskon_persen: 0, compound_recipe_id: null, prescription_item_id: null, satuan: "pcs" }];
      if (table === "invoice_payments") { data = state.payments; if (state.paymentsError) { data = null; error = { message: "baca saldo gagal" }; } }
      if (table === "clinic_demo_invoice_snapshots") data = null;
      if (table === "consents") data = [];
      if (table === "invoice_edit_log") data = [];
      if (single && Array.isArray(data)) data = (data as unknown[])[0] ?? null;
      resolve({ data, error });
    } };
    for (const method of ["select", "eq", "gt", "is", "in", "order", "limit", "range", "maybeSingle"]) {
      q[method] = (...args: unknown[]) => {
        if (method === "select") selected = String(args[0]);
        if (method === "maybeSingle") single = true;
        return q;
      };
    }
    return q;
  },
}) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); }, redirect: (url: string) => { throw Error(url); }, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/service-performers-server", () => ({ loadServiceStaff: async () => [], loadBranchGroomingPolicy: async () => null, loggedInCashier: async () => ({ employeeId: null, name: "Kasir Fiktif" }) }));
vi.mock("@/lib/clinic-demo-policy-server", () => ({ readDemoPolicy: async () => null }));
vi.mock("@/lib/clinic-payment", () => ({ loadClinicPaymentMaster: async () => ({ obat: [], jasa: [], all: [] }), loadClinicPackages: async () => [] }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({ mode_pkp: false, ppn_rate: 0 }) }));
vi.mock("@/lib/tindakan", () => ({ bolehBayar: () => true, kategoriBerisiko: () => [] }));
vi.mock("@/lib/consent-server", () => ({ bacaAturanConsent: async () => [] }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: async () => null }));
vi.mock("@/lib/dp-minimal", () => ({ getDpMinimalPercent: async () => 50, bolehMenerobosDp: () => false }));
vi.mock("@/lib/tagihan-klinik", () => ({ perkiraanTagihan: async () => new Map(), bekalPotonganKlinik: async () => ({}), nilaiBaris: (r: { qty: number; harga: number }) => r.qty * r.harga }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm", () => ({
  PembayaranForm: (props: { editMode?: boolean }) => <div data-form-koreksi={props.editMode ? "1" : "0"}>FORM</div>,
}));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/LunasiRombonganForm", () => ({ LunasiRombonganForm: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/VoidReissueForm", () => ({ VoidReissueForm: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/ClinicRefundPanel", () => ({ ClinicRefundPanel: () => null, loadClinicRefundData: async () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: async () => undefined }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/pelunasan-actions", () => ({ lunasiTagihanKlinik: async () => undefined }));
import Page from "@/app/(app)/klinik/pembayaran/[visitId]/page";

beforeEach(() => {
  state.paidStatus = "DP"; state.dp = 30000; state.correctionPending = false;
  state.payments = []; state.paymentsError = false; state.layak = false;
});
const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({}) }));
const count = (html: string, needle: string) => html.split(needle).length - 1;
const hidden = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1];

it("menawarkan pelunasan DP lama ke kasir klinik pada invoice yang sama", async () => {
  const html = await render();
  expect(html).toContain("Pelunasan tagihan");
  expect(hidden(html, "invoice_id")).toBe("tagihan-lama");
  expect(hidden(html, "visitId")).toBe("visit");
  expect(hidden(html, "expected_remaining")).toBe("20000");
  expect(html).toContain("Terima Pelunasan");
});

it("menampilkan DP sebelumnya sekali dan sisa yang benar", async () => {
  const html = await render();
  expect(count(html, "Rp 30.000")).toBe(1);
  expect(html).toContain("Sudah diterima (DP &amp; pembayaran sebelumnya)");
  expect(html).not.toContain("diterima Rp 30.000, sisa");
  expect(html).toContain("Rp 20.000");
});

it("menghitung pelunasan sebagian sebelumnya tanpa mengurangi DP dua kali", async () => {
  state.payments = [{ amount: 8000, transferred_from: null }] as Pembayaran[];
  const html = await render();
  expect(hidden(html, "expected_remaining")).toBe("12000");
  expect(count(html, "Rp 38.000")).toBe(1);
});

it("tetap menawarkan pelunasan saat keuangan juga melihat form koreksi", async () => {
  state.layak = true;
  const html = await render();
  expect(html).toContain('data-form-koreksi="1"');
  expect(hidden(html, "expected_remaining")).toBe("20000");
});

it.each([
  ["lunas", () => { state.paidStatus = "Lunas"; state.dp = 0; state.payments = [{ amount: 50000, transferred_from: null }]; }],
  ["koreksi tertunda", () => { state.correctionPending = true; }],
])("tidak menawarkan pelunasan untuk tagihan %s", async (_label, setup) => {
  setup();
  const html = await render();
  expect(html).not.toContain("Terima Pelunasan");
  expect(hidden(html, "expected_remaining")).toBeUndefined();
});

it("gagal tertutup bila saldo pembayaran tidak terbaca", async () => {
  state.paymentsError = true;
  await expect(render()).rejects.toThrow("Tagihan belum dapat diverifikasi");
});
