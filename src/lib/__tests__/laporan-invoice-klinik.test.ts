import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bikinKlienTiruan } from "@/test-support/klien-tiruan";
import { rpcStrukKasirTiruan } from "@/test-support/rpc-struk-kasir-tiruan";
import { rpcInvoiceKlinikTiruan } from "@/test-support/rpc-invoice-klinik-tiruan";
import { bikinTabelInvoiceKlinik, idKlinik } from "@/test-support/fixture-invoice-klinik";
import { STRUK_KASIR_RPC, rentangHari } from "@/lib/laporan-struk-kasir";
import { INVOICE_KLINIK_RPC, bacaInvoiceKlinikCepat } from "@/lib/laporan-invoice-klinik";

// Invoice klinik: jalur baru (satu fungsi database per rentang 7 hari) HARUS sama persis dengan jalur lama (invoice per halaman 500,
// item/snapshot per 100 id, rekam medis/resep per 100 kunjungan, refund per 100 id) di tiga laporan: Penjualan per Barang (kanal Klinik,
// halaman + unduhan memakai pemuat yang sama), Penjualan per Tenaga Penjual, Transaksi per Cabang. Data fiktif.
const state = vi.hoisted(() => ({ klien: null as unknown }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.klien }));

import { ambilPenjualanBarang } from "@/app/(app)/laporan/penjualan-barang/data";
import { ambilTenagaPenjual } from "@/app/(app)/laporan/penjual/data";
import { tarikTransaksi } from "@/lib/laporan-transaksi-server";

const t = bikinTabelInvoiceKlinik();
const tabel = { invoices: t.invoices, invoice_items: t.invoice_items, clinic_demo_invoice_snapshots: t.clinic_demo_invoice_snapshots, medical_records: t.medical_records, compounding_recipes: t.compounding_recipes, clinic_refunds: t.clinic_refunds };
const lain = { branches: t.branches, employees: t.employees, sales: [] as Record<string, unknown>[], sale_items: [] as Record<string, unknown>[] };
const sidik = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const PERIODE: [string, string][] = [["2026-11-01", "2026-11-22"], ["2026-11-10", "2026-11-17"], ["2026-11-16", "2026-11-17"], ["2026-09-01", "2026-11-22"], ["2026-10-05", "2026-10-05"]];
const lama = () => bikinKlienTiruan({ ...tabel, ...lain });
const baru = (boleh: string[] | null = null) => bikinKlienTiruan({ ...tabel, ...lain }, {
  [INVOICE_KLINIK_RPC]: rpcInvoiceKlinikTiruan(tabel, boleh),
  [STRUK_KASIR_RPC]: rpcStrukKasirTiruan({ sales: lain.sales as never, sale_items: lain.sale_items as never }, boleh),
});
const tabelInvoice = new Set(["invoices", "invoice_items", "clinic_demo_invoice_snapshots", "medical_records", "compounding_recipes", "clinic_refunds"]);
const query = (k: ReturnType<typeof bikinKlienTiruan>, nama: string[]) => k.catatan.filter(c => nama.includes(c.table));
const jml = (dari: string, sampai: string) => rentangHari(dari, sampai).length;

