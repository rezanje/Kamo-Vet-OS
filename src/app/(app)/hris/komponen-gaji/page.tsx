import { NumberInput } from "@/components/NumberInput";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaPayroll } from "@/lib/master-guard";
import { bacaGajiPokok } from "@/lib/employee-salary";
import { lepasKomponen, pasangKomponen, simpanKomponen, toggleKomponen } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

type Komponen = { id: string; nama: string; tipe: string; nominal: number; is_active: boolean };
type Pasangan = { id: string; employee_id: string; component_id: string; nominal: number | null };

export default async function KomponenGajiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; emp?: string; edit?: string }>;
}) {
  const { error, success, emp, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaPayroll();

  const [{ data: kompData, error: componentError }, { data: empData, error: employeeError }, { data: pasangData, error: assignmentError }] = await Promise.all([
    supabase.from("salary_components").select("id, nama, tipe, nominal, is_active").order("tipe").order("nama"),
    supabase.from("employees").select("id, nama, jabatan").eq("status", "Aktif").order("nama"),
    supabase.from("employee_salary_components").select("id, employee_id, component_id, nominal"),
  ]);
  if (componentError || employeeError || assignmentError) return <div role="alert" className="p2ban">Komponen gaji belum dapat dimuat lengkap. Muat ulang sebelum mengubahnya.</div>;

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

  const nilai = (p: Pasangan) => (p.nominal ?? kompById.get(p.component_id)?.nominal ?? 0);
  const totalTunjangan = milikDia.filter((p) => kompById.get(p.component_id)?.tipe === "tunjangan")
    .reduce((a, p) => a + Number(nilai(p)), 0);
  const totalPotongan = milikDia.filter((p) => kompById.get(p.component_id)?.tipe === "potongan")
    .reduce((a, p) => a + Number(nilai(p)), 0);

  return (
    <MasterPage
      back="/hris" icon="ti-coin" title="KOMPONEN GAJI"
      desc="Tunjangan & potongan tetap — dipasang sekali, dipakai tiap bulan"
      error={error} success={success} successMsg="Komponen gaji tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah komponen gaji."
    >
      <div className="crm-sec">
        <SecHeader num="01" title="DAFTAR KOMPONEN" desc="Nominal di sini jadi bawaan; per karyawan boleh beda." />

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
                <th style={{ width: 140, textAlign: "right" }}>Nominal bawaan</th>
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
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(Number(k.nominal))}</td>
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
              <select className="fi" name="emp" defaultValue={dipilih} style={{ fontSize: 11, height: 30, width: 190 }}>
                {karyawan.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
              </select>
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
                          {k.nama} ({k.tipe === "tunjangan" ? "+" : "−"}{rp(Number(k.nominal))})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="flab">Nominal khusus (opsional)</label>
                    <NumberInput className="fi" name="nominal" type="number" min={0} step="any" placeholder="kosong = ikut bawaan" />
                  </div>
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
                    <th style={{ width: 150, textAlign: "right" }}>Nominal dipakai</th>
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
                          {rp(Number(nilai(p)))}
                          {p.nominal === null && <span style={{ fontSize: 9.5, color: "var(--td)" }}> (bawaan)</span>}
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
