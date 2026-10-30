import { NumberInput } from "@/components/NumberInput";
import { MasterLifecycleActions } from "@/components/MasterLifecycleActions";
import { masterView, visibleMasters, type LifecycleRow } from "@/lib/master-lifecycle";
import { GRUP_JABATAN, saringKaryawan } from "@/lib/karyawan-filter";
import Link from "next/link";
import { EmployeeOccupationField } from "@/components/EmployeeOccupationField";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { bolehKelolaMaster, bolehKelolaPayroll, bolehLihatGaji } from "@/lib/master-guard";
import { bacaGajiPokok } from "@/lib/employee-salary";
import { simpanKaryawan } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";
import { tampilkanKaryawan, type PenugasanKaryawan } from "@/lib/karyawan-master";
import { penugasanBerlaku } from "@/lib/employee-assignment";
import { branchDisplayName } from "@/lib/branch-display";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

type EmployeeRow = {
  id: string;
  nik: string | null;
  nama: string;
  jabatan: string | null;
  departemen: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  branch_id: string | null;
} & LifecycleRow;

const STATUS_LIST = ["Aktif", "Nonaktif"];
// Kotak status di form pencarian memakai parameter `view` yang sama dengan daftar master lain.
const TAMPILAN_LIST = [["all", "Semua (tanpa Sampah)"], ["active", "Aktif"], ["inactive", "Nonaktif"], ["trash", "Sampah"]] as const;

