import { randomUUID } from "node:crypto";
import { branchDisplayName } from "@/lib/branch-display";
import Link from "next/link";
import { SecHeader } from "@/components/SecHeader";
import { assertMasterAdmin } from "@/lib/master-guard";
import { allowedBranchIds } from "@/lib/branch-access";
import { readCompleteList } from "@/lib/checked-list";
import { isAccountEditId, isUserAccountEditSnapshot, type UserAccountEditBranch, type UserAccountEditSnapshot } from "@/lib/user-account-edit";
import { UserAccountEditForm } from "./UserAccountEditForm";
import { ResetLoginForm } from "./ResetLoginForm";
import { AksesKhususForm } from "./AksesKhususForm";
import { aturanDariKonfigurasi, parseDataAksesAkun, ringkasAkses, ringkasAksesAkun, type DataAksesAkun } from "@/lib/akses-akun-form";
import { terapkanAksesAkun } from "@/lib/akses-akun";
import { editableRole, parseRoleAccessConfig } from "@/lib/role-access-catalog";

const BACK = "/pengaturan/pengguna";
const back = <Link href={BACK} className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke daftar pengguna</Link>;
type Client = Awaited<ReturnType<typeof assertMasterAdmin>>;
type Audit = { id: string; actor_id: string; created_at: string; old_role: string; new_role: string; old_branch_ids: string[]; new_branch_ids: string[]; name_changed: boolean };

async function branchOptions(client: Client, actorId: string, snapshot: UserAccountEditSnapshot) {
  const allowed = await allowedBranchIds(client, actorId);
  const active = await readCompleteList<UserAccountEditBranch>((from, to) => {
    let query = client.from("branches").select("id, code, name, type, is_active", { count: "exact" }).eq("is_active", true);
    if (allowed !== null) query = query.in("id", allowed);
    return query.order("name").order("id").range(from, to);
  }, "Pilihan cabang akun", { maxRows: null });
  const missing = snapshot.branch_ids.filter((id) => !active.some((branch) => branch.id === id));
  for (let offset = 0; offset < missing.length; offset += 200) {
    const ids = missing.slice(offset, offset + 200);
    const old = await readCompleteList<UserAccountEditBranch>((from, to) => client.from("branches")
      .select("id, code, name, type, is_active", { count: "exact" }).in("id", ids).order("id").range(from, to), "Penugasan cabang lama", { maxRows: null });
    for (const id of ids) {
      const row = old.find((branch) => branch.id === id);
      active.push(row ? { ...row, legacy: true } : { id, name: `Cabang lama tidak tersedia · ${id}`, is_active: false, legacy: true });
    }
  }
  return active.map(branch => ({ ...branch, name: branchDisplayName(branch, active) }));
}

