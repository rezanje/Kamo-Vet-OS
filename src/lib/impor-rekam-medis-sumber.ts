// Sumber berkas impor rekam medis.
//
// Alur impor (potong -> baca -> urai -> simpan -> lepas memori) tidak boleh tahu dari mana
// berkasnya datang. Hari ini hanya ada satu sumber: folder lokal yang dipilih di browser.
// Sumber Google Drive (service account, folder dibagikan ke akunnya) nanti cukup
// mengimplementasikan antarmuka yang sama tanpa menyentuh pemotongan, simpan massal,
// atau lanjut-setelah-putus.

export type BerkasImporRekamMedis = {
  /** Stabil selama satu sumber hidup; dipakai untuk melanjutkan setelah putus. */
  id: string;
  nama: string;
  /** Jalur relatif terhadap akar pilihan, mis. "Budi - 0812/Snowy.xlsx". */
  jalur: string;
  ukuran: number;
};

export type FolderImporRekamMedis = {
  id: string;
  nama: string;
  berkas: BerkasImporRekamMedis[];
  ukuran: number;
};

export type SumberImporRekamMedis = {
  nama: string;
  /** Akar pilihan; dipakai sebagai bagian tanda ruang titik simpan. */
  akar: string;
  daftarFolder(): Promise<FolderImporRekamMedis[]>;
  bacaBerkas(berkas: BerkasImporRekamMedis): Promise<Uint8Array>;
};

export const BATAS_BYTES_BERKAS_REKAM_MEDIS = 5 * 1024 * 1024;

const FOLDER_TANPA_NAMA = "(tanpa folder)";

function jalurAman(mentah: string, namaBerkas: string) {
  const bagian = mentah.replace(/\\/g, "/").split("/").filter(Boolean);
  if (!bagian.length || bagian.includes("..") || bagian.at(-1) !== namaBerkas || mentah.length > 500) return namaBerkas;
  return bagian.join("/");
}

export function berkasRekamMedisTerpakai(nama: string) {
  return nama.toLowerCase().endsWith(".xlsx") && !nama.startsWith("~$");
}

/** Kelompokkan berkas menjadi folder pemilik, berurutan stabil supaya bisa dilanjutkan. */
export function kelompokkanFolderImpor(berkas: BerkasImporRekamMedis[]): FolderImporRekamMedis[] {
  const folders = new Map<string, FolderImporRekamMedis>();
  for (const item of berkas) {
    const bagian = item.jalur.split("/");
    const nama = bagian.length > 1 ? bagian.slice(0, -1).join("/") : FOLDER_TANPA_NAMA;
    const folder = folders.get(nama) ?? { id: nama, nama, berkas: [], ukuran: 0 };
    folder.berkas.push(item);
    folder.ukuran += item.ukuran;
    folders.set(nama, folder);
  }
  const urut = (a: string, b: string) => a.localeCompare(b, "id-ID");
  return [...folders.values()]
    .map((folder) => ({ ...folder, berkas: [...folder.berkas].sort((a, b) => urut(a.nama, b.nama)) }))
    .sort((a, b) => urut(a.nama, b.nama));
}

type BerkasLokal = { name: string; size: number; webkitRelativePath?: string; arrayBuffer(): Promise<ArrayBuffer> };

/** Sumber folder lokal: berkas yang sudah ada di komputer pengguna. */
export function sumberFolderLokal(berkasTerpilih: readonly BerkasLokal[]): SumberImporRekamMedis {
  const isi = new Map<string, BerkasLokal>();
  const daftar: BerkasImporRekamMedis[] = [];
  berkasTerpilih.forEach((file, index) => {
    if (!berkasRekamMedisTerpakai(file.name)) return;
    const jalur = jalurAman(file.webkitRelativePath || file.name, file.name);
    const id = `${index}::${jalur}`;
    isi.set(id, file);
    daftar.push({ id, nama: file.name, jalur, ukuran: file.size });
  });
  const folders = kelompokkanFolderImpor(daftar);
  // Bisa beberapa folder utama sekaligus (tombol "Tambah folder lain"):
  // tanda ruang impor memakai semua akar, terurut, supaya lanjut-setelah-putus tetap cocok.
  const akar = [...new Set(daftar.map((berkas) => berkas.jalur.split("/")[0]))].sort().join(" + ") || "lokal";
  return {
    nama: "Folder di komputer ini",
    akar,
    async daftarFolder() {
      return folders;
    },
    async bacaBerkas(berkas) {
      const file = isi.get(berkas.id);
      if (!file) throw new Error("Berkas tidak lagi tersedia. Pilih ulang foldernya.");
      return new Uint8Array(await file.arrayBuffer());
    },
  };
}

/** Gabungkan pilihan folder baru ke pilihan sebelumnya; berkas yang sama
 * (jalur + ukuran) tidak dihitung dua kali bila folder yang sama dipilih ulang. */
export function gabungBerkasPilihan<T extends { name: string; size: number; webkitRelativePath?: string }>(lama: readonly T[], baru: readonly T[]): T[] {
  const kunci = (file: T) => `${file.webkitRelativePath || file.name}::${file.size}`;
  const ada = new Set(lama.map(kunci));
  const hasil = [...lama];
  for (const file of baru) {
    const k = kunci(file);
    if (ada.has(k)) continue;
    ada.add(k);
    hasil.push(file);
  }
  return hasil;
}

/** Nama folder utama yang sedang dipilih (untuk ditampilkan). */
export function daftarFolderUtama(berkas: readonly { name: string; webkitRelativePath?: string }[]): string[] {
  return [...new Set(berkas.map((file) => (file.webkitRelativePath || "").split("/")[0]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id-ID"));
}
