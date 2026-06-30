import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { simpanAbsensi } from "./actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const TODAY = "2026-07-01";

const STATUS_LIST = ["Hadir", "Izin", "Sakit", "Alpha", "Cuti"] as const;
type StatusKey = (typeof STATUS_LIST)[number];

type EmployeeRow = {
  id: string;
  nama: string;
  jabatan: string | null;
  status: string;
};

type AttendanceRow = {
  id: string;
  employee_id: string;
  tanggal: string;
  jam_masuk: string | null;
  jam_pulang: string | null;
  status: StatusKey;
  keterangan: string | null;
  employees: Rel<{ nama: string; jabatan: string | null }>;
};

// ponytail: badge class per status absensi — Hadir=g, Izin/Cuti=b, Sakit=o, Alpha=r.
function statusBadge(s: StatusKey): string {
  if (s === "Hadir") return "g";
  if (s === "Izin" || s === "Cuti") return "b";
  if (s === "Sakit") return "o";
  return "r"; // Alpha
}

export default async function AbsensiPage({
  searchParams,
}: {
  searchParams: Promise<{ tgl?: string; error?: string; success?: string }>;
}) {
  const { tgl, error, success } = await searchParams;
  const tanggalFilter = tgl && tgl.match(/^\d{4}-\d{2}-\d{2}$/) ? tgl : TODAY;

  const supabase = await createClient();

  // ponytail: hanya karyawan aktif yang bisa dipilih di form absensi.
  const { data: empRaw } = await supabase
    .from("employees")
    .select("id, nama, jabatan, status")
    .eq("status", "Aktif")
    .order("nama");
  const employees = (empRaw ?? []) as unknown as EmployeeRow[];

  // ponytail: join employees untuk kolom Karyawan + Jabatan di tabel absensi.
  const { data: attRaw } = await supabase
    .from("attendance")
    .select("id, employee_id, tanggal, jam_masuk, jam_pulang, status, keterangan, employees(nama, jabatan)")
    .eq("tanggal", tanggalFilter)
    .order("employees(nama)");
  const rows = (attRaw ?? []) as unknown as AttendanceRow[];

  // Summary cards untuk tanggal terpilih
  const cntHadir = rows.filter((r) => r.status === "Hadir").length;
  const cntIzin = rows.filter((r) => r.status === "Izin" || r.status === "Cuti").length;
  const cntSakit = rows.filter((r) => r.status === "Sakit").length;
  const cntAlpha = rows.filter((r) => r.status === "Alpha").length;

  const fmtTgl = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("id-ID", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

  return (
    <>
      {/* Back link */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/hris" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Absensi Karyawan</span>
      </div>

      {/* Banners */}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success === "1" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Absensi berhasil disimpan.
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        <StatCard label="Hadir" value={String(cntHadir)} accent />
        <StatCard label="Izin / Cuti" value={String(cntIzin)} />
        <StatCard label="Sakit" value={String(cntSakit)} />
        <StatCard label="Alpha" value={String(cntAlpha)} />
      </div>

      {/* 01 CATAT ABSENSI */}
      <div className="crm-sec">
        <SecHeader num="01" title="CATAT ABSENSI" desc="Catat kehadiran karyawan untuk satu hari." />
        <form action={simpanAbsensi}>
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
              <label className="flab">Tanggal *</label>
              <input className="fi" name="tanggal" type="date" defaultValue={tanggalFilter} required />
            </div>
            <div>
              <label className="flab">Jam Masuk</label>
              <input className="fi" name="jam_masuk" type="time" />
            </div>
            <div>
              <label className="flab">Jam Pulang</label>
              <input className="fi" name="jam_pulang" type="time" />
            </div>
            <div>
              <label className="flab">Status *</label>
              <select className="fi" name="status" defaultValue="Hadir" required>
                {STATUS_LIST.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="flab">Keterangan</label>
              <input className="fi" name="keterangan" type="text" placeholder="mis. Izin keperluan keluarga (opsional)" />
            </div>
          </div>
          <div style={{ marginTop: 12, borderTop: ".5px solid var(--bd)", paddingTop: 12 }}>
            <button type="submit" className="btn-acc">
              <i className="ti ti-clipboard-check" /> Simpan Absensi
            </button>
          </div>
        </form>
      </div>

      {/* 02 DAFTAR ABSENSI */}
      <div className="crm-sec">
        <SecHeader
          num="02"
          title="DAFTAR ABSENSI"
          desc={`Kehadiran karyawan: ${fmtTgl(tanggalFilter)}`}
          action={
            <form method="GET" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="fi"
                name="tgl"
                type="date"
                defaultValue={tanggalFilter}
                style={{ fontSize: 11, padding: "4px 8px", height: 30, width: 140 }}
              />
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>
                <i className="ti ti-filter" /> Terapkan
              </button>
            </form>
          }
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>Jabatan</th>
                <th>Jam Masuk</th>
                <th>Jam Pulang</th>
                <th>Status</th>
                <th>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const emp = one(r.employees);
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500, fontSize: 12 }}>{emp?.nama ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{emp?.jabatan ?? "—"}</td>
                    <td style={{ fontSize: 11, fontFamily: "monospace" }}>{r.jam_masuk ?? "—"}</td>
                    <td style={{ fontSize: 11, fontFamily: "monospace" }}>{r.jam_pulang ?? "—"}</td>
                    <td>
                      <span className={`bge ${statusBadge(r.status)}`}>{r.status}</span>
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.keterangan ?? "—"}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}
                  >
                    Belum ada absensi tercatat untuk tanggal ini.
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

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card" style={{ padding: "11px 13px" }}>
      <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{label}</div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: accent ? "var(--acc)" : "#141413",
          marginTop: 3,
        }}
      >
        {value}
      </div>
    </div>
  );
}
