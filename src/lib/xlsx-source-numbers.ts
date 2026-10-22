import JSZip from "jszip";
import { SaxesParser } from "saxes";

// ExcelJS converts numeric cells to Number. Keep their original XML decimal
// lexemes for monetary evidence, including cached numeric formula results.
export async function xlsxSourceNumbers(bytes: Uint8Array, sheetName: string) {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (name: string) => {
    const file = zip.file(name);
    if (!file) throw new Error("Struktur workbook tidak lengkap.");
    return file.async("string");
  };
  let relation = "";
  const book = new SaxesParser();
  book.on("opentag", tag => { if (tag.name === "sheet" && tag.attributes.name === sheetName) relation = String(tag.attributes["r:id"]); });
  book.write(await read("xl/workbook.xml")).close();
  let target = "";
  const rels = new SaxesParser();
  rels.on("opentag", tag => { if (tag.name === "Relationship" && tag.attributes.Id === relation) target = String(tag.attributes.Target); });
  rels.write(await read("xl/_rels/workbook.xml.rels")).close();
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(path)) throw new Error("Sheet saldo tidak ditemukan.");
  const result = new Map<string, string>();
  let ref = "", numeric = false, reading = false, value = "";
  const sheet = new SaxesParser();
  sheet.on("opentag", tag => {
    if (tag.name === "c") { ref = String(tag.attributes.r); numeric = !tag.attributes.t || tag.attributes.t === "n"; }
    if (tag.name === "v") { reading = true; value = ""; }
  });
  sheet.on("text", text => { if (reading) value += text; });
  sheet.on("closetag", tag => {
    if (tag.name === "v") {
      if (numeric && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) result.set(ref, value.trim());
      reading = false;
    }
  });
  sheet.write(await read(path)).close();
  return result;
}
