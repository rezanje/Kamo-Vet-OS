import { NumberInput } from "@/components/NumberInput";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { EmployeePicker } from "@/components/EmployeePicker";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaPayroll } from "@/lib/master-guard";
import { bacaGajiPokok } from "@/lib/employee-salary";
import { lepasKomponen, lepasKomponenTemplate, pasangKomponen, pasangKomponenTemplate, simpanKomponen, simpanTemplateSlip, toggleKomponen } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

type Komponen = { id: string; nama: string; tipe: string; nominal: number; is_active: boolean; calculation_basis: "fixed" | "net_turnover"; sales_source: string; sales_scope: string; rate_percent: number };
type Pasangan = { id: string; employee_id: string; component_id: string; nominal: number | null; rate_percent_override: number | null };
type Template = { id: string; kode: string; nama: string };
type IsiTemplate = { id: string; template_id: string; component_id: string; nominal: number | null; rate_percent: number | null };

export default async function KomponenGajiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; emp?: string; edit?: string }>;
}) {
  const { error, success, emp, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaPayroll();

  const [{ data: kompData, error: componentError }, { data: empData, error: employeeError }, { data: pasangData, error: assignmentError },
    { data: templateData, error: templateError }, { data: isiData, error: isiError }, { data: linkData, error: linkError }] = await Promise.all([
    supabase.from("salary_components").select("id, nama, tipe, nominal, is_active, calculation_basis, sales_source, sales_scope, rate_percent").order("tipe").order("nama"),
    supabase.from("employees").select("id, nama, jabatan").eq("status", "Aktif").order("nama"),
    supabase.from("employee_salary_components").select("id, employee_id, component_id, nominal, rate_percent_override"),
    supabase.from("payslip_templates").select("id, kode, nama").order("nama"),
    supabase.from("payslip_template_components").select("id, template_id, component_id, nominal, rate_percent"),
    supabase.from("employee_payslip_templates").select("employee_id, template_id"),
  ]);
  if (componentError || employeeError || assignmentError || templateError || isiError || linkError) return <div role="alert" className="p2ban">Komponen gaji belum dapat dimuat lengkap. Muat ulang sebelum mengubahnya.</div>;

  const komponen = (kompData ?? []) as Komponen[];
  const editing = edit ? komponen.find(component => component.id === edit) : undefined;
  if (edit && !editing) return <div role="alert" className="p2ban">Komponen untuk diedit tidak tersedia. <Link href="/hris/komponen-gaji">Kembali ke komponen gaji</Link></div>;
  const direktori = (empData ?? []) as { id: string; nama: string; jabatan: string | null }[];
  let gajiPer: Map<string, number>;
  try { gajiPer = await bacaGajiPokok(supabase, direktori.map((k) => k.id)); }
  catch { return <div role="alert" className="p2ban">Komponen gaji belum dapat dimuat lengkap. Muat ulang sebelum mengubahnya.</div>; }
  const karyawan = direktori.map((k) => ({ ...k, gaji_pokok: gajiPer.get(k.id) ?? 0 }));
  const pasangan = (pasangData ?? []) as Pasangan[];

  const kompById = new Map(komponen.map((k) => [k.id, k]));
  const dipilih = emp && karyawan.some((k) => k.id === emp) ? emp : karyawan[0]?.id ?? "";
  const milikDia = pasangan.filter((p) => p.employee_id === dipilih);
  const sudahDipakai = new Set(milikDia.map((p) => p.component_id));
  const orang = karyawan.find((k) => k.id === dipilih);
  const contextEmp = emp || dipilih;
  const contextHref = contextEmp ? `/hris/komponen-gaji?${new URLSearchParams({ emp: contextEmp })}` : "/hris/komponen-gaji";

  const templates = (templateData ?? []) as Template[];
  const isiTemplate = (isiData ?? []) as IsiTemplate[];
  const jumlahKaryawanTemplate = new Map<string, number>();
  for (const link of (linkData ?? []) as { template_id: string }[]) jumlahKaryawanTemplate.set(link.template_id, (jumlahKaryawanTemplate.get(link.template_id) ?? 0) + 1);
  const tarifTemplate = (row: IsiTemplate) => {
    const k = kompById.get(row.component_id);
    if (!k) return "Komponen tidak tersedia";
    return k.calculation_basis === "net_turnover"
      ? `${row.rate_percent ?? k.rate_percent}% omzet neto${row.rate_percent === null ? " (master)" : ""}`
      : `${rp(Number(row.nominal ?? k.nominal))}${row.nominal === null ? " (master)" : ""}`;
  };
  const nilai = (p: Pasangan) => (p.nominal ?? kompById.get(p.component_id)?.nominal ?? 0);
  const totalTunjangan = milikDia.filter((p) => kompById.get(p.component_id)?.tipe === "tunjangan" && kompById.get(p.component_id)?.calculation_basis === "fixed")
    .reduce((a, p) => a + Number(nilai(p)), 0);
  const totalPotongan = milikDia.filter((p) => kompById.get(p.component_id)?.tipe === "potongan" && kompById.get(p.component_id)?.calculation_basis === "fixed")
    .reduce((a, p) => a + Number(nilai(p)), 0);

  return (
    <MasterPage
      back="/hris" icon="ti-coin" title="KOMPONEN GAJI"
      desc="Tunjangan dan potongan tetap atau persentase omzet neto; setiap komponen dipasang ke karyawan"
      error={error} success={success} successMsg="Komponen gaji tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah komponen gaji."
    >
      <div className="crm-sec">
        <SecHeader num="T" title="TEMPLATE SLIP GAJI" desc="Satu template per kelompok (mis. groomer, dokter lama). Karyawan ditautkan ke satu template di profilnya; pengecualian per karyawan dicatat beserta alasannya." />
        {bolehKelola && <form action={simpanTemplateSlip} style={{ marginBottom: 12 }}>
          <div className="frow">
            <div><label className="flab" htmlFor="template-kode">Kode *</label><input id="template-kode" className="fi" name="template_kode" maxLength={40} pattern="[a-z0-9][a-z0-9_\-]{0,39}" placeholder="mis. groomer" required /></div>
            <div><label className="flab" htmlFor="template-nama">Nama *</label><input id="template-nama" className="fi" name="template_nama" maxLength={80} required /></div>
            <div style={{ display: "flex", alignItems: "flex-end" }}><SubmitButton className="btn-acc" pendingText="Menyimpan…">Buat template</SubmitButton></div>
          </div>
        </form>}
        {templates.length === 0 ? <p style={{ fontSize: 11 }}>Belum ada template slip. Tanpa template, slip memakai komponen yang dipasang per karyawan seperti sebelumnya.</p> :
          templates.map((t) => <div key={t.id} style={{ border: ".5px solid var(--bd)", borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <b>{t.nama}</b> <span style={{ fontSize: 10.5, color: "var(--tm)" }}>({t.kode}) · {jumlahKaryawanTemplate.get(t.id) ?? 0} karyawan</span>
            <table className="tbl" style={{ marginTop: 6 }}><thead><tr><th>Komponen</th><th>Jenis</th><th style={{ textAlign: "right" }}>Nilai template</th>{bolehKelola && <th style={{ width: 90 }}>Aksi</th>}</tr></thead><tbody>
              {isiTemplate.filter((row) => row.template_id === t.id).map((row) => <tr key={row.id}>
                <td>{kompById.get(row.component_id)?.nama ?? "—"}</td><td>{kompById.get(row.component_id)?.tipe ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{tarifTemplate(row)}</td>
                {bolehKelola && <td><form action={lepasKomponenTemplate}><input type="hidden" name="id" value={row.id} /><SubmitButton className="btn-def" pendingText="…" style={{ padding: "3px 9px", fontSize: 10.5 }}>Lepas</SubmitButton></form></td>}
              </tr>)}
              {!isiTemplate.some((row) => row.template_id === t.id) && <tr><td colSpan={bolehKelola ? 4 : 3} style={{ fontSize: 11, color: "var(--td)" }}>Template ini belum berisi komponen.</td></tr>}
            </tbody></table>
            {bolehKelola && <form action={pasangKomponenTemplate} style={{ marginTop: 8 }}>
              <input type="hidden" name="template_id" value={t.id} />
              <div className="frow">
                <div><label className="flab" htmlFor={`tc-${t.id}`}>Komponen</label><select id={`tc-${t.id}`} className="fi" name="component_id" required defaultValue="">
                  <option value="">— pilih komponen —</option>
                  {komponen.filter((k) => k.is_active).map((k) => <option key={k.id} value={k.id}>{k.nama} ({k.tipe})</option>)}
                </select></div>
                <div><label className="flab" htmlFor={`tn-${t.id}`}>Nominal template (komponen tetap)</label><NumberInput id={`tn-${t.id}`} className="fi" name="nominal" type="number" min={0} step="any" placeholder="kosong = ikut master" /></div>
                <div><label className="flab" htmlFor={`tr-${t.id}`}>Persentase template (komponen omzet)</label><NumberInput id={`tr-${t.id}`} className="fi" name="rate_percent" type="number" min={0.0001} max={100} step="0.0001" placeholder="kosong = ikut master" /></div>
                <div style={{ display: "flex", alignItems: "flex-end" }}><SubmitButton className="btn-def" pendingText="Menyimpan…">Simpan ke template</SubmitButton></div>
              </div>
            </form>}
          </div>)}
      </div>
      <div className="crm-sec">
        <SecHeader num="01" title="DAFTAR KOMPONEN" desc="Tarif ditetapkan di sini; pengecualian per karyawan dapat diisi saat pemasangan." />

        {bolehKelola && (
          <form key={editing?.id ?? "create"} action={simpanKomponen} style={{ marginBottom: 12 }}>
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <input type="hidden" name="emp" value={contextEmp} />
            {editing && <p>Perubahan nama dan nominal master berlaku untuk seluruh karyawan yang memakai komponen ini. Nominal khusus per karyawan tetap dipertahankan.</p>}
            <div className="frow">
              <div>
                <label className="flab">Nama komponen *</label>
                <input className="fi" name="nama" maxLength={60} placeholder="mis. Tunjangan makan" defaultValue={editing?.nama ?? ""} required />
              </div>
              <div>
                <label className="flab">Jenis *</label>
                {editing ? <><input type="hidden" name="tipe" value={editing.tipe} /><div>{editing.tipe === "tunjangan" ? "Tunjangan" : "Potongan"}</div></> : <select className="fi" name="tipe" defaultValue="tunjangan" required>
                  <option value="tunjangan">Tunjangan (menambah gaji)</option>
                  <option value="potongan">Potongan (mengurangi gaji)</option>
                </select>}
              </div>
              <div>
                <label className="flab">Nominal bawaan</label>
                <NumberInput className="fi" name="nominal" type="number" min={0} step="any" defaultValue={editing?.nominal ?? 0} />
              </div>
              <div><label className="flab">Dasar hitung</label><select className="fi" name="calculation_basis" defaultValue={editing?.calculation_basis ?? "fixed"}>
                <option value="fixed">Nominal tetap</option><option value="net_turnover">Persentase omzet neto</option>
              </select></div>
              <div><label className="flab">Persentase omzet (jika omzet)</label><NumberInput className="fi" name="rate_percent" type="number" min={0} max={100} step="0.0001" defaultValue={editing?.rate_percent ?? 0} /></div>
              <div><label className="flab">Sumber omzet</label><select className="fi" name="sales_source" defaultValue={editing?.sales_source ?? "semua"}>
                <option value="semua">Semua sumber</option><option value="kasir">Kasir</option><option value="klinik">Klinik</option><option value="reseller">Reseller</option>
              </select></div>
              <div><label className="flab">Cakupan omzet</label><select className="fi" name="sales_scope" defaultValue={editing?.sales_scope ?? "employee"}>
                <option value="employee">Transaksi karyawan</option><option value="own_branch">Cabang karyawan</option><option value="all_branches">Semua cabang</option>
              </select></div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              {editing && <Link className="btn-def" href={contextHref} style={{ marginRight: 8 }}>Batal edit</Link>}
              <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
                {editing ? "Simpan perubahan komponen" : "Simpan komponen"}
              </SubmitButton>
            </div>
          </form>
        )}

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Komponen</th><th style={{ width: 170 }}>Jenis</th>
                <th style={{ width: 140, textAlign: "right" }}>Nominal / tarif</th>
                <th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 120 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {komponen.map((k) => (
                <tr key={k.id}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{k.nama}</td>
                  <td style={{ fontSize: 10.5 }}>
                    <span className={`bge ${k.tipe === "tunjangan" ? "g" : "r"}`}>
                      {k.tipe === "tunjangan" ? "Tunjangan" : "Potongan"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{k.calculation_basis === "net_turnover" ? `${k.rate_percent}% omzet neto · ${k.sales_source} · ${k.sales_scope}` : rp(Number(k.nominal))}</td>
                  <td><span className={`bge ${k.is_active ? "g" : "x"}`}>{k.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Link className="btn-def" href={`/hris/komponen-gaji?${new URLSearchParams({ ...(contextEmp ? { emp: contextEmp } : {}), edit: k.id })}`} style={{ fontSize: 10.5 }}>Edit</Link>
                      <form action={toggleKomponen}>
                        <input type="hidden" name="id" value={k.id} />
                        <input type="hidden" name="aktif" value={k.is_active ? "1" : "0"} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                          {k.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </SubmitButton>
                      </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {komponen.length === 0 && (
                <tr><td colSpan={bolehKelola ? 5 : 4} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada komponen gaji.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="02" title="KOMPONEN PER KARYAWAN"
          desc="Pilih karyawan, lalu pasang komponen yang berlaku untuknya."
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <div style={{ width: 220 }}>
                <label className="flab" htmlFor="komponen-employee">Karyawan</label>
                <EmployeePicker inputId="komponen-employee" name="emp" employees={karyawan} defaultValue={dipilih}
                  placeholder="Ketik nama atau jabatan karyawan…" />
              </div>
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Lihat</button>
            </form>
          }
        />

        {orang ? (
          <>
            <div style={{ fontSize: 11, color: "var(--tm)", marginBottom: 10 }}>
              <b>{orang.nama}</b>{orang.jabatan ? ` · ${orang.jabatan}` : ""} · gaji pokok {rp(Number(orang.gaji_pokok))}
              {" · "}tunjangan tetap <b style={{ color: "#15803d" }}>{rp(totalTunjangan)}</b>
              {" · "}potongan tetap <b style={{ color: "#b91c1c" }}>{rp(totalPotongan)}</b>
            </div>

            {bolehKelola && (
              <form action={pasangKomponen} style={{ marginBottom: 12 }}>
                <input type="hidden" name="employee_id" value={dipilih} />
                <div className="frow">
                  <div>
                    <label className="flab">Komponen *</label>
                    <select className="fi" name="component_id" defaultValue="" required>
                      <option value="">— pilih komponen —</option>
                      {komponen.filter((k) => k.is_active && !sudahDipakai.has(k.id)).map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.nama} ({k.tipe === "tunjangan" ? "+" : "−"}{k.calculation_basis === "net_turnover" ? `${k.rate_percent}% omzet neto` : rp(Number(k.nominal))})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="flab">Nominal khusus (opsional)</label>
                    <NumberInput className="fi" name="nominal" type="number" min={0} step="any" placeholder="kosong = ikut bawaan" />
                  </div>
                  <div><label className="flab">Persentase khusus (opsional, hanya omzet)</label><NumberInput className="fi" name="rate_percent_override" type="number" min={0.0001} max={100} step="0.0001" placeholder="kosong = ikut bawaan" /></div>
                  <div><label className="flab">Alasan pengecualian (wajib bila menimpa template)</label><input className="fi" name="override_reason" maxLength={300} /></div>
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
                      Pasang
                    </SubmitButton>
                  </div>
                </div>
              </form>
            )}

            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>Komponen</th><th style={{ width: 150 }}>Jenis</th>
                    <th style={{ width: 150, textAlign: "right" }}>Nominal / tarif dipakai</th>
                    {bolehKelola && <th style={{ width: 90 }}>Aksi</th>}
                  </tr>
                </thead>
                <tbody>
                  {milikDia.map((p) => {
                    const k = kompById.get(p.component_id);
                    return (
                      <tr key={p.id}>
                        <td style={{ fontSize: 11.5 }}>{k?.nama ?? "—"}</td>
                        <td style={{ fontSize: 10.5 }}>
                          <span className={`bge ${k?.tipe === "tunjangan" ? "g" : "r"}`}>
                            {k?.tipe === "tunjangan" ? "Tunjangan" : "Potongan"}
                          </span>
                        </td>
                        <td style={{ textAlign: "right", fontSize: 11 }}>
                          {k?.calculation_basis === "net_turnover" ? `${p.rate_percent_override ?? k.rate_percent}% omzet neto` : rp(Number(nilai(p)))}
                          {(k?.calculation_basis === "net_turnover" ? p.rate_percent_override === null : p.nominal === null) && <span style={{ fontSize: 9.5, color: "var(--td)" }}> (bawaan)</span>}
                        </td>
                        {bolehKelola && (
                          <td>
                            <form action={lepasKomponen}>
                              <input type="hidden" name="id" value={p.id} />
                              <input type="hidden" name="employee_id" value={dipilih} />
                              <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                                Lepas
                              </SubmitButton>
                            </form>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {milikDia.length === 0 && (
                    <tr><td colSpan={bolehKelola ? 4 : 3} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                      Karyawan ini belum punya komponen tetap — slipnya cuma gaji pokok.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: "var(--td)" }}>Belum ada karyawan aktif.</div>
        )}
      </div>
    </MasterPage>
  );
}
