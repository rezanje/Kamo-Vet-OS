import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_ONLINE, LABEL_ADMIN_ONLINE, PERAN_AKUN, PERAN_WAJIB_CABANG, RUMAH_ADMIN_ONLINE, adminOnlineBolehBuka, isAdminOnline, jalurBaku, labelPeran,
} from "../admin-online";
import { SEMUA_PERAN, MODULE_PATHS, bolehBukaPath, modulDiizinkan, pakaiAturanSendiri, tujuanSaatDiblokir, type AturanTersimpan } from "../akses";
import { aturanEfektif, menuTerbuka, terapkanAksesAkun } from "../akses-akun";
import { JALUR_EKSTRA, PERAN_LAMA, SET_ATURAN, baca, daftarRute, matriksPeranLama } from "./fixtures/admin-online-matrix";

const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

// Peran "Admin Online": satu-satunya layar adalah impor penjualan marketplace. Ini langit-langit (tidak bisa dilebarkan aturan lain).
describe("peran Admin Online: konstanta dan label", () => {
  it("kode & label persis seperti diminta", () => {
    expect(ADMIN_ONLINE).toBe("ADMIN_ONLINE");
    expect(LABEL_ADMIN_ONLINE).toBe("Admin Online");
    expect(labelPeran("ADMIN_ONLINE")).toBe("Admin Online");
    expect(labelPeran("STAFF")).toBe("STAFF");
    expect(isAdminOnline("ADMIN_ONLINE")).toBe(true);
    expect(isAdminOnline("admin_online")).toBe(false);
    expect(isAdminOnline(null)).toBe(false);
    expect(isAdminOnline(undefined)).toBe(false);
  });
  it("rumah = layar impor; daftar peran akun memuat Admin Online dan wajib cabang", () => {
    expect(RUMAH_ADMIN_ONLINE).toBe("/penjualan/online/impor");
    expect(PERAN_AKUN).toContain("ADMIN_ONLINE");
    expect([...PERAN_AKUN].sort()).toEqual([...SEMUA_PERAN, "ADMIN_ONLINE"].sort());
    expect(PERAN_WAJIB_CABANG).toEqual(["STAFF", "DOCTOR", "ADMIN_ONLINE"]);
  });
  it("SEMUA_PERAN (peran yang bisa diatur Akses Grup) TIDAK memuat Admin Online: menunya tidak bisa diatur", () => {
    expect(SEMUA_PERAN as readonly string[]).not.toContain("ADMIN_ONLINE");
  });
});

describe("langit-langit jalur Admin Online (adminOnlineBolehBuka)", () => {
  const BOLEH = ["/penjualan/online/impor", "/penjualan/online/impor?x=1", "/penjualan/online/impor#a", "/penjualan/online/impor/", "/penjualan/online/%69mpor",
    "//penjualan/online/impor", "/login", "/login?error=x", "/auth/callback"];
  const DITOLAK = ["/", "/me", "/mulai", "/mulai/cabang", "/kasir", "/kasir/quest", "/pos", "/pos/shift", "/klinik", "/klinik/pasien", "/crm", "/hris", "/pengaturan", "/pengaturan/pengguna",
    "/pengaturan/akses-grup", "/perusahaan", "/buku-besar", "/kas-bank", "/pembelian", "/laporan", "/keuangan/jurnal", "/keuangan/laba-rugi", "/keuangan/neraca", "/penjualan", "/penjualan/online",
    "/penjualan/online/baru", "/penjualan/online/impor/lain", "/penjualan/online/imporx", "/penjualan/online/impor/../baru", "/penjualan/online/./impor", "/penjualan/online/impor%2f..%2fbaru",
    "/penjualan/online/impor%00", "/penjualan\\online\\impor", "/api/cari", "/api/pelanggan", "/api/impor/accurate/progres", "/loginx", "/authx", "/booking", "", "/%E0%A4%A"];
  for (const p of BOLEH) it(`boleh: ${JSON.stringify(p)}`, () => { expect(adminOnlineBolehBuka(p)).toBe(true); });
  for (const p of DITOLAK) it(`ditolak: ${JSON.stringify(p)}`, () => { expect(adminOnlineBolehBuka(p)).toBe(false); });
  it("jalurBaku: rusak/berbahaya = null (gagal tertutup)", () => {
    expect(jalurBaku("/%E0%A4%A")).toBeNull();
    expect(jalurBaku("/a\\b")).toBeNull();
    expect(jalurBaku("/a%00b")).toBeNull();
    expect(jalurBaku("/A//b/")).toBe("/a/b");
  });
});

