// Layar Pembayaran rawat jalan tanpa shift kasir milik sendiri (Reza, 2 November 2026):
// Owner/Admin boleh MELIHAT tagihan cabang tanpa membuka laci; semua form penerima uang
// disembunyikan. Peran lain tetap diarahkan ke Mulai Shift seperti sebelumnya.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "OWNER",
  shift: false,
  invoice: "none" as "none" | "DP" | "Belum Lunas" | "Lunas",
  layak: false,
  rombongan: false,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "akun" } } }) },
  rpc: async (name: string) => {
    if (name === "clinic_outpatient_cart_version") return { data: `v1:${"0".repeat(32)}`, error: null };
    if (name === "clinic_invoice_correction_eligible") return { data: state.layak, error: null };
    if (name === "clinic_demo_care_staff") return { data: [], error: null };
    return { data: false, error: null };
  },
  from(table: string) {
    let single = false; let selected = "";
    const q: Record<string, unknown> = { then: (resolve: (v: unknown) => void) => {
      let data: unknown = [];
      const invoiceRow = { id: "tagihan", invoice_no: "INV-KLINIK-1", subtotal: 50000, discount: 0, tax: 0, total: 50000, dp_amount: state.invoice === "DP" ? 30000 : 0, dp_date: null, paid_status: state.invoice, metode_bayar: "Tunai", paid_at: null, reissued_from: null, correction_pending: false, created_at: "2026-11-02T00:00:00Z", request_key: "lama", salesperson_id: null, cashier_name: "Kasir Fiktif", service_pricing_version: 1 };
      if (table === "visits") data = { id: "visit", status: "Pembayaran", poli: "Poli Umum", created_at: "2026-11-02T00:00:00Z", branch_id: "branch", customer_id: "pemilik", pets: { name: "Pasien Fiktif", species: "Kucing" }, customers: { name: "Pemilik Fiktif" } };
      if (table === "medical_records") data = { id: "rekam", catatan_resep: "Diminum dua kali sehari" };
      if (table === "compounding_recipes") data = [];
      if (table === "inpatient_records") data = null;
      if (table === "prescription_items") data = [{ id: "resep", nama_obat: "Amoxicillin Fiktif", qty: 2, harga: 15000, jenis: "obat", kategori: null, item_id: "obat", satuan: "tab", compound_recipe_id: null }];
      if (table === "profiles") data = { role: state.role, is_active: true };
      if (table === "invoices") data = state.invoice === "none" ? [] : selected.includes("reissued_from") ? [invoiceRow] : [{ id: "tagihan", invoice_no: "INV-KLINIK-1" }];
      if (table === "invoice_items") data = [{ id: "baris", deskripsi: "Obat Tersimpan Fiktif", qty: 2, harga: 25000, jenis: "obat", item_id: "obat", diskon_persen: 0, compound_recipe_id: null, prescription_item_id: null, satuan: "pcs" }];
      if (table === "invoice_payments") data = [];
      if (table === "clinic_demo_invoice_snapshots") data = null;
      if (table === "clinic_payment_corrections") data = [];
      if (table === "consents") data = [];
      if (table === "invoice_edit_log") data = [];
      if (single && Array.isArray(data)) data = (data as unknown[])[0] ?? null;
      resolve({ data, error: null });
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
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); }, redirect: (url: string) => { throw Error(`REDIRECT ${url}`); }, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/service-performers-server", () => ({ loadServiceStaff: async () => [], loadBranchGroomingPolicy: async () => null, loggedInCashier: async () => ({ employeeId: null, name: "Kasir Fiktif" }) }));
vi.mock("@/lib/clinic-demo-policy-server", () => ({ readDemoPolicy: async () => null }));
vi.mock("@/lib/clinic-payment", () => ({ loadClinicPaymentMaster: async () => ({ obat: [], jasa: [], all: [] }), loadClinicPackages: async () => [] }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => (state.shift ? { id: "shift" } : null) }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({ mode_pkp: true, ppn_rate: 11 }) }));
vi.mock("@/lib/tindakan", () => ({ bolehBayar: () => true, kategoriBerisiko: () => [] }));
vi.mock("@/lib/consent-server", () => ({ bacaAturanConsent: async () => [] }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: async () => state.rombongan ? {
  customerId: "pemilik", customerName: "Pemilik Fiktif", tanggal: "2026-11-02",
  baris: [
    { visitId: "visit", hewan: "Pasien Fiktif", invoiceNo: null, total: 0, paidStatus: null, dibayar: 0 },
    { visitId: "visit-2", hewan: "Pasien Kedua", invoiceNo: null, total: 0, paidStatus: null, dibayar: 0 },
  ],
} : null }));
vi.mock("@/lib/dp-minimal", () => ({ getDpMinimalPercent: async () => 50, bolehMenerobosDp: () => false }));
vi.mock("@/lib/tagihan-klinik", () => ({ perkiraanTagihan: async () => new Map(), bekalPotonganKlinik: async () => ({}), nilaiBaris: (r: { qty: number; harga: number }) => r.qty * r.harga }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm", () => ({
  PembayaranForm: (props: { editMode?: boolean }) => <div data-form-bayar={props.editMode ? "koreksi" : "baru"}>FORM</div>,
}));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/LunasiRombonganForm", () => ({ LunasiRombonganForm: () => <div>FORM-ROMBONGAN</div> }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/VoidReissueForm", () => ({ VoidReissueForm: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/ClinicRefundPanel", () => ({ ClinicRefundPanel: () => null, loadClinicRefundData: async () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: async () => undefined }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/pelunasan-actions", () => ({ lunasiTagihanKlinik: async () => undefined }));
import Page from "@/app/(app)/klinik/pembayaran/[visitId]/page";

beforeEach(() => {
  state.role = "OWNER"; state.shift = false; state.invoice = "none"; state.layak = false; state.rombongan = false;
});
const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({}) }));

