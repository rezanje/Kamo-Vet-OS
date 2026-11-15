// E3 (meeting 12 Nov 2026): akses khusus per akun ("Akses khusus akun ini" di Pengaturan › Pengguna).
//
// Satu tempat yang dipakai SEMUA pemeriksa hak buka menu (middleware, sidebar, katalog laporan, pencarian,
// unduhan, /mulai, helper laporan) supaya akses khusus berlaku sama di mana pun:
//   akses efektif = aturan peran (role_modules + sub-menu peran) ⊕ akses khusus akun
//   - tidak ada akses khusus  = "Ikuti peran" (perilaku lama persis);
//   - mode "tambah"           = akses peran DITAMBAH modul/sub-menu yang dicentang (gabungan, termasuk sub-menu);
//   - mode "khusus"           = HANYA modul/sub-menu yang dicentang (akses menu peran diabaikan).
// OWNER selalu penuh dan tidak pernah memakai akses khusus.
//
// Ini otorisasi navigasi/halaman saja. Tindakan bisnis yang dijaga database (action_policies /
// role_action_allowed) tetap per peran — akses khusus tidak memberinya.
//
// Gagal baca akses khusus (galat apa pun, bentuk jawaban tidak dikenal, atau fungsi database belum ada karena
// aplikasi rilis lebih dulu) = "Ikuti peran": tidak pernah memperluas akses karena galat. Untuk mode "khusus"
// artinya saat galat akun itu sementara memakai akses perannya (disetujui di desain E3); galat dicatat di log.
import { MODULE_PATHS, ROLE_V2_MARKER, SEMUA_PERAN, bolehBukaPath, modulDiizinkan, type AturanTersimpan } from "./akses";
import { MODULES } from "./nav";
import { gabungSubmenu, selectableSubmenus, submenuLanding } from "./submenu-access";
import { loadSubmenuPolicy, type SubmenuPolicyLoad } from "./submenu-policy";

export const ACCESS_OVERRIDE_RPC = "get_my_access_override";

export type ModeAksesAkun = "tambah" | "khusus";
/** module_id → daftar id sub-menu yang dicentang, atau null = seluruh modul (semua sub-menu). */
export type ModulAksesAkun = Record<string, string[] | null>;
export type AksesAkun = { mode: ModeAksesAkun; modules: ModulAksesAkun };

export type AksesAkunLoad =
  | { status: "ok"; override: AksesAkun | null }
  | { status: "absent"; override: null } // fungsi belum ada di database: Ikuti peran
  | { status: "error"; override: null }; // tidak bisa dipastikan: Ikuti peran (tidak pernah memperluas)

type RpcClient = { rpc(name: string): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
type RulesQuery = PromiseLike<{ data: unknown; error: unknown }> & { eq(column: string, value: string): RulesQuery };
// `from` sengaja longgar (klien Supabase bertipe generik berlapis; dicocokkan struktural = "type instantiation too deep").
type AksesClient = RpcClient & { from(table: "role_modules"): unknown };

const katalogModul = () => Object.keys(MODULE_PATHS);
const peranSah = (role: string) => (SEMUA_PERAN as readonly string[]).includes(role);

/**
 * Jawaban `get_my_access_override()` → akses khusus. null = tidak ada akses khusus; undefined = bentuk tidak dikenal.
 * Modul/sub-menu yang tidak dikenal aplikasi ini (mis. database lebih baru) DIBUANG, tidak pernah diberikan.
 */
export function parseAksesAkun(value: unknown): AksesAkun | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (v.mode !== "tambah" && v.mode !== "khusus") return undefined;
  if (!v.modules || typeof v.modules !== "object" || Array.isArray(v.modules)) return undefined;
  const modules: ModulAksesAkun = {};
  for (const [id, subs] of Object.entries(v.modules as Record<string, unknown>)) {
    if (subs !== null && !(Array.isArray(subs) && subs.every(s => typeof s === "string"))) return undefined;
    if (!katalogModul().includes(id)) continue;
    const pilihan = selectableSubmenus(id).map(x => x.id);
    if (subs === null) { modules[id] = null; continue; }
    if (pilihan.length === 0) continue; // modul tanpa sub-menu hanya sah sebagai "seluruh modul"
    const dikenal = [...new Set(subs as string[])].filter(s => pilihan.includes(s));
    if (dikenal.length === 0) continue; // tidak ada halaman yang bisa dibuka
    modules[id] = dikenal.length === pilihan.length ? null : dikenal.sort();
  }
  if (v.mode === "tambah" && Object.keys(modules).length === 0) return null; // tidak menambah apa pun
  return { mode: v.mode, modules };
}

