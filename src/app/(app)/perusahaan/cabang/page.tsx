import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assignUser, unassignUser } from "./actions";

const ROLE_COLOR: Record<string, string> = {
  OWNER: "#7c3aed", ADMIN: "#2563eb", FINANCE: "#d97706", STAFF: "#16a34a", DOCTOR: "#dc2626",
};

export default async function PerusahaanCabangPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) redirect("/perusahaan");

  const [{ data: branches }, { data: profiles }, { data: links }] = await Promise.all([
    supabase.from("branches").select("id, code, name, type, is_active").order("name"),
    supabase.from("profiles").select("id, full_name, role").order("full_name"),
    supabase.from("user_branches").select("user_id, branch_id, role"),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const byBranch = new Map<string, { user_id: string; role: string }[]>();
  for (const l of links ?? []) {
    const arr = byBranch.get(l.branch_id) ?? [];
    arr.push({ user_id: l.user_id, role: l.role });
    byBranch.set(l.branch_id, arr);
  }
  const nameOf = (id: string) => {
    const p = profileById.get(id);
    return p?.full_name || "(tanpa nama)";
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/perusahaan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Pengguna per Cabang</span>
      </div>

      <div className="pg-sub" style={{ marginBottom: 10 }}>
        Tentukan pengguna yang punya akses ke tiap cabang. PRIMARY = penempatan utama, SECONDARY = akses tambahan (mis. dokter floating).
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginBottom: 12 }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#f0fdf4", border: ".5px solid #86efac", color: "#166534", marginBottom: 12 }}><i className="ti ti-check" /> Tersimpan</div>}

      <div className="grid2" style={{ alignItems: "start" }}>
        {branches?.map((b) => {
          const assigned = byBranch.get(b.id) ?? [];
          const assignedIds = new Set(assigned.map((a) => a.user_id));
          const available = (profiles ?? []).filter((p) => !assignedIds.has(p.id));
          return (
            <div className="card" key={b.id}>
              <div className="card-hd">
                <i className="ti ti-building-community" style={{ color: "var(--acc)" }} /> {b.name}
                <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--tm)", fontWeight: 400 }}>
                  {b.code} · {b.type}
                </span>
              </div>

              {assigned.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--td)", padding: "10px 0" }}>Belum ada pengguna ditugaskan.</div>
              ) : (
                <table className="tbl" style={{ marginBottom: 8 }}>
                  <tbody>
                    {assigned.map((a) => {
                      const p = profileById.get(a.user_id);
                      return (
                        <tr key={a.user_id}>
                          <td>{nameOf(a.user_id)}</td>
                          <td>
                            <span style={{ fontSize: 9.5, fontWeight: 600, color: ROLE_COLOR[p?.role ?? ""] ?? "var(--tm)" }}>
                              {p?.role ?? "—"}
                            </span>
                          </td>
                          <td style={{ fontSize: 10, color: "var(--tm)" }}>{a.role}</td>
                          <td style={{ textAlign: "right", width: 1 }}>
                            <form action={unassignUser}>
                              <input type="hidden" name="user_id" value={a.user_id} />
                              <input type="hidden" name="branch_id" value={b.id} />
                              <button type="submit" title="Lepas" style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 14 }}>
                                <i className="ti ti-trash" />
                              </button>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              <form action={assignUser} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <input type="hidden" name="branch_id" value={b.id} />
                <select className="fi" name="user_id" required defaultValue="" style={{ flex: 1, minWidth: 120 }}>
                  <option value="" disabled>Pilih pengguna…</option>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name || "(tanpa nama)"} · {p.role}</option>
                  ))}
                </select>
                <select className="fi" name="role" defaultValue="PRIMARY" style={{ width: 110 }}>
                  <option value="PRIMARY">PRIMARY</option>
                  <option value="SECONDARY">SECONDARY</option>
                </select>
                <button type="submit" className="btn-acc" disabled={available.length === 0}>+ Tugaskan</button>
              </form>
            </div>
          );
        })}
      </div>
    </>
  );
}
