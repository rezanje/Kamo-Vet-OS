import { describe, expect, it } from "vitest";
import {
  alasanTidakBisaEdit, muatanBarisFaktur, penerimaanAktif, ringkasanFaktur,
  subtotalBaris, totalPenerimaan, validasiBarisFaktur, type BarisFakturEdit,
} from "@/lib/faktur-jual-edit";

const faktur = { status: "berjalan", order_id: "order", opening_batch_id: null, kategori: "penjualan", carried_paid: 0 };
const terima = (over: Partial<{ id: string; jumlah: number; voided_at: string | null; reversal_of: string | null }> = {}) =>
  ({ id: "rc1", jumlah: 500_000, voided_at: null, reversal_of: null, ...over });
const baris = (over: Partial<BarisFakturEdit> = {}): BarisFakturEdit =>
  ({ id: "l1", nama: "Royal Canin", satuan: "sak", qty: 10, harga: 300_000, diskon: 0, maksQty: 12, ...over });

describe("edit faktur diblokir selama masih ada penerimaan", () => {
  it("menolak faktur yang masih punya penerimaan aktif dan menyebut jalan keluarnya", () => {
    const alasan = alasanTidakBisaEdit(faktur, [terima()], false);
    expect(alasan).toContain("Hapus penerimaan dulu");
  });

  it("menolak faktur yang membawa pembayaran dari faktur terdahulu", () => {
    expect(alasanTidakBisaEdit({ ...faktur, carried_paid: 1 }, [], false)).toContain("Hapus penerimaan dulu");
  });

  it("mengizinkan edit setelah penerimaan dihapus dan dibalik", () => {
    const rows = [terima({ voided_at: "2026-10-28T03:00:00Z" }), terima({ id: "rc1b", jumlah: -500_000, reversal_of: "rc1" })];
    expect(penerimaanAktif(rows)).toEqual([]);
    expect(totalPenerimaan(rows)).toBe(0);
    expect(alasanTidakBisaEdit(faktur, rows, false)).toBeNull();
  });

  it.each([
    [{ status: "batal" }, "dibatalkan"],
    [{ opening_batch_id: "batch" }, "saldo awal"],
    [{ kategori: "selisih_stok" }, "opname"],
    [{ order_id: null }, "tidak terhubung ke pesanan"],
  ])("menolak dokumen yang bukan faktur grosir biasa (%o)", (over, pesan) => {
    expect(alasanTidakBisaEdit({ ...faktur, ...over }, [], false)).toContain(pesan);
  });

  it("menolak faktur yang sudah diganti faktur lain", () => {
    expect(alasanTidakBisaEdit(faktur, [], true)).toContain("sudah diganti");
  });
});

describe("hitungan baris dan faktur", () => {
  it("nilai baris = qty x harga - diskon", () => {
    expect(subtotalBaris({ qty: 10, harga: 300_000, diskon: 250_000 })).toBe(2_750_000);
  });

  it("PPN dihitung atas DPP setelah diskon dan dibulatkan ke rupiah", () => {
    const hasil = ringkasanFaktur([{ qty: 3, harga: 33_333, diskon: 0 }], 11);
    expect(hasil).toMatchObject({ gross: 99_999, diskon: 0, dpp: 99_999, ppn: 11_000, total: 110_999 });
  });

  it("diskon mengurangi pendapatan bruto, bukan harga satuannya", () => {
    const hasil = ringkasanFaktur([{ qty: 10, harga: 300_000, diskon: 500_000 }], 0);
    expect(hasil.gross).toBe(3_000_000);
    expect(hasil.diskon).toBe(500_000);
    expect(hasil.dpp).toBe(2_500_000);
    expect(hasil.total).toBe(2_500_000);
  });
});

describe("validasi baris sebelum dikirim ke database", () => {
  it("menolak qty melebihi barang yang sudah dikirim dan belum ditagih", () => {
    expect(validasiBarisFaktur(baris({ qty: 13 }))).toContain("maksimal 12");
  });
  it("menolak diskon yang melebihi nilai barisnya", () => {
    expect(validasiBarisFaktur(baris({ qty: 1, harga: 1000, diskon: 1001 }))).toContain("melebihi nilai barisnya");
  });
  it.each([{ qty: -1 }, { harga: -1 }, { diskon: -1 }, { qty: Number.NaN }])("menolak angka tidak wajar (%o)", (over) => {
    expect(validasiBarisFaktur(baris(over))).not.toBeNull();
  });
  it("menerima qty 0 sebagai penghapusan baris", () => {
    expect(validasiBarisFaktur(baris({ qty: 0, diskon: 0 }))).toBeNull();
  });
});

it("mengirim seluruh baris faktur, bukan hanya baris yang diubah", () => {
  const semua = [baris(), baris({ id: "l2", nama: "Whiskas", qty: 4, harga: 25_000, maksQty: 4 })];
  const muatan = muatanBarisFaktur(semua, { ...semua[1], qty: 2, diskon: 1_000 });
  expect(muatan).toEqual([
    { id: "l1", qty: 10, harga: 300_000, diskon: 0 },
    { id: "l2", qty: 2, harga: 25_000, diskon: 1_000 },
  ]);
});
