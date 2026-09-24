import { describe, expect, it } from "vitest";
import { parseClinicPostingError } from "../klinik-posting";

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

  it("does not expose an unknown database error to the cashier", () => {
    expect(parseClinicPostingError({ code: "23505", message: "duplicate key value violates constraint invoices_visit_id_key" }))
      .toBe("Transaksi belum tersimpan. Periksa apakah invoice sudah dibuat lalu coba lagi.");
  });
});
