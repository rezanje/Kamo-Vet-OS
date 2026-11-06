import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SEMUA_PERAN } from "@/lib/akses";
import { submenuSummary } from "@/lib/submenu-access";
import { editableRole, parseRoleAccessConfig, ROLE_ACCESS_CATALOG } from "@/lib/role-access-catalog";

import { NewRoleSettingsForm } from "./newRoleSettingsForm";

export default async function AksesGrupPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string; peran?: string }> }) {
  const sp = await searchParams;
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  const { data: profile, error: profileError } = user
    ? await client.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle()
    : { data: null, error: null };
  const active = !authError && !profileError && profile?.is_active === true;
  const owner = active && profile?.role === "OWNER";
  const role = sp.peran && editableRole(sp.peran) ? sp.peran : "ADMIN";
  const snapshots = await Promise.all(SEMUA_PERAN.map(async r => {
    if (!active || r === "OWNER") return { role: r, config: null };
    try {
      const { data, error } = await client.rpc("get_role_access_config", { p_role: r });
      return { role: r, config: error ? null : parseRoleAccessConfig(data, r) };
    } catch { return { role: r, config: null }; }
  }));
  const config = snapshots.find(s => s.role === role)?.config;
  return <MasterPage back="/pengaturan" icon="ti-shield-lock" title="AKSES GRUP" desc="Hak buka menu dan kemampuan cabang/akun per peran" error={sp.error} success={sp.success} successMsg={sp.success ?? "Tersimpan."} bolehKelola={owner} readOnlyNote="Hanya pemilik aktif yang dapat menyimpan. Peran lain hanya melihat konfigurasi yang tersedia.">

    <section className="crm-sec"><h2>Ringkasan peran</h2>
      <p>Perubahan berlaku untuk semua pengguna dengan peran terkait. Jumlah pengguna tidak ditampilkan karena visibilitas akun dapat dibatasi. OWNER selalu penuh dan tidak dapat mengunci dirinya sendiri.</p>
      <table className="tbl"><thead><tr><th>Peran</th><th>Menu</th><th>Sub-menu</th><th>Sumber</th></tr></thead><tbody>{snapshots.map(s => <tr key={s.role}><td>{s.role}</td><td>{s.role === "OWNER" ? "Selalu penuh" : s.config ? `${s.config.modules.length}/${ROLE_ACCESS_CATALOG.length}` : "tidak diketahui"}</td><td>{s.role === "OWNER" ? "Selalu penuh" : s.config ? (Object.keys(s.config.submenus ?? {}).length ? Object.entries(s.config.submenus ?? {}).map(([m, ids]) => { const x = submenuSummary(m, ids); return `${ROLE_ACCESS_CATALOG.find(c => c.id === m)?.label ?? m}: ${x.allowed} dari ${x.total} sub-menu`; }).join("; ") : "Semua sub-menu") : "tidak diketahui"}</td><td>{s.config?.source ?? "tidak diketahui"}</td></tr>)}</tbody></table>
    </section>
    <section className="crm-sec"><form method="get"><label>Peran <select name="peran" defaultValue={role}>{SEMUA_PERAN.filter(editableRole).map(r => <option key={r}>{r}</option>)}</select></label><button type="submit" className="btn-def">Lihat</button></form>
      {!config || !user ? <div role="alert">Konfigurasi tidak diketahui atau gagal dibaca. Penyimpanan dinonaktifkan; muat ulang. Tidak ada izin kosong/bawaan yang diasumsikan.</div>
        : <><p>Sumber: {config.source} · Revisi: <code>{config.revision}</code></p><NewRoleSettingsForm key={`${user.id}:${role}:${config.revision}`} userId={user.id} config={config} canEdit={owner} />
          {owner && <section aria-label="Riwayat perubahan"><h3>Riwayat perubahan</h3>{config.audit.length ? <ul>{config.audit.map(a => <li key={a.id}>{a.created_at} · {a.created_by} · {a.reason}<details><summary>Sebelum / sesudah</summary><pre>{JSON.stringify({before:a.before,after:a.after},null,2)}</pre></details></li>)}</ul> : <p>Belum ada riwayat yang tersedia.</p>}</section>}</>}
    </section>
  </MasterPage>;
}
