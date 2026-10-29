// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { displaySections } from "@/lib/report-display-export";

const fixture = vi.hoisted(() => ({ responses: [] as Array<{ data: unknown[] }>, rpc: [] as unknown[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: () => {
    // The query is consumed by the mocked completeReportQuery after all builder methods.
    const query = new Proxy({}, { get: () => () => query });
    return query;
  },
  rpc: async () => ({ data: fixture.rpc, error: null }),
}) }));
vi.mock("@/lib/report-query", () => ({ completeReportQuery: async () => fixture.responses.shift() }));
vi.mock("@/components/LaporanPage", () => ({
  LaporanPage: ({ filter, ringkasan, children }: { filter: React.ReactNode; ringkasan: React.ReactNode; children: React.ReactNode }) => <main><form>{filter}</form>{ringkasan}<div id="laporan-isi">{children}</div></main>,
  KartuAngka: ({ items }: { items: Array<{ label: string; nilai: string }> }) => <div>{items.map(item => <span key={item.label}>{item.label}: {item.nilai}</span>)}</div>,
  TabelKosong: ({ pesan }: { pesan: string }) => <tr><td>{pesan}</td></tr>,
}));
import Page from "./page";

const ALPHA = "fa100000-0000-4000-8000-000000000011";
const BETA = "fa100000-0000-4000-8000-000000000012";

type Row = Record<string, unknown>;

const sale = (over: Row = {}): Row => ({
  id: "sale-a", no_struk: "POS-1", total: 90, subtotal: 100, discount: 10, diskon_kategori: 0,
  poin_digunakan: 0, voucher_code: null, campaign_code: null, cashier_name: "Kasir Satu",
  created_at: "2026-10-10T08:00:00Z", branch_id: null, branches: { name: "Cabang Pusat" },
  customers: { name: "Bu Rina" }, payment_plan: null, payments_finalized_at: null, voided_at: null,
  sale_items: [{ qty: 1, harga: 100, item_discount_type: null, item_discount_value: null, promo_id: ALPHA, promo_discount: 10 }],
  ...over,
});

const invoice = (over: Row = {}): Row => ({
  id: "inv-a", invoice_no: "INV-1", visit_id: "visit-a", total: 180, subtotal: 200, discount: 20,
  voucher_code: null, campaign_code: null, voucher_discount: 0, diskon_kategori: 0, cashier_name: "Kasir Klinik",
  created_at: "2026-10-11T08:00:00Z",
  visits: { branch_id: null, branches: { name: "Cabang Pusat" }, customers: { name: "Pak Budi" } },
  invoice_items: [{ qty: 2, harga: 100, diskon_persen: 0, promo_id: BETA, promo_discount: 20 }],
  ...over,
});

function pasang(opts: { sales?: Row[]; invoices?: Row[]; vouchers?: Row[]; promos?: Row[]; kode?: Row[]; pakai?: unknown[] } = {}) {
  fixture.responses = [
    { data: opts.sales ?? [] },
    { data: opts.invoices ?? [] },
    { data: opts.vouchers ?? [] },
    { data: opts.promos ?? [{ id: ALPHA, name: "Vaksin A", promo_type: "diskon_produk" }, { id: BETA, name: "Grooming B", promo_type: "diskon_produk" }] },
    { data: [] },
    { data: opts.kode ?? [] },
    { data: [{ id: "branch-1", name: "Cabang Pusat" }] },
  ];
  fixture.rpc = opts.pakai ?? [];
}

const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31", ...sp }) }));

const potong = (html: string, awal: string, akhir?: string) => {
  const sisa = html.split(awal)[1] ?? "";
  return akhir ? sisa.split(akhir)[0] : sisa;
};

beforeEach(() => { fixture.responses = []; fixture.rpc = []; });

it("reopens a monthly named-promo view without changing overall transaction totals", async () => {
  pasang({
    sales: [sale({ id: "sale-a", sale_items: [{ qty: 1, harga: 100, item_discount_type: null, item_discount_value: null, promo_id: ALPHA, promo_discount: 10 }] }),
      sale({ id: "sale-b", no_struk: "POS-2", sale_items: [{ qty: 1, harga: 100, item_discount_type: null, item_discount_value: null, promo_id: BETA, promo_discount: 10 }] })],
    promos: [{ id: ALPHA, name: "Vaksin A", promo_type: "barang" }, { id: BETA, name: "Makanan B", promo_type: "barang" }],
  });
  const html = await render({ promo_id: ALPHA });
  expect(html).toContain(`name="promo_id"`);
  expect(html).toContain(`value="${ALPHA}" selected=""`);
  const promoTable = potong(html, "02 · PROMO OTOMATIS", "03 · DISKON PER CABANG");
  expect(promoTable).toContain("Vaksin A");
  expect(promoTable).not.toContain("Makanan B");
  expect(html).toContain("Omzet bersih: Rp 180");
});

