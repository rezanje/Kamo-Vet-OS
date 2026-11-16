import Link from "next/link";
import { LABEL_RIWAYAT_IMPOR } from "@/lib/daftar-rekam-medis";
import { ringkasTeks, tanggalRekamMedis, type KelompokDaftar, type KelompokPasien } from "@/lib/rekam-medis-per-pasien";
import { BukaRekamMedisLink } from "./BukaRekamMedisLink";

/** Pilihan tampilan daftar: Per pasien (bawaan) | Per kunjungan (tampilan lama). Tautan biasa (tanpa JS), filter ikut terbawa. */
export function PilihTampilanDaftar({ kelompok, q, tampilan }: { kelompok: KelompokDaftar; q: string; tampilan: string }) {
  const href = (k: KelompokDaftar) => `/klinik/rekam-medis?${new URLSearchParams({ q, tampilan, kelompok: k })}`;
  const gaya = (aktif: boolean) => ({
    textDecoration: "none", minHeight: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "1 1 120px",
    padding: "6px 14px", fontSize: 12, fontWeight: aktif ? 800 : 600, borderRadius: 8,
    background: aktif ? "var(--posb)" : "transparent", color: aktif ? "#fff" : "inherit",
  }) as const;
  return (
    <nav aria-label="Tampilan daftar rekam medis" style={{ display: "flex", gap: 4, padding: 3, border: "1px solid var(--bd, #e5e7eb)", borderRadius: 10, marginBottom: 12, maxWidth: 420 }}>
      <Link href={href("pasien")} aria-current={kelompok === "pasien" ? "page" : undefined} style={gaya(kelompok === "pasien")}>Per pasien</Link>
      <Link href={href("kunjungan")} aria-current={kelompok === "kunjungan" ? "page" : undefined} style={gaya(kelompok === "kunjungan")}>Per kunjungan</Link>
    </nav>
  );
}

const chip = { fontSize: 10.5, padding: "2px 8px" } as const;

/** Satu kartu per hewan: nama (ke riwayat), pemilik, jumlah kunjungan, kunjungan terakhir, Riwayat + Buka terakhir. */
export function DaftarPerPasien({ kelompok, jendelaHabis }: { kelompok: KelompokPasien[]; jendelaHabis: boolean }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
      {kelompok.map((g) => {
        const t = g.terakhir;
        const ringkas = ringkasTeks(t.note);
        const dx = ringkasTeks(t.diagnosis);
        return (
          <li key={g.kunci} className="card" data-pasien={g.petId ?? undefined} style={{ padding: 12, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 15, overflowWrap: "anywhere" }}>
                  {g.petId
                    ? <Link href={`/klinik/rekam-medis/pasien/${g.petId}`} title="Lihat riwayat lengkap pasien ini" style={{ color: "inherit", textDecoration: "underline" }}>{g.petName}</Link>
                    : g.petName}
                </div>
                <div style={{ fontSize: 11, color: "var(--tm)" }}>{[g.species, g.breed].filter(Boolean).join(" · ") || "—"}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 12 }}>
                <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{g.ownerName}</div>
                <div style={{ fontSize: 11, color: "var(--tm)" }}>{g.phone || "—"}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="bge b" style={chip}>{g.jumlah}{jendelaHabis ? "+" : ""} kunjungan</span>
              {g.jumlahRawatInap > 0 && <span className="bge" style={chip}>{g.jumlahRawatInap} rawat inap</span>}
              {g.jumlahImpor > 0 && <span className="bge" title="Riwayat hasil impor data lama" style={chip}>{g.jumlahImpor} impor</span>}
              {g.kembar && <span className="bge r" title="Ada hewan lain milik pemilik yang sama dengan nama dan jenis yang sama. Data tidak digabung." style={chip}>Ada data hewan kembar</span>}
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.45 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <b>Terakhir:</b> {tanggalRekamMedis(t.date)} · {t.branch ?? (t.isImported ? LABEL_RIWAYAT_IMPOR : "Tanpa cabang")}
                <span className={`bge ${t.patientStatus.badge}`} style={chip}>{t.patientStatus.label}</span>
              </div>
              <div style={{ color: "var(--tm)" }}>{ringkas ? `Keluhan: ${ringkas}` : "Keluhan: —"}</div>
              <div style={{ color: "var(--tm)" }}>{dx ? `Diagnosa: ${dx}` : "Diagnosa: Belum diisi"}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {g.petId && (
                <Link href={`/klinik/rekam-medis/pasien/${g.petId}`} className="btn-acc" title="Semua kunjungan hewan ini dalam satu halaman"
                  style={{ textDecoration: "none", background: "var(--posb)", minHeight: 44, flex: "1 1 140px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                  <i className="ti ti-history" /> Riwayat
                </Link>
              )}
              <BukaRekamMedisLink href={`/klinik/rekam-medis/${t.id}`} label="Buka terakhir" besar />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
