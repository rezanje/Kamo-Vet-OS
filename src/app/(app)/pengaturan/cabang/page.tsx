import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// REAL data. branches = readable by all authenticated; warehouses = RLS-filtered
// (STAFF sees only assigned-branch warehouses, OWNER/ADMIN see all).
// ponytail: read-only for now. Add/edit needs branches INSERT/UPDATE RLS for
// admins — wire that with the management UI when CRUD is actually requested.
export default async function CabangPage() {
  const supabase = await createClient();

  const [{ data: branches }, { data: warehouses }] = await Promise.all([
    supabase.from("branches").select("code, name, type, is_active").order("name"),
    supabase
      .from("warehouses")
      .select("code, name, type, branches(name)")
      .order("code"),
  ]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pengaturan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Cabang &amp; Gudang</span>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div className="pg-sub" style={{ margin: 0 }}>
          {branches?.length ?? 0} cabang · {warehouses?.length ?? 0} gudang dapat diakses
        </div>
        <button className="btn-acc" title="CRUD admin menyusul">+ Tambah cabang</button>
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="card-hd">
            <i className="ti ti-building-store" style={{ color: "var(--acc)" }} /> Cabang
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Tipe</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {branches?.map((b) => (
                <tr key={b.code}>
                  <td style={{ fontFamily: "monospace", fontSize: 10 }}>{b.code}</td>
                  <td>{b.name}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{b.type}</td>
                  <td>
                    <span className={`bge ${b.is_active ? "g" : "x"}`}>
                      {b.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-hd">
            <i className="ti ti-stack" style={{ color: "#16a34a" }} /> Gudang
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Cabang</th>
                <th>Tipe</th>
              </tr>
            </thead>
            <tbody>
              {warehouses?.map((w) => {
                const branch = (
                  Array.isArray(w.branches) ? w.branches[0] : w.branches
                ) as { name: string } | undefined;
                return (
                  <tr key={w.code}>
                    <td style={{ fontFamily: "monospace", fontSize: 10 }}>{w.code}</td>
                    <td>{w.name}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                      {branch?.name ?? "—"}
                    </td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{w.type}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