describe("ringkasan per program", () => {
  it("menjumlahkan promo petshop dan klinik dalam satu daftar", async () => {
    pasang({ sales: [sale()], invoices: [invoice()] });
    const ringkasan = potong(await render(), "04 · RINGKASAN PER PROGRAM", "05 · RINCIAN PER TRANSAKSI");
    expect(ringkasan).toContain("Vaksin A");
    expect(ringkasan).toContain("Grooming B");
    // Potongan klinik dibaca dari baris invoice, bukan dari kolom diskon gabungan.
    expect(ringkasan).toContain("Rp 20");
    expect(ringkasan).toContain("Rp 10");
  });

  it("menghitung voucher dan kode kampanye klinik dari kolomnya sendiri", async () => {
    pasang({
      invoices: [invoice({
        discount: 50, total: 150, voucher_code: "HEMAT10", campaign_code: "KAMPANYE1",
        voucher_discount: 30, diskon_kategori: 0,
        invoice_items: [{ qty: 2, harga: 100, diskon_persen: 0, promo_id: BETA, promo_discount: 20 }],
      })],
      kode: [{ id: "k1", code: "KAMPANYE1", voucher_id: "v1", promo_id: null, max_uses: 5, is_active: true }],
      pakai: [{ code: "KAMPANYE1", used: 3 }],
    });
    const ringkasan = potong(await render(), "04 · RINGKASAN PER PROGRAM", "05 · RINCIAN PER TRANSAKSI");
    expect(ringkasan).toContain("HEMAT10");
    expect(ringkasan).toContain("KAMPANYE1");
    expect(ringkasan).toContain("Rp 30");
    // Kode terikat voucher mewarisi nilai vouchernya, dan batas pemakaiannya terlihat.
    expect(ringkasan).toContain("3 / 5");
    expect(ringkasan).not.toContain("potongan belum tercatat terpisah&gt;");
  });

  it("menandai voucher petshop sebagai nilai yang belum terpisah dari diskon manual", async () => {
    pasang({ sales: [sale({ voucher_code: "HEMAT10", discount: 25, total: 75, sale_items: [{ qty: 1, harga: 100, item_discount_type: null, item_discount_value: null, promo_id: null, promo_discount: 0 }] })] });
    const ringkasan = potong(await render(), "04 · RINGKASAN PER PROGRAM", "05 · RINCIAN PER TRANSAKSI");
    expect(ringkasan).toContain("HEMAT10");
    expect(ringkasan).toContain("potongan belum tercatat terpisah");
    expect(ringkasan).toContain("Rp 25");
  });

  it("menyaring per cabang dan per kanal", async () => {
    pasang({
      sales: [sale({ branches: { name: "Cabang Lain" } })],
      invoices: [invoice()],
    });
    const ringkasan = potong(await render({ cabang: "Cabang Pusat" }), "04 · RINGKASAN PER PROGRAM", "05 · RINCIAN PER TRANSAKSI");
    expect(ringkasan).toContain("Grooming B");
    expect(ringkasan).not.toContain("Vaksin A");

    pasang({ sales: [sale()], invoices: [invoice()] });
    const petshop = potong(await render({ kanal: "Petshop" }), "04 · RINGKASAN PER PROGRAM", "05 · RINCIAN PER TRANSAKSI");
    expect(petshop).toContain("Vaksin A");
    expect(petshop).not.toContain("Grooming B");
  });
});

describe("transaksi batal dan tagihan lama", () => {
  it("tidak menghitung struk yang di-void atau belum selesai dibayar", async () => {
    pasang({ sales: [
      sale({ id: "sale-void", voided_at: "2026-10-12T00:00:00Z" }),
      sale({ id: "sale-pending", payment_plan: { kind: "cicil" }, payments_finalized_at: null }),
    ] });
    const html = await render();
    const ringkasan = potong(html, "04 · RINGKASAN PER PROGRAM", "05 · RINCIAN PER TRANSAKSI");
    expect(ringkasan).toContain("Belum ada promo, voucher, atau kode kampanye yang terpakai");
    expect(potong(html, "05 · RINCIAN PER TRANSAKSI")).toContain("Belum ada transaksi berpromo");
  });

  it("menampilkan tagihan klinik lama sebagai tidak tercatat per program", async () => {
    pasang({ invoices: [invoice({
      discount: 20, voucher_discount: null, diskon_kategori: null,
      invoice_items: [{ qty: 2, harga: 100, diskon_persen: 0, promo_id: null, promo_discount: null }],
    })] });
    const rincian = potong(await render(), "05 · RINCIAN PER TRANSAKSI");
    expect(rincian).toContain("tidak tercatat per program");
    expect(rincian).toContain("INV-1");
  });
});

it("menyediakan kolom unduhan Excel untuk ringkasan program dan rinciannya", async () => {
  pasang({ sales: [sale()], invoices: [invoice({ voucher_code: "HEMAT10", voucher_discount: 5, discount: 25, total: 175 })] });
  const host = document.createElement("div");
  host.innerHTML = await render();
  const bagian = displaySections(host.querySelector("#laporan-isi") as HTMLElement);
  const tabel = bagian.filter(part => part.name.startsWith("Tabel "));
  const ringkasan = tabel.find(part => part.rows[0]?.includes("Program") && part.rows[0]?.includes("Total potongan"));
  expect(ringkasan?.rows[0]).toEqual([
    "Jenis", "Program", "Transaksi", "Baris kena", "Unit kena", "Total potongan",
    "Rata-rata / transaksi", "Omzet bruto", "Omzet netto", "Pemakaian / batas",
  ]);
  const rincian = tabel.find(part => part.rows[0]?.includes("Kode diketik"));
  expect(rincian?.rows[0]).toEqual([
    "Tanggal", "Cabang", "Kanal", "No. struk / invoice", "Program", "Kode diketik", "Potongan", "Kasir", "Pelanggan",
  ]);
  expect(rincian?.rows.some(row => row.includes("POS-1"))).toBe(true);
  expect(rincian?.rows.some(row => row.includes("INV-1"))).toBe(true);
});
