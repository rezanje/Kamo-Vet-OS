import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Invoice rawat inap yang dibayar uang muka: metode_bayar tersimpan "Tunai" (bawaan tahap),
// uang aslinya QRIS lewat kwitansi. Cetakan harus menyebut metode kwitansi.
const s = vi.hoisted(() => ({
  payments: [] as { id: string; amount: number; metode: string; transferred_from: string | null }[],
  apps: [] as unknown[], parts: [] as unknown[], direct: [] as unknown[], failApps: false,
}));
const INVOICE = "a0000000-0000-4000-8000-000000000001";
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const q: Record<string, unknown> = {};
      let inColumn = "";
      for (const m of ["select", "eq", "is", "order", "limit", "range", "maybeSingle"]) q[m] = () => q;
      q.in = (column: string) => { inColumn = column; return q; };
      q.then = (resolve: (r: unknown) => unknown) => {
        const invoice = { id: INVOICE, invoice_no: "INV-202611-0767", total: 885000, subtotal: 885000, discount: 0, tax: 0,
          dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai", paid_at: "2026-11-11T05:00:00Z", created_at: "2026-11-11T04:00:00Z" };
        let data: unknown = [];
        let error: { message: string } | null = null;
        if (table === "visits") data = { id: "visit", poli: "Rawat Inap", created_at: "2026-11-11T00:00:00Z" };
        else if (table === "invoices") data = invoice;
        else if (table === "invoice_items") data = [{ id: "l1", invoice_id: INVOICE, deskripsi: "Rawat inap", qty: 1, harga: 885000 }];
        else if (table === "clinic_demo_invoice_snapshots") data = null;
        else if (table === "invoice_payments") data = inColumn === "receipt_id" ? s.direct : s.payments;
        else if (table === "clinic_advance_applications") { data = s.apps; if (s.failApps) { data = null; error = { message: "denied" }; } }
        else if (table === "clinic_payment_receipt_parts") data = s.parts;
        return Promise.resolve({ data, error, count: table === "invoices" ? 1 : Array.isArray(data) ? data.length : null }).then(resolve);
      };
      return q;
    },
  }),
}));
import InvoicePage from "@/app/(app)/klinik/pembayaran/[visitId]/invoice/page";
import StrukPage from "@/app/(app)/klinik/pembayaran/[visitId]/struk/page";

const render = async (Page: typeof InvoicePage) =>
  renderToStaticMarkup(await Page({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({}) }));
const app = (o: Record<string, unknown> = {}) => ({
  id: "ap1", invoice_id: INVOICE, payment_id: "pay1", amount: 885000, released_at: null,
  clinic_customer_advances: { id: "adv1", amount: 885000, receipt_id: "rc1" }, ...o,
});

beforeEach(() => {
  s.payments = [{ id: "pay1", amount: 885000, metode: "Uang Muka", transferred_from: null }];
  s.apps = [app()];
  s.parts = [{ receipt_id: "rc1", metode: "QRIS", amount: 885000 }];
  s.direct = [];
  s.failApps = false;
});

it("invoice cetak: uang muka dari kwitansi QRIS tertulis QRIS, bukan Tunai", async () => {
  const html = await render(InvoicePage);
  expect(html).toContain("Uang Muka (QRIS)");
  expect(html).not.toMatch(/Metode pembayaran:\s*<b[^>]*>Tunai/);
});

it("invoice cetak: kwitansi campuran dirinci per metode", async () => {
  s.parts = [{ receipt_id: "rc1", metode: "Tunai", amount: 600000 }, { receipt_id: "rc1", metode: "QRIS", amount: 285000 }];
  const html = await render(InvoicePage);
  expect(html).toContain("Uang Muka (Tunai Rp 600.000 + QRIS Rp 285.000)");
});

it("invoice cetak: bagian kwitansi tidak terbaca → 'Uang Muka' saja, tidak mengklaim Tunai", async () => {
  s.failApps = true;
  const html = await render(InvoicePage);
  expect(html).toMatch(/Metode pembayaran:\s*<b[^>]*>Uang Muka</);
  expect(html).not.toMatch(/Metode pembayaran:\s*<b[^>]*>Tunai/);
});

it("struk: metode ikut kwitansi asal", async () => {
  const html = await render(StrukPage as unknown as typeof InvoicePage);
  expect(html).toContain("Uang Muka (QRIS)");
  expect(html).not.toMatch(/Metode<\/span><span>Tunai/);
});

it("invoice tanpa uang muka: metode kepala dipakai seperti biasa", async () => {
  s.payments = [];
  const html = await render(InvoicePage);
  expect(html).toMatch(/Metode pembayaran:\s*<b[^>]*>Tunai/);
});
