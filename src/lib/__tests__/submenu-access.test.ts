import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES, TILES } from "../nav";
import { findRouteFiles } from "./submenu-route-scan";
import { MODULE_PATHS, OPERATIONAL_PATHS, SELALU_BOLEH } from "../akses";
import {
  SUBMENU_ENTRIES, SUBMENU_HOME, moduleHasAllowedSubmenu, resolveSubmenu, selectableSubmenus, submenuIzinkan,
  submenuLabel, submenuOfPath, submenuSummary, submenuTileLabels,
} from "../submenu-access";

const prefix = (path: string, p: string) => (p === "/" ? path === "/" : path === p || path.startsWith(p + "/"));
const owners = (path: string) => Object.entries(MODULE_PATHS).filter(([id, ps]) => !(id in OPERATIONAL_PATHS) && ps.some(p => prefix(path, p))).map(([id]) => id);
const pathname = (href: string) => href.split(/[?#]/)[0];

// Tile pages that no module prefix owns today: only full-reach roles open them. The sub-menu layer must not
// invent ownership for them (that would change who can open them), so they are classified, not mapped.
const UNOWNED_TILE_PAGES = ["/pajak/faktur", "/keuangan/laba-ditahan"];
// Tile laporan yang SENGAJA belum punya sub-menu Akses Grup: menambah sub-menu butuh baris baru di
// katalog database (role_settings_private.submenu_catalog) yang belum disetujui pemilik. Peran tanpa
// kebijakan sub-menu laporan tetap bisa membuka; peran dengan kebijakan laporan terbatas TERTUTUP
// (gagal tertutup). Hapus dari daftar ini begitu sub-menunya didaftarkan.
const TILE_LAPORAN_TANPA_SUBMENU = ["/laporan/visit"]; // A4, meeting 12 Nov 2026

describe("sub-menu registry shape", () => {
  it("has unique ids, unique routes and stable module.slug ids", () => {
    const ids = SUBMENU_ENTRIES.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const routes = SUBMENU_ENTRIES.flatMap(e => e.routes);
    expect(new Set(routes).size).toBe(routes.length);
    for (const e of SUBMENU_ENTRIES) {
      expect(e.id).toMatch(/^[a-z][a-z-]*\.[a-z][a-z0-9-]*$/);
      expect(e.id.split(".")[0]).toBe(e.module);
      expect(Object.keys(TILES)).toContain(e.module);
      expect(e.routes.length).toBeGreaterThan(0);
      for (const r of e.routes) expect(r).toMatch(/^\/[a-z0-9/-]+$/);
    }
  });

  it("every route of an entry is owned by that entry's module (the module grant is what opens it)", () => {
    for (const e of SUBMENU_ENTRIES) for (const r of e.routes) {
      expect(owners(r), `${e.id} ${r}`).toContain(e.module);
    }
  });

  it("never maps operational groups (kasir, quest, shift) or always-open pages", () => {
    for (const e of SUBMENU_ENTRIES) for (const r of e.routes) {
      expect(Object.values(OPERATIONAL_PATHS).flat().some(p => prefix(r, p)), r).toBe(false);
      expect(SELALU_BOLEH.some(p => prefix(r, p)), r).toBe(false);
    }
  });

  it("gives every entry a plain label (tile label or explicit)", () => {
    for (const e of SUBMENU_ENTRIES) {
      expect(submenuLabel(e.id).trim().length, e.id).toBeGreaterThan(2);
      if (!e.label) expect(submenuTileLabels(e.id).length, `${e.id} has neither tile nor label`).toBeGreaterThan(0);
    }
  });
});

describe("every nav tile href resolves to exactly one sub-menu (or is explicitly classified)", () => {
  for (const [moduleId, tiles] of Object.entries(TILES)) for (const tile of tiles) {
    if (!tile.href) continue;
    it(`${moduleId} › ${tile.label} (${tile.href})`, () => {
      const path = pathname(tile.href!);
      if (SELALU_BOLEH.some(p => prefix(path, p))) return;
      if (Object.values(OPERATIONAL_PATHS).flat().some(p => prefix(path, p))) return;
      if (UNOWNED_TILE_PAGES.includes(path)) { expect(owners(path)).toEqual([]); expect(submenuOfPath(path)).toBeNull(); return; }
      if (TILE_LAPORAN_TANPA_SUBMENU.includes(path)) { expect(submenuOfPath(path)).toBeNull(); expect(resolveSubmenu("laporan", path).kind).toBe("unmapped"); return; }
      const hits = SUBMENU_ENTRIES.filter(e => e.routes.some(r => prefix(path, r)));
      expect(hits.length, `no sub-menu for ${path}`).toBeGreaterThan(0);
      const entry = submenuOfPath(path);
      expect(entry).not.toBeNull();
      // exactly one entry owns the LONGEST matching route (no tie between two entries)
      const longest = Math.max(...hits.flatMap(e => e.routes.filter(r => prefix(path, r)).map(r => r.length)));
      expect(hits.filter(e => e.routes.some(r => prefix(path, r) && r.length === longest))).toHaveLength(1);
      // the tile is listed on its entry
      expect(submenuTileLabels(entry!.id)).toContain(tile.label);
    });
  }

  it("the two unowned tile pages stay unowned by every module (no accidental new reach)", () => {
    for (const p of UNOWNED_TILE_PAGES) expect(owners(p)).toEqual([]);
  });
});

describe("every real page route resolves under each module that owns it", () => {
  const root = join(__dirname, "../../app/(app)");
  const found = findRouteFiles(root);
  const routes = found.map(f => "/" + f.slice(root.length + 1).split(sep).slice(0, -1).filter(s => !/^\(.*\)$/.test(s)).join("/")).map(r => r.replace(/\[[^\]]+\]/g, "x"));

  // Pages in a module prefix that deliberately get NO sub-menu: a restricted role cannot open them.
  const DENIED_WHEN_RESTRICTED: string[] = [
    "pengaturan /pengaturan/pajak", // opened by module `pajak`; restricted `pengaturan` must not open it
    "laporan /laporan/visit", // A4: belum ada sub-menu (lihat TILE_LAPORAN_TANPA_SUBMENU)
    "laporan /laporan/visit/unduh",
  ];

  it("found a realistic number of routes", () => { expect(routes.length).toBeGreaterThan(200); });

  it("each route owned by a module is a sub-menu page, a module home, or listed as denied-when-restricted", () => {
    const unresolved: string[] = [];
    for (const route of new Set(routes)) {
      if (route === "/") continue;
      if (Object.values(OPERATIONAL_PATHS).flat().some(p => prefix(route, p))) continue; // governed by Operasional groups
      for (const m of owners(route)) {
        const r = resolveSubmenu(m, route);
        if (r.kind === "unmapped" && !DENIED_WHEN_RESTRICTED.includes(`${m} ${route}`)) unresolved.push(`${m} ${route}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("module homes belong to a module that owns the path", () => {
    for (const [m, home] of Object.entries(SUBMENU_HOME)) { expect(owners(home)).toContain(m); }
  });
});

describe("resolveSubmenu / submenuIzinkan", () => {
  const all = (m: string) => selectableSubmenus(m).map(e => e.id);

  it("no policy (undefined) allows every path of the module: zero regression", () => {
    for (const p of ["/klinik", "/klinik/pembayaran/abc", "/klinik/anything/unmapped", "/klinik/"]) expect(submenuIzinkan("klinik", p, undefined)).toBe(true);
  });

  it("allows only the chosen sub-menu and its nested detail pages", () => {
    const allowed = ["klinik.antrian"];
    expect(submenuIzinkan("klinik", "/klinik/antrian", allowed)).toBe(true);
    expect(submenuIzinkan("klinik", "/klinik/antrian/123", allowed)).toBe(true);
    expect(submenuIzinkan("klinik", "/klinik/antrian/", allowed)).toBe(true);
    expect(submenuIzinkan("klinik", "/klinik/antrian?x=1", allowed)).toBe(true);
    expect(submenuIzinkan("klinik", "/klinik/pembayaran/abc/struk", allowed)).toBe(false);
    expect(submenuIzinkan("klinik", "/klinik/rekam-medis", allowed)).toBe(false);
  });

  it("longest route wins: Impor rekam medis is separate from Rekam medis", () => {
    expect(submenuIzinkan("klinik", "/klinik/rekam-medis/impor", ["klinik.rekam-medis"])).toBe(false);
    expect(submenuIzinkan("klinik", "/klinik/rekam-medis/123", ["klinik.rekam-medis"])).toBe(true);
    expect(submenuIzinkan("klinik", "/klinik/rekam-medis/impor", ["klinik.impor-rekam-medis"])).toBe(true);
    expect(submenuIzinkan("klinik", "/klinik/rekam-medis", ["klinik.impor-rekam-medis"])).toBe(false);
  });

  it("segment boundaries: a sibling that merely starts with the prefix is NOT inherited", () => {
    expect(submenuIzinkan("klinik", "/klinik/antrianbaru", ["klinik.antrian"])).toBe(false);
    expect(submenuIzinkan("klinik", "/klinik/antrian-x/1", ["klinik.antrian"])).toBe(false);
  });

  it("unmapped paths fail closed under a restricted module", () => {
    expect(submenuIzinkan("klinik", "/klinik/baru-tanpa-menu", all("klinik"))).toBe(false);
    expect(submenuIzinkan("klinik", "/klinik/%61ntrian", ["klinik.antrian"])).toBe(false); // encoded alias never inherits
    expect(submenuIzinkan("klinik", "/klinik/antrian%2F..%2Fpembayaran", ["klinik.antrian"])).toBe(false);
  });

  it("is case sensitive: an upper-case path never inherits a lower-case sub-menu", () => {
    expect(submenuIzinkan("klinik", "/klinik/Antrian", ["klinik.antrian"])).toBe(false);
    expect(submenuIzinkan("klinik", "/KLINIK/antrian", ["klinik.antrian"])).toBe(false);
  });

  it("module home is open only while at least one known sub-menu is allowed", () => {
    expect(submenuIzinkan("klinik", "/klinik", ["klinik.antrian"])).toBe(true);
    expect(submenuIzinkan("klinik", "/klinik/", ["klinik.antrian"])).toBe(true);
    expect(submenuIzinkan("klinik", "/klinik", [])).toBe(false);
    expect(submenuIzinkan("klinik", "/klinik", ["klinik.tidak-ada"])).toBe(false);
    expect(moduleHasAllowedSubmenu("klinik", [])).toBe(false);
    expect(moduleHasAllowedSubmenu("klinik", ["klinik.tidak-ada"])).toBe(false);
    expect(moduleHasAllowedSubmenu("klinik", ["klinik.antrian"])).toBe(true);
    expect(moduleHasAllowedSubmenu("klinik", undefined)).toBe(true);
  });

  it("an empty list denies everything in the module (module not accessible)", () => {
    for (const p of ["/klinik", "/klinik/antrian", "/klinik/pembayaran/x"]) expect(submenuIzinkan("klinik", p, [])).toBe(false);
  });

  it("a sub-menu id of another module never grants this module's page", () => {
    expect(submenuIzinkan("klinik", "/klinik/antrian", ["pos.stok"])).toBe(false);
    expect(submenuIzinkan("pos", "/pos/stok", ["klinik.antrian"])).toBe(false);
  });

  it("owned elsewhere: a page whose entry belongs to another module is unmapped for this module", () => {
    // /pengaturan/pajak is opened by module `pajak`; a restricted `pengaturan` must not open it.
    expect(submenuIzinkan("pengaturan", "/pengaturan/pajak", all("pengaturan"))).toBe(false);
    expect(submenuIzinkan("pajak", "/pengaturan/pajak", all("pajak"))).toBe(true);
    expect(submenuIzinkan("pajak", "/pengaturan/pajak", ["pajak.rekap-ppn"])).toBe(false);
  });

  it("every selectable sub-menu opens its own routes when selected alone and nothing of the others", () => {
    for (const m of Object.keys(TILES)) {
      const entries = selectableSubmenus(m);
      for (const e of entries) for (const route of e.routes) {
        expect(submenuIzinkan(m, route, [e.id]), `${e.id} ${route}`).toBe(true);
        for (const other of entries.filter(o => o.id !== e.id)) {
          const longerOther = other.routes.some(r => prefix(route, r) && r.length > Math.max(...e.routes.filter(x => prefix(route, x)).map(x => x.length)));
          if (!longerOther) expect(submenuIzinkan(m, route, [other.id]), `${other.id} must not open ${route}`).toBe(false);
        }
      }
    }
  });

  it("summary counts known allowed sub-menus of the module", () => {
    const total = selectableSubmenus("klinik").length;
    expect(submenuSummary("klinik", undefined)).toEqual({ allowed: total, total, restricted: false });
    expect(submenuSummary("klinik", ["klinik.antrian", "klinik.registrasi", "klinik.tidak-ada", "pos.stok"])).toEqual({ allowed: 2, total, restricted: true });
    expect(submenuSummary("klinik", [])).toEqual({ allowed: 0, total, restricted: true });
  });

  it("every module that has tiles has at least one selectable sub-menu, except no-href modules", () => {
    for (const m of MODULES.map(x => x.id)) {
      if (!(m in TILES)) continue;
      const hasHref = TILES[m].some(t => t.href);
      if (hasHref) expect(selectableSubmenus(m).length, m).toBeGreaterThan(0);
    }
  });
});
