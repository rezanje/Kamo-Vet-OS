import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findRouteFiles, ROUTE_FILE } from "./submenu-route-scan";

describe("route scanner used by the tile/route sync tests", () => {
  it("matches page/route files with every Next extension and nothing else", () => {
    for (const n of ["page.tsx", "page.ts", "page.jsx", "page.js", "route.ts", "route.tsx", "route.js", "route.jsx"]) expect(ROUTE_FILE.test(n), n).toBe(true);
    for (const n of ["layout.tsx", "page.test.tsx", "mypage.tsx", "page.tsx.bak", "page.css", "route.d.ts", "pages.tsx", "loading.tsx"]) expect(ROUTE_FILE.test(n), n).toBe(false);
  });
  it("finds variants in nested folders, skips __tests__", () => {
    const root = mkdtempSync(join(tmpdir(), "route-scan-"));
    try {
      for (const f of ["a/page.tsx", "b/page.jsx", "c/d/page.ts", "e/route.tsx", "f/route.js", "g/route.ts", "__tests__/page.tsx", "h/layout.tsx"]) {
        mkdirSync(join(root, f, ".."), { recursive: true });
        writeFileSync(join(root, f), "");
      }
      expect(findRouteFiles(root).map(f => f.slice(root.length + 1)).sort())
        .toEqual(["a/page.tsx", "b/page.jsx", "c/d/page.ts", "e/route.tsx", "f/route.js", "g/route.ts"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("the sync tests use this scanner, not a hard-coded page.tsx/route.ts pair", () => {
    for (const f of readdirSync(__dirname).filter(n => /^submenu-.*\.test\.ts$/.test(n) && n !== "submenu-route-scan.test.ts")) {
      expect(readFileSync(join(__dirname, f), "utf8"), f).not.toMatch(/"page\.tsx"\s*\|\||===\s*"route\.ts"/);
    }
  });
});
