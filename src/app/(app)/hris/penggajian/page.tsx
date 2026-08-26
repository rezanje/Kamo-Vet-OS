import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PilihRekening, loadRekeningAktif } from "@/components/PilihRekening";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { hariIniWIB } from "@/lib/tanggal";
import { getAturanGaji } from "@/lib/payroll-aturan";
import { hitungPenggajian, sahkanPenggajian, simpanKoreksi } from "./actions";

const rp = (n: number) => "Rp " + Math.round(Number(n)).toLocaleString("id-ID");

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Slip = {
  employee_id: string; gaji_pokok: number; tunjangan: number; total: number;
  hari_kerja: number; hari_hadir: number; hari_bolos: number; menit_telat: number;
  jam_lembur: number; upah_lembur: number; potongan_telat: number; potongan_bolos: number;
  cicilan_kasbon: number; reimburse: number; komisi: number; penyesuaian: number; catatan: string | null;
  status: string; employees: Rel<{ nama: string; jabatan: string | null }>;
};

export default async function PenggajianPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; success?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const periode = /^\d{4}-\d{2}$/.test(sp.periode ?? "") ? sp.periode! : hariIniWIB().slice(0, 7);

  const [{ data: slipData }, { data: riwayatData }, rekening, aturan] = await Promise.all([
    supabase.from("payrolls")
      .select("employee_id, gaji_pokok, tunjangan, total, hari_kerja, hari_hadir, hari_bolos, menit_telat, jam_lembur, upah_lembur, potongan_telat, potongan_bolos, cicilan_kasbon, reimburse, komisi, penyesuaian, catatan, status, employees(nama, jabatan)")
      .eq("periode", periode),
    supabase.from("payrolls").select("periode, total, status").order("periode", { ascending: false }),
    loadRekeningAktif(supabase),
    getAturanGaji(supabase),
  ]);

  const slip = ((slipData ?? []) as unknown as Slip[])
    .sort((a, b) => (one(a.employees)?.nama ?? "").localeCompare(one(b.employees)?.nama ?? ""));
  const final = slip.length > 0 && slip.every((s) => s.status === "final");

  const jml = (f: (s: Slip) => number) => slip.reduce((a, s) => a + Number(f(s)), 0);
  const totalNetto = jml((s) => s.total);

  const riwayat = new Map<string, { total: number; orang: number; final: boolean }>();
  for (const r of (riwayatData ?? []) as { periode: string; total: number; status: string }[]) {
    const cur = riwayat.get(r.periode) ?? { total: 0, orang: 0, final: true };
    cur.total += Number(r.total);
    cur.orang += 1;
    cur.final = cur.final && r.status === "final";
    riwayat.set(r.periode, cur);
  }

  const aturanKosong = aturan.telat_nominal_per_blok === 0 && aturan.bolos_per_hari === 0 && aturan.lembur_per_jam === 0;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/hris" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Slip Gaji</span>
        {slip.length > 0 && <span className={`bge ${final ? "g" : "o"}`}>{final ? "Sudah disahkan" : "Draft"}</span>}
      </div>

      {sp.error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {sp.error}
        </div>
      )}
      {sp.success === "hitung" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-calculator" /> Perhitungan selesai. Periksa rinciannya, koreksi bila perlu, baru disahkan.
        </div>
      )}
      {sp.success === "koreksi" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Koreksi tersimpan.
        </div>
      )}
      {sp.success === "sah" && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-lock" /> Penggajian disahkan &amp; masuk pembukuan. Slip siap dicetak.
        </div>
      )}
      {aturanKosong && (
        <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
          <i className="ti ti-alert-triangle" /> Aturan gaji masih nol semua — telat, bolos, dan lembur tidak akan
          berpengaruh. Isi dulu di <Link href="/pengaturan/gaji" style={{ textDecoration: "underline" }}>Pengaturan → Aturan gaji</Link>.
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num="01" title={`PENGGAJIAN ${periode}`}
          desc="Angka ditarik dari jadwal shift, absensi, cuti, lembur disetujui, komponen gaji, kasbon, dan reimburse."
          action={
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="fi" type="month" name="periode" defaultValue={periode} style={{ fontSize: 11, height: 30, width: 140 }} />
              <button type="submit" className="btn-def" style={{ height: 30, fontSize: 11 }}>Tampilkan</button>
            </form>
          }
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Kartu label="Karyawan" nilai={String(slip.length)} />
          <Kartu label="Gaji pokok" nilai={rp(jml((s) => s.gaji_pokok))} />
          <Kartu label="Tunjangan + lembur" nilai={rp(jml((s) => s.tunjangan) + jml((s) => s.upah_lembur))} warna="#15803d" />
          <Kartu label="Komisi penjualan" nilai={rp(jml((s) => s.komisi))} warna="#15803d" />
          <Kartu label="Potongan" nilai={rp(jml((s) => s.potongan_telat) + jml((s) => s.potongan_bolos))} warna="#b91c1c" />
          <Kartu label="Cicilan kasbon" nilai={rp(jml((s) => s.cicilan_kasbon))} warna="#b91c1c" />
          <Kartu label="Dibayarkan" nilai={rp(totalNetto)} tebal />
        </div>

        {bolehKelola && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <form action={hitungPenggajian}>
              <input type="hidden" name="periode" value={periode} />
              <SubmitButton className="btn-acc" icon="ti-calculator" pendingText="Menghitung…" style={{ background: "var(--posb)" }} disabled={final}>
                {slip.length > 0 ? "Hitung ulang" : "Hitung"}
              </SubmitButton>
            </form>

            {slip.length > 0 && !final && (
              <form action={sahkanPenggajian} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <input type="hidden" name="periode" value={periode} />
                <PilihRekening rekening={rekening} label="Gaji dibayar dari" width={170} />
                <SubmitButton className="btn-acc" icon="ti-lock" pendingText="Mengesahkan…" style={{ background: "#16a34a" }}>
                  Sahkan &amp; bukukan
                </SubmitButton>
              </form>
            )}

            {slip.length > 0 && (
              <Link href={`/hris/penggajian/slip?periode=${periode}`} className="btn-def">
                <i className="ti ti-printer" /> Cetak slip
              </Link>
            )}
          </div>
        )}
      </div>

      {slip.length > 0 && (
        <div className="crm-sec">
          <SecHeader
            num="02" title="RINCIAN PER KARYAWAN"
            desc={final
              ? "Sudah disahkan — angka terkunci."
              : "Kolom koreksi untuk penyesuaian manual (boleh minus). Tekan Simpan koreksi setelah mengubah."}
          />
          <form action={simpanKoreksi}>
            <input type="hidden" name="periode" value={periode} />
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 1100 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 150 }}>Karyawan</th>
                    <th style={{ width: 90 }}>Hadir</th>
                    <th style={{ width: 80 }}>Telat</th>
                    <th style={{ width: 70 }}>Lembur</th>
                    <th style={{ textAlign: "right" }}>Gaji pokok</th>
                    <th style={{ textAlign: "right" }}>Tunjangan</th>
                    <th style={{ textAlign: "right" }}>Lembur</th>
                    <th style={{ textAlign: "right" }}>Reimburse</th>
                    <th style={{ textAlign: "right" }}>Komisi</th>
                    <th style={{ textAlign: "right" }}>Potongan</th>
                    <th style={{ textAlign: "right" }}>Kasbon</th>
                    <th style={{ width: 120 }}>Koreksi</th>
                    <th style={{ textAlign: "right", width: 120 }}>Diterima</th>
                  </tr>
                </thead>
                <tbody>
                  {slip.map((s) => {
                    const emp = one(s.employees);
                    const potongan = Number(s.potongan_telat) + Number(s.potongan_bolos);
                    return (
                      <tr key={s.employee_id}>
                        <td style={{ fontSize: 11.5, fontWeight: 600 }}>
                          {emp?.nama ?? "—"}
                          {emp?.jabatan && <div style={{ fontSize: 9.5, color: "var(--td)", fontWeight: 400 }}>{emp.jabatan}</div>}
                        </td>
                        <td style={{ fontSize: 10.5 }}>
                          {s.hari_hadir}/{s.hari_kerja} hr
                          {s.hari_bolos > 0 && <div style={{ color: "#b91c1c", fontSize: 9.5 }}>{s.hari_bolos} bolos</div>}
                        </td>
                        <td style={{ fontSize: 10.5, color: s.menit_telat > 0 ? "#b91c1c" : "var(--td)" }}>
                          {s.menit_telat > 0 ? `${s.menit_telat} mnt` : "—"}
                        </td>
                        <td style={{ fontSize: 10.5 }}>{Number(s.jam_lembur) > 0 ? `${Number(s.jam_lembur)} jam` : "—"}</td>
                        <td style={{ textAlign: "right", fontSize: 11 }}>{rp(s.gaji_pokok)}</td>
                        <td style={{ textAlign: "right", fontSize: 11 }}>{Number(s.tunjangan) ? rp(s.tunjangan) : "—"}</td>
                        <td style={{ textAlign: "right", fontSize: 11 }}>{Number(s.upah_lembur) ? rp(s.upah_lembur) : "—"}</td>
                        <td style={{ textAlign: "right", fontSize: 11 }}>{Number(s.reimburse) ? rp(s.reimburse) : "—"}</td>
                        <td style={{ textAlign: "right", fontSize: 11, color: Number(s.komisi) ? "#15803d" : undefined }}>
                          {Number(s.komisi) ? rp(s.komisi) : "—"}
                        </td>
                        <td style={{ textAlign: "right", fontSize: 11, color: potongan ? "#b91c1c" : undefined }}>
                          {potongan ? `- ${rp(potongan)}` : "—"}
                        </td>
                        <td style={{ textAlign: "right", fontSize: 11, color: Number(s.cicilan_kasbon) ? "#b91c1c" : undefined }}>
                          {Number(s.cicilan_kasbon) ? `- ${rp(s.cicilan_kasbon)}` : "—"}
                        </td>
                        <td>
                          {final || !bolehKelola ? (
                            <span style={{ fontSize: 11 }}>{Number(s.penyesuaian) ? rp(s.penyesuaian) : "—"}</span>
                          ) : (
                            <>
                              <input className="fi" name={`adj_${s.employee_id}`} type="number" step="any"
                                defaultValue={Number(s.penyesuaian) || ""} placeholder="0"
                                style={{ width: 110, height: 26, fontSize: 10.5 }} />
                              <input className="fi" name={`note_${s.employee_id}`} defaultValue={s.catatan ?? ""}
                                placeholder="alasan" style={{ width: 110, height: 24, fontSize: 10, marginTop: 3 }} />
                            </>
                          )}
                        </td>
                        <td style={{ textAlign: "right", fontSize: 12, fontWeight: 700 }}>{rp(s.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={12} style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>Total dibayarkan</td>
                    <td style={{ textAlign: "right", fontSize: 13, fontWeight: 800 }}>{rp(totalNetto)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {bolehKelola && !final && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <SubmitButton className="btn-def" icon="ti-device-floppy" pendingText="Menyimpan…">
                  Simpan koreksi
                </SubmitButton>
              </div>
            )}
          </form>
        </div>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num="03" title="RIWAYAT PERIODE" desc="Penggajian yang pernah diproses." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 460 }}>
            <thead>
              <tr><th>Periode</th><th style={{ width: 110 }}>Karyawan</th><th style={{ textAlign: "right" }}>Total</th><th style={{ width: 110 }}>Status</th><th style={{ width: 70 }} /></tr>
            </thead>
            <tbody>
              {[...riwayat.entries()].map(([p, v]) => (
                <tr key={p}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{p}</td>
                  <td style={{ fontSize: 11 }}>{v.orang} orang</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(v.total)}</td>
                  <td><span className={`bge ${v.final ? "g" : "o"}`}>{v.final ? "Disahkan" : "Draft"}</span></td>
                  <td><Link href={`/hris/penggajian?periode=${p}`} className="back-btn" style={{ fontSize: 11 }}>Buka</Link></td>
                </tr>
              ))}
              {riwayat.size === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada penggajian yang diproses.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Kartu({ label, nilai, warna, tebal }: { label: string; nilai: string; warna?: string; tebal?: boolean }) {
  return (
    <div className="crm-sec" style={{ margin: 0, minWidth: 140, flex: "0 1 auto", padding: 12 }}>
      <div style={{ fontSize: 10, color: "var(--td)", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: tebal ? 800 : 700, color: warna ?? "var(--sb)", marginTop: 3 }}>{nilai}</div>
    </div>
  );
}
