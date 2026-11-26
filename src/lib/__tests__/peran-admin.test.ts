import { describe, expect, it } from "vitest";
import { ADMIN_UMUM, LABEL_ADMIN_UMUM, PERAN_ADMIN, PERAN_ISTIMEWA_BAGI_ADMIN_UMUM, adminUmumDilarang, isAdminRole, peranPenyetujuEfektif } from "../peran-admin";
import { SEMUA_PERAN, bolehBukaPath, modulBawaan } from "../akses";
import { editableRole } from "../role-access-catalog";
import { labelPeran } from "../admin-online";
import { roleCapabilities } from "../role-capabilities";
import { GRANT_ONLY_ACTIONS, GRANT_ONLY_LEGACY_ROLES, legacyRoleHasAction } from "../role-grant-only-actions";

describe("peran Admin Umum: konstanta dan pembantu", () => {
  it("kode, label, dan pasangan peran admin", () => {
    expect(ADMIN_UMUM).toBe("ADMIN_UMUM");
    expect(LABEL_ADMIN_UMUM).toBe("Admin Umum");
    expect([...PERAN_ADMIN]).toEqual(["ADMIN", "ADMIN_UMUM"]);
  });
  it("isAdminRole: ADMIN dan ADMIN_UMUM saja (OWNER, FINANCE, ADMIN_ONLINE, kosong, huruf kecil bukan)", () => {
    expect(isAdminRole("ADMIN")).toBe(true);
    expect(isAdminRole("ADMIN_UMUM")).toBe(true);
    for (const r of ["OWNER", "FINANCE", "STAFF", "DOCTOR", "ADMIN_ONLINE", "admin", "admin_umum", "", null, undefined]) expect(isAdminRole(r as never)).toBe(false);
  });
  it("antrean penyetuju: ADMIN_UMUM memakai antrean ADMIN, peran lain tetap", () => {
    expect(peranPenyetujuEfektif("ADMIN_UMUM")).toBe("ADMIN");
    for (const r of ["OWNER", "ADMIN", "FINANCE", "STAFF"]) expect(peranPenyetujuEfektif(r)).toBe(r);
  });
  it("label tampilan", () => {
    expect(labelPeran("ADMIN_UMUM")).toBe("Admin Umum");
    expect(labelPeran("ADMIN")).toBe("ADMIN");
  });
});

describe("peran Admin Umum: akses bawaan sama seperti ADMIN, bukan OWNER", () => {
  it("ada di daftar peran dan bisa diatur di Akses Grup (OWNER tidak)", () => {
    expect((SEMUA_PERAN as readonly string[]).includes("ADMIN_UMUM")).toBe(true);
    expect(editableRole("ADMIN_UMUM")).toBe(true);
    expect(editableRole("OWNER")).toBe(false);
  });
  it("modul bawaan identik dengan ADMIN", () => {
    expect(modulBawaan("ADMIN_UMUM")).toEqual(modulBawaan("ADMIN"));
    expect(modulBawaan("ADMIN_UMUM")).toBeNull(); // null = seluruh modul
    expect(modulBawaan("OWNER")).toBeNull();
  });
  it("bolehBuka: sama dengan ADMIN pada contoh jalur, dan jalur khusus OWNER tetap tertutup bagi keduanya", () => {
    for (const path of ["/keuangan/jurnal", "/penjualan", "/pembelian", "/laporan", "/pengaturan/pengguna", "/pengaturan/akses-grup"]) {
      expect(bolehBukaPath("ADMIN_UMUM", path, [])).toBe(bolehBukaPath("ADMIN", path, []));
    }
  });
  it("semua cabang seperti ADMIN; OWNER-setara tidak diberikan lewat kemampuan lain", () => {
    expect(roleCapabilities("ADMIN_UMUM")).toEqual(roleCapabilities("ADMIN"));
    expect(roleCapabilities("ADMIN_UMUM").all_branches).toBe(true);
  });
  it("koreksi jurnal manual adalah izin khusus (bawaan mati, hanya Owner yang memberi)", () => {
    expect(GRANT_ONLY_ACTIONS).toContain("jurnal.koreksi_manual");
    expect(legacyRoleHasAction("jurnal.koreksi_manual", "ADMIN_UMUM")).toBe(false);
    expect(legacyRoleHasAction("jurnal.koreksi_manual", "ADMIN")).toBe(false);
  });
  it("izin khusus diskon manual: bawaan hidup untuk ADMIN dan ADMIN_UMUM sama", () => {
    expect(GRANT_ONLY_LEGACY_ROLES["kasir.diskon_manual"]).toEqual(["ADMIN", "ADMIN_UMUM"]);
  });
});

describe("batas Admin Umum (database 20261219500000): penyaring tampilan", () => {
  it("peran istimewa bagi Admin Umum = OWNER, ADMIN, ADMIN_UMUM, FINANCE", () => {
    expect([...PERAN_ISTIMEWA_BAGI_ADMIN_UMUM]).toEqual(["OWNER", "ADMIN", "ADMIN_UMUM", "FINANCE"]);
  });
  it("adminUmumDilarang: hanya aktor ADMIN_UMUM, hanya untuk peran istimewa; STAFF/DOCTOR/ADMIN_ONLINE boleh", () => {
    for (const r of ["OWNER", "ADMIN", "ADMIN_UMUM", "FINANCE"]) expect(adminUmumDilarang("ADMIN_UMUM", r)).toBe(true);
    for (const r of ["STAFF", "DOCTOR", "ADMIN_ONLINE", "", null, undefined]) expect(adminUmumDilarang("ADMIN_UMUM", r as never)).toBe(false);
    for (const aktor of ["OWNER", "ADMIN", "FINANCE", "STAFF", null, undefined]) for (const r of ["OWNER", "ADMIN", "ADMIN_UMUM", "FINANCE", "STAFF"]) expect(adminUmumDilarang(aktor as never, r)).toBe(false);
  });
});
