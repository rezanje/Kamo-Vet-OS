import { describe, expect, it } from "vitest";
import { bolehBukaPath, modulDiizinkan, MODULE_PATHS, ROLE_V2_MARKER, tujuanSaatDiblokir, type AturanTersimpan } from "../akses";
import { gabungSubmenu, parseSubmenuPolicyRows } from "../submenu-access";

// ROLE ADMIN is the first-class acceptance case (Andri): the default of ADMIN is EVERY module, and the
// Owner then restricts a few modules to a few sub-menus.
const ALL = ["dashboard", "klinik", "crm", "hris", "pengaturan", "perusahaan", "buku-besar", "kas-bank", "penjualan", "pembelian", "pos", "aset-tetap", "pajak", "laporan", "kasir", "quest-staff", "pos-shift"];
const v2 = (role: string, modules: string[], subs: Record<string, string[]> = {}): AturanTersimpan => [
  { role, module_id: ROLE_V2_MARKER },
  ...modules.map(m => (m in subs ? { role, module_id: m, submenus: subs[m] } : { role, module_id: m })),
];
const adminRestricted = (extra: Record<string, string[]> = {}) => v2("ADMIN", ALL, {
  klinik: ["klinik.registrasi", "klinik.antrian", "klinik.pembayaran"],
  pos: ["pos.stok", "pos.kartu-stok"],
  laporan: ["laporan.laba-rugi", "laporan.penjualan-rinci"],
  ...extra,
});

