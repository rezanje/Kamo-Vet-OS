import { describe, expect, it } from "vitest";
import { tampilkanKaryawan } from "../karyawan-master";

describe("tampilkanKaryawan", () => {
  it("tetap menampilkan karyawan saat nama cabang dipetakan terpisah", () => {
    const rows = tampilkanKaryawan(
      [{ id: "emp-1", nama: "Dea", branch_id: "branch-1", status: "Aktif" }],
      [{ id: "branch-1", name: "Kamo Petshop Cimanggu" }],
      [{ employee_id: "emp-1", branch_id: "branch-2", role: "SECONDARY", effective_date: "2026-09-17" }],
    );

    expect(rows).toMatchObject([{
      id: "emp-1",
      nama: "Dea",
      branchName: "Kamo Petshop Cimanggu",
      assignments: [{ branchName: "Cabang tidak ditemukan", role: "SECONDARY", effective_date: "2026-09-17" }],
      status: "Aktif",
    }]);
  });
});
