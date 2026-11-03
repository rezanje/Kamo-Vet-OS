import { expect, it } from "vitest";
import { bolehBukaPath, MODULE_PATHS, ROLE_V2_MARKER } from "../akses";
import { MODULES, TILES } from "../nav";

// M1: the editor displays the migration's effective module list for default/legacy roles
// (role_settings_private.snapshot). Saving that list unchanged must give exactly the ORIGINAL
// reach: STAFF/DOCTOR (without the pos module) reached /kasir (incl. /kasir/quest) but never /pos/quest.
const rows = (role: string, ids: string[]) => ids.map(module_id => ({ role, module_id }));
const probes = [...new Set([
  ...Object.values(MODULE_PATHS).flat().flatMap(p => [p, `${p}/x`]),
  ...Object.values(TILES).flatMap(t => t.flatMap(x => (x.href ? [x.href.split(/[?#]/)[0]] : []))),
  ...MODULES.map(m => (m.id === "dashboard" ? "/" : `/${m.id}`)),
  "/kasir", "/kasir/quest", "/kasir/quest/reward", "/kasir/riwayat", "/pos/quest", "/pos/quest/x", "/pos/shift", "/pos/shift/riwayat", "/pos/sku", "/me", "/mulai",
])];
// Exactly what snapshot() returns as source defaults/legacy (see migration 120000).
const DISPLAYED: [string, string, string[], string[]][] = [
  ["STAFF default (no rows)", "STAFF", [], ["klinik", "kasir", "quest-staff"]],
  ["STAFF legacy without pos", "STAFF", ["klinik", "crm"], ["klinik", "crm", "kasir", "quest-staff"]],
  ["STAFF legacy with pos", "STAFF", ["klinik", "pos"], ["klinik", "pos", "kasir", "quest-staff", "pos-shift"]],
  ["DOCTOR legacy dashboard,klinik,laporan (live shape)", "DOCTOR", ["dashboard", "klinik", "laporan"], ["dashboard", "klinik", "laporan", "kasir", "quest-staff"]],
  ["DOCTOR legacy with pos", "DOCTOR", ["klinik", "pos"], ["klinik", "pos", "kasir", "quest-staff", "pos-shift"]],
  ["FINANCE default", "FINANCE", [], ["dashboard", "buku-besar", "kas-bank", "aset-tetap", "pajak", "laporan", "pos-shift"]],
  ["FINANCE legacy (live shape)", "FINANCE", ["aset-tetap", "buku-besar", "dashboard", "kas-bank", "laporan", "pajak", "penjualan"], ["aset-tetap", "buku-besar", "dashboard", "kas-bank", "laporan", "pajak", "penjualan", "pos-shift"]],
  ["ADMIN legacy (live shape)", "ADMIN", ["dashboard", "klinik", "laporan", "pembelian", "penjualan", "pos"], ["dashboard", "klinik", "laporan", "pembelian", "penjualan", "pos", "quest-staff", "pos-shift"]],
];
// Full route-tree coverage (incl. /pajak*, /aset-tetap*, /keuangan/laba-ditahan*) lives in role-reach-equivalence.test.ts.
it.each(DISPLAYED)("saving the displayed default of %s keeps exactly the original reach", (_n, role, original, displayed) => {
  const before = rows(role, original), after = rows(role, [ROLE_V2_MARKER, ...displayed]);
  const diff = probes.filter(path => bolehBukaPath(role, path, before) !== bolehBukaPath(role, path, after));
  expect(diff).toEqual([]);
});
it("STAFF/DOCTOR without pos: the displayed quest-staff opens /kasir/quest only, never /pos/quest", () => {
  for (const role of ["STAFF", "DOCTOR"]) {
    const saved = rows(role, [ROLE_V2_MARKER, "klinik", "kasir", "quest-staff"]);
    expect(bolehBukaPath(role, "/kasir/quest", saved)).toBe(true);
    expect(bolehBukaPath(role, "/kasir/quest/reward", saved)).toBe(true);
    expect(bolehBukaPath(role, "/pos/quest", saved)).toBe(false);
    expect(bolehBukaPath(role, "/pos", saved)).toBe(false);
  }
});
it("each quest screen needs quest-staff AND its own area: /pos/quest needs pos, /kasir/quest needs kasir; neither area alone grants quest", () => {
  const role = "ADMIN", v2 = (...ids: string[]) => rows(role, [ROLE_V2_MARKER, ...ids]);
  expect(bolehBukaPath(role, "/pos/quest", v2("pos", "quest-staff"))).toBe(true);
  expect(bolehBukaPath(role, "/pos/quest", v2("quest-staff"))).toBe(false);
  expect(bolehBukaPath(role, "/pos/quest", v2("pos", "kasir"))).toBe(false);
  expect(bolehBukaPath(role, "/kasir/quest", v2("kasir", "quest-staff"))).toBe(true);
  expect(bolehBukaPath(role, "/kasir/quest", v2("quest-staff"))).toBe(false);
  expect(bolehBukaPath(role, "/kasir/quest", v2("kasir", "pos"))).toBe(false);
  expect(bolehBukaPath(role, "/kasir/quest", v2("pos", "quest-staff", "pos-shift"))).toBe(false); // ADMIN with legacy pos never reached /kasir
  expect(bolehBukaPath(role, "/pos/quest", v2("kasir", "quest-staff"))).toBe(false);
});
it("legacy rows keep their exact historical behavior until explicitly saved", () => {
  expect(bolehBukaPath("STAFF", "/kasir/quest", [])).toBe(true);
  expect(bolehBukaPath("STAFF", "/pos/quest", [])).toBe(false);
  expect(bolehBukaPath("DOCTOR", "/pos/quest", rows("DOCTOR", ["dashboard", "klinik", "laporan"]))).toBe(false);
  expect(bolehBukaPath("STAFF", "/pos/quest", rows("STAFF", ["pos"]))).toBe(true);
  expect(bolehBukaPath("OWNER", "/pos/quest", [])).toBe(true);
});