describe("ROLE ADMIN restricted to a few sub-menus in several modules", () => {
  const rules = adminRestricted();
  const can = (path: string) => bolehBukaPath("ADMIN", path, rules);

  it("reaches the chosen pages and their nested detail pages", () => {
    for (const p of ["/klinik", "/klinik/registrasi", "/klinik/antrian", "/klinik/antrian/abc", "/klinik/pembayaran/v1", "/klinik/pembayaran/v1/struk",
      "/pos", "/pos/stok", "/pos/kartu-stok", "/laporan", "/laporan/penjualan-rinci", "/keuangan/laba-rugi"]) expect(can(p), p).toBe(true);
  });

  it("is refused every other page of the restricted modules (URL typing)", () => {
    for (const p of ["/klinik/rekam-medis", "/klinik/rekam-medis/abc", "/klinik/rawat-inap", "/klinik/shift", "/klinik/baru-tanpa-menu",
      "/pos/sku", "/pos/sku/baru", "/pos/opname/baru", "/pos/transaksi", "/laporan/gaji", "/laporan/margin-racikan", "/keuangan/neraca",
      "/keuangan/arus-kas", "/klinik/rekam-medis?x=1", "/klinik/rekam-medis/", "/Klinik/rekam-medis", "/klinik/%72ekam-medis"]) expect(can(p), p).toBe(false);
  });

  it("leaves modules without a policy exactly as today (every page)", () => {
    for (const p of ["/crm/pelanggan", "/crm/promo/abc/edit", "/hris/karyawan/abc", "/pengaturan/akses-grup", "/pengaturan/pajak", "/kas-bank/rekening/1/saldo-awal",
      "/keuangan/hutang", "/keuangan/coa", "/penjualan/faktur/baru", "/pembelian/faktur/langsung", "/keuangan/aset/1", "/keuangan/ppn"]) expect(can(p), p).toBe(true);
  });

  it("keeps ADMIN's full reach to pages no module owns, and operational/always-open pages", () => {
    for (const p of ["/dokumen/ABC", "/pajak/faktur", "/keuangan", "/keuangan/laba-ditahan", "/pos/shift", "/pos/shift/riwayat", "/pos/quest", "/kasir", "/kasir/quest", "/me", "/mulai", "/login"]) expect(can(p), p).toBe(true);
  });

  it("module list and landing: restricted modules stay visible while at least one sub-menu is allowed", () => {
    expect(modulDiizinkan("ADMIN", rules)).toEqual(ALL);
    expect(tujuanSaatDiblokir("ADMIN", rules)).toBe("/");
  });

  it("a module with all sub-menus unchecked (empty list) disappears and its pages are refused", () => {
    const r = adminRestricted({ klinik: [] });
    expect(modulDiizinkan("ADMIN", r)).not.toContain("klinik");
    for (const p of ["/klinik", "/klinik/antrian", "/klinik/pembayaran/x"]) expect(bolehBukaPath("ADMIN", p, r), p).toBe(false);
    expect(bolehBukaPath("ADMIN", "/pos/stok", r)).toBe(true);
  });

  it("a list that names only unknown sub-menus also hides the module (no empty module home)", () => {
    const r = adminRestricted({ klinik: ["klinik.tidak-ada", "pos.stok"] });
    expect(modulDiizinkan("ADMIN", r)).not.toContain("klinik");
    expect(bolehBukaPath("ADMIN", "/klinik", r)).toBe(false);
  });

  it("another module's sub-menu id in a module's list grants nothing", () => {
    const r = adminRestricted({ klinik: ["pos.stok"] });
    expect(bolehBukaPath("ADMIN", "/klinik/antrian", r)).toBe(false);
  });

  it("pengaturan restricted does not open /pengaturan/pajak unless module pajak grants it", () => {
    const only = adminRestricted({ pengaturan: ["pengaturan.cabang"] });
    expect(bolehBukaPath("ADMIN", "/pengaturan/cabang", only)).toBe(true);
    expect(bolehBukaPath("ADMIN", "/pengaturan/pajak", only)).toBe(true); // module pajak is whole
    const both = adminRestricted({ pengaturan: ["pengaturan.cabang"], pajak: ["pajak.rekap-ppn"] });
    expect(bolehBukaPath("ADMIN", "/pengaturan/pajak", both)).toBe(false);
    expect(bolehBukaPath("ADMIN", "/keuangan/ppn", both)).toBe(true);
    expect(bolehBukaPath("ADMIN", "/pengaturan/akses-grup", both)).toBe(false);
  });

  it("a partial module selection with sub-menus is not the full-reach shortcut", () => {
    const partial = v2("ADMIN", ["klinik", "crm"], { klinik: ["klinik.antrian"] });
    expect(bolehBukaPath("ADMIN", "/klinik/antrian", partial)).toBe(true);
    expect(bolehBukaPath("ADMIN", "/klinik/registrasi", partial)).toBe(false);
    expect(bolehBukaPath("ADMIN", "/crm/pelanggan", partial)).toBe(true);
    expect(bolehBukaPath("ADMIN", "/hris/karyawan", partial)).toBe(false);
    expect(bolehBukaPath("ADMIN", "/dokumen/x", partial)).toBe(false);
  });

  it("module without v2 marker (legacy rows) still obeys a policy and fails closed", () => {
    const legacy: AturanTersimpan = [{ role: "ADMIN", module_id: "klinik", submenus: ["klinik.antrian"] }, { role: "ADMIN", module_id: "crm" }];
    expect(bolehBukaPath("ADMIN", "/klinik/antrian", legacy)).toBe(true);
    expect(bolehBukaPath("ADMIN", "/klinik/registrasi", legacy)).toBe(false);
    expect(bolehBukaPath("ADMIN", "/crm/pelanggan", legacy)).toBe(true);
  });
});

