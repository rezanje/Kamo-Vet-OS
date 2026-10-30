import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { branchDisplayName } from "@/lib/branch-display";
import { hariIniWIB } from "@/lib/tanggal";
import { normalisasiCari } from "@/lib/karyawan-filter";
import { keadaanPenugasan, labelPenugasan, tanggalSingkat, type KeadaanPenugasan } from "@/lib/employee-assignment";
import { PenugasanCabangForm } from "../PenugasanCabangForm";
import { AkhiriPenugasanForm } from "../AkhiriPenugasanForm";

type Karyawan = { id: string; nama: string; jabatan: string | null; branch_id: string | null };
type Penugasan = {
  employee_id: string; branch_id: string; role: "PRIMARY" | "SECONDARY";
  effective_date: string; end_date: string | null; ended_reason: string | null;
};

const KEADAAN: Record<KeadaanPenugasan, { label: string; warna: string }> = {
  "berjalan": { label: "Berjalan", warna: "g" },
  "akan-datang": { label: "Belum berlaku", warna: "" },
  "berakhir": { label: "Berakhir", warna: "x" },
};
const TAMPILAN = [["aktif", "Berjalan & belum berlaku"], ["semua", "Semua termasuk yang berakhir"], ["berakhir", "Hanya yang berakhir"]] as const;

/**
 * Halaman kecil khusus penugasan lintas cabang.
 *
 * Form ini dulu menempel di daftar Karyawan, dan setiap simpan memaksa seluruh
 * daftar (semua karyawan, semua penugasan, gaji pokok per batch) dirender ulang
 * — keluhan "loading lama" dari Andri. Di sini yang dimuat hanya yang dipakai
 * form dan daftar penugasannya sendiri.
 */
