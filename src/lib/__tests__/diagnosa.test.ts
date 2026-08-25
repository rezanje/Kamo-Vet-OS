import { describe, it, expect } from "vitest";
import { samakan, kelompokDiagnosa } from "../diagnosa";

describe("samakan", () => {
  it("beda huruf besar-kecil dan spasi dianggap sama", () => {
    expect(samakan("Gastritis")).toBe(samakan("  gastritis  "));
  });
  it("spasi ganda dirapikan", () => {
    expect(samakan("Feline  Panleukopenia")).toBe("feline panleukopenia");
  });
  it("tanda baca di ujung dibuang", () => {
    expect(samakan("Scabies.")).toBe("scabies");
  });
  it("kosong tetap kosong", () => {
    expect(samakan("   ")).toBe("");
    expect(samakan(null as unknown as string)).toBe("");
  });
});

describe("kelompokDiagnosa", () => {
  it("menggabungkan ejaan berbeda jadi satu baris", () => {
    const r = kelompokDiagnosa(["Gastritis", "Gastritis", "gastritis", "Scabies"]);
    expect(r).toHaveLength(2);
    expect(r[0].jumlah).toBe(3);
    expect(r[0].nama).toBe("Gastritis");
    expect(r[0].ejaanLain).toEqual(["gastritis"]);
  });

  it("ejaan yang paling sering dipakai yang ditampilkan", () => {
    const r = kelompokDiagnosa(["gastritis", "gastritis", "Gastritis"]);
    expect(r[0].nama).toBe("gastritis");
    expect(r[0].ejaanLain).toEqual(["Gastritis"]);
  });

  it("penulisan yang sudah konsisten tidak punya ejaan lain", () => {
    expect(kelompokDiagnosa(["Scabies", "Scabies"])[0].ejaanLain).toEqual([]);
  });

  it("terbanyak di atas", () => {
    const r = kelompokDiagnosa(["A", "B", "B", "C", "C", "C"]);
    expect(r.map((x) => x.nama)).toEqual(["C", "B", "A"]);
  });

  it("kosong dan null tidak jadi baris hantu", () => {
    expect(kelompokDiagnosa(["", null, undefined, "   "])).toEqual([]);
  });
});