describe("other roles and OWNER are unaffected by ADMIN's sub-menu policy", () => {
  const rules: AturanTersimpan = [
    ...adminRestricted(),
    ...v2("STAFF", ["klinik", "kasir"]),
    ...v2("FINANCE", ["dashboard", "kas-bank", "laporan", "pos-shift"]),
    { role: "OWNER", module_id: "klinik", submenus: [] }, // even a (forged) OWNER row can never restrict OWNER
  ];
  it("OWNER is unrestricted whatever rows exist", () => {
    for (const p of ["/klinik/rekam-medis", "/klinik", "/pos/sku", "/dokumen/x"]) expect(bolehBukaPath("OWNER", p, rules)).toBe(true);
    expect(modulDiizinkan("OWNER", rules)).toBeNull();
  });
  it("STAFF with whole klinik keeps every klinik page", () => {
    for (const p of ["/klinik/rekam-medis", "/klinik/shift", "/klinik/pembayaran/x"]) expect(bolehBukaPath("STAFF", p, rules), p).toBe(true);
    expect(bolehBukaPath("STAFF", "/pos/stok", rules)).toBe(false);
  });
  it("FINANCE keeps its modules whole", () => {
    for (const p of ["/laporan/gaji", "/keuangan/neraca", "/kas-bank/rekening"]) expect(bolehBukaPath("FINANCE", p, rules), p).toBe(true);
  });
  it("a role with no saved rows keeps today's defaults", () => {
    expect(bolehBukaPath("DOCTOR", "/pos/sku", rules)).toBe(true);
    expect(bolehBukaPath("STAFF", "/klinik/rekam-medis", [])).toBe(true);
  });
});

describe("zero regression: rows without `submenus` behave exactly as before", () => {
  it("equals the same rows with undefined policies for ADMIN/STAFF/FINANCE over every module prefix", () => {
    const plain = [...v2("ADMIN", ALL), ...v2("STAFF", ["klinik", "kasir"]), ...v2("FINANCE", ["dashboard", "kas-bank", "pos-shift"])];
    const explicitUndefined = plain.map(r => ({ ...r, submenus: undefined }));
    const paths = Object.values(MODULE_PATHS).flat().flatMap(p => [p, p + "/x", p + "/x/y?z=1"]).concat(["/dokumen/a", "/pajak/faktur", "/me"]);
    for (const role of ["ADMIN", "STAFF", "FINANCE"]) for (const p of paths) {
      expect(bolehBukaPath(role, p, explicitUndefined), `${role} ${p}`).toBe(bolehBukaPath(role, p, plain));
    }
    for (const p of ["/klinik/shift", "/laporan/gaji", "/pos/sku/baru"]) expect(bolehBukaPath("ADMIN", p, plain)).toBe(true);
  });
});

describe("gabungSubmenu / parseSubmenuPolicyRows", () => {
  const base: AturanTersimpan = [{ role: "ADMIN", module_id: "klinik" }, { role: "ADMIN", module_id: "crm" }, { role: "STAFF", module_id: "klinik" }];
  it("attaches the policy to the matching role+module row only", () => {
    const merged = gabungSubmenu(base, [{ role: "ADMIN", module_id: "klinik", allowed: ["klinik.antrian"] }]);
    expect(merged).toEqual([{ role: "ADMIN", module_id: "klinik", submenus: ["klinik.antrian"] }, { role: "ADMIN", module_id: "crm" }, { role: "STAFF", module_id: "klinik" }]);
    expect(base[0]).toEqual({ role: "ADMIN", module_id: "klinik" }); // input not mutated
  });
  it("ignores a policy row that has no module row (module not granted)", () => {
    expect(gabungSubmenu(base, [{ role: "ADMIN", module_id: "hris", allowed: [] }])).toEqual(base);
  });
  it("empty/absent policy returns the rows unchanged", () => {
    expect(gabungSubmenu(base, [])).toBe(base);
    expect(gabungSubmenu(base, null)).toBe(base);
  });
  it("parser accepts only a well-formed array and rejects anything else", () => {
    expect(parseSubmenuPolicyRows([{ role: "ADMIN", module_id: "klinik", allowed: ["klinik.antrian"] }])).toEqual([{ role: "ADMIN", module_id: "klinik", allowed: ["klinik.antrian"] }]);
    expect(parseSubmenuPolicyRows([])).toEqual([]);
    for (const bad of [null, {}, "x", [{}], [{ role: "ADMIN", module_id: "klinik" }], [{ role: "ADMIN", module_id: "klinik", allowed: "a" }], [{ role: "ADMIN", module_id: 1, allowed: [] }], [{ role: "ADMIN", module_id: "klinik", allowed: [1] }]]) {
      expect(parseSubmenuPolicyRows(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
