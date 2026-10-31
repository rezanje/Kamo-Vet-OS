import { describe, expect, it } from "vitest";
import { requirePosRetailWarehouse } from "../pos-retail-warehouse";

type Warehouse = { id: string; branch_id: string; type: string; is_active: boolean };

function database(rows: Warehouse[]) {
  return {
    from(table: string) {
      expect(table).toBe("warehouses");
      let result = rows;
      return {
        select() { return this; },
        eq(column: keyof Warehouse, value: Warehouse[keyof Warehouse]) {
          result = result.filter(row => row[column] === value);
          return this;
        },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() {
          return result.length > 1
            ? { data: null, error: { message: "multiple warehouses" } }
            : { data: result[0] ?? null, error: null };
        },
      };
    },
  };
}

const retail: Warehouse = { id: "retail", branch_id: "pandu", type: "RETAIL", is_active: true };
const online: Warehouse = { id: "online", branch_id: "pandu", type: "ONLINE", is_active: true };

describe("requirePosRetailWarehouse", () => {
  it("uses the branch's RETAIL warehouse when ONLINE also exists", async () => {
    expect(await requirePosRetailWarehouse(database([online, retail]), "pandu")).toBe("retail");
  });

  it("rejects a stock sale if only an ONLINE warehouse exists", async () => {
    await expect(requirePosRetailWarehouse(database([online]), "pandu")).rejects.toThrow("Gudang retail");
  });

  it("rejects another branch's RETAIL warehouse", async () => {
    await expect(requirePosRetailWarehouse(database([{ ...retail, branch_id: "tki" }]), "pandu")).rejects.toThrow("Gudang retail");
  });
});
