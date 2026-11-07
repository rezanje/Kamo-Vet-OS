import { describe, expect, it } from "vitest";
import { parseClinicPostingError, parseClinicRecordError, toClinicCompoundRecipeInput } from "../klinik-posting";

describe("parseClinicPostingError", () => {
  it("identifies the medicine whose stock is insufficient", () => {
    expect(parseClinicPostingError({ code: "P0001", message: "STOCK_SHORT: Obat A" }))
      .toBe("Stok tidak cukup: Obat A");
  });

  it("explains a missing active branch warehouse", () => {
    expect(parseClinicPostingError({ code: "P0001", message: "WAREHOUSE_MISSING: Cabang A" }))
      .toBe("Gudang aktif cabang belum tersedia: Cabang A");
  });

  it("rejects an unconfigured accounting account", () => {
    expect(parseClinicPostingError({ code: "P0001", message: "ACCOUNT_INVALID: 5101" }))
      .toBe("Akun jurnal tidak siap: 5101");
  });

  it("names the reason a procedure BMHP was rejected", () => {
    expect(parseClinicPostingError({ code: "P0001", message: "BMHP_INVALID: satuan BMHP tidak ditemukan" }))
      .toBe("BMHP tindakan ditolak: satuan BMHP tidak ditemukan");
    expect(parseClinicRecordError({ code: "P0001", message: "BMHP_INVALID: BMHP harus barang persediaan aktif" }))
      .toBe("BMHP tindakan ditolak: BMHP harus barang persediaan aktif");
    expect(parseClinicPostingError({ code: "P0001", message: "BMHP_POSTED: BMHP tindakan ini sudah diposting" }))
      .toBe("BMHP tindakan sudah tercatat di tagihan aktif: BMHP tindakan ini sudah diposting");
  });

  it("explains branch access and invalid compound ingredients", () => {
    expect(parseClinicPostingError({ code: "P0001", message: "ACCESS_DENIED: kunjungan" }))
      .toBe("Akses cabang atau kunjungan tidak diizinkan.");
    expect(parseClinicPostingError({ code: "P0001", message: "INGREDIENT_INVALID: Bahan A" }))
      .toBe("Bahan racikan tidak valid: Bahan A");
  });

  it("fails closed when layers or historical cost are missing", () => {
    expect(parseClinicPostingError({ code: "P0001", message: "LAYER_SHORT: Bahan A" }))
      .toBe("Lapisan stok tidak cukup: Bahan A");
    expect(parseClinicPostingError({ code: "P0001", message: "COST_MISSING: Bahan A" }))
      .toBe("HPP historis bahan tidak tersedia: Bahan A");
  });

  it("explains BMHP COST_MISSING: material, clinic stock vs needed, the cause and a FIFO-correct action (Andri 4 Nov)", () => {
    const zeroCost = parseClinicPostingError({ code: "P0001",
      message: "COST_MISSING: Revolution Dog Teal 2.0 Ml New [stok=12;butuh=6;satuan=0.1 ml;sebab=harga0]" });
    expect(zeroCost).toContain("Modal terakhir bahan tidak tersedia: Revolution Dog Teal 2.0 Ml New.");
    expect(zeroCost).not.toContain("HPP historis");
    // The unit is shown once, in words, never glued to the numbers ("12 0.1 ml").
    expect(zeroCost).toContain("Stok gudang klinik cabang ini 12, dibutuhkan 6 (satuan barang: 0.1 ml");
    expect(zeroCost).not.toContain("12 0.1 ml");
    expect(zeroCost).toContain("berharga modal Rp0");
    // Live costing is FIFO: the old Rp0 layer is consumed first, so adding priced stock / filling Harga beli alone does NOT clear it.
    expect(zeroCost).toContain("dipakai lebih dulu (FIFO)");
    expect(zeroCost).toContain("menambah stok baru atau mengisi Harga beli saja tidak menyelesaikan");
    expect(zeroCost).toContain("Penyesuaian Persediaan");
    expect(zeroCost).toContain("turunkan stok sampai lapisan Rp0 habis");
    expect(zeroCost).toContain("naikkan lagi");
    expect(zeroCost).toContain("Kartu Stok");
    // The old advice (a receipt alone fixes it) is wrong for harga0 and must be gone; no feature that is not live is promised.
    expect(zeroCost).not.toContain("lalu tambahkan stok lewat Penerimaan barang");
    expect(zeroCost).not.toContain("bukan Penyesuaian");
    expect(zeroCost).not.toMatch(/Penyesuaian modal/i);
    expect(zeroCost).toContain("Menghapus satu baris tidak membantu");
    expect(zeroCost).toContain("Belum ada yang tersimpan.");
    const layers = parseClinicPostingError({ code: "P0001",
      message: "COST_MISSING: Revolution Dog Teal 2.0 Ml New [stok=12;butuh=6;satuan=0.1 ml;sebab=lapisan]" });
    expect(layers).toContain("Modal terakhir bahan tidak tersedia: Revolution Dog Teal 2.0 Ml New.");
    expect(layers).toContain("Lapisan stok (FIFO)");
    expect(layers).toContain("Penerimaan barang / Faktur pembelian");
    expect(layers).toContain("Rekonsiliasi sumber diperlukan");
    expect(layers).not.toContain("berharga modal Rp0");
    expect(layers).not.toContain("HPP historis");
    // A malformed tail never becomes a half-rendered sentence: it keeps the plain COST_MISSING mapping.
    expect(parseClinicPostingError({ code: "P0001", message: "COST_MISSING: Bahan A [stok=x;butuh=1;satuan=pcs;sebab=lain]" }))
      .toMatch(/^HPP historis bahan tidak tersedia: Bahan A /);
    expect(parseClinicPostingError({ code: "P0001", message: "COST_MISSING: Bahan A [stok=x;butuh=1;satuan=pcs;sebab=lain]" }))
      .not.toContain("dibutuhkan");
    // The older database text (before the detail migration) still maps as before.
    expect(parseClinicPostingError({ code: "P0001", message: "COST_MISSING: Revolution Dog Teal 2.0 Ml New" }))
      .toBe("HPP historis bahan tidak tersedia: Revolution Dog Teal 2.0 Ml New");
  });

  it("parses the BMHP COST_MISSING tail from the LAST [stok= marker, so a material name with brackets still renders", () => {
    const bracket = parseClinicPostingError({ code: "P0001",
      message: "COST_MISSING: Obat [Baru] 10 ml [stok=3;butuh=2;satuan=pcs;sebab=harga0]" });
    expect(bracket).toContain("Modal terakhir bahan tidak tersedia: Obat [Baru] 10 ml.");
    expect(bracket).toContain("Stok gudang klinik cabang ini 3, dibutuhkan 2 (satuan barang: pcs");
    expect(bracket).not.toContain("[stok=");
    const fake = parseClinicPostingError({ code: "P0001",
      message: "COST_MISSING: Aneh [stok=9;butuh=9;satuan=x;sebab=lapisan] ok [stok=3;butuh=2;satuan=pcs;sebab=harga0]" });
    expect(fake).toContain("Aneh [stok=9;butuh=9;satuan=x;sebab=lapisan] ok.");
    expect(fake).toContain("Stok gudang klinik cabang ini 3, dibutuhkan 2");
    expect(fake).toContain("berharga modal Rp0");
    // A unit containing ']' or ';' still renders (the tail is anchored at the end, not split on the unit).
    expect(parseClinicPostingError({ code: "P0001", message: "COST_MISSING: Bahan B [stok=1;butuh=2;satuan=tab;1];sebab=lapisan]" }))
      .toContain("(satuan barang: tab;1]");
    // A tail with a different layout or trailing junk never half-renders.
    expect(parseClinicPostingError({ code: "P0001", message: "COST_MISSING: Bahan C [stok=1;butuh=2;satuan=pcs;sebab=lapisan] tambahan" }))
      .not.toContain("dibutuhkan");
  });

  it("explains request conflicts and unsupported recipe lifecycle transitions", () => {
    expect(parseClinicPostingError({ code: "P0001", message: "IDEMPOTENCY_CONFLICT: request key" }))
      .toBe("Permintaan racikan bertentangan dengan penyimpanan sebelumnya.");
    expect(parseClinicPostingError({ code: "P0001", message: "RECIPE_INVALID: sudah diserahkan" }))
      .toBe("Racikan tidak dapat diubah: sudah diserahkan");
    expect(parseClinicPostingError({ code: "P0001", message: "RECIPE_LINKED: invoice" }))
      .toBe("Racikan sudah terhubung ke invoice dan tidak dapat dibatalkan di sini.");
  });

  it("does not expose an unknown database error to the cashier", () => {
    expect(parseClinicPostingError({ code: "23505", message: "duplicate key value violates constraint invoices_visit_id_key" }))
      .toBe("Transaksi belum tersimpan. Periksa apakah invoice sudah dibuat lalu coba lagi.");
  });

  it("maps atomic invoice failures to actionable messages", () => {
    expect(parseClinicPostingError({ code: "P0001", message: "RECIPE_ID_MISSING: legacy" }))
      .toMatch(/Identitas racikan/);
    expect(parseClinicPostingError({ code: "P0001", message: "INVOICE_EXISTS: visit" }))
      .toBe("Kunjungan sudah memiliki invoice aktif.");
    expect(parseClinicPostingError({ code: "P0001", message: "UNIT_INVALID: strip" }))
      .toBe("Satuan barang tidak cocok: strip");
    expect(parseClinicPostingError({ code: "P0001", message: "JOURNAL_UNBALANCED: invoice" }))
      .toMatch(/tidak seimbang/);
  });

  it("shows why goods were rejected below HPP or at zero (P03)", () => {
    expect(parseClinicPostingError({ code: "P0001",
      message: "PRICE_BELOW_HPP: Harga neto Obat A Rp900 di bawah HPP Rp1.000. Naikkan harga atau kurangi diskon." }))
      .toBe("Penjualan ditolak. Harga neto Obat A Rp900 di bawah HPP Rp1.000. Naikkan harga atau kurangi diskon.");
    // Several offending rows: the whole list reaches the cashier (line breaks kept), not only the first line.
    const banyak = ["PRICE_BELOW_HPP: Harga neto Infus Refill Rp20.000 di bawah HPP Rp29.578. Ada 2 baris yang ditolak; semuanya tercantum di bawah.",
      "- Infus Refill: harga neto Rp20.000 per pcs, HPP Rp29.578 per pcs, harga minimum Rp29.578 per pcs",
      "- Obat Racik Probiotik (racikan): harga neto Rp50.000 per racikan, HPP Rp50.151 per racikan, harga minimum Rp50.151 per racikan",
      "Naikkan Harga di baris tersebut atau ubah Harga jual di Barang & Jasa."].join("\n");
    const hasil = parseClinicPostingError({ code: "P0001", message: banyak });
    expect(hasil).toBe(`Penjualan ditolak. ${banyak.replace("PRICE_BELOW_HPP: ", "")}`);
    expect(hasil).toContain("Obat Racik Probiotik (racikan)");
    expect(hasil).not.toContain("kurangi diskon");
    expect(parseClinicPostingError({ code: "P0001",
      message: "PRICE_ZERO: Harga neto paket Paket Steril Rp0. Paket yang berisi obat/barang tidak boleh gratis." }))
      .toBe("Penjualan ditolak. Harga neto paket Paket Steril Rp0. Paket yang berisi obat/barang tidak boleh gratis.");
  });
});

