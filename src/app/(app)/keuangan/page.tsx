import { redirect } from "next/navigation";

// Modul "Keuangan" dibongkar mengikuti penggolongan Accurate (2026-07-28):
// isinya pindah ke Buku Besar / Kas & Bank / Aset Tetap / Pajak / Daftar Laporan.
// Route anak (/keuangan/*) tetap dipakai — hanya halaman modulnya yang dialihkan.
export default function Page() {
  redirect("/laporan");
}