it.each(["OWNER", "ADMIN"])("%s tanpa shift melihat draf tagihan baca saja, bukan form bayar", async (role) => {
  state.role = role;
  const html = await render();
  expect(html).toContain("Mode lihat saja");
  expect(html).toContain('href="/klinik/shift"');
  expect(html).toContain("Draf tagihan · baca saja");
  expect(html).toContain("Amoxicillin Fiktif");
  // 2 x Rp 15.000 = Rp 30.000, PPN 11% = Rp 3.300, perkiraan Rp 33.300.
  expect(html).toContain("Rp 30.000");
  expect(html).toContain("Rp 3.300");
  expect(html).toContain("Rp 33.300");
  expect(html).toContain("Diminum dua kali sehari");
  expect(html).not.toContain("data-form-bayar");
});

it.each(["STAFF", "DOCTOR", "FINANCE"])("%s tanpa shift tetap diarahkan ke Mulai Shift", async (role) => {
  state.role = role;
  await expect(render()).rejects.toThrow(/^REDIRECT \/klinik\/shift\?error=/);
});

it("owner yang sudah buka shift tetap mendapat form bayar biasa tanpa label lihat saja", async () => {
  state.shift = true;
  const html = await render();
  expect(html).toContain('data-form-bayar="baru"');
  expect(html).not.toContain("Mode lihat saja");
});

it("tagihan DP: owner tanpa shift melihat rincian dan sisa, tanpa pelunasan maupun lanjut rawat inap", async () => {
  state.invoice = "DP";
  const html = await render();
  expect(html).toContain("Mode lihat saja");
  expect(html).toContain("INV-KLINIK-1");
  expect(html).toContain("Obat Tersimpan Fiktif");
  expect(html).toContain("diterima Rp 30.000, sisa Rp 20.000");
  expect(html).not.toContain("Terima Pelunasan");
  expect(html).not.toContain("Masukkan Rawat Inap");
  expect(html).not.toContain("data-form-bayar");
});

it("tagihan yang boleh dikoreksi: owner tanpa shift tidak mendapat keranjang koreksi atau tombol Edit Invoice", async () => {
  state.invoice = "Belum Lunas"; state.layak = true;
  const html = await render();
  expect(html).toContain("Mode lihat saja");
  expect(html).not.toContain("data-form-bayar");
  expect(html).not.toContain("Edit Invoice");
  // Dengan shift, jalur koreksi yang sama kembali tersedia.
  state.shift = true;
  const denganShift = await render();
  expect(denganShift).toContain('data-form-bayar="koreksi"');
});

it("rombongan: owner tanpa shift melihat daftar hewan tanpa form bayar sekaligus", async () => {
  state.rombongan = true;
  const html = await render();
  expect(html).toContain("Pasien Kedua");
  expect(html).not.toContain("FORM-ROMBONGAN");
  state.shift = true;
  expect(await render()).toContain("FORM-ROMBONGAN");
});

it("tagihan lunas tetap terbuka untuk semua peran tanpa label lihat saja (perilaku lama)", async () => {
  state.invoice = "Lunas"; state.role = "STAFF";
  const html = await render();
  expect(html).toContain("INV-KLINIK-1");
  expect(html).not.toContain("Mode lihat saja");
});
