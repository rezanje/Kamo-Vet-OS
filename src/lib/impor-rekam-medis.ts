import ExcelJS from "exceljs";

export type RekamMedisImporRow = {
  source_key: string;
  source_file: string;
  source_sheet: string;
  record_no: string | null;
  record_date: string | null;
  patient_name: string | null;
  owner_name: string | null;
  phone: string | null;
  address: string | null;
  species: string | null;
  breed: string | null;
  gender: string | null;
  dob: string | null;
  doctor: string | null;
  anamnesis: string | null;
  clinical_findings: string | null;
  diagnosis: string | null;
  therapy: string | null;
  warning: string[];
};

export type RekamMedisImporHeld = Pick<RekamMedisImporRow, "source_key" | "source_file" | "source_sheet"> & {
  reason: string;
};

export type RekamMedisWorkbookResult = {
  rows: RekamMedisImporRow[];
  held: RekamMedisImporHeld[];
  ignored_sheets: number;
};

export type RekamMedisFile = { fileName: string; bytes: Uint8Array };

type Grid = { rows: number; columns: number; text: (row: number, column: number) => string; value: (row: number, column: number) => ExcelJS.CellValue | undefined };

const clean = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim().replace(/^:\s*/, "");
const key = (value: unknown) => clean(value).toLocaleLowerCase("id-ID").replace(/[.:]/g, "").replace(/\s+/g, " ");

const LABELS = [
  "no rek med", "no rekam medis", "no rm", "tanggal rek", "tanggal", "nama pasien", "nama pemilik",
  "no telepon", "no telp", "no hp", "alamat", "jenis hewan", "ras", "jenis kelamin", "tanggal lahir",
  "nama dokter", "dokter", "anamnesa", "anamnesis", "gambaran klinis", "gejala klinis", "diagnosa", "diagnosis", "terapi", "treatment",
] as const;

function dateText(value: ExcelJS.CellValue | undefined): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = clean(value);
  if (!raw) return null;
  const normalized = raw.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (normalized) return `${normalized[1]}-${normalized[2]}-${normalized[3]}`;
  const indonesian = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (!indonesian) return null;
  const year = indonesian[3].length === 2 ? `20${indonesian[3]}` : indonesian[3];
  const month = indonesian[2].padStart(2, "0");
  const day = indonesian[1].padStart(2, "0");
  const candidate = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isNaN(candidate.getTime()) ? null : `${year}-${month}-${day}`;
}

function grid(sheet: ExcelJS.Worksheet): Grid {
  return {
    rows: sheet.rowCount,
    columns: sheet.columnCount,
    text: (row, column) => clean(sheet.getRow(row).getCell(column).text),
    value: (row, column) => sheet.getRow(row).getCell(column).value,
  };
}

function isLabel(value: string) {
  return LABELS.includes(key(value) as typeof LABELS[number]);
}

function findValue(cells: Grid, aliases: string[]): string | null {
  const wanted = new Set(aliases.map(key));
  for (let row = 1; row <= cells.rows; row += 1) {
    for (let column = 1; column <= cells.columns; column += 1) {
      if (!wanted.has(key(cells.text(row, column)))) continue;
      for (let next = column + 1; next <= Math.min(cells.columns, column + 3); next += 1) {
        const candidate = cells.text(row, next);
        if (isLabel(candidate)) break;
        if (candidate) return candidate;
      }
      for (let next = row + 1; next <= Math.min(cells.rows, row + 3); next += 1) {
        const candidate = cells.text(next, column);
        if (isLabel(candidate)) break;
        if (candidate) return candidate;
      }
    }
  }
  return null;
}

function findDate(cells: Grid, aliases: string[]): string | null {
  const wanted = new Set(aliases.map(key));
  for (let row = 1; row <= cells.rows; row += 1) {
    for (let column = 1; column <= cells.columns; column += 1) {
      if (!wanted.has(key(cells.text(row, column)))) continue;
      for (let next = column + 1; next <= Math.min(cells.columns, column + 3); next += 1) {
        const candidate = dateText(cells.value(row, next));
        if (candidate) return candidate;
      }
      for (let next = row + 1; next <= Math.min(cells.rows, row + 3); next += 1) {
        const candidate = dateText(cells.value(next, column));
        if (candidate) return candidate;
      }
    }
  }
  return null;
}

