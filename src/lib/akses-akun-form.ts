// E3 (meeting 12 Nov 2026): baca formulir "Akses khusus akun ini" + pesan galat + ringkasan akses efektif. Murni.
import { ROLE_V2_MARKER, modulDiizinkan, type AturanTersimpan } from "./akses";
import { parseAksesAkun, terapkanAksesAkun, type AksesAkun, type ModulAksesAkun } from "./akses-akun";
import { ROLE_ACCESS_CATALOG, validRequestKey, type RoleAccessConfig } from "./role-access-catalog";
import { selectableSubmenus, submenuById, submenuLabel } from "./submenu-access";
import { isAccountEditId } from "./user-account-edit";

export type ModeForm = "ikuti" | "tambah" | "khusus";
export const LABEL_MODE: Record<ModeForm, string> = {
  ikuti: "Ikuti peran",
  tambah: "Peran + tambahan",
  khusus: "Hanya akses khusus",
};

export type FormAksesAkun =
  | { ok: true; profileId: string; requestKey: string; mode: ModeForm; modules: ModulAksesAkun | null; reason: string | null }
  | { ok: false; message: string };

const labelModul = (id: string) => ROLE_ACCESS_CATALOG.find(m => m.id === id)?.label ?? id;

/**
 * Isi formulir → permintaan simpan. Sama dengan layar Akses Grup: `mod_<modul>` dicentang, `sub_<id>` sub-menu,
 * `subs_<modul>` penanda bagian sub-menu tampil. Semua sub-menu dicentang = seluruh modul (null).
 */
export function bacaFormAksesAkun(form: FormData): FormAksesAkun {
  const gagal = (message: string): FormAksesAkun => ({ ok: false, message });
  const profileId = String(form.get("profile_id") ?? "");
  const requestKey = String(form.get("request_key") ?? "");
  if (!isAccountEditId(profileId) || !validRequestKey(requestKey)) return gagal("Formulir tidak lengkap. Muat ulang halaman lalu ulangi.");
  const mode = String(form.get("mode") ?? "");
  if (mode !== "ikuti" && mode !== "tambah" && mode !== "khusus") return gagal("Pilih salah satu: Ikuti peran, Peran + tambahan, atau Hanya akses khusus.");
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length > 1000) return gagal("Alasan maksimal 1000 huruf.");
  if (mode === "ikuti") return { ok: true, profileId, requestKey, mode, modules: null, reason: reason || null };

  const modul: string[] = [], sub: string[] = [], tampil: string[] = [];
  for (const [name, value] of form.entries()) {
    if (name.startsWith("mod_")) {
      const id = name.slice(4);
      if (value !== "on" || !ROLE_ACCESS_CATALOG.some(m => m.id === id) || modul.includes(id)) return gagal("Pilihan menu tidak dikenal. Muat ulang halaman.");
      modul.push(id);
    } else if (name.startsWith("subs_")) {
      const id = name.slice(5);
      if (value !== "1" || selectableSubmenus(id).length === 0 || tampil.includes(id)) return gagal("Pilihan sub-menu tidak dikenal. Muat ulang halaman.");
      tampil.push(id);
    } else if (name.startsWith("sub_")) {
      const id = name.slice(4);
      if (value !== "on" || !submenuById(id) || sub.includes(id)) return gagal("Pilihan sub-menu tidak dikenal. Muat ulang halaman.");
      sub.push(id);
    }
  }
  if (modul.length === 0) return gagal("Centang minimal satu menu untuk akun ini, atau pilih \"Ikuti peran\".");
  const modules: ModulAksesAkun = {};
  for (const id of ROLE_ACCESS_CATALOG.map(m => m.id).filter(m => modul.includes(m))) {
    const semua = selectableSubmenus(id).map(x => x.id);
    if (semua.length === 0 || !tampil.includes(id)) { modules[id] = null; continue; }
    const pilih = semua.filter(x => sub.includes(x));
    if (pilih.length === 0) return gagal(`Menu ${labelModul(id)} dicentang tetapi semua sub-menunya kosong. Centang minimal satu sub-menu, atau hapus centang menunya.`);
    modules[id] = pilih.length === semua.length ? null : pilih.sort();
  }
  return { ok: true, profileId, requestKey, mode, modules, reason: reason || null };
}

const PESAN_DB: Record<string, string> = {
  ACCOUNT_ACCESS_OWNER_REQUIRED: "Hanya pemilik (Owner) aktif yang boleh mengatur akses khusus akun.",
  ACCOUNT_ACCESS_TARGET_OWNER: "Akun OWNER selalu punya akses penuh, jadi tidak bisa diberi akses khusus.",
  ACCOUNT_ACCESS_TARGET_INVALID: "Akun tidak ditemukan. Muat ulang daftar pengguna.",
  ACCOUNT_ACCESS_MODULES_INVALID: "Pilihan menu tidak valid. Muat ulang halaman lalu centang lagi.",
  ACCOUNT_ACCESS_MODE_INVALID: "Pilih salah satu: Ikuti peran, Peran + tambahan, atau Hanya akses khusus.",
  ACCOUNT_ACCESS_REASON_INVALID: "Alasan maksimal 1000 huruf.",
  ACCOUNT_ACCESS_REQUEST_KEY_REUSED: "Formulir ini sudah dipakai untuk simpan sebelumnya. Muat ulang halaman lalu ulangi.",
};

