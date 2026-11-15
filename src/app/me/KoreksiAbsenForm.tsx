import { SubmitButton } from "@/components/SubmitButton";
import { KATEGORI_KOREKSI } from "@/lib/absensi-mandiri";
import { ajukanKoreksiAbsen } from "./actions";

export type KoreksiSaya = {
  id: string; tanggal: string; jam_masuk: string | null; jam_pulang: string | null;
  kategori: string; status: string; catatan_penyetuju: string | null;
};

const BADGE: Record<string, string> = { Menunggu: "o", Disetujui: "g", Ditolak: "r" };
const jam = (j: string | null) => (j ? j.slice(0, 5) : "—");

// C1: lupa absen / foto gagal / lokasi gagal → ajukan koreksi; OWNER/ADMIN memutuskan di HRIS → Pengajuan.
export function KoreksiAbsenForm({ hariIni, riwayat }: { hariIni: string; riwayat: KoreksiSaya[] }) {
  return (
    <>
      <form action={ajukanKoreksiAbsen}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
          <div>
            <label className="flab">Tanggal *</label>
            <input className="fi" type="date" name="tanggal" max={hariIni} defaultValue={hariIni} required />
          </div>
          <div>
            <label className="flab">Jam masuk</label>
            <input className="fi" type="time" name="jam_masuk" />
          </div>
          <div>
            <label className="flab">Jam pulang</label>
            <input className="fi" type="time" name="jam_pulang" />
          </div>
          <div>
            <label className="flab">Kenapa *</label>
            <select className="fi" name="kategori" defaultValue="lupa_absen" required>
              {Object.entries(KATEGORI_KOREKSI).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <label className="flab">Alasan *</label>
          <input className="fi" name="alasan" maxLength={300} minLength={3} required placeholder="mis. HP mati waktu mau absen pulang" />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "var(--td)" }}>Isi jam yang benar saja. Shift malam: jam pulang ikut tanggal mulai shift.</span>
          <SubmitButton className="btn-acc" icon="ti-send" pendingText="Mengirim…">Ajukan koreksi</SubmitButton>
        </div>
      </form>
      {riwayat.length > 0 && (
        <table className="tbl" style={{ marginTop: 10 }}>
          <thead><tr><th>Tanggal</th><th>Masuk</th><th>Pulang</th><th>Alasan</th><th>Status</th></tr></thead>
          <tbody>
            {riwayat.map((k) => (
              <tr key={k.id}>
                <td style={{ fontSize: 11 }}>{k.tanggal}</td>
                <td style={{ fontSize: 11 }}>{jam(k.jam_masuk)}</td>
                <td style={{ fontSize: 11 }}>{jam(k.jam_pulang)}</td>
                <td style={{ fontSize: 11 }}>{KATEGORI_KOREKSI[k.kategori] ?? k.kategori}</td>
                <td>
                  <span className={`bge ${BADGE[k.status] ?? "o"}`}>{k.status}</span>
                  {k.catatan_penyetuju && <div style={{ fontSize: 9.5, color: "var(--td)" }}>{k.catatan_penyetuju}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
