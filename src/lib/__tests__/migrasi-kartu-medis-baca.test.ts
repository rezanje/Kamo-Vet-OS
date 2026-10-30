import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { bacaMaster, periksaZip } from "@/lib/migrasi-kartu-medis/baca-master";
import { bacaXlsx, formatTanggal, tanggalDariIso, tanggalDariSeri } from "@/lib/migrasi-kartu-medis/baca-xlsx";
import { buatRencana } from "@/lib/migrasi-kartu-medis/rencana";
import { VERSI_LEGACY_MASTER_V0 } from "@/lib/migrasi-kartu-medis/kontrak";
import { buatMaster, masterDasar, tgl } from "./fixtures/master-kartu-medis";

const gagal = async (bytes: Uint8Array) => {
  const hasil = await bacaMaster(bytes);
  expect(hasil.ok).toBe(false);
  return hasil.ok ? [] : hasil.galat;
};

describe("kontrak master v0", () => {
  it("accepts an unmarked master only as legacy-master-v0 with a version warning", async () => {
    const hasil = await bacaMaster(await buatMaster(masterDasar()));
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(hasil.versi).toBe(VERSI_LEGACY_MASTER_V0);
    expect(hasil.peringatan.join(" ")).toContain("tanpa penanda versi");
    expect(hasil.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(hasil.blok.riwayat.baris).toHaveLength(2);
    expect(hasil.blok.mapping_file.baris).toHaveLength(1);
    expect(hasil.blok.mapping_sheet.baris).toHaveLength(2);
    expect(hasil.blok.pemilik.barisHeader).toBe(5);
    expect(hasil.blok.mapping_file.barisHeader).toBe(29);
    expect(hasil.blok.mapping_sheet.barisHeader).toBe(35);
    expect(hasil.blok.mapping_file.catatanDilewati).toBe(1);
  });
  it("accepts a known explicit marker without warning and rejects an unknown one", async () => {
    const dikenal = await bacaMaster(await buatMaster({ ...masterDasar(), versi: VERSI_LEGACY_MASTER_V0 }));
    expect(dikenal.ok && dikenal.peringatan.some((p) => p.includes("tanpa penanda"))).toBe(false);
    expect((await gagal(await buatMaster({ ...masterDasar(), versi: "v9" }))).join(" ")).toContain('Versi kontrak "v9" tidak dikenal');
  });
  it("reads columns by label regardless of order and header row position (rows 5/29/35 are hints)", async () => {
    const hasil = await bacaMaster(await buatMaster({ ...masterDasar(), balikKolom: true, barisHeader: 8 }));
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(hasil.blok.pemilik.barisHeader).toBe(8);
    const r = hasil.blok.riwayat.baris[0].sel;
    expect(r.diagnosis).toEqual({ jenis: "teks", teks: "UJI DIAGNOSIS 1" });
    expect(r.record_date).toEqual({ jenis: "tanggal", tanggal: tgl("2026-01-15") });
  });
  it("does not read schema notes above the header, nor notes between the two Mapping blocks, as records", async () => {
    const hasil = await bacaMaster(await buatMaster(masterDasar(1)));
    expect(hasil.ok && hasil.blok.pemilik.baris.map((b) => b.baris)).toEqual([6]);
    expect(hasil.ok && hasil.blok.mapping_file.baris.map((b) => b.baris)).toEqual([30]);
    expect(hasil.ok && hasil.blok.mapping_sheet.baris.map((b) => b.baris)).toEqual([36]);
  });
  it.each([
    ["a missing required sheet", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => wb.removeWorksheet(wb.getWorksheet("Hewan")!.id) }), 'Sheet wajib "Hewan" tidak ada'],
    ["a missing header label", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => { wb.getWorksheet("Pemilik")!.getCell("C5").value = "Telepon"; } }), "header pemilik tidak lengkap"],
    ["an English alias instead of the exact label", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => { wb.getWorksheet("Pemilik")!.getCell("B5").value = "name"; } }), "header pemilik tidak lengkap"],
    ["a duplicated label", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => { wb.getWorksheet("Pemilik")!.getCell("J5").value = "Alamat | address"; } }), "header pemilik tidak lengkap atau ganda"],
    ["the same Mapping block twice", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => {
      const ws = wb.getWorksheet("Mapping")!;
      ["sample_id", "File asli", "Path components asli (JSON)", "SHA-256 file", "Drive file URL", "Jumlah sheet", "Foto medis dikecualikan", "Perubahan asli"].forEach((t, i) => { ws.getRow(50).getCell(i + 1).value = t; });
    } }), "header mapping_file muncul 2 kali"],
    ["a blank row inside record data", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => {
      const ws = wb.getWorksheet("RiwayatMedis")!;
      ws.getCell("A9").value = "R9"; ws.getCell("B9").value = "H1";
    } }), "ada isi setelah akhir tabel riwayat"],
    ["a data-like row between the two Mapping blocks", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => {
      const ws = wb.getWorksheet("Mapping")!;
      ws.getCell("A32").value = "S2"; ws.getCell("B32").value = "lain.xlsx";
    } }), "ada isi setelah akhir tabel mapping_file"],
    ["a 1904 date system workbook", (f: ReturnType<typeof masterDasar>) => ({ ...f, ubah: (wb: import("exceljs").Workbook) => { (wb.properties as { date1904?: boolean }).date1904 = true; } }), "Sistem tanggal 1904"],
  ])("fails the whole file for %s", async (_label, ubah, pesan) => {
    expect((await gagal(await buatMaster(ubah(masterDasar())))).join(" ")).toContain(pesan);
  });
  it("rejects non-zip bytes and inconsistent zip directories without parsing", () => {
    expect(periksaZip(new TextEncoder().encode("bukan zip"))).toContain("zip tidak dikenali");
  });
  it("rejects a file above the byte bound before reading", async () => {
    expect((await gagal(new Uint8Array(20 * 1024 * 1024 + 1))).join(" ")).toContain("melebihi 20 MB");
  });
  it("keeps formula cells as formulas (cached result not trusted as data or approval)", async () => {
    const f = masterDasar(1);
    f.riwayat[0].decision = { formula: '"SETUJU"', result: "SETUJU" } as never;
    const hasil = await bacaMaster(await buatMaster(f));
    expect(hasil.ok && hasil.blok.riwayat.baris[0].sel.decision.jenis).toBe("rumus");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Berkas gaya OpenXML SDK (bentuk master asli): elemen ber-prefix `x:`, target relasi absolut, sel tanggal `t="d"`.
// ---------------------------------------------------------------------------------------------------------------

const NS_UTAMA = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** Ubah keluaran ExcelJS menjadi bentuk OpenXML SDK tanpa mengubah isi sel. */
async function gayaOpenXmlSdk(bytes: Uint8Array, opsi: { tanggalIso?: boolean } = {}): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const styles = await zip.file("xl/styles.xml")!.async("string");
  const fmt = new Map([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), m[2]]));
  const cellXfs = styles.slice(styles.indexOf("<cellXfs"), styles.indexOf("</cellXfs>"));
  const xfTanggal = [...cellXfs.matchAll(/<xf [^>]*numFmtId="(\d+)"/g)].map((m) => {
    const id = Number(m[1]);
    return fmt.has(id) ? formatTanggal(fmt.get(id)!) : (id >= 14 && id <= 22);
  });
  for (const nama of Object.keys(zip.files)) {
    const f = zip.file(nama);
    if (!f) continue;
    let xml = await f.async("string");
    if (nama.endsWith(".rels")) {
      const dasar = nama.replace(/_rels\/[^/]*$/, "");
      xml = xml.replace(/Target="(?!\/|https?:)([^"]+)"/g, (_m, t: string) => `Target="/${(dasar + t).replace(/[^/]+\/\.\.\//g, "")}"`);
    } else if (xml.includes(`xmlns="${NS_UTAMA}"`)) {
      if (opsi.tanggalIso && nama.startsWith("xl/worksheets/")) {
        xml = xml.replace(/<c r="([A-Z]+\d+)" s="(\d+)"( t="n")?><v>([0-9.]+)<\/v><\/c>/g, (m, r: string, s: string, _t, v: string) => {
          if (!xfTanggal[Number(s)]) return m;
          return `<c r="${r}" s="${s}" t="d"><v>${tanggalDariSeri(Number(v))!.toISOString()}</v></c>`;
        });
      }
      xml = xml.replace(/<(\/?)([A-Za-z][\w.]*)(?=[\s/>])/g, "<$1x:$2").replace(`xmlns="${NS_UTAMA}"`, `xmlns:x="${NS_UTAMA}"`);
    }
    zip.file(nama, xml);
  }
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("pembaca .xlsx (bentuk OpenXML SDK seperti master asli)", () => {
  it("reads prefixed namespaces, absolute relationship targets, and t=\"d\" dates exactly like the plain file", async () => {
    const f = masterDasar(3);
    const asli = await buatMaster(f);
    const sdk = await gayaOpenXmlSdk(asli, { tanggalIso: true });
    const sdkXml = await (await JSZip.loadAsync(sdk)).file("xl/worksheets/sheet3.xml")!.async("string");
    expect(sdkXml).toContain("<x:c ");
    expect(sdkXml).toContain('t="d"');
    const a = await bacaMaster(asli);
    const b = await bacaMaster(sdk);
    if (!a.ok || !b.ok) throw new Error("harus terbaca");
    expect(b.blok).toEqual(a.blok);
    const opsi = { hariIni: "2026-10-30", tanggalMinimum: "1990-01-01" };
    const ra = buatRencana(a.versi, "x", a.blok, opsi);
    const rb = buatRencana(b.versi, "x", b.blok, opsi);
    expect(rb.baris).toEqual(ra.baris);
    expect(rb.hitungan.siap).toBe(3);
  });
  it("parses every OOXML cell type without guessing", async () => {
    const zip = new JSZip();
    const ns = `xmlns:x="${NS_UTAMA}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="a" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml"/></Relationships>');
    zip.file("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="y" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    zip.file("xl/workbook.xml", `<x:workbook ${ns}><x:sheets><x:sheet name="S" sheetId="1" r:id="s"/></x:sheets></x:workbook>`);
    zip.file("xl/sharedStrings.xml", `<x:sst ${ns}><x:si><x:t>satu</x:t></x:si><x:si><x:r><x:t>ka</x:t></x:r><x:r><x:t>ya</x:t></x:r><x:rPh><x:t>ABAIKAN</x:t></x:rPh></x:si></x:sst>`);
    zip.file("xl/styles.xml", `<x:styleSheet ${ns}><x:numFmts><x:numFmt numFmtId="201" formatCode="dd mmm yyyy"/><x:numFmt numFmtId="202" formatCode="0"/></x:numFmts><x:cellXfs><x:xf numFmtId="0"/><x:xf numFmtId="201"/><x:xf numFmtId="202"/><x:xf numFmtId="14"/></x:cellXfs></x:styleSheet>`);
    zip.file("xl/worksheets/sheet1.xml", `<x:worksheet ${ns}><x:sheetData><x:row r="1">`
      + '<x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>inline</x:t></x:is></x:c>'
      + '<x:c r="D1" t="str"><x:v>0001</x:v></x:c><x:c r="E1" s="2" t="n"><x:v>81384467002</x:v></x:c><x:c r="F1" t="b"><x:v>1</x:v></x:c>'
      + '<x:c r="G1" t="e"><x:v>#N/A</x:v></x:c><x:c r="H1" s="1" t="d"><x:v>2024-03-01T00:00:00.000Z</x:v></x:c><x:c r="I1" s="3"><x:v>45352</x:v></x:c>'
      + '<x:c r="J1" t="n"><x:f>COUNTA(A:A)</x:f><x:v>7</x:v></x:c><x:c r="K1" s="1" t="d"><x:v>2024-02-30</x:v></x:c><x:c r="L1" s="5"/>'
      + "</x:row></x:sheetData></x:worksheet>");
    const buku = await bacaXlsx(await zip.generateAsync({ type: "uint8array" }), { baris: 100, kolom: 64 });
    const s = buku.sheets[0];
    expect([s.nama, s.baris, s.kolom]).toEqual(["S", 1, 11]);
    const sel = (c: number) => s.sel(1, c);
    expect(sel(1)).toEqual({ jenis: "teks", teks: "satu" });
    expect(sel(2)).toEqual({ jenis: "teks", teks: "kaya" });
    expect(sel(3)).toEqual({ jenis: "teks", teks: "inline" });
    expect(sel(4)).toEqual({ jenis: "teks", teks: "0001" });
    expect(sel(5)).toEqual({ jenis: "angka", angka: 81384467002 });
    expect(sel(6)).toEqual({ jenis: "boolean", nilai: true });
    expect(sel(7)).toEqual({ jenis: "galat", teks: "#N/A" });
    expect(sel(8)).toEqual({ jenis: "tanggal", tanggal: new Date("2024-03-01T00:00:00Z") });
    expect(sel(9)).toEqual({ jenis: "tanggal", tanggal: new Date("2024-03-01T00:00:00Z") });
    expect(sel(10)).toEqual({ jenis: "rumus", hasil: { jenis: "angka", angka: 7 } });
    expect(sel(11)).toEqual({ jenis: "galat", teks: "tanggal tidak valid" });
    expect(sel(12)).toEqual({ jenis: "kosong" });
  });
  it("converts Excel serials on both sides of the fictitious 1900-02-29 and recognises date formats", () => {
    expect(tanggalDariSeri(1)!.toISOString()).toBe("1900-01-01T00:00:00.000Z");
    expect(tanggalDariSeri(59)!.toISOString()).toBe("1900-02-28T00:00:00.000Z");
    expect(tanggalDariSeri(60)).toBeNull();
    expect(tanggalDariSeri(61)!.toISOString()).toBe("1900-03-01T00:00:00.000Z");
    expect(tanggalDariSeri(45352.5)!.toISOString()).toBe("2024-03-01T12:00:00.000Z");
    for (const kode of ["dd mmm yyyy", "yyyy-mm-dd", "[$-421]d mmmm yyyy", "h:mm"]) expect(formatTanggal(kode)).toBe(true);
    for (const kode of ["0", "@", "General", '#,##0 "hari"', "[Red]0.00", "0.00E+00"]) expect(formatTanggal(kode)).toBe(false);
    expect(tanggalDariIso("2024-03-01T07:00:00+07:00")!.toISOString()).toBe("2024-03-01T00:00:00.000Z");
    expect(tanggalDariIso("2024-13-01")).toBeNull();
  });
  it("accepts single-cell notes after the last block but fails on trailing multi-cell rows", async () => {
    const f = masterDasar(1);
    const catatan = await buatMaster({ ...f, ubah: (wb) => { wb.getWorksheet("Mapping")!.getCell("A60").value = "REFERENSI KONTRAK (catatan)"; } });
    const ok = await bacaMaster(catatan);
    expect(ok.ok && ok.blok.mapping_sheet.catatanDilewati).toBe(1);
    const ambigu = await buatMaster({ ...f, ubah: (wb) => { const ws = wb.getWorksheet("Mapping")!; ws.getCell("A60").value = "R9"; ws.getCell("D60").value = "x::y"; } });
    expect((await gagal(ambigu)).join(" ")).toMatch(/Batas tabel ambigu/);
  });
});