describe("filter menu & bolehBukaPath: Admin Online tidak bisa dilebarkan aturan apa pun", () => {
  const SEMUA_MODUL = Object.keys(MODULE_PATHS);
  const ATURAN_LEBAR: Record<string, AturanTersimpan> = {
    kosong: [],
    semua_modul: SEMUA_MODUL.map(module_id => ({ role: "ADMIN_ONLINE", module_id })),
    v2_semua: [{ role: "ADMIN_ONLINE", module_id: "__role_v2__" }, ...SEMUA_MODUL.map(module_id => ({ role: "ADMIN_ONLINE", module_id }))],
    penanda_db: [{ role: "ADMIN_ONLINE", module_id: "admin-online-only" }],
    penjualan_penuh: [{ role: "ADMIN_ONLINE", module_id: "penjualan" }],
    lain_peran_lebar: PERAN_LAMA.map(role => ({ role, module_id: "pengaturan" })),
  };
  for (const [nama, aturan] of Object.entries(ATURAN_LEBAR)) {
    it(`aturan "${nama}": hanya layar impor yang terbuka`, () => {
      for (const p of [...new Set([...daftarRute().map(r => r.url), ...JALUR_EKSTRA])]) {
        expect(bolehBukaPath("ADMIN_ONLINE", p, aturan), p).toBe(adminOnlineBolehBuka(p));
      }
      expect(bolehBukaPath("ADMIN_ONLINE", RUMAH_ADMIN_ONLINE, aturan)).toBe(true);
      expect(bolehBukaPath("ADMIN_ONLINE", "/", aturan)).toBe(false);
      expect(modulDiizinkan("ADMIN_ONLINE", aturan)).toEqual([]);
      expect(menuTerbuka("ADMIN_ONLINE", aturan)).toEqual([]);          // sidebar: tidak ada satu menu pun
      expect(pakaiAturanSendiri("ADMIN_ONLINE", aturan)).toBe(false);
      expect(tujuanSaatDiblokir("ADMIN_ONLINE", aturan)).toBe(RUMAH_ADMIN_ONLINE); // tidak pernah dilempar ke halaman lain
    });
  }
  it("akses khusus akun (mode tambah / khusus) tidak melebarkan: peran ini tidak dikenal akses khusus", () => {
    const aturan: AturanTersimpan = [];
    for (const mode of ["tambah", "khusus"] as const) {
      const hasil = terapkanAksesAkun("ADMIN_ONLINE", aturan, { mode, modules: { klinik: null, pengaturan: null, "buku-besar": null } });
      expect(hasil).toBe(aturan);
      expect(bolehBukaPath("ADMIN_ONLINE", "/klinik", hasil)).toBe(false);
    }
    const bacaan = { rules: [], submenu: { status: "ok", rows: [] }, akun: { status: "ok", override: { mode: "khusus", modules: { klinik: null } } } } as never;
    expect(bolehBukaPath("ADMIN_ONLINE", "/klinik", aturanEfektif("ADMIN_ONLINE", bacaan))).toBe(false);
    expect(bolehBukaPath("ADMIN_ONLINE", RUMAH_ADMIN_ONLINE, aturanEfektif("ADMIN_ONLINE", bacaan))).toBe(true);
  });
});

