// E3 (meeting 12 Nov 2026): akses khusus per akun — penggabungan murni, pembaca bersama, dan konsistensi pemakai.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bolehBukaPath, modulDiizinkan, roleUsesLegacyStaffShell, ROLE_V2_MARKER, tujuanSaatDiblokir, type AturanTersimpan } from "../akses";
import {
  ACCESS_OVERRIDE_RPC, aturanEfektif, aturanPeranV2, bacaAkses, bacaTambahanAkses, isOverrideFunctionMissing, loadAksesAkun,
  menuTerbuka, parseAksesAkun, punyaAksesKhusus, terapkanAksesAkun, type AksesAkun,
} from "../akses-akun";
import { cariMenu } from "../cari-global";
import { buildReportCatalog } from "../report-catalog";
import { selectableSubmenus } from "../submenu-access";

const ONLINE: AksesAkun = { mode: "khusus", modules: { penjualan: ["penjualan.online"] } };
const TAMBAH_ONLINE: AksesAkun = { mode: "tambah", modules: { penjualan: ["penjualan.online"] } };
const ok = (override: AksesAkun | null) => ({ status: "ok" as const, override });
const tanpaSub = { status: "ok" as const, rows: [] };
const boleh = (role: string, rules: AturanTersimpan, paths: string[]) => Object.fromEntries(paths.map(p => [p, bolehBukaPath(role, p, rules)]));

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => errorSpy.mockRestore());

describe("parseAksesAkun (jawaban get_my_access_override)", () => {
  it("null/undefined = tidak ada akses khusus (Ikuti peran)", () => {
    expect(parseAksesAkun(null)).toBeNull();
    expect(parseAksesAkun(undefined)).toBeNull();
  });
  it("bentuk sah dibaca; semua sub-menu = seluruh modul; urutan dirapikan", () => {
    const semua = selectableSubmenus("klinik").map(x => x.id);
    expect(parseAksesAkun({ mode: "khusus", modules: { penjualan: ["penjualan.online"], klinik: semua, kasir: null }, updated_at: "x" }))
      .toEqual({ mode: "khusus", modules: { penjualan: ["penjualan.online"], klinik: null, kasir: null } });
  });
  it("bentuk tidak dikenal = undefined (pemanggil memperlakukannya sebagai galat → ikuti peran)", () => {
    for (const v of [[], "x", 1, { mode: "semua", modules: {} }, { mode: "khusus" }, { mode: "khusus", modules: [] }, { mode: "khusus", modules: { penjualan: [1] } }, { mode: "khusus", modules: { penjualan: "x" } }]) {
      expect(parseAksesAkun(v), JSON.stringify(v)).toBeUndefined();
    }
  });
  it("modul/sub-menu yang tidak dikenal aplikasi dibuang, tidak pernah diberikan", () => {
    expect(parseAksesAkun({ mode: "khusus", modules: { "modul-baru": null, penjualan: ["penjualan.online", "penjualan.baru"], dashboard: ["x"] } }))
      .toEqual({ mode: "khusus", modules: { penjualan: ["penjualan.online"] } });
    // khusus yang isinya semua tak dikenal tetap "khusus" kosong: lebih sempit, bukan kembali ke peran
    expect(parseAksesAkun({ mode: "khusus", modules: { "modul-baru": null } })).toEqual({ mode: "khusus", modules: {} });
    expect(parseAksesAkun({ mode: "tambah", modules: { "modul-baru": null } })).toBeNull();
  });
});

describe("loadAksesAkun: gagal baca tidak pernah memperluas akses", () => {
  const client = (r: { data: unknown; error: { code?: string; message?: string } | null } | Error) => ({
    rpc: vi.fn(async (name: string) => { expect(name).toBe(ACCESS_OVERRIDE_RPC); if (r instanceof Error) throw r; return r; }),
  });
  it("ok + null + bentuk sah", async () => {
    expect(await loadAksesAkun(client({ data: null, error: null }))).toEqual({ status: "ok", override: null });
    expect(await loadAksesAkun(client({ data: { mode: "khusus", modules: { penjualan: ["penjualan.online"] } }, error: null }))).toEqual(ok(ONLINE));
  });
  it("fungsi belum ada (aplikasi rilis lebih dulu) = absent", async () => {
    for (const error of [{ code: "PGRST202", message: "Could not find the function public.get_my_access_override without parameters in the schema cache" },
      { code: "42883", message: "function public.get_my_access_override() does not exist" }]) {
      expect(await loadAksesAkun(client({ data: null, error }))).toEqual({ status: "absent", override: null });
    }
    expect(isOverrideFunctionMissing({ code: "42883", message: "function public.foo() does not exist" })).toBe(false);
    expect(isOverrideFunctionMissing({ code: "PGRST202", message: "get_my_access_override_x" })).toBe(false);
  });
  it("galat lain, lemparan, atau bentuk aneh = error (dicatat di log), override null", async () => {
    expect(await loadAksesAkun(client({ data: null, error: { code: "57014", message: "timeout" } }))).toEqual({ status: "error", override: null });
    expect(await loadAksesAkun(client(new Error("network")))).toEqual({ status: "error", override: null });
    expect(await loadAksesAkun(client({ data: [{ role: "STAFF" }], error: null }))).toEqual({ status: "error", override: null });
    expect(await loadAksesAkun({} as never)).toEqual({ status: "error", override: null });
    expect(errorSpy).toHaveBeenCalled();
  });
});

