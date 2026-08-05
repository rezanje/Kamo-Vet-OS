// Pendaftaran rombongan — satu pemilik membawa beberapa hewan dalam satu kedatangan.
// Murni, dites di __tests__/rombongan.test.ts
//
// Yang TIDAK digabung: rekam medis dan kunjungan. Tiap hewan tetap punya kunjungan
// sendiri supaya riwayat medis, insentif dokter, dan laporan per pasien tetap benar.
// Yang digabung cuma pengalamannya: sekali isi data pemilik, nomor antrian berurutan.

export type PetDraft = {
  /** id anabul lama kalau dipilih dari daftar; kosong = anabul baru. */
  id: string;
  name: string;
  species: string;
  breed: string;
  warna: string;
  dob: string;
  gender: string;
  weight: number | null;
  sterilisasi: string;
  microchip: string;
  alergi: string;
  kondisi_khusus: string;
  golongan_darah: string;
  photo_url: string;
  /** Keluhan dipegang per hewan — tiga kucing satu pemilik bisa datang dengan tiga masalah. */
  keluhan: string;
};

export const petKosong = (): PetDraft => ({
  id: "", name: "", species: "Anjing", breed: "", warna: "", dob: "", gender: "Jantan",
  weight: null, sterilisasi: "Utuh", microchip: "", alergi: "", kondisi_khusus: "",
  golongan_darah: "", photo_url: "", keluhan: "",
});

/** Batas wajar satu kedatangan. Bukan aturan bisnis, cuma pagar dari kiriman ngawur. */
export const MAKS_HEWAN = 10;

export type HasilBaca =
  | { ok: true; pets: PetDraft[] }
  | { ok: false; pesan: string };

const teks = (v: unknown) => String(v ?? "").trim();

/**
 * Baca daftar hewan dari form. Semua hewan divalidasi lebih dulu sebelum satu pun
 * kunjungan dibuat — pendaftaran rombongan yang berhasil separuh meninggalkan
 * antrian yang tidak lengkap dan staf tidak tahu harus mengulang dari mana.
 */
export function bacaPets(raw: unknown): HasilBaca {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? "[]"));
  } catch {
    return { ok: false, pesan: "Data hewan tidak terbaca." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, pesan: "Isi minimal satu data hewan." };
  }
  if (parsed.length > MAKS_HEWAN) {
    return { ok: false, pesan: `Maksimal ${MAKS_HEWAN} hewan dalam satu pendaftaran.` };
  }

  const pets: PetDraft[] = [];
  const namaTerpakai = new Set<string>();

  for (const [i, r] of (parsed as Record<string, unknown>[]).entries()) {
    const urutan = i + 1;
    const name = teks(r.name);
    if (!name) return { ok: false, pesan: `Nama hewan ke-${urutan} wajib diisi.` };

    const species = teks(r.species);
    if (!species) return { ok: false, pesan: `Jenis hewan ke-${urutan} wajib dipilih.` };

    // Nama kembar di satu pemilik ditolak sejak di form: kalau diteruskan, keduanya
    // akan menunjuk kartu anabul yang sama dan dua kunjungan menumpuk di satu hewan.
    const kunci = name.toLowerCase();
    if (namaTerpakai.has(kunci)) {
      return { ok: false, pesan: `"${name}" terdaftar dua kali dalam satu pendaftaran ini.` };
    }
    namaTerpakai.add(kunci);

    const beratMentah = r.weight;
    const berat = beratMentah === null || beratMentah === undefined || beratMentah === ""
      ? null
      : Number(beratMentah);
    if (berat !== null && (!Number.isFinite(berat) || berat < 0)) {
      return { ok: false, pesan: `Berat badan hewan ke-${urutan} tidak valid.` };
    }

    pets.push({
      id: teks(r.id),
      name,
      species,
      breed: teks(r.breed),
      warna: teks(r.warna),
      dob: teks(r.dob),
      gender: teks(r.gender) || "Jantan",
      weight: berat,
      sterilisasi: teks(r.sterilisasi) || "Utuh",
      microchip: teks(r.microchip),
      alergi: teks(r.alergi),
      kondisi_khusus: teks(r.kondisi_khusus),
      golongan_darah: teks(r.golongan_darah),
      photo_url: teks(r.photo_url),
      keluhan: teks(r.keluhan),
    });
  }

  return { ok: true, pets };
}

/**
 * Keluhan yang disimpan di kunjungan. Tujuan kontrol ditempel di belakang supaya
 * dokter melihat konteksnya tanpa membuka dokumen lain.
 */
export function susunKeluhan(keluhan: string, kontrol: string, tujuan: string): string | null {
  const dasar = teks(keluhan);
  const t = teks(tujuan);
  const gabung = kontrol === "ulang" && t
    ? `${dasar ? dasar + " " : ""}[Kontrol: ${t}]`
    : dasar;
  return gabung || null;
}

/** Label ringkas rombongan untuk layar antrian & pembayaran. */
export function ringkasRombongan(namaHewan: string[]): string {
  if (namaHewan.length <= 1) return namaHewan[0] ?? "—";
  return `${namaHewan.length} pasien · ${namaHewan.join(", ")}`;
}
