import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bolehBukaPath, ROLE_V2_MARKER } from "../akses";
import { MODULES, TILES } from "../nav";

// Reach-equivalence: for EVERY protected route, EVERY role and EVERY legacy-row shape, saving the editor's
// displayed list (marker + role_settings_private.snapshot() effective modules) must give exactly the reach the
// ORIGINAL matcher gave for that legacy shape. "Original" is frozen below, byte-for-byte logic of base 0d5e2434.
const ORIGINAL_MODULE_PATHS: Record<string, string[]> = {
  dashboard: ["/"], klinik: ["/klinik"], crm: ["/crm"], hris: ["/hris"], pengaturan: ["/pengaturan"], perusahaan: ["/perusahaan"],
  "buku-besar": ["/buku-besar", "/keuangan/coa", "/keuangan/jurnal", "/keuangan/jurnal-berulang", "/keuangan/buku-besar", "/keuangan/tutup-buku",
    "/keuangan/closing-hpp", "/keuangan/saldo-awal", "/keuangan/saldo-awal-faktur", "/keuangan/sinkron"],
  "kas-bank": ["/kas-bank", "/keuangan/hutang", "/keuangan/piutang", "/keuangan/rekonsiliasi"],
  penjualan: ["/penjualan"], pembelian: ["/pembelian"], pos: ["/pos"],
  "aset-tetap": ["/keuangan/aset", "/keuangan/kategori-aset", "/keuangan/kategori-aset-pajak"],
  pajak: ["/keuangan/ppn", "/pengaturan/pajak"],
  laporan: ["/laporan", "/keuangan/laba-rugi", "/keuangan/neraca", "/keuangan/neraca-saldo", "/keuangan/arus-kas"],
};
const ORIGINAL_ALWAYS = ["/me", "/mulai", "/login", "/auth", "/booking"];
const ORIGINAL_EXTRA: Record<string, string[]> = { STAFF: ["/kasir"], DOCTOR: ["/kasir"], FINANCE: ["/pos/shift"] };
const ORIGINAL_DEFAULT = (role: string): string[] | null =>
  role === "FINANCE" ? ["dashboard", "buku-besar", "kas-bank", "aset-tetap", "pajak", "laporan"] : role === "STAFF" ? ["klinik"] : null;
const prefixMatch = (path: string, prefix: string) => (prefix === "/" ? path === "/" : path === prefix || path.startsWith(prefix + "/"));
type Rows = { role: string; module_id: string }[];
function originalReach(role: string, path: string, rows: Rows): boolean {
  if (ORIGINAL_ALWAYS.some(p => prefixMatch(path, p))) return true;
  if ((ORIGINAL_EXTRA[role] ?? []).some(p => prefixMatch(path, p))) return true;
  const mine = rows.filter(r => r.role === role).map(r => r.module_id);
  const allowed = role === "OWNER" ? null : mine.length > 0 ? mine : ORIGINAL_DEFAULT(role);
  if (allowed === null) return true;
  return allowed.some(id => (ORIGINAL_MODULE_PATHS[id] ?? []).some(p => prefixMatch(path, p)));
}

// Mirrors role_settings_private.snapshot() (migration 20261106120000) `modules` for source defaults/legacy.
const CATALOGUE = [...MODULES.map(m => m.id), "kasir", "quest-staff", "pos-shift"];
function displayed(role: string, saved: string[]): string[] {
  let ids: string[];
  if (saved.length === 0) ids = role === "STAFF" ? ["klinik", "kasir", "quest-staff"]
    : role === "FINANCE" ? ["dashboard", "buku-besar", "kas-bank", "aset-tetap", "pajak", "laporan", "pos-shift"] : CATALOGUE;
  else ids = [...saved, ...(role === "STAFF" || role === "DOCTOR" ? ["kasir", "quest-staff"] : []),
    ...(saved.includes("pos") ? ["quest-staff", "pos-shift"] : []), ...(role === "FINANCE" ? ["pos-shift"] : [])];
  return CATALOGUE.filter(id => ids.includes(id));
}
const rows = (role: string, ids: string[]): Rows => ids.map(module_id => ({ role, module_id }));

