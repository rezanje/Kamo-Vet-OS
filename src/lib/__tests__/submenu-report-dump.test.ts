// Evidence generator (not an assertion suite): SUBMENU_REPORT_OUT=<file> npx vitest run this file.
// Writes the module -> sub-menu tree with ADMIN's default (everything allowed) and what ADMIN reaches today.
import { writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES, TILES } from "../nav";
import { findRouteFiles } from "./submenu-route-scan";
import { bolehBukaPath, modulDiizinkan, MODULE_PATHS, OPERATIONAL_PATHS, SELALU_BOLEH } from "../akses";
import { SUBMENU_ENTRIES, SUBMENU_HOME, submenuOfPath, resolveSubmenu, selectableSubmenus, submenuLabel, submenuTileLabels } from "../submenu-access";

const out = process.env.SUBMENU_REPORT_OUT;
const prefix = (path: string, p: string) => (p === "/" ? path === "/" : path === p || path.startsWith(p + "/"));

describe.skipIf(!out)("report dump", () => {
  it("writes the tree", () => {
    const root = join(__dirname, "../../app/(app)");
    const found = findRouteFiles(root);
    const routes = [...new Set(found.map(f => "/" + f.slice(root.length + 1).split(sep).slice(0, -1).filter(s => !/^\(.*\)$/.test(s)).join("/")).map(r => r.replace(/\[[^\]]+\]/g, "x")))].sort();

    const tree = MODULES.filter(m => m.id in TILES).map(m => ({
      module: m.id, label: m.label,
      adminDefault: "semua sub-menu diizinkan",
      submenus: selectableSubmenus(m.id).map(e => ({
        id: e.id, label: submenuLabel(e.id), routes: e.routes,
        tilesThatOpenIt: submenuTileLabels(e.id),
        hasOwnTile: submenuTileLabels(e.id).length > 0,
      })),
      home: SUBMENU_HOME[m.id] ?? null,
    }));

    const adminToday = MODULES.map(m => {
      const paths = MODULE_PATHS[m.id] ?? [];
      const pages = routes.filter(r => paths.some(p => prefix(r, p)) && !Object.values(OPERATIONAL_PATHS).flat().some(p => prefix(r, p)));
      return {
        module: m.id, label: m.label,
        grantedToday: modulDiizinkan("ADMIN", []) === null ? "ya (ADMIN tanpa aturan tersimpan = semua modul)" : "tidak",
        prefixes: paths, pageCount: pages.length,
        pagesNotCoveredBySubmenu: pages.filter(r => { const x = resolveSubmenu(m.id, r); return x.kind === "unmapped"; }),
      };
    });
    const unowned = routes.filter(r => r !== "/" && !Object.entries(MODULE_PATHS).some(([id, ps]) => !(id in OPERATIONAL_PATHS) && ps.some(p => prefix(r, p)))
      && !SELALU_BOLEH.some(p => prefix(r, p)) && !Object.values(OPERATIONAL_PATHS).flat().some(p => prefix(r, p)));
    const operational = Object.entries(OPERATIONAL_PATHS).map(([id, ps]) => ({ id, paths: ps }));
    const sample = ["/klinik/rekam-medis", "/dokumen/x", "/pajak/faktur", "/pos/shift", "/kasir", "/keuangan"].map(p => ({ path: p, adminToday: bolehBukaPath("ADMIN", p, []) }));
    const tileMap = Object.entries(TILES).flatMap(([module, tiles]) => tiles.map(t => {
      if (!t.href) return { module, label: t.label, href: null, maps_to: "tanpa halaman (dalam pengembangan/Fase 2): hilang bila modul dibatasi" };
      const path = t.href.split(/[?#]/)[0];
      const kind = SELALU_BOLEH.some(p => prefix(path, p)) ? "selalu boleh (/me)"
        : Object.entries(OPERATIONAL_PATHS).find(([, ps]) => ps.some(p => prefix(path, p))) ? "grup Operasional " + Object.entries(OPERATIONAL_PATHS).find(([, ps]) => ps.some(p => prefix(path, p)))![0]
        : submenuOfPath(path)?.id ?? "TANPA PEMILIK MODUL (tetap seperti sekarang)";
      return { module, label: t.label, href: t.href, maps_to: kind };
    }));
    writeFileSync(out!, JSON.stringify({ tileMap, totalSubmenus: SUBMENU_ENTRIES.length, tree, adminToday, adminUnownedPagesReachableToday: unowned, operationalGroups: operational, adminSamples: sample, routeCount: routes.length }, null, 1));
    expect(tree.length).toBeGreaterThan(5);
  });
});
