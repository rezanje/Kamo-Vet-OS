import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Layar tagihan rawat inap berjalan: empat bagian wajib ada — belum ditagih,
// tagihan tahap, riwayat pembayaran, dan terima pembayaran.
const state = vi.hoisted(() => ({
  data: null as unknown,
  shift: { id: "shift-1" } as { id: string } | null,
  role: "STAFF" as string,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => state.shift }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({ mode_pkp: false, ppn_rate: 11 }) }));
vi.mock("@/lib/tagihan-berjalan-server", () => ({ muatTagihanBerjalan: async () => state.data }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "kasir-1" } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: state.role, min_dp_percent: 50 } }) }) }),
    }),
  }),
}));

import TagihanRawatInapPage from "../page";

const dasar = () => ({
  record: { id: "rec-1", visit_id: "vis-1", branch_id: "b1", admitted_at: "2026-10-27T00:00:00Z", discharged_at: null as string | null },
  visit: { id: "vis-1", status: "Diperiksa", poli: "Poli Umum", dokter: "drh. A", customer_id: "c1" },
  pasien: "Bimo · Kucing", pemilik: "Reza", telepon: "0812",
  belumDitagih: [{ id: "p1", nama_obat: "Infus NaCl", qty: 2, harga: 50_000, jenis: "obat", item_id: null, satuan: "kolf", compound_recipe_id: null }],
  tahap: [{ id: "inv-1", invoice_no: "INV-1", created_at: "2026-10-27T01:00:00Z", total: 300_000, dp_amount: 0, paid_status: "Belum Lunas", voided_at: null, dibayar: 100_000, sisa: 200_000 }],
  piutang: 200_000,
  kwitansi: [{
    id: "kwt-1", no_kwitansi: "KWT-202610-0001", tanggal: "2026-10-27", total: 100_000, status: "aktif",
    catatan: null as string | null, void_reason: null as string | null, created_at: "2026-10-27T02:00:00Z", kasir: "Wowo",
    bagian: [{ urutan: 1, metode: "Tunai", amount: 60_000, kas_code: "1101" }, { urutan: 2, metode: "QRIS", amount: 40_000, kas_code: "1102" }],
  }],
  uangMuka: [{ id: "um-1", no_uang_muka: "UMK-202610-0001", tanggal: "2026-10-27", amount: 50_000, applied: 0, status: "aktif" }],
  saldoUangMuka: 50_000,
  riwayatUangTerpasang: true,
});

const render = async () => renderToStaticMarkup(
  await TagihanRawatInapPage({ params: Promise.resolve({ id: "rec-1" }), searchParams: Promise.resolve({}) }),
);

beforeEach(() => { state.data = dasar(); state.shift = { id: "shift-1" }; state.role = "STAFF"; });

describe("layar tagihan rawat inap berjalan", () => {
  it("menampilkan keempat bagian wajibnya", async () => {
    const html = await render();
    for (const judul of ["BELUM DITAGIH", "TAGIHAN TAHAP", "RIWAYAT PEMBAYARAN", "TERIMA PEMBAYARAN"]) {
      expect(html).toContain(judul);
    }
  });

  it("tagihan tahap menyebut nomor, total, dibayar, sisa, dan statusnya", async () => {
    const html = await render();
    expect(html).toContain("INV-1");
    expect(html).toContain("Rp 300.000");
    expect(html).toContain("Rp 100.000");
    expect(html).toContain("Rp 200.000");
    expect(html).toContain("Belum Lunas");
  });

  it("riwayat pembayaran memperlihatkan nomor kwitansi, metode per bagian, dan kasirnya", async () => {
    const html = await render();
    expect(html).toContain("KWT-202610-0001");
    expect(html).toContain("Tunai Rp 60.000 + QRIS Rp 40.000");
    expect(html).toContain("Wowo");
    expect(html).toContain("DP 1");
  });

  it("menyediakan cetak invoice tahap dan cetak kwitansi", async () => {
    const html = await render();
    expect(html).toContain("/klinik/pembayaran/vis-1/invoice?invoice_id=inv-1");
    expect(html).toContain("/klinik/rawat-inap/rec-1/tagihan/kwitansi/kwt-1");
  });

  it("menyebut saldo uang muka pemilik, piutang, dan uang muka minimal", async () => {
    const html = await render();
    expect(html).toContain("UANG MUKA PEMILIK");
    expect(html).toContain("Rp 50.000");
    expect(html).toContain("TOTAL PIUTANG");
    expect(html).toContain("UANG MUKA MINIMAL");
    expect(html).toContain("50%");
  });

  it("tanpa shift klinik terbuka, uang terkunci tapi tagihannya tetap terbaca", async () => {
    state.shift = null;
    const html = await render();
    expect(html).toContain("Shift klinik belum dibuka");
    expect(html).toContain("INV-1");
    expect(html).not.toContain('name="parts"');
  });

  it("rawat inap yang sudah pulang tetap bisa dibuka untuk melunasi sisanya", async () => {
    const data = dasar();
    data.record.discharged_at = "2026-10-29T00:00:00Z";
    state.data = data;
    const html = await render();
    expect(html).toContain("sudah pulang");
    expect(html).toContain("TERIMA PEMBAYARAN");
  });

  it("form terima pembayaran dan tagih sekarang tersedia saat shift terbuka", async () => {
    const html = await render();
    expect(html).toContain('name="parts"');
    expect(html).toContain("Batalkan");
  });

  // FIN-09/UF-09: riwayat uang yang belum terbaca tidak boleh tampak seperti "belum ada
  // pembayaran"; selama itu, menerima uang dan membatalkan kwitansi dikunci.
  it("riwayat uang yang belum tersedia mengunci aksi uang dan menjelaskan sebabnya", async () => {
    state.data = { ...dasar(), riwayatUangTerpasang: false, kwitansi: [], uangMuka: [], saldoUangMuka: 0 };
    const html = await render();
    expect(html).toContain("Riwayat pembayaran dan uang muka belum tersedia");
    expect(html).toContain("BUKAN berarti belum ada uang masuk");
    expect(html).not.toContain('name="parts"');
    // Tagihannya sendiri tetap terbaca supaya staf tidak kehilangan konteks.
    expect(html).toContain("INV-1");
  });

  // FIN-03: jalan keluar untuk kwitansi yang uang mukanya terlanjur dipakai.
  it("uang muka yang sudah terpakai menawarkan pelepasan hanya untuk peran keuangan", async () => {
    const data = dasar();
    data.uangMuka[0] = { ...data.uangMuka[0], applied: 50_000 };
    state.data = data;
    expect(await render()).not.toContain("Lepas pemakaian");
    state.role = "FINANCE";
    const html = await render();
    expect(html).toContain("Lepas pemakaian");
    expect(html).toContain("terpakai Rp 50.000");
  });

  it("kwitansi yang dibatalkan ditandai beserta alasannya, bukan dihapus", async () => {
    const data = dasar();
    data.kwitansi[0] = { ...data.kwitansi[0], status: "batal", void_reason: "Salah nominal" };
    state.data = data;
    const html = await render();
    expect(html).toContain("Dibatalkan");
    expect(html).toContain("Salah nominal");
    expect(html).toContain("KWT-202610-0001");
  });
});
