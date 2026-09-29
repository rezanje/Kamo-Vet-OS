import { describe, expect, it } from "vitest";
import { katalogFromRows, katalogTotal } from "../katalog-racikan";

describe("katalog racikan", () => {
  it("memilih versi aktif yang ditunjuk master dan menghitung total dari snapshot", () => {
    const ingredients = [{ item_id: "item", name: "Bahan", quantity: 2, unit: "gram", unit_price: 15 }];
    const [formula] = katalogFromRows(
      [{ id: "formula", code: "R-01", active: true, current_version_id: "v2" }],
      [
        { id: "v1", version: 1, name: "Lama", dosage_form: "puyer", dosage_instruction: null, ingredients },
        { id: "v2", version: 2, name: "Baru", dosage_form: "sirup", dosage_instruction: "2x", ingredients },
      ],
    );
    expect(formula.name).toBe("Baru");
    expect(formula.version_id).toBe("v2");
    expect(katalogTotal(formula.ingredients)).toBe(30);
  });
});