describe("Rincian Penjualan per Barang sumber Klinik: jalur baru == jalur lama", () => {
  beforeEach(() => { state.klien = null; });
  for (const [dari, sampai] of PERIODE) {
    it(`${dari}..${sampai}: baris, total, ringkasan, opsi dan sidik sama; query dibatasi`, async () => {
      const a = lama(), b = baru();
      state.klien = a.client;
      const hasilLama = await ambilPenjualanBarang({ dari, sampai, kanal: "Klinik", jenis: "Semua", q: "", cabangId: "", saringCabangDiQuery: false });
      state.klien = b.client;
      const hasilBaru = await ambilPenjualanBarang({ dari, sampai, kanal: "Klinik", jenis: "Semua", q: "", cabangId: "", saringCabangDiQuery: false });
      expect(hasilLama.pesanError).toBe("");
      expect(hasilBaru.pesanError).toBe("");
      expect(hasilBaru).toEqual(hasilLama);
      expect(sidik(hasilBaru)).toBe(sidik(hasilLama));
      if (dari === "2026-09-01") {
        expect(hasilBaru.rows.length).toBeGreaterThan(300);
        expect(new Set(hasilBaru.rows.map(r => r.jenis)).size).toBeGreaterThanOrEqual(3);   // Jasa, Obat, Racikan
        expect(hasilBaru.rows.some(r => r.jenis === "Racikan")).toBe(true);
      }
      expect(b.catatanRpc).toHaveLength(jml(dari, sampai));
      expect(query(b, [...tabelInvoice])).toHaveLength(0);
      expect(query(a, ["invoices", "invoice_items"]).length).toBeGreaterThanOrEqual(2);
    });
  }

  it("saringan cabang (halaman: di query) memberi hasil sama dengan jalur lama", async () => {
    state.klien = lama().client;
    const hasilLama = await ambilPenjualanBarang({ dari: "2026-11-01", sampai: "2026-11-22", kanal: "Klinik", jenis: "Semua", q: "", cabangId: "cab-b", saringCabangDiQuery: true });
    const b = baru();
    state.klien = b.client;
    const hasilBaru = await ambilPenjualanBarang({ dari: "2026-11-01", sampai: "2026-11-22", kanal: "Klinik", jenis: "Semua", q: "", cabangId: "cab-b", saringCabangDiQuery: true });
    expect(hasilBaru.rows.length).toBeGreaterThan(10);
    expect(hasilBaru).toEqual(hasilLama);
    expect(hasilBaru.rows.every(r => r.cabangId === "cab-b")).toBe(true);
    expect(b.catatanRpc.every(p => p.args.p_branch_id === "cab-b" && p.args.p_dengan_item === true)).toBe(true);
  });

  it("fungsi belum ada di database: jalur lama dipakai, hasil sama (aplikasi boleh rilis lebih dulu)", async () => {
    const tanpa = bikinKlienTiruan({ ...tabel, ...lain }, {});
    state.klien = tanpa.client;
    const hasil = await ambilPenjualanBarang({ dari: "2026-11-01", sampai: "2026-11-22", kanal: "Klinik", jenis: "Semua", q: "", cabangId: "", saringCabangDiQuery: false });
    state.klien = lama().client;
    const hasilLama = await ambilPenjualanBarang({ dari: "2026-11-01", sampai: "2026-11-22", kanal: "Klinik", jenis: "Semua", q: "", cabangId: "", saringCabangDiQuery: false });
    expect(hasil).toEqual(hasilLama);
    expect(tanpa.catatanRpc).toHaveLength(1);
    expect(query(tanpa, ["invoices"]).length).toBeGreaterThan(0);
  });

  it("hak baca dari database (hanya cabang boleh) menentukan baris", async () => {
    state.klien = baru(["cab-a"]).client;
    const hasil = await ambilPenjualanBarang({ dari: "2026-11-01", sampai: "2026-11-22", kanal: "Klinik", jenis: "Semua", q: "", cabangId: "", saringCabangDiQuery: false });
    expect(hasil.pesanError).toBe("");
    expect(hasil.rows.length).toBeGreaterThan(0);
    expect(hasil.rows.every(r => r.cabangId === "cab-a")).toBe(true);
  });

  it("batas waktu database tampil sebagai pesan batas waktu; izin sebagai pesan izin (bukan pesan umum)", async () => {
    for (const [code, message, kode] of [["57014", "canceling statement due to statement timeout", "batas_waktu"], ["42501", "permission denied for function laporan_invoice_klinik", "izin"]] as const) {
      state.klien = bikinKlienTiruan({ ...tabel, ...lain }, { [INVOICE_KLINIK_RPC]: () => ({ data: null, error: { code, message } }) }).client;
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const hasil = await ambilPenjualanBarang({ dari: "2026-11-01", sampai: "2026-11-22", kanal: "Klinik", jenis: "Semua", q: "", cabangId: "", saringCabangDiQuery: false });
      expect(hasil.rows).toEqual([]);
      expect(hasil.kodeError).toBe(kode);
      expect(hasil.pesanError).not.toBe("Laporan belum bisa dibaca. Coba lagi atau pilih periode lebih pendek.");
    }
    vi.restoreAllMocks();
  });
});

