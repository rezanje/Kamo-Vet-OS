import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RekamForm } from "./RekamForm";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

// §3.4 visit state machine — rawat inap & racik obat kondisional, disembunyikan untuk prototype.
const STEPS = ["Pendaftaran", "Antrian", "Rekam Medis", "Pembayaran"];
const ACTIVE = 2; // 0-indexed: Rekam Medis sedang berjalan

export default async function RekamMedisPage({
  params,
  searchParams,
}: {
  params: Promise<{ visitId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { visitId } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select("id, poli, status, keluhan, created_at, pets(name, species, breed, weight), customers(name, phone)")
    .eq("id", visitId)
    .maybeSingle();

  if (!visit) notFound();

  const pet = one(visit.pets);
  const cust = one(visit.customers);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik/antrian" className="back-btn">
          <i className="ti ti-arrow-left" /> Antrian
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Rekam Medis</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {/* Stepper status kunjungan (§3.4) */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          {STEPS.map((s, i) => {
            const done = i < ACTIVE;
            const active = i === ACTIVE;
            const color = done ? "#16a34a" : active ? "var(--acc)" : "var(--td)";
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                    background: done ? "#16a34a" : active ? "var(--acc)" : "#f3f4f6",
                    color: done || active ? "#fff" : "var(--td)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600,
                  }}>
                    {done ? <i className="ti ti-check" /> : i + 1}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: active ? 600 : 400, color }}>{s}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ flex: 1, height: 1.5, background: done ? "#16a34a" : "var(--bd)", margin: "0 9px" }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Identitas pasien */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 28px" }}>
          <Field label="Pasien" value={`${pet?.name ?? "—"} · ${pet?.species ?? ""}${pet?.breed ? " / " + pet.breed : ""}`} />
          <Field label="Berat" value={pet?.weight ? `${pet.weight} kg` : "—"} />
          <Field label="Pemilik" value={`${cust?.name ?? "—"} · ${cust?.phone ?? ""}`} />
          <Field label="Poli" value={visit.poli} />
          <Field label="Keluhan" value={visit.keluhan ?? "—"} />
        </div>
      </div>

      {visit.status === "Selesai" ? (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Kunjungan ini sudah selesai. Rekam medis terkunci.
        </div>
      ) : (
        <RekamForm visitId={visit.id} />
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: "var(--td)" }}>{label}</div>
      <div style={{ fontSize: 12 }}>{value}</div>
    </div>
  );
}
