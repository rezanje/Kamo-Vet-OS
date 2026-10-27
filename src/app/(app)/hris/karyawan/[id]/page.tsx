import { NumberInput } from "@/components/NumberInput";
import { branchDisplayName } from "@/lib/branch-display";
import Link from "next/link";
import { EmployeeOccupationField } from "@/components/EmployeeOccupationField";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bolehKelolaMaster, bolehKelolaPayroll } from "@/lib/master-guard";
import { bacaGajiPokok } from "@/lib/employee-salary";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { editKaryawan } from "../actions";
import { pasangKomponen, lepasKomponen, pasangTemplateKaryawan } from "../../komponen-gaji/actions";

const rp = (value: number) => `Rp ${Number(value).toLocaleString("id-ID")}`;
type Komponen = { id: string; nama: string; tipe: string; nominal: number; is_active: boolean; calculation_basis: "fixed" | "net_turnover"; sales_source: string; sales_scope: string; rate_percent: number };

export default async function RincianKaryawanPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; error?: string; success?: string }>;
}) {
  if (!await bolehKelolaMaster()) redirect("/hris/karyawan");
  const { id } = await params;
  const { edit, error, success } = await searchParams;
  const supabase = await createClient();
  const aturGaji = await bolehKelolaPayroll();
  const [empResult, detailResult, componentsResult, assignedResult, branchesResult] = await Promise.all([
    supabase.from("employees").select("id, nama, nik, jabatan, departemen, phone, email, tgl_masuk, status, branch_id, trashed_at").eq("id", id).maybeSingle(),
    supabase.from("employee_import_details").select("fields, imported_at").eq("employee_id", id).maybeSingle(),
    supabase.from("salary_components").select("id, nama, tipe, nominal, is_active, calculation_basis, sales_source, sales_scope, rate_percent").order("nama"),
    supabase.from("employee_salary_components").select("id, component_id, nominal, rate_percent_override").eq("employee_id", id),
    supabase.from("branches").select("id, code, name, type"),
  ]);
  if (empResult.error) throw new Error("Profil karyawan gagal dimuat");
  const employee = empResult.data;
  if (employee?.trashed_at) redirect("/hris/karyawan?view=trash");
  if (!employee) notFound();
  const gajiPokok = aturGaji ? ((await bacaGajiPokok(supabase, [id])).get(id) ?? 0) : null;
  const nilai = (key: string): string | number | null =>
    key === "gaji_pokok" ? gajiPokok : (employee as Record<string, string | number | null>)[key];
  const primaryBranch = branchesResult.data?.find(branch => branch.id === employee.branch_id);
  const primaryBranchName = primaryBranch ? branchDisplayName(primaryBranch, branchesResult.data ?? []) : "Belum ditentukan";
  const detail = detailResult.data;
  const fields = detail?.fields && typeof detail.fields === "object" && !Array.isArray(detail.fields)
    ? detail.fields as Record<string, string> : {};
  const components = (componentsResult.data ?? []) as Komponen[];
  const assigned = (assignedResult.data ?? []) as { id: string; component_id: string; nominal: number | null; rate_percent_override: number | null }[];
  const componentMap = new Map(components.map(c => [c.id, c]));
  // H02: template slip + riwayat pengecualian (OWNER/FINANCE saja; RLS mengembalikan kosong untuk peran lain).
  const [templatesResult, linkResult, historyResult] = aturGaji ? await Promise.all([
    supabase.from("payslip_templates").select("id, kode, nama").order("nama"),
    supabase.from("employee_payslip_templates").select("template_id").eq("employee_id", id).maybeSingle(),
    supabase.from("payslip_override_history").select("id, action, template_id, component_id, old_value, new_value, reason, changed_at")
      .eq("employee_id", id).order("changed_at", { ascending: false }).limit(20),
  ]) : [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }];
  const templates = (templatesResult.data ?? []) as { id: string; kode: string; nama: string }[];
  const templateId = (linkResult.data as { template_id: string } | null)?.template_id ?? "";
  const templateName = new Map(templates.map(t => [t.id, t.nama]));
  type Riwayat = { id: string; action: string; template_id: string | null; component_id: string | null; old_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null; reason: string | null; changed_at: string };
  const riwayat = (historyResult.data ?? []) as Riwayat[];
  const nilaiRiwayat = (v: Record<string, unknown> | null) => !v ? "—" : v.template_id ? templateName.get(String(v.template_id)) ?? "template" :
    v.rate_percent_override != null ? `${v.rate_percent_override}%` : v.nominal != null ? rp(Number(v.nominal)) : "ikut template/master";
  const LABEL_RIWAYAT: Record<string, string> = { template_set: "Template ditetapkan", template_removed: "Template dilepas", component_set: "Komponen/pengecualian diubah", component_removed: "Komponen dilepas" };
  const benefitError = componentsResult.error || assignedResult.error || templatesResult.error || linkResult.error || historyResult.error;
  const inputs = [
    ["nik", "NIK", "text"], ["nama", "Nama *", "text"], ["jabatan", "Jabatan", "text"],
    ["departemen", "Departemen", "text"], ["phone", "No. HP", "tel"], ["email", "Email", "email"],
    ["tgl_masuk", "Tanggal Masuk", "date"],
    ...(aturGaji ? [["gaji_pokok", "Gaji Pokok (Rp)", "number"] as const] : []),
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
          {inputs.map(([key, label, type]) => key === 'jabatan' ? <EmployeeOccupationField key={key} value={employee.jabatan} /> : <div key={key}>
            <label className="flab" htmlFor={key}>{label}</label>
            <NumberInput id={key} className="fi" name={key} type={type} defaultValue={nilai(key) ?? ""} required={key === "nama" || key === "gaji_pokok"} min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined} />
          </div>)}
          <div><label className="flab">Status</label><input type="hidden" name="status" value={employee.status} />{employee.status}<p>Gunakan aksi di daftar karyawan untuk mengubah status dengan alasan. Status ini tidak mencabut akses login.</p></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}><SubmitButton className="btn-acc" pendingText="Menyimpan…">Simpan Perubahan</SubmitButton><Link className="btn-def" href={`/hris/karyawan/${id}`}>Batal</Link></div>
      </form> : <dl className="grid2">
        {inputs.map(([key, label]) => <div key={key}><dt className="flab">{label.replace(" *", "")}</dt><dd style={{ margin: 0 }}>{key === "gaji_pokok" ? rp(gajiPokok ?? 0) : nilai(key) || "—"}</dd></div>)}
        <div><dt className="flab">Status</dt><dd style={{ margin: 0 }}>{employee.status}</dd></div>
      </dl>}
      <p>Cabang utama: {branchesResult.error ? "Gagal dimuat" : primaryBranchName}. <Link href="/hris/karyawan">Kelola penugasan cabang</Link></p>
    </div>
    {aturGaji && <div className="crm-sec">
      <SecHeader num="02" title="BENEFIT & KOMPONEN GAJI" desc="Gaji pokok, tunjangan, insentif omzet, dan potongan yang berlaku untuk karyawan ini." action={<Link className="btn-def" href={`/hris/komponen-gaji?emp=${id}`}>Master Komponen</Link>} />
      <p>Gaji pokok: <b>{rp(gajiPokok ?? 0)}</b>. Nominal atau persentase khusus kosong mengikuti master. Perubahan berlaku pada perhitungan gaji berikutnya; slip yang telah disahkan tetap tersimpan.</p>
      {benefitError ? <p role="alert">Komponen gaji gagal dimuat. Muat ulang halaman sebelum mengubah benefit.</p> : <>
        <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>Komponen</th><th>Jenis</th><th>Nominal / tarif</th><th>Aksi</th></tr></thead><tbody>
          {assigned.map(a => { const c = componentMap.get(a.component_id); return <tr key={a.id}><td>{c?.nama ?? "Komponen tidak tersedia"}{c && !c.is_active && " (Nonaktif)"}</td><td>{c?.tipe ?? "—"}</td><td>{c?.calculation_basis === "net_turnover" ? `${a.rate_percent_override ?? c.rate_percent}% omzet neto · ${c.sales_source}/${c.sales_scope}` : rp(a.nominal ?? c?.nominal ?? 0)}{(c?.calculation_basis === "net_turnover" ? a.rate_percent_override === null : a.nominal === null) && " (ikut master)"}</td><td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{c && <Link className="btn-def" href={`/hris/komponen-gaji?${new URLSearchParams({ emp: id, edit: c.id })}`} style={{ fontSize: 10.5 }}>Edit master</Link>}<form action={lepasKomponen}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="employee_id" value={id} /><input type="hidden" name="return_to" value="profil" /><SubmitButton className="btn-def" pendingText="Melepas…">Lepas</SubmitButton></form></div></td></tr>; })}
          {!assigned.length && <tr><td colSpan={4}>Belum ada komponen benefit untuk karyawan ini.</td></tr>}
        </tbody></table></div>
        <form action={pasangTemplateKaryawan} style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="employee_id" value={id} />
          <div><label className="flab" htmlFor="payslip-template">Template slip gaji</label>
            <select id="payslip-template" className="fi" name="template_id" defaultValue={templateId}>
              <option value="">Tanpa template (komponen per karyawan saja)</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.nama} ({t.kode})</option>)}
            </select></div>
          <SubmitButton className="btn-def" pendingText="Menyimpan…">Simpan template</SubmitButton>
          <Link href="/hris/komponen-gaji" style={{ fontSize: 11 }}>Atur isi template</Link>
        </form>
        <p style={{ fontSize: 11 }}>Komponen di template berlaku otomatis. Komponen yang dipasang di bawah pada komponen yang sama adalah pengecualian khusus karyawan ini dan wajib diberi alasan.</p>
        <form action={pasangKomponen} style={{ marginTop: 12 }}>
          <input type="hidden" name="employee_id" value={id} /><input type="hidden" name="return_to" value="profil" />
          <div className="grid2"><div><label className="flab" htmlFor="component">Komponen *</label><select id="component" className="fi" name="component_id" required defaultValue=""><option value="">Pilih komponen untuk tambah atau ubah tarif</option>{components.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.nama} · {c.tipe} · {c.calculation_basis === "net_turnover" ? `${c.rate_percent}% omzet neto` : rp(c.nominal)}</option>)}</select></div><div><label className="flab" htmlFor="nominal">Nominal khusus (Rp, hanya tetap)</label><NumberInput id="nominal" className="fi" name="nominal" type="number" min={0} step="any" placeholder="Kosong = ikut master" /></div><div><label className="flab" htmlFor="rate_percent_override">Persentase khusus (hanya omzet)</label><NumberInput id="rate_percent_override" className="fi" name="rate_percent_override" type="number" min={0.0001} max={100} step="0.0001" placeholder="Kosong = ikut master" /></div><div><label className="flab" htmlFor="override_reason">Alasan pengecualian (wajib bila menimpa template)</label><input id="override_reason" className="fi" name="override_reason" maxLength={300} /></div></div>
          <SubmitButton className="btn-acc" pendingText="Menyimpan…" style={{ marginTop: 12 }}>Simpan Benefit</SubmitButton>
        </form>
      </>}
      {!benefitError && riwayat.length > 0 && <div style={{ overflowX: "auto", marginTop: 12 }}>
        <b style={{ fontSize: 11 }}>Riwayat template & pengecualian</b>
        <table className="tbl"><thead><tr><th>Waktu</th><th>Perubahan</th><th>Komponen</th><th>Sebelum</th><th>Sesudah</th><th>Alasan</th></tr></thead><tbody>
          {riwayat.map(r => <tr key={r.id}><td>{new Date(r.changed_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td><td>{LABEL_RIWAYAT[r.action] ?? r.action}</td>
            <td>{r.component_id ? componentMap.get(r.component_id)?.nama ?? "—" : "—"}</td><td>{nilaiRiwayat(r.old_value)}</td><td>{nilaiRiwayat(r.new_value)}</td><td>{r.reason ?? "—"}</td></tr>)}
        </tbody></table></div>}
      <p><Link href="/hris/penggajian">Buka Penggajian & Slip Gaji</Link></p>
    </div>}
    <div className="crm-sec"><SecHeader num="03" title="RINCIAN IMPOR EXCEL" desc="Data tambahan dari sumber impor." />
      {detailResult.error ? <p>Rincian impor gagal dimuat.</p> : !detail ? <p>Belum ada rincian dari unggahan Excel.</p> : <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>{Object.entries(fields).map(([label, value]) => <div key={label}><dt className="flab">{label}</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value || "—"}</dd></div>)}</dl>}
    </div>
  </>;
}
