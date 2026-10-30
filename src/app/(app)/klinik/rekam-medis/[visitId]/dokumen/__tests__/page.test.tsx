import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// IND-06: dokumen rekam medis mencetak uang. Bentuk lama "lunas di meja" (dp_amount 0,
// tanpa baris invoice_payments) sempat tercetak sebagai utang penuh. Tes ini merender
// halamannya sungguhan dengan data sumber tiruan, bukan sekadar memanggil penolongnya.
const state = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/clinic-record-addenda", () => ({
  loadRecordAddenda: async () => ({ state: "ok", rows: [] }),
  addendumAuthor: () => "—",
}));
vi.mock("@/components/PrintButton", () => ({ PrintButton: () => null }));
vi.mock("@/lib/supabase/server", () => {
  class Query {
    constructor(private table: string) {}
    select() { return this; }
    eq() { return this; }
    is() { return this; }
    in() { return this; }
    order() { return this; }
    limit() { return this; }
    private hasil() {
      return state.tables[this.table] ?? { data: [], error: null };
    }
    async maybeSingle() {
      const { data, error } = this.hasil();
      return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
    }
    then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
      return Promise.resolve(this.hasil()).then(resolve);
    }
  }
  return {
    createClient: async () => ({
      from: (table: string) => new Query(table),
      storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
    }),
  };
});

import DokumenRekamMedisPage from "../page";

const render = async () => renderToStaticMarkup(
  await DokumenRekamMedisPage({ params: Promise.resolve({ visitId: "vis-1" }) }),
);

/** Nilai yang BENAR-BENAR tercetak di sebelah satu label pada blok RINCIAN PEMBAYARAN. */
const nilai = (penuh: string, label: string) => {
  const awal = penuh.indexOf("RINCIAN PEMBAYARAN");
  const html = awal < 0 ? penuh : penuh.slice(awal);
  const posisi = html.indexOf(`>${label}</span>`);
  if (posisi < 0) return null;
  const cocok = html.slice(posisi).match(/<\/span><span[^>]*>:\s*([\s\S]*?)<\/span>/);
  return cocok ? cocok[1].replace(/<!--[\s\S]*?-->/g, "").trim() : null;
};

const dasar = (invoices: unknown[], payments: unknown[] = []) => {
  state.tables = {
    visits: { data: { id: "vis-1", poli: "Poli Umum", dokter: "drh. Fiktif", keluhan: "-",
      status: "Selesai", created_at: "2026-11-03T02:00:00Z",
      pets: { name: "Pasien Fiktif", species: "Kucing", breed: null, dob: null, gender: null, weight: null, photo_url: null },
      customers: { name: "Pemilik Fiktif", phone: "08000000001", address: null, tier: null },
      branches: { name: "Klinik Fiktif" } }, error: null },
    medical_records: { data: { id: "mr-1", diagnosis: "Diagnosis fiktif", therapy: null, anamnesis: null,
      suhu: null, berat: null, gejala_klinis: null, hasil_penunjang: null, penunjang_urls: [],
      follow_up: null, catatan_resep: null, created_at: "2026-11-03T02:10:00Z" }, error: null },
    consents: { data: [], error: null },
    prescription_items: { data: [], error: null },
    inpatient_records: { data: [], error: null },
    invoices: { data: invoices, error: null },
    invoice_payments: { data: payments, error: null },
  };
};

const tagihan = (over: Record<string, unknown> = {}) => ({
  id: "inv-1", invoice_no: "INV-202611-0001", created_at: "2026-11-03T03:00:00Z",
  metode_bayar: "Tunai", total: 100_000, dp_amount: 0, paid_status: "Lunas",
  reissued_from: null, ...over,
});

beforeEach(() => { state.tables = {}; });

