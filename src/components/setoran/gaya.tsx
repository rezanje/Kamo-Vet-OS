import type { CSSProperties, ReactNode } from "react";

// Gaya judul layar Rekap Setoran (daftar + detail): judul halaman paling besar, sub judul bagian jelas lebih besar
// dan lebih tebal daripada teks isi/tabel (12–13px). Dipakai bersama supaya semua bagian seragam.
export const JUDUL_HALAMAN: CSSProperties = { fontSize: 22, fontWeight: 700, lineHeight: 1.25 };
export const SUBJUDUL: CSSProperties = { fontSize: 17, fontWeight: 600, lineHeight: 1.3, margin: "0 0 10px" };

export function SubJudul({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <h3 className="setoran-subjudul" data-subjudul style={{ ...SUBJUDUL, ...style }}>{children}</h3>;
}
