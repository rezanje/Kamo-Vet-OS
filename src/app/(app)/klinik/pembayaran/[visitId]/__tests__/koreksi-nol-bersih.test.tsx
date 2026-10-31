// Layar pembayaran: siapa yang ditawari form koreksi, dan untuk tagihan yang mana.
//
// Peninjau independen menemukan layar ini memakai tebakannya sendiri ("tidak boleh
// ada satu pun baris pembayaran"), sehingga riwayat yang SUDAH DIBALIK SELURUHNYA —
// keadaan yang basis datanya terima — tidak pernah sampai ke form koreksi, dan
// tagihan ber-uang-muka-kepala malah ditawarkan ke peran yang nanti ditolak.
//
// Di sini layar harus MENANYAKAN kelayakan ke basis data (RPC
// `clinic_invoice_correction_eligible`) untuk tagihan AKTIF, lalu mengikutinya.
// Jawaban RPC di tiap kasus bukan karangan: nilainya disalin dari matriks yang
// diuji lawan penulisan sungguhnya di scripts/test-ranap-mitigasi-penuh-postgres.py
// (kasus R2-01-*), yang menjalankan RPC asli di PostgreSQL berisi seluruh migrasi.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

type Pembayaran = { amount: number; transferred_from: string | null };
const state = vi.hoisted(() => ({
  role: "FINANCE",
  payments: [] as Pembayaran[],
  dp: 0,
  paidStatus: "Belum Lunas",
  correctionPending: false,
  // Jawaban RPC kelayakan dari basis data sungguhan untuk fixture ini.
  layak: true as boolean | null,
  rpc: [] as { name: string; params: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "keuangan" } } }) },
  rpc: async (name: string, params: Record<string, unknown>) => {
    state.rpc.push({ name, params });
    if (name === "clinic_invoice_correction_eligible") {
      return state.layak === null
        ? { data: null, error: { message: "eligibility unavailable" } }
        : { data: state.layak, error: null };
    }
    return { data: false, error: null };
  },
  from(table: string) {
    let single = false; let selected = "";
    const q: Record<string, unknown> = { then: (resolve: (v: unknown) => void) => {
      let data: unknown = [];
      if (table === "visits") data = { id: "visit", status: "Pembayaran", poli: "Umum", created_at: "2026-11-03T00:00:00Z", branch_id: "branch", pets: { name: "Pasien Fiktif" }, customers: { name: "Pemilik Fiktif" } };
      if (table === "medical_records") data = { id: "mr" };
      if (table === "inpatient_records") data = { id: "ranap", consent_id: null };
      if (table === "profiles") data = { role: state.role };
      // Rawat inap bertahap: tagihan tahap LAMA lebih dulu, tahap aktif terakhir.
      if (table === "invoices") data = selected.includes("reissued_from")
        ? [
            { id: "tahap-lama", invoice_no: "INV-TAHAP-1", subtotal: 50000, discount: 0, tax: 0, total: 50000, dp_amount: 0, dp_date: null, paid_status: "Lunas", metode_bayar: "Tunai", paid_at: null, reissued_from: null, correction_pending: false, created_at: "2026-11-01T00:00:00Z", request_key: "tahap-1", salesperson_id: null, cashier_name: null, service_pricing_version: 1 },
            { id: "tagihan", invoice_no: "INV-TAHAP-2", subtotal: 100000, discount: 0, tax: 0, total: 100000, dp_amount: state.dp, dp_date: null, paid_status: state.paidStatus, metode_bayar: "Tunai", paid_at: null, reissued_from: null, correction_pending: state.correctionPending, created_at: "2026-11-03T00:00:00Z", request_key: "tahap-2", salesperson_id: null, cashier_name: null, service_pricing_version: 1 },
          ]
        : [{ id: "tahap-lama", invoice_no: "INV-TAHAP-1" }, { id: "tagihan", invoice_no: "INV-TAHAP-2" }];
      if (table === "invoice_items") data = [{ id: "baris", deskripsi: "Jasa Rawat Inap Fiktif", qty: 1, harga: 100000, jenis: "jasa", item_id: null, diskon_persen: 0, compound_recipe_id: null, prescription_item_id: "resep-1", satuan: "hari" }];
      if (table === "invoice_payments") data = state.payments;
      if (table === "prescription_items") data = selected.includes("nama_obat")
        ? [{ id: "resep-1", nama_obat: "Jasa Rawat Inap Fiktif", qty: 1, harga: 100000, jenis: "jasa", item_id: null, satuan: "hari", compound_recipe_id: null }] : [];
      if (table === "clinic_demo_invoice_snapshots") data = null;
      if (table === "compounding_recipes") data = [];
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
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); }, redirect: (url: string) => { throw Error(url); } }));
vi.mock("@/lib/service-performers-server", () => ({ loadServiceStaff: async () => [], loadBranchGroomingPolicy: async () => null, loggedInCashier: async () => ({ employeeId: null, name: "Kasir Fiktif" }) }));
vi.mock("@/lib/clinic-demo-policy-server", () => ({ readDemoPolicy: async () => null }));
vi.mock("@/lib/clinic-payment", () => ({ loadClinicPaymentMaster: async () => ({ obat: [], jasa: [], all: [] }), loadClinicPackages: async () => [] }));
vi.mock("@/lib/penjual", () => ({ daftarPenjual: async () => [] }));
vi.mock("@/lib/master-guard", () => ({ bolehTransaksiKas: async () => false }));
vi.mock("@/components/PilihRekening", () => ({ loadRekeningAktif: async () => [], PilihRekening: () => null }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({ mode_pkp: false, ppn_rate: 0 }) }));
vi.mock("@/lib/tindakan", () => ({ bolehBayar: () => true, kategoriBerisiko: () => [] }));
vi.mock("@/lib/consent-server", () => ({ bacaAturanConsent: async () => [] }));
vi.mock("@/lib/rombongan-server", () => ({ bacaRombongan: async () => null }));
vi.mock("@/lib/tagihan-klinik", () => ({ perkiraanTagihan: async () => new Map(), bekalPotonganKlinik: async () => ({}), nilaiBaris: (r: { qty: number; harga: number }) => r.qty * r.harga }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/PembayaranForm", () => ({
  PembayaranForm: (props: { editMode?: boolean; initialDpAmount?: number; initialCreditAmount?: number }) =>
    <div data-form-koreksi={props.editMode ? "1" : "0"} data-dp={props.initialDpAmount} data-kredit={props.initialCreditAmount}>FORM</div>,
}));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/LunasiRombonganForm", () => ({ LunasiRombonganForm: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/VoidReissueForm", () => ({ VoidReissueForm: () => null }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/ClinicRefundPanel", () => ({ ClinicRefundPanel: () => null, loadClinicRefundData: async () => null }));
import Page from "@/app/(app)/klinik/pembayaran/[visitId]/page";

// Riwayat yang sudah dibalik seluruhnya: baris positif dan pembaliknya tetap
// tersimpan sebagai jejak, keduanya BUKAN pengalihan terbit ulang.
const NOL_BERSIH: Pembayaran[] = [{ amount: 100000, transferred_from: null }, { amount: -100000, transferred_from: null }];
const SEBAGIAN: Pembayaran[] = [{ amount: 100000, transferred_from: null }, { amount: -40000, transferred_from: null }];

beforeEach(() => {
  state.role = "FINANCE"; state.payments = []; state.dp = 0; state.paidStatus = "Belum Lunas";
  state.correctionPending = false; state.layak = true; state.rpc = [];
});
// Default inpatient cashier is pending-only. The existing financial correction
// workflow is separate and MUST name its actual issued invoice explicitly.
const render = () => Page({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({invoice_id:"tagihan"}) });
const formKoreksi = (html: string) => html.includes('data-form-koreksi="1"');

it("menawarkan koreksi kepada keuangan untuk riwayat pembayaran yang sudah dibalik seluruhnya", async () => {
  state.payments = NOL_BERSIH;
  const html = renderToStaticMarkup(await render());
  expect(formKoreksi(html)).toBe(true);
  // Form koreksi memakai jalur yang sudah ada (aksi bayarVisit -> clinic_edit_invoice):
  // tidak ada uang yang dibawa, uang muka kepala nol, pengalihan nol.
  expect(html).toContain('data-dp="0"');
  expect(html).toContain('data-kredit="0"');
});

it("menanyakan kelayakan ke basis data untuk tagihan tahap yang AKTIF", async () => {
  state.payments = NOL_BERSIH;
  renderToStaticMarkup(await render());
  expect(state.rpc).toContainEqual({ name: "clinic_invoice_correction_eligible", params: { p_invoice_id: "tagihan" } });
});

it.each(["STAFF", "DOCTOR"])("tidak menawarkan koreksi riwayat berisi uang kepada %s", async (role) => {
  state.role = role; state.payments = NOL_BERSIH; state.layak = false;
  const html = renderToStaticMarkup(await render());
  expect(formKoreksi(html)).toBe(false);
  expect(html).not.toContain("?edit=1");
  expect(html).toContain("INV-TAHAP-2");
});

it("tetap memblokir tagihan yang pembayarannya baru dibalik sebagian", async () => {
  state.payments = SEBAGIAN; state.paidStatus = "DP"; state.layak = false;
  const html = renderToStaticMarkup(await render());
  expect(formKoreksi(html)).toBe(false);
  expect(html).not.toContain("?edit=1");
});

it("tidak membuat regresi tagihan biasa yang belum dibayar", async () => {
  const html = renderToStaticMarkup(await render());
  expect(formKoreksi(html)).toBe(true);
});

it("menawarkan koreksi uang muka kepala hanya kepada peran keuangan", async () => {
  state.dp = 60000; state.paidStatus = "DP";
  expect(formKoreksi(renderToStaticMarkup(await render()))).toBe(true);
  state.role = "STAFF"; state.layak = false; state.rpc = [];
  const html = renderToStaticMarkup(await render());
  expect(formKoreksi(html)).toBe(false);
  expect(html).not.toContain("?edit=1");
});

it("tidak menawarkan koreksi ketika kelayakan gagal dibaca, tanpa mematikan layar", async () => {
  state.payments = NOL_BERSIH; state.layak = null;
  const html = renderToStaticMarkup(await render());
  expect(formKoreksi(html)).toBe(false);
  expect(html).toContain("INV-TAHAP-2");
});