export default async function PenugasanCabangPage({ searchParams }: {
  searchParams: Promise<{ cari?: string; tampil?: string }>;
}) {
  if (!await bolehKelolaMaster()) redirect("/hris/karyawan");
  const { cari: cariRaw, tampil: tampilRaw } = await searchParams;
  const cari = (cariRaw ?? "").trim();
  const tampil = TAMPILAN.some(([nilai]) => nilai === tampilRaw) ? tampilRaw! : "aktif";
  const supabase = await createClient();
  const hariIni = hariIniWIB();

  const [{ data: branchData }, { data: employeeData }, { data: assignmentData, error: assignmentError }] = await Promise.all([
    supabase.from("branches").select("id, code, name, type").eq("is_active", true).order("name"),
    supabase.from("employees").select("id, nama, jabatan, branch_id")
      .eq("status", "Aktif").is("trashed_at", null).order("nama"),
    supabase.from("employee_branch_assignments")
      .select("employee_id, branch_id, role, effective_date, end_date, ended_reason")
      .order("effective_date", { ascending: false }),
  ]);

  const branchCatalog = branchData ?? [];
  const branches = branchCatalog.map(branch => ({ id: branch.id, name: branchDisplayName(branch, branchCatalog) }));
  const namaCabang = new Map(branches.map(branch => [branch.id, branch.name]));
  const karyawan = (employeeData ?? []) as Karyawan[];
  const namaKaryawan = new Map(karyawan.map(row => [row.id, row]));

  const kata = normalisasiCari(cari);
  const baris = ((assignmentData ?? []) as Penugasan[])
    .map(row => ({
      ...row,
      keadaan: keadaanPenugasan(row, hariIni),
      keterangan: labelPenugasan(row, hariIni),
      orang: namaKaryawan.get(row.employee_id),
      cabang: namaCabang.get(row.branch_id) ?? "Cabang tidak ditemukan",
    }))
    .filter(row => {
      if (tampil === "aktif" && row.keadaan === "berakhir") return false;
      if (tampil === "berakhir" && row.keadaan !== "berakhir") return false;
      if (!kata) return true;
      return [row.orang?.nama, row.orang?.jabatan, row.cabang]
        .some(nilai => nilai && normalisasiCari(String(nilai)).includes(kata));
    })
    .sort((a, b) => (a.orang?.nama ?? "").localeCompare(b.orang?.nama ?? "", "id") || a.cabang.localeCompare(b.cabang, "id"));

  return <>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
      <Link href="/hris/karyawan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke Karyawan</Link>
      <span style={{ color: "var(--td)" }}>·</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>Penugasan lintas cabang</span>
    </div>

    <div className="crm-sec">
      <SecHeader num="01" title="TAMBAH PENUGASAN" desc="Satu dokter atau tenaga medis bisa dijadwalkan di beberapa cabang." />
      <PenugasanCabangForm
        employees={karyawan.map(row => ({
          id: row.id, nama: row.nama, jabatan: row.jabatan, branch_id: row.branch_id,
          branchName: row.branch_id ? namaCabang.get(row.branch_id) ?? null : null,
        }))}
        branches={branches}
        today={hariIni}
      />
    </div>

    <div className="crm-sec">
      <SecHeader num="02" title="DAFTAR PENUGASAN" desc="Penugasan yang sedang berjalan, yang belum berlaku, dan yang sudah diakhiri." />
      <form method="get" role="search" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "8px 0 10px" }}>
        <input className="fi" type="search" name="cari" defaultValue={cari} aria-label="Cari penugasan"
          placeholder="Cari nama karyawan, jabatan, atau cabang…" style={{ flex: "1 1 240px", minWidth: 0 }} />
        <select className="fi" name="tampil" defaultValue={tampil} aria-label="Filter keadaan penugasan" style={{ width: 230 }}>
          {TAMPILAN.map(([nilai, label]) => <option key={nilai} value={nilai}>{label}</option>)}
        </select>
        <button type="submit" className="btn-def"><i className="ti ti-search" /> Cari</button>
        {(cari || tampilRaw) && <Link href="/hris/karyawan/penugasan" className="btn-def">Reset</Link>}
        <span style={{ fontSize: 11, color: "var(--tm)" }}>{baris.length} penugasan</span>
      </form>
      {assignmentError ? <p role="alert">Daftar penugasan gagal dimuat. Muat ulang halaman.</p> : <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th>Karyawan</th><th>Cabang</th><th>Jenis</th><th>Mulai</th><th>Keadaan</th><th>Alasan berakhir</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {baris.map(row => <tr key={`${row.employee_id}-${row.branch_id}`}>
              <td style={{ fontWeight: 500, fontSize: 12 }}>
                <Link href={`/hris/karyawan/${row.employee_id}`}>{row.orang?.nama ?? "Karyawan nonaktif/terhapus"}</Link>
                <div style={{ fontSize: 10, color: "var(--tm)" }}>{row.orang?.jabatan ?? "—"}</div>
              </td>
              <td style={{ fontSize: 11 }}>{row.cabang}</td>
              <td style={{ fontSize: 11, color: "var(--tm)" }}>{row.role === "PRIMARY" ? "Cabang utama" : "Tambahan"}</td>
              <td style={{ fontSize: 11 }}>{tanggalSingkat(row.effective_date, hariIni)}</td>
              <td>
                <span className={`bge ${KEADAAN[row.keadaan].warna}`}>{KEADAAN[row.keadaan].label}</span>
                {row.keterangan && <div style={{ fontSize: 10, color: "var(--tm)" }}>{row.keterangan}</div>}
              </td>
              <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{row.ended_reason ?? "—"}</td>
              <td>
                {row.role === "PRIMARY"
                  ? <span style={{ fontSize: 10.5, color: "var(--tm)" }}>Ubah lewat Edit Karyawan</span>
                  : row.end_date
                    ? <span style={{ fontSize: 10.5, color: "var(--tm)" }}>Sudah diakhiri</span>
                    : <AkhiriPenugasanForm employeeId={row.employee_id} branchId={row.branch_id}
                        branchName={row.cabang} today={hariIni} minDate={row.effective_date} />}
              </td>
            </tr>)}
            {!baris.length && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>
              Tidak ada penugasan yang cocok dengan saringan ini.
            </td></tr>}
          </tbody>
        </table>
      </div>}
      <p style={{ fontSize: 10.5, color: "var(--tm)" }}>
        Penugasan yang diakhiri tetap tersimpan sebagai riwayat. Menugaskan orang yang sama ke cabang yang sama lagi akan membuka kembali barisnya dengan tanggal mulai baru.
      </p>
    </div>
  </>;
}