const NAMA_FUNGSI = new RegExp(`(^|[^a-z0-9_])(public\\.)?${ACCESS_OVERRIDE_RPC}([^a-z0-9_]|$)`, "i");
/** Sama persis dengan aturan sub-menu: hanya galat yang menyebut fungsi INI yang berarti "belum ada". */
export function isOverrideFunctionMissing(error: { code?: string; message?: string }): boolean {
  if (error.code !== "PGRST202" && error.code !== "42883") return false;
  return NAMA_FUNGSI.test(error.message ?? "");
}

/** Tidak pernah melempar galat. */
export async function loadAksesAkun(client: RpcClient): Promise<AksesAkunLoad> {
  try {
    const { data, error } = await client.rpc(ACCESS_OVERRIDE_RPC);
    if (error) {
      if (isOverrideFunctionMissing(error)) return { status: "absent", override: null };
      console.error("[akses-akun] akses khusus akun gagal dibaca; memakai akses peran.", error.code ?? "", error.message ?? "");
      return { status: "error", override: null };
    }
    const parsed = parseAksesAkun(data);
    if (parsed === undefined) {
      console.error("[akses-akun] bentuk akses khusus akun tidak dikenal; memakai akses peran.");
      return { status: "error", override: null };
    }
    return { status: "ok", override: parsed };
  } catch (e) {
    console.error("[akses-akun] akses khusus akun gagal dibaca; memakai akses peran.", e instanceof Error ? e.message : "");
    return { status: "error", override: null };
  }
}

/**
 * Aturan satu peran dalam bentuk "Akses Grup v2" (penanda v2 + daftar modul eksplisit), sama persis dengan yang
 * ditampilkan layar Akses Grup (`role_settings_private.snapshot`): bawaan STAFF = Klinik + Kasir + Quest Staff,
 * bawaan FINANCE = modul keuangan + Shift Kasir, bawaan lain = semua; aturan lama mendapat grup operasionalnya.
 * Jangkauannya sama dengan aturan lama — dipakai supaya mode "tambah" bisa digabung dengan satu cara.
 */
export function aturanPeranV2(role: string, rules: AturanTersimpan): AturanTersimpan {
  const baris = rules.filter(r => r.role === role);
  const ids = baris.map(r => r.module_id);
  if (ids.includes(ROLE_V2_MARKER)) return baris;
  let modul: string[];
  if (ids.length === 0) {
    modul = role === "STAFF" ? ["klinik", "kasir", "quest-staff"]
      : role === "FINANCE" ? ["dashboard", "buku-besar", "kas-bank", "aset-tetap", "pajak", "laporan", "pos-shift"]
      : katalogModul();
  } else {
    modul = [...ids,
      ...(role === "STAFF" || role === "DOCTOR" ? ["kasir", "quest-staff"] : []),
      ...(ids.includes("pos") ? ["quest-staff", "pos-shift"] : []),
      ...(role === "FINANCE" ? ["pos-shift"] : [])];
  }
  return [{ role, module_id: ROLE_V2_MARKER }, ...[...new Set(modul)].map(module_id => {
    const sub = baris.find(r => r.module_id === module_id)?.submenus;
    return sub === undefined ? { role, module_id } : { role, module_id, submenus: [...sub] };
  })];
}

const barisAkun = (role: string, modules: ModulAksesAkun): AturanTersimpan =>
  Object.entries(modules).map(([module_id, subs]) => (subs === null ? { role, module_id } : { role, module_id, submenus: [...subs] }));

/**
 * Akses efektif (murni). Hanya baris peran milik akun ini yang diganti; baris peran lain dibiarkan.
 * Hasilnya `AturanTersimpan` biasa, jadi `bolehBukaPath`, sidebar, pintasan, pencarian, dan katalog tidak perlu tahu
 * soal akses khusus. Hasil yang memakai akses khusus SELALU berbentuk v2: tampilan staf lama (KlinikTopbar) tidak
 * dipakai, akun memakai sidebar biasa berisi menunya.
 */
