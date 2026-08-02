import { ajukanKasbon, ajukanLembur, ajukanReimburse } from "./pengajuan";
import { jadwalCicilan } from "@/lib/kasbon";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const BADGE: Record<string, string> = { Menunggu: "o", Disetujui: "g", Ditolak: "r", Lunas: "b", Dibayar: "b" };
const tgl = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short" });

export type Lembur = { id: string; tanggal: string; jam: number; status: string };
export type Kasbon = {
  id: string; tanggal: string; jumlah: number; tenor_bulan: number; status: string; dibayar: number;
};
export type Reimburse = { id: string; tanggal: string; kategori: string; jumlah: number; status: string };

// Tiga pengajuan staf dalam satu kartu. Formnya sengaja pendek — dibuka lewat
// <details> supaya layar HP tidak penuh sebelum dipakai.
export function PengajuanCards({
  hariIni, lembur, kasbon, reimburse,
}: {
  hariIni: string;
  lembur: Lembur[];
  kasbon: Kasbon[];
  reimburse: Reimburse[];
}) {
  const kasbonAktif = kasbon.find((k) => k.status === "Disetujui" || k.status === "Menunggu");

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em", marginBottom: 8 }}>
        <i className="ti ti-file-text" /> LEMBUR · KASBON · REIMBURSE
      </div>

      {/* ── Lembur ─────────────────────────────────────────────── */}
      <details style={{ marginBottom: 8 }}>
        <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>Ajukan lembur</summary>
        <form action={ajukanLembur} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
          <div>
            <label className="flab">Tanggal *</label>
            <input className="fi" name="tanggal" type="date" defaultValue={hariIni} max={hariIni} required style={{ width: 150 }} />
          </div>
          <div>
            <label className="flab">Berapa jam *</label>
            <input className="fi" name="jam" type="number" min={0.5} max={24} step="any" placeholder="2" required style={{ width: 100 }} />
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <label className="flab">Alasan</label>
            <input className="fi" name="alasan" placeholder="mis. bantu stok opname" />
          </div>
          <button type="submit" className="btn-acc">Kirim</button>
        </form>
      </details>

      {/* ── Kasbon ─────────────────────────────────────────────── */}
      <details style={{ marginBottom: 8 }}>
        <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>Ajukan kasbon</summary>
        {kasbonAktif ? (
          <div style={{ fontSize: 11, color: "#b55a35", marginTop: 8 }}>
            Masih ada kasbon berjalan ({rp(Number(kasbonAktif.jumlah))}, status {kasbonAktif.status}).
            Ajukan lagi setelah lunas.
          </div>
        ) : (
          <form action={ajukanKasbon} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
            <div>
              <label className="flab">Jumlah *</label>
              <input className="fi" name="jumlah" type="number" min={1} step="any" placeholder="1000000" required style={{ width: 150 }} />
            </div>
            <div>
              <label className="flab">Dicicil berapa bulan *</label>
              <input className="fi" name="tenor_bulan" type="number" min={1} max={24} step={1} defaultValue={1} required style={{ width: 120 }} />
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label className="flab">Keperluan</label>
              <input className="fi" name="alasan" placeholder="mis. biaya sekolah anak" />
            </div>
            <button type="submit" className="btn-acc">Kirim</button>
          </form>
        )}
      </details>

      {/* ── Reimburse ──────────────────────────────────────────── */}
      <details style={{ marginBottom: 4 }}>
        <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>Ajukan ganti uang (reimburse)</summary>
        <form action={ajukanReimburse} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
          <div>
            <label className="flab">Tanggal *</label>
            <input className="fi" name="tanggal" type="date" defaultValue={hariIni} max={hariIni} required style={{ width: 150 }} />
          </div>
          <div>
            <label className="flab">Kategori *</label>
            <select className="fi" name="kategori" defaultValue="Transport" required style={{ width: 140 }}>
              <option>Transport</option>
              <option>Bensin</option>
              <option>Konsumsi</option>
              <option>Parkir &amp; tol</option>
              <option>Perlengkapan</option>
              <option>Lainnya</option>
            </select>
          </div>
          <div>
            <label className="flab">Jumlah *</label>
            <input className="fi" name="jumlah" type="number" min={1} step="any" placeholder="50000" required style={{ width: 130 }} />
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <label className="flab">Keterangan</label>
            <input className="fi" name="keterangan" placeholder="mis. antar obat ke cabang" />
          </div>
          <button type="submit" className="btn-acc">Kirim</button>
        </form>
      </details>

      {/* ── Riwayat ringkas ────────────────────────────────────── */}
      {(lembur.length > 0 || kasbon.length > 0 || reimburse.length > 0) && (
        <div style={{ marginTop: 10, borderTop: ".5px solid var(--bd)", paddingTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tm)", marginBottom: 6 }}>RIWAYAT PENGAJUAN</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {lembur.map((l) => (
              <Baris key={l.id} kiri={`Lembur ${tgl(l.tanggal)} · ${Number(l.jam)} jam`} status={l.status} />
            ))}
            {kasbon.map((k) => {
              const cicilan = jadwalCicilan(Number(k.jumlah), k.tenor_bulan)[0] ?? 0;
              const sisa = Math.max(0, Number(k.jumlah) - Number(k.dibayar));
              return (
                <Baris
                  key={k.id}
                  kiri={`Kasbon ${rp(Number(k.jumlah))} · ${k.tenor_bulan}× ${rp(cicilan)}/bln`}
                  kanan={k.status === "Disetujui" ? `sisa ${rp(sisa)}` : undefined}
                  status={k.status}
                />
              );
            })}
            {reimburse.map((r) => (
              <Baris key={r.id} kiri={`Reimburse ${r.kategori} ${rp(Number(r.jumlah))} · ${tgl(r.tanggal)}`} status={r.status} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Baris({ kiri, kanan, status }: { kiri: string; kanan?: string; status: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
      <span style={{ flex: 1 }}>{kiri}</span>
      {kanan && <span style={{ color: "var(--tm)", fontSize: 10.5 }}>{kanan}</span>}
      <span className={`bge ${BADGE[status] ?? "x"}`}>{status}</span>
    </div>
  );
}
