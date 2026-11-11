import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRANT_ONLY_ACTIONS, isGrantOnlyAction } from "../role-grant-only-actions";
import { effectiveAllowedActions, parseRoleAccessConfig } from "../role-access-catalog";

const ID = "penjualan.pos_penerimaan.batalkan";
const row = (id: string) => ({ id, label: "x", group: "Penjualan", enforced: true });
const snapshot = (source: "legacy" | "custom", allowed: string[]) => ({
  actions: { source, allowed }, action_catalog: [row(ID), row("bank.cash_accounts.create")], role: "ADMIN", revision: "a".repeat(32), source: source === "legacy" ? "legacy" : "custom",
  modules: [], capabilities: { all_branches: false, create_accounts: false }, audit: [],
});

describe("Batalkan penerimaan petshop: izin khusus (bawaan mati)", () => {
  it("terdaftar sebagai izin khusus", () => { expect(GRANT_ONLY_ACTIONS).toContain(ID); expect(isGrantOnlyAction(ID)).toBe(true); expect(isGrantOnlyAction("bank.cash_accounts.create")).toBe(false); });
  it("peran bawaan lama tidak ditampilkan tercentang; tindakan biasa tetap tercentang", () => {
    const cfg = parseRoleAccessConfig(snapshot("legacy", []), "ADMIN")!;
    expect(effectiveAllowedActions(cfg)).toEqual(["bank.cash_accounts.create"]);
  });
  it("izin tertulis eksplisit dihormati apa adanya", () => {
    const cfg = parseRoleAccessConfig(snapshot("custom", [ID]), "ADMIN")!;
    expect(effectiveAllowedActions(cfg)).toEqual([ID]);
  });
  it("sinkron dengan baris katalog yang dipasang migrasi: id, enforced=true, modul penjualan", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261112300000_batalkan_penerimaan_petshop.sql"), "utf8");
    for (const id of GRANT_ONLY_ACTIONS.filter((x) => x.startsWith("penjualan."))) expect(sql).toContain(`'${id}'`);
    expect(sql).toMatch(/'penjualan\.pos_penerimaan\.batalkan','Batalkan penerimaan[^']*','Penjualan',true\)/);
    expect(sql).toContain("action_modules(id,module_id) values('penjualan.pos_penerimaan.batalkan','penjualan')");
  });
});
