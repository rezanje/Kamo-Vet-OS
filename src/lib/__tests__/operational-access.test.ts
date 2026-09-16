import { describe, expect, it } from "vitest";
import { canReadEmployee, canReadVisit, visitScopeFilter } from "../operational-access";

describe("canReadVisit", () => {
  it("dokter dapat melihat pasien yang ditugaskan langsung", () => {
    expect(canReadVisit({ role: "DOCTOR", branchIds: [], employeeId: "dr-a" }, {
      branchId: "cabang-b", doctorId: "dr-a",
    })).toBe(true);
  });

  it("dokter dapat melihat pasien di cabang penempatannya", () => {
    expect(canReadVisit({ role: "DOCTOR", branchIds: ["cabang-a"], employeeId: "dr-a" }, {
      branchId: "cabang-a", doctorId: "dr-b",
    })).toBe(true);
  });

  it("dokter tidak dapat melihat dokter dan cabang lain", () => {
    expect(canReadVisit({ role: "DOCTOR", branchIds: ["cabang-a"], employeeId: "dr-a" }, {
      branchId: "cabang-b", doctorId: "dr-b",
    })).toBe(false);
  });

  it("ADMIN hanya melihat cabang penempatannya", () => {
    expect(canReadVisit({ role: "ADMIN", branchIds: ["cabang-a"], employeeId: null }, {
      branchId: "cabang-b", doctorId: null,
    })).toBe(false);
  });
});

describe("canReadEmployee", () => {
  it("OWNER dapat melihat seluruh karyawan", () => {
    expect(canReadEmployee({ role: "OWNER", branchIds: null, employeeId: null }, ["cabang-b"])).toBe(true);
  });

  it("ADMIN hanya melihat karyawan yang punya penugasan cabang sama", () => {
    const admin = { role: "ADMIN", branchIds: ["cabang-a"], employeeId: null };
    expect(canReadEmployee(admin, ["cabang-a", "cabang-b"])).toBe(true);
    expect(canReadEmployee(admin, ["cabang-b"])).toBe(false);
  });
});

describe("visitScopeFilter", () => {
  it("menggabungkan cabang penugasan dan dokter sendiri", () => {
    expect(visitScopeFilter({ role: "DOCTOR", branchIds: ["cabang-a"], employeeId: "dr-a" }))
      .toBe("branch_id.eq.cabang-a,doctor_id.eq.dr-a");
  });

  it("menghasilkan filter yang tidak mungkin cocok bila tanpa akses", () => {
    expect(visitScopeFilter({ role: "ADMIN", branchIds: [], employeeId: null })).toBe("id.is.null");
  });

  it("tidak membatasi peran company-wide", () => {
    expect(visitScopeFilter({ role: "OWNER", branchIds: null, employeeId: null })).toBeNull();
  });
});
