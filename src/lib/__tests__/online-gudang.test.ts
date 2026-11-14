import { describe, expect, it } from "vitest";
import { TIPE_GUDANG_ORDER_ONLINE, gudangUtamaPerCabang, kelompokPerCabang, labelTipeGudang, muatGudangOrderOnline, tentukanGudangImpor } from "@/lib/online-gudang";

const g = (id: string, branch: string, type: string, name = id) => ({ id, name, branch_id: `b-${branch}`, branch_name: branch, type });

describe("gudang order online", () => {
  it("expired & transit tidak pernah bisa dipilih (sama dengan aturan database)", () => {
    expect(TIPE_GUDANG_ORDER_ONLINE).not.toContain("EXPIRED");
    expect(TIPE_GUDANG_ORDER_ONLINE).not.toContain("TRANSIT");
    expect([...TIPE_GUDANG_ORDER_ONLINE].sort()).toEqual(["DC", "ONLINE", "RETAIL", "VET"]);
  });

  it("dikelompokkan per cabang; dalam cabang gudang online dulu, lalu toko", () => {
    const k = kelompokPerCabang([g("t", "Panduraya", "RETAIL"), g("p", "Pusat", "RETAIL"), g("o", "Panduraya", "ONLINE"), g("v", "Panduraya", "VET")]);
    expect(k.map((x) => [x.cabang, x.gudang.map((w) => w.id)])).toEqual([["Panduraya", ["o", "t", "v"]], ["Pusat", ["p"]]]);
  });

  it("label jenis gudang bahasa sehari-hari", () => {
    expect(labelTipeGudang("RETAIL")).toBe("Toko/Petshop");
    expect(labelTipeGudang("ONLINE")).toBe("Online");
  });

  it("query membaca jenis yang diizinkan saja dan meratakan nama cabang", async () => {
    const calls: unknown[] = [];
    const q = {
      select: (c: string) => { calls.push(["select", c]); return q; },
      in: (c: string, v: unknown) => { calls.push(["in", c, v]); return q; },
      eq: (c: string, v: unknown) => { calls.push(["eq", c, v]); return q; },
      order: () => q,
      then: (ok: (v: unknown) => unknown) => ok({ data: [{ id: "w", name: "Toko", branch_id: "b", type: "RETAIL", branches: [{ name: "Kamo Pusat" }] }], error: null }),
    };
    const { data, error } = await muatGudangOrderOnline({ from: () => q } as never);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: "w", name: "Toko", branch_id: "b", type: "RETAIL", branch_name: "Kamo Pusat" }]);
    expect(calls).toContainEqual(["in", "type", ["ONLINE", "RETAIL", "DC", "VET"]]);
    expect(calls).toContainEqual(["eq", "is_active", true]);
  });
});

describe("E4: gudang impor otomatis per cabang", () => {
  const g = (id: string, branch: string, type: string, name = id) => ({ id, name, branch_id: branch, branch_name: `Cabang ${branch}`, type });
  const rows = [
    g("pdry", "PDRY", "RETAIL", "WH PDRY"), g("online-pdry", "PDRY", "ONLINE", "WH ONLINE PDRY"),
    g("b2c", "B2C", "ONLINE", "WH B2C"),
    g("dc1", "DC", "DC"), g("dc2", "DC", "DC"),
    g("vet", "VET", "VET"),
  ];

  it("gudang utama: Toko bila ada, satu-satunya gudang bila tidak, cabang dengan gudang setara ganda tidak ditebak", () => {
    expect(gudangUtamaPerCabang(rows).map(c => [c.id, c.gudang.id])).toEqual([
      ["B2C", "b2c"], ["PDRY", "pdry"], ["VET", "vet"],
    ]);
  });

  it("akun satu cabang terkunci; multi-cabang memakai pilihan yang sah saja", () => {
    expect(tentukanGudangImpor(rows, ["PDRY"], "B2C")).toMatchObject({ terkunci: true, terpilih: { id: "PDRY", gudang: { id: "pdry" } } });
    expect(tentukanGudangImpor(rows, null, "B2C")).toMatchObject({ terkunci: false, terpilih: { gudang: { id: "b2c" } } });
    expect(tentukanGudangImpor(rows, ["PDRY", "VET"], "B2C").terpilih).toBeNull();
    expect(tentukanGudangImpor(rows, null, "DC").terpilih).toBeNull();
    expect(tentukanGudangImpor(rows, [], null)).toEqual({ cabang: [], terkunci: false, terpilih: null });
  });
});
