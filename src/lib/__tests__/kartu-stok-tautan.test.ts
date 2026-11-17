import { describe, expect, it } from "vitest";
import { rencanaTautan, TARGET } from "@/lib/kartu-stok-tautan";

describe("rencanaTautan", () => {
  it("reads only the tables a source can point to, batching numbers per table", () => {
    const r = rencanaTautan([
      { source: "faktur-langsung", source_ref: "FB.2026.11.00043" },
      { source: "faktur-langsung", source_ref: "FB.2026.11.00044" },
      { source: "transfer", source_ref: "PMB-1" },
    ]);
    expect([...r.keys()].sort()).toEqual(["fakturBeli", "pemindahan"]);
    expect([...r.get("fakturBeli")!]).toEqual(["FB.2026.11.00043", "FB.2026.11.00044"]);
  });

  it("looks up request ids by id and request numbers by number", () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const r = rencanaTautan([
      { source: "terima-permintaan", source_ref: id },
      { source: "kirim-permintaan", source_ref: "PRM-20261114-0002" },
    ]);
    expect([...r.get("permintaanId")!]).toEqual([id]);
    expect([...r.get("permintaan")!]).toEqual(["PRM-20261114-0002"]);
  });

  it("skips audit ids, opening balances and empty refs; unknown sources try every number table", () => {
    const r = rencanaTautan([
      { source: "sale-void", source_ref: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
      { source: "saldo-awal", source_ref: "IMPORT" },
      { source: "sale", source_ref: null },
      { source: "sumber-baru", source_ref: "XYZ-0001" },
    ]);
    const nomor = Object.keys(TARGET).filter((k) => TARGET[k].kolom !== "id");
    expect([...r.keys()].sort()).toEqual(nomor.sort());
  });
});
