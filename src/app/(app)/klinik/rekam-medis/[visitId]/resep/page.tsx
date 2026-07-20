import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "./PrintButton";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

export default async function ResepPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select("id, dokter, poli, created_at, pets(name, species, breed, weight), customers(name, phone), branches(name, code)")
    .eq("id", visitId)
    .maybeSingle();
  if (!visit) notFound();

  const pet = one(visit.pets);
  const cust = one(visit.customers);
  const branch = one(visit.branches);

  const { data: mr } = await supabase
    .from("medical_records")
    .select("id, diagnosis")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: resep } = mr
    ? await supabase.from("prescription_items").select("nama_obat, qty, aturan_pakai").eq("medical_record_id", mr.id).order("created_at")
    : { data: [] as { nama_obat: string; qty: number; aturan_pakai: string | null }[] };

  const tgl = new Date(visit.created_at).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <>
      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Link href={`/klinik/rekam-medis/${visitId}`} className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali ke rekam medis
        </Link>
        <div style={{ display: "flex", gap: 8 }}>
          <PrintButton />
          <Link href={`/klinik/pembayaran/${visitId}`} className="btn-acc">
            <i className="ti ti-credit-card" /> Lanjut ke Pembayaran
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: "0 auto", background: "#fff", border: ".5px solid var(--bd)", borderRadius: 10, padding: "26px 30px", fontSize: 12.5, color: "#141413" }}>
        {/* Kop klinik */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #16213e", paddingBottom: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>KAMO<i className="ti ti-paw" style={{ fontSize: 15, verticalAlign: -1 }} /> PET CARE</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 2 }}>{branch?.name ?? "Klinik Hewan"}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5, color: "var(--tm)" }}>
            <div style={{ fontWeight: 700, color: "#141413", fontSize: 13 }}>RESEP</div>
            <div style={{ marginTop: 2 }}>{tgl}</div>
          </div>
        </div>

        {/* Identitas */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 20px", marginBottom: 18 }}>
          <Row label="Pasien" value={`${pet?.name ?? "—"} (${pet?.species ?? "-"}${pet?.breed ? " / " + pet.breed : ""})`} />
          <Row label="Berat" value={pet?.weight ? `${pet.weight} kg` : "—"} />
          <Row label="Pemilik" value={cust?.name ?? "—"} />
          <Row label="Poli" value={visit.poli} />
          {mr?.diagnosis && <Row label="Diagnosa" value={mr.diagnosis} />}
        </div>

        {/* R/ resep */}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ fontSize: 30, fontWeight: 700, fontStyle: "italic", lineHeight: 1, color: "#16213e" }}>R/</div>
          <div style={{ flex: 1 }}>
            {(resep ?? []).length === 0 ? (
              <div style={{ color: "var(--td)" }}>Tidak ada resep.</div>
            ) : (
              (resep ?? []).map((r, i) => (
                <div key={i} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: i < (resep ?? []).length - 1 ? ".5px dashed var(--bd)" : "none" }}>
                  <div style={{ fontWeight: 600 }}>{r.nama_obat} <span style={{ color: "var(--tm)", fontWeight: 400 }}>No. {r.qty}</span></div>
                  <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 2 }}>
                    <span style={{ fontStyle: "italic" }}>S</span> {r.aturan_pakai ?? "—"}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tanda tangan */}
        <div style={{ marginTop: 36, display: "flex", justifyContent: "flex-end" }}>
          <div style={{ textAlign: "center", fontSize: 11.5 }}>
            <div style={{ color: "var(--tm)" }}>Dokter Penanggung Jawab</div>
            <div style={{ height: 42 }} />
            <div style={{ borderTop: ".5px solid #141413", paddingTop: 3, minWidth: 150, fontWeight: 600 }}>{visit.dokter ?? "drh. ____________"}</div>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <span style={{ color: "var(--tm)", minWidth: 56 }}>{label}</span>
      <span style={{ fontWeight: 500 }}>: {value}</span>
    </div>
  );
}
