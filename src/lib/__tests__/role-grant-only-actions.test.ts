import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRANT_ONLY_ACTIONS, isGrantOnlyAction } from "../role-grant-only-actions";
import { effectiveAllowedActions, type RoleAccessConfig } from "../role-access-catalog";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261112500000_batal_pembelian_owner_penuh.sql"), "utf8");

describe("izin khusus batal pembelian", () => {
  it("daftar TS sama persis dengan baris katalog yang dipasang migrasi", () => {
    const inMigration = [...migration.matchAll(/'(pembelian\.batalkan_[a-z_]+)'/g)].map(m => m[1]);
    expect([...new Set(inMigration)].sort()).toEqual([...GRANT_ONLY_ACTIONS].sort());
  });
  it("peran legacy tidak ditampilkan boleh batal; kebijakan eksplisit dihormati apa adanya", () => {
    const cat = [...GRANT_ONLY_ACTIONS, "pembelian.terima"].map(id => ({ id, label: id, group: "Pembelian", enforced: true }));
    const legacy = { actions: { source: "legacy", allowed: [] }, action_catalog: cat } as unknown as RoleAccessConfig;
    expect(effectiveAllowedActions(legacy)).toEqual(["pembelian.terima"]);
    const explicit = { actions: { source: "custom", allowed: ["pembelian.batalkan_faktur"] }, action_catalog: cat } as unknown as RoleAccessConfig;
    expect(effectiveAllowedActions(explicit)).toEqual(["pembelian.batalkan_faktur"]);
    expect(isGrantOnlyAction("pembelian.terima")).toBe(false);
  });
});
