import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { PenggajianForm } from "./PenggajianForm";

// ponytail: penggajian — proses gaji bulanan per karyawan + auto-jurnal ke akun 5201/1101/2301.

type Employee = { id: string; nama: string; jabatan: string; gaji_pokok: number };

type PayrollRow = {
  periode: string;
  employee_id: string;
  total: number;
};

type PeriodeSummary = {
  periode: string;
  jumlah_karyawan: number;
  total_dibayar: number;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function PenggajianPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const [{ data: empData }, { data: payrollData }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, nama, jabatan, gaji_pokok")
      .eq("status", "Aktif")
      .order("nama"),
    supabase
      .from("payrolls")
      .select("periode, employee_id, total")
      .order("periode", { ascending: false }),
  ]);

  const employees = (empData ?? []) as unknown as Employee[];
  const allPayrolls = (payrollData ?? []) as unknown as PayrollRow[];

  // Aggregate payroll history grouped by periode in JS.
  const periodeMap = new Map<string, PeriodeSummary>();
  for (const row of allPayrolls) {
    const existing = periodeMap.get(row.periode);
    if (existing) {
      existing.jumlah_karyawan += 1;
      existing.total_dibayar   += Number(row.total);
    } else {
      periodeMap.set(row.periode, {
        periode:          row.periode,
        jumlah_karyawan:  1,
        total_dibayar:    Number(row.total),
      });
    }
  }
  // Sort descending by periode string (YYYY-MM sorts lexicographically).
  const riwayat: PeriodeSummary[] = [...periodeMap.values()].sort((a, b) =>
    b.periode.localeCompare(a.periode)
  );

  return (
    <>
      {/* Back link */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/hris" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Penggajian</span>
      </div>

      {/* Banners */}
      {success && (
        <div
          className="p2ban"
          style={{ background: "#f0fdf4", border: ".5px solid #86efac", color: "#15803d", marginBottom: 10 }}
        >
          <i className="ti ti-circle-check" /> Penggajian berhasil diproses dan jurnal akuntansi sudah dicatat.
        </div>
      )}
      {error && (
        <div
          className="p2ban"
          style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginBottom: 10 }}
        >
          <i className="ti ti-alert-circle" /> {decodeURIComponent(error)}
        </div>
      )}

      {/* §01 PROSES PENGGAJIAN */}
      <div className="crm-sec" style={{ marginBottom: 14 }}>
        <SecHeader
          num="01"
          title="PROSES PENGGAJIAN"
          desc="Pilih periode, isi tunjangan & potongan tiap karyawan, lalu proses — jurnal otomatis diposting."
        />
        <PenggajianForm employees={employees} />
      </div>

      {/* §02 RIWAYAT PENGGAJIAN */}
      <div className="crm-sec">
        <SecHeader
          num="02"
          title="RIWAYAT PENGGAJIAN"
          desc="Rekap penggajian per periode — jumlah karyawan dan total dibayarkan."
        />

        {riwayat.length === 0 ? (
          <div style={{ textAlign: "center", padding: "28px 0", color: "var(--td)", fontSize: 12 }}>
            <i
              className="ti ti-calendar-off"
              style={{ fontSize: 26, display: "block", marginBottom: 8, opacity: 0.35 }}
            />
            Belum ada riwayat penggajian.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th>Periode</th>
                  <th style={{ width: 160, textAlign: "center" }}>Jumlah Karyawan</th>
                  <th style={{ width: 180, textAlign: "right" }}>Total Dibayarkan</th>
                </tr>
              </thead>
              <tbody>
                {riwayat.map((r) => (
                  <tr key={r.periode}>
                    <td style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600 }}>
                      {r.periode}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className="bge b" style={{ fontSize: 10 }}>
                        {r.jumlah_karyawan} karyawan
                      </span>
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontFamily: "monospace",
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#16a34a",
                      }}
                    >
                      {rp(r.total_dibayar)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
