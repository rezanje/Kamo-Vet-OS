import { describe, expect, it } from "vitest";
import { bacaFolderJatuh, type EntriFolderJatuh } from "../impor-rekam-medis-drop";

function file(nama: string): EntriFolderJatuh {
  return { name: nama, isFile: true, isDirectory: false,
    file: (ok) => ok(new File(["test"], nama)) };
}
function folder(nama: string, batches: EntriFolderJatuh[][]): EntriFolderJatuh {
  return { name: nama, isFile: false, isDirectory: true,
    createReader: () => {
      let i = 0;
      return { readEntries: (ok) => ok(batches[i++] ?? []) };
    } };
}

describe("bacaFolderJatuh", () => {
  it("membaca semua batch, termasuk lebih dari 100 file", async () => {
    const hasil = await bacaFolderJatuh([folder("Pemilik - 0812", [
      Array.from({ length: 100 }, (_, i) => file(`${i}.xlsx`)), [file("100.xlsx")],
    ])]);
    expect(hasil).toHaveLength(101);
    expect(hasil.at(-1)?.webkitRelativePath).toBe("Pemilik - 0812/100.xlsx");
  });
  it("gagal seluruh pembacaan bila satu subfolder tidak bisa dibaca (bukan diam-diam terlewat)", async () => {
    const ditolak: EntriFolderJatuh = { name: "ditolak", isFile: false, isDirectory: true,
      createReader: () => ({ readEntries: (_ok, gagal) => gagal(new DOMException("Access denied")) }) };
    await expect(bacaFolderJatuh([folder("A", [[file("ok.xlsx"), ditolak]])])).rejects.toThrow("Access denied");
  });
  it("membaca beberapa folder dan subfolder dalam satu drop tanpa membaca isi Excel", async () => {
    const roots = [folder("Bagian A", [[folder("Budi - 0812", [[file("Snowy.xlsx")]])]]),
      folder("Bagian B", [[folder("Ani - 0813", [[file("Moly.xlsx"), file("catatan.txt"), file("~$temp.xlsx")]])]])];
    const hasil = await bacaFolderJatuh(roots);
    expect(hasil.map((f) => f.webkitRelativePath)).toEqual([
      "Bagian A/Budi - 0812/Snowy.xlsx", "Bagian B/Ani - 0813/Moly.xlsx",
    ]);
    expect(hasil.map((f) => f.name)).toEqual(["Snowy.xlsx", "Moly.xlsx"]);
  });
});
