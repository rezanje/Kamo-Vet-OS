// Membaca kebijakan sub-menu peran yang sedang login lewat RPC (tabel privat, tidak bisa dibaca langsung).
import { gabungSubmenu, parseSubmenuPolicyRows, type SubmenuPolicyRow } from "./submenu-access";

export const SUBMENU_POLICY_RPC = "get_my_submenu_policy";

export type SubmenuPolicyLoad =
  | { status: "ok"; rows: SubmenuPolicyRow[] }
  | { status: "absent"; rows: [] } // fungsi belum ada di database (aplikasi lebih dulu rilis): perilaku lama
  | { status: "error"; rows: [] }; // tidak bisa dipastikan: pemanggil wajib gagal tertutup

type RpcClient = { rpc(name: string): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

/** Jangan lempar galat: hasilnya selalu salah satu dari tiga status di atas. */
export async function loadSubmenuPolicy(client: RpcClient): Promise<SubmenuPolicyLoad> {
  try {
    const { data, error } = await client.rpc(SUBMENU_POLICY_RPC);
    if (error) {
      const missing = error.code === "PGRST202" || error.code === "42883"
        || /could not find the function|function .* does not exist/i.test(error.message ?? "");
      return missing ? { status: "absent", rows: [] } : { status: "error", rows: [] };
    }
    if (data === null || data === undefined) return { status: "ok", rows: [] };
    const rows = parseSubmenuPolicyRows(data);
    return rows ? { status: "ok", rows } : { status: "error", rows: [] };
  } catch {
    return { status: "error", rows: [] };
  }
}

/** Untuk pemakai yang hanya menampilkan/menyaring tautan: gagal baca => aturan apa adanya (penegakan ada di middleware). */
export async function rulesWithSubmenu<T extends { role: string; module_id: string }>(client: RpcClient, rules: T[]): Promise<(T & { submenus?: string[] })[]> {
  const loaded = await loadSubmenuPolicy(client);
  return gabungSubmenu(rules, loaded.rows);
}
