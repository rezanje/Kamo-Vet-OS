import { describe, expect, it } from "vitest";
import { cashierPriceFloorDbMessage, cashierPriceFloorIssue } from "../cashier-price-floor";
import { alasanBawahModalPerBaris, alasanBersih, alasanDariPilihan, belowCostSaleAllowed, pesanBawahModalDb } from "../jual-bawah-modal";
import { GRANT_ONLY_ACTIONS, legacyRoleHasAction } from "../role-grant-only-actions";
import { barisExcelBawahModal, rentangBawahModal, totalRugi, type BarisBawahModal } from "../jual-bawah-modal-server";

const barang = (over: Record<string, unknown> = {}) => ({ nama: "Crystal Kitty", item_type: "Persediaan", qty: 1, harga: 35000, item_discount_type: "percent" as const, item_discount_value: 50, ...over });

describe("alasan jual di bawah modal", () => {
  it("alasanBersih: 3-200 huruf setelah dipangkas; bukan string/pendek/panjang = null", () => {
    expect(alasanBersih("  Mau   kadaluarsa ")).toBe("Mau kadaluarsa");
    expect(alasanBersih("ab")).toBeNull();
    expect(alasanBersih("   ")).toBeNull();
    expect(alasanBersih("x".repeat(201))).toBeNull();
    expect(alasanBersih("x".repeat(200))).toBe("x".repeat(200));
    expect(alasanBersih(5)).toBeNull();
    expect(alasanBersih(null)).toBeNull();
  });
  it("alasanDariPilihan: pilihan baku apa adanya; Lainnya wajib teks sah; pilihan asing kosong", () => {
    expect(alasanDariPilihan("Mau kadaluarsa", "")).toBe("Mau kadaluarsa");
    expect(alasanDariPilihan("Lainnya", "ab")).toBe("");
    expect(alasanDariPilihan("Lainnya", "Kemasan sobek")).toBe("Kemasan sobek");
    expect(alasanDariPilihan("Karang bebas", "")).toBe("");
    expect(alasanDariPilihan(undefined, "x")).toBe("");
  });
  it("alasanBawahModalPerBaris: hanya Persediaan beralasan sah; jasa/tanpa item/pendek dihitung tidak sah", () => {
    const hasil = alasanBawahModalPerBaris([
      { item_id: "a", item_type: "Persediaan", bawah_modal_alasan: "Cuci gudang" },
      { item_id: "b", item_type: "Jasa", bawah_modal_alasan: "Cuci gudang" },
      { item_id: "c", item_type: "Persediaan", bawah_modal_alasan: "ab" },
      { item_id: null, item_type: "Persediaan", bawah_modal_alasan: "Cuci gudang" },
      { item_id: "e", item_type: "Grup", bawah_modal_alasan: "Cuci gudang" },
      { item_id: "f", item_type: "Persediaan" },
      { item_id: "g", item_type: "Persediaan", bawah_modal_alasan: 12 },
    ]);
    expect(hasil.alasan).toEqual(["Cuci gudang", null, null, null, null, null, null]);
    expect(hasil.diminta).toBe(true);
    expect(hasil.tidakSah).toBe(4); // alasan bukan string dianggap tidak ada
    expect(alasanBawahModalPerBaris([{ item_id: "a", item_type: "Persediaan" }])).toEqual({ alasan: [null], diminta: false, tidakSah: 0 });
  });
  it("pesanBawahModalDb: pesan penjaga database diterjemahkan, pesan lain tetap", () => {
    expect(pesanBawahModalDb("BAWAH_MODAL_IZIN: x")).toContain("hanya untuk Owner");
    expect(pesanBawahModalDb("BAWAH_MODAL_ALASAN: x")).toContain("wajib");
    expect(pesanBawahModalDb("BAWAH_MODAL_JENIS: x")).toContain("persediaan");
    expect(pesanBawahModalDb("BAWAH_MODAL_PROMO: x")).toContain("promo");
    expect(pesanBawahModalDb("galat lain")).toBe("galat lain");
  });
});

describe("belowCostSaleAllowed (fail-closed)", () => {
  it("true hanya bila RPC sukses dan data === true", async () => {
    expect(await belowCostSaleAllowed({ rpc: async () => ({ data: true, error: null }) })).toBe(true);
    expect(await belowCostSaleAllowed({ rpc: async () => ({ data: "true", error: null }) })).toBe(false);
    expect(await belowCostSaleAllowed({ rpc: async () => ({ data: true, error: { message: "x" } }) })).toBe(false);
    expect(await belowCostSaleAllowed({ rpc: async () => { throw new Error("putus"); } })).toBe(false);
  });
});