function looksLikeCard(sheet: ExcelJS.Worksheet) {
  if (sheet.name.toLocaleLowerCase("id-ID").includes("kartu medis")) return true;
  let seen = 0;
  sheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
    if (key(cell.text).includes("kartu medis")) seen += 1;
  }));
  return seen > 0;
}

function rowFromCard(cells: Grid, fileName: string, sheetName: string): RekamMedisImporRow {
  const recordDate = findDate(cells, ["tanggal rek", "tanggal pemeriksaan", "tanggal"]);
  return {
    source_key: `${fileName}::${sheetName}`,
    source_file: fileName,
    source_sheet: sheetName,
    record_no: findValue(cells, ["no rek med", "no rekam medis", "no rm"]),
    record_date: recordDate,
    patient_name: findValue(cells, ["nama pasien"]),
    owner_name: findValue(cells, ["nama pemilik"]),
    phone: findValue(cells, ["no telepon", "no telp", "no hp"]),
    address: findValue(cells, ["alamat"]),
    species: findValue(cells, ["jenis hewan", "spesies"]),
    breed: findValue(cells, ["ras", "breed"]),
    gender: findValue(cells, ["jenis kelamin", "kelamin"]),
    dob: findDate(cells, ["tanggal lahir", "tgl lahir"]),
    doctor: findValue(cells, ["nama dokter", "dokter"]),
    anamnesis: findValue(cells, ["anamnesa", "anamnesis"]),
    clinical_findings: findValue(cells, ["gambaran klinis", "gejala klinis"]),
    diagnosis: findValue(cells, ["diagnosa", "diagnosis"]),
    therapy: findValue(cells, ["terapi", "treatment"]),
    warning: [],
  };
}

function heldReason(row: RekamMedisImporRow): string | null {
  const missing: string[] = [];
  if (!row.record_date) missing.push("Tanggal");
  if (!row.patient_name) missing.push("nama pasien");
  if (!row.owner_name) missing.push("nama pemilik");
  if (!row.phone) missing.push("nomor telepon");
  return missing.length ? `${missing.join(", ")} wajib diisi` : null;
}

export async function bacaWorkbookRekamMedis(bytes: Uint8Array, fileName: string): Promise<RekamMedisWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const rows: RekamMedisImporRow[] = [];
  const held: RekamMedisImporHeld[] = [];
  let ignored = 0;

  workbook.worksheets.forEach((sheet) => {
    if (!looksLikeCard(sheet)) {
      ignored += 1;
      return;
    }
    const parsed = rowFromCard(grid(sheet), fileName, sheet.name);
    const reason = heldReason(parsed);
    if (reason) {
      const hasContent = [parsed.record_no, parsed.record_date, parsed.patient_name, parsed.owner_name, parsed.phone,
        parsed.anamnesis, parsed.clinical_findings, parsed.diagnosis, parsed.therapy].some(Boolean);
      held.push({ source_key: parsed.source_key, source_file: fileName, source_sheet: sheet.name, reason: hasContent ? reason : "Kartu medis kosong" });
      return;
    }
    if (!parsed.diagnosis) parsed.warning.push("Diagnosis kosong");
    if (!parsed.doctor) parsed.warning.push("Dokter kosong");
    rows.push(parsed);
  });
  return { rows, held, ignored_sheets: ignored };
}

export async function bacaWorkbooksRekamMedis(files: RekamMedisFile[]): Promise<RekamMedisWorkbookResult> {
  const parsed = await Promise.all(files.map((file) => bacaWorkbookRekamMedis(file.bytes, file.fileName)));
  const rows = parsed.flatMap((result) => result.rows);
  const held = parsed.flatMap((result) => result.held);
  const seen = new Set<string>();
  const siap: RekamMedisImporRow[] = [];

  rows.forEach((row) => {
    const duplicateKey = [row.phone?.replace(/\D/g, ""), key(row.patient_name), row.record_date].join("::");
    if (seen.has(duplicateKey)) {
      held.push({
        source_key: row.source_key,
        source_file: row.source_file,
        source_sheet: row.source_sheet,
        reason: "Kemungkinan riwayat ganda: pemilik, pasien, dan tanggal sama",
      });
      return;
    }
    seen.add(duplicateKey);
    siap.push(row);
  });

  return {
    rows: siap,
    held,
    ignored_sheets: parsed.reduce((sum, result) => sum + result.ignored_sheets, 0),
  };
}
