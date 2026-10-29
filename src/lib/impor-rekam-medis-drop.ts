/** Antarmuka minimal File and Directory Entries API (Chrome/Edge desktop).
 * Isi file belum dibaca di tahap ini: hanya daftar File + jalur relatif. */
export type EntriFolderJatuh = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (ok: (file: File) => void, gagal: (error: DOMException) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: EntriFolderJatuh[]) => void, gagal: (error: DOMException) => void) => void };
};

export async function bacaFolderJatuh(entries: readonly EntriFolderJatuh[]): Promise<File[]> {
  const hasil: File[] = [];
  async function baca(entry: EntriFolderJatuh, induk: string): Promise<void> {
    const jalur = induk ? `${induk}/${entry.name}` : entry.name;
    if (entry.isFile && entry.file) {
      if (!/\.xlsx$/i.test(entry.name) || entry.name.startsWith("~$")) return;
      const asli = await new Promise<File>((ok, gagal) => entry.file!(ok, gagal));
      // Blob/File references do not parse the workbook or arrayBuffer() it here.
      const file = new File([asli], asli.name, { type: asli.type, lastModified: asli.lastModified });
      Object.defineProperty(file, "webkitRelativePath", { value: jalur });
      hasil.push(file);
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      // Chromium returns directory entries in batches (often at most 100).
      for (;;) {
        const batch = await new Promise<EntriFolderJatuh[]>((ok, gagal) => reader.readEntries(ok, gagal));
        if (!batch.length) break;
        for (const child of batch) await baca(child, jalur);
      }
    } else {
      throw new Error(`Folder/file “${entry.name}” tidak dapat dibaca. Coba pilih folder induknya.`);
    }
  }
  for (const entry of entries) await baca(entry, "");
  return hasil;
}
