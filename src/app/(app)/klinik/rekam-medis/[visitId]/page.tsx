import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RekamForm } from "./RekamForm";
import { admitInpatient } from "@/app/(app)/klinik/rawat-inap/actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

// §3.4 visit state machine — rawat inap & racik obat kondisional, disembunyikan untuk prototype.
const STEPS = ["Pendaftaran", "Antrian", "Rekam Medis", "Pembayaran"];

export default async function RekamMedisPage({
  params,
  searchParams,
}: {
  params: Promise<{ visitId: string }>;
  searchParams: Promise<{ error?: string; racikan?: string }>;
}) {
  const { visitId } = await params;
  const { error, racikan } = await searchParams;
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select("id, pet_id, poli, status, dokter, keluhan, created_at, pets(name, species, breed, weight), customers(name, phone)")
    .eq("id", visitId)
    .maybeSingle();

  if (!visit) notFound();

  const pet = one(visit.pets);
  const cust = one(visit.customers);
  const menungguBayar = visit.status === "Pembayaran";
  const selesai = visit.status === "Selesai";
  const recorded = menungguBayar || selesai; // rekam medis sudah disimpan

  // Rekam medis tersimpan (read-only) setelah pemeriksaan selesai.
  let record: { diagnosis: string | null; anamnesis: string | null } | null = null;
  let resep: { nama_obat: string; qty: number; aturan_pakai: string | null }[] = [];
  let racikanList: { id: string; recipe_name: string; dosage_form: string; total_volume: string; status: string }[] = [];
  if (recorded) {
    const { data: mr } = await supabase
      .from("medical_records")
      .select("id, diagnosis, anamnesis")
      .eq("visit_id", visitId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    record = mr;
    if (mr) {
      const { data: pi } = await supabase
        .from("prescription_items")
        .select("nama_obat, qty, aturan_pakai")
        .eq("medical_record_id", mr.id)
        .order("created_at");
      resep = pi ?? [];
      // Addendum §2: racikan bisa lebih dari satu per rekam medis (racikan harian rawat inap).
      const { data: cr } = await supabase
        .from("compounding_recipes")
        .select("id, recipe_name, dosage_form, total_volume, status")
        .eq("medical_record_id", mr.id)
        .order("created_at", { ascending: false });
      racikanList = cr ?? [];
    }
  }

  // Rawat inap aktif utk visit ini (Addendum §3 — admit dari rekam medis, design klinik/07).
  const { data: inpatient } = await supabase
    .from("inpatient_records")
    .select("id, condition_status, discharged_at")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const STEP_BY_STATUS: Record<string, number> = { Menunggu: 1, Diperiksa: 2, Pembayaran: 3, Selesai: 4 };
  const activeStep = STEP_BY_STATUS[visit.status] ?? 2;

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
      {racikan === "dibuat" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Racikan dibuat — stok bahan terpotong, worklist apoteker terupdate.
        </div>
      )}
      {racikan === "void" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Racikan di-void, stok bahan dikembalikan. Buat racikan baru bila perlu.
        </div>
      )}

      {/* Stepper status kunjungan (§3.4) */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          {STEPS.map((s, i) => {
            const done = i < activeStep;
            const active = i === activeStep;
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
          {visit.dokter && <Field label="Dokter" value={visit.dokter} />}
          <Field label="Keluhan" value={visit.keluhan ?? "—"} />
        </div>
      </div>

      {recorded ? (
        <>
          {menungguBayar ? (
            <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <i className="ti ti-clock-dollar" /> Pemeriksaan selesai — menunggu pembayaran.
              </span>
              <Link href={`/klinik/pembayaran/${visit.id}`} className="btn-acc"
                style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>
                Lanjut ke Pembayaran <i className="ti ti-arrow-right" />
              </Link>
            </div>
          ) : (
            <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
              <i className="ti ti-circle-check" /> Kunjungan selesai. Rekam medis terkunci (read-only).
            </div>
          )}
          <div className="grid2">
            <div className="card">
              <div className="card-hd"><i className="ti ti-stethoscope" style={{ color: "var(--acc)" }} /> Hasil pemeriksaan</div>
              <ReadField label="Anamnesis / catatan klinis" value={record?.anamnesis} />
              <ReadField label="Diagnosa" value={record?.diagnosis} />
            </div>
            <div className="card">
              <div className="card-hd" style={{ justifyContent: "space-between" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <i className="ti ti-prescription" style={{ color: "#16a34a" }} /> Resep obat
                </span>
                <Link href={`/klinik/rekam-medis/${visit.id}/resep`} className="btn-def"
                  style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <i className="ti ti-printer" /> Cetak resep
                </Link>
              </div>
              {resep.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--td)" }}>Tidak ada resep.</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr><th>Obat</th><th style={{ textAlign: "center" }}>Qty</th><th>Aturan pakai</th></tr>
                  </thead>
                  <tbody>
                    {resep.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{r.nama_obat}</td>
                        <td style={{ textAlign: "center" }}>{r.qty}</td>
                        <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.aturan_pakai ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Racik obat (Addendum §2) — bisa >1 racikan per rekam medis (racikan harian rawat inap). */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-hd" style={{ justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i className="ti ti-flask" style={{ color: "#7c3aed" }} /> Obat racikan
              </span>
              <Link href={`/klinik/rekam-medis/${visit.id}/racikan`} className="btn-acc"
                style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <i className="ti ti-plus" /> Racikan baru
              </Link>
            </div>
            {racikanList.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--td)" }}>Belum ada racikan untuk kunjungan ini.</div>
            ) : (
              <table className="tbl">
                <thead><tr><th>Racikan</th><th>Bentuk</th><th>Jumlah</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {racikanList.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 500 }}>{c.recipe_name}</td>
                      <td style={{ fontSize: 11, textTransform: "capitalize" }}>{c.dosage_form}</td>
                      <td style={{ fontSize: 11 }}>{c.total_volume}</td>
                      <td><span className={`bge ${c.status === "handed_over" ? "g" : c.status === "ready" ? "b" : c.status === "void" ? "r" : "o"}`}>
                        {c.status === "pending" ? "Menunggu diracik" : c.status === "ready" ? "Siap diserahkan" : c.status === "handed_over" ? "Diserahkan" : "Void"}
                      </span></td>
                      <td>
                        <Link href={`/klinik/racik/${c.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10, textDecoration: "none" }}>
                          Detail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Rawat inap (Addendum §3) — popup "Catatan Rawat Inap" design klinik/07 sebagai card inline. */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-hd" style={{ justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i className="ti ti-bed" style={{ color: "var(--acc)" }} /> Rawat inap
              </span>
              {inpatient && (
                <Link href={`/klinik/rawat-inap/${inpatient.id}`} className="btn-acc"
                  style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <i className="ti ti-eye" /> Lihat Detail Rawat Inap
                </Link>
              )}
            </div>
            {inpatient ? (
              <div style={{ fontSize: 11.5, color: "var(--tm)" }}>
                Pasien {inpatient.discharged_at ? "pernah dirawat inap (sudah keluar)" : "sedang dirawat inap"} — kondisi terakhir:{" "}
                <span className={`bge ${inpatient.condition_status === "kritis" || inpatient.condition_status === "rip" ? "r" : inpatient.condition_status === "sembuh" ? "b" : "g"}`}>
                  {inpatient.condition_status}
                </span>
              </div>
            ) : (
              <form action={admitInpatient} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <input type="hidden" name="visitId" value={visit.id} />
                <div style={{ flex: 2, minWidth: 240 }}>
                  <label className="flab">Rencana tindakan dari dokter PIC *</label>
                  <input className="fi" name="treatment_plan" required placeholder="mis. Infus, monitoring intensif 3 hari, terapi antibiotik" />
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <label className="flab">Dokter PIC</label>
                  <input className="fi" name="doctor_name" defaultValue={visit.dokter ?? ""} placeholder="Drh. ..." />
                </div>
                <button type="submit" className="btn-acc"><i className="ti ti-bed" /> Masukkan Rawat Inap</button>
              </form>
            )}
          </div>
        </>
      ) : (
        <RekamForm visitId={visit.id} petId={visit.pet_id} currentWeight={pet?.weight ?? null} />
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

function ReadField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "var(--td)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--tx)", whiteSpace: "pre-wrap" }}>{value || "—"}</div>
    </div>
  );
}
