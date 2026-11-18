// Uang pindahan terbit ulang yang sudah dibatalkan penerimaannya tidak boleh terhitung lagi.
// Kasus INV-202611-1285 (Kovu): baris pindahan +90.000 dibalik baris -90.000 (reversal_of, tanpa transferred_from);
// layar koreksi tetap memuat "Pembayaran dialihkan Rp 90.000" sehingga form mengirim status Lunas dan ditolak.
import { expect, it } from "vitest";
import { uangPindahanBersih } from "@/lib/uang-pindahan-bersih";

const pindahan = { id: "p1", amount: 90000, transferred_from: "lama", reversal_of: null };
const balik = { id: "p2", amount: -90000, transferred_from: null, reversal_of: "p1" };

it("pindahan yang belum dibalik dihitung penuh (koreksi terbit ulang biasa)", () => {
  expect(uangPindahanBersih([pindahan])).toBe(90000);
});

it("pindahan yang sudah dibalik penuh = 0", () => {
  expect(uangPindahanBersih([pindahan, balik])).toBe(0);
});

it("pembalikan sebagian mengurangi sebagian", () => {
  expect(uangPindahanBersih([pindahan, { ...balik, amount: -30000 }])).toBe(60000);
});

it("uang yang diterima langsung (bukan pindahan) dan baliknya tidak ikut dihitung", () => {
  const langsung = { id: "p3", amount: 45000, transferred_from: null, reversal_of: null };
  const langsungBalik = { id: "p4", amount: -45000, transferred_from: null, reversal_of: "p3" };
  expect(uangPindahanBersih([pindahan, balik, langsung])).toBe(0);
  expect(uangPindahanBersih([pindahan, langsung, langsungBalik])).toBe(90000);
});

it("angka string dari basis data dibaca, hasil tidak pernah negatif, kosong = 0", () => {
  expect(uangPindahanBersih([{ id: "p1", amount: "90000.00", transferred_from: "lama" }, { id: "p2", amount: "-90000.00", reversal_of: "p1" }])).toBe(0);
  expect(uangPindahanBersih([{ id: "p2", amount: -5, reversal_of: "p1" }, { id: "p1", amount: 1, transferred_from: "lama" }])).toBe(0);
  expect(uangPindahanBersih([])).toBe(0);
});
