import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { advanceRecipeStatus, voidRecipe } from "../actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

// Layar racik obat utk apoteker/PCA — design-reference/klinik/11-racik-obat.png.
export default async function RacikDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ recipeId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { recipeId } = await params;
  const { error, success } = await searchParams;
  const supabase = await createClient();

  const { data: r } = await supabase
    .from("compounding_recipes")
    .select(`id, recipe_name, dosage_instruction, total_volume, dosage_form, compounding_steps, status, created_at, prepared_at,
      compounding_ingredients(ingredient_name, quantity, unit),
      medical_records(id, diagnosis, anamnesis, visit_id,
        visits(id, poli, dokter, keluhan, created_at, pets(name, species, breed), customers(name, phone, address)))`)
    .eq("id", recipeId)
    .maybeSingle();
  if (!r) notFound();

  const mr = one(r.medical_records as Rel<{ id: string; diagnosis: string | null; anamnesis: string | null; visit_id: string; visits: Rel<{ id: string; poli: string; dokter: string | null; keluhan: string | null; created_at: string; pets: Rel<{ name: string; species: string | null; breed: string | null }>; customers: Rel<{ name: string; phone: string; address: string | null }> }> }>);
  const visit = one(mr?.visits ?? null);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);
  const ings = (r.compounding_ingredients ?? []) as { ingredient_name: string; quantity: number; unit: string }[];
  const steps = String(r.compounding_steps).split("\n").map((s: string) => s.trim()).filter(Boolean);

  const statusLabel: Record<string, string> = {
    pending: "Menunggu diracik", ready: "Siap diserahkan", handed_over: "Sudah diserahkan", void: "Void",
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik/racik" className="back-btn"><i className="ti ti-arrow-left" /> Racik Obat</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{r.recipe_name}</span>
        <span className={`bge ${r.status === "handed_over" ? "g" : r.status === "ready" ? "b" : r.status === "void" ? "r" : "o"}`} style={{ marginLeft: 6 }}>
          {statusLabel[r.status]}
        </span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "ready" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Obat siap diserahkan ke pasien.</div>}
      {success === "handed_over" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Racikan sudah diserahkan.</div>}

      {/* Header pasien + catatan resep (design 11) */}
      <div className="card" style={{ marginBottom: 12, display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 28px" }}>
          <Field label="Pasien" value={`${pet?.name ?? "—"} · ${pet?.species ?? ""}${pet?.breed ? " / " + pet.breed : ""}`} />
          <Field label="Pemilik" value={`${cust?.name ?? "—"} · ${cust?.phone ?? ""}`} />
          <Field label="Dokter penanggung jawab" value={visit?.dokter ?? "—"} />
          <Field label="Tanggal resep" value={visit ? new Date(visit.created_at).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) : "—"} />
        </div>
        <div style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", borderRadius: 8, padding: "9px 13px", maxWidth: 380 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--sb)", marginBottom: 3 }}><i className="ti ti-notes" /> CATATAN RESEP</div>
          <div style={{ fontSize: 11, color: "var(--tm)" }}>{mr?.diagnosis ? `Diagnosa: ${mr.diagnosis}. ` : ""}{visit?.keluhan ? `Keluhan: ${visit.keluhan}.` : ""}</div>
        </div>
      </div>

      {/* Tabel racikan */}
      <div className="crm-sec">
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".04em", marginBottom: 8 }}>
          <i className="ti ti-flask" /> DAFTAR OBAT RACIKAN
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr><th>Nama Racikan</th><th>Komposisi</th><th>Aturan Pakai</th><th>Jumlah Racikan</th><th>Bentuk Sediaan</th><th>Petunjuk Racik</th></tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600, verticalAlign: "top" }}>{r.recipe_name}</td>
                <td style={{ verticalAlign: "top" }}>
                  {ings.map((i, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, padding: "1px 0" }}>
                      <span>• {i.ingredient_name}</span>
                      <span style={{ color: "var(--tm)", whiteSpace: "nowrap" }}>{Number(i.quantity)} {i.unit}</span>
                    </div>
                  ))}
                </td>
                <td style={{ fontSize: 11.5, verticalAlign: "top" }}>{r.dosage_instruction}</td>
                <td style={{ fontSize: 11.5, verticalAlign: "top" }}>{r.total_volume}</td>
                <td style={{ fontSize: 11.5, verticalAlign: "top", textTransform: "capitalize" }}>{r.dosage_form}</td>
                <td style={{ verticalAlign: "top" }}>
                  <ol style={{ margin: 0, paddingLeft: 16 }}>
                    {steps.map((s: string, i: number) => <li key={i} style={{ fontSize: 11, padding: "1px 0" }}>{s.replace(/^\d+[.)]\s*/, "")}</li>)}
                  </ol>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", marginTop: 12 }}>
          <i className="ti ti-alert-triangle" /> PERHATIAN — pastikan semua bahan sesuai resep dan dalam kondisi baik sebelum diracik.
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "center" }}>
          {(r.status === "pending" || r.status === "ready") && (
            <form action={advanceRecipeStatus}>
              <input type="hidden" name="recipeId" value={r.id} />
              <button type="submit" className="pay-btn" style={{ background: "#16a34a", minWidth: 240 }}>
                <i className="ti ti-circle-check" /> {r.status === "pending" ? "Obat Siap Diserahkan" : "Tandai Sudah Diserahkan"}
              </button>
            </form>
          )}
          {(r.status === "pending" || r.status === "ready") && (
            <form action={voidRecipe}>
              <input type="hidden" name="recipeId" value={r.id} />
              <input type="hidden" name="visitId" value={visit?.id ?? ""} />
              <button type="submit" className="btn-def" style={{ color: "#b91c1c", borderColor: "#fca5a5" }}>
                <i className="ti ti-x" /> Void (resep berubah)
              </button>
            </form>
          )}
        </div>
        {r.status !== "pending" && (
          <div style={{ fontSize: 10, color: "var(--td)", textAlign: "center", marginTop: 8 }}>
            Racikan sudah diproses — perubahan resep butuh racikan baru (void yang lama). Addendum §2.
          </div>
        )}
      </div>

      {/* Informasi resep + pemilik (design 11 bawah) */}
      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="card">
          <div className="card-hd"><i className="ti ti-file-text" style={{ color: "var(--acc)" }} /> Informasi Resep</div>
          <Field label="Tanggal periksa" value={visit ? new Date(visit.created_at).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"} />
          <Field label="Poli" value={visit?.poli ?? "—"} />
          <Field label="Keluhan" value={visit?.keluhan ?? "—"} />
          <Field label="Diagnosa" value={mr?.diagnosis ?? "—"} />
        </div>
        <div className="card">
          <div className="card-hd"><i className="ti ti-user" style={{ color: "var(--acc)" }} /> Informasi Pemilik</div>
          <Field label="Nama" value={cust?.name ?? "—"} />
          <Field label="No. HP" value={cust?.phone ?? "—"} />
          <Field label="Alamat" value={cust?.address ?? "—"} />
        </div>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 9.5, color: "var(--td)" }}>{label}</div>
      <div style={{ fontSize: 12 }}>{value}</div>
    </div>
  );
}
