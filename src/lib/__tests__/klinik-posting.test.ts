import { describe, expect, it } from "vitest";
import { parseClinicPostingError, toClinicCompoundRecipeInput } from "../klinik-posting";

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
