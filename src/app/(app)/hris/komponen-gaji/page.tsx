import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { lepasKomponen, pasangKomponen, simpanKomponen, toggleKomponen } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

type Komponen = { id: string; nama: string; tipe: string; nominal: number; is_active: boolean };
type Pasangan = { id: string; employee_id: string; component_id: string; nominal: number | null };

export default async function KomponenGajiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; emp?: string }>;
}) {
  const { error, success, emp } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data: kompData }, { data: empData }, { data: pasangData }] = await Promise.all([
    supabase.from("salary_components").select("id, nama, tipe, nominal, is_active").order("tipe").order("nama"),
    supabase.from("employees").select("id, nama, jabatan, gaji_pokok").eq("status", "Aktif").order("nama"),
    supabase.from("employee_salary_components").select("id, employee_id, component_id, nominal"),
  ]);

  const komponen = (kompData ?? []) as Komponen[];
  const karyawan = (empData ?? []) as { id: string; nama: string; jabatan: string | null; gaji_pokok: number }[];
  const pasangan = (pasangData ?? []) as Pasangan[];

  const kompById = new Map(komponen.map((k) => [k.id, k]));
  const dipilih = emp && karyawan.some((k) => k.id === emp) ? emp : karyawan[0]?.id ?? "";
  const milikDia = pasangan.filter((p) => p.employee_id === dipilih);
  const sudahDipakai = new Set(milikDia.map((p) => p.component_id));
  const orang = karyawan.find((k) => k.id === dipilih);

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
          <form action={simpanKomponen} style={{ marginBottom: 12 }}>
            <div className="frow">
              <div>
                <label className="flab">Nama komponen *</label>
                <input className="fi" name="nama" maxLength={60} placeholder="mis. Tunjangan makan" required />
              </div>
              <div>
                <label className="flab">Jenis *</label>
                <select className="fi" name="tipe" defaultValue="tunjangan" required>
                  <option value="tunjangan">Tunjangan (menambah gaji)</option>
                  <option value="potongan">Potongan (mengurangi gaji)</option>
                </select>
              </div>
              <div>
                <label className="flab">Nominal bawaan</label>
                <input className="fi" name="nominal" type="number" min={0} step="any" defaultValue={0} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
                Simpan komponen
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
                      <form action={toggleKomponen}>
                        <input type="hidden" name="id" value={k.id} />
                        <input type="hidden" name="aktif" value={k.is_active ? "1" : "0"} />
                        <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                          {k.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </SubmitButton>
                      </form>
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
                    <input className="fi" name="nominal" type="number" min={0} step="any" placeholder="kosong = ikut bawaan" />
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <SubmitButton className="btn-acc" icon="ti-plus" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
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
