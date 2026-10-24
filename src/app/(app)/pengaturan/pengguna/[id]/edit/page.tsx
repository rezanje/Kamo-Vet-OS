import { randomUUID } from "node:crypto";
import Link from "next/link";
import { SecHeader } from "@/components/SecHeader";
import { assertMasterAdmin } from "@/lib/master-guard";
import { allowedBranchIds } from "@/lib/branch-access";
import { readCompleteList } from "@/lib/checked-list";
import { isAccountEditId, isUserAccountEditSnapshot, type UserAccountEditBranch, type UserAccountEditSnapshot } from "@/lib/user-account-edit";
import { UserAccountEditForm } from "./UserAccountEditForm";

const BACK = "/pengaturan/pengguna";
const back = <Link href={BACK} className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke daftar pengguna</Link>;
type Client = Awaited<ReturnType<typeof assertMasterAdmin>>;
type Audit = { id: string; actor_id: string; created_at: string; old_role: string; new_role: string; old_branch_ids: string[]; new_branch_ids: string[]; name_changed: boolean };

async function branchOptions(client: Client, actorId: string, snapshot: UserAccountEditSnapshot) {
  const allowed = await allowedBranchIds(client, actorId);
  const active = await readCompleteList<UserAccountEditBranch>((from, to) => {
    let query = client.from("branches").select("id, name, is_active", { count: "exact" }).eq("is_active", true);
    if (allowed !== null) query = query.in("id", allowed);
    return query.order("name").order("id").range(from, to);
  }, "Pilihan cabang akun", { maxRows: null });
  const missing = snapshot.branch_ids.filter((id) => !active.some((branch) => branch.id === id));
  for (let offset = 0; offset < missing.length; offset += 200) {
    const ids = missing.slice(offset, offset + 200);
    const old = await readCompleteList<UserAccountEditBranch>((from, to) => client.from("branches")
      .select("id, name, is_active", { count: "exact" }).in("id", ids).order("id").range(from, to), "Penugasan cabang lama", { maxRows: null });
    for (const id of ids) {
      const row = old.find((branch) => branch.id === id);
      active.push(row ? { ...row, legacy: true } : { id, name: `Cabang lama tidak tersedia · ${id}`, is_active: false, legacy: true });
    }
  }
  return active;
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
  try {
    const { data: { user } } = await client.auth.getUser();
    if (user) branches = await branchOptions(client, user.id, snapshot);
  } catch { /* A partial or unavailable catalog must not produce an editor. */ }
  if (!branches) return <>{back}<p role="alert">Pilihan cabang akun belum dapat dimuat lengkap. Muat ulang sebelum mengedit; perubahan belum disimpan.</p></>;
  const edits = await history(client, id);
  const branchNames = (ids: string[]) => ids.map((branchId) => branches.find((branch) => branch.id === branchId)?.name ?? `Cabang tidak tersedia · ${branchId}`).join(", ") || "Tanpa penugasan";
  return <>
    <div style={{ marginBottom: 12 }}>{back}</div>
    <SecHeader num="01" title="EDIT AKUN PENGGUNA" desc="Perbarui nama akun, role, dan penugasan cabang akun login." />
    <UserAccountEditForm key={`${id}:${snapshot.version}`} snapshot={snapshot} branches={branches} requestId={randomUUID()} />
    <section className="crm-sec">
      <SecHeader num="02" title="RIWAYAT PERUBAHAN AKUN" desc="10 perubahan terakhir: pelaku, waktu, role, penugasan cabang, dan penanda perubahan nama. Isi nama lama/baru tidak disalin ke riwayat ini." />
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
