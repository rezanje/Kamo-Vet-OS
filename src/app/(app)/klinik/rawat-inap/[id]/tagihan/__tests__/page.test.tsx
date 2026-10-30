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
  rincianDitagih: [{ id: "line-1", invoice_id: "inv-1", prescription_item_id: null, deskripsi: "Jasa tersimpan", qty: 2, harga: 150_000, diskon_persen: 0 }],
  tahap: [{ id: "inv-1", invoice_no: "INV-1", created_at: "2026-10-27T01:00:00Z", subtotal: 300_000, discount: 0, tax: 0, total: 300_000, dp_amount: 0, paid_status: "Belum Lunas", voided_at: null, dibayar: 100_000, sisa: 200_000, correction_pending: false }],
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

const render = async (query: { success?: string; error?: string } = {}) => renderToStaticMarkup(
  await TagihanRawatInapPage({ params: Promise.resolve({ id: "rec-1" }), searchParams: Promise.resolve(query) }),
);

beforeEach(() => { state.data = dasar(); state.shift = { id: "shift-1" }; state.role = "STAFF"; });

describe("layar tagihan rawat inap berjalan", () => {
  it.each(["tidak-dikenal", "__proto__", "constructor", "toString"])("success tak dikenal diabaikan tanpa modal/banner (%s)", async (success) => {
    const html = await render({ success });
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain('class="p2ban"');
    expect(html).toContain("RIWAYAT PEMBAYARAN");
  });

  it.each([
    ["tagih", "Tagihan tahap terbit."],
    ["batal", "Kwitansi dibatalkan."],
    ["lepas", "Pemakaian uang muka dilepas."],
  ])("pesan sukses %s tetap tersedia", async (success, message) => {
    const html = await render({ success });
    expect(html).toContain(message);
    expect(html).not.toContain('role="dialog"');
  });

  it.each(["normal", "tanpa shift", "riwayat belum terbaca"])("tanpa pending tidak menyisakan heading/form/helper (%s)", async (kondisi) => {
    const data = dasar();
    data.belumDitagih = [];
    if (kondisi === "tanpa shift") state.shift = null;
    if (kondisi === "riwayat belum terbaca") data.riwayatUangTerpasang = false;
    state.data = data;
    const html = await render();
    for (const teks of ["BELUM DITAGIH", "Belum ditagih", "Tetap manual:", "sudah masuk tagihan tahap", "baris menunggu ditagih"]) {
      expect(html).not.toContain(teks);
    }
    expect(html).not.toContain('name="ids"');
    expect(html).toContain("RINCIAN TAGIHAN");
    expect(html).toContain("Jasa tersimpan");
    expect(html).toContain("Total transaksi: Rp 300.000");
    expect(html).toContain("TAGIHAN TAHAP");
    expect(html).toContain("RIWAYAT PEMBAYARAN");
    if (kondisi === "tanpa shift") expect(html).toContain("Shift klinik belum dibuka");
    if (kondisi === "riwayat belum terbaca") expect(html).toContain("Riwayat pembayaran dan uang muka belum tersedia");
  });

  it("pending tetap ditandai singkat dan dapat ditagih manual tanpa paragraf penjelasan", async () => {
    const html = await render();
    expect(html).toContain(">Belum ditagih<");
    expect(html).toContain("Infus NaCl");
    expect(html).toContain('name="ids"');
    expect(html).toContain("Tagih sekarang");
    expect(html).not.toContain("pending, belum menjadi piutang / omzet");
    expect(html).not.toContain("Tetap manual:");
  });

  it("menampilkan keempat bagian wajibnya", async () => {
    const html = await render();
    for (const judul of ["Belum ditagih", "TAGIHAN TAHAP", "RIWAYAT PEMBAYARAN", "TERIMA PEMBAYARAN"]) {
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

  it("rekap ringkas hanya berisi Total transaksi, DP, Sisa pembayaran tanpa catatan berulang", async () => {
    const html = await render();
    const cards = html.match(/class="card"[^]*?<\/div><\/div><\/div>/g)!;
    expect(cards).toHaveLength(3);
    expect(cards[0]).toContain("TOTAL TRANSAKSI");
    expect(cards[0]).toContain("Rp 400.000");
    expect(cards[1]).toContain(">DP<");
    expect(cards[1]).toContain("Rp 150.000");
    expect(cards[2]).toContain("SISA PEMBAYARAN");
    expect(cards[2]).toContain("Rp 250.000");
    for (const prose of [
      "termasuk estimasi belum diterbitkan", "bersih, termasuk DP awal dan saldo uang muka",
      "termasuk estimasi item belum diterbitkan", "Total invoice diterbitkan:",
      "Estimasi pending (termasuk PPN", "Piutang dibukukan:", "Saldo uang muka belum terpakai:",
    ]) expect(html).not.toContain(prose);
    expect(html).toContain("Total transaksi: Rp 400.000");
    expect(html).toContain("DP: Rp 150.000");
    expect(html).toContain("Sisa pembayaran: Rp 250.000");
  });

  it("rekap menampilkan header DP walau saldo wallet nol, bukan kartu minimum berulang", async () => {
    const data = dasar();
    data.tahap[0] = { ...data.tahap[0], total: 1_300_000, dp_amount: 500_000, dibayar: 500_000, sisa: 800_000, paid_status: "DP" };
    data.belumDitagih[0] = { ...data.belumDitagih[0], qty: 1, harga: 200_000 };
    data.saldoUangMuka = 0;
    data.uangMuka = [];
    data.kwitansi = [];
    state.data = data;
    const html = await render();
    expect(html).toContain("TOTAL TRANSAKSI");
    expect(html).toContain(">DP<");
    expect(html).toContain("SISA PEMBAYARAN");
    expect(html).toContain("Rp 1.500.000");
    expect(html).toContain("Rp 500.000");
    expect(html).toContain("Rp 1.000.000");
    expect(html).not.toContain("berlaku tiap tagihan tahap");
    expect(html).not.toContain("Belum ada pembayaran untuk kunjungan ini");
  });

  it("rincian invoice tersimpan dan pending terpisah; footer tidak menghitung ulang harga klinis", async () => {
    const data = dasar();
    data.tahap[0] = { ...data.tahap[0], subtotal: 900_000, discount: 100_000, tax: 88_000, total: 888_000, dp_amount: 500_000, dibayar: 500_000, sisa: 388_000, paid_status: "DP" };
    data.rincianDitagih[0] = { ...data.rincianDitagih[0], qty: 1, harga: 1_000_000, diskon_persen: 10 };
    data.belumDitagih[0] = { ...data.belumDitagih[0], qty: 1, harga: 200_000 };
    data.saldoUangMuka = 0;
    state.data = data;
    const html = await render();
    expect(html).toContain("RINCIAN TAGIHAN");
    expect(html).toContain("Jasa tersimpan");
    expect(html).toContain("Subtotal tersimpan Rp 900.000");
    expect(html).toContain("Diskon nota Rp 100.000");
    expect(html).toContain("PPN Rp 88.000");
    expect(html).toContain("Total invoice Rp 888.000");
    expect(html).toContain("Belum ditagih");
    expect(html).toContain("Total transaksi: Rp 1.088.000");
    expect(html).toContain("Sisa pembayaran: Rp 588.000");
    expect(html).toContain("Rp 294.000");
    expect(html.match(/class="card"/g)).toHaveLength(3);
    expect(html).toContain("DP lanjutan opsional");
    expect(html).not.toContain("Kurang Rp");
  });

  it("tanpa invoice aktif selesai, minimum awal tetap ditampilkan", async () => {
    const data = dasar();
    data.tahap = [];
    data.rincianDitagih = [];
    data.saldoUangMuka = 0;
    state.data = data;
    const html = await render();
    expect(html).toContain("Uang muka minimal 50%");
    expect(html).toContain("Kurang Rp 50.000");
    expect(html).not.toContain("Isi saran 50% sisa total");
  });

  it("invoice yang koreksinya belum selesai tidak membuka pengecualian DP lanjutan", async () => {
    const data = dasar();
    data.tahap[0].correction_pending = true;
    data.saldoUangMuka = 0;
    state.data = data;
    const html = await render();
    expect(html).toContain("Koreksi belum selesai");
    expect(html).toContain("Uang muka minimal 50%");
    expect(html).not.toContain("Isi saran 50% sisa total");
  });

  it("invoice nol rupiah tidak menonaktifkan minimum DP awal sebenarnya", async () => {
    const data = dasar();
    data.tahap[0] = { ...data.tahap[0], total: 0, dibayar: 0, sisa: 0 };
    data.saldoUangMuka = 0;
    state.data = data;
    const html = await render();
    expect(html).toContain("Uang muka minimal 50%");
    expect(html).not.toContain("Isi saran 50% sisa total");
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
