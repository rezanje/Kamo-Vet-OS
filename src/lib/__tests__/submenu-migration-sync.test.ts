import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUBMENU_ENTRIES } from "../submenu-access";

const path = join(__dirname, "../../../supabase/migrations/20261108110000_role_submenu_access.sql");
const sql = readFileSync(path, "utf8");

describe("migration 20261108110000_role_submenu_access.sql stays in sync with the TypeScript registry", () => {
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

  // Renumber rule (docs/ROLE-SUBMENU-ACCESS.md, "Nomor migrasi"): a LARGER migration landing later must not turn this red -
  // only uniqueness of our version, version == file name and ordering after role_settings_atomic are required.
  // If main already has a number above ours when merging, renumber this file (name + this test + docs).
  it("is numbered above the migrations it extends, unique, and its version equals its file name", async () => {
    const { readdirSync } = await import("node:fs");
    const NAME = "20261108110000_role_submenu_access.sql";
    const names = readdirSync(join(__dirname, "../../../supabase/migrations")).filter(n => n.endsWith(".sql")).sort();
    // Only OUR version must be unique: main already carries two older duplicate-version pairs (20261029140000,
    // 20261029150000) that are not ours to fix here. A second file with our version breaks `supabase db push`.
    const versions = names.map(n => /^(\d{14})_/.exec(n)?.[1]).filter(Boolean);
    expect(names).toContain(NAME);
    expect(versions.filter(v => v === NAME.slice(0, 14))).toHaveLength(1);
    expect(NAME).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(names.filter(n => n.includes("role_submenu_access"))).toEqual([NAME]);
    expect(path.endsWith(NAME)).toBe(true);
    expect(Number(NAME.slice(0, 14))).toBeGreaterThan(20261108090000);
    expect(names.indexOf(NAME)).toBeGreaterThan(names.findIndex(n => n.includes("role_settings_atomic")));
  });

  it("anchored and additive: every function patch goes through patch_once and nothing drops data", () => {
    expect((sql.match(/patch_once\(v,/g) ?? []).length).toBe(9);
    expect(sql).not.toMatch(/\bdrop table\b|\btruncate table\b|\bdelete from public\./i);
  });
});
