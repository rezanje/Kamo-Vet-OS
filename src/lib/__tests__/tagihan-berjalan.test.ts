import { describe, expect, it } from "vitest";
import {
  alokasiPembayaran, barisBelumDitagih, jurnalBatalPembayaran, jurnalPakaiUangMuka,
  jurnalSeimbang, jurnalTerimaPembayaran, jurnalUangMukaMasuk, nilaiBarisResep,
  ringkasTahap, saldoUangMuka, totalPiutang, uangMukaTerpakai,
  type BarisResep, type TagihanTahap,
} from "../tagihan-berjalan";

const resep = (id: string, patch: Partial<BarisResep> = {}): BarisResep => ({
  id, nama_obat: `Item ${id}`, qty: 1, harga: 100_000, jenis: "obat",
  item_id: null, satuan: null, compound_recipe_id: null, ...patch,
});
const tagihan = (id: string, patch: Partial<TagihanTahap> = {}): TagihanTahap => ({
  id, invoice_no: `INV-${id}`, created_at: `2026-10-0${id}T00:00:00Z`, total: 100_000,
  dp_amount: 0, paid_status: "Belum Lunas", voided_at: null, ...patch,
});

describe("pemilihan baris tahap", () => {
  it("hanya menawarkan baris yang belum pernah masuk tagihan aktif", () => {
    const hasil = barisBelumDitagih(
      [resep("1"), resep("2"), resep("3")],
      [{ invoice_id: "a", prescription_item_id: "1" }],
      [tagihan("a")],
    );
    expect(hasil.map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("baris pada tagihan yang sudah di-void terbuka lagi — sama dengan penjaga database", () => {
    const hasil = barisBelumDitagih(
      [resep("1"), resep("2")],
      [{ invoice_id: "a", prescription_item_id: "1" }, { invoice_id: "b", prescription_item_id: "2" }],
      [tagihan("a", { voided_at: "2026-10-10T00:00:00Z" }), tagihan("b")],
    );
    expect(hasil.map((r) => r.id)).toEqual(["1"]);
  });

  it("baris bebas pada tagihan (tanpa id resep) tidak menutup baris resep mana pun", () => {
    const hasil = barisBelumDitagih([resep("1")], [{ invoice_id: "a", prescription_item_id: null }], [tagihan("a")]);
    expect(hasil.map((r) => r.id)).toEqual(["1"]);
  });

  it("nilai baris = qty x harga", () => {
    expect(nilaiBarisResep(resep("1", { qty: 3, harga: 25_000 }))).toBe(75_000);
  });
});

describe("ringkasan tahap", () => {
  const tahap = () => ringkasTahap(
    [
      tagihan("2", { total: 200_000 }),
      tagihan("1", { total: 100_000, paid_status: "Lunas" }),
      tagihan("3", { voided_at: "2026-10-09T00:00:00Z", total: 999_000 }),
    ],
    [{ invoice_id: "1", amount: 100_000 }, { invoice_id: "2", amount: 50_000 }],
  );

  it("mengurutkan dari tahap tertua dan membuang yang sudah dibatalkan", () => {
    expect(tahap().map((t) => t.id)).toEqual(["1", "2"]);
  });

  it("menjumlahkan uang muka di kepala invoice dengan seluruh pembayarannya", () => {
    expect(tahap().map((t) => [t.dibayar, t.sisa])).toEqual([[100_000, 0], [50_000, 150_000]]);
  });

  it("piutang kunjungan = jumlah sisa seluruh tahap aktif", () => {
    expect(totalPiutang(tahap())).toBe(150_000);
  });
});

describe("alokasi pembayaran", () => {
  const tahap = ringkasTahap(
    [tagihan("1", { total: 100_000 }), tagihan("2", { total: 100_000 })], [],
  );

  it("memotong tahap tertua lebih dulu, memakai bagian metode berurutan", () => {
    const hasil = alokasiPembayaran(tahap, [
      { method: "Tunai", amount: 120_000 }, { method: "QRIS", amount: 130_000 },
    ]);
    expect(hasil.baris).toEqual([
      { invoiceId: "1", invoiceNo: "INV-1", method: "Tunai", amount: 100_000 },
      { invoiceId: "2", invoiceNo: "INV-2", method: "Tunai", amount: 20_000 },
      { invoiceId: "2", invoiceNo: "INV-2", method: "QRIS", amount: 80_000 },
    ]);
    expect(hasil.uangMuka).toBe(50_000);
  });

  it("tagihan yang dipilih kasir didahulukan", () => {
    const hasil = alokasiPembayaran(tahap, [{ method: "Tunai", amount: 100_000 }], "2");
    expect(hasil.baris).toEqual([{ invoiceId: "2", invoiceNo: "INV-2", method: "Tunai", amount: 100_000 }]);
  });

  it("tanpa tagihan yang belum lunas, seluruh uang jadi uang muka pemilik", () => {
    const lunas = ringkasTahap([tagihan("1", { total: 100_000, paid_status: "Lunas" })],
      [{ invoice_id: "1", amount: 100_000 }]);
    const hasil = alokasiPembayaran(lunas, [{ method: "Transfer", amount: 300_000 }]);
    expect(hasil.baris).toEqual([]);
    expect(hasil.uangMuka).toBe(300_000);
  });

  it("tagihan yang sedang dikoreksi dilewati, bukan ikut dibayar", () => {
    const koreksi = ringkasTahap([tagihan("1", { total: 100_000, correction_pending: true })], []);
    expect(alokasiPembayaran(koreksi, [{ method: "Tunai", amount: 50_000 }]).uangMuka).toBe(50_000);
  });
});

describe("uang muka pemilik", () => {
  it("saldo = nominal dikurangi yang sudah terpakai, hanya yang berstatus aktif", () => {
    expect(saldoUangMuka([
      { amount: 500_000, applied: 200_000, status: "aktif" },
      { amount: 100_000, applied: 0, status: "batal" },
      { amount: 50_000, applied: 50_000, status: "aktif" },
    ])).toBe(300_000);
  });

  it("yang terpakai pada satu tahap tidak pernah melebihi saldo maupun totalnya", () => {
    expect(uangMukaTerpakai(300_000, 100_000)).toBe(100_000);
    expect(uangMukaTerpakai(50_000, 100_000)).toBe(50_000);
    expect(uangMukaTerpakai(-10, 100_000)).toBe(0);
  });
});

describe("bayangan jurnal", () => {
  it.each([
    ["terima pembayaran", jurnalTerimaPembayaran("1101", 250_000)],
    ["uang muka masuk campuran", jurnalUangMukaMasuk([{ kasCode: "1101", amount: 20_000 }, { kasCode: "1102", amount: 30_000 }])],
    ["pemakaian uang muka", jurnalPakaiUangMuka(50_000)],
    ["pembatalan kwitansi", jurnalBatalPembayaran("1101", 40_000)],
  ])("%s selalu seimbang", (_label, lines) => {
    expect(jurnalSeimbang(lines)).toBe(true);
  });

  it("uang masuk sebelum ada tagihan masuk akun Uang Muka Penjualan 2103, bukan pendapatan", () => {
    expect(jurnalUangMukaMasuk([{ kasCode: "1101", amount: 50_000 }])).toEqual([
      { code: "1101", debit: 50_000, credit: 0 },
      { code: "2103", debit: 0, credit: 50_000 },
    ]);
  });

  it("pemakaian uang muka menurunkan utang ke pemilik dan melunasi piutang, tanpa kas", () => {
    const lines = jurnalPakaiUangMuka(50_000);
    expect(lines).toEqual([
      { code: "2103", debit: 50_000, credit: 0 },
      { code: "1201", debit: 0, credit: 50_000 },
    ]);
    expect(lines.some((l) => l.code === "1101")).toBe(false);
  });
});