describe("matriks rute (semua page.tsx / route.ts di src/app)", () => {
  const rute = daftarRute();
  it("ada banyak rute nyata, termasuk layar impor", () => {
    expect(rute.length).toBeGreaterThan(150);
    expect(rute.map(r => r.url)).toContain(RUMAH_ADMIN_ONLINE);
    expect(rute.filter(r => r.kind === "route").map(r => r.url)).toEqual(expect.arrayContaining(["/api/cari", "/api/pelanggan", "/api/version"]));
  });
  it("Admin Online hanya boleh membuka SATU halaman aplikasi (layar impor) + login/auth", () => {
    const boleh = rute.filter(r => r.kind === "page" && bolehBukaPath("ADMIN_ONLINE", r.url, [])).map(r => r.url);
    expect(boleh.filter(u => !u.startsWith("/login") && !u.startsWith("/auth"))).toEqual([RUMAH_ADMIN_ONLINE]);
  });
  it("setiap halaman non-impor ditolak (daftar lengkap, per rute)", () => {
    for (const r of rute.filter(x => x.kind === "page" && x.url !== RUMAH_ADMIN_ONLINE && !x.url.startsWith("/login") && !x.url.startsWith("/auth"))) {
      expect(bolehBukaPath("ADMIN_ONLINE", r.url, []), r.url).toBe(false);
    }
  });
  it("route handler /api: tidak lewat middleware, jadi masing-masing wajib menjaga diri (peran/CRON_SECRET/publik) — dicek per berkas", () => {
    // Route handler di luar /api (unduh/template) tetap lewat middleware: ditolak untuk Admin Online oleh langit-langit jalur.
    for (const r of rute.filter(x => x.kind === "route" && !x.url.startsWith("/api"))) expect(bolehBukaPath("ADMIN_ONLINE", r.url, []), r.url).toBe(false);
    const api = rute.filter(r => r.kind === "route" && r.url.startsWith("/api"));
    const ditinjau: Record<string, RegExp> = {
      "/api/cari": /bolehBukaPath\(role, path, aturan\)/,                // tiap sumber disaring bolehBukaPath -> Admin Online tidak mendapat apa pun
      "/api/pelanggan": /isAdminOnline\(profil\?\.role\)[\s\S]*403/,      // ditolak eksplisit
      "/api/impor/accurate/progres": /profile\?\.role !== "OWNER" && !isAdminRole\(profile\?\.role\)/, // daftar positif (OWNER + ADMIN/ADMIN_UMUM via isAdminRole; ADMIN_ONLINE tidak termasuk)
      "/api/version": /process\.env\.VERCEL_GIT_COMMIT_SHA/,              // publik, hanya versi build
      "/api/cron/akhir-bulan": /CRON_SECRET/,
      "/api/cron/wa-engine": /CRON_SECRET/,
    };
    expect(api.map(r => r.url).sort()).toEqual(Object.keys(ditinjau).sort());   // rute /api baru WAJIB ditinjau dan didaftarkan di sini
    for (const r of api) expect(baca(r.file), r.url).toMatch(ditinjau[r.url]);
  });
});

describe("snapshot: menu/akses peran lain TIDAK berubah (dibuat dari origin/main sebelum peran ini)", () => {
  const snap = JSON.parse(src("src/lib/__tests__/fixtures/admin-online-peran-lain.snapshot.json")) as Record<string, unknown>;
  const kini = matriksPeranLama({ bolehBukaPath, modulDiizinkan, tujuanSaatDiblokir });
  it("5 peran lama x 4 set aturan x semua rute: modul, tujuan, dan jalur terbuka identik", () => {
    expect(Object.keys(kini).sort()).toEqual(Object.keys(snap).sort());
    expect(Object.keys(snap).length).toBe(PERAN_LAMA.length * Object.keys(SET_ATURAN).length * 3);
    for (const k of Object.keys(snap)) expect(kini[k], k).toEqual(snap[k]);
  });
  it("snapshot memuat jalur impor untuk peran yang memang boleh dan tidak memuat apa pun untuk Admin Online", () => {
    expect(String(snap["OWNER|bawaan|buka"]).split(",")).toContain(RUMAH_ADMIN_ONLINE);
    expect(Object.keys(snap).some(k => k.startsWith("ADMIN_ONLINE"))).toBe(false);
  });
});

