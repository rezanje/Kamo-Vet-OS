import Link from "next/link";
import { LABEL_RIWAYAT_IMPOR } from "@/lib/daftar-rekam-medis";
import { ringkasTeks, tanggalRekamMedis, type KelompokDaftar, type KelompokPasien } from "@/lib/rekam-medis-per-pasien";
import type { RingkasanSemuaCabang } from "@/lib/rekam-medis-semua-cabang";
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

const labelCabang = (cabang: string | null, impor: boolean) => cabang ?? (impor ? LABEL_RIWAYAT_IMPOR : "Tanpa cabang");

/**
 * Satu kartu per hewan: nama (ke riwayat), pemilik, jumlah kunjungan, kunjungan terakhir, Riwayat + Buka terakhir.
 * Jumlah + "Terakhir" memakai `semuaCabang` (semua cabang yang boleh dibaca pengguna); bila ada cabang aktif dan
 * jumlahnya berbeda, chip "x di cabang ini" menunjukkan bagian cabang aktif. "Buka terakhir" selalu membuka
 * kunjungan terakhir yang bisa dibuka di cabang aktif (halaman detail dibaca per cabang aktif).
 */
export function DaftarPerPasien({ kelompok, semuaCabang }: { kelompok: KelompokPasien[]; semuaCabang: Map<string, RingkasanSemuaCabang> }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
      {kelompok.map((g) => {
        const sc = semuaCabang.get(g.kunci);
        // Tanpa ringkasan semua cabang (mis. kunjungan tanpa pet_id): tampil seperti semula, dari jendela daftar.
        const t = sc ? { date: sc.terakhir.date, cabang: labelCabang(sc.terakhir.branch, sc.terakhir.isImported), status: sc.terakhir.patientStatus, note: sc.terakhir.note, diagnosis: sc.terakhir.diagnosis, lain: !sc.terakhir.dalamCabangIni }
          : { date: g.terakhir.date, cabang: labelCabang(g.terakhir.branch, g.terakhir.isImported), status: g.terakhir.patientStatus, note: g.terakhir.note, diagnosis: g.terakhir.diagnosis, lain: false };
        const jumlah = sc ? sc.jumlah : g.jumlah;
        const rawatInap = sc ? sc.jumlahRawatInap : g.jumlahRawatInap;
        const tanda = sc ? sc.lebih : Boolean(g.petId); // hewan ber-pet_id tanpa ringkasan hanya bila bacaan terpotong
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
              <span className="bge b" style={chip}>{jumlah}{tanda ? "+" : ""} kunjungan</span>
              {sc && sc.jumlahCabangIni !== null && sc.jumlahCabangIni !== sc.jumlah && (
                <span className="bge" title="Kunjungan hewan ini di cabang aktif (ditambah riwayat impor). Sisanya di cabang lain." style={{ ...chip, color: "var(--tm)", background: "transparent", border: "1px solid var(--bd, #e5e7eb)" }}>{sc.jumlahCabangIni} di cabang ini</span>
              )}
              {rawatInap > 0 && <span className="bge" style={chip}>{rawatInap} rawat inap</span>}
              {g.jumlahImpor > 0 && <span className="bge" title="Riwayat hasil impor data lama" style={chip}>{g.jumlahImpor} impor</span>}
              {g.kembar && <span className="bge r" title="Ada hewan lain milik pemilik yang sama dengan nama dan jenis yang sama. Data tidak digabung." style={chip}>Ada data hewan kembar</span>}
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.45 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <b>Terakhir:</b> {tanggalRekamMedis(t.date)} · {t.cabang}
                <span className={`bge ${t.status.badge}`} style={chip}>{t.status.label}</span>
                {t.lain && <span style={{ fontSize: 10.5, color: "var(--tm)" }}>(cabang lain)</span>}
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
              <BukaRekamMedisLink href={`/klinik/rekam-medis/${g.terakhir.id}`} label={t.lain ? "Buka terakhir di cabang ini" : "Buka terakhir"} besar />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
