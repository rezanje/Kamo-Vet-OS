import { expect, it } from "vitest";
import { bolehBukaPath, modulDiizinkan, MODULE_PATHS, SEMUA_PERAN, roleUsesLegacyStaffShell } from "../akses";
it("only legacy/default STAFF keeps the clinic-only shell",()=>{
 expect(roleUsesLegacyStaffShell("STAFF",[])).toBe(true);
 expect(roleUsesLegacyStaffShell("STAFF",rows("STAFF",["__role_v2__"])) ).toBe(false);
 for(const role of SEMUA_PERAN.filter(r=>r!=="STAFF"))expect(roleUsesLegacyStaffShell(role,[])).toBe(false);
});
import { MODULES, TILES } from "../nav";
it("v2 canonical longest-prefix/query normalization covers every real navigation pathname", () => {
 // ADMIN: original default was every module, so the complete selection keeps the full original reach.
 const rules=rows("ADMIN",["__role_v2__",...MODULES.map(m=>m.id),"kasir","quest-staff","pos-shift"]);
 const paths=new Set([...MODULES.map(m=>m.id==="dashboard"?"/":`/${m.id}`),...Object.values(TILES).flatMap(tiles=>tiles.flatMap(t=>t.href?[t.href.split(/[?#]/)[0]]:[])),"/kasir","/pos/quest"]);
 // +1: Laporan Visit Rawat Inap (A4, meeting 12 Nov 2026). +2: Stok Slow Moving dan Stok Harus Order (13 Nov 2026).
  expect(paths.size).toBe(152);for(const path of paths)expect(bolehBukaPath("ADMIN",path,rules),path).toBe(true);
 expect(bolehBukaPath("ADMIN","/pembelian?tab=supplier#list",rules)).toBe(true);
 // Original matcher: `pengaturan` opens /pengaturan/pajak; v2 keeps that (saving the displayed list must not narrow).
 expect(bolehBukaPath("STAFF","/pengaturan/pajak",rows("STAFF",["__role_v2__","pengaturan"]))).toBe(true);
 expect(bolehBukaPath("STAFF","/pengaturan/pajak",rows("STAFF",["pengaturan"]))).toBe(true);
});
const rows = (role: string, ids: string[]) => ids.map(module_id => ({ role, module_id }));
it("marker-only denies every module for all nonOwner roles, preserves recovery and Owner", () => {
  for (const role of SEMUA_PERAN) {
    const rules = rows(role, ["__role_v2__"]);
    for (const prefixes of Object.values(MODULE_PATHS)) for (const path of prefixes) expect(bolehBukaPath(role, path, rules), `${role}:${path}`).toBe(role === "OWNER");
    expect(bolehBukaPath(role, "/kasir", rules)).toBe(role === "OWNER");
    for (const path of ["/me", "/mulai", "/login", "/auth/callback", "/booking/new", "/me?tab=profile", "/login#help"]) expect(bolehBukaPath(role, path, rules)).toBe(true);
    if (role !== "OWNER") expect(modulDiizinkan(role, rules)).toEqual([]);
  }
});
it("longest operational group beats inventory/kasir and each entry grants its own URLs", () => {
  expect(MODULES).toHaveLength(14);
  for (const role of SEMUA_PERAN.filter(r => r !== "OWNER")) {
    const rules = rows(role, ["__role_v2__", "pos", "kasir"]);
    expect(bolehBukaPath(role, "/pos/sku", rules)).toBe(true);
    // The original matcher never granted these pages to a module-restricted role; v2 must not widen that.
    expect(bolehBukaPath(role, "/pajak/faktur", rows(role, ["__role_v2__", "pajak"]))).toBe(false);
    expect(bolehBukaPath(role, "/keuangan/laba-ditahan", rows(role, ["__role_v2__", "laporan"]))).toBe(false);
    for (const path of ["/pos/quest", "/kasir/quest/reward", "/pos/shift/riwayat"]) expect(bolehBukaPath(role, path, rules)).toBe(false);
    for (const [id, paths] of Object.entries(MODULE_PATHS)) for (const path of paths) expect(bolehBukaPath(role, path, rows(role, ["__role_v2__", id])), `${id}:${path}`).toBe(id !== "quest-staff"); // quest-staff also needs its own area, see role-quest-default.test.ts
    expect(bolehBukaPath(role, "/pos/quest", rows(role, ["__role_v2__", "pos", "quest-staff"]))).toBe(true);
    expect(bolehBukaPath(role, "/kasir/quest", rows(role, ["__role_v2__", "kasir", "quest-staff"]))).toBe(true);
  }
});
