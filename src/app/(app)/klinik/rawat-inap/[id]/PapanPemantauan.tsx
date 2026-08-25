// Papan pemantauan rawat inap — jawaban untuk pertanyaan yang muncul tiap ganti
// shift: "sudah berapa hari nggak BAB?", "beratnya naik atau turun?", "owner sudah
// dikabari apa?". Semua dibaca dari laporan harian yang sudah diisi dokter, jadi
// tidak ada input tambahan yang harus diisi dua kali.

import {
  ringkasPerHari, streakBuruk, trenAngka, trenOrdinal, statusSuhu, peringatan,
  SUHU_NORMAL_MIN, SUHU_NORMAL_MAX,
  type LaporanHarian, type Tren, type NilaiOrdinal, type JenisOrdinal,
} from "@/lib/monitoring-inap";

const tglPendek = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short" });

export function PapanPemantauan({ laporan }: { laporan: LaporanHarian[] }) {
  const hari = ringkasPerHari(laporan);
  if (hari.length === 0) {
    return (
      <div className="crm-sec">
        <Judul />
        <div style={{ fontSize: 11, color: "var(--td)" }}>
          Belum ada laporan harian. Begitu dokter mengisi laporan pertama (berat, suhu, makan, minum, BAB, pipis),
          tren dan peringatannya muncul di sini otomatis.
        </div>
      </div>
    );
  }

  const berat = trenAngka(hari, "berat");
  const suhu = trenAngka(hari, "suhu");
  const pesan = peringatan(hari);
  const semuaFoto = hari.flatMap((h) => h.foto.map((f) => ({ url: f, tanggal: h.tanggal })));
  const semuaKomunikasi = hari.flatMap((h) => h.komunikasi.map((k) => ({ ...k, tanggal: h.tanggal })));

  return (
    <div className="crm-sec">
      <Judul />

      {pesan.length > 0 && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginBottom: 12, alignItems: "flex-start" }}>
          <i className="ti ti-alert-triangle" style={{ marginTop: 2 }} />
          <span>
            <b>Perlu diperhatikan saat serah terima:</b>{" "}
            {pesan.join(" · ")}
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {ORDINAL.map((o) => (
          <KartuOrdinal key={o.jenis} label={o.label} nilai={hari[0][o.jenis]} streak={streakBuruk(hari, o.jenis)} />
        ))}
        <KartuAngka label="Berat badan" satuan="kg" tren={berat} />
        <KartuAngka label="Suhu tubuh" satuan="°C" tren={suhu}
          status={statusSuhu(suhu.terakhir)}
          catatan={`normal ${SUHU_NORMAL_MIN}–${SUHU_NORMAL_MAX}°C`} />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Grafik judul="Tren berat badan (kg)" tren={berat} warna="#2563eb" />
        <Grafik judul="Tren suhu tubuh (°C)" tren={suhu} warna="#dc2626"
          batas={{ min: SUHU_NORMAL_MIN, max: SUHU_NORMAL_MAX }} />
        {/* Skala Baik/Sedang/Buruk ikut jadi grafik: 3 = Baik, 1 = Buruk. */}
        {ORDINAL.map((o) => (
          <Grafik key={o.jenis} judul={`Tren ${o.label.toLowerCase()}`} tren={trenOrdinal(hari, o.jenis)}
            warna={o.warna} skalaOrdinal />
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th style={{ textAlign: "right" }}>Berat</th>
              <th style={{ textAlign: "right" }}>Suhu</th>
              <th>Makan</th>
              <th>Minum</th>
              <th>BAB</th>
              <th>BAK</th>
              <th style={{ textAlign: "center" }}>Foto</th>
            </tr>
          </thead>
          <tbody>
            {hari.map((h) => (
              <tr key={h.tanggal}>
                <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                  {tglPendek(h.tanggal)}
                  {h.jumlahLaporan > 1 && (
                    <div style={{ fontSize: 9, color: "var(--td)" }}>{h.jumlahLaporan} laporan</div>
                  )}
                </td>
                <td style={{ textAlign: "right", fontSize: 11.5 }}>{h.berat ?? "—"}</td>
                <td style={{ textAlign: "right", fontSize: 11.5, color: warnaSuhu(h.suhu) }}>{h.suhu ?? "—"}</td>
                <td><Tanda nilai={h.makan} /></td>
                <td><Tanda nilai={h.minum} /></td>
                <td><Tanda nilai={h.bab} /></td>
                <td><Tanda nilai={h.pipis} /></td>
                <td style={{ textAlign: "center", fontSize: 11 }}>
                  {h.foto.length > 0 ? `${h.foto.length} foto` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {semuaFoto.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <SubJudul icon="ti-photo" teks="FOTO PERKEMBANGAN" />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {semuaFoto.map((f, i) => (
              <a key={i} href={f.url} target="_blank" rel="noreferrer"
                style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                <div style={{ width: 92, height: 92, borderRadius: 8, overflow: "hidden", border: ".5px solid var(--bd)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={`Foto ${f.tanggal}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ fontSize: 9.5, color: "var(--td)", textAlign: "center", marginTop: 3 }}>{tglPendek(f.tanggal)}</div>
              </a>
            ))}
          </div>
        </div>
      )}

      {semuaKomunikasi.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <SubJudul icon="ti-message-2" teks="YANG SUDAH DISAMPAIKAN KE PEMILIK" />
          <div style={{ display: "grid", gap: 6 }}>
            {semuaKomunikasi.map((k, i) => (
              <div key={i} style={{ fontSize: 11, borderLeft: "2px solid #bfdbfe", paddingLeft: 9 }}>
                <span style={{ color: "var(--td)" }}>{tglPendek(k.tanggal)}</span>{" "}
                {k.via && <span className="bge b" style={{ fontSize: 8.5 }}>{k.via}</span>}{" "}
                {k.isi}
                {k.oleh && <span style={{ color: "var(--td)" }}> — {k.oleh}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Judul() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <i className="ti ti-activity-heartbeat" style={{ fontSize: 18, color: "#16a34a" }} />
      <div style={{ fontSize: 13, fontWeight: 800, color: "#16a34a", letterSpacing: ".02em" }}>PAPAN PEMANTAUAN</div>
      <span style={{ fontSize: 10, color: "var(--td)" }}>ringkasan perkembangan pasien selama dirawat</span>
    </div>
  );
}

function SubJudul({ icon, teks }: { icon: string; teks: string }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--sb)", letterSpacing: ".04em", marginBottom: 7 }}>
      <i className={`ti ${icon}`} /> {teks}
    </div>
  );
}

const LABEL_SKOR: Record<number, string> = { 3: "Baik", 2: "Sedang", 1: "Buruk" };

const ORDINAL: { jenis: JenisOrdinal; label: string; warna: string }[] = [
  { jenis: "makan", label: "Makan", warna: "#15803d" },
  { jenis: "minum", label: "Minum", warna: "#0891b2" },
  { jenis: "bab", label: "BAB", warna: "#b45309" },
  { jenis: "pipis", label: "BAK", warna: "#7c3aed" },
];

const WARNA_ORDINAL: Record<NilaiOrdinal, string> = {
  Baik: "g", Sedang: "o", Buruk: "r",
};

function Tanda({ nilai }: { nilai: NilaiOrdinal | null }) {
  if (nilai === null) return <span style={{ fontSize: 10, color: "var(--td)" }}>belum dicatat</span>;
  return <span className={`bge ${WARNA_ORDINAL[nilai]}`} style={{ fontSize: 9 }}>{nilai}</span>;
}

function KartuOrdinal({ label, nilai, streak }: {
  label: string; nilai: NilaiOrdinal | null; streak: { hari: number; terhentiKarenaKosong: boolean };
}) {
  const bahaya = nilai === "Buruk";
  const warna = nilai === "Buruk" ? "#b91c1c" : nilai === "Sedang" ? "#b45309" : nilai === "Baik" ? "#15803d" : "var(--td)";
  return (
    <div className="card" style={{ flex: "1 1 140px", background: bahaya ? "#fef2f2" : "var(--sf1)", borderColor: "transparent" }}>
      <div style={{ fontSize: 10.5, color: "var(--tm)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: warna, lineHeight: 1.35 }}>
        {nilai ?? "belum dicatat"}
      </div>
      <div style={{ fontSize: 9.5, color: "var(--td)" }}>
        {streak.hari >= 2
          ? `buruk ${streak.hari} hari berturut-turut`
          : streak.terhentiKarenaKosong ? "ada hari yang belum dicatat" : "catatan terakhir"}
      </div>
    </div>
  );
}

function warnaSuhu(suhu: number | null): string {
  const s = statusSuhu(suhu);
  return s === "demam" ? "#b91c1c" : s === "rendah" ? "#2563eb" : "inherit";
}

function KartuAngka({ label, satuan, tren, status, catatan }: {
  label: string; satuan: string; tren: Tren;
  status?: ReturnType<typeof statusSuhu>; catatan?: string;
}) {
  const naik = tren.arah === "naik";
  const turun = tren.arah === "turun";
  const warna = status === "demam" ? "#b91c1c" : status === "rendah" ? "#2563eb" : "var(--sb)";
  return (
    <div className="card" style={{ flex: "1 1 170px", background: "var(--sf1)", borderColor: "transparent" }}>
      <div style={{ fontSize: 10.5, color: "var(--tm)" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: warna, lineHeight: 1.3 }}>
        {tren.terakhir ?? "—"}{tren.terakhir !== null && <span style={{ fontSize: 12 }}> {satuan}</span>}
      </div>
      <div style={{ fontSize: 9.5, color: turun ? "#b45309" : naik ? "#15803d" : "var(--td)" }}>
        {tren.delta === null
          ? (catatan ?? "belum bisa dibandingkan")
          : `${naik ? "▲" : turun ? "▼" : "="} ${Math.abs(tren.delta)} ${satuan} dari catatan sebelumnya`}
      </div>
    </div>
  );
}

/** Grafik garis sederhana — tanpa pustaka tambahan, cukup untuk melihat arahnya. */
function Grafik({ judul, tren, warna, batas, skalaOrdinal }: {
  judul: string; tren: Tren; warna: string; batas?: { min: number; max: number };
  /** Grafik Baik/Sedang/Buruk: sumbunya dikunci 1–3 dan diberi label kata. */
  skalaOrdinal?: boolean;
}) {
  const titik = tren.titik;
  const W = 320, H = 90, P = 10;

  if (titik.length < 2) {
    return (
      <div style={{ flex: "1 1 300px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--tm)", marginBottom: 5 }}>{judul}</div>
        <div style={{ fontSize: 10, color: "var(--td)", padding: "22px 0", textAlign: "center", border: ".5px dashed var(--bd)", borderRadius: 8 }}>
          Butuh minimal dua kali pencatatan untuk melihat trennya.
        </div>
      </div>
    );
  }

  const nilai = titik.map((t) => t.nilai);
  const min = skalaOrdinal ? 1 : Math.min(...nilai, ...(batas ? [batas.min] : []));
  const max = skalaOrdinal ? 3 : Math.max(...nilai, ...(batas ? [batas.max] : []));
  const span = max - min || 1;
  const x = (i: number) => P + (i * (W - P * 2)) / (titik.length - 1);
  const y = (v: number) => H - P - ((v - min) / span) * (H - P * 2);
  const garis = titik.map((t, i) => `${x(i)},${y(t.nilai)}`).join(" ");

  return (
    <div style={{ flex: "1 1 300px" }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--tm)", marginBottom: 5 }}>{judul}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 90, border: ".5px solid var(--bd)", borderRadius: 8, background: "#fff" }}>
        {batas && (
          // Pita hijau = rentang normal, supaya menyimpangnya kelihatan tanpa membaca angka.
          <rect x={P} y={y(batas.max)} width={W - P * 2} height={Math.max(1, y(batas.min) - y(batas.max))}
            fill="#16a34a" opacity={0.08} />
        )}
        <polyline points={garis} fill="none" stroke={warna} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {titik.map((t, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(t.nilai)} r={3} fill={warna} />
            <title>{`${tglPendek(t.tanggal)}: ${skalaOrdinal ? LABEL_SKOR[t.nilai] ?? t.nilai : t.nilai}`}</title>
          </g>
        ))}
        {skalaOrdinal && (
          <>
            <text x={W - P} y={P + 4} fontSize={7.5} fill="#9ca3af" textAnchor="end">Baik</text>
            <text x={W - P} y={H - P + 2} fontSize={7.5} fill="#9ca3af" textAnchor="end">Buruk</text>
          </>
        )}
        <text x={P} y={H - 1} fontSize={8} fill="#9ca3af">{tglPendek(titik[0].tanggal)}</text>
        <text x={W - P} y={H - 1} fontSize={8} fill="#9ca3af" textAnchor="end">{tglPendek(titik.at(-1)!.tanggal)}</text>
      </svg>
    </div>
  );
}
