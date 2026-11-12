import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clinicManualDiscountRaised, kasirManualDiscountUsed, MANUAL_DISCOUNT_ACTION, manualDiscountAllowed } from "../manual-discount";
import { GRANT_ONLY_LEGACY_ROLES, isGrantOnlyAction, legacyRoleHasAction } from "../role-grant-only-actions";
import { effectiveAllowedActions, parseRoleAccessConfig } from "../role-access-catalog";

const tanpaBawaan = new Map<string, number>();

describe("Kasir petshop: diskon manual tanpa izin", () => {
  it("keranjang tanpa diskon lolos", () => {
    expect(kasirManualDiscountUsed(0, [{ item_id: "a" }, { item_id: "b", item_discount_value: 0 }], tanpaBawaan)).toBe(false);
  });
  it("diskon total ditolak", () => {
    expect(kasirManualDiscountUsed(5000, [{ item_id: "a" }], tanpaBawaan)).toBe(true);
  });
  it("potongan per barang yang diketik ditolak (nominal maupun persen)", () => {
    expect(kasirManualDiscountUsed(0, [{ item_id: "a", item_discount_type: "nominal", item_discount_value: 1000 }], tanpaBawaan)).toBe(true);
    expect(kasirManualDiscountUsed(0, [{ item_id: "a", item_discount_type: "percent", item_discount_value: 10 }], tanpaBawaan)).toBe(true);
  });
  it("diskon bawaan barang dari master tetap boleh, persis nilainya", () => {
    const bawaan = new Map([["a", 10]]);
    expect(kasirManualDiscountUsed(0, [{ item_id: "a", item_discount_type: "percent", item_discount_value: 10 }], bawaan)).toBe(false);
    expect(kasirManualDiscountUsed(0, [{ item_id: "a", item_discount_type: "percent", item_discount_value: 15 }], bawaan)).toBe(true);
    expect(kasirManualDiscountUsed(0, [{ item_id: "a", item_discount_type: "nominal", item_discount_value: 10 }], bawaan)).toBe(true);
    expect(kasirManualDiscountUsed(0, [{ item_id: "b", item_discount_type: "percent", item_discount_value: 10 }], bawaan)).toBe(true);
  });
});

describe("Tagihan klinik: diskon manual tanpa izin", () => {
  it("tagihan baru tanpa diskon lolos; dengan diskon ditolak", () => {
    expect(clinicManualDiscountRaised(0, [{ diskon_persen: 0 }], null)).toBe(false);
    expect(clinicManualDiscountRaised(1000, [{ diskon_persen: 0 }], null)).toBe(true);
    expect(clinicManualDiscountRaised(0, [{ diskon_persen: 5 }], null)).toBe(true);
  });
  it("koreksi boleh mempertahankan atau mengurangi diskon tersimpan, tidak boleh menambah", () => {
    const existing = { discount: 20000, storedLine: new Map([["L1", 10]]) };
    expect(clinicManualDiscountRaised(20000, [{ diskon_persen: 10, source_invoice_item_id: "L1" }], existing)).toBe(false);
    expect(clinicManualDiscountRaised(5000, [{ diskon_persen: 5, source_invoice_item_id: "L1" }], existing)).toBe(false);
    expect(clinicManualDiscountRaised(20001, [{ diskon_persen: 10, source_invoice_item_id: "L1" }], existing)).toBe(true);
    expect(clinicManualDiscountRaised(0, [{ diskon_persen: 11, source_invoice_item_id: "L1" }], existing)).toBe(true);
    expect(clinicManualDiscountRaised(0, [{ diskon_persen: 5 }], existing)).toBe(true);
  });
});

describe("Pemeriksa izin: fail-closed", () => {
  const client = (result: { data: unknown; error: unknown } | Error) => ({
    rpc: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
  });
  it("hanya true tanpa galat yang boleh", async () => {
    expect(await manualDiscountAllowed(client({ data: true, error: null }))).toBe(true);
    expect(await manualDiscountAllowed(client({ data: false, error: null }))).toBe(false);
    expect(await manualDiscountAllowed(client({ data: true, error: { message: "x" } }))).toBe(false);
    expect(await manualDiscountAllowed(client({ data: null, error: null }))).toBe(false);
    expect(await manualDiscountAllowed(client(new Error("putus")))).toBe(false);
  });
});

describe("Akses Grup: izin khusus diskon manual, bawaan hanya ADMIN", () => {
  const row = (id: string) => ({ id, label: "x", group: "Kasir & Tagihan", enforced: true });
  const snapshot = (role: string, source: "legacy" | "custom", allowed: string[]) => ({
    actions: { source, allowed }, action_catalog: [row(MANUAL_DISCOUNT_ACTION), row("bank.cash_accounts.create")], role, revision: "a".repeat(32),
    source: source === "legacy" ? "legacy" : "custom", modules: [], capabilities: { all_branches: false, create_accounts: false }, audit: [],
  });
  it("terdaftar sebagai izin khusus dengan pengecualian ADMIN", () => {
    expect(isGrantOnlyAction(MANUAL_DISCOUNT_ACTION)).toBe(true);
    expect(GRANT_ONLY_LEGACY_ROLES[MANUAL_DISCOUNT_ACTION]).toEqual(["ADMIN"]);
    expect(legacyRoleHasAction(MANUAL_DISCOUNT_ACTION, "ADMIN")).toBe(true);
    expect(legacyRoleHasAction(MANUAL_DISCOUNT_ACTION, "STAFF")).toBe(false);
    expect(legacyRoleHasAction("pembelian.tanggal_mundur", "ADMIN")).toBe(false);
    expect(legacyRoleHasAction("bank.cash_accounts.create", "STAFF")).toBe(true);
  });
  it("editor: ADMIN legacy tercentang, STAFF/DOCTOR/FINANCE legacy tidak", () => {
    expect(effectiveAllowedActions(parseRoleAccessConfig(snapshot("ADMIN", "legacy", []), "ADMIN")!)).toEqual([MANUAL_DISCOUNT_ACTION, "bank.cash_accounts.create"]);
    for (const role of ["STAFF", "DOCTOR", "FINANCE"]) {
      expect(effectiveAllowedActions(parseRoleAccessConfig(snapshot(role, "legacy", []), role)!)).toEqual(["bank.cash_accounts.create"]);
    }
  });
  it("kebijakan tersimpan dihormati apa adanya", () => {
    expect(effectiveAllowedActions(parseRoleAccessConfig(snapshot("STAFF", "custom", [MANUAL_DISCOUNT_ACTION]), "STAFF")!)).toEqual([MANUAL_DISCOUNT_ACTION]);
    expect(effectiveAllowedActions(parseRoleAccessConfig(snapshot("ADMIN", "custom", []), "ADMIN")!)).toEqual([]);
  });
  it("sinkron dengan migrasi: katalog enforced, fungsi database legacy hanya ADMIN, OWNER selalu", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const file = readdirSync(dir).filter((f) => f.endsWith("_diskon_manual_owner_admin.sql")).sort()[0];
    const sql = readFileSync(join(dir, file), "utf8");
    expect(sql).toMatch(/\('kasir\.diskon_manual','Beri diskon manual[^']*','Kasir & Tagihan',true\)/);
    expect(sql).toContain("action_modules(id,module_id) values('kasir.diskon_manual','kasir')");
    expect(sql).toContain("if v_role='OWNER' then return true; end if;");
    expect(sql).toContain("if not found then return v_role='ADMIN'; end if;");
    expect(sql).toContain("grant execute on function public.manual_discount_allowed() to authenticated;");
  });
});
