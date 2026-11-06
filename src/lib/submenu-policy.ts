// Membaca kebijakan sub-menu peran yang sedang login lewat RPC (tabel privat, tidak bisa dibaca langsung).
import { gabungSubmenu, parseSubmenuPolicyRows, type SubmenuPolicyRow } from "./submenu-access";

export const SUBMENU_POLICY_RPC = "get_my_submenu_policy";

export type SubmenuPolicyLoad =
  | { status: "ok"; rows: SubmenuPolicyRow[] }
  | { status: "absent"; rows: [] } // fungsi belum ada di database (aplikasi lebih dulu rilis): perilaku lama
  | { status: "error"; rows: [] }; // tidak bisa dipastikan: pemanggil wajib gagal tertutup

type RpcClient = { rpc(name: string): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

/**
 * "Fungsi belum ada di database" HANYA bila galatnya menyebut persis fungsi baru ini:
 *  - PostgREST PGRST202 "Could not find the function public.get_my_submenu_policy ... in the schema cache", atau
 *  - Postgres 42883 "function public.get_my_submenu_policy(...) does not exist".
 * 42883 yang muncul dari DALAM badan fungsi lain ("function public.foo(text) does not exist", "operator does not exist")
 * atau galat lain apa pun BUKAN "belum ada": itu galat (pemanggil gagal tertutup), kalau tidak peran terbatas
 * kembali memegang akses penuh.
 */
const NAMA_FUNGSI = new RegExp(`(^|[^a-z0-9_])(public\\.)?${SUBMENU_POLICY_RPC}([^a-z0-9_]|$)`, "i");
export function isPolicyFunctionMissing(error: { code?: string; message?: string }): boolean {
  if (error.code !== "PGRST202" && error.code !== "42883") return false;
  return NAMA_FUNGSI.test(error.message ?? "");
}

/** Jangan lempar galat: hasilnya selalu salah satu dari tiga status di atas. */
export async function loadSubmenuPolicy(client: RpcClient): Promise<SubmenuPolicyLoad> {
  try {
    const { data, error } = await client.rpc(SUBMENU_POLICY_RPC);
    if (error) return isPolicyFunctionMissing(error) ? { status: "absent", rows: [] } : { status: "error", rows: [] };
    if (data === null || data === undefined) return { status: "ok", rows: [] };
    const rows = parseSubmenuPolicyRows(data);
    return rows ? { status: "ok", rows } : { status: "error", rows: [] };
  } catch {
    return { status: "error", rows: [] };
  }
}

/**
 * HANYA untuk tampilan murni (tautan/ubin/katalog): gagal baca => aturan apa adanya, tanpa batas sub-menu.
 * JANGAN dipakai sebagai gerbang otorisasi. Middleware menegakkan sub-menu untuk halaman (app), tetapi
 * middleware MELEWATI semua /api (isInternal): setiap route handler /api yang perlu sub-menu harus memakai
 * `loadSubmenuPolicy` sendiri dan gagal tertutup bila status "error" (lihat /api/cari).
 */
export async function rulesWithSubmenu<T extends { role: string; module_id: string }>(client: RpcClient, rules: T[]): Promise<(T & { submenus?: string[] })[]> {
  const loaded = await loadSubmenuPolicy(client);
  return gabungSubmenu(rules, loaded.rows);
}
