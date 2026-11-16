import Link from "next/link";
import { deretBerat, titikGrafik, type KunjunganRiwayat, type ProfilPasien } from "@/lib/riwayat-pasien";

const tanggalPendek = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "2-digit" });
const kg = (n: number) => `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })} kg`;
const kapital = (v: string | null) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : null);
/** Berat per kunjungan yang ditampilkan di daftar kecil (terbaru); sisanya tetap di grafik. */
const MAKS_DAFTAR_BERAT = 12;

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9.5, color: "var(--td)" }}>{label}</div>
      <div style={{ fontSize: 12, overflowWrap: "anywhere" }}>{value || "—"}</div>
    </div>
  );
}

/** Kartu profil hewan + berat badan per kunjungan (grafik SVG mini tanpa pustaka tambahan). */
export function RiwayatPasienHeader({ profil, kunjungan }: { profil: ProfilPasien; kunjungan: KunjunganRiwayat[] }) {
  const deret = deretBerat(kunjungan);
  const titik = titikGrafik(deret);
  const adaBerat = deret.some((t) => t.berat != null);
  const daftar = deret.slice(-MAKS_DAFTAR_BERAT);
  const jenis = [profil.spesies, profil.ras].filter(Boolean).join(" · ");
  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: "var(--sb)" }}>{profil.nama}</span>
          {jenis && <span style={{ fontSize: 12, color: "var(--tm)" }}>{jenis}</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px 18px" }}>
          <Info label="Jenis kelamin" value={kapital(profil.kelamin)} />
          <Info label="Umur" value={profil.umur} />
          <Info label="Berat terkini" value={profil.beratTerkini != null ? kg(profil.beratTerkini) : null} />
          <Info label="Steril" value={profil.steril} />
          <Info label="Alergi" value={profil.alergi} />
          <Info label="Kondisi khusus" value={profil.kondisiKhusus} />
          <Info label="Golongan darah" value={profil.golonganDarah} />
          <Info label="Microchip" value={profil.microchip} />
          <Info label="Pemilik" value={profil.pemilik} />
          <Info label="HP pemilik" value={profil.telepon || null} />
        </div>
        {profil.hewanLain.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--tm)" }}>Hewan lain milik pemilik ini:</span>
            {profil.hewanLain.map((p) => (
              <Link key={p.id} href={`/klinik/rekam-medis/pasien/${p.id}`} className="bge" style={{ textDecoration: "none", fontSize: 11 }}>
                {p.nama}{p.spesies ? ` · ${p.spesies}` : ""}
              </Link>
            ))}
          </div>
        )}
      </div>

      {adaBerat && (
        <div className="card" style={{ marginBottom: 12 }} data-testid="berat-per-kunjungan">
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Berat badan per kunjungan</div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            {titik && (
              <svg width={160} height={36} viewBox="0 0 160 36" role="img" aria-label="Grafik berat badan dari kunjungan terlama ke terbaru" style={{ flexShrink: 0 }}>
                <polyline points={titik} fill="none" stroke="var(--posb)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            )}
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: "4px 14px", flexWrap: "wrap", fontSize: 11.5 }}>
              {daftar.map((t) => (
                <li key={t.visitId}>
                  <span style={{ color: "var(--td)" }}>{tanggalPendek(t.tanggal)}</span>{" "}
                  <b>{t.berat != null ? kg(t.berat) : "—"}</b>
                </li>
              ))}
            </ul>
          </div>
          {deret.length > daftar.length && <div style={{ fontSize: 10.5, color: "var(--td)", marginTop: 4 }}>Daftar menampilkan {daftar.length} kunjungan terbaru.</div>}
        </div>
      )}
    </>
  );
}
