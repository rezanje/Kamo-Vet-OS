import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { simpanKpi } from "./actions";

// ponytail: KPI karyawan per periode — input skor + lihat penilaian kinerja.

type Employee = {
  id: string;
  nama: string;
  jabatan: string | null;
  status: string;
};

type KpiRow = {
  id: string;
  employee_id: string;
  periode: string;
  metrik: string;
  target: number | null;
  realisasi: number | null;
  skor: number;
  catatan: string | null;
  employees: { nama: string; jabatan: string | null } | null;
};

const DEFAULT_PERIODE = "2026-07";

function skorBadge(skor: number) {
  if (skor >= 80) return <span className="bge g" style={{ fontSize: 10, fontWeight: 700 }}>{skor}</span>;
  if (skor >= 60) return <span className="bge b" style={{ fontSize: 10, fontWeight: 700 }}>{skor}</span>;
  if (skor >= 40) return <span className="bge o" style={{ fontSize: 10, fontWeight: 700 }}>{skor}</span>;
  return <span className="bge r" style={{ fontSize: 10, fontWeight: 700 }}>{skor}</span>;
}

function fmt(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("id-ID");
}

export default async function KpiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; periode?: string }>;
}) {
  const { error, success, periode: periodeParam } = await searchParams;
  const periode = periodeParam || DEFAULT_PERIODE;

  const supabase = await createClient();

  // ponytail: ambil karyawan aktif untuk select input.
  const { data: empRaw } = await supabase
    .from("employees")
    .select("id, nama, jabatan, status")
    .eq("status", "Aktif")
    .order("nama");
  const employees = (empRaw ?? []) as unknown as Employee[];

  // ponytail: ambil kpi_records periode terpilih + join employee.
  const { data: kpiRaw } = await supabase
    .from("kpi_records")
    .select("id, employee_id, periode, metrik, target, realisasi, skor, catatan, employees(nama, jabatan)")
    .eq("periode", periode)
    .order("created_at");
  const kpiRows = (kpiRaw ?? []) as unknown as KpiRow[];

  // ponytail: rata-rata skor per karyawan untuk ringkasan.
  const avgMap: Record<string, { nama: string; total: number; count: number }> = {};
  for (const row of kpiRows) {
    const emp = row.employees;
    if (!emp) continue;
    if (!avgMap[row.employee_id]) {
      avgMap[row.employee_id] = { nama: emp.nama, total: 0, count: 0 };
    }
    avgMap[row.employee_id].total += Number(row.skor);
    avgMap[row.employee_id].count += 1;
  }
  const avgEntries = Object.entries(avgMap).map(([id, v]) => ({
    id,
    nama: v.nama,
    avg: Math.round(v.total / v.count),
  }));

  const overallAvg =
    kpiRows.length > 0
      ? Math.round(kpiRows.reduce((s, r) => s + Number(r.skor), 0) / kpiRows.length)
      : null;

  return (
    <>
      {/* Back link */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/hris" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>KPI Karyawan</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success === "1" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Data KPI berhasil disimpan.
        </div>
      )}

      {/* Summary cards */}
      {kpiRows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
          <div className="card" style={{ padding: "11px 13px" }}>
            <div style={{ fontSize: 9.5, color: "var(--tm)" }}>Total Entri KPI</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#141413", marginTop: 3 }}>{kpiRows.length}</div>
          </div>
          <div className="card" style={{ padding: "11px 13px" }}>
            <div style={{ fontSize: 9.5, color: "var(--tm)" }}>Rata-rata Skor</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--acc)", marginTop: 3 }}>
              {overallAvg ?? "—"}
            </div>
          </div>
          <div className="card" style={{ padding: "11px 13px" }}>
            <div style={{ fontSize: 9.5, color: "var(--tm)" }}>Periode</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#141413", marginTop: 3 }}>{periode}</div>
          </div>
        </div>
      )}

      {/* 01 INPUT KPI */}
      <div className="crm-sec">
        <SecHeader
          num="01"
          title="INPUT KPI"
          desc="Tambahkan data penilaian kinerja karyawan untuk periode tertentu."
        />
        <form action={simpanKpi}>
          <div className="grid2">
            <div>
              <label className="flab">Karyawan *</label>
              <select className="fi" name="employee_id" required>
                <option value="">Pilih karyawan aktif</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nama}{e.jabatan ? ` — ${e.jabatan}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="flab">Periode *</label>
              <input
                className="fi"
                name="periode"
                type="month"
                defaultValue={periode}
                required
              />
            </div>
            <div>
              <label className="flab">Metrik *</label>
              <input
                className="fi"
                name="metrik"
                type="text"
                placeholder="mis. Target Penjualan, Kepuasan Pelanggan, Kehadiran"
                required
              />
            </div>
            <div>
              <label className="flab">Skor (0–100) *</label>
              <input
                className="fi"
                name="skor"
                type="number"
                min={0}
                max={100}
                step={1}
                placeholder="0"
                required
              />
            </div>
            <div>
              <label className="flab">Target</label>
              <input
                className="fi"
                name="target"
                type="number"
                step="any"
                placeholder="Nilai target (opsional)"
              />
            </div>
            <div>
              <label className="flab">Realisasi</label>
              <input
                className="fi"
                name="realisasi"
                type="number"
                step="any"
                placeholder="Nilai realisasi (opsional)"
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="flab">Catatan</label>
              <input
                className="fi"
                name="catatan"
                type="text"
                placeholder="Catatan tambahan (opsional)"
              />
            </div>
          </div>
          <div style={{ marginTop: 12, borderTop: ".5px solid var(--bd)", paddingTop: 12 }}>
            <button type="submit" className="btn-acc">
              <i className="ti ti-chart-bar" /> Simpan KPI
            </button>
          </div>
        </form>
      </div>

      {/* 02 PENILAIAN KINERJA */}
      <div className="crm-sec">
        <SecHeader
          num="02"
          title="PENILAIAN KINERJA"
          desc={`Data KPI karyawan untuk periode ${periode}.`}
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                className="fi"
                name="periode"
                type="month"
                defaultValue={periode}
                style={{ fontSize: 11, padding: "4px 8px", height: 30 }}
              />
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>
                Filter
              </button>
            </form>
          }
        />

        {/* Rata-rata per karyawan */}
        {avgEntries.length > 0 && (
          <div style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {avgEntries.map((e) => (
              <div
                key={e.id}
                className="card"
                style={{ padding: "6px 12px", display: "flex", alignItems: "center", gap: 8 }}
              >
                <span style={{ fontSize: 11, fontWeight: 500 }}>{e.nama}</span>
                {skorBadge(e.avg)}
                <span style={{ fontSize: 9.5, color: "var(--tm)" }}>rata-rata</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>Jabatan</th>
                <th>Metrik</th>
                <th style={{ textAlign: "right" }}>Target</th>
                <th style={{ textAlign: "right" }}>Realisasi</th>
                <th style={{ textAlign: "center" }}>Skor</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {kpiRows.map((row) => {
                const emp = row.employees;
                return (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 500, fontSize: 12 }}>{emp?.nama ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{emp?.jabatan ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{row.metrik}</td>
                    <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>
                      {fmt(row.target)}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>
                      {fmt(row.realisasi)}
                    </td>
                    <td style={{ textAlign: "center" }}>{skorBadge(Number(row.skor))}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{row.catatan ?? "—"}</td>
                  </tr>
                );
              })}
              {kpiRows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      textAlign: "center",
                      color: "var(--td)",
                      padding: "20px 0",
                      fontSize: 11,
                    }}
                  >
                    Belum ada data KPI untuk periode {periode}. Tambahkan penilaian di atas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