// Halaman uji: SELALU_BOLEH, modul STAFF bawaan, Penjualan Online (+ impor), sub-menu lain, operasional.
const PATHS = ["/me", "/mulai", "/", "/klinik", "/klinik/antrian", "/kasir", "/kasir/quest", "/pos/quest", "/pos/shift",
  "/penjualan", "/penjualan/online", "/penjualan/online/impor", "/penjualan/online/baru", "/penjualan/faktur", "/crm",
  "/keuangan/jurnal", "/dokumen/x"];

describe("matriks: 3 mode × peran", () => {
  const roleCases: { name: string; role: string; rules: AturanTersimpan }[] = [
    { name: "STAFF bawaan (lama)", role: "STAFF", rules: [] },
    { name: "STAFF aturan lama tersimpan", role: "STAFF", rules: [{ role: "STAFF", module_id: "klinik" }, { role: "STAFF", module_id: "crm" }] },
    { name: "STAFF v2 (Akses Grup baru)", role: "STAFF", rules: [{ role: "STAFF", module_id: ROLE_V2_MARKER }, { role: "STAFF", module_id: "klinik" }] },
    { name: "FINANCE bawaan", role: "FINANCE", rules: [] },
    { name: "ADMIN bawaan", role: "ADMIN", rules: [] },
    { name: "DOCTOR bawaan", role: "DOCTOR", rules: [] },
  ];

  it.each(roleCases)("Ikuti peran: $name tidak berubah sama sekali", ({ role, rules }) => {
    expect(terapkanAksesAkun(role, rules, null)).toBe(rules);
  });

  it("OWNER selalu penuh: akses khusus apa pun diabaikan", () => {
    const rules: AturanTersimpan = [{ role: "STAFF", module_id: "klinik" }];
    expect(terapkanAksesAkun("OWNER", rules, ONLINE)).toBe(rules);
    expect(terapkanAksesAkun("ROLE_ASING", rules, ONLINE)).toBe(rules);
  });

  it.each(roleCases)("Hanya akses khusus: $name hanya membuka Penjualan Online (+ halaman yang selalu boleh)", ({ role, rules }) => {
    const ef = terapkanAksesAkun(role, rules, ONLINE);
    expect(boleh(role, ef, PATHS)).toEqual({
      "/me": true, "/mulai": true, "/": false, "/klinik": false, "/klinik/antrian": false, "/kasir": false, "/kasir/quest": false,
      "/pos/quest": false, "/pos/shift": false, "/penjualan": false, "/penjualan/online": true, "/penjualan/online/impor": true,
      "/penjualan/online/baru": true, "/penjualan/faktur": false, "/crm": false, "/keuangan/jurnal": false, "/dokumen/x": false,
    });
    expect(tujuanSaatDiblokir(role, ef)).toBe("/mulai");
    expect(roleUsesLegacyStaffShell(role, ef)).toBe(false); // sidebar biasa, bukan tampilan kasir klinik lama
    expect(menuTerbuka(role, ef)).toEqual([{ id: "penjualan", label: "Penjualan", href: "/penjualan/online" }]);
  });

  it("Hanya akses khusus: grup Operasional bisa dicentang sendiri (Kasir), dashboard juga", () => {
    const ef = terapkanAksesAkun("STAFF", [], { mode: "khusus", modules: { kasir: null, dashboard: null } });
    expect(boleh("STAFF", ef, ["/kasir", "/kasir/x", "/kasir/quest", "/", "/klinik"])).toEqual({ "/kasir": true, "/kasir/x": true, "/kasir/quest": false, "/": true, "/klinik": false });
    expect(tujuanSaatDiblokir("STAFF", ef)).toBe("/");
  });

  it("Hanya akses khusus pada ADMIN: semua modul dicentang = jangkauan penuh seperti bawaan", () => {
    const semua = Object.fromEntries(["dashboard", "klinik", "crm", "hris", "pengaturan", "perusahaan", "buku-besar", "kas-bank", "penjualan", "pembelian", "pos", "aset-tetap", "pajak", "laporan", "kasir", "quest-staff", "pos-shift"].map(m => [m, null]));
    const ef = terapkanAksesAkun("ADMIN", [], { mode: "khusus", modules: semua });
    expect(PATHS.every(p => bolehBukaPath("ADMIN", p, ef))).toBe(true);
  });

  it("Peran + tambahan: STAFF bawaan tetap punya Klinik, Kasir, Quest kasir; ditambah Penjualan Online saja", () => {
    const ef = terapkanAksesAkun("STAFF", [], TAMBAH_ONLINE);
    expect(boleh("STAFF", ef, PATHS)).toEqual({
      "/me": true, "/mulai": true, "/": false, "/klinik": true, "/klinik/antrian": true, "/kasir": true, "/kasir/quest": true,
      "/pos/quest": false, "/pos/shift": false, "/penjualan": false, "/penjualan/online": true, "/penjualan/online/impor": true,
      "/penjualan/online/baru": true, "/penjualan/faktur": false, "/crm": false, "/keuangan/jurnal": false, "/dokumen/x": false,
    });
    expect(roleUsesLegacyStaffShell("STAFF", ef)).toBe(false);
    expect(menuTerbuka("STAFF", ef).map(m => m.id)).toEqual(["klinik", "penjualan"]);
  });

  it("Peran + tambahan: FINANCE bawaan tetap keuangan + Shift Kasir; ditambah Penjualan Online", () => {
    const ef = terapkanAksesAkun("FINANCE", [], TAMBAH_ONLINE);
    expect(boleh("FINANCE", ef, ["/", "/keuangan/jurnal", "/pos/shift", "/penjualan/online", "/penjualan/faktur", "/klinik", "/kasir"]))
      .toEqual({ "/": true, "/keuangan/jurnal": true, "/pos/shift": true, "/penjualan/online": true, "/penjualan/faktur": false, "/klinik": false, "/kasir": false });
  });

  it("Peran + tambahan pada peran yang sudah penuh (ADMIN/DOCTOR bawaan): tidak berubah", () => {
    const rules: AturanTersimpan = [];
    expect(terapkanAksesAkun("ADMIN", rules, TAMBAH_ONLINE)).toBe(rules);
    expect(terapkanAksesAkun("DOCTOR", rules, TAMBAH_ONLINE)).toBe(rules);
  });

  it("Peran + tambahan: sub-menu digabung, seluruh modul menang, peran lain tidak tersentuh", () => {
    const rules: AturanTersimpan = [
      { role: "STAFF", module_id: ROLE_V2_MARKER }, { role: "STAFF", module_id: "penjualan", submenus: ["penjualan.rekap"] },
      { role: "STAFF", module_id: "crm" }, { role: "ADMIN", module_id: "crm" },
    ];
    const ef = terapkanAksesAkun("STAFF", rules, { mode: "tambah", modules: { penjualan: ["penjualan.online"], crm: ["crm.promo"] } });
    expect(boleh("STAFF", ef, ["/penjualan", "/penjualan/online", "/penjualan/faktur", "/crm/pelanggan", "/crm/promo"]))
      .toEqual({ "/penjualan": true, "/penjualan/online": true, "/penjualan/faktur": false, "/crm/pelanggan": true, "/crm/promo": true });
    expect(ef.filter(r => r.role === "ADMIN")).toEqual([{ role: "ADMIN", module_id: "crm" }]);
    expect(rules[1].submenus).toEqual(["penjualan.rekap"]); // masukan tidak diubah
    const penuh = terapkanAksesAkun("STAFF", rules, { mode: "tambah", modules: { penjualan: null } });
    expect(bolehBukaPath("STAFF", "/penjualan/faktur", penuh)).toBe(true);
  });

  it("aturanPeranV2 = jangkauan yang sama dengan aturan lama (bawaan & tersimpan) untuk setiap peran", () => {
    const sample = [...PATHS, "/pos/stok", "/pos", "/laporan", "/keuangan/neraca", "/hris", "/pengaturan/pajak", "/pembelian"];
    const cases: [string, AturanTersimpan][] = [
      ["STAFF", []], ["FINANCE", []],
      ["DOCTOR", [{ role: "DOCTOR", module_id: "klinik" }, { role: "DOCTOR", module_id: "laporan" }]],
      ["ADMIN", [{ role: "ADMIN", module_id: "pos" }, { role: "ADMIN", module_id: "crm" }]],
      ["FINANCE", [{ role: "FINANCE", module_id: "laporan" }, { role: "FINANCE", module_id: "pos" }]],
      ["STAFF", [{ role: "STAFF", module_id: "klinik" }, { role: "STAFF", module_id: "pos" }]],
    ];
    for (const [role, rules] of cases) {
      const v2 = aturanPeranV2(role, rules);
      for (const p of sample) expect(bolehBukaPath(role, p, v2), `${role} ${JSON.stringify(rules)} ${p}`).toBe(bolehBukaPath(role, p, rules));
    }
  });
});