describe("lantai harga: cermin P06_OWNER_BELOW_COST", () => {
  const net = 17500; // 35.000 diskon 50%
  it("tanpa izin/alasan: lantai lama (pesan persis keluhan Andri)", () => {
    expect(cashierPriceFloorIssue([barang()], net, [26076])).toBe("Harga neto Crystal Kitty di bawah batas aman HPP FIFO; penjualan ditolak.");
    expect(cashierPriceFloorIssue([barang()], net, [26076], [false], [false])).toContain("di bawah batas aman HPP FIFO");
  });
  it("Owner + alasan: lolos untuk baris Persediaan di bawah HPP", () => {
    expect(cashierPriceFloorIssue([barang()], net, [26076], [false], [true])).toBeNull();
  });
  it("tetap ditolak: neto nol, HPP tak diketahui, paket Grup, jasa", () => {
    expect(cashierPriceFloorIssue([barang({ item_discount_value: 100 })], 0, [26076], [false], [true])).toContain("nol");
    expect(cashierPriceFloorIssue([barang()], net, [null], [false], [true])).toContain("belum dapat diverifikasi");
    expect(cashierPriceFloorIssue([barang({ item_type: "Grup", group_components: [{ item_type: "Persediaan" }] })], net, [26076], [false], [true])).toContain("paket");
  });
  it("hanya baris bertanda yang lolos: baris kedua di bawah HPP tanpa alasan tetap ditolak", () => {
    const dua = [barang(), barang({ nama: "Pasir" })];
    expect(cashierPriceFloorIssue(dua, 35000, [26076, 26076], [false, false], [true, false])).toContain("Pasir");
    expect(cashierPriceFloorIssue(dua, 35000, [26076, 26076], [false, false], [true, true])).toBeNull();
  });
  it("baris promo-waiver tidak ikut obral Owner (batas promo tetap)", () => {
    expect(cashierPriceFloorIssue([barang({ item_discount_type: null, item_discount_value: 0, harga: 17500 })], 17500, [26076], [true], [true])).toBeNull();
    // promo di bawah modal yang ditumpuk potongan struk: tetap ditolak walau ada alasan
    expect(cashierPriceFloorIssue([barang({ item_discount_type: null, item_discount_value: 0, harga: 17500 })], 15000, [26076], [true], [true])).toContain("Promo di bawah modal");
  });
  it("pesan database: petunjuk izin dari lantai posting diterjemahkan", () => {
    const m = "Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak: Crystal Kitty (jual di bawah modal ditolak: hanya Owner atau peran yang diberi izin Jual di bawah modal)";
    expect(cashierPriceFloorDbMessage(m)).toContain("hanya untuk Owner atau peran yang diberi izin");
    expect(cashierPriceFloorDbMessage("Harga neto Persediaan di bawah HPP FIFO; penjualan ditolak: Crystal Kitty")).toContain("Crystal Kitty di bawah HPP FIFO");
  });
});

describe("izin khusus & laporan", () => {
  it("kasir.jual_bawah_modal: izin khusus, bawaan mati untuk semua peran legacy (termasuk ADMIN)", () => {
    expect(GRANT_ONLY_ACTIONS).toContain("kasir.jual_bawah_modal");
    expect(legacyRoleHasAction("kasir.jual_bawah_modal", "ADMIN")).toBe(false);
    expect(legacyRoleHasAction("kasir.jual_bawah_modal", "FINANCE")).toBe(false);
    expect(legacyRoleHasAction("kasir.diskon_manual", "ADMIN")).toBe(true);
  });
  const baris = (over: Partial<BarisBawahModal> = {}): BarisBawahModal => ({ sale_id: "s", tanggal: "2026-11-14", cabang_id: "c", cabang: "Ciawi", no_struk: "POS-1", item_id: "i", kode: "100222",
    barang: "Crystal Kitty HnS 400gr", qty: 2, satuan: "pcs", faktor: 1, hpp: 52152, harga_neto: 35000, rugi: 17152, alasan: "Mau kadaluarsa", oleh_id: "u", oleh: "Andri", ...over });
  it("Excel: sel berawalan rumus diberi tanda petik (amankanSel)", () => {
    const sel = barisExcelBawahModal(baris({ alasan: "=HYPERLINK(\"http://x\")", barang: "+cmd", oleh: "@sum(1)", cabang: "-1" }));
    expect(sel[1]).toBe("'-1");
    expect(sel[4]).toBe("'+cmd");
    expect(sel[10]).toBe("'=HYPERLINK(\"http://x\")");
    expect(sel[11]).toBe("'@sum(1)");
    expect(sel.slice(5, 10)).toEqual([2, "pcs", 52152, 35000, 17152]);
  });
  it("total rugi dan rentang tanggal", () => {
    expect(totalRugi([baris(), baris({ rugi: 8576.5 })])).toBe(25728.5);
    expect(rentangBawahModal({ dari: "2026-11-10", sampai: "2026-11-01" })).toEqual({ dari: "2026-11-01", sampai: "2026-11-10" });
    expect(rentangBawahModal({ dari: "bukan", sampai: "2026-11-05" }).sampai).toBe("2026-11-05");
  });
});
