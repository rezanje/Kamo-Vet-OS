import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CONDITION_LABEL, ripWaMessage, type Condition } from "@/lib/inpatient";
import { hasSignedConsent } from "@/lib/consent";
import { changeCondition, sendRipWa } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const COND_BADGE: Record<string, string> = { stabil: "g", kritis: "r", sembuh: "b", rip: "r" };
// warna box KONDISI besar (referensi): stabil hijau, kritis merah, sembuh biru, rip merah.
const COND_BOX: Record<string, { fg: string; bg: string; bd: string }> = {
  stabil: { fg: "#15803d", bg: "#f0fdf4", bd: "#bbf7d0" },
  kritis: { fg: "#b91c1c", bg: "#fef2f2", bd: "#fca5a5" },
  sembuh: { fg: "#1d4ed8", bg: "#eff6ff", bd: "#bfdbfe" },
  rip: { fg: "#b91c1c", bg: "#fef2f2", bd: "#fca5a5" },
};

function petAge(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const d = new Date(dob), now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months--;
  if (months < 0) return null;
  const y = Math.floor(months / 12), m = months % 12;
  return y >= 1 ? `${y} Tahun ${m} Bulan` : `${m} Bulan`;
}

// Detail rawat inap: laporan harian append-only + ubah kondisi + review WA RIP.
// Designs: klinik/09 (laporan), klinik/10 (form harian + "Tambah Kondisi: Sembuh, Stabil, Kritis, RIP").
export default async function RawatInapDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string; wa?: string }>;
}) {
  const { id } = await params;
  const { error, success, wa } = await searchParams;
  const supabase = await createClient();

  const { data: rec } = await supabase
    .from("inpatient_records")
    .select(`id, condition_status, treatment_plan, doctor_name, admitted_at, discharged_at, visit_id,
      branches(name), visits(id, poli, keluhan, created_at, pets(name, species, breed, dob, weight, photo_url), customers(name, phone, address))`)
    .eq("id", id).maybeSingle();
  if (!rec) notFound();

  const visit = one(rec.visits as Rel<{ id: string; poli: string; keluhan: string | null; created_at: string; pets: Rel<{ name: string; species: string | null; breed: string | null; dob: string | null; weight: number | null; photo_url: string | null }>; customers: Rel<{ name: string; phone: string; address: string | null }> }>);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);
  const branch = one(rec.branches as Rel<{ name: string }>);

  // Rawat inap = tindakan berisiko. Sistem belum bisa mendeteksi jenis tindakan otomatis
  // (jasa masih teks bebas), jadi ini peringatan — bukan pemblokir (spec 2026-07-20).
  const { data: consentRows } = await supabase
    .from("consents").select("status").eq("visit_id", rec.visit_id as string);
  const consentBelum = !hasSignedConsent((consentRows ?? []) as { status: string }[]);

  const [{ data: logs }, { data: statusLog }, { data: me }] = await Promise.all([
    supabase.from("inpatient_daily_logs").select("id, log_date, condition_note, tindakan, keterangan, doctor_name, created_at, updated_at")
      .eq("inpatient_record_id", id).order("created_at", { ascending: false }),
    supabase.from("inpatient_status_log").select("previous_status, new_status, notes, changed_at, profiles(full_name)")
      .eq("inpatient_record_id", id).order("changed_at", { ascending: false }),
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
    })(),
  ]);

  const cond = rec.condition_status as Condition;
  const isDoctor = me?.data?.role === "DOCTOR";
  const active = !rec.discharged_at;
  const age = petAge(pet?.dob);
  const box = COND_BOX[cond] ?? COND_BOX.stabil;
  const admitDate = new Date(rec.admitted_at);
  const noRM = visit
    ? `R/${new Date(visit.created_at).getFullYear()}/${new Date(visit.created_at).toISOString().slice(5, 10).replace("-", "")}/${(rec.visit_id as string).slice(0, 3).toUpperCase()}`
    : "—";
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtT = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href="/klinik/rawat-inap" className="back-btn"><i className="ti ti-arrow-left" /> Status Rawat Inap</Link>
      </div>

      {/* Judul besar (gaya referensi) */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-bed" style={{ fontSize: 22, color: "#2563eb" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>LAPORAN RAWAT INAP</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Jika pasien dirawat inap, dibuat laporan harian</div>
        </div>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "admit" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Pasien masuk rawat inap.</div>}
      {success === "log" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Laporan harian tercatat (append-only).</div>}
      {success === "logedit" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Catatan dikoreksi — isi lama tersimpan di riwayat koreksi.</div>}
      {success === "status" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Kondisi pasien diperbarui & tercatat di log.</div>}
      {success === "wa" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-brand-whatsapp" /> WA duka terkirim ke pemilik.</div>}
      {consentBelum && (
        <div className="p2ban" style={{ justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <i className="ti ti-file-alert" /> Belum ada form persetujuan yang ditandatangani untuk kunjungan ini.
          </span>
          {visit && (
            <Link href={`/klinik/rekam-medis/${visit.id}`} className="btn-acc" style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>
              Buat Form Persetujuan
            </Link>
          )}
        </div>
      )}

      {/* Review WA RIP — spec §3: single doctor approval + review sebelum kirim, BUKAN auto-send. */}
      {cond === "rip" && wa === "review" && (
        <div className="card" style={{ marginBottom: 12, borderColor: "#fca5a5", background: "#fff7f7" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#b91c1c", marginBottom: 6 }}>
            <i className="ti ti-brand-whatsapp" /> REVIEW PESAN WA SEBELUM KIRIM (template duka — bukan template rutin)
          </div>
          <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", background: "#fff", border: ".5px solid var(--bd)", borderRadius: 8, padding: 12, fontFamily: "inherit" }}>
            {ripWaMessage(pet?.name ?? "anabul Anda", cust?.name ?? "Pemilik", branch?.name ?? "klinik kami")}
          </pre>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <form action={sendRipWa}>
              <input type="hidden" name="recordId" value={rec.id} />
              <SubmitButton className="btn-acc" icon="ti-send" style={{ background: "#16a34a", borderColor: "#16a34a" }} pendingText="Mengirim…">Kirim WA ke {cust?.phone ?? "—"}</SubmitButton>
            </form>
            <Link href={`/klinik/rawat-inap/${rec.id}`} className="btn-def" style={{ textDecoration: "none" }}>Nanti saja</Link>
          </div>
        </div>
      )}

      {/* Kartu pasien besar (gaya referensi) */}
      <div className="card" style={{ marginBottom: 14, padding: 20 }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ width: 120, height: 120, borderRadius: 12, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
            {pet?.photo_url
              ? <img src={pet.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <i className="ti ti-paw" style={{ fontSize: 48, color: "var(--td)" }} />}
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--sb)", marginBottom: 10 }}>
              {pet?.name ?? "—"} <span style={{ fontWeight: 600, color: "var(--tm)", fontSize: 16 }}>({pet?.species ?? "—"})</span>
            </div>
            <PairRow label="Pemilik" value={cust?.name} />
            <PairRow label="Jenis" value={`${pet?.species ?? "—"}${pet?.breed ? ` / ${pet.breed}` : ""}`} />
            <PairRow label="Usia" value={age} />
            <PairRow label="Berat" value={pet?.weight != null ? `${pet.weight} kg` : null} />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <PairRow label="Tanggal Masuk" value={fmtDate(rec.admitted_at)} />
            <PairRow label="No. Rekam Medis" value={noRM} />
            <PairRow label="Dokter PIC" value={rec.doctor_name} />
            {rec.discharged_at && <PairRow label="Tanggal Keluar" value={fmtDate(rec.discharged_at)} />}
          </div>
          <div style={{ width: 180, border: `1px solid ${box.bd}`, background: box.bg, borderRadius: 12, padding: 16, textAlign: "center", flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tm)", letterSpacing: ".05em", marginBottom: 10 }}>KONDISI</div>
            <div style={{ display: "inline-block", border: `1px solid ${box.bd}`, background: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 15, fontWeight: 700, color: box.fg }}>
              {CONDITION_LABEL[cond]}
            </div>
          </div>
        </div>
      </div>

      {/* Ubah kondisi — 4 status (§3), RIP hanya dokter (server-side check juga). */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".04em", marginBottom: 8 }}>
          <i className="ti ti-heart-rate-monitor" /> UBAH KONDISI PASIEN
        </div>
        <form action={changeCondition} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input type="hidden" name="recordId" value={rec.id} />
          <div>
            <label className="flab">Kondisi baru</label>
            <div style={{ display: "flex", gap: 5 }}>
              {(["stabil", "kritis", "sembuh", "rip"] as const).map((s) => (
                <label key={s} className="back-btn" style={{
                  padding: "6px 13px", borderRadius: 7, border: ".5px solid var(--bd)", cursor: "pointer", fontSize: 11,
                  background: s === cond ? "var(--sb)" : "#fff", color: s === cond ? "#fff" : s === "rip" ? "#b91c1c" : "var(--tm)",
                }}>
                  <input type="radio" name="new_status" value={s} defaultChecked={s === cond} style={{ marginRight: 5 }} />
                  {CONDITION_LABEL[s]}
                </label>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="flab">Catatan perubahan</label>
            <input className="fi" name="notes" placeholder="mis. respon terapi baik / henti jantung" />
          </div>
          <SubmitButton className="btn-acc" icon="ti-check" pendingText="Menyimpan…">Simpan Kondisi</SubmitButton>
        </form>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>
          Transisi ke RIP hanya oleh dokter{isDoctor ? "" : " (akun ini bukan dokter)"} · sembuh → lanjut pembayaran; RIP → invoice tetap terbit (tidak diblokir).
        </div>
        {cond === "sembuh" && visit && (
          <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d", marginTop: 10, justifyContent: "space-between" }}>
            <span><i className="ti ti-paw" /> Boleh pulang — lanjutkan ke pembayaran.</span>
            <Link href={`/klinik/pembayaran/${visit.id}`} className="btn-acc" style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>
              Buat Invoice <i className="ti ti-arrow-right" />
            </Link>
          </div>
        )}
        {cond === "rip" && visit && wa !== "review" && (
          <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginTop: 10, justifyContent: "space-between" }}>
            <span><i className="ti ti-heart-off" /> Pasien meninggal — biaya perawatan tetap tertagih.</span>
            <span style={{ display: "flex", gap: 6 }}>
              <Link href={`/klinik/rawat-inap/${rec.id}?wa=review`} className="btn-def" style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>
                <i className="ti ti-brand-whatsapp" /> Review WA Duka
              </Link>
              <Link href={`/klinik/pembayaran/${visit.id}`} className="btn-acc" style={{ padding: "4px 12px", fontSize: 11, textDecoration: "none" }}>
                Buat Invoice <i className="ti ti-arrow-right" />
              </Link>
            </span>
          </div>
        )}
      </div>

      {/* Laporan rawat inap harian — tabel utama (gaya referensi) */}
      <div className="crm-sec">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-clipboard-list" style={{ fontSize: 18, color: "#2563eb" }} />
            <div style={{ fontSize: 13, fontWeight: 800, color: "#2563eb", letterSpacing: ".02em" }}>LAPORAN RAWAT INAP HARIAN</div>
          </div>
          {active && (
            <Link href={`/klinik/rawat-inap/${rec.id}/catatan`} className="btn-acc" style={{ textDecoration: "none", background: "#2563eb" }}>
              <i className="ti ti-plus" /> Tambah
            </Link>
          )}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead><tr><th>Tanggal</th><th>Waktu</th><th>Kondisi Pasien</th><th>Tindakan</th><th>Keterangan</th><th>Oleh</th><th style={{ textAlign: "center" }}>Detail</th></tr></thead>
            <tbody>
              {(logs ?? []).map((l, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{fmtDate(l.created_at)}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)", whiteSpace: "nowrap" }}>{fmtT(l.created_at)}</td>
                  <td style={{ fontSize: 11.5 }}>
                    {l.condition_note}
                    {l.updated_at && <span className="bge o" style={{ marginLeft: 5, fontSize: 8 }} title="Catatan pernah dikoreksi">diedit</span>}
                  </td>
                  <td style={{ fontSize: 11.5 }}>{l.tindakan ?? "—"}</td>
                  <td style={{ fontSize: 11.5, color: "var(--tm)" }}>{l.keterangan ?? "—"}</td>
                  <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{l.doctor_name ?? "—"}</td>
                  <td style={{ textAlign: "center" }}>
                    <Link href={`/klinik/rawat-inap/${rec.id}/catatan/${l.id}`} title="Lihat detail"
                      style={{ display: "inline-flex", width: 26, height: 26, borderRadius: 6, border: "1px solid #bfdbfe", color: "#2563eb", background: "#fff", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
                      <i className="ti ti-eye" />
                    </Link>
                  </td>
                </tr>
              ))}
              {(logs ?? []).length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Belum ada catatan harian.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="crm-sec">
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".04em", marginBottom: 8 }}>
          <i className="ti ti-history" /> LOG PERUBAHAN STATUS
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 420 }}>
            <thead><tr><th>Waktu</th><th>Dari</th><th>Ke</th><th>Oleh</th><th>Catatan</th></tr></thead>
            <tbody>
              {(statusLog ?? []).map((s, i) => {
                const by = one(s.profiles as Rel<{ full_name: string | null }>);
                return (
                  <tr key={i}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)", whiteSpace: "nowrap" }}>{new Date(s.changed_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td style={{ fontSize: 11 }}>{s.previous_status ?? "—"}</td>
                    <td><span className={`bge ${COND_BADGE[s.new_status] ?? "o"}`}>{s.new_status}</span></td>
                    <td style={{ fontSize: 10.5 }}>{by?.full_name ?? "—"}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{s.notes ?? "—"}</td>
                  </tr>
                );
              })}
              {(statusLog ?? []).length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--td)", padding: "14px 0", fontSize: 11 }}>Belum ada perubahan status.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function PairRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 6, padding: "4px 0", fontSize: 12.5 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ color: "var(--tx)", fontWeight: 500 }}>: {value || "—"}</span>
    </div>
  );
}
