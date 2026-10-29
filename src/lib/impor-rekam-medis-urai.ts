// Protokol pesan antara tab dan Web Worker pengurai kartu medis.
//
// Mengurai Excel memakai CPU penuh. Dijalankan di tab, halaman membeku dan pengguna
// mengira aplikasinya hang. Dijalankan di worker, tab tetap bisa dipakai dan tombol
// Jeda tetap menyala. Pengurainya persis fungsi yang sama dengan yang dipakai server,
// jadi hasilnya identik -- tidak ada aturan pembacaan kartu yang digandakan.

import { bacaWorkbooksRekamMedis, type RekamMedisWorkbookResult } from "./impor-rekam-medis";

export type BerkasUraiRekamMedis = { fileName: string; sourcePath: string; bytes: Uint8Array };

export type PermintaanUraiRekamMedis = { id: number; berkas: BerkasUraiRekamMedis[] };

export type JawabanUraiRekamMedis =
  | { id: number; ok: true; hasil: RekamMedisWorkbookResult }
  | { id: number; ok: false; pesan: string };

export async function tanganiUraiRekamMedis(permintaan: PermintaanUraiRekamMedis): Promise<JawabanUraiRekamMedis> {
  try {
    const hasil = await bacaWorkbooksRekamMedis(permintaan.berkas.map((berkas) => ({
      fileName: berkas.fileName,
      sourcePath: berkas.sourcePath,
      bytes: berkas.bytes,
    })));
    return { id: permintaan.id, ok: true, hasil };
  } catch (cause) {
    return { id: permintaan.id, ok: false, pesan: cause instanceof Error ? cause.message : "Kartu medis gagal dibaca." };
  }
}