describe("Penjualan per Tenaga Penjual (bagian Klinik): jalur baru == jalur lama", () => {
  for (const [dari, sampai, cabangId] of [["2026-11-01", "2026-11-22", ""], ["2026-11-10", "2026-11-17", ""], ["2026-09-01", "2026-11-22", ""], ["2026-11-01", "2026-11-22", "cab-b"]] as const) {
    it(`${dari}..${sampai}${cabangId ? " cabang " + cabangId : ""}: baris sama; tidak menyentuh tabel invoice`, async () => {
      const a = lama(), b = baru();
      state.klien = a.client;
      const hasilLama = await ambilTenagaPenjual({ dari, sampai, cabangId });
      state.klien = b.client;
      const hasilBaru = await ambilTenagaPenjual({ dari, sampai, cabangId });
      expect(hasilLama.pesanError).toBe("");
      expect(hasilBaru.pesanError).toBe("");
      expect(hasilBaru.rows.filter(r => r.kanal === "Klinik").length).toBeGreaterThan(10);
      expect(hasilBaru).toEqual(hasilLama);
      expect(sidik(hasilBaru)).toBe(sidik(hasilLama));
      expect(query(b, [...tabelInvoice])).toHaveLength(0);
      expect(b.catatanRpc.filter(p => p.nama === INVOICE_KLINIK_RPC)).toHaveLength(jml(dari, sampai));
    });
  }
});

describe("Transaksi per Cabang: jalur baru == jalur lama", () => {
  for (const [dari, sampai, saring] of [["2026-11-01", "2026-11-22", {}], ["2026-11-10", "2026-11-17", {}], ["2026-09-01", "2026-11-22", {}], ["2026-11-01", "2026-11-22", { cabangId: "cab-b" }], ["2026-11-01", "2026-11-22", { cabangNama: "Cabang A" }]] as const) {
    it(`${dari}..${sampai} ${JSON.stringify(saring)}: transaksi (jumlah item per invoice, omzet - refund) sama`, async () => {
      const a = lama(), b = baru();
      state.klien = a.client;
      const hasilLama = await tarikTransaksi(dari, sampai, saring);
      state.klien = b.client;
      const hasilBaru = await tarikTransaksi(dari, sampai, saring);
      expect(hasilBaru.trx.filter(x => x.kanal === "Klinik").length).toBeGreaterThan(10);
      expect(hasilBaru).toEqual(hasilLama);
      expect(sidik(hasilBaru)).toBe(sidik(hasilLama));
      expect(query(b, ["invoices", "invoice_items"])).toHaveLength(0);
      const rpc = b.catatanRpc.filter(p => p.nama === INVOICE_KLINIK_RPC);
      expect(rpc).toHaveLength(jml(dari, sampai));
      expect(rpc.every(p => p.args.p_dengan_item === false)).toBe(true);
    });
  }
});