/** Galat RPC → kalimat untuk Owner (tanpa istilah teknis / isi galat database). */
export function pesanGalatAksesAkun(error: { code?: string; message?: string } | null | undefined): string {
  const msg = String(error?.message ?? "");
  const kode = Object.keys(PESAN_DB).find(k => msg.includes(k));
  if (kode) return PESAN_DB[kode];
  if (error?.code === "PGRST202" || (error?.code === "42883" && msg.includes("save_account_access_override"))) {
    return "Fitur akses khusus belum aktif di database. Tidak ada yang disimpan; hubungi tim teknis.";
  }
  if (error?.code === "55P03" || /lock/i.test(msg)) return "Akun ini sedang diubah di tempat lain. Tunggu sebentar lalu simpan lagi.";
  return "Akses khusus belum tersimpan. Coba lagi sebentar lagi.";
}

export type RiwayatAksesAkun = { id: string; created_at: string; created_by_name: string | null; reason: string | null; before: AksesAkun | null; after: AksesAkun | null };
export type DataAksesAkun = {
  role: string;
  override: (AksesAkun & { updated_at: string | null; updated_by_name: string | null }) | null;
  history: RiwayatAksesAkun[];
};

/** Jawaban `get_account_access_override(p_profile_id)`. null = bentuk tidak dikenal (layar tidak menampilkan editor). */
export function parseDataAksesAkun(value: unknown, profileId: string): DataAksesAkun | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.profile_id !== profileId || typeof v.role !== "string" || !Array.isArray(v.history)) return null;
  let override: DataAksesAkun["override"] = null;
  if (v.override !== null && v.override !== undefined) {
    const o = v.override as Record<string, unknown>;
    const parsed = parseAksesAkun(o);
    if (!parsed) return null;
    override = { ...parsed, updated_at: typeof o.updated_at === "string" ? o.updated_at : null, updated_by_name: typeof o.updated_by_name === "string" ? o.updated_by_name : null };
  }
  const history: RiwayatAksesAkun[] = [];
  for (const h of v.history as unknown[]) {
    if (!h || typeof h !== "object") return null;
    const x = h as Record<string, unknown>;
    if (typeof x.id !== "string" || typeof x.created_at !== "string") return null;
    const before = parseAksesAkun(x.before), after = parseAksesAkun(x.after);
    history.push({ id: x.id, created_at: x.created_at, created_by_name: typeof x.created_by_name === "string" ? x.created_by_name : null,
      reason: typeof x.reason === "string" ? x.reason : null, before: before ?? null, after: after ?? null });
  }
  return { role: v.role, override, history };
}

/** Aturan peran (sesuai layar Akses Grup) dari konfigurasi peran yang dibaca Owner. */
export function aturanDariKonfigurasi(config: RoleAccessConfig): AturanTersimpan {
  return [{ role: config.role, module_id: ROLE_V2_MARKER }, ...config.modules.map(m => {
    const s = config.submenus?.[m];
    return s === undefined ? { role: config.role, module_id: m } : { role: config.role, module_id: m, submenus: [...s] };
  })];
}

/** Ringkasan menu yang bisa dibuka, untuk dibaca Owner: "Penjualan: Penjualan Online", "Klinik (semua)". */
export function ringkasAkses(role: string, rules: AturanTersimpan): string[] | "penuh" {
  if (role === "OWNER") return "penuh";
  const allow = modulDiizinkan(role, rules);
  if (allow === null) return "penuh";
  return ROLE_ACCESS_CATALOG.filter(m => allow.includes(m.id)).map(m => {
    const subs = rules.find(r => r.role === role && r.module_id === m.id)?.submenus;
    const total = selectableSubmenus(m.id).length;
    if (subs === undefined || total === 0) return total ? `${m.label} (semua)` : m.label;
    const ada = selectableSubmenus(m.id).filter(x => subs.includes(x.id));
    return ada.length <= 3 ? `${m.label}: ${ada.map(x => submenuLabel(x.id)).join(", ")}` : `${m.label}: ${ada.length} dari ${total} sub-menu`;
  });
}

export function ringkasAksesAkun(akses: AksesAkun | null): string {
  if (!akses) return LABEL_MODE.ikuti;
  const daftar = ringkasAkses("STAFF", terapkanAksesAkun("STAFF", [], { mode: "khusus", modules: akses.modules }));
  return `${LABEL_MODE[akses.mode]}: ${daftar === "penuh" ? "semua menu" : daftar.join("; ") || "tidak ada menu"}`;
}
