import type { ReactNode } from "react";
import Link from "next/link";
import type { KelompokDaftar } from "@/lib/rekam-medis-per-pasien";
import s from "./RekamMedisDaftar.module.css";

/** Pilihan tampilan daftar: Per pasien (bawaan) | Per kunjungan (tampilan lama). Tautan biasa (tanpa JS), filter ikut terbawa. */
export function PilihTampilanDaftar({ kelompok, q, tampilan, obat }: { kelompok: KelompokDaftar; q: string; tampilan: string; obat?: string }) {
  const href = (k: KelompokDaftar) => `/klinik/rekam-medis?${new URLSearchParams({ q, tampilan, kelompok: k, ...(obat ? { obat } : {}) })}`;
  const kelas = (aktif: boolean) => (aktif ? s.segAktif : undefined);
  return (
    <nav aria-label="Tampilan daftar rekam medis" className={s.seg}>
      <Link href={href("pasien")} className={kelas(kelompok === "pasien")} aria-current={kelompok === "pasien" ? "page" : undefined}>Per pasien</Link>
      <Link href={href("kunjungan")} className={kelas(kelompok === "kunjungan")} aria-current={kelompok === "kunjungan" ? "page" : undefined}>Per kunjungan</Link>
    </nav>
  );
}

/**
 * "Tampilkan": menggantikan tiga tautan teks. Tujuan dan parameter PERSIS seperti sebelumnya:
 * selain Rawat Inap aktif (tampilan=rawat-jalan) | semua riwayat (tampilan=semua) | halaman Rawat Inap aktif.
 */
export function PilihStatusDaftar({ q, kelompok, tampilan, obat }: { q: string; kelompok: string; tampilan: "rawat-jalan" | "semua"; obat?: string }) {
  const href = (t: "rawat-jalan" | "semua") => `/klinik/rekam-medis?${new URLSearchParams({ q, tampilan: t, kelompok, ...(obat ? { obat } : {}) })}`;
  const kelas = (aktif: boolean) => (aktif ? s.segAktif : undefined);
  return (
    <div className={s.kelompokKontrol}>
      <span className={s.labelKontrol} id="tampilkan-riwayat">Tampilkan:</span>
      <nav aria-labelledby="tampilkan-riwayat" className={s.seg}>
        <Link href={href("rawat-jalan")} className={kelas(tampilan === "rawat-jalan")} aria-current={tampilan === "rawat-jalan" ? "page" : undefined}
          title="Daftar rekam medis selain pasien Rawat Inap aktif">Selain Rawat Inap aktif</Link>
        <Link href={href("semua")} className={kelas(tampilan === "semua")} aria-current={tampilan === "semua" ? "page" : undefined}
          title="Semua riwayat, termasuk Rawat Inap">Semua riwayat</Link>
        <Link href="/klinik/rawat-inap" title="Buka daftar pasien Rawat Inap aktif">Rawat Inap aktif <i className="ti ti-arrow-up-right" aria-hidden="true" /></Link>
      </nav>
    </div>
  );
}

/**
 * Keping ringkasan satu baris di bawah subjudul. Struktur label lalu angka dipertahankan
 * (<div>LABEL</div><div>angka</div>) supaya pembaca layar dan uji lama tetap membaca keduanya.
 */
export function StatRingkas({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  return (
    <div className={s.stat}>
      <i className={`ti ${icon} ${s.statIkon}`} style={{ color }} aria-hidden="true" />
      <div className={s.statLabel} style={{ color }}>{label}</div>
      <div className={s.statNilai}>{value}</div>
    </div>
  );
}

/**
 * "Cara membaca daftar": tempat penjelasan yang dulu berupa paragraf panjang di badan halaman.
 * Tertutup bawaan (<details>, tanpa JavaScript); isinya tetap ada di halaman. Setiap catatan memakai syarat tampil
 * yang sama dengan sebelumnya.
 */
export function CaraBacaDaftar({ children }: { children: ReactNode }) {
  return (
    <details className={s.info}>
      <summary><i className="ti ti-info-circle" aria-hidden="true" /> Cara membaca daftar</summary>
      <div className={s.infoIsi}>{children}</div>
    </details>
  );
}
