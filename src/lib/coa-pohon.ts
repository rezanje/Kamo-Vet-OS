// Bagan akun bertingkat: akun induk (header) menampung akun rincian (detail).
// Murni — dites di __tests__/coa-pohon.test.ts.
//
// Dua aturan yang menjaga laporan tetap benar:
//   1. Jurnal hanya menempel di akun DETAIL. Akun induk adalah penjumlahan; kalau
//      ikut diposting, angkanya dihitung dua kali (sekali sebagai saldo sendiri,
//      sekali lagi lewat penjumlahan anaknya).
//   2. Induk sekelompok dengan anaknya. Menaruh akun beban di bawah induk aset
//      membuat subtotalnya menjumlahkan dua arah saldo yang berlawanan.

export type AkunPohon = {
  id: string;
  code: string;
  name: string;
  type: string;
  parent_id: string | null;
  is_header: boolean;
};

export type SimpulAkun<T extends AkunPohon> = {
  akun: T;
  level: number;
  anak: SimpulAkun<T>[];
};

/**
 * Susun daftar akun datar menjadi pohon, urut kode di tiap tingkat. Akun yang
 * induknya tidak ada (atau melingkar) diperlakukan sebagai akun tingkat atas —
 * lebih baik tampil di tempat yang salah daripada hilang dari layar.
 */
export function susunPohon<T extends AkunPohon>(rows: T[]): SimpulAkun<T>[] {
  const perId = new Map(rows.map((r) => [r.id, r]));
  const anakDari = new Map<string | null, T[]>();

  for (const r of rows) {
    const induk = r.parent_id && perId.has(r.parent_id) && !melingkar(r, perId) ? r.parent_id : null;
    anakDari.set(induk, [...(anakDari.get(induk) ?? []), r]);
  }

  const bangun = (indukId: string | null, level: number): SimpulAkun<T>[] =>
    (anakDari.get(indukId) ?? [])
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((akun) => ({ akun, level, anak: bangun(akun.id, level + 1) }));

  return bangun(null, 0);
}

/** Pohon diratakan lagi jadi daftar berurutan — bentuk yang dipakai tabel laporan. */
export function ratakan<T extends AkunPohon>(pohon: SimpulAkun<T>[]): SimpulAkun<T>[] {
  return pohon.flatMap((s) => [s, ...ratakan(s.anak)]);
}

/**
 * Saldo akun induk = jumlah seluruh keturunannya. Akun detail memakai saldonya
 * sendiri. Dipakai laporan supaya baris induk memperlihatkan totalnya tanpa
 * pernah menyimpan angka ganda di database.
 */
export function saldoDenganRollup<T extends AkunPohon>(
  pohon: SimpulAkun<T>[],
  saldoPerId: Map<string, number>,
): Map<string, number> {
  const hasil = new Map<string, number>();

  const hitung = (s: SimpulAkun<T>): number => {
    const anak = s.anak.reduce((a, c) => a + hitung(c), 0);
    const nilai = s.anak.length > 0 ? anak : (saldoPerId.get(s.akun.id) ?? 0);
    hasil.set(s.akun.id, nilai);
    return nilai;
  };

  pohon.forEach(hitung);
  return hasil;
}

/** true kalau akun ini keturunan dirinya sendiri (data rusak / induk melingkar). */
function melingkar<T extends AkunPohon>(akun: T, perId: Map<string, T>): boolean {
  const lewat = new Set<string>([akun.id]);
  let kini = akun.parent_id;
  while (kini) {
    if (lewat.has(kini)) return true;
    lewat.add(kini);
    kini = perId.get(kini)?.parent_id ?? null;
  }
  return false;
}

export type DraftInduk = {
  /** id akun yang sedang disimpan; kosong kalau akun baru. */
  id?: string;
  type: string;
  parent_id: string | null;
  is_header: boolean;
};

/**
 * Validasi induk & jenis akun. Mengembalikan pesan error, atau null kalau lolos.
 * `punyaJurnal` dan `punyaAnak` dibaca pemanggil dari database.
 */
export function validasiIndukAkun(
  d: DraftInduk,
  semua: AkunPohon[],
  keadaan: { punyaJurnal: boolean; punyaAnak: boolean },
): string | null {
  if (d.is_header && keadaan.punyaJurnal) {
    return "Akun ini sudah dipakai di jurnal, jadi tidak bisa dijadikan akun induk. Akun induk hanya menjumlahkan rinciannya.";
  }
  if (!d.is_header && keadaan.punyaAnak) {
    return "Akun ini masih punya akun rincian di bawahnya. Pindahkan dulu rinciannya sebelum mengubahnya jadi akun detail.";
  }

  if (!d.parent_id) return null;
  if (d.id && d.parent_id === d.id) return "Akun tidak bisa menjadi induk dirinya sendiri.";

  const induk = semua.find((a) => a.id === d.parent_id);
  if (!induk) return "Akun induk tidak ditemukan.";
  if (!induk.is_header) {
    return `Akun ${induk.code} ${induk.name} bukan akun induk. Jadikan dulu akun itu sebagai induk, atau pilih induk lain.`;
  }
  if (induk.type !== d.type) {
    return `Induk harus sekelompok: ${induk.code} ada di kelompok ${induk.type}, sedangkan akun ini ${d.type}.`;
  }

  // Induk baru tidak boleh keturunan akun ini sendiri — kalau lolos, cabangnya
  // hilang dari pohon (induk dan anak saling menunjuk).
  if (d.id) {
    const perId = new Map(semua.map((a) => [a.id, a]));
    let kini: string | null = induk.parent_id;
    while (kini) {
      if (kini === d.id) return "Akun itu ada di bawah akun ini — induknya jadi melingkar.";
      kini = perId.get(kini)?.parent_id ?? null;
    }
  }

  return null;
}
