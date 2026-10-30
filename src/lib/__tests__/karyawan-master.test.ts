import { describe, expect, it } from "vitest";
import { tampilkanKaryawan } from "../karyawan-master";

const HARI_INI = "2026-10-29";

describe("tampilkanKaryawan", () => {
  it("tetap menampilkan karyawan saat nama cabang dipetakan terpisah", () => {
    const rows = tampilkanKaryawan(
      [{ id: "emp-1", nama: "Dea", branch_id: "branch-1", status: "Aktif" }],
      [{ id: "branch-1", name: "Kamo Petshop Cimanggu" }],
      [{ employee_id: "emp-1", branch_id: "branch-2", role: "SECONDARY", effective_date: "2026-09-17" }],
      HARI_INI,
    );

    expect(rows).toMatchObject([{
      id: "emp-1",
      nama: "Dea",
      branchName: "Kamo Petshop Cimanggu",
      assignments: [{ branchName: "Cabang tidak ditemukan", role: "SECONDARY", effective_date: "2026-09-17" }],
      status: "Aktif",
    }]);
  });

  // R1: HR harus bisa membedakan penugasan berjalan, belum berlaku, dan sudah berakhir.
  it("menandai penugasan yang belum berlaku dan yang sudah berakhir", () => {
    const [row] = tampilkanKaryawan(
      [{ id: "emp-1", nama: "Dea", branch_id: null, status: "Aktif" }],
      [{ id: "b1", name: "Cabang A" }, { id: "b2", name: "Cabang B" }, { id: "b3", name: "Cabang C" }],
      [
        { employee_id: "emp-1", branch_id: "b1", role: "SECONDARY", effective_date: "2026-09-01", end_date: null },
        { employee_id: "emp-1", branch_id: "b2", role: "SECONDARY", effective_date: "2026-11-05", end_date: null },
        { employee_id: "emp-1", branch_id: "b3", role: "SECONDARY", effective_date: "2026-09-01", end_date: "2026-10-28" },
      ],
      HARI_INI,
    );
    expect(row.assignments.map(item => [item.branchName, item.keadaan, item.keterangan])).toEqual([
      ["Cabang A", "berjalan", ""],
      ["Cabang B", "akan-datang", "Mulai 5 Nov"],
      ["Cabang C", "berakhir", "Berakhir 28 Okt"],
    ]);
  });
});
