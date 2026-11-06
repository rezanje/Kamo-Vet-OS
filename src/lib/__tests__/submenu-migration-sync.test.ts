import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUBMENU_ENTRIES } from "../submenu-access";

const path = join(__dirname, "../../../supabase/migrations/20261107890000_role_submenu_access.sql");
const sql = readFileSync(path, "utf8");

describe("migration 20261107890000_role_submenu_access.sql stays in sync with the TypeScript registry", () => {
  const rows = [...sql.matchAll(/^\('([a-z0-9.-]+)','([a-z-]+)'\)[,;]?$/gm)].map(m => ({ id: m[1], module: m[2] }));

  it("catalog rows == registry entries (same ids, same modules, no duplicates)", () => {
    expect(rows.length).toBe(SUBMENU_ENTRIES.length);
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
    expect(rows.map(r => `${r.id}|${r.module}`).sort()).toEqual(SUBMENU_ENTRIES.map(e => `${e.id}|${e.module}`).sort());
  });

  it("is a single-transaction file: header, lock_timeout, no own begin/commit", () => {
    expect(sql.split("\n").slice(0, 6).join("\n").toLowerCase()).toContain("apply as one transaction");
    expect(sql).toContain("set local lock_timeout='5s';");
    expect(sql.replace(/--.*$/gm, "")).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("is numbered above every other migration", async () => {
    const { readdirSync } = await import("node:fs");
    const names = readdirSync(join(__dirname, "../../../supabase/migrations")).filter(n => n.endsWith(".sql")).sort();
    expect(names.at(-1)).toBe("20261107890000_role_submenu_access.sql");
    expect(Number(names.at(-1)!.slice(0, 14))).toBeGreaterThan(20261106890000);
  });

  it("anchored and additive: every function patch goes through patch_once and nothing drops data", () => {
    expect((sql.match(/patch_once\(v,/g) ?? []).length).toBe(9);
    expect(sql).not.toMatch(/\bdrop table\b|\btruncate table\b|\bdelete from public\./i);
  });
});