// ── every protected route: derived from the src/app tree, nav.ts, akses prefix tables ──────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/^(page|route)\.(tsx|ts)$/.test(name)) out.push(full);
  }
  return out;
}
const appRoot = join(process.cwd(), "src/app");
const treeRoutes = walk(appRoot).map(f => {
  const segs = f.slice(appRoot.length).split("/").slice(1, -1)
    .filter(s => !/^\(.*\)$/.test(s)).map(s => (/^\[\.\.\./.test(s) ? "x/y" : /^\[/.test(s) ? "x" : s));
  return "/" + segs.join("/");
});
const PUBLIC = /^\/(api|login|auth|booking)(\/|$)/; // middleware never applies module rules to these
const MODULE_PREFIXES = Object.values(ORIGINAL_MODULE_PATHS).flat();
const routes = [...new Set([
  ...treeRoutes,
  ...Object.values(TILES).flatMap(t => t.flatMap(x => (x.href ? [x.href.split(/[?#]/)[0]] : []))),
  ...MODULES.map(m => (m.id === "dashboard" ? "/" : `/${m.id}`)),
  ...MODULE_PREFIXES, ...MODULE_PREFIXES.map(p => (p === "/" ? "/zzz" : `${p}/x`)),
  ...Object.values(ORIGINAL_EXTRA).flat().map(p => `${p}/x`),
  "/kasir/quest", "/pos/quest", "/pos/shift", "/pos/shift/riwayat", "/keuangan", "/pajak/faktur/unduh", "/dokumen/x",
])].filter(p => !PUBLIC.test(p)).sort();

// ── every role × shape ─────────────────────────────────────────────────────────────────────────────────────
const REAL = MODULES.map(m => m.id);
const subsets: string[][] = [[], ...REAL.map(m => [m]), REAL, ...REAL.flatMap((a, i) => REAL.slice(i + 1).map(b => [a, b])),
  ...REAL.flatMap((a, i) => REAL.slice(i + 1).flatMap((b, j) => REAL.slice(i + j + 2).map(c => [a, b, c])))];
const ROLES = ["OWNER", "ADMIN", "FINANCE", "STAFF", "DOCTOR"];
type Diff = { role: string; shape: string; path: string; direction: "widened" | "narrowed"; original: boolean; v2: boolean };
// The ONE shape the displayed list cannot tell apart from another: DOCTOR whose legacy rows are all 14 modules
// (e.g. "Mulai atur sendiri" seeded and untouched) displays all 17 ids, exactly like DOCTOR with NO rows (original
// full access). One saved v2 list cannot be both; the default (no rows) keeps full reach, so this legacy shape widens.
const collision = (role: string, saved: string[]) => role === "DOCTOR" && saved.length === REAL.length;
function matrix() {
  const diffs: Diff[] = [], legacyDrift: Diff[] = [], collisions: Diff[] = [];
  let shapes = 0, checks = 0;
  for (const role of ROLES) for (const saved of role === "OWNER" ? [[]] : subsets) {
    const shape = saved.length === 0 ? "default (no rows)" : `legacy [${saved.join(",")}]`;
    const legacyRows = rows(role, saved), v2Rows = rows(role, [ROLE_V2_MARKER, ...displayed(role, saved)]);
    shapes++;
    for (const path of routes) {
      checks++;
      const original = originalReach(role, path, legacyRows);
      const now = bolehBukaPath(role, path, legacyRows), v2 = bolehBukaPath(role, path, v2Rows);
      if (now !== original) legacyDrift.push({ role, shape, path, direction: now ? "widened" : "narrowed", original, v2: now });
      if (v2 !== original) (collision(role, saved) ? collisions : diffs).push({ role, shape, path, direction: v2 ? "widened" : "narrowed", original, v2 });
    }
  }
  return { diffs, legacyDrift, collisions, shapes, checks };
}
const result = matrix();
const summarize = (d: Diff[]) => {
  const by = new Map<string, Set<string>>();
  for (const x of d) { const k = `${x.role} ${x.direction} ${x.path}`; (by.get(k) ?? by.set(k, new Set()).get(k)!).add(x.shape); }
  return [...by.entries()].map(([k, s]) => `${k}  (${s.size} shapes)`).sort();
};
if (process.env.ROLE_REACH_REPORT) {
  writeFileSync(process.env.ROLE_REACH_REPORT, JSON.stringify({ routes, shapes: result.shapes, checks: result.checks,
    legacy_row_drift: summarize(result.legacyDrift), v2_vs_original: summarize(result.diffs),
    unavoidable_collision_doctor_all14_legacy: summarize(result.collisions),
    v2_vs_original_examples: result.diffs.slice(0, 40) }, null, 1));
}

it("enumerates a real, non-trivial route set across all roles and shapes", () => {
  expect(routes.length).toBeGreaterThan(150);
  for (const p of ["/pajak", "/pajak/faktur", "/aset-tetap", "/keuangan/laba-ditahan", "/dokumen/x", "/kasir", "/pos/quest", "/keuangan"]) expect(routes).toContain(p);
  expect(result.shapes).toBeGreaterThan(1000);
});
it("legacy rows (no marker) keep EXACTLY the original reach for every role/shape/route", () => {
  expect(summarize(result.legacyDrift)).toEqual([]);
});
it("saving the displayed default/legacy list (v2) gives exactly the original reach — no widening, no narrowing", () => {
  expect(summarize(result.diffs)).toEqual([]);
});
it("OWNER stays full and immutable", () => {
  for (const path of routes) {
    expect(bolehBukaPath("OWNER", path, [])).toBe(true);
    expect(bolehBukaPath("OWNER", path, rows("OWNER", [ROLE_V2_MARKER]))).toBe(true);
  }
});
it("the only unavoidable difference is pinned exactly: DOCTOR legacy all-14 rows widen to the pages no module owns", () => {
  expect(summarize(result.collisions)).toEqual([
    "DOCTOR widened /aset-tetap  (1 shapes)", "DOCTOR widened /dokumen/x  (1 shapes)", "DOCTOR widened /keuangan  (1 shapes)",
    "DOCTOR widened /keuangan/laba-ditahan  (1 shapes)", "DOCTOR widened /keuangan/persediaan-awal  (1 shapes)",
    "DOCTOR widened /pajak  (1 shapes)", "DOCTOR widened /pajak/faktur  (1 shapes)", "DOCTOR widened /pajak/faktur/unduh  (1 shapes)",
    "DOCTOR widened /zzz  (1 shapes)",
  ]);
});
it("a restricted role never gets the pages no module owns, whatever it ticks (FINANCE/STAFF, partial or all 17)", () => {
  const ids = [...CATALOGUE];
  for (const role of ["FINANCE", "STAFF", "ADMIN", "DOCTOR"]) for (const selection of [["pajak"], ["aset-tetap"], ["laporan"], ["pajak", "aset-tetap", "laporan", "buku-besar"], role === "ADMIN" || role === "DOCTOR" ? ids.filter(i => i !== "kasir") : ids]) {
    for (const path of ["/pajak", "/pajak/faktur", "/pajak/faktur/unduh", "/aset-tetap", "/keuangan/laba-ditahan", "/keuangan", "/dokumen/x"])
      expect(bolehBukaPath(role, path, rows(role, [ROLE_V2_MARKER, ...selection])), `${role} ${selection.length} ${path}`).toBe(false);
  }
  // legacy parity of the pages the module tables DO own
  expect(bolehBukaPath("FINANCE", "/keuangan/ppn", rows("FINANCE", [ROLE_V2_MARKER, "pajak"]))).toBe(true);
  expect(bolehBukaPath("STAFF", "/pengaturan/pajak", rows("STAFF", [ROLE_V2_MARKER, "pengaturan"]))).toBe(true);
  expect(bolehBukaPath("ADMIN", "/pajak/faktur", rows("ADMIN", [ROLE_V2_MARKER, ...ids]))).toBe(true);
});
