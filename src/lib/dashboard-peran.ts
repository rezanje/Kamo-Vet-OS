// Dashboard menyesuaikan peran (permintaan Pak Andri, meeting 14 Agustus:
// "sekarang isinya condong ke keuangan").
//
// Tiga sudut pandang, bukan tiga halaman: orang keuangan, orang operasional, dan
// orang marketing melihat angka yang berbeda dari data yang sama. Sudut pandang
// bawaannya ikut peran, tapi tetap boleh dipindah — owner memakai ketiganya.

export const SUDUT = ["keuangan", "operasional", "marketing"] as const;
export type Sudut = (typeof SUDUT)[number];

export const LABEL_SUDUT: Record<Sudut, string> = {
  keuangan: "Keuangan",
  operasional: "Operasional",
  marketing: "Marketing",
};

/** Sudut pandang bawaan menurut peran login. */
export function sudutBawaan(role: string | null | undefined): Sudut {
  switch ((role ?? "").toUpperCase()) {
    case "FINANCE": return "keuangan";
    case "STAFF":
    case "DOCTOR": return "operasional";
    default: return "keuangan";     // OWNER/ADMIN: uang dulu, sisanya tinggal klik
  }
}

/** Sudut pandang dari URL; yang tidak dikenal jatuh ke bawaan perannya. */
export function bacaSudut(raw: string | null | undefined, role: string | null | undefined): Sudut {
  const s = String(raw ?? "").toLowerCase();
  return (SUDUT as readonly string[]).includes(s) ? (s as Sudut) : sudutBawaan(role);
}

export type AngkaOperasional = {
  kunjunganHariIni: number;
  menungguAntrian: number;
  groomingHariIni: number;
  transaksiKasirHariIni: number;
  omzetKasirHariIni: number;
  stokMenipis: number;
};

export type AngkaMarketing = {
  promoAktif: number;
  voucherAktif: number;
  pelangganBaruBulanIni: number;
  poinBeredar: number;
  produkTeratas: { nama: string; qty: number }[];
};
