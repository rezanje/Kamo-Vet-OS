// DB -> TypeScript bridge, driven by scripts/test-role-submenu-postgres.py (native PG17).
// The script saves a restricted ADMIN through the REAL save_role_access_config, reads role_modules and
// get_my_submenu_policy() as the real roles, writes SUBMENU_PG_FIXTURE, and this test runs the production
// middleware resolver (gabungSubmenu + bolehBukaPath) over those exact DB rows. Skipped when the variable is unset.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bolehBukaPath, modulDiizinkan } from "../akses";
import { gabungSubmenu, parseSubmenuPolicyRows } from "../submenu-access";

const file = process.env.SUBMENU_PG_FIXTURE;
const d = describe.skipIf(!file);

d("native PG17 rows through the production resolver (ROLE ADMIN)", () => {
  const fx = file ? JSON.parse(readFileSync(file, "utf8")) : null;
  const policy = parseSubmenuPolicyRows(fx?.policy);
  const rules = gabungSubmenu(fx?.rules ?? [], policy);

  it("DB returned a parseable policy for ADMIN (3 modules)", () => {
    expect(policy).not.toBeNull();
    expect(policy!.map(r => r.module_id).sort()).toEqual(["klinik", "laporan", "pos"]);
  });
  it("ADMIN reaches only the chosen pages of the restricted modules", () => {
    for (const p of ["/klinik", "/klinik/registrasi", "/klinik/antrian/abc", "/klinik/pembayaran/v1/struk", "/pos", "/pos/stok", "/pos/kartu-stok", "/laporan/penjualan-rinci", "/keuangan/laba-rugi"]) {
      expect(bolehBukaPath("ADMIN", p, rules), p).toBe(true);
    }
  });
  it("typing any other page of a restricted module is refused", () => {
    for (const p of ["/klinik/rekam-medis", "/klinik/rawat-inap", "/klinik/shift", "/klinik/tidak-ada", "/pos/sku", "/pos/transaksi", "/laporan/gaji", "/keuangan/neraca", "/keuangan/arus-kas"]) {
      expect(bolehBukaPath("ADMIN", p, rules), p).toBe(false);
    }
  });
  it("unrestricted modules and ADMIN's full reach are exactly as before", () => {
    for (const p of ["/crm/pelanggan", "/hris/karyawan", "/pengaturan/pajak", "/keuangan/hutang", "/penjualan/faktur", "/pembelian/retur", "/dokumen/x", "/pajak/faktur", "/pos/shift", "/me"]) {
      expect(bolehBukaPath("ADMIN", p, rules), p).toBe(true);
    }
    expect(modulDiizinkan("ADMIN", rules)).toContain("klinik");
  });
  it("other roles and OWNER get no policy from the DB and stay unrestricted", () => {
    expect(fx.staff_policy).toEqual([]);
    expect(fx.owner_policy).toEqual([]);
    expect(bolehBukaPath("OWNER", "/klinik/rekam-medis", rules)).toBe(true);
    expect(bolehBukaPath("STAFF", "/klinik/rekam-medis", [{ role: "STAFF", module_id: "klinik" }])).toBe(true);
  });
});
