import { describe, expect, it } from "vitest";
import { cekPeranVsJabatan, peranSaranJabatan, pesanPeranVsJabatan } from "@/lib/peran-vs-jabatan";

describe("peran akun vs jabatan HRIS", () => {
  it("memetakan jabatan klinis ke role yang lazim", () => {
    expect(peranSaranJabatan("Paramedis")).toBe("STAFF");
    expect(peranSaranJabatan("Staff Toko - Groomer")).toBe("STAFF");
    expect(peranSaranJabatan("STAF TOKO-GROOMER")).toBe("STAFF");
    expect(peranSaranJabatan("Dokter")).toBe("DOCTOR");
    expect(peranSaranJabatan("Dokter Hewan Ranap - Poli")).toBe("DOCTOR");
    expect(peranSaranJabatan("DOKTER HEWAN")).toBe("DOCTOR");
  });

  it("tidak menilai jabatan non-klinis atau kosong", () => {
    for (const j of ["CEO", "Admin", "Kepala Gudang", "Finance", "Marketing Staff", "", null, undefined]) {
      expect(peranSaranJabatan(j)).toBeNull();
    }
  });

  it("menandai paramedis yang akunnya Admin (kasus salah input)", () => {
    const beda = cekPeranVsJabatan("Paramedis", "ADMIN");
    expect(beda).toEqual({ jabatan: "Paramedis", sekarang: "ADMIN", saran: "STAFF" });
    expect(pesanPeranVsJabatan(beda!)).toContain("Pengaturan → Pengguna");
  });

  it("menandai paramedis yang akunnya Dokter, dan dokter yang akunnya Staf", () => {
    expect(cekPeranVsJabatan("Paramedis", "DOCTOR")?.saran).toBe("STAFF");
    expect(cekPeranVsJabatan("Dokter Hewan Poli", "STAFF")?.saran).toBe("DOCTOR");
  });

  it("diam bila sudah cocok atau akun belum ada", () => {
    expect(cekPeranVsJabatan("Paramedis", "STAFF")).toBeNull();
    expect(cekPeranVsJabatan("Dokter", "DOCTOR")).toBeNull();
    expect(cekPeranVsJabatan("Paramedis", null)).toBeNull();
    expect(cekPeranVsJabatan("CEO", "DOCTOR")).toBeNull();
  });
});
