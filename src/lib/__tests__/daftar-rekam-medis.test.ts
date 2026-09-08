import { describe, expect, it } from "vitest";
import { TILES } from "../nav";

async function saring(entries: Array<{ ownerName: string; petName: string; phone: string }>, query: string) {
  const loaded = await import("../daftar-rekam-medis").catch(() => ({}));
  expect(loaded).toHaveProperty("saringDaftarRekamMedis");
  return (loaded as {
    saringDaftarRekamMedis: (rows: typeof entries, q: string) => typeof entries;
  }).saringDaftarRekamMedis(entries, query);
}

describe("pintu masuk daftar rekam medis", () => {
  it("membuka daftar rekam medis dari menu klinik", () => {
    const tile = TILES.klinik.find((entry) => entry.label === "Rekam medis");

    expect(tile?.href).toBe("/klinik/rekam-medis");
  });
});

describe("pencarian daftar rekam medis", () => {
  it("menemukan riwayat dari nama hewan tanpa membedakan huruf besar kecil", async () => {
    const rows = [
      { ownerName: "Resti Khalillah R", petName: "Oreo", phone: "081384467002" },
      { ownerName: "Resti Khalillah R", petName: "Molly", phone: "081384467002" },
    ];

    await expect(saring(rows, "oReO")).resolves.toEqual([rows[0]]);
  });

  it("menemukan semua hewan milik owner dari namanya", async () => {
    const rows = [
      { ownerName: "Resti Khalillah R", petName: "Oreo", phone: "081384467002" },
      { ownerName: "Resti Khalillah R", petName: "Molly", phone: "081384467002" },
      { ownerName: "Tegar", petName: "Cimot", phone: "081300000000" },
    ];

    await expect(saring(rows, "resti")).resolves.toEqual([rows[0], rows[1]]);
  });
});
