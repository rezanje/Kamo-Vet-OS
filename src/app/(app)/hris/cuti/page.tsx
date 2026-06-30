import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { ajukanCuti, updateLeaveStatus } from "./actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type LeaveRow = {
  id: string;
  jenis: string;
  tanggal_mulai: string;
  tanggal_selesai: string | null;
  durasi: number | null;
  alasan: string | null;
  status: string;
  created_at: string;
  employees: Rel<{ nama: string }>;
};

type EmployeeRow = {
  id: string;
  nama: string;
  status: string;
};

const STATUS_BADGE: Record<string, string> = {
  Menunggu: "o",
  Disetujui: "g",
  Ditolak: "r",
};

const JENIS_LIST = ["Cuti", "Izin", "Sakit", "Lembur"];

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default async function CutiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();

  // ponytail: karyawan aktif untuk opsi select form pengajuan.
  const { data: empRaw } = await supabase
    .from("employees")
    .select("id, nama, status")
    .eq("status", "Aktif")
    .order("nama");
  const employees = (empRaw ?? []) as unknown as EmployeeRow[];

  // ponytail: join nama karyawan; urut terbaru di atas.
  const { data: leavesRaw } = await supabase
    .from("leave_requests")
    .select("id, jenis, tanggal_mulai, tanggal_selesai, durasi, alasan, status, created_at, employees(nama)")
    .order("created_at", { ascending: false });
  const leaves = (leavesRaw ?? []) as unknown as LeaveRow[];

  // ponytail: hitung summary counts dari seluruh data.
  const counts = { Menunggu: 0, Disetujui: 0, Ditolak: 0 };
  for (const l of leaves) {
    if (l.status in counts) counts[l.status as keyof typeof counts]++;
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/hris" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Cuti / Lembur / Izin</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success === "1" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Pengajuan berhasil disimpan, menunggu persetujuan.
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
        {([
          { label: "Menunggu", val: counts.Menunggu, color: "#b55a35", bg: "#fdf0ea", icon: "ti-clock" },
          { label: "Disetujui", val: counts.Disetujui, color: "#15803d", bg: "#e8f5ee", icon: "ti-circle-check" },
          { label: "Ditolak", val: counts.Ditolak, color: "#b91c1c", bg: "#fef2f2", icon: "ti-x" },
        ] as const).map((c) => (
          <div key={c.label} className="card" style={{ padding: "11px 13px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: c.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <i className={`ti ${c.icon}`} style={{ color: c.color, fontSize: 15 }} />
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#141413", lineHeight: 1 }}>{c.val}</div>
                <div style={{ fontSize: 9.5, color: "var(--tm)", marginTop: 2 }}>{c.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 01 AJUKAN CUTI / LEMBUR */}
      <div className="crm-sec">
        <SecHeader
          num="01"
          title="AJUKAN CUTI / LEMBUR"
          desc="Isi form berikut untuk mengajukan cuti, izin, sakit, atau lembur."
        />
        <form action={ajukanCuti}>
          <div className="grid2">
            <div>
              <label className="flab">Karyawan *</label>
              <select className="fi" name="employee_id" required>
                <option value="">Pilih karyawan aktif</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nama}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="flab">Jenis *</label>
              <select className="fi" name="jenis" required>
                <option value="">Pilih jenis</option>
                {JENIS_LIST.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="flab">Tanggal Mulai *</label>
              <input className="fi" name="tanggal_mulai" type="date" required />
            </div>
            <div>
              <label className="flab">Tanggal Selesai</label>
              <input className="fi" name="tanggal_selesai" type="date" />
            </div>
            <div>
              <label className="flab">Durasi (hari / jam)</label>
              <input
                className="fi"
                name="durasi"
                type="number"
                min={0}
                step={0.5}
                placeholder="mis. 2 (hari) atau 3 (jam lembur)"
              />
            </div>
            <div>
              <label className="flab">Alasan</label>
              <input className="fi" name="alasan" type="text" placeholder="Keterangan pengajuan (opsional)" />
            </div>
          </div>
          <div style={{ marginTop: 12, borderTop: ".5px solid var(--bd)", paddingTop: 12 }}>
            <button type="submit" className="btn-acc">
              <i className="ti ti-send" /> Ajukan
            </button>
          </div>
        </form>
      </div>

      {/* 02 DAFTAR PENGAJUAN */}
      <div className="crm-sec">
        <SecHeader
          num="02"
          title="DAFTAR PENGAJUAN"
          desc="Seluruh pengajuan cuti, izin, dan lembur karyawan."
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>Jenis</th>
                <th>Mulai</th>
                <th>Selesai</th>
                <th>Durasi</th>
                <th>Alasan</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {leaves.map((l) => {
                const emp = one(l.employees);
                return (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 500, fontSize: 12 }}>{emp?.nama ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{l.jenis}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(l.tanggal_mulai)}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>
                      {l.tanggal_selesai ? fmtDate(l.tanggal_selesai) : "—"}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)", textAlign: "right" }}>
                      {l.durasi != null ? l.durasi : "—"}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)", maxWidth: 180 }}>{l.alasan ?? "—"}</td>
                    <td>
                      <span className={`bge ${STATUS_BADGE[l.status] ?? "x"}`}>{l.status}</span>
                    </td>
                    <td>
                      {l.status === "Menunggu" ? (
                        <div style={{ display: "flex", gap: 5 }}>
                          {/* ponytail: setujui — posting id + status Disetujui ke updateLeaveStatus. */}
                          <form action={updateLeaveStatus}>
                            <input type="hidden" name="id" value={l.id} />
                            <input type="hidden" name="status" value="Disetujui" />
                            <button
                              type="submit"
                              className="btn-acc"
                              style={{ padding: "4px 10px", fontSize: 10.5 }}
                            >
                              Setujui
                            </button>
                          </form>
                          {/* ponytail: tolak — posting id + status Ditolak ke updateLeaveStatus. */}
                          <form action={updateLeaveStatus}>
                            <input type="hidden" name="id" value={l.id} />
                            <input type="hidden" name="status" value="Ditolak" />
                            <button
                              type="submit"
                              className="btn-def"
                              style={{ padding: "4px 10px", fontSize: 10.5, color: "#b91c1c" }}
                            >
                              Tolak
                            </button>
                          </form>
                        </div>
                      ) : (
                        <span style={{ fontSize: 10, color: "var(--td)" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {leaves.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}
                  >
                    Belum ada pengajuan cuti / lembur / izin.
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
