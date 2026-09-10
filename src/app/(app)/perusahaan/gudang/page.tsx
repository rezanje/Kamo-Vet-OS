import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tambahGudang } from "./actions";

export default async function GudangPage({
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

  const [{ data: branches }, { data: warehouses }] = await Promise.all([
    supabase.from("branches").select("id, code, name, type").eq("is_active", true).order("name"),
    supabase.from("warehouses").select("id, branch_id, code, name, type, is_active").order("name"),
  ]);
  const branchName = new Map((branches ?? []).map((branch) => [branch.id, branch.name]));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/perusahaan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Gudang</span>
      </div>
      <div className="pg-sub" style={{ marginBottom: 10 }}>Atur gudang aktif untuk tiap cabang. Gudang menentukan lokasi stok masuk dan keluar.</div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginBottom: 12 }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success && <div className="p2ban" style={{ background: "#f0fdf4", border: ".5px solid #86efac", color: "#166534", marginBottom: 12 }}><i className="ti ti-check" /> {success}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-hd"><i className="ti ti-building-warehouse" style={{ color: "var(--acc)" }} /> Tambah gudang</div>
        <form action={tambahGudang} className="form-grid" style={{ gridTemplateColumns: "minmax(220px, 1.3fr) minmax(140px, .7fr) minmax(220px, 1fr) minmax(140px, .6fr) auto", alignItems: "end" }}>
          <label><span className="flab">Cabang *</span><select className="fi" name="branch_id" required defaultValue=""><option value="" disabled>Pilih cabang</option>{(branches ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.code}</option>)}</select></label>
          <label><span className="flab">Kode gudang *</span><input className="fi" name="code" required maxLength={20} placeholder="Contoh: VET PDRY" /></label>
          <label><span className="flab">Nama gudang *</span><input className="fi" name="name" required maxLength={100} placeholder="Contoh: VET PDRY" /></label>
          <label><span className="flab">Jenis *</span><select className="fi" name="type" defaultValue="VET"><option value="VET">Klinik</option><option value="RETAIL">Retail</option><option value="DC">Distribusi</option><option value="EXPIRED">Kedaluwarsa</option><option value="TRANSIT">Transit</option><option value="ONLINE">Online</option></select></label>
          <button type="submit" className="btn-acc"><i className="ti ti-plus" /> Tambah</button>
        </form>
      </div>

      <div className="card">
        <div className="card-hd"><i className="ti ti-list" style={{ color: "var(--acc)" }} /> Gudang terdaftar <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--tm)", fontWeight: 400 }}>{warehouses?.length ?? 0} gudang</span></div>
        <table className="tbl"><thead><tr><th>Cabang</th><th>Kode</th><th>Nama gudang</th><th>Jenis</th><th>Status</th></tr></thead><tbody>
          {(warehouses ?? []).map((warehouse) => <tr key={warehouse.id}><td>{branchName.get(warehouse.branch_id) ?? "—"}</td><td>{warehouse.code}</td><td>{warehouse.name}</td><td>{warehouse.type}</td><td><span className={warehouse.is_active ? "badge bg" : "badge bo"}>{warehouse.is_active ? "Aktif" : "Nonaktif"}</span></td></tr>)}
          {!warehouses?.length && <tr><td colSpan={5} className="empty">Belum ada gudang.</td></tr>}
        </tbody></table>
      </div>
    </>
  );
}