describe("parseClinicRecordError", () => {
  it("explains the separate forced-discharge signature and closed admission guards", () => {
    expect(parseClinicRecordError({ code: "P0001", message: "CONSENT_REQUIRED: tandatangani form Pulang Paksa yang berlaku untuk cabang pasien" }))
      .toMatch(/Pulang Paksa/);
    expect(parseClinicRecordError({ code: "P0001", message: "INPATIENT_CLOSED: pasien sudah keluar" }))
      .toMatch(/sudah keluar/);
  });
  it("explains failed initial exams without exposing raw database details", () => {
    expect(parseClinicRecordError({ code: "P0001", message: "RECORD_INVALID: kunjungan belum siap" }))
      .toMatch(/Kunjungan belum siap/);
    expect(parseClinicRecordError({ code: "P0001", message: "LOG_INVALID: rekam medis belum tersedia" }))
      .toMatch(/rawat inap/);
    expect(parseClinicRecordError({ code: "P0001", message: "IDEMPOTENCY_CONFLICT: key" }))
      .toMatch(/Form pemeriksaan/);
    expect(parseClinicRecordError({ code: "P0001", message: "RECIPE_REQUIRED: Obat Racik Batuk" }))
      .toBe('Obat racik "Obat Racik Batuk" wajib diisi komposisinya. Hapus baris ini lalu tambahkan lewat tombol "Racikan baru" di rekam medis.');
    expect(parseClinicPostingError({ code: "P0001", message: "RECIPE_REQUIRED: Obat Racik Batuk" }))
      .toMatch(/^Obat racik "Obat Racik Batuk" wajib diisi komposisinya/);
    expect(parseClinicRecordError({ code: "23505", message: "sensitive database constraint" }))
      .toBe("Rekam medis belum tersimpan. Periksa data dan coba lagi.");
  });
});

describe("toClinicCompoundRecipeInput", () => {
  it("maps form ingredients to the RPC contract without client HPP or unit factors", () => {
    const ingredientFromForm = {
      item_id: "item-1", nama: "Obat A", qty: 2, satuan: "gram", harga: 250,
      hpp: 100, faktor: 12,
    };
    expect(toClinicCompoundRecipeInput({
      recipeName: "  Puyer Batuk  ",
      dosageInstruction: "  2x sehari  ",
      dosageForm: "puyer",
      ingredients: [ingredientFromForm],
    })).toEqual({
      recipe_name: "Puyer Batuk",
      dosage_instruction: "2x sehari",
      dosage_form: "puyer",
      ingredients: [{ item_id: "item-1", quantity: 2, unit: "gram", unit_price: 250 }],
    });
  });
});
