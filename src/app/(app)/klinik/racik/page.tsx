import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  pending: { cls: "o", label: "Menunggu diracik" },
  ready: { cls: "b", label: "Siap diserahkan" },
  handed_over: { cls: "g", label: "Sudah diserahkan" },
  void: { cls: "r", label: "Void" },
};

// Worklist racik obat untuk apoteker/PCA (Addendum §2, design klinik/11).
export default async function RacikListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; error?: string; success?: string }>;
}) {
  const { filter = "aktif", error, success } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("compounding_recipes")
    .select("id, recipe_name, dosage_form, total_volume, status, created_at, medical_records(visit_id, visits(poli, pets(name, species), customers(name), branches(code)))")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter === "aktif") query = query.in("status", ["pending", "ready"]);
  if (filter === "selesai") query = query.eq("status", "handed_over");

  const { data: recipes } = await query;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Racik Obat</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "void" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Racikan di-void, stok bahan dikembalikan.</div>}

      <div className="crm-sec">
        <SecHeader num="01" title="DAFTAR OBAT RACIKAN" desc="Petunjuk racik obat dari resep dokter — untuk apoteker/PCA." />

        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {[
            { key: "aktif", label: "Perlu Diproses" },
            { key: "selesai", label: "Sudah Diserahkan" },
            { key: "semua", label: "Semua" },
          ].map((t) => (
            <Link key={t.key} href={`/klinik/racik?filter=${t.key}`} className="back-btn"
              style={{ padding: "5px 12px", borderRadius: 7, border: ".5px solid var(--bd)",
                background: filter === t.key ? "var(--sb)" : "#fff", color: filter === t.key ? "#fff" : "var(--tm)" }}>
              {t.label}
            </Link>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr><th>Tanggal</th><th>Pasien</th><th>Pemilik</th><th>Racikan</th><th>Bentuk</th><th>Jumlah</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {(recipes ?? []).map((r) => {
                const mr = one(r.medical_records as Rel<{ visit_id: string; visits: Rel<{ poli: string; pets: Rel<{ name: string; species: string | null }>; customers: Rel<{ name: string }>; branches: Rel<{ code: string }> }> }>);
                const visit = one(mr?.visits ?? null);
                const pet = one(visit?.pets ?? null);
                const cust = one(visit?.customers ?? null);
                const badge = STATUS_BADGE[r.status] ?? { cls: "o", label: r.status };
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{new Date(r.created_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td><div style={{ fontWeight: 500 }}>{pet?.name ?? "—"}</div><div style={{ fontSize: 10, color: "var(--tm)" }}>{pet?.species}</div></td>
                    <td style={{ fontSize: 11.5 }}>{cust?.name ?? "—"}</td>
                    <td style={{ fontWeight: 500 }}>{r.recipe_name}</td>
                    <td style={{ fontSize: 11, textTransform: "capitalize" }}>{r.dosage_form}</td>
                    <td style={{ fontSize: 11 }}>{r.total_volume}</td>
                    <td><span className={`bge ${badge.cls}`}>{badge.label}</span></td>
                    <td>
                      <Link href={`/klinik/racik/${r.id}`} className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>
                        <i className="ti ti-flask" /> Detail
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {(recipes ?? []).length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>Tidak ada racikan.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
