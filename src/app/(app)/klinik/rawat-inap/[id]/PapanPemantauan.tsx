// Papan pemantauan rawat inap — jawaban untuk pertanyaan yang muncul tiap ganti
// shift: "sudah berapa hari nggak BAB?", "beratnya naik atau turun?", "owner sudah
// dikabari apa?". Semua dibaca dari laporan harian yang sudah diisi dokter, jadi
// tidak ada input tambahan yang harus diisi dua kali.

import {
  ringkasPerHari, streakTidakAda, trenAngka, statusSuhu, peringatan,
  SUHU_NORMAL_MIN, SUHU_NORMAL_MAX,
  type LaporanHarian, type Tren,
} from "@/lib/monitoring-inap";

const tglPendek = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });

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

  const bab = streakTidakAda(hari, "bab");
  const pipis = streakTidakAda(hari, "pipis");
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
        <KartuStreak label="Belum BAB" streak={bab} />
        <KartuStreak label="Belum pipis" streak={pipis} />
        <KartuAngka label="Berat badan" satuan="kg" tren={berat} />
        <KartuAngka label="Suhu tubuh" satuan="°C" tren={suhu}
          status={statusSuhu(suhu.terakhir)}
          catatan={`normal ${SUHU_NORMAL_MIN}–${SUHU_NORMAL_MAX}°C`} />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Grafik judul="Tren berat badan (kg)" tren={berat} warna="#2563eb" />
        <Grafik judul="Tren suhu tubuh (°C)" tren={suhu} warna="#dc2626"
          batas={{ min: SUHU_NORMAL_MIN, max: SUHU_NORMAL_MAX }} />
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
              <th>Pipis</th>
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
                <td style={{ fontSize: 11 }}>{h.makan ?? <Kosong />}</td>
                <td style={{ fontSize: 11 }}>{h.minum ?? <Kosong />}</td>
                <td><Tanda ada={h.adaBab} /></td>
                <td><Tanda ada={h.adaPipis} /></td>
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

const Kosong = () => <span style={{ color: "var(--td)" }}>belum dicatat</span>;

function Tanda({ ada }: { ada: boolean | null }) {
  if (ada === null) return <span style={{ fontSize: 10, color: "var(--td)" }}>belum dicatat</span>;
  return ada
    ? <span className="bge g" style={{ fontSize: 9 }}>ada</span>
    : <span className="bge r" style={{ fontSize: 9 }}>tidak ada</span>;
}

function warnaSuhu(suhu: number | null): string {
  const s = statusSuhu(suhu);
  return s === "demam" ? "#b91c1c" : s === "rendah" ? "#2563eb" : "inherit";
}

function KartuStreak({ label, streak }: { label: string; streak: { hari: number; terhentiKarenaKosong: boolean } }) {
  const bahaya = streak.hari >= 2;
  return (
    <div className="card" style={{ flex: "1 1 170px", background: bahaya ? "#fef2f2" : "var(--sf1)", borderColor: "transparent" }}>
      <div style={{ fontSize: 10.5, color: "var(--tm)" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: bahaya ? "#b91c1c" : "#15803d", lineHeight: 1.3 }}>
        {streak.hari} hari
      </div>
      <div style={{ fontSize: 9.5, color: "var(--td)" }}>
        {streak.terhentiKarenaKosong
          ? "hitungan berhenti — ada hari yang belum dicatat"
          : streak.hari === 0 ? "terakhir tercatat normal" : "berturut-turut sampai catatan terakhir"}
      </div>
    </div>
  );
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
function Grafik({ judul, tren, warna, batas }: {
  judul: string; tren: Tren; warna: string; batas?: { min: number; max: number };
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
  const min = Math.min(...nilai, ...(batas ? [batas.min] : []));
  const max = Math.max(...nilai, ...(batas ? [batas.max] : []));
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
            <title>{`${tglPendek(t.tanggal)}: ${t.nilai}`}</title>
          </g>
        ))}
        <text x={P} y={H - 1} fontSize={8} fill="#9ca3af">{tglPendek(titik[0].tanggal)}</text>
        <text x={W - P} y={H - 1} fontSize={8} fill="#9ca3af" textAnchor="end">{tglPendek(titik.at(-1)!.tanggal)}</text>
      </svg>
    </div>
  );
}
