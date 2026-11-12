import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRANT_ONLY_ACTIONS, isGrantOnlyAction } from "../role-grant-only-actions";
import { effectiveAllowedActions, type RoleAccessConfig } from "../role-access-catalog";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261115900000_ubah_metode_bayar.sql"), "utf8");

describe("izin khusus Ubah metode bayar", () => {
  it("daftar TS sama persis dengan baris katalog yang dipasang migrasi", () => {
    const inMigration = [...migration.matchAll(/\('(klinik\.ubah_metode_bayar)', '[^']+', 'Klinik', true\)/g)].map(m => m[1]);
    expect([...new Set(inMigration)].sort()).toEqual(GRANT_ONLY_ACTIONS.filter(id => id.endsWith(".ubah_metode_bayar")).sort());
    expect(inMigration).toHaveLength(1);
  });
  it("bawaan MATI untuk peran legacy; kebijakan eksplisit dihormati", () => {
    const cat = [...GRANT_ONLY_ACTIONS, "klinik.pembayaran"].map(id => ({ id, label: id, group: "Klinik", enforced: true }));
    const legacy = { actions: { source: "legacy", allowed: [] }, action_catalog: cat } as unknown as RoleAccessConfig;
    expect(effectiveAllowedActions(legacy)).toEqual(["klinik.pembayaran"]);
    const explicit = { actions: { source: "custom", allowed: ["klinik.ubah_metode_bayar"] }, action_catalog: cat } as unknown as RoleAccessConfig;
    expect(effectiveAllowedActions(explicit)).toEqual(["klinik.ubah_metode_bayar"]);
    expect(isGrantOnlyAction("klinik.ubah_metode_bayar")).toBe(true);
    expect(isGrantOnlyAction("penjualan.ubah_metode_bayar")).toBe(false); // petshop: PR #412/#510 (sesi lain)
  });
  it("migrasi tidak membuat akun, rekening, atau peta baru", () => {
    expect(migration).not.toMatch(/insert\s+into\s+public\.(coa_accounts|cash_accounts|payment_account_map)/i);
  });
});