describe("penegakan berlapis di sumber (middleware, layout, mulai, login, aksi impor, Pengguna, Akses Grup)", () => {
  it("middleware: Admin Online dicek SEBELUM aturan lain dibaca; 303; tanpa konteks cabang/shift", () => {
    const m = src("src/lib/supabase/middleware.ts");
    const i = m.indexOf("if (isAdminOnline(role))");
    expect(i).toBeGreaterThan(0);
    expect(m.indexOf("tujuanSaatDiblokir(role, [])", i)).toBeGreaterThan(i);
    expect(m).toMatch(/NextResponse\.redirect\(url, \{ status: 303 \}\);\s*\}\s*request\.headers\.delete\(BRANCH_HEADER\)/);
    // kegagalan baca aturan hanya mengunci peran lain; kode untuk peran lain tidak digeser (rulesError/submenu tetap ada)
    expect(m).toContain("if (akses.rulesError) return loginRedirect(request);");
    expect(m).toContain('akses.submenu.status === "error" && role !== "OWNER"');
    expect(m.indexOf("if (akses.rulesError)")).toBeGreaterThan(i);
  });
  it("layout: cangkang minimal untuk Admin Online (tanpa Sidebar/PageTabs/CariGlobal)", () => {
    const l = src("src/app/(app)/layout.tsx");
    expect(l).toContain("if (isAdminOnline(profile?.role))");
    expect(l.indexOf("<AdminOnlineShell")).toBeLessThan(l.indexOf("<Sidebar"));
    const shell = src("src/components/AdminOnlineShell.tsx");
    for (const dilarang of ["Sidebar", "PageTabs", "CariGlobal", "Breadcrumb", "KlinikTopbar", "ActiveBranch", "href="]) expect(shell, dilarang).not.toContain(dilarang);
    expect(shell).toContain("logout");
  });
  it("/mulai dan login: langsung ke layar impor", () => {
    expect(src("src/app/mulai/page.tsx")).toMatch(/if \(isAdminOnline\(role\)\) redirect\(RUMAH_ADMIN_ONLINE\)/);
    const login = src("src/app/login/actions.ts");
    expect(login).toMatch(/isAdminOnline\(profil\?\.role\)\) redirect\(RUMAH_ADMIN_ONLINE\)/);
    expect(login.indexOf("RUMAH_ADMIN_ONLINE")).toBeLessThan(login.lastIndexOf('redirect("/mulai")'));
  });
  it("aksi impor: Admin Online membaca lewat RPC (tidak menyentuh tabel), peran lain jalur lama", () => {
    const a = src("src/app/(app)/penjualan/online/impor/actions.ts");
    expect(a).toContain("isAdminOnline(sesi.role)");
    expect(a).toContain("bacaGudangImpor(sesi.db, sesi.userId, branchId, sesi.role)");
    expect(a).toContain("bacaSudahAdaAdminOnline(db, refsPilihan)");
    expect(a).toMatch(/p\.sertakan === true && role === "OWNER"/);       // menyertakan pesanan terlewat tetap khusus OWNER
  });
  it("Pengguna: Admin Online bisa dipilih; cabang wajib; daftar peran di server action memakai sumber yang sama", () => {
    const a = src("src/app/(app)/pengaturan/pengguna/actions.ts");
    expect(a).toContain("PERAN_AKUN");
    expect(a).toContain("PERAN_WAJIB_CABANG.includes(role)");
    expect(a).not.toMatch(/\["OWNER", "ADMIN", "FINANCE", "STAFF", "DOCTOR"\]\.includes\(role\)/);
    expect(src("src/app/(app)/pengaturan/pengguna/page.tsx")).toContain('<option value="ADMIN_ONLINE">Admin Online');
    expect(src("src/lib/user-account-edit.ts")).toContain("PERAN_AKUN");
  });
  it("Akses Grup: baris terkunci Admin Online; tidak ada formulir untuknya", () => {
    const p = src("src/app/(app)/pengaturan/akses-grup/page.tsx");
    expect(p).toContain('data-peran-terkunci="ADMIN_ONLINE"');
    expect(p).toContain("Terkunci: hanya Impor penjualan online");
  });
});
