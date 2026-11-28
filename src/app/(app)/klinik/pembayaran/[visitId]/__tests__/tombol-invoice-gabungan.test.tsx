// Tombol "Invoice gabungan" di layar Pembayaran: ada hanya bila pemilik membawa lebih dari satu hewan,
// bersebelahan dengan "Struk gabungan" (satu panel rombongan, satu aturan).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

type Pembayaran = { id?: string; amount: number; transferred_from: string | null; reversal_of?: string | null };
const state = vi.hoisted(() => ({
  paidStatus: "DP",
  dp: 30000,
  correctionPending: false,
  payments: [] as { id?: string; amount: number; transferred_from: string | null; reversal_of?: string | null }[],
  reissuedFrom: null as string | null,
  paymentsError: false,
  layak: false,
  hewan: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "kasir" } } }) },
  rpc: async (name: string) => {
    if (name === "clinic_invoice_correction_eligible") return { data: state.layak, error: null };
    return { data: false, error: null };
  },
  from(table: string) {
    let single = false; let selected = "";
    let exactCount = false;
    let range: [number, number] | null = null;
    const orders: { column: string; ascending: boolean }[] = [];
    const q: Record<string, unknown> = { then: (resolve: (v: unknown) => void) => {
      let data: unknown = [];
      let error: unknown = null;
      if (table === "visits") data = { id: "visit", status: "Pembayaran", poli: "Poli Umum", created_at: "2026-10-31T00:00:00Z", branch_id: "branch", pets: { name: "Pasien Fiktif" }, customers: { name: "Pemilik Fiktif" } };
      if (table === "medical_records") data = null;
      if (table === "inpatient_records") data = null;
      if (table === "profiles") data = { role: "STAFF" };
      if (table === "invoices") data = selected.includes("reissued_from")
        ? [{ id: "tagihan-lama", invoice_no: "INV-PRODUK-1", subtotal: 50000, discount: 0, tax: 0, total: 50000, dp_amount: state.dp, dp_date: "2026-10-30", paid_status: state.paidStatus, metode_bayar: "Tunai", paid_at: null, reissued_from: state.reissuedFrom, correction_pending: state.correctionPending, created_at: "2026-10-30T00:00:00Z", request_key: "lama", salesperson_id: null, cashier_name: "Kasir Fiktif", service_pricing_version: 1 }]
        : [{ id: "tagihan-lama", invoice_no: "INV-PRODUK-1" }];
      if (table === "invoice_items") data = [{ id: "baris", deskripsi: "Obat Fiktif", qty: 2, harga: 25000, jenis: "obat", item_id: "obat", diskon_persen: 0, compound_recipe_id: null, prescription_item_id: null, satuan: "pcs" }];
      if (table === "invoice_payments") { data = state.payments; if (state.paymentsError) { data = null; error = { message: "baca saldo gagal" }; } }
      if (table === "clinic_demo_invoice_snapshots") data = null;
      if (table === "consents") data = [];
      if (table === "invoice_edit_log") data = [];
      const count = exactCount && Array.isArray(data) ? data.length : null;
      if (table === "invoice_items" && Array.isArray(data)) {
        data = [...data].sort((a, b) => {
          for (const { column, ascending } of orders) {
            const comparison = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
            if (comparison) return ascending ? comparison : -comparison;
          }
          return 0;
        });
      }
      if (range && Array.isArray(data)) data = data.slice(range[0], range[1] + 1);
      if (single && Array.isArray(data)) data = (data as unknown[])[0] ?? null;
      resolve({ data, error, count });
    } };
    for (const method of ["select", "eq", "gt", "is", "in", "order", "limit", "range", "maybeSingle"]) {
      q[method] = (...args: unknown[]) => {
        if (method === "select") {
          selected = String(args[0]);
          exactCount = (args[1] as { count?: string } | undefined)?.count === "exact";
        }
        if (method === "range") range = [Number(args[0]), Number(args[1])];
        if (method === "order") orders.push({ column: String(args[0]), ascending: (args[1] as { ascending?: boolean } | undefined)?.ascending !== false });
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
vi.mock("@/lib/rombongan-server", () => ({
  bacaRombongan: async () => state.hewan.length === 0 ? null : {
    customerId: "cust", customerName: "Pemilik Fiktif", tanggal: "2026-10-31",
    baris: state.hewan.map((h, i) => ({ visitId: i === 0 ? "visit" : `visit-${i}`, hewan: h, invoiceNo: `INV-${i}`, total: 10000, paidStatus: "Lunas", dibayar: 10000 })),
  },
}));
vi.mock("@/lib/dp-minimal", () => ({ getDpMinimalPercent: async () => 50, bolehMenerobosDp: () => false }));
vi.mock("@/lib/tagihan-klinik", () => ({ perkiraanTagihan: async () => new Map(), bekalPotonganKlinik: async () => ({}), nilaiBaris: (r: { qty: number; harga: number }) => r.qty * r.harga }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm", () => ({
  PembayaranForm: (props: { editMode?: boolean; initialCreditAmount?: number }) => <div data-form-koreksi={props.editMode ? "1" : "0"} data-credit={props.initialCreditAmount}>FORM</div>,
}));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/LunasiRombonganForm", () => ({ LunasiRombonganForm: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/VoidReissueForm", () => ({ VoidReissueForm: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/ClinicRefundPanel", () => ({ ClinicRefundPanel: () => null, loadClinicRefundData: async () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: async () => undefined }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/pelunasan-actions", () => ({ lunasiTagihanKlinik: async () => undefined }));
import Page from "@/app/(app)/klinik/pembayaran/[visitId]/page";

beforeEach(() => {
  state.paidStatus = "Lunas"; state.dp = 0; state.correctionPending = false;
  state.payments = []; state.paymentsError = false; state.layak = false; state.reissuedFrom = null; state.hewan = [];
});
const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({}) }));
const tautan = (html: string, teks: string) => new RegExp(`<a [^>]*href="([^"]*)"[^>]*>(?:<[^>]+></[^>]+>)? ?${teks}</a>`).exec(html)?.[1];

