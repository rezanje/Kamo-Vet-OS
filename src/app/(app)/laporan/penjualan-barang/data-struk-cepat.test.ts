import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bikinKlienTiruan } from "@/test-support/klien-tiruan";
import { rpcStrukKasirTiruan } from "@/test-support/rpc-struk-kasir-tiruan";
import { STRUK_KASIR_RPC, rentangHari } from "@/lib/laporan-struk-kasir";
import { lineDiscount } from "@/lib/pos-calc";

// Penjualan per Barang sumber Kasir: jalur baru (satu fungsi database per rentang 7 hari) HARUS sama persis dengan jalur lama
// (struk per halaman 500 + item per 100 id). Data fiktif; "database" tiruan memakai aturan fungsi yang sama.
const state = vi.hoisted(() => ({ klien: null as unknown }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.klien }));

import { ambilPenjualanBarang } from "./data";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CAB = ["cab-a", "cab-b", "cab-c"];
// 360 struk, 1 Sep - 22 Nov, tengah hari WIB supaya perbandingan teks jalur lama tidak terganggu batas jam.
const sales: Record<string, unknown>[] = [];
const sale_items: Record<string, unknown>[] = [];
for (let i = 0; i < 360; i++) {
  const hari = new Date(Date.UTC(2026, 8, 1) + Math.floor(i * 82 / 359) * 86_400_000).toISOString().slice(0, 10);
  const online = i % 11 === 0, batal = i % 17 === 0, rencana = i % 23 === 0;
  const baris = [0, 1, 2].slice(0, 1 + (i % 3)).map(j => ({
    id: id(100_000 + i * 3 + j), sale_id: id(i + 1), nama: `Barang ${(i + j) % 9}`, qty: 1 + (j % 2), harga: 12_500 * (1 + ((i + j) % 4)), item_id: null,
    satuan: null, faktor: 1,
    item_discount_type: (["nominal", "percent", null] as const)[(i + j) % 3], item_discount_value: [1000, 10, 0][(i + j) % 3], promo_discount: j === 1 ? 500 : 0,
    service_performers: i % 5 === 0 && j === 0 ? { staff_id: "stf-1", staff_name: "Staf Satu" } : null,
  }));
  const kotor = baris.reduce((a, b) => a + b.qty * b.harga - lineDiscount(b), 0);
  sales.push({
    id: id(i + 1), branch_id: CAB[i % 3], customer_id: i % 4 ? id(900 + i) : null, no_struk: `POS-${i + 1}`, created_at: `${hari}T05:${String(i % 60).padStart(2, "0")}:00Z`,
    channel: online ? "shopee" : null, total: Math.round(kotor), merchant_fee_total: online ? 0 : i % 7 === 0 ? 100 : 0,
    payment_plan: rencana ? [{ method: "Tunai", amount: 1 }] : null, payments_finalized_at: null, voided_at: batal ? `${hari}T06:00:00Z` : null,
    salesperson_id: null, cashier_id: null,
    branches: { name: `Cabang ${CAB[i % 3].slice(-1).toUpperCase()}` }, customers: i % 4 ? { name: `Pelanggan ${i}` } : null,
  });
  sale_items.push(...baris);
}
const tables = { sales, sale_items, branches: CAB.map(c => ({ id: c, name: `Cabang ${c.slice(-1).toUpperCase()}` })) };
const sidik = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

const PERIODE: [string, string][] = [["2026-11-01", "2026-11-22"], ["2026-11-10", "2026-11-17"], ["2026-11-16", "2026-11-17"], ["2026-09-01", "2026-11-22"], ["2026-10-05", "2026-10-05"]];
const lama = () => bikinKlienTiruan(tables);
const baru = (boleh: string[] | null = null) => bikinKlienTiruan(tables, { [STRUK_KASIR_RPC]: rpcStrukKasirTiruan({ sales: sales as never, sale_items: sale_items as never }, boleh) });

async function jalankan(klien: unknown, arg: { dari: string; sampai: string; kanal: "POS" | "Online"; cabangId?: string; saring?: boolean }) {
  state.klien = klien;
  return ambilPenjualanBarang({ dari: arg.dari, sampai: arg.sampai, kanal: arg.kanal, jenis: "Barang", q: "", cabangId: arg.cabangId ?? "", saringCabangDiQuery: arg.saring ?? false });
}