export function terapkanAksesAkun(role: string, rules: AturanTersimpan, akses: AksesAkun | null | undefined): AturanTersimpan {
  if (!akses || role === "OWNER" || !peranSah(role)) return rules;
  const lain = rules.filter(r => r.role !== role);
  const tambahan = barisAkun(role, akses.modules);
  // Hanya akses khusus: daftar yang dicentang saja. Jalur bawaan peran (mis. /kasir untuk STAFF) ikut diabaikan;
  // grup Operasional (Kasir, Quest Staff, Shift Kasir) bisa dicentang sendiri.
  if (akses.mode === "khusus") return [...lain, { role, module_id: ROLE_V2_MARKER }, ...tambahan];
  // Peran + tambahan: peran yang sudah penuh (bawaan semua modul) tidak bisa ditambah apa-apa.
  if (modulDiizinkan(role, rules) === null) return rules;
  const dasar = aturanPeranV2(role, rules);
  const gabung = dasar.map(r => ({ ...r, ...(r.submenus ? { submenus: [...r.submenus] } : {}) }));
  for (const t of tambahan) {
    const ada = gabung.find(r => r.module_id === t.module_id);
    if (!ada) { gabung.push(t); continue; }
    if (ada.submenus === undefined) continue; // peran sudah seluruh modul
    if (t.submenus === undefined) { delete ada.submenus; continue; } // akun mendapat seluruh modul
    ada.submenus = [...new Set([...ada.submenus, ...t.submenus])].sort();
  }
  return [...lain, ...gabung];
}

export type BacaanAkses = {
  rules: { role: string; module_id: string }[] | null;
  rulesError: unknown;
  submenu: SubmenuPolicyLoad;
  akun: AksesAkunLoad;
};
export type TambahanAkses = Pick<BacaanAkses, "submenu" | "akun">;

/**
 * Pembaca bersama: aturan modul peran, kebijakan sub-menu peran, dan akses khusus akun dibaca BERSAMAAN (satu putaran).
 * `role` (opsional) membatasi bacaan `role_modules` ke satu peran. Tidak pernah melempar galat: pemanggil memutuskan
 * sendiri gagal tertutup untuk `rulesError` / `submenu.status === "error"` seperti sebelumnya.
 */
export async function bacaAkses(client: AksesClient, opts: { role?: string } = {}): Promise<BacaanAkses> {
  const query = (client.from("role_modules") as { select(columns: string): RulesQuery }).select("role, module_id");
  const [rulesRes, tambahan] = await Promise.all([
    Promise.resolve(opts.role ? query.eq("role", opts.role) : query).then(
      r => r, (e: unknown) => ({ data: null, error: e ?? new Error("role_modules") })),
    bacaTambahanAkses(client),
  ]);
  const rules = Array.isArray(rulesRes.data) ? (rulesRes.data as { role: string; module_id: string }[]) : null;
  // Sama seperti pemanggil lama: hanya `error` yang dianggap galat; data kosong = belum ada aturan (bawaan).
  return { rules, rulesError: rulesRes.error ?? null, ...tambahan };
}

/** Untuk pemanggil yang membaca `role_modules` sendiri (mis. berhalaman): sub-menu + akses khusus, bersamaan. */
export async function bacaTambahanAkses(client: RpcClient): Promise<TambahanAkses> {
  const [submenu, akun] = await Promise.all([loadSubmenuPolicy(client), loadAksesAkun(client)]);
  return { submenu, akun };
}

/** Aturan yang dipakai `bolehBukaPath` dkk.: peran + sub-menu peran (bila terbaca) + akses khusus akun (bila terbaca). */
export function aturanEfektif(role: string, bacaan: { rules: { role: string; module_id: string }[] | null } & TambahanAkses): AturanTersimpan {
  return terapkanAksesAkun(role, gabungSubmenu(bacaan.rules ?? [], bacaan.submenu.rows), bacaan.akun.override);
}

export const punyaAksesKhusus = (role: string, akun: AksesAkunLoad): boolean =>
  role !== "OWNER" && akun.status === "ok" && akun.override !== null;

/** Modul (urutan sidebar) yang bisa dibuka beserta halaman tujuannya. Dipakai /mulai dan ringkasan layar Owner. */
export function menuTerbuka(role: string, rules: AturanTersimpan): { id: string; label: string; href: string }[] {
  const allow = modulDiizinkan(role, rules);
  const hasil: { id: string; label: string; href: string }[] = [];
  for (const m of MODULES) {
    if (allow !== null && !allow.includes(m.id)) continue;
    const href = m.id === "dashboard" ? "/" : submenuLanding(m.id, rules.find(r => r.role === role && r.module_id === m.id)?.submenus) ?? `/${m.id}`;
    if (bolehBukaPath(role, href, rules)) hasil.push({ id: m.id, label: m.label, href });
  }
  return hasil;
}