async function history(client: Client, profileId: string): Promise<Audit[] | null> {
  try {
    const { data, error } = await client.from("user_account_edits")
      .select("id, actor_id, created_at, old_role, new_role, old_branch_ids, new_branch_ids, name_changed")
      .eq("profile_id", profileId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(10);
    if (error || !Array.isArray(data)) return null;
    return data as Audit[];
  } catch { return null; }
}

// E3 (meeting 12 Nov 2026): data "Akses khusus akun ini" — hanya dibaca untuk Owner aktif.
type AksesKhusus = { status: "ok"; data: DataAksesAkun; peran: string[] | "penuh" | null; efektif: string[] | "penuh" | null } | { status: "absent" } | { status: "error" };
async function aksesKhusus(client: Client, profileId: string, role: string): Promise<AksesKhusus> {
  try {
    const [akun, peran] = await Promise.all([
      client.rpc("get_account_access_override", { p_profile_id: profileId }),
      editableRole(role) ? client.rpc("get_role_access_config", { p_role: role }) : Promise.resolve({ data: null, error: null }),
    ]);
    if (akun.error) return akun.error.code === "PGRST202" ? { status: "absent" } : { status: "error" };
    const data = parseDataAksesAkun(akun.data, profileId);
    if (!data) return { status: "error" };
    const config = peran.error ? null : parseRoleAccessConfig(peran.data, role);
    const aturan = config ? aturanDariKonfigurasi(config) : null;
    return { status: "ok", data, peran: aturan ? ringkasAkses(role, aturan) : null, efektif: aturan ? ringkasAkses(role, terapkanAksesAkun(role, aturan, data.override)) : null };
  } catch { return { status: "error" }; }
}
const daftar = (x: string[] | "penuh" | null) => x === null ? "belum dapat dimuat" : x === "penuh" ? "semua menu" : x.join("; ") || "tidak ada menu";

export default async function EditPenggunaPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await assertMasterAdmin(BACK, "akun karyawan");
  const { id } = await params;
  if (!isAccountEditId(id)) return <>{back}<p role="alert">Akun tidak ditemukan atau tidak dapat diakses.</p></>;
  let snapshot: UserAccountEditSnapshot | null = null;
  try {
    const { data, error } = await client.rpc("get_user_account_for_edit", { p_profile_id: id });
    if (!error && isUserAccountEditSnapshot(data, id)) snapshot = data;
  } catch { /* Read failures must not produce an empty edit form. */ }
  if (!snapshot) return <>{back}<p role="alert">Akun tidak ditemukan, tidak dapat diakses, atau belum dapat dimuat. Kembali ke daftar atau muat ulang sebelum mengedit.</p></>;
  let branches: UserAccountEditBranch[] | null = null;
  let superAdmin = false;
  try {
    const { data: { user } } = await client.auth.getUser();
    if (user) {
      branches = await branchOptions(client, user.id, snapshot);
      const { data: actor } = await client.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
      superAdmin = actor?.role === "OWNER" && actor.is_active === true;
    }
  } catch { /* A partial or unavailable catalog must not produce an editor. */ }
  // U13: email login hanya terbaca oleh Super Admin (fungsi database menolak role lain).
  let emailLogin: string | null = null;
  let emailGagal = false;
  if (superAdmin) {
    try {
      const { data, error } = await client.rpc("get_user_login_email", { p_profile_id: id });
      if (error) emailGagal = true; else emailLogin = typeof data === "string" ? data : null;
    } catch { emailGagal = true; }
  }
  if (!branches) return <>{back}<p role="alert">Pilihan cabang akun belum dapat dimuat lengkap. Muat ulang sebelum mengedit; perubahan belum disimpan.</p></>;
  const edits = await history(client, id);
  const akses = superAdmin && snapshot.role !== "OWNER" ? await aksesKhusus(client, id, snapshot.role) : null;
  const branchNames = (ids: string[]) => ids.map((branchId) => branches.find((branch) => branch.id === branchId)?.name ?? `Cabang tidak tersedia · ${branchId}`).join(", ") || "Tanpa penugasan";
  return <>
    <div style={{ marginBottom: 12 }}>{back}</div>
    <SecHeader num="01" title="EDIT AKUN PENGGUNA" desc="Perbarui nama akun, role, dan penugasan cabang akun login." />
    <UserAccountEditForm key={`${id}:${snapshot.version}`} snapshot={snapshot} branches={branches} requestId={randomUUID()} />
    {superAdmin && <section>
      <SecHeader num="02" title="RESET LOGIN (SUPER ADMIN)" desc="Ganti email login dan/atau atur password baru untuk karyawan yang lupa password atau ganti email. Riwayat mencatat pelaku dan waktu, tanpa menyimpan password." />
      {emailGagal
        ? <p role="alert">Data login belum dapat dimuat. Muat ulang halaman sebelum mereset.</p>
        : <ResetLoginForm profileId={id} emailSekarang={emailLogin} />}
    </section>}
    {superAdmin && <section data-akses-khusus-section>
      <SecHeader num="03" title="AKSES KHUSUS AKUN INI" desc="Atur menu yang bisa dibuka akun ini tanpa mengubah perannya: ikuti peran, tambah menu, atau hanya menu tertentu (mis. hanya Penjualan Online). Hanya Owner yang bisa mengatur; setiap perubahan tercatat." />
      {snapshot.role === "OWNER" ? <p role="note">Akun OWNER selalu punya akses penuh, jadi tidak bisa diberi akses khusus.</p>
        : !akses || akses.status === "error" ? <p role="alert">Akses khusus akun ini belum dapat dimuat. Muat ulang halaman sebelum mengubahnya.</p>
        : akses.status === "absent" ? <p role="note">Fitur akses khusus akun belum aktif di database. Akun ini mengikuti akses perannya.</p>
        : <>
          <div className="crm-sec" style={{ fontSize: 12 }}>
            <div>Pengaturan sekarang: <b>{ringkasAksesAkun(akses.data.override)}</b></div>
            <div>Akses peran {snapshot.role}: {daftar(akses.peran)}</div>
            <div>Akses efektif akun ini: <b>{daftar(akses.efektif)}</b> (ditambah Dashboard Pribadi)</div>
            {akses.data.override && <div style={{ color: "var(--tm)" }}>Terakhir diubah {akses.data.override.updated_at ? new Date(akses.data.override.updated_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB" : "—"} oleh {akses.data.override.updated_by_name ?? "—"}</div>}
          </div>
          <AksesKhususForm key={`${id}:${akses.data.override?.updated_at ?? "ikuti"}:${akses.data.history[0]?.id ?? ""}`} profileId={id} role={snapshot.role} requestKey={randomUUID()} current={akses.data.override} />
          <details className="crm-sec"><summary>Riwayat akses khusus ({akses.data.history.length})</summary>
            {akses.data.history.length === 0 ? <p>Belum ada perubahan akses khusus untuk akun ini.</p> : <table className="tbl"><thead><tr><th>Waktu</th><th>Oleh</th><th>Sebelum</th><th>Sesudah</th><th>Alasan</th></tr></thead><tbody>
              {akses.data.history.map(h => <tr key={h.id}>
                <td>{new Date(h.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</td>
                <td>{h.created_by_name ?? "—"}</td>
                <td style={{ fontSize: 11 }}>{ringkasAksesAkun(h.before)}</td>
                <td style={{ fontSize: 11 }}>{ringkasAksesAkun(h.after)}</td>
                <td style={{ fontSize: 11 }}>{h.reason ?? "—"}</td>
              </tr>)}
            </tbody></table>}
          </details>
        </>}
    </section>}
    <section className="crm-sec">
      <SecHeader num={superAdmin ? "04" : "02"} title="RIWAYAT PERUBAHAN AKUN" desc="10 perubahan terakhir: pelaku, waktu, role, penugasan cabang, dan penanda perubahan nama. Isi nama lama/baru tidak disalin ke riwayat ini." />
      {edits === null ? <p role="alert">Riwayat perubahan belum dapat dimuat. Muat ulang untuk memeriksa riwayat.</p> : edits.length === 0 ? <p>Belum ada perubahan akun melalui fitur edit ini.</p> : <div style={{ overflowX: "auto" }}>
        <table className="tbl"><thead><tr><th>Waktu</th><th>Pelaku</th><th>Nama akun</th><th>Role</th><th>Cabang</th></tr></thead><tbody>
          {edits.map((edit) => <tr key={edit.id}>
            <td>{new Date(edit.created_at).toLocaleString("id-ID", { timeZone: "UTC" })} UTC</td>
            <td style={{ fontSize: 11 }}>{edit.actor_id}</td>
            <td>{edit.name_changed ? "Diubah" : "Tetap"}</td>
            <td>{edit.old_role} → {edit.new_role}</td>
            <td style={{ fontSize: 11 }}>{branchNames(edit.old_branch_ids)} → {branchNames(edit.new_branch_ids)}</td>
          </tr>)}
        </tbody></table>
      </div>}
    </section>
  </>;
}