describe("bacaInvoiceKlinikCepat", () => {
  const klien = (fn = rpcInvoiceKlinikTiruan(tabel)) => bikinKlienTiruan({}, { [INVOICE_KLINIK_RPC]: fn }).client;

  it("tanpa rpc di klien -> null (pembaca lama)", async () => {
    expect(await bacaInvoiceKlinikCepat({}, { dari: "2026-11-01", sampai: "2026-11-02" })).toBeNull();
  });
  it("gabungan rentang: tiap invoice sekali, urut id, item menunjuk invoice yang terbaca, refund hanya milik invoice itu", async () => {
    const h = await bacaInvoiceKlinikCepat(klien(), { dari: "2026-09-01", sampai: "2026-11-22" });
    expect(h).not.toBeNull();
    const ids = h!.invoices.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(h!.items.length).toBeGreaterThan(100);
    expect(h!.items.every(i => ids.includes(i.invoice_id))).toBe(true);
    expect(h!.refunds.every(r => ids.includes(r.invoice_id))).toBe(true);
    expect(h!.invoices.every(i => i.voided_at === null)).toBe(true);
    expect(h!.invoices.reduce((a, i) => a + i.n_item, 0)).toBe(h!.items.length);
  });
  it("denganItem=false: hanya invoice dan jumlah itemnya", async () => {
    const h = await bacaInvoiceKlinikCepat(klien(), { dari: "2026-11-01", sampai: "2026-11-22", denganItem: false });
    expect(h!.items).toEqual([]);
    expect(h!.demo).toEqual([]);
    expect(h!.invoices.some(i => i.n_item > 0)).toBe(true);
  });
  it("hitungan tidak cocok / bentuk salah -> galat 'tidak lengkap'", async () => {
    await expect(bacaInvoiceKlinikCepat(klien(() => ({ data: { n_invoice: 2, n_item: 0, invoices: [], items: [], demo: [], racikan: [], refunds: [] }, error: null })), { dari: "2026-11-01", sampai: "2026-11-02" })).rejects.toThrow(/tidak lengkap/);
    await expect(bacaInvoiceKlinikCepat(klien(() => ({ data: null, error: null })), { dari: "2026-11-01", sampai: "2026-11-02" })).rejects.toThrow(/tidak lengkap/);
  });
  it("invoice ganda antar rentang / item tanpa invoice -> galat", async () => {
    const inv = { id: idKlinik(1), visit_id: "v", invoice_no: "x", created_at: "2026-11-01T00:00:00Z", paid_status: "paid", subtotal: 1, discount: 0, total: 1, salesperson_id: null, voided_at: null, n_item: 0, visits: { branch_id: null, customer_id: null, doctor_id: null, branches: null, customers: null, pets: null } };
    await expect(bacaInvoiceKlinikCepat(klien(() => ({ data: { n_invoice: 1, n_item: 0, invoices: [inv], items: [], demo: [], racikan: [], refunds: [] }, error: null })), { dari: "2026-11-01", sampai: "2026-11-15" })).rejects.toThrow(/identitas invoice/);
    await expect(bacaInvoiceKlinikCepat(klien(() => ({ data: { n_invoice: 0, n_item: 1, invoices: [], items: [{ id: idKlinik(2), invoice_id: idKlinik(9) }], demo: [], racikan: [], refunds: [] }, error: null })), { dari: "2026-11-01", sampai: "2026-11-02" })).rejects.toThrow(/item tanpa invoice/);
  });
  it("galat database selain 'fungsi belum ada' dilempar dengan kodenya; fungsi hilang di tengah jalan tidak diam-diam jatuh ke jalur lama", async () => {
    await expect(bacaInvoiceKlinikCepat(klien(() => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } })), { dari: "2026-11-01", sampai: "2026-11-02" })).rejects.toMatchObject({ code: "57014" });
    let n = 0;
    const hilang = () => (++n === 1 ? rpcInvoiceKlinikTiruan(tabel)({ p_from: "2026-11-01T00:00:00+07:00", p_to: "2026-11-07T23:59:59.999+07:00" }) : { data: null, error: { code: "PGRST202", message: `Could not find the function public.${INVOICE_KLINIK_RPC} in the schema cache` } });
    await expect(bacaInvoiceKlinikCepat(klien(hilang), { dari: "2026-11-01", sampai: "2026-11-22" })).rejects.toThrow(/hilang di tengah/);
  });
});
