import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { CONDITION_LABEL } from "@/lib/inpatient";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const COND_BADGE: Record<string, string> = { stabil: "g", kritis: "r", sembuh: "b", rip: "r" };

// Dashboard Status Rawat Inap — design klinik/08 (card counter + filter cabang + tabel).
export default async function RawatInapPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; filter?: string }>;
}) {
  const { branch = "", filter = "aktif" } = await searchParams;
  const supabase = await createClient();

  const { data: branches } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");

  let query = supabase
    .from("inpatient_records")
    .select("id, condition_status, admitted_at, discharged_at, doctor_name, treatment_plan, branches(name), visits(pets(name, species, breed), customers(name, phone))")
    .order("admitted_at", { ascending: false });
  if (branch) query = query.eq("branch_id", branch);
  if (filter === "aktif") query = query.is("discharged_at", null);

  const { data: records } = await query;

  // Card counters (§3 dashboard req) — dihitung dari query terpisah tanpa filter tabel.
  let counterQ = supabase.from("inpatient_records").select("condition_status, admitted_at, discharged_at");
  if (branch) counterQ = counterQ.eq("branch_id", branch);
  const { data: allRecs } = await counterQ;
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const counts = {
    total: (allRecs ?? []).filter((r) => !r.discharged_at).length,
    hariIni: (allRecs ?? []).filter((r) => new Date(r.admitted_at) >= startOfDay).length,
    sembuh: (allRecs ?? []).filter((r) => r.condition_status === "sembuh").length,
    kritis: (allRecs ?? []).filter((r) => r.condition_status === "kritis" && !r.discharged_at).length,
  };

  const lamaInap = (admitted: string) => {
    const days = Math.max(1, Math.ceil((Date.now() - new Date(admitted).getTime()) / 86400000));
    return `${days} Hari`;
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Status Rawat Inap</span>
        <form method="GET" style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <input type="hidden" name="filter" value={filter} />
          <label style={{ fontSize: 10.5, color: "var(--tm)" }}>Pilih Cabang</label>
          {/* ponytail: GET form + tombol Terapkan, tanpa client component */}
          <select className="fi" name="branch" defaultValue={branch} style={{ width: 190, fontSize: 11 }}>
            <option value="">Semua Cabang</option>
            {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button type="submit" className="btn-acc" style={{ padding: "5px 12px", fontSize: 10.5 }}>
            <i className="ti ti-refresh" /> Terapkan
          </button>
        </form>
      </div>

      {/* Card counters (design 08) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        {([
          { label: "TOTAL RAWAT INAP", val: counts.total, color: "#1d4ed8", bg: "#eff6ff", icon: "ti-bed" },
          { label: "RAWAT INAP HARI INI", val: counts.hariIni, color: "#d97706", bg: "#fffbeb", icon: "ti-clock" },
          { label: "SEMBUH / BOLEH PULANG", val: counts.sembuh, color: "#15803d", bg: "#e8f5ee", icon: "ti-paw" },
          { label: "KRITIS", val: counts.kritis, color: "#b91c1c", bg: "#fef2f2", icon: "ti-alert-circle" },
        ] as const).map((c) => (
          <div key={c.label} className="card" style={{ padding: "13px 15px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: c.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <i className={`ti ${c.icon}`} style={{ color: c.color, fontSize: 18 }} />
            </div>
            <div>
              <div style={{ fontSize: 9, color: "var(--tm)", fontWeight: 700, letterSpacing: ".04em" }}>{c.label}</div>
              <div style={{ fontSize: 21, fontWeight: 800, color: "#141413", lineHeight: 1.1 }}>{c.val} <span style={{ fontSize: 10, fontWeight: 400, color: "var(--td)" }}>Pasien</span></div>
            </div>
          </div>
        ))}
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="DAFTAR PASIEN RAWAT INAP" desc="Pantau pasien yang sedang dirawat inap di setiap cabang." />

        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {[
            { key: "aktif", label: "Sedang Dirawat" },
            { key: "semua", label: "Semua (termasuk pulang)" },
          ].map((t) => (
            <Link key={t.key} href={`/klinik/rawat-inap?filter=${t.key}${branch ? `&branch=${branch}` : ""}`} className="back-btn"
              style={{ padding: "5px 12px", borderRadius: 7, border: ".5px solid var(--bd)",
                background: filter === t.key ? "var(--sb)" : "#fff", color: filter === t.key ? "#fff" : "var(--tm)" }}>
              {t.label}
            </Link>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr><th>Pasien</th><th>Pemilik</th><th>Cabang</th><th>Dokter PIC</th><th>Tanggal Masuk</th><th>Lama Inap</th><th>Kondisi</th><th>Catatan</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {(records ?? []).map((r) => {
                const visit = one(r.visits as Rel<{ pets: Rel<{ name: string; species: string | null; breed: string | null }>; customers: Rel<{ name: string; phone: string }> }>);
                const pet = one(visit?.pets ?? null);
                const cust = one(visit?.customers ?? null);
                const br = one(r.branches as Rel<{ name: string }>);
                return (
                  <tr key={r.id}>
                    <td><div style={{ fontWeight: 600 }}>{pet?.name ?? "—"}</div><div style={{ fontSize: 10, color: "var(--tm)" }}>{pet?.species}{pet?.breed ? ` / ${pet.breed}` : ""}</div></td>
                    <td><div style={{ fontSize: 11.5 }}>{cust?.name ?? "—"}</div><div style={{ fontSize: 10, color: "var(--tm)" }}>{cust?.phone}</div></td>
                    <td style={{ fontSize: 11 }}>{br?.name ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{r.doctor_name ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{new Date(r.admitted_at).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td style={{ fontSize: 11 }}>{r.discharged_at ? "Pulang" : lamaInap(r.admitted_at)}</td>
                    <td><span className={`bge ${COND_BADGE[r.condition_status] ?? "o"}`}>{CONDITION_LABEL[r.condition_status as keyof typeof CONDITION_LABEL] ?? r.condition_status}</span></td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)", maxWidth: 160 }}>{r.treatment_plan ?? "—"}</td>
                    <td>
                      <Link href={`/klinik/rawat-inap/${r.id}`} className="btn-acc" style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>
                        <i className="ti ti-eye" /> Detail
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {(records ?? []).length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>Tidak ada pasien rawat inap.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