export default async function KaryawanPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; cari?: string; q?: string; view?: string; cabang?: string; peran?: string }>;
}) {
  const { error, success, cari: cariRaw, q, view: viewRaw, cabang: cabangFilter, peran } = await searchParams;
  // `cari` dipakai pencarian global di topbar; `q` diterima sebagai alias.
  const cari = (cariRaw ?? q ?? "").trim();
  const view = masterView(viewRaw);
  const supabase = await createClient();

  // Ketiga guard memakai pemeriksaan peran yang sama (dimemo per permintaan), dan
  // ketiga pembacaan master tidak saling bergantung — semuanya jalan berbarengan.
  // Nama cabang dipetakan di aplikasi. Master karyawan tetap muncul bila relasi
  // cabang di database belum terbaca oleh layar daftar.
  const [bolehKelola, lihatGaji, aturGaji, { data: branches }, { data: rowsRaw }, { data: assignmentsRaw }] = await Promise.all([
    bolehKelolaMaster(),
    bolehLihatGaji(),
    bolehKelolaPayroll(),
    supabase
      .from("branches")
      .select("id, code, name, type")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("employees")
      // Pencarian & penyaringan dikerjakan di server atas seluruh daftar supaya
      // satu kotak cari bisa mencakup jabatan, cabang, no HP, dan email sekaligus.
      .select("id, nik, nama, jabatan, departemen, phone, email, status, branch_id, trashed_at, lifecycle_revision")
      .order("nama"),
    supabase
      .from("employee_branch_assignments")
      .select("employee_id, branch_id, role, effective_date, end_date")
      .order("role")
      .order("effective_date"),
  ]);
  const branchCatalog = branches ?? [];
  const displayBranches = branchCatalog.map(branch => ({ ...branch, name: branchDisplayName(branch, branchCatalog) }));
  const semuaKaryawan = (rowsRaw ?? []) as unknown as EmployeeRow[];
  const hariIni = hariIniWIB();
  const semuaPenugasan = (assignmentsRaw ?? []) as PenugasanKaryawan[];
  const dalamTampilan = tampilkanKaryawan(
    visibleMasters(semuaKaryawan, view, row => row.status === "Aktif"),
    displayBranches,
    semuaPenugasan,
    hariIni,
  );
  const rows = saringKaryawan(dalamTampilan, { cari, cabang: cabangFilter, grup: peran });
  const adaSaringan = Boolean(cari || cabangFilter || peran || viewRaw);

  const gajiPer = lihatGaji ? await bacaGajiPokok(supabase, rows.map((r) => r.id)) : new Map<string, number>();

  // Kartu ringkasan selalu menggambarkan seluruh direktori, bukan hasil pencarian.
  const terdaftar = semuaKaryawan.filter((r) => !r.trashed_at);
  const total = terdaftar.length;
  const aktif = terdaftar.filter((r) => r.status === "Aktif").length;
  const nonaktif = terdaftar.filter((r) => r.status === "Nonaktif").length;

  // T1: karyawan aktif tanpa cabang utama tidak pernah muncul di pemilih petugas klinik.
  const punyaPenugasanBerlaku = new Set(semuaPenugasan.filter((t) => penugasanBerlaku(t, hariIni)).map((t) => t.employee_id));
  const tanpaCabang = terdaftar.filter((r) => r.status === "Aktif" && !r.branch_id);
  const tanpaCabangTanpaTugas = tanpaCabang.filter((r) => !punyaPenugasanBerlaku.has(r.id)).length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/hris" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Master Karyawan</span>
        {bolehKelola && (
          <Link href="/hris/karyawan/impor" className="btn-def" style={{ marginLeft: "auto" }}>
            <i className="ti ti-file-upload" /> Unggah Excel
          </Link>
        )}
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success === "1" ? "Data karyawan berhasil disimpan." : success}
        </div>
      )}

      {bolehKelola && tanpaCabang.length > 0 && (
        <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <i className="ti ti-alert-triangle" />
          <span>
            {tanpaCabang.length} karyawan aktif belum punya cabang utama
            {tanpaCabangTanpaTugas > 0 && `, ${tanpaCabangTanpaTugas} di antaranya belum punya penugasan cabang mana pun`}.
            Selama cabangnya kosong, mereka tidak bisa dipilih sebagai dokter, petugas, atau groomer di klinik dan kasir.
          </span>
          <Link className="btn-def" href="/hris/karyawan/tanpa-cabang" style={{ marginLeft: "auto" }}>Perbaiki sekarang</Link>
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
        <StatCard label="Total Karyawan" value={String(total)} />
        <StatCard label="Karyawan Aktif" value={String(aktif)} accent />
        <StatCard label="Karyawan Nonaktif" value={String(nonaktif)} />
      </div>

      {/* 01 TAMBAH KARYAWAN */}
      {bolehKelola && <div className="crm-sec">
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
            <EmployeeOccupationField />
            <div>
              <label className="flab">Departemen</label>
              <input className="fi" name="departemen" type="text" placeholder="mis. Medis, Operasional" />
            </div>
            <div>
              <label className="flab">Cabang</label>
              <select className="fi" name="branch_id">
                <option value="">Pilih cabang (opsional)</option>
                {displayBranches.map((b) => (
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
            {aturGaji && (
              <div>
                <label className="flab">Gaji Pokok (Rp)</label>
                <NumberInput className="fi" name="gaji_pokok" type="number" min={0} step={50000} placeholder="3000000" />
              </div>
            )}
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
      </div>}

      {bolehKelola && (
        <div className="crm-sec">
          <SecHeader num="02" title="PENUGASAN LINTAS CABANG" desc="Satu dokter atau tenaga medis bisa dijadwalkan di beberapa cabang." />
          <p style={{ fontSize: 11, color: "var(--tm)" }}>
            Form penugasan dan daftar penugasan (termasuk tombol Akhiri penugasan) pindah ke halaman tersendiri supaya menyimpannya tidak perlu memuat ulang seluruh daftar karyawan.
          </p>
          <Link className="btn-def" href="/hris/karyawan/penugasan"><i className="ti ti-git-branch" /> Buka Penugasan Lintas Cabang</Link>
        </div>
      )}

      {/* 02 DAFTAR KARYAWAN */}
      <div className="crm-sec">
        <SecHeader num="03" title="DAFTAR KARYAWAN" desc="Seluruh karyawan diurutkan berdasarkan nama." />
        <form method="get" role="search" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "8px 0 10px" }}>
          <input className="fi" type="search" name="cari" defaultValue={cari} aria-label="Cari karyawan"
            placeholder="Cari nama, NIK, jabatan, cabang, no HP, atau email…" style={{ flex: "1 1 240px", minWidth: 0 }} autoFocus={!!cari} />
          <select className="fi" name="cabang" defaultValue={cabangFilter ?? ""} aria-label="Filter cabang" style={{ width: 170 }}>
            <option value="">Semua cabang</option>
            {displayBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="fi" name="view" defaultValue={view} aria-label="Filter status" style={{ width: 170 }}>
            {TAMPILAN_LIST.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="fi" name="peran" defaultValue={peran ?? ""} aria-label="Filter jabatan" style={{ width: 150 }}>
            <option value="">Semua jabatan</option>
            {GRUP_JABATAN.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
          <button type="submit" className="btn-def"><i className="ti ti-search" /> Cari</button>
          {adaSaringan && <Link href="/hris/karyawan" className="btn-def">Reset</Link>}
          <span style={{ fontSize: 11, color: "var(--tm)" }}>{rows.length} dari {dalamTampilan.length} karyawan</span>
        </form>
        <p style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 0 }}>
          Sampah dapat dipulihkan. Riwayat dipertahankan lewat Nonaktifkan. Filter jabatan memakai aturan yang sama dengan pemilih dokter/petugas di klinik.
        </p>
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
                {lihatGaji && <th style={{ textAlign: "right" }}>Gaji Pokok</th>}
                <th>Status</th>
                {bolehKelola && <th>Aksi</th>}
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
                    <td style={{ fontWeight: 500, fontSize: 12 }}>
                      {bolehKelola ? <Link href={`/hris/karyawan/${r.id}`}>{r.nama}</Link> : r.nama}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.jabatan ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.departemen ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{r.branchName}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                      {tugas.length ? tugas.map((t) => (
                        <div key={`${t.employee_id}-${t.branch_id}`} style={{ opacity: t.keadaan === "berakhir" ? .6 : 1 }}>
                          {t.branchName}{t.role === "PRIMARY" ? " (utama)" : ""}
                          {t.keterangan ? ` · ${t.keterangan}` : ""}
                        </div>
                      )) : "—"}
                    </td>
                    {lihatGaji && (
                      <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>
                        {gajiPer.has(r.id) ? rp(gajiPer.get(r.id)!) : "—"}
                      </td>
                    )}
                    <td>
                      <span className={`bge ${r.status === "Aktif" ? "g" : "x"}`}>
                        {r.trashed_at ? "Sampah" : r.status}
                      </span>
                    </td>
                    {bolehKelola && <td style={{ whiteSpace: "nowrap" }}>
                      <Link className="btn-def" href={`/hris/karyawan/${r.id}`}>Profil</Link>{" "}
                      {!r.trashed_at && <Link className="btn-def" href={`/hris/karyawan/${r.id}?edit=1`}><i className="ti ti-pencil" /> Edit</Link>}
                      <MasterLifecycleActions entity="employees" id={r.id} name={r.nama} active={r.status === "Aktif"} trashed={Boolean(r.trashed_at)} revision={r.lifecycle_revision} />
                    </td>}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={(bolehKelola ? 9 : 8) - (lihatGaji ? 0 : 1)}
                    style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}
                  >
                    {adaSaringan ? "Tidak ada karyawan yang cocok dengan pencarian atau filter ini." : "Belum ada data karyawan. Tambahkan karyawan pertama di atas."}
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
