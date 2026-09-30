import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { editKaryawan } from "../actions";
import { pasangKomponen, lepasKomponen } from "../../komponen-gaji/actions";

const rp = (value: number) => `Rp ${Number(value).toLocaleString("id-ID")}`;
type Komponen = { id: string; nama: string; tipe: string; nominal: number; is_active: boolean };

export default async function RincianKaryawanPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; error?: string; success?: string }>;
}) {
  if (!await bolehKelolaMaster()) redirect("/hris/karyawan");
  const { id } = await params;
  const { edit, error, success } = await searchParams;
  const supabase = await createClient();
  const [empResult, detailResult, componentsResult, assignedResult, branchesResult] = await Promise.all([
    supabase.from("employees").select("id, nama, nik, jabatan, departemen, phone, email, tgl_masuk, gaji_pokok, status, branch_id").eq("id", id).maybeSingle(),
    supabase.from("employee_import_details").select("fields, imported_at").eq("employee_id", id).maybeSingle(),
    supabase.from("salary_components").select("id, nama, tipe, nominal, is_active").order("nama"),
    supabase.from("employee_salary_components").select("id, component_id, nominal").eq("employee_id", id),
    supabase.from("branches").select("id, name"),
  ]);
  if (empResult.error) throw new Error("Profil karyawan gagal dimuat");
  const employee = empResult.data;
  if (!employee) notFound();
  const detail = detailResult.data;
  const fields = detail?.fields && typeof detail.fields === "object" && !Array.isArray(detail.fields)
    ? detail.fields as Record<string, string> : {};
  const components = (componentsResult.data ?? []) as Komponen[];
  const assigned = (assignedResult.data ?? []) as { id: string; component_id: string; nominal: number | null }[];
  const componentMap = new Map(components.map(c => [c.id, c]));
  const benefitError = componentsResult.error || assignedResult.error;
  const inputs = [
    ["nik", "NIK", "text"], ["nama", "Nama *", "text"], ["jabatan", "Jabatan", "text"],
    ["departemen", "Departemen", "text"], ["phone", "No. HP", "tel"], ["email", "Email", "email"],
    ["tgl_masuk", "Tanggal Masuk", "date"], ["gaji_pokok", "Gaji Pokok (Rp)", "number"],
  ] as const;
  return <>
    <Link href="/hris/karyawan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke Karyawan</Link>
    {error && <div role="alert" className="p2ban" style={{ color: "#b91c1c" }}>{error}</div>}
    {success && <div role="status" className="p2ban" style={{ color: "#15803d" }}>{success === "benefit" ? "Benefit karyawan berhasil diperbarui." : "Data karyawan berhasil diperbarui."}</div>}
    <div className="crm-sec" style={{ marginTop: 12 }}>
      <SecHeader num="01" title="PROFIL KARYAWAN" desc={`${employee.nama} · ${employee.nik ?? "Tanpa NIK"}`} action={edit !== "1" ? <Link className="btn-def" href={`/hris/karyawan/${id}?edit=1`}><i className="ti ti-pencil" /> Edit Karyawan</Link> : undefined} />
      {edit === "1" ? <form action={editKaryawan}>
        <input type="hidden" name="id" value={id} />
        <div className="grid2">
          {inputs.map(([key, label, type]) => <div key={key}>
            <label className="flab" htmlFor={key}>{label}</label>
            <input id={key} className="fi" name={key} type={type} defaultValue={employee[key] ?? ""} required={key === "nama" || key === "gaji_pokok"} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined} />
          </div>)}
          <div><label className="flab" htmlFor="status">Status</label><select id="status" className="fi" name="status" defaultValue={employee.status}><option>Aktif</option><option>Nonaktif</option></select></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}><SubmitButton className="btn-acc" pendingText="Menyimpan…">Simpan Perubahan</SubmitButton><Link className="btn-def" href={`/hris/karyawan/${id}`}>Batal</Link></div>
      </form> : <dl className="grid2">
        {inputs.map(([key, label]) => <div key={key}><dt className="flab">{label.replace(" *", "")}</dt><dd style={{ margin: 0 }}>{key === "gaji_pokok" ? rp(employee.gaji_pokok) : employee[key] || "—"}</dd></div>)}
        <div><dt className="flab">Status</dt><dd style={{ margin: 0 }}>{employee.status}</dd></div>
      </dl>}
      <p>Cabang utama: {branchesResult.error ? "Gagal dimuat" : branchesResult.data?.find(b => b.id === employee.branch_id)?.name ?? "Belum ditentukan"}. <Link href="/hris/karyawan">Kelola penugasan cabang</Link></p>
    </div>
    <div className="crm-sec">
      <SecHeader num="02" title="BENEFIT & KOMPONEN GAJI" desc="Gaji pokok, tunjangan, insentif tetap, dan potongan yang berlaku untuk karyawan ini." action={<Link className="btn-def" href={`/hris/komponen-gaji?emp=${id}`}>Master Komponen</Link>} />
      <p>Gaji pokok: <b>{rp(employee.gaji_pokok)}</b>. Insentif tetap dapat dibuat sebagai komponen tunjangan. Nominal kosong mengikuti nominal master. Perubahan berlaku pada perhitungan gaji berikutnya; slip yang telah disahkan tetap tersimpan.</p>
      {benefitError ? <p role="alert">Komponen gaji gagal dimuat. Muat ulang halaman sebelum mengubah benefit.</p> : <>
        <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>Komponen</th><th>Jenis</th><th>Nominal</th><th>Aksi</th></tr></thead><tbody>
          {assigned.map(a => { const c = componentMap.get(a.component_id); return <tr key={a.id}><td>{c?.nama ?? "Komponen tidak tersedia"}{c && !c.is_active && " (Nonaktif)"}</td><td>{c?.tipe ?? "—"}</td><td>{rp(a.nominal ?? c?.nominal ?? 0)}{a.nominal === null && " (ikut master)"}</td><td><form action={lepasKomponen}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="employee_id" value={id} /><input type="hidden" name="return_to" value="profil" /><SubmitButton className="btn-def" pendingText="Melepas…">Lepas</SubmitButton></form></td></tr>; })}
          {!assigned.length && <tr><td colSpan={4}>Belum ada komponen benefit untuk karyawan ini.</td></tr>}
        </tbody></table></div>
        <form action={pasangKomponen} style={{ marginTop: 12 }}>
          <input type="hidden" name="employee_id" value={id} /><input type="hidden" name="return_to" value="profil" />
          <div className="grid2"><div><label className="flab" htmlFor="component">Komponen *</label><select id="component" className="fi" name="component_id" required defaultValue=""><option value="">Pilih komponen untuk tambah atau ubah nominal</option>{components.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.nama} · {c.tipe} · {rp(c.nominal)}</option>)}</select></div><div><label className="flab" htmlFor="nominal">Nominal khusus (Rp, opsional)</label><input id="nominal" className="fi" name="nominal" type="number" min={0} step="any" placeholder="Kosong = ikut master" /></div></div>
          <SubmitButton className="btn-acc" pendingText="Menyimpan…" style={{ marginTop: 12 }}>Simpan Benefit</SubmitButton>
        </form>
      </>}
      <p><Link href="/hris/penggajian">Buka Penggajian & Slip Gaji</Link></p>
    </div>
    <div className="crm-sec"><SecHeader num="03" title="RINCIAN IMPOR EXCEL" desc="Data tambahan dari sumber impor." />
      {detailResult.error ? <p>Rincian impor gagal dimuat.</p> : !detail ? <p>Belum ada rincian dari unggahan Excel.</p> : <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>{Object.entries(fields).map(([label, value]) => <div key={label}><dt className="flab">{label}</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value || "—"}</dd></div>)}</dl>}
    </div>
  </>;
}
