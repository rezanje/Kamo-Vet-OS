"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionRejection } from "@/components/LocalTransactionDraft";
import { roleRpcFailure } from "@/lib/role-action-access";
import { legacyRoleHasAction } from "@/lib/role-grant-only-actions";
import { SUBMENU_ENTRIES, selectableSubmenus, submenuById } from "@/lib/submenu-access";
import { editableRole, parseRoleAccessConfig, ROLE_ACCESS_CATALOG, roleAccessScope, validRequestKey, validRevision } from "@/lib/role-access-catalog";

const BASE = "/pengaturan/akses-grup";

const refuse = (message: string, outcome: "rejected" | "retry" = "rejected"): ActionRejection => ({ ok: false, outcome, message });
const UNCONFIRMED = "Hasil simpan belum terkonfirmasi. Draf dan kunci tetap tersedia; muat ulang pengaturan dan periksa kembali dengan permintaan yang sama.";

/**
 * Full atomic policy replacement; database remains authoritative for authorization and replay.
 * Deterministic refusals (nothing written) are RETURNED as structured Indonesian results because a thrown
 * server-action error is masked in production. Only genuinely unknown outcomes throw (= unconfirmed).
 */
export async function saveRoleSettings(role: string, revision: string, form: FormData): Promise<ActionRejection> {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return refuse("Sesi tidak tersedia. Muat ulang dan masuk kembali.");
  const { data: profile, error: profileError } = await client.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (profileError) return refuse("Status akun Anda belum dapat diperiksa. Tidak ada yang disimpan; coba lagi.", "retry");
  if (profile?.role !== "OWNER" || profile.is_active !== true) return refuse("Hanya pemilik aktif yang boleh mengubah hak akses.");
  const key = String(form.get("requestKey") ?? "");
  const scope = roleAccessScope(role, revision);
  if (!editableRole(role) || !validRevision(revision) || form.get("role") !== role || form.get("expected_revision") !== revision
    || form.get("draft_scope") !== scope || form.get("draft_key") !== key || !validRequestKey(key)) return refuse("Identitas draf atau revisi tidak cocok. Muat ulang pengaturan; draf lama tidak diterapkan.");
  const mode = String(form.get("mode") ?? "custom");
  const reason = String(form.get("reason") ?? "").trim();
  if (!["custom", "reset"].includes(mode) || reason.length < 3 || reason.length > 1000) return refuse("Isi alasan 3–1000 karakter dan pilih jenis penyimpanan.");
  if (mode === "reset" && form.get("confirm_reset") !== "on") return refuse("Konfirmasi reset SEMUA pengaturan menu, tindakan, cabang, dan akun terlebih dahulu.");
  const modules: string[] = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith("mod_")) continue;
    const id = name.slice(4);
    if (!ROLE_ACCESS_CATALOG.some(m => m.id === id) || value !== "on" || modules.includes(id)) return refuse("Pilihan menu tidak dikenal atau ganda. Muat ulang.");
    modules.push(id);
  }
  // A fresh server-side catalogue, never hidden client metadata. Do not compare its
  // revision here: the backend must decide stale vs exact-request replay atomically.
  let snapshot;
  try {
    const { data, error: readError } = await client.rpc("get_role_access_config", { p_role: role });
    snapshot = readError ? null : parseRoleAccessConfig(data, role);
  } catch { snapshot = null; }
  if (!snapshot) return refuse("Konfigurasi tindakan gagal dibaca. Tidak ada yang disimpan; draf dan kunci tetap tersedia. Muat ulang atau coba lagi.", "retry");
  const actions: string[] = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith("act_")) continue;
    const id = name.slice(4);
    if (value !== "on" || actions.includes(id) || !snapshot.action_catalog.some(a => a.id === id && a.enforced)) {
      return refuse("Pilihan tindakan tidak didukung atau ganda. Muat ulang; draf tetap tersedia.");
    }
    actions.push(id);
  }
  // Sub-menu: hanya untuk modul yang dicentang dan yang bagian sub-menunya memang ditampilkan (penanda `subs_<modul>`).
  // Pilihan penuh = tidak dibatasi (tidak disimpan); kosong = modul tidak bisa dibuka. Modul yang tidak ditampilkan
  // mempertahankan kebijakan tersimpannya; modul yang tidak dicentang dilepas kebijakannya.
  const checkedSub: string[] = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith("sub_")) continue;
    const id = name.slice(4);
    if (value !== "on" || checkedSub.includes(id) || !submenuById(id)) return refuse("Pilihan sub-menu tidak dikenal atau ganda. Muat ulang; draf tetap tersedia.");
    checkedSub.push(id);
  }
  const rendered: string[] = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith("subs_")) continue;
    const m = name.slice(5);
    if (value !== "1" || rendered.includes(m) || selectableSubmenus(m).length === 0) return refuse("Bagian sub-menu tidak dikenal atau ganda. Muat ulang; draf tetap tersedia.");
    rendered.push(m);
  }
  if (checkedSub.some(id => !rendered.includes(submenuById(id)!.module))) return refuse("Pilihan sub-menu tidak punya bagian modulnya. Muat ulang; draf tetap tersedia.");
  const savedSub = snapshot.submenus ?? {};
  const nextSub: Record<string, string[]> = {};
  for (const m of [...new Set(SUBMENU_ENTRIES.map(x => x.module))]) {
    if (!modules.includes(m)) continue;
    if (!rendered.includes(m)) { if (savedSub[m]) nextSub[m] = savedSub[m]; continue; }
    const all = selectableSubmenus(m).map(x => x.id);
    const chosen = all.filter(id => checkedSub.includes(id));
    if (chosen.length !== all.length) nextSub[m] = chosen.sort();
  }
  const sendSub = Object.keys(nextSub).length > 0 || Object.keys(savedSub).length > 0;
  // A role with NO saved action policy ("legacy") already allows every enforced action. The editor shows
  // those as checked; if the Owner left them exactly so, do not create a policy row at all, so a menu-only
  // save can never turn the implicit allow-all into an explicit (or empty) list.
  // Izin khusus (grant-only) bawaannya mati untuk peran legacy: tidak ikut dihitung sebagai "semua dicentang".
  const enforced = snapshot.action_catalog.filter(a => a.enforced && legacyRoleHasAction(a.id, role)).map(a => a.id);
  const untouchedLegacy = snapshot.actions.source === "legacy" && actions.length === enforced.length && enforced.every(id => actions.includes(id));
  const { data: result, error } = await client.rpc("save_role_access_config", {
    p_role: role, p_expected_revision: revision, p_request_key: key, p_mode: mode,
    p_modules: mode === "reset" ? [] : modules,
    p_capabilities: mode === "reset" ? null : { all_branches: form.get("all_branches") === "on", create_accounts: form.get("create_accounts") === "on" },
    p_reason: reason, p_actions: mode === "reset" || untouchedLegacy ? null : actions,
    ...(mode !== "reset" && sendSub ? { p_submenus: nextSub } : {}),
  });
  if (error) {
    const known = roleRpcFailure(error);
    if (known) return refuse(known.message, known.outcome);
    throw new Error(UNCONFIRMED);
  }
  if (!result || Array.isArray(result) || result.role !== role || result.request_key !== key || !validRevision(result.revision)
    || !validRequestKey(result.audit_id) || typeof result.already_applied !== "boolean"
    || (!result.already_applied && result.revision === revision)) throw new Error(UNCONFIRMED);
  revalidatePath("/", "layout");
  const params = new URLSearchParams({ peran: role, success: result.already_applied
    ? "Permintaan sebelumnya sudah tercatat. Tampilan dimuat ulang dari konfigurasi terkini, bukan hasil lama."
    : mode === "reset" ? "Semua pengaturan menu, tindakan, cabang, dan akun dikembalikan ke bawaan." : `Hak buka menu, tindakan, dan cabang/akun ${role} tersimpan.`, draft_scope: scope, draft_done: key });
  redirect(`${BASE}?${params}`);
}

// Legacy forms did not carry a complete configuration or revision. Never guess/merge
// their partial payload into an atomic full replacement; force the new editor.
async function reloadLegacy(): Promise<never> { redirect(`${BASE}?error=${encodeURIComponent("Formulir lama tidak lagi didukung. Muat ulang dan simpan seluruh pengaturan dengan revisi terbaru.")}`); }
export async function simpanAksesPeran(form: FormData) { void form; return reloadLegacy(); }
export async function kembalikanBawaan(form: FormData) { void form; return reloadLegacy(); }
export async function mulaiAturSendiri(form: FormData) { void form; return reloadLegacy(); }
export async function simpanKemampuanPeran(form: FormData) { void form; return reloadLegacy(); }