describe("cetak rekam medis — rincian pembayaran", () => {
  it("menggabungkan label susulan PR341 dengan rincian tagihan bertahap PR343", async () => {
    dasar(
      [tagihan({ id: "inv-1", total: 100_000 }),
       tagihan({ id: "inv-2", invoice_no: "INV-202611-0002", total: 200_000, paid_status: "DP" })],
      [{ invoice_id: "inv-1", amount: 100_000 }, { invoice_id: "inv-2", amount: 50_000 }],
    );
    state.tables.prescription_items = { data: [{ nama_obat: "Obat susulan UJI", qty: 1, satuan: "pcs",
      aturan_pakai: "Instruksi UJI", jenis: "obat", susulan_at: "2026-10-30T01:00:00Z",
      susulan_by_name: "Dokter UJI", susulan_source: "dokter" }], error: null };
    const html = await render();
    expect(html).toContain("Obat susulan UJI");
    expect(html).toContain("Susulan · Dokter UJI");
    expect(nilai(html, "Total Tagihan")).toBe("Rp 300.000");
    expect(nilai(html, "Sudah Dibayar")).toBe("Rp 150.000");
    expect(nilai(html, "Sisa Tagihan")).toBe("Rp 150.000");
    expect(html).toContain("Mencakup 2 tagihan tahap");
  });

  it("tagihan biasa satu metode yang lunas di meja tercetak lunas, bukan berutang", async () => {
    dasar([tagihan()]);
    const html = await render();
    expect(nilai(html, "Sudah Dibayar")).toBe("Rp 100.000");
    expect(nilai(html, "Sisa Tagihan")).toBe("Rp 0");
    expect(nilai(html, "Status")).toBe("Lunas");
  });

  it("uang muka 40.000 tercetak sebagai DP, bukan lunas", async () => {
    dasar([tagihan({ total: 100_000, dp_amount: 40_000, paid_status: "DP" })]);
    const html = await render();
    expect(nilai(html, "Sudah Dibayar")).toBe("Rp 40.000");
    expect(nilai(html, "Sisa Tagihan")).toBe("Rp 60.000");
    expect(nilai(html, "Status")).toBe("DP");
  });

  it("checkout campuran: uangnya di baris pembayaran, tidak dihitung dua kali", async () => {
    dasar([tagihan()], [
      { invoice_id: "inv-1", amount: 60_000 }, { invoice_id: "inv-1", amount: 40_000 },
    ]);
    const html = await render();
    expect(nilai(html, "Sudah Dibayar")).toBe("Rp 100.000");
    expect(nilai(html, "Status")).toBe("Lunas");
  });

  it("beberapa tagihan tahap rawat inap dijumlahkan apa adanya", async () => {
    dasar(
      [tagihan({ id: "inv-1", total: 100_000, paid_status: "Lunas" }),
       tagihan({ id: "inv-2", invoice_no: "INV-202611-0002", total: 200_000, paid_status: "DP" })],
      [{ invoice_id: "inv-1", amount: 100_000 }, { invoice_id: "inv-2", amount: 50_000 }],
    );
    const html = await render();
    expect(nilai(html, "Total Tagihan")).toBe("Rp 300.000");
    expect(nilai(html, "Sudah Dibayar")).toBe("Rp 150.000");
    expect(nilai(html, "Sisa Tagihan")).toBe("Rp 150.000");
    expect(nilai(html, "Status")).toBe("DP");
    expect(html).toContain("Mencakup 2 tagihan tahap");
  });

  it("kwitansi tahap yang dibatalkan: tercetak belum lunas walau statusnya belum disegarkan", async () => {
    dasar([tagihan({ total: 100_000, paid_status: "Lunas" })], [
      { invoice_id: "inv-1", amount: 100_000 }, { invoice_id: "inv-1", amount: -100_000 },
    ]);
    const html = await render();
    expect(nilai(html, "Sudah Dibayar")).toBe("Rp 0");
    expect(nilai(html, "Sisa Tagihan")).toBe("Rp 100.000");
    expect(nilai(html, "Status")).toBe("Belum Lunas");
  });

  it("tagihan pengganti hasil terbit ulang tidak menggandakan uang yang dialihkan", async () => {
    dasar([tagihan({ id: "inv-2", reissued_from: "inv-1", total: 100_000, paid_status: "Lunas" })],
      [{ invoice_id: "inv-2", amount: 100_000 }]);
    const html = await render();
    expect(nilai(html, "Sudah Dibayar")).toBe("Rp 100.000");
    expect(nilai(html, "Status")).toBe("Lunas");
  });

  it("gagal membaca tagihan tidak boleh tercetak sebagai nol", async () => {
    dasar([tagihan()]);
    state.tables.invoices = { data: null, error: { code: "57014", message: "canceled" } };
    const html = await render();
    expect(html).toContain("Belum dapat dibaca");
    expect(html).not.toContain("Sudah Dibayar");
  });

  it("gagal membaca baris pembayaran juga menahan angkanya", async () => {
    dasar([tagihan()]);
    state.tables.invoice_payments = { data: null, error: { code: "PGRST200", message: "relationship" } };
    const html = await render();
    expect(html).toContain("Belum dapat dibaca");
  });
});
