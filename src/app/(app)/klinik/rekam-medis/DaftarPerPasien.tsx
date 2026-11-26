import Link from "next/link";
import { LABEL_RIWAYAT_IMPOR } from "@/lib/daftar-rekam-medis";
import { teksObatCocok } from "@/lib/daftar-rekam-medis-obat";
import { ringkasTeks, tanggalRekamMedis, type KelompokPasien } from "@/lib/rekam-medis-per-pasien";
import type { RingkasanSemuaCabang } from "@/lib/rekam-medis-semua-cabang";
import { BukaRekamMedisLink } from "./BukaRekamMedisLink";
import s from "./RekamMedisDaftar.module.css";

const labelCabang = (cabang: string | null, impor: boolean) => cabang ?? (impor ? LABEL_RIWAYAT_IMPOR : "Tanpa cabang");

/**
 * Satu baris ringkas per hewan (dipisah garis tipis): nama (ke riwayat) + jenis + jumlah kunjungan, lalu pemilik + kunjungan
 * terakhir (tanggal, cabang, status), lalu keluhan/diagnosa terakhir; tombol Riwayat + Buka terakhir di kanan.
 * Jumlah + "Terakhir" memakai `semuaCabang` (semua cabang yang boleh dibaca pengguna); bila ada cabang aktif dan
 * jumlahnya berbeda, keping "x di cabang ini" menunjukkan bagian cabang aktif. "Buka terakhir" selalu membuka
 * kunjungan terakhir yang bisa dibuka di cabang aktif (halaman detail dibaca per cabang aktif).
 */
export function DaftarPerPasien({ kelompok, semuaCabang, tampilkanObat = false }: { kelompok: KelompokPasien[]; semuaCabang: Map<string, RingkasanSemuaCabang>; tampilkanObat?: boolean }) {
  return (
    <ul className={s.daftar}>
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
        const jenis = [g.species, g.breed].filter(Boolean).join(" · ");
        return (
          <li key={g.kunci} className={s.baris} data-pasien={g.petId ?? undefined}>
            <div className={s.barisIsi}>
              <div className={s.barisJudul}>
                <span className={s.barisNama}>
                  {g.petId
                    ? <Link href={`/klinik/rekam-medis/pasien/${g.petId}`} title="Lihat riwayat lengkap pasien ini" style={{ color: "inherit", textDecoration: "underline" }}>{g.petName}</Link>
                    : g.petName}
                </span>
                <span className={s.barisJenis}>{jenis || "—"}</span>
                <span className={s.barisChip}>
                  <span className={`bge b ${s.keping}`}>{jumlah}{tanda ? "+" : ""} kunjungan</span>
                  {sc && sc.jumlahCabangIni !== null && sc.jumlahCabangIni !== sc.jumlah && (
                    <span className={`bge ${s.keping} ${s.kepingTepi}`} title="Kunjungan hewan ini di cabang aktif (ditambah riwayat impor). Sisanya di cabang lain.">{sc.jumlahCabangIni} di cabang ini</span>
                  )}
                  {rawatInap > 0 && <span className={`bge ${s.keping}`}>{rawatInap} rawat inap</span>}
                  {g.jumlahImpor > 0 && <span className={`bge ${s.keping}`} title="Riwayat hasil impor data lama">{g.jumlahImpor} impor</span>}
                  {g.kembar && <span className={`bge r ${s.keping}`} title="Ada hewan lain milik pemilik yang sama dengan nama dan jenis yang sama. Data tidak digabung.">Ada data hewan kembar</span>}
                </span>
              </div>
              <div className={s.barisMeta}>
                <b>{g.ownerName}</b>
                <span className={s.barisMetaHalus}>· {g.phone || "—"} · Terakhir: {tanggalRekamMedis(t.date)} · {t.cabang}</span>
                <span className={`bge ${t.status.badge} ${s.keping}`}>{t.status.label}</span>
                {t.lain && <span className={s.barisMetaHalus}>(cabang lain)</span>}
              </div>
              <div className={s.barisRingkas}>
                <span>{ringkas ? `Keluhan: ${ringkas}` : "Keluhan: —"}</span>
                <span>{dx ? `Diagnosa: ${dx}` : "Diagnosa: Belum diisi"}</span>
              </div>
              {tampilkanObat && (
                <div data-obat-cocok className={s.diberikan}>
                  {g.obatCocok.length === 0 ? <span>Diberikan: —</span> : g.obatCocok.map((o) => (
                    <span key={`${o.sumber}|${o.nama}`}>Diberikan: {teksObatCocok(o)}</span>
                  ))}
                </div>
              )}
            </div>
            <div className={s.barisAksi}>
              {g.petId && (
                <Link href={`/klinik/rekam-medis/pasien/${g.petId}`} className="btn-def" title="Semua kunjungan hewan ini dalam satu halaman">
                  <i className="ti ti-history" /> Riwayat
                </Link>
              )}
              <BukaRekamMedisLink href={`/klinik/rekam-medis/${g.terakhir.id}`} label={tampilkanObat ? "Buka kunjungan yang cocok" : t.lain ? "Buka terakhir di cabang ini" : "Buka terakhir"} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
