/** A deterministic, user-presentable result. `rejected` = nothing was written and retrying unchanged will not help;
 * `retry` = nothing was written and the same request is safe to repeat shortly. Anything not
 * recognised is NOT one of these (unknown/unconfirmed) and must never be mapped here. */
export type RoleActionFailure = { ok: false; outcome: "rejected" | "retry"; code: string; message: string };

const RETRY = "Sistem sedang memproses perubahan akun atau hak akses lain. Tidak ada perubahan yang tersimpan. Tunggu beberapa detik lalu coba lagi.";
const REJECTIONS: [RegExp, string, string][] = [
  [/ROLE_REVISION_CONFLICT/, "ROLE_REVISION_CONFLICT", "Pengaturan akses peran ini sudah berubah sejak halaman dibuka. Tidak ada perubahan yang tersimpan. Muat ulang halaman untuk melihat pengaturan terbaru, lalu terapkan ulang perubahan Anda."],
  [/ROLE_OWNER_REQUIRED/, "ROLE_OWNER_REQUIRED", "Hanya pemilik (OWNER) aktif yang boleh mengubah hak akses. Tidak ada perubahan yang tersimpan."],
  [/ROLE_REQUEST_KEY_REUSED/, "ROLE_REQUEST_KEY_REUSED", "Kunci permintaan ini sudah dipakai untuk isian yang berbeda. Tidak ada perubahan yang tersimpan. Muat ulang halaman lalu simpan lagi."],
  [/ROLE_(INPUT|ACTION|RESET|SCOPE)_INVALID/, "ROLE_INPUT_INVALID", "Isian pengaturan tidak valid atau tidak didukung. Tidak ada perubahan yang tersimpan. Muat ulang halaman lalu coba lagi."],
  [/ROLE_ACTION_DENIED/, "ROLE_ACTION_DENIED", "Tindakan ini tidak diizinkan untuk peran Anda. Tidak ada yang disimpan. Minta pemilik membukanya di Pengaturan › Akses Grup."],
  [/BANK_SCOPE_DENIED/, "BANK_SCOPE_DENIED", "Rekening atau cabang ini di luar cakupan akses peran Anda (menu Kas & Bank, akses semua cabang, atau cabang rekening). Tidak ada yang disimpan."],
  [/EMPLOYEE_SCOPE_DENIED/, "EMPLOYEE_SCOPE_DENIED", "Karyawan atau cabang ini di luar cakupan akses peran Anda. Tidak ada yang disimpan."],
  [/ACCOUNT_EDIT_DENIED|PEOPLE_ACCOUNT_RPC_REQUIRED/, "ACCOUNT_EDIT_DENIED", "Perubahan akun ini tidak diizinkan untuk peran Anda atau akun target di luar cakupan Anda. Tidak ada yang disimpan."],
];
const RETRY_CODES = new Set(["55P03", "40P01", "57014", "40001"]);

/** Classify a Supabase/PostgREST error from the role/people/bank RPC family. Returns null for anything unknown. */
export function roleRpcFailure(error: unknown): RoleActionFailure | null {
  if (!error || typeof error !== "object") return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const text = typeof message === "string" ? message : "";
  const sqlstate = typeof code === "string" ? code : "";
  // 40001 is also used for edit/link conflicts that other callers report differently.
  if (/ACCOUNT_EDIT_CONFLICT|PEOPLE_ACCOUNT_LINK_CHANGED/.test(text)) return null;
  if (/PEOPLE_ACCOUNT_BUSY|ROLE_RETRY_READ_COMMITTED/.test(text) || RETRY_CODES.has(sqlstate)) {
    return { ok: false, outcome: "retry", code: sqlstate || "RETRY", message: RETRY };
  }
  for (const [pattern, id, userMessage] of REJECTIONS) if (pattern.test(text)) return { ok: false, outcome: "rejected", code: id, message: userMessage };
  return null;
}

const UNCHECKED = "Hak akses belum dapat diperiksa. Tidak ada yang disimpan. Coba lagi sebentar lagi.";
type PolicyClient = { rpc(name: "role_action_allowed", args: { p_action: string }): PromiseLike<{ data: unknown; error: unknown }> };
/** Authoritative pre-write fence. Resolves null ONLY for an error-free `true`; otherwise a deterministic
 * Indonesian failure. Never throws (a thrown server-action error is masked in production). */
export async function roleActionRefusal(client: PolicyClient, action: string): Promise<RoleActionFailure | null> {
  let result: { data: unknown; error: unknown } | null;
  try { result = await client.rpc("role_action_allowed", { p_action: action }); } catch { result = null; }
  if (result && result.error === null && result.data === true) return null;
  if (result && result.error === null && result.data === false) return roleRpcFailure({ message: "ROLE_ACTION_DENIED" });
  return (result ? roleRpcFailure(result.error) : null)
    ?? { ok: false, outcome: "retry", code: "ROLE_ACTION_UNCHECKED", message: UNCHECKED };
}

export class RoleActionError extends Error {
  constructor(readonly failure: RoleActionFailure) { super(failure.message); }
}
/** Additional policy fence only: never replaces intrinsic role, branch or state checks.
 * Throwing variant for non-UI callers; server actions use roleActionRefusal and redirect/return. */
export async function requireRoleAction(client: PolicyClient, action: string): Promise<void> {
  const refusal = await roleActionRefusal(client, action);
  if (refusal) throw new RoleActionError(refusal);
}
