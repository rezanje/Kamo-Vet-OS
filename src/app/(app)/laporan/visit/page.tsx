import Link from "next/link";
import { EmployeePicker } from "@/components/EmployeePicker";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/tanggal";
import { laporanDiminta } from "@/lib/report-gate";
import { LABEL_JENIS_CATATAN, PERAN_VISIT, hitungSebagaiVisit } from "@/lib/laporan-visit";
import { ambilOpsiFilterVisit, ambilVisit } from "./data";
import { bacaPeran, olahLaporanVisit, type ParamVisit } from "./olah";

// Laporan Visit rawat inap — A4, meeting 12 Nov 2026.
//
// Dokter dan paramedis klinik mendapat insentif per visit. Sumbernya catatan
// "Laporan Rawat Inap Harian": satu catatan berjenis Visit dokter = 1 visit untuk
// dokter visitnya dan 1 visit untuk paramedis di catatan itu. Catatan Pemantauan
// ditampilkan terpisah dan tidak dihitung sebagai visit.

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";
const tanggalIndo = (t: string) =>
  new Date(`${t}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Asia/Jakarta" });
const jamWIB = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

export default async function LaporanVisitPage({ searchParams }: { searchParams: Promise<ParamVisit> }) {
  const sp = await searchParams;
  const siap = laporanDiminta(sp);
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const peran = bacaPeran(sp.peran);

  // A1: sebelum Tampilkan hanya isian filter yang dibaca.
  const opsi = await ambilOpsiFilterVisit();
  const cabangId = opsi.cabangOptions.some((c) => c.id === sp.cabang_id) ? sp.cabang_id! : "";
  const data = siap ? await ambilVisit({ dari, sampai, cabangId }) : { rows: [], pesanError: "" };
  const orangDikenal = (id: string) => opsi.karyawan.some((k) => k.id === id) || data.rows.some((r) => r.dokterId === id || r.paramedisId === id);
  const employeeId = sp.orang && orangDikenal(sp.orang) ? sp.orang : "";
  const { terpilih, rekap, total, pilihanOrang } = olahLaporanVisit(data.rows, opsi.karyawan, { cabangId, employeeId, peran });
  const pesanError = opsi.pesanError || data.pesanError;

  const paramUnduh = new URLSearchParams(Object.entries({ dari, sampai, cabang_id: cabangId, orang: employeeId, peran })
    .filter(([, nilai]) => nilai)).toString();
  const rincian = [...terpilih].sort((a, b) =>
    a.peran.localeCompare(b.peran) || a.nama.localeCompare(b.nama, "id")
    || b.baris.tanggal.localeCompare(a.baris.tanggal) || b.baris.waktu.localeCompare(a.baris.waktu));

  return (
    <LaporanPage
      siap={siap}
      unduhTampilan={false}
      pilihKolom
      icon="ti-stethoscope" title="LAPORAN VISIT RAWAT INAP"
      desc="Jumlah visit pasien rawat inap per dokter dan paramedis — dasar insentif per visit. Sumber: Laporan Rawat Inap Harian."
      filter={
        <>
          <div>
            <label className="flab">Dari tanggal</label>
            <input className="fi" type="date" name="dari" defaultValue={dari} />
          </div>
          <div>
            <label className="flab">Sampai tanggal</label>
            <input className="fi" type="date" name="sampai" defaultValue={sampai} />
          </div>
          <div style={{ minWidth: 180 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang_id" defaultValue={cabangId}>
              <option value="">Semua cabang</option>
              {opsi.cabangOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label className="flab">Peran</label>
            <select className="fi" name="peran" defaultValue={peran}>
              <option value="">Dokter & paramedis</option>
              {PERAN_VISIT.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 220 }}>
            <label className="flab" htmlFor="filter-orang">Dokter / paramedis</label>
            <EmployeePicker employees={pilihanOrang} name="orang" inputId="filter-orang"
              defaultValue={employeeId} placeholder="Semua orang — ketik nama…" ariaLabel="Dokter / paramedis" />
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Visit dokter (catatan)", nilai: `${total.visit}`, warna: "#15803d" },
          { label: "Pasien rawat inap divisit", nilai: `${total.pasien}` },
          { label: "Dokter", nilai: `${rekap.filter((r) => r.peran === "Dokter" && r.visit > 0).length} orang` },
          { label: "Visit terhitung dokter (= Komisi)", nilai: `${rekap.filter((r) => r.peran === "Dokter").reduce((n, r) => n + r.visitTerhitung, 0)}` },
          { label: "Paramedis", nilai: `${rekap.filter((r) => r.peran === "Paramedis" && r.visit > 0).length} orang` },
          { label: "Pemantauan (bukan visit)", nilai: `${total.pemantauan}` },
        ]} />
      }
    >
      <div className="no-print" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "var(--tm)" }}>Unduh lengkap (rekap per orang + rincian visit):</span>
        <a className="btn-def" style={{ fontSize: 11 }} href={`/laporan/visit/unduh?${paramUnduh}`}>Excel</a>
        <a className="btn-def" style={{ fontSize: 11 }} href={`/laporan/visit/unduh?${paramUnduh}&format=csv`}>CSV</a>
      </div>

      {pesanError && (
        <div className="crm-sec" role="alert" style={{ marginBottom: 12, color: "#b91c1c", fontSize: 12 }}>{pesanError}</div>
      )}

      <div className="crm-sec" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>01 · REKAP VISIT PER ORANG</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Nama</th>
                <th style={{ width: 100 }}>Peran</th>
                <th style={{ width: 110, textAlign: "right" }}>Visit terhitung (maks 1/pasien/hari)</th>
                <th style={{ width: 90, textAlign: "right" }}>Semua catatan visit</th>
                <th style={{ width: 110, textAlign: "right" }}>Pasien berbeda</th>
                <th style={{ width: 90, textAlign: "right" }}>Hari visit</th>
                <th style={{ width: 120, textAlign: "right" }}>Pemantauan (bukan visit)</th>
              </tr>
            </thead>
            <tbody>
              {rekap.map((r) => (
                <tr key={`${r.peran}|${r.kunci}`}>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{r.nama}{!r.employeeId && <span style={{ color: "var(--td)", fontWeight: 400 }}> (data lama, tanpa ID karyawan)</span>}</td>
                  <td style={{ fontSize: 11 }}>{r.peran}</td>
                  <td style={{ textAlign: "right", fontSize: 12, fontWeight: 800 }}>{r.visitTerhitung}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: r.visit !== r.visitTerhitung ? "#b45309" : undefined }}>{r.visit}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{r.pasien}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{r.hari}</td>
                  <td style={{ textAlign: "right", fontSize: 11, color: r.pemantauan ? "var(--tm)" : "var(--td)" }}>{r.pemantauan || "—"}</td>
                </tr>
              ))}
              {rekap.length === 0 && <TabelKosong kolom={7} pesan="Belum ada catatan visit pada saringan ini." />}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8, lineHeight: 1.6 }}>
          Satu catatan berjenis <b>Visit dokter</b> di Laporan Rawat Inap Harian dihitung 1 visit untuk dokter visitnya
          dan 1 visit untuk paramedis yang tercatat di baris itu. Catatan <b>Pemantauan</b> tidak dihitung sebagai visit.
          <b>Visit terhitung</b> = maksimal 1 visit per orang per pasien per hari (tanggal WIB) — aturan yang sama
          dengan komisi visit dokter di menu Komisi, jadi angka dokter di kolom ini sama dengan yang dibayar Komisi.
          Kolom <b>Semua catatan visit</b> menghitung setiap catatan (mis. Visit 1 dan Visit 2 di hari yang sama).
          Visit yang lupa diisi tidak terhitung — koreksi lewat detail rawat inap pasiennya. Nilai rupiah insentif
          dihitung Finance dari jumlah visit ini.
        </div>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>02 · RINCIAN CATATAN</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={{ width: 170 }}>Nama</th>
                <th style={{ width: 85 }}>Peran</th>
                <th style={{ width: 80 }}>Tanggal</th>
                <th style={{ width: 50 }}>Jam</th>
                <th style={{ width: 95 }}>Jenis</th>
                <th style={{ width: 110 }}>Cabang</th>
                <th style={{ width: 110 }}>Pasien</th>
                <th style={{ width: 120 }}>Pemilik</th>
                <th>Kondisi / tindakan</th>
              </tr>
            </thead>
            <tbody>
              {rincian.map(({ baris, peran: p, nama, kunci }) => (
                <tr key={`${baris.id}|${p}|${kunci}`}>
                  <td style={{ fontSize: 11, fontWeight: 600 }}>{nama}</td>
                  <td style={{ fontSize: 10.5 }}>{p}</td>
                  <td style={{ fontSize: 10.5 }}>{tanggalIndo(baris.tanggal)}</td>
                  <td style={{ fontSize: 10.5 }}>{jamWIB(baris.waktu)}</td>
                  <td style={{ fontSize: 10.5, color: hitungSebagaiVisit(baris) ? "#15803d" : "var(--tm)" }}>{LABEL_JENIS_CATATAN(baris.jenis)}</td>
                  <td style={{ fontSize: 10.5 }}>{baris.cabang}</td>
                  <td style={{ fontSize: 10.5 }}>
                    <Link href={`/klinik/rawat-inap/${baris.inpatientId}`} style={{ color: "#2563eb", textDecoration: "none" }}>{baris.pasien}</Link>
                  </td>
                  <td style={{ fontSize: 10.5 }}>{baris.pemilik}</td>
                  <td style={{ fontSize: 10.5 }}>{[baris.kondisi, baris.tindakan].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
              {rincian.length === 0 && <TabelKosong kolom={9} pesan="Belum ada catatan pada saringan ini." />}
            </tbody>
          </table>
        </div>
      </div>
    </LaporanPage>
  );
}
