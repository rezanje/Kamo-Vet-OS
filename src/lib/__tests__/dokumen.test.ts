import { describe, expect, it } from "vitest";
import { namaFileAman, parseLampiran } from "../dokumen";

describe("namaFileAman", () => {
  it("karakter aneh & spasi jadi strip", () => {
    expect(namaFileAman("Nota Listrik Juli.pdf")).toBe("Nota-Listrik-Juli.pdf");
  });
  it("percobaan naik folder tidak menyisakan slash atau titik ganda berbahaya", () => {
    expect(namaFileAman("../../etc/passwd")).toBe("etc-passwd");
  });
  it("nama kosong tetap dapat nama", () => {
    expect(namaFileAman("///")).toBe("dokumen");
  });
});

describe("parseLampiran", () => {
  it("JSON rusak jadi kosong", () => {
    expect(parseLampiran("bukan json")).toEqual([]);
    expect(parseLampiran('{"path":"a"}')).toEqual([]);
  });

  it("path kosong / naik folder / absolut dibuang", () => {
    const rows = parseLampiran(JSON.stringify([
      { path: "", nama: "a" },
      { path: "../rahasia.pdf", nama: "b" },
      { path: "/etc/passwd", nama: "c" },
      { path: "pengeluaran/1-nota.pdf", nama: "nota.pdf", mime: "application/pdf", ukuran: 1234 },
    ]));
    expect(rows).toEqual([
      { path: "pengeluaran/1-nota.pdf", nama: "nota.pdf", mime: "application/pdf", ukuran: 1234 },
    ]);
  });

  it("ukuran tidak masuk akal jadi null, nama kosong dapat default", () => {
    const [row] = parseLampiran(JSON.stringify([{ path: "x/y.png", nama: "  ", ukuran: -5 }]));
    expect(row).toMatchObject({ nama: "dokumen", ukuran: null, mime: null });
  });
});
