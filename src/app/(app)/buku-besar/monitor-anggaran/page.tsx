import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { serapanPeriode } from "@/lib/anggaran-data";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const periodeSekarang = () => new Date().toISOString().slice(0, 7);

const WARNA: Record<string, string> = { aman: "#15803d", waspada: "#b45309", lewat: "#b91c1c" };
const LABEL: Record<string, string> = { aman: "Aman", waspada: "Waspada", lewat: "Lewat anggaran" };
const BADGE: Record<string, string> = { aman: "g", waspada: "o", lewat: "r" };

export default async function MonitorAnggaranPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; cabang?: string }>;
}) {
  const sp = await searchParams;
  const periode = /^\d{4}-\d{2}$/.test(sp.periode ?? "") ? sp.periode! : periodeSekarang();

  const supabase = await createClient();
  const { data: cabData } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
  const cabang = (cabData ?? []) as { id: string; name: string }[];
  const branchId = sp.cabang && cabang.some((c) => c.id === sp.cabang) ? sp.cabang : null;

  const { ringkasan, namaAkun, totalAnggaran, totalRealisasi } = await serapanPeriode(supabase, periode, branchId);
  const persenTotal = totalAnggaran > 0 ? Math.round((totalRealisasi / totalAnggaran) * 100) : 0;
  const lewat = ringkasan.filter((r) => r.status === "lewat");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/buku-besar" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Monitor Anggaran</span>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="01" title={`SERAPAN ${periode}`}
          desc="Realisasi ditarik dari jurnal berjalan — angkanya hidup, tidak menunggu tutup buku."
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="fi" type="month" name="periode" defaultValue={periode} style={{ fontSize: 11, height: 30, width: 140 }} />
              <select className="fi" name="cabang" defaultValue={branchId ?? ""} style={{ fontSize: 11, height: 30, width: 160 }}>
                <option value="">Semua cabang</option>
                {cabang.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Lihat</button>
            </form>
          }
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Kartu label="Total anggaran" nilai={rp(totalAnggaran)} />
          <Kartu label="Terpakai" nilai={rp(totalRealisasi)} warna={persenTotal > 100 ? "#b91c1c" : "#b45309"} />
          <Kartu label="Sisa" nilai={rp(totalAnggaran - totalRealisasi)} warna={totalAnggaran - totalRealisasi < 0 ? "#b91c1c" : "#15803d"} />
          <Kartu label="Serapan" nilai={`${persenTotal}%`} tebal />
        </div>

        {lewat.length > 0 && (
          <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
            <i className="ti ti-alert-circle" /> {lewat.length} pos sudah lewat anggaran:{" "}
            {lewat.map((r) => namaAkun.get(r.coaCode) ?? r.coaCode).join(", ")}.
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Kode</th>
                <th>Pos biaya</th>
                <th style={{ width: 140, textAlign: "right" }}>Anggaran</th>
                <th style={{ width: 140, textAlign: "right" }}>Terpakai</th>
                <th style={{ width: 140, textAlign: "right" }}>Sisa</th>
                <th style={{ width: 150 }}>Serapan</th>
                <th style={{ width: 130 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {ringkasan.map((r) => (
                <tr key={r.coaCode}>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.coaCode}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{namaAkun.get(r.coaCode) ?? "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{r.anggaran > 0 ? rp(r.anggaran) : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(r.realisasi)}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: r.sisa < 0 ? "#b91c1c" : "var(--tm)" }}>
                    {r.anggaran > 0 ? rp(r.sisa) : "—"}
                  </td>
                  <td>
                    {r.anggaran > 0 ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, height: 7, borderRadius: 4, background: "#e5e7eb", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, r.persen)}%`, height: "100%", background: WARNA[r.status] }} />
                        </div>
                        <span style={{ fontSize: 10.5, color: WARNA[r.status], fontWeight: 700, minWidth: 34, textAlign: "right" }}>
                          {r.persen}%
                        </span>
                      </div>
                    ) : (
                      <span style={{ fontSize: 10.5, color: "var(--td)" }}>di luar rencana</span>
                    )}
                  </td>
                  <td><span className={`bge ${BADGE[r.status]}`}>{LABEL[r.status]}</span></td>
                </tr>
              ))}
              {ringkasan.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada anggaran maupun belanja di periode ini.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Kartu({ label, nilai, warna, tebal }: { label: string; nilai: string; warna?: string; tebal?: boolean }) {
  return (
    <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, padding: "8px 14px", minWidth: 140 }}>
      <div style={{ fontSize: 10, color: "var(--tm)" }}>{label}</div>
      <div style={{ fontSize: tebal ? 16 : 14, fontWeight: tebal ? 800 : 700, color: warna ?? "var(--sb)" }}>{nilai}</div>
    </div>
  );
}
