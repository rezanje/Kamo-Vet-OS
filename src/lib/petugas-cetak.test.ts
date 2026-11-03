import { describe, expect, it } from "vitest";
import { idPetugas, petugasCetak, type KartuPetugas } from "./petugas-cetak";

const kartu = new Map<string, KartuPetugas>([
  ["drh", { nama: "drh. Sinta", jabatan: "Dokter Hewan" }],
  ["agung", { nama: "Agung", jabatan: "Groomer" }],
  ["kasir", { nama: "Rina", jabatan: "Kasir" }],
  ["para", { nama: "Budi", jabatan: "Paramedis" }],
  ["kosong", { nama: "Tanpa Jabatan", jabatan: null }],
]);

describe("petugasCetak", () => {
  it("groups the grooming visit PJ under Groomer and the examining doctor under Dokter", () => {
    const rows = petugasCetak({ poli: "Grooming", doctor_id: "agung" },
      [{ service_performers: { doctor_id: "drh", doctor_name: "drh. Sinta", staff_id: "agung", staff_name: "Agung" } }], kartu);
    expect(rows).toEqual([{ label: "Dokter", nama: "drh. Sinta" }, { label: "Groomer", nama: "Agung" }]);
  });

  it("puts everyone who is neither doctor nor groomer under Staff, each once, in fixed order", () => {
    const rows = petugasCetak({ poli: "Poli Umum", doctor_id: "drh" }, [
      { service_performers: { doctor_id: "drh", doctor_name: "drh. Sinta", staff_id: "kasir", staff_name: "Rina" } },
      { service_performers: { doctor_id: null, staff_id: "para", staff_name: "Budi" } },
      { service_performers: { doctor_id: "drh", doctor_name: "drh. Sinta", staff_id: "agung", staff_name: "Agung" } },
      { service_performers: null },
    ], kartu);
    expect(rows).toEqual([
      { label: "Dokter", nama: "drh. Sinta" },
      { label: "Groomer", nama: "Agung" },
      { label: "Staff", nama: "Rina, Budi" },
    ]);
  });

  it("classifies by job title, not by the slot the person was entered in", () => {
    // Dokter dipilih di slot non-dokter tetap tercetak sebagai Dokter.
    expect(petugasCetak(null, [{ service_performers: { staff_id: "drh", staff_name: "drh. Sinta" } }], kartu))
      .toEqual([{ label: "Dokter", nama: "drh. Sinta" }]);
  });

  it("falls back to the slot when the job title is unknown", () => {
    expect(petugasCetak({ poli: "Grooming", dokter: "Teks Lama" }, [
      { service_performers: { doctor_id: "kosong", doctor_name: "Tanpa Jabatan" } },
      { service_performers: { staff_id: "hilang", staff_name: "Kartu Hilang" } },
    ], kartu)).toEqual([
      { label: "Dokter", nama: "Tanpa Jabatan" },
      { label: "Groomer", nama: "Teks Lama" },
      { label: "Staff", nama: "Kartu Hilang" },
    ]);
    expect(petugasCetak({ poli: "Poli Umum", dokter: "PIC Kasus" }, [], kartu)).toEqual([{ label: "Dokter", nama: "PIC Kasus" }]);
  });

  it("prints the name stored on the line, not today's card name", () => {
    expect(petugasCetak(null, [{ service_performers: { doctor_id: "drh", doctor_name: "drh. Sinta (lama)" } }], kartu))
      .toEqual([{ label: "Dokter", nama: "drh. Sinta (lama)" }]);
  });

  it("prints nothing when nobody is recorded", () => {
    expect(petugasCetak({ poli: "Poli Umum" }, [{ service_performers: null }], kartu)).toEqual([]);
    expect(petugasCetak(null, [], kartu)).toEqual([]);
  });

  it("collects every employee id needed to classify", () => {
    expect(idPetugas([{ doctor_id: "agung" }, null], [{ service_performers: { doctor_id: "drh", staff_id: "agung" } }]))
      .toEqual(["agung", "drh"]);
  });
});
