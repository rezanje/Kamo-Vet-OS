import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { advanceRecipeStatus, voidRecipe } from "../actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const statusLabel: Record<string, string> = {
  pending: "Menunggu diracik", ready: "Siap diserahkan", handed_over: "Sudah diserahkan", void: "Void",
};
const statusBadge = (s: string) => (s === "handed_over" ? "g" : s === "ready" ? "b" : s === "void" ? "r" : "o");

type Ingredient = { ingredient_name: string; quantity: number; unit: string };
type Recipe = {
  id: string; recipe_name: string; dosage_instruction: string; total_volume: string; dosage_form: string;
  compounding_steps: string; status: string; compounding_ingredients: Ingredient[];
};

// Racik obat (referensi RACIK OBAT): petunjuk racik dari resep dokter — apoteker/PCA.
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
    .select(`id, recipe_name, dosage_instruction, total_volume, dosage_form, compounding_steps, status, created_at, medical_record_id,
      medical_records(id, diagnosis, anamnesis, catatan_resep, visit_id,
        visits(id, poli, dokter, keluhan, created_at, pets(name, species, breed, photo_url), customers(name, phone, address)))`)
    .eq("id", recipeId)
    .maybeSingle();
  if (!r) notFound();

  const mr = one(r.medical_records as Rel<{ id: string; diagnosis: string | null; anamnesis: string | null; catatan_resep: string | null; visit_id: string; visits: Rel<{ id: string; poli: string; dokter: string | null; keluhan: string | null; created_at: string; pets: Rel<{ name: string; species: string | null; breed: string | null; photo_url: string | null }>; customers: Rel<{ name: string; phone: string; address: string | null }> }> }>);
  const visit = one(mr?.visits ?? null);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);

  // Semua racikan dalam resep yang sama (referensi: daftar bisa >1 baris).
  const { data: siblings } = mr
    ? await supabase
        .from("compounding_recipes")
        .select("id, recipe_name, dosage_instruction, total_volume, dosage_form, compounding_steps, status, compounding_ingredients(ingredient_name, quantity, unit)")
        .eq("medical_record_id", mr.id)
        .order("created_at", { ascending: true })
    : { data: [] };
  const recipes = (siblings ?? []) as Recipe[];

  const tglResep = visit ? new Date(visit.created_at).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
  const tglPeriksa = visit ? new Date(visit.created_at).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const noRM = visit ? `RM/${new Date(visit.created_at).getFullYear()}/${new Date(visit.created_at).toISOString().slice(5, 10).replace("-", "")}/${(visit.id as string).slice(0, 3).toUpperCase()}` : "—";
  const noResep = visit ? `R/${new Date(visit.created_at).getFullYear()}/${new Date(visit.created_at).toISOString().slice(5, 10).replace("-", "")}/${(r.id as string).slice(0, 3).toUpperCase()}` : "—";
  const catatanResep = mr?.catatan_resep
    || [mr?.diagnosis ? `Diagnosa: ${mr.diagnosis}` : "", visit?.keluhan ? `Keluhan: ${visit.keluhan}` : ""].filter(Boolean).join(". ")
    || "—";

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/klinik/racik" className="back-btn"><i className="ti ti-arrow-left" /> Racik Obat</Link>
      </div>

      {/* Judul besar (referensi) */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-flask" style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>RACIK OBAT</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Petunjuk racik obat dari resep dokter</div>
        </div>
        <span className={`bge ${statusBadge(r.status)}`}>{statusLabel[r.status]}</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "ready" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Obat siap diserahkan ke pasien.</div>}
      {success === "handed_over" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Racikan sudah diserahkan.</div>}

      {/* Kartu pasien + catatan resep */}
      <div className="card" style={{ marginBottom: 14, padding: 20 }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 16, minWidth: 300, flex: 1 }}>
            <div style={{ width: 96, height: 96, borderRadius: 12, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
              {pet?.photo_url ? <img src={pet.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <i className="ti ti-paw" style={{ fontSize: 40, color: "var(--td)" }} />}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 19, fontWeight: 800, color: "var(--sb)" }}>{pet?.name ?? "—"}</span>
                <span className="bge b">{pet?.species ?? "—"}</span>
              </div>
              <Pair label="Pemilik" value={cust?.name} />
              <Pair label="No. RM" value={noRM} />
              <Pair label="No. HP" value={cust?.phone} />
              <Pair label="Jenis / Ras" value={`${pet?.species ?? "—"}${pet?.breed ? ` / ${pet.breed}` : ""}`} />
            </div>
          </div>
          <div style={{ minWidth: 220 }}>
            <div style={{ fontSize: 10, color: "var(--tm)" }}>Dokter Penanggung Jawab</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx)", marginBottom: 12 }}>{visit?.dokter ?? "—"}</div>
            <Pair label="Tanggal Resep" value={tglResep} />
            <Pair label="No. Resep" value={noResep} />
          </div>
          <div style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", borderRadius: 10, padding: 14, maxWidth: 360, flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "#1d4ed8", marginBottom: 6 }}><i className="ti ti-clipboard-text" /> CATATAN RESEP</div>
            <div style={{ fontSize: 11.5, color: "var(--tm)", lineHeight: 1.5 }}>{catatanResep}</div>
          </div>
        </div>
      </div>

      {/* Daftar obat racikan */}
      <div className="crm-sec">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <i className="ti ti-mortar" style={{ fontSize: 18, color: "#2563eb" }} />
          <div style={{ fontSize: 13, fontWeight: 800, color: "#2563eb", letterSpacing: ".02em" }}>DAFTAR OBAT RACIKAN</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr><th style={{ width: 30 }}>No.</th><th>Nama Racikan</th><th>Komposisi</th><th>Aturan Pakai</th><th>Jumlah Racikan</th><th>Bentuk Sediaan</th><th>Petunjuk Racik</th></tr>
            </thead>
            <tbody>
              {recipes.map((rc, ri) => {
                const ings = rc.compounding_ingredients ?? [];
                const steps = String(rc.compounding_steps).split("\n").map((s) => s.trim()).filter(Boolean);
                return (
                  <tr key={rc.id}>
                    <td style={{ verticalAlign: "top", fontSize: 11, color: "var(--tm)" }}>{ri + 1}</td>
                    <td style={{ fontWeight: 600, verticalAlign: "top" }}>
                      {rc.recipe_name}
                      {rc.id !== r.id && <span className={`bge ${statusBadge(rc.status)}`} style={{ display: "block", marginTop: 4, width: "fit-content" }}>{statusLabel[rc.status]}</span>}
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      {ings.map((i, idx) => (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11, padding: "1px 0" }}>
                          <span>• {i.ingredient_name}</span>
                          <span style={{ color: "var(--tm)", whiteSpace: "nowrap" }}>{Number(i.quantity)} {i.unit}</span>
                        </div>
                      ))}
                    </td>
                    <td style={{ fontSize: 11.5, verticalAlign: "top", whiteSpace: "pre-line" }}>{rc.dosage_instruction}</td>
                    <td style={{ fontSize: 11.5, verticalAlign: "top" }}>{rc.total_volume}</td>
                    <td style={{ fontSize: 11.5, verticalAlign: "top", textTransform: "capitalize" }}>{rc.dosage_form}</td>
                    <td style={{ verticalAlign: "top" }}>
                      <ol style={{ margin: 0, paddingLeft: 16 }}>
                        {steps.map((s, i) => <li key={i} style={{ fontSize: 11, padding: "1px 0" }}>{s.replace(/^\d+[.)]\s*/, "")}</li>)}
                      </ol>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ background: "#fffbeb", border: ".5px solid #fde68a", borderRadius: 10, padding: 14, marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706", marginBottom: 3 }}><i className="ti ti-alert-triangle" /> PERHATIAN</div>
          <div style={{ fontSize: 11, color: "#92400e" }}>Pastikan semua bahan sesuai resep dan dalam kondisi baik sebelum diracik.</div>
        </div>
      </div>

      {/* Informasi resep + pemilik */}
      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563eb", letterSpacing: ".02em", marginBottom: 10 }}>INFORMASI RESEP</div>
          <Pair label="Tanggal Periksa" value={tglPeriksa} />
          <Pair label="Poli" value={visit?.poli} />
          <Pair label="Keluhan" value={visit?.keluhan} />
          <Pair label="Diagnosa" value={mr?.diagnosis} />
        </div>
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563eb", letterSpacing: ".02em", marginBottom: 10 }}>INFORMASI PEMILIK</div>
          <Pair label="Nama" value={cust?.name} />
          <Pair label="No. HP" value={cust?.phone} />
          <Pair label="Alamat" value={cust?.address} />
        </div>
      </div>

      {/* Aksi */}
      {(r.status === "pending" || r.status === "ready") && (
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center" }}>
          <form action={advanceRecipeStatus}>
            <input type="hidden" name="recipeId" value={r.id} />
            <button type="submit" className="pay-btn" style={{ background: "#16a34a", minWidth: 260, padding: "12px 22px", fontSize: 13.5 }}>
              <i className="ti ti-circle-check" /> {r.status === "pending" ? "Obat Siap Diserahkan" : "Tandai Sudah Diserahkan"}
            </button>
          </form>
          <form action={voidRecipe}>
            <input type="hidden" name="recipeId" value={r.id} />
            <input type="hidden" name="visitId" value={visit?.id ?? ""} />
            <button type="submit" className="btn-def" style={{ color: "#b91c1c", borderColor: "#fca5a5", padding: "12px 18px" }}>
              <i className="ti ti-x" /> Void (resep berubah)
            </button>
          </form>
        </div>
      )}
      {r.status !== "pending" && r.status !== "ready" && (
        <div style={{ fontSize: 10, color: "var(--td)", textAlign: "center", marginTop: 12 }}>
          Racikan sudah diproses — perubahan resep butuh racikan baru (void yang lama). Addendum §2.
        </div>
      )}
    </>
  );
}

function Pair({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 6, padding: "3px 0", fontSize: 12 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ color: "var(--tx)", fontWeight: 500 }}>: {value || "—"}</span>
    </div>
  );
}