describe("aturanEfektif + pembaca bersama", () => {
  it("menggabungkan sub-menu peran lalu akses khusus; gagal baca akses khusus = peran saja", () => {
    const rules = [{ role: "STAFF", module_id: ROLE_V2_MARKER }, { role: "STAFF", module_id: "klinik" }];
    const submenu = { status: "ok" as const, rows: [{ role: "STAFF", module_id: "klinik", allowed: ["klinik.antrian"] }] };
    const ef = aturanEfektif("STAFF", { rules, submenu, akun: ok(TAMBAH_ONLINE) });
    expect(boleh("STAFF", ef, ["/klinik/antrian", "/klinik/registrasi", "/penjualan/online"])).toEqual({ "/klinik/antrian": true, "/klinik/registrasi": false, "/penjualan/online": true });
    for (const akun of [{ status: "error" as const, override: null }, { status: "absent" as const, override: null }]) {
      const peran = aturanEfektif("STAFF", { rules, submenu, akun });
      expect(bolehBukaPath("STAFF", "/penjualan/online", peran)).toBe(false);
      expect(bolehBukaPath("STAFF", "/klinik/antrian", peran)).toBe(true);
    }
    // Mode khusus + galat baca = sementara akses peran (sesuai desain), tidak pernah lebih
    const peranSaja = aturanEfektif("STAFF", { rules: [], submenu: tanpaSub, akun: { status: "error", override: null } });
    expect(modulDiizinkan("STAFF", peranSaja)).toEqual(["klinik"]);
    expect(punyaAksesKhusus("STAFF", ok(ONLINE))).toBe(true);
    expect(punyaAksesKhusus("OWNER", ok(ONLINE))).toBe(false);
    expect(punyaAksesKhusus("STAFF", { status: "error", override: null })).toBe(false);
  });

  it("bacaAkses membaca role_modules, sub-menu, dan akses khusus bersamaan (tanpa putaran berurutan)", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const client = {
      rpc: vi.fn(async (name: string) => { order.push(name); await gate; return name === ACCESS_OVERRIDE_RPC ? { data: { mode: "khusus", modules: { penjualan: ["penjualan.online"] } }, error: null } : { data: [], error: null }; }),
      from: vi.fn((table: string) => {
        order.push(table);
        const q = { eq: vi.fn(() => q), then: (res: (v: unknown) => unknown) => gate.then(() => res({ data: [{ role: "STAFF", module_id: "klinik" }], error: null })) };
        return { select: () => q };
      }),
    };
    const p = bacaAkses(client as never, { role: "STAFF" });
    await Promise.resolve();
    expect(order).toEqual(["role_modules", "get_my_submenu_policy", ACCESS_OVERRIDE_RPC]); // semua dimulai sebelum satu pun selesai
    release();
    const r = await p;
    expect(r.rulesError).toBeNull();
    expect(r.akun).toEqual(ok(ONLINE));
    expect(bolehBukaPath("STAFF", "/penjualan/online", aturanEfektif("STAFF", r))).toBe(true);
  });

  it("bacaAkses: galat role_modules diteruskan ke pemanggil (mereka gagal tertutup seperti dulu)", async () => {
    const client = { rpc: async () => ({ data: null, error: null }), from: () => ({ select: () => Promise.resolve({ data: null, error: { message: "x" } }) }) };
    const r = await bacaAkses(client as never);
    expect(r.rulesError).toEqual({ message: "x" });
    expect(r.rules).toBeNull();
    expect(await bacaTambahanAkses({ rpc: async () => ({ data: null, error: null }) })).toEqual({ submenu: { status: "ok", rows: [] }, akun: { status: "ok", override: null } });
  });
});

describe("konsistensi pemakai: pencarian menu dan katalog laporan ikut akses khusus", () => {
  const ef = terapkanAksesAkun("STAFF", [], ONLINE);
  it("pencarian menu hanya menampilkan halaman yang bisa dibuka", () => {
    expect(cariMenu("online", "STAFF", ef).map(m => m.href)).toContain("/penjualan/online");
    expect(cariMenu("antrian", "STAFF", ef)).toEqual([]);
    expect(cariMenu("antri", "STAFF", []).length).toBeGreaterThan(0); // STAFF biasa tetap melihat menu klinik
    expect(cariMenu("faktur", "STAFF", ef).every(m => bolehBukaPath("STAFF", m.href, ef))).toBe(true);
  });
  it("katalog laporan: tanpa modul laporan semua tautan laporan dibatasi", () => {
    const catalog = buildReportCatalog("STAFF", ef);
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.filter(r => r.href)).toEqual([]);
  });
});
