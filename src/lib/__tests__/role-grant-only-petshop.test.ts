import { readdirSync, readFileSync } from "node:fs";
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
    const dir = join(process.cwd(), "supabase/migrations");
    const read = (suffix: string) => readFileSync(join(dir, readdirSync(dir).filter((f) => f.endsWith(suffix)).sort()[0]), "utf8");
    const sql = read("_batalkan_penerimaan_petshop.sql") + "\n" + read("_backdate_petshop.sql");
    for (const id of GRANT_ONLY_ACTIONS.filter((x) => x.startsWith("penjualan."))) expect(sql).toContain(`'${id}'`);
    expect(sql).toMatch(/'penjualan\.pos_penerimaan\.batalkan','Batalkan penerimaan[^']*','Penjualan',true\)/);
    expect(sql).toContain("action_modules(id,module_id) values('penjualan.pos_penerimaan.batalkan','penjualan')");
  });
  it("izin khusus Tanggal mundur: terdaftar, katalog migrasi (enforced, modul penjualan), peran legacy tidak tercentang", () => {
    const TM = "penjualan.pos_penerimaan.tanggal_mundur";
    expect(isGrantOnlyAction(TM)).toBe(true);
    const dir = join(process.cwd(), "supabase/migrations");
    const sql = readFileSync(join(dir, readdirSync(dir).filter((f) => f.endsWith("_backdate_petshop.sql")).sort()[0]), "utf8");
    expect(sql).toMatch(/'penjualan\.pos_penerimaan\.tanggal_mundur','Tanggal efektif mundur[^']*','Penjualan',true\)/);
    expect(sql).toContain("action_modules(id,module_id) values('penjualan.pos_penerimaan.tanggal_mundur','penjualan')");
    const cfg = parseRoleAccessConfig({ ...snapshot("legacy", []), action_catalog: [row(ID), row(TM), row("bank.cash_accounts.create")] }, "ADMIN")!;
    expect(effectiveAllowedActions(cfg)).toEqual(["bank.cash_accounts.create"]);
    const granted = parseRoleAccessConfig({ ...snapshot("custom", [ID, TM]), action_catalog: [row(ID), row(TM)] }, "ADMIN")!;
    expect(effectiveAllowedActions(granted)).toEqual([ID, TM]);
  });
});