it("satu hewan: tidak ada panel rombongan, tidak ada tombol Struk maupun Invoice gabungan", async () => {
  state.hewan = ["Milo"];
  const html = await render();
  expect(html).not.toContain("Invoice gabungan"); expect(html).not.toContain("Struk gabungan");
  expect(html).not.toContain("invoice-rombongan");
});

it("tanpa rombongan sama sekali (pemilik tidak diketahui): tidak ada tombol", async () => {
  const html = await render();
  expect(html).not.toContain("Invoice gabungan"); expect(html).not.toContain("invoice-rombongan");
});

it("dua hewan atau lebih: tombol 'Invoice gabungan' muncul menuju rute baru, tepat sesudah 'Struk gabungan'", async () => {
  state.hewan = ["Milo", "Bruno"];
  const html = await render();
  expect(tautan(html, "Invoice gabungan")).toBe("/klinik/pembayaran/visit/invoice-rombongan");
  expect(tautan(html, "Struk gabungan")).toBe("/klinik/pembayaran/visit/struk-rombongan");
  expect(html.indexOf("Struk gabungan")).toBeGreaterThan(-1);
  expect(html.indexOf("Invoice gabungan")).toBeGreaterThan(html.indexOf("Struk gabungan"));
  expect(html.split("Invoice gabungan").length - 1).toBe(1);
  expect(html).toContain("Pemilik Fiktif membawa 2 pasien hari ini");
});

it("tiga hewan: tetap satu tombol", async () => {
  state.hewan = ["Milo", "Bruno", "Kiko"];
  const html = await render();
  expect(html.split("Invoice gabungan").length - 1).toBe(1); expect(html).toContain("membawa 3 pasien");
});
