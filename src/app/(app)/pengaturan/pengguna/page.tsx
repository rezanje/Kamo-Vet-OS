import { roleCapabilities, type RoleCapabilities } from "@/lib/role-capabilities";
import { branchDisplayName } from "@/lib/branch-display";
import { allowedBranchIds } from "@/lib/branch-access";
import Link from "next/link";
import { SecHeader } from "@/components/SecHeader";
import { assertAccountCreator } from "@/lib/master-guard";
import { buatPengguna, togglePengguna, tautkanPengguna } from "./actions";

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
};

type UB = { user_id: string; branches: { code: string; name: string; type: string } | null };
type Emp = { nik: string | null; status: string; id: string; nama: string; jabatan: string | null; profile_id: string | null };

const ROLE_BADGE: Record<string, string> = { OWNER: "r", ADMIN: "b", FINANCE: "o", DOCTOR: "g", STAFF: "x" };

export default async function PenggunaPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await assertAccountCreator("/mulai");

  const { data: { user } } = await supabase.auth.getUser();
  const { data: actor } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  const canManage = ["OWNER", "ADMIN"].includes(actor?.role ?? "");
  const allowed = await allowedBranchIds(supabase, user!.id);
  const [{ data: profiles }, { data: ubs }, { data: branches }, { data: employees }, { data: capabilityRows }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, is_active").order("full_name"),
    supabase.from("user_branches").select("user_id, branches(code,name,type)"),
    supabase.from("branches").select("id, code, name, type, is_active").eq("is_active", true).order("name"),
    supabase.from("employees").select("id, nik, nama, jabatan, profile_id, status").order("nama"),
    supabase.from("role_capabilities").select("role, all_branches, create_accounts"),
  ]);

  const capabilityMap = new Map((capabilityRows ?? []).map((r: RoleCapabilities & { role: string }) => [r.role, r]));
  const branchCatalog = branches ?? [];
  const rows = (profiles ?? []) as unknown as ProfileRow[];
  const ubMap = new Map<string, string[]>();
  for (const u of (ubs ?? []) as unknown as UB[]) {
    const arr = ubMap.get(u.user_id) ?? [];
    if (u.branches?.name) arr.push(branchDisplayName(u.branches, branchCatalog));
    ubMap.set(u.user_id, arr);
  }
  const emps = (employees ?? []) as unknown as Emp[];
  const empByProfile = new Map(emps.filter((e) => e.profile_id).map((e) => [e.profile_id as string, `${e.nama} · ${e.nik ?? e.id}`]));
  const empBebas = emps.filter((e) => !e.profile_id && e.status === "Aktif");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pengaturan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Manajemen Pengguna</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="01" title="DAFTAR PENGGUNA" desc="Semua akun login VetOS beserta role, cabang, dan status." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Role</th>
                <th>Cabang</th>
                <th>Karyawan HRIS</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} style={!p.is_active ? { opacity: 0.55 } : undefined}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{p.full_name ?? "—"}</td>
                  <td><span className={`bge ${ROLE_BADGE[p.role] ?? "x"}`}>{p.role}</span></td>
                  <td style={{ fontSize: 11 }}>{roleCapabilities(p.role, capabilityMap.get(p.role)).all_branches ? "Semua cabang" : (ubMap.get(p.id) ?? []).join(", ") || "Belum ada akses cabang"}</td>
                  <td style={{ fontSize: 11 }}>{empByProfile.has(p.id) ? empByProfile.get(p.id) : canManage ? <form action={tautkanPengguna}>
                    <input type="hidden" name="profile_id" value={p.id} />
                    <label className="flab" htmlFor={`employee-${p.id}`}>Belum tertaut HRIS</label>
                    <select id={`employee-${p.id}`} className="fi" name="employee_id" required defaultValue="">
                      <option value="" disabled>Pilih karyawan</option>
                      {empBebas.map(e => <option key={e.id} value={e.id}>{e.nik ?? e.id} · {e.nama}</option>)}
                    </select>
                    <button className="btn-def" type="submit">Tautkan akun</button>
                  </form> : "Belum tertaut HRIS"}</td>
                  <td><span className={`bge ${p.is_active ? "g" : "r"}`}>{p.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  <td>
                    {canManage && (actor?.role === "OWNER" || p.id === user?.id || !["OWNER", "ADMIN"].includes(p.role)) && (
                      <Link href={`/pengaturan/pengguna/${p.id}/edit`} className="btn-def" style={{ display: "inline-block", padding: "4px 10px", fontSize: 10.5, marginBottom: 6 }}>Edit</Link>
                    )}
                    {canManage && <form action={togglePengguna}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="aktif" value={p.is_active ? "0" : "1"} />
                      <button type="submit" className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5, color: p.is_active ? "#b91c1c" : "#15803d" }}>
                        {p.is_active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </form>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form action={buatPengguna}>
        <div className="crm-sec">
          <SecHeader
            num="02"
            title="BUAT AKUN KARYAWAN"
            desc="Password awal disampaikan manual ke karyawan. Link ke data HRIS agar absensi/quest/KPI nyambung."
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <div className="fg" style={{ marginBottom: 0 }}>
              <label className="flab">Nama lengkap *</label>
              <input className="fi" name="full_name" required />
            </div>
            <div className="fg" style={{ marginBottom: 0 }}>
              <label className="flab">Email *</label>
              <input className="fi" type="email" name="email" required placeholder="nama@kamogroup.id" />
            </div>
            <div className="fg" style={{ marginBottom: 0 }}>
              <label className="flab">Password awal * (min. 8)</label>
              <input className="fi" name="password" type="password" required minLength={8} placeholder="Password sementara" />
            </div>
            <div className="fg" style={{ marginBottom: 0 }}>
              <label className="flab">Role *</label>
              <select className="fi" name="role" defaultValue="STAFF" required>
                <option value="STAFF">STAFF (kasir/staf)</option>
                <option value="DOCTOR">DOCTOR (dokter)</option>
                <option value="FINANCE">FINANCE (keuangan)</option>
                {actor?.role === "OWNER" && <option value="ADMIN">ADMIN</option>}
                {actor?.role === "OWNER" && <option value="OWNER">OWNER</option>}
              </select>
            </div>
            <div className="fg" style={{ marginBottom: 0 }}>
              <label className="flab">Karyawan HRIS *</label>
              <select className="fi" name="employee_id" required defaultValue="">
                <option value="" disabled>Pilih identitas dari HRIS</option>
                {empBebas.map((e) => (
                  <option key={e.id} value={e.id}>{e.nik ?? e.id} · {e.nama}{e.jabatan ? ` (${e.jabatan})` : ""}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="flab" style={{ marginBottom: 6 }}>Penugasan akun (wajib untuk STAFF/DOCTOR; akses semua cabang diatur Super Admin di Akses Grup)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {branchCatalog.filter(b => b.is_active && (allowed === null || allowed.includes(b.id))).map((b) => (
                <label key={b.id} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, border: ".5px solid var(--bd)", borderRadius: 6, padding: "5px 9px", cursor: "pointer" }}>
                  <input type="checkbox" name="branch_ids" value={b.id} /> {branchDisplayName(b, branchCatalog)}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button type="submit" className="btn-acc"><i className="ti ti-user-plus" /> Buat akun</button>
          </div>
        </div>
      </form>
    </>
  );
}
