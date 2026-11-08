import { describe, expect, it } from "vitest";
import { muatanKomponen, pesanBmhpOwner } from "@/lib/bmhp-owner";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("muatanKomponen", () => {
  it("menerima koma/titik desimal (3,4) dan mengirim angka", () => {
    expect(muatanKomponen([{ item_id: A, qty: "3,4" }])).toEqual({ ok: true, components: [{ item_id: A, qty: 3.4 }] });
    expect(muatanKomponen([{ item_id: A, qty: "3.4", unit: "kotak" }])).toEqual({ ok: true, components: [{ item_id: A, qty: 3.4, unit: "kotak" }] });
  });
  it("jumlah kosong atau 0 mengeluarkan bahan; semua dikeluarkan = ditolak", () => {
    expect(muatanKomponen([{ item_id: A, qty: "2" }, { item_id: B, qty: "" }])).toEqual({ ok: true, components: [{ item_id: A, qty: 2 }] });
    expect(muatanKomponen([{ item_id: A, qty: "0" }, { item_id: B, qty: "0.0" }]).ok).toBe(false);
  });
  it.each(["-1", "abc", "1.00001", "1e3", "NaN", "1,2,3"])("menolak jumlah tidak valid %s", (qty) => {
    expect(muatanKomponen([{ item_id: A, qty }]).ok).toBe(false);
  });
  it("menolak bahan ganda", () => {
    const r = muatanKomponen([{ item_id: A, qty: "1" }, { item_id: A, qty: "2" }]);
    expect(r.ok).toBe(false);
  });
});

describe("pesanBmhpOwner", () => {
  it("memetakan kode ke kalimat sederhana", () => {
    expect(pesanBmhpOwner("ACCESS_DENIED: apa pun")).toMatch(/Hanya Owner/);
    expect(pesanBmhpOwner("CART_STALE: keranjang berubah")).toMatch(/Muat ulang/);
    expect(pesanBmhpOwner("BMHP_LIMIT: x")).toMatch(/10×/);
    expect(pesanBmhpOwner("INVOICE_VOID: x")).toMatch(/dibatalkan/);
    expect(pesanBmhpOwner("ERROR: Periode akuntansi 2026-10 ditutup")).toMatch(/Periode/);
  });
  it("detail BMHP_INVALID ikut ditampilkan tetapi dipotong satu baris", () => {
    expect(pesanBmhpOwner("BMHP_INVALID: Bahan X tidak aktif\nCONTEXT: PL/pgSQL secret")).toBe("Daftar bahan tidak valid: Bahan X tidak aktif");
  });
  it("galat tak dikenal tidak pernah ditampilkan mentah", () => {
    const m = pesanBmhpOwner("ERROR: relation foo does not exist at line 1 (secret)");
    expect(m).not.toMatch(/relation|secret/);
    expect(m).toMatch(/belum terkonfirmasi/);
    expect(pesanBmhpOwner(null)).toMatch(/belum terkonfirmasi/);
  });
  it("lock timeout dan permission denied punya pesan sendiri", () => {
    expect(pesanBmhpOwner("canceling statement due to lock timeout")).toMatch(/dipakai kasir lain/);
    expect(pesanBmhpOwner("permission denied for table x")).toMatch(/Hanya Owner/);
  });
});
