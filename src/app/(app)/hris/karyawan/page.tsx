import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { simpanKaryawan, simpanPenugasanCabang } from "./actions";
import { tampilkanKaryawan } from "@/lib/karyawan-master";
import { resolveOperationalScope } from "@/lib/operational-access";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

type EmployeeRow = {
  id: string;
  nik: string | null;
  nama: string;
  jabatan: string | null;
  departemen: string | null;
  gaji_pokok: number;
  status: string;
  branch_id: string | null;
};

const STATUS_LIST = ["Aktif", "Nonaktif"];

export default async function KaryawanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; cari?: string }>;
}) {
  const { error, success, cari } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();
  const scope = await resolveOperationalScope(supabase);

  let branchQuery = supabase
    .from("branches")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (scope.branchIds !== null) {
    branchQuery = scope.branchIds.length ? branchQuery.in("id", scope.branchIds) : branchQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  const { data: branches } = await branchQuery;

  // Nama cabang dipetakan di aplikasi. Master karyawan tetap muncul bila relasi
  // cabang di database belum terbaca oleh layar daftar.
  const [{ data: rowsRaw, error: employeeQueryError }, { data: assignmentsRaw, error: assignmentQueryError }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, nik, nama, jabatan, departemen, gaji_pokok, status, branch_id")
      // `cari` datang dari pencarian global di topbar.
      .or(cari ? `nama.ilike.%${cari}%,nik.ilike.%${cari}%` : "nama.not.is.null")
      .order("nama"),
    supabase
      .from("employee_branch_assignments")
      .select("employee_id, branch_id, role, effective_date")
      .order("role")
      .order("effective_date"),
  ]);
  const rows = tampilkanKaryawan(
    (rowsRaw ?? []) as unknown as EmployeeRow[],
    (branches ?? []) as { id: string; name: string }[],
    (assignmentsRaw ?? []) as { employee_id: string; branch_id: string; role: "PRIMARY" | "SECONDARY"; effective_date: string }[],
  );

  const total = rows.length;
  const aktif = rows.filter((r) => r.status === "Aktif").length;
  const nonaktif = rows.filter((r) => r.status === "Nonaktif").length;
  const loadError = employeeQueryError || assignmentQueryError
    ? "Data karyawan belum dapat dimuat. Periksa hak akses cabang atau coba lagi."
    : null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/hris" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Master Karyawan</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {loadError && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {loadError}
        </div>
      )}
      {success === "1" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Data karyawan berhasil disimpan.
        </div>
      )}
      {success === "assignment" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Penugasan cabang berhasil disimpan.
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
        <StatCard label="Total Karyawan" value={String(total)} />
        <StatCard label="Karyawan Aktif" value={String(aktif)} accent />
        <StatCard label="Karyawan Nonaktif" value={String(nonaktif)} />
      </div>

      {/* 01 TAMBAH KARYAWAN */}
      <div className="crm-sec">
        <SecHeader num="01" title="TAMBAH KARYAWAN" desc="Tambahkan data karyawan baru ke master HRIS." />
        <form action={simpanKaryawan}>
          <div className="grid2">
            <div>
              <label className="flab">NIK</label>
              <input className="fi" name="nik" type="text" placeholder="Nomor Induk Karyawan (opsional)" />
            </div>
            <div>
              <label className="flab">Nama *</label>
              <input className="fi" name="nama" type="text" placeholder="Nama lengkap karyawan" required />
            </div>
            <div>
              <label className="flab">Jabatan</label>
              <input className="fi" name="jabatan" type="text" placeholder="mis. Dokter Hewan, Kasir" />
            </div>
            <div>
              <label className="flab">Departemen</label>
              <input className="fi" name="departemen" type="text" placeholder="mis. Medis, Operasional" />
            </div>
            <div>
              <label className="flab">Cabang</label>
              <select className="fi" name="branch_id">
                <option value="">Pilih cabang (opsional)</option>
                {(branches ?? []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="flab">No. HP</label>
              <input className="fi" name="phone" type="tel" placeholder="08xx-xxxx-xxxx" />
            </div>
            <div>
              <label className="flab">Email</label>
              <input className="fi" name="email" type="email" placeholder="email@klinik.com" />
            </div>
            <div>
              <label className="flab">Tanggal Masuk</label>
              <input className="fi" name="tgl_masuk" type="date" />
            </div>
            <div>
              <label className="flab">Gaji Pokok (Rp)</label>
              <input className="fi" name="gaji_pokok" type="number" min={0} step={50000} placeholder="3000000" />
            </div>
            <div>
              <label className="flab">Status</label>
              <select className="fi" name="status" defaultValue="Aktif">
                {STATUS_LIST.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12, borderTop: ".5px solid var(--bd)", paddingTop: 12 }}>
            <button type="submit" className="btn-acc">
              <i className="ti ti-plus" /> Simpan Karyawan
            </button>
          </div>
        </form>
      </div>

      {bolehKelola && (
        <div className="crm-sec">
          <SecHeader num="02" title="PENUGASAN LINTAS CABANG" desc="Satu dokter atau tenaga medis bisa dijadwalkan di beberapa cabang." />
          <form action={simpanPenugasanCabang}>
            <div className="grid2">
              <div>
                <label className="flab">Karyawan *</label>
                <select className="fi" name="employee_id" required>
                  <option value="">Pilih karyawan aktif</option>
                  {rows.filter((r) => r.status === "Aktif").map((r) => <option key={r.id} value={r.id}>{r.nama} · {r.jabatan ?? "—"}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Cabang *</label>
                <select className="fi" name="branch_id" required>
                  <option value="">Pilih cabang</option>
                  {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="flab">Jenis Penugasan</label>
                <select className="fi" name="role" defaultValue="SECONDARY">
                  <option value="SECONDARY">Cabang tambahan</option>
                </select>
              </div>
              <div>
                <label className="flab">Mulai Berlaku</label>
                <input className="fi" name="effective_date" type="date" />
              </div>
            </div>
            <div style={{ marginTop: 12 }}><button type="submit" className="btn-acc"><i className="ti ti-git-branch" /> Simpan Penugasan</button></div>
          </form>
        </div>
      )}

      {/* 02 DAFTAR KARYAWAN */}
      <div className="crm-sec">
        <SecHeader num="03" title="DAFTAR KARYAWAN" desc="Seluruh karyawan diurutkan berdasarkan nama." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th>NIK</th>
                <th>Nama</th>
                <th>Jabatan</th>
                <th>Departemen</th>
                <th>Cabang</th>
                <th>Penugasan</th>
                <th style={{ textAlign: "right" }}>Gaji Pokok</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tugas = r.assignments;
                return (
                  <tr key={r.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 10, color: "var(--tm)" }}>
                      {r.nik ?? "—"}
                    </td>
                    <td style={{ fontWeight: 500, fontSize: 12 }}>{r.nama}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.jabatan ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.departemen ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{r.branchName}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                      {tugas.length ? tugas.map((t) => `${t.branchName}${t.role === "PRIMARY" ? " (utama)" : ""}`).join(", ") : "—"}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>
                      {rp(Number(r.gaji_pokok))}
                    </td>
                    <td>
                      <span className={`bge ${r.status === "Aktif" ? "g" : "x"}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}
                  >
                    Belum ada data karyawan. Tambahkan karyawan pertama di atas.
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
      <div style={{ fontSize: 20, fontWeight: 700, color: accent ? "var(--acc)" : "#141413", marginTop: 3 }}>
        {value}
      </div>
    </div>
  );
}