describe("Penjualan per Barang Kasir: jalur baru == jalur lama", () => {
  beforeEach(() => { state.klien = null; });

  for (const kanal of ["POS", "Online"] as const) for (const [dari, sampai] of PERIODE) {
    it(`${kanal} ${dari}..${sampai}: baris, total, ringkasan, opsi dan sidik sama; query dibatasi`, async () => {
      const a = lama(), b = baru();
      const hasilLama = await jalankan(a.client, { dari, sampai, kanal });
      const hasilBaru = await jalankan(b.client, { dari, sampai, kanal });
      expect(hasilLama.pesanError).toBe("");
      expect(hasilBaru.pesanError).toBe("");
      expect(hasilBaru).toEqual(hasilLama);
      expect(sidik(hasilBaru)).toBe(sidik(hasilLama));
      if (dari === "2026-09-01" || dari === "2026-11-01") expect(hasilBaru.rows.length).toBeGreaterThan(kanal === "POS" ? 100 : 5);
      // Jalur baru: hanya panggilan fungsi, satu per rentang 7 hari; tidak menyentuh sales/sale_items sama sekali.
      expect(b.catatanRpc).toHaveLength(rentangHari(dari, sampai).length);
      expect(b.catatan.filter(c => c.table === "sales" || c.table === "sale_items")).toHaveLength(0);
      expect(b.catatan.length).toBeLessThanOrEqual(3);
      expect(a.catatan.filter(c => c.table === "sales" || c.table === "sale_items").length).toBeGreaterThanOrEqual(2);
    });
  }

  it("saringan cabang (halaman: di query; unduhan: di memori) memberi hasil sama dengan jalur lama", async () => {
    for (const saring of [true, false]) {
      const hasilLama = await jalankan(lama().client, { dari: "2026-11-01", sampai: "2026-11-22", kanal: "POS", cabangId: "cab-b", saring });
      const b = baru();
      const hasilBaru = await jalankan(b.client, { dari: "2026-11-01", sampai: "2026-11-22", kanal: "POS", cabangId: "cab-b", saring });
      expect(hasilBaru).toEqual(hasilLama);
      expect(hasilBaru.rows.every(r => r.cabangId === "cab-b")).toBe(true);
      expect(b.catatanRpc.every(p => p.args.p_branch_id === (saring ? "cab-b" : null))).toBe(true);
    }
  });

  it("fungsi belum ada di database: jalur lama dipakai, hasil sama (aplikasi boleh rilis lebih dulu)", async () => {
    const tanpaFungsi = bikinKlienTiruan(tables, {});
    const hasil = await jalankan(tanpaFungsi.client, { dari: "2026-11-01", sampai: "2026-11-22", kanal: "POS" });
    const lamaHasil = await jalankan(lama().client, { dari: "2026-11-01", sampai: "2026-11-22", kanal: "POS" });
    expect(hasil).toEqual(lamaHasil);
    expect(tanpaFungsi.catatanRpc).toHaveLength(1);
    expect(tanpaFungsi.catatan.some(c => c.table === "sales")).toBe(true);
  });

  it("hak baca dari database (hanya cabang boleh) menentukan baris; hasilnya sama dengan data yang disaring", async () => {
    const hasil = await jalankan(baru(["cab-a"]).client, { dari: "2026-11-01", sampai: "2026-11-22", kanal: "POS" });
    expect(hasil.pesanError).toBe("");
    expect(hasil.rows.length).toBeGreaterThan(0);
    expect(hasil.rows.every(r => r.cabangId === "cab-a")).toBe(true);
  });

  it("batas waktu database tampil sebagai pesan batas waktu, bukan pesan umum; izin sebagai pesan izin", async () => {
    for (const [code, message, kode, status] of [["57014", "canceling statement due to statement timeout", "batas_waktu", 504], ["42501", "permission denied for function laporan_struk_kasir", "izin", 403]] as const) {
      const k = bikinKlienTiruan(tables, { [STRUK_KASIR_RPC]: () => ({ data: null, error: { code, message } }) });
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const hasil = await jalankan(k.client, { dari: "2026-11-01", sampai: "2026-11-22", kanal: "POS" });
      expect(hasil.rows).toEqual([]);
      expect(hasil.kodeError).toBe(kode);
      expect(hasil.pesanError).not.toBe("Laporan belum bisa dibaca. Coba lagi atau pilih periode lebih pendek.");
      expect(hasil.pesanError.length).toBeGreaterThan(20);
      expect(status).toBeGreaterThan(0);
    }
    vi.restoreAllMocks();
  });
});
