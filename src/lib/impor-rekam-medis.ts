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
  note: string | null;
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

export type RekamMedisFile = { fileName: string; sourcePath?: string; bytes: Uint8Array };

export function pilahRiwayatTersimpan<T extends Pick<RekamMedisImporRow, "source_key">>(rows: T[], existingKeys: Iterable<string>) {
  const existing = new Set(existingKeys);
  const baru = rows.filter((row) => !existing.has(row.source_key));
  return { baru, sudah_ada: rows.length - baru.length };
}

export function bolehKonfirmasiImporRekamMedis(riwayatSiap: number, disetujui: boolean) {
  return riwayatSiap > 0 && disetujui;
}

export type TahapProgresImporRekamMedis = "baca" | "simpan";

export function infoProgresImporRekamMedis(tahap: TahapProgresImporRekamMedis) {
  return tahap === "baca"
    ? { label: "Membaca kartu medis…" }
    : { label: "Menyimpan riwayat aman…" };
}

function completeProfiles(rows: RekamMedisImporRow[]): RekamMedisImporRow[] {
  const ownerAddresses = new Map<string, string>();
  const petProfiles = new Map<string, Pick<RekamMedisImporRow, "species" | "breed" | "gender" | "dob">>();
  rows.forEach((row) => {
    const ownerKey = [key(row.owner_name), row.phone?.replace(/\D/g, "")].join("::");
    const petKey = [ownerKey, key(row.patient_name)].join("::");
    if (row.address && !ownerAddresses.has(ownerKey)) ownerAddresses.set(ownerKey, row.address);
    const profile = petProfiles.get(petKey) ?? { species: null, breed: null, gender: null, dob: null };
    petProfiles.set(petKey, {
      species: profile.species ?? row.species,
      breed: profile.breed ?? row.breed,
      gender: profile.gender ?? row.gender,
      dob: profile.dob ?? row.dob,
    });
  });
  return rows.map((row) => {
    const ownerKey = [key(row.owner_name), row.phone?.replace(/\D/g, "")].join("::");
    const profile = petProfiles.get([ownerKey, key(row.patient_name)].join("::"));
    return {
      ...row,
      address: row.address ?? ownerAddresses.get(ownerKey) ?? null,
      species: row.species ?? profile?.species ?? null,
      breed: row.breed ?? profile?.breed ?? null,
      gender: row.gender ?? profile?.gender ?? null,
      dob: row.dob ?? profile?.dob ?? null,
    };
  });
}

type Grid = {
  rows: number;
  columns: number;
  text: (row: number, column: number) => string;
  multiline: (row: number, column: number) => string;
  value: (row: number, column: number) => ExcelJS.CellValue | undefined;
};

const clean = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim().replace(/^:\s*/, "");
const cleanMultiline = (value: unknown): string => String(value ?? "")
  .split(/\r?\n/)
  .map((line) => line.replace(/[\t ]+/g, " ").trim())
  .filter(Boolean)
  .join("\n")
  .replace(/^:\s*/, "");
const key = (value: unknown) => clean(value).toLocaleLowerCase("id-ID").replace(/[.:]/g, "").replace(/\s+/g, " ");

function cellText(cell: ExcelJS.Cell): string {
  try {
    return cell.text;
  } catch {
    return "";
  }
}

function identityFromPath(sourcePath: string | undefined) {
  if (!sourcePath) return null;
  const parts = sourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const match = parts.at(-2)?.match(/^(?:\d+\s*-\s*)?(.+?)\s*-\s*(\+?\d[\d\s()+-]*)$/);
  if (!match) return null;
  const phone = match[2].replace(/\D/g, "");
  return phone ? { ownerName: clean(match[1]), phone } : null;
}

function patientFromFile(fileName: string): string | null {
  const name = clean(fileName.replace(/\.[^.]+$/, ""));
  if (!name || /template.*rek(?:am)?\s*med|rek(?:am)?\s*med.*template/i.test(name)) return null;
  return name;
}

const LABELS = [
  "no rek med", "no rekam medis", "no rm", "tanggal rek", "tanggal", "nama pasien", "nama pemilik",
  "no telepon", "no telp", "no hp", "alamat", "jenis hewan", "ras", "jenis kelamin", "tanggal lahir",
  "nama dokter", "dokter", "note", "catatan", "anamnesa", "anamnesis", "gambaran klinis", "gejala klinis", "diagnosa", "diagnosis", "terapi", "treatment",
] as const;

function validDate(year: string, month: string, day: string): string | null {
  const candidate = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(candidate.getTime())) return null;
  if (candidate.getUTCFullYear() !== Number(year) || candidate.getUTCMonth() + 1 !== Number(month) || candidate.getUTCDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}

function dateText(value: ExcelJS.CellValue | undefined): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = clean(value);
  if (!raw) return null;
  const normalized = raw.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (normalized) return validDate(normalized[1], normalized[2], normalized[3]);
  const indonesian = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (!indonesian) return null;
  const year = indonesian[3].length === 2 ? `20${indonesian[3]}` : indonesian[3];
  const month = indonesian[2].padStart(2, "0");
  const day = indonesian[1].padStart(2, "0");
  return validDate(year, month, day);
}

function dateFromSheetName(sheetName: string): string | null {
  const raw = sheetName.match(/(?:^|\D)(\d{8}|\d{6})(?:\D|$)/)?.[1];
  if (!raw) return null;
  const day = raw.slice(0, 2);
  const month = raw.slice(2, 4);
  const year = raw.length === 8 ? raw.slice(4) : `20${raw.slice(4)}`;
  return validDate(year, month, day);
}

function grid(sheet: ExcelJS.Worksheet): Grid {
  return {
    rows: sheet.rowCount,
    columns: sheet.columnCount,
    text: (row, column) => clean(cellText(sheet.getRow(row).getCell(column))),
    multiline: (row, column) => cleanMultiline(cellText(sheet.getRow(row).getCell(column))),
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

function findClinicalValue(cells: Grid, aliases: string[]): string | null {
  const wanted = new Set(aliases.map(key));
  for (let row = 1; row <= cells.rows; row += 1) {
    for (let column = 1; column <= cells.columns; column += 1) {
      if (!wanted.has(key(cells.text(row, column)))) continue;
      const values: string[] = [];
      let emptyRows = 0;
      for (let next = row + 1; next <= Math.min(cells.rows, row + 40); next += 1) {
        const candidate = cells.multiline(next, column);
        if (candidate && isLabel(candidate)) break;
        if (candidate) {
          values.push(candidate);
          emptyRows = 0;
        } else if (values.length && ++emptyRows >= 4) {
          break;
        }
      }
      if (values.length) return values.join("\n");
    }
  }
  return findValue(cells, aliases);
}

function looksLikeCard(sheet: ExcelJS.Worksheet) {
  if (sheet.name.toLocaleLowerCase("id-ID").includes("kartu medis")) return true;
  let seen = 0;
  sheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
    if (key(cellText(cell)).includes("kartu medis")) seen += 1;
  }));
  return seen > 0;
}

function rowFromCard(cells: Grid, fileName: string, sheetName: string, sourcePath?: string): RekamMedisImporRow {
  const sourceIdentity = identityFromPath(sourcePath);
  const filePatient = patientFromFile(fileName);
  const cardDate = findDate(cells, ["tanggal rek", "tanggal pemeriksaan", "tanggal"]);
  const tabDate = dateFromSheetName(sheetName);
  const warning = cardDate && tabDate && cardDate !== tabDate
    ? ["Tanggal kartu berbeda; memakai tanggal nama tab"]
    : [];
  const sourceKey = sourceIdentity
    ? [key(sourceIdentity.ownerName), sourceIdentity.phone, key(filePatient ?? fileName), key(sheetName)].join("::")
    : `${fileName}::${sheetName}`;
  return {
    source_key: sourceKey,
    source_file: fileName,
    source_sheet: sheetName,
    record_no: findValue(cells, ["no rek med", "no rekam medis", "no rm"]),
    record_date: tabDate ?? cardDate,
    patient_name: findValue(cells, ["nama pasien"]) ?? filePatient,
    owner_name: sourceIdentity?.ownerName ?? findValue(cells, ["nama pemilik"]),
    phone: sourceIdentity?.phone ?? findValue(cells, ["no telepon", "no telp", "no hp"]),
    address: findValue(cells, ["alamat"]),
    species: findValue(cells, ["jenis hewan", "spesies"]),
    breed: findValue(cells, ["ras", "breed"]),
    gender: findValue(cells, ["jenis kelamin", "kelamin"]),
    dob: findDate(cells, ["tanggal lahir", "tgl lahir"]),
    doctor: findValue(cells, ["nama dokter", "dokter"]),
    note: findValue(cells, ["note", "catatan"]),
    anamnesis: findClinicalValue(cells, ["anamnesa", "anamnesis"]),
    clinical_findings: findClinicalValue(cells, ["gambaran klinis", "gejala klinis"]),
    diagnosis: findClinicalValue(cells, ["diagnosa", "diagnosis"]),
    therapy: findClinicalValue(cells, ["terapi", "treatment"]),
    warning,
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

export async function bacaWorkbookRekamMedis(bytes: Uint8Array, fileName: string, sourcePath?: string): Promise<RekamMedisWorkbookResult> {
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
    const parsed = rowFromCard(grid(sheet), fileName, sheet.name, sourcePath);
    const reason = heldReason(parsed);
    if (reason) {
      const hasContent = [parsed.record_no, parsed.record_date, parsed.patient_name, parsed.owner_name, parsed.phone,
        parsed.note, parsed.anamnesis, parsed.clinical_findings, parsed.diagnosis, parsed.therapy].some(Boolean);
      held.push({ source_key: parsed.source_key, source_file: fileName, source_sheet: sheet.name, reason: hasContent ? reason : "Kartu medis kosong" });
      return;
    }
    if (!parsed.diagnosis) parsed.warning.push("Diagnosis kosong");
    if (!parsed.doctor) parsed.warning.push("Dokter kosong");
    rows.push(parsed);
  });
  const patientKeys = new Set(rows.map((row) => key(row.patient_name)).filter(Boolean));
  if (patientKeys.size <= 1) return { rows, held, ignored_sheets: ignored };

  const expectedPatient = patientFromFile(fileName);
  const expectedKey = key(expectedPatient);
  const consistentRows: RekamMedisImporRow[] = [];
  rows.forEach((row) => {
    if (expectedKey && patientKeys.has(expectedKey) && key(row.patient_name) === expectedKey) {
      consistentRows.push(row);
      return;
    }
    held.push({
      source_key: row.source_key,
      source_file: row.source_file,
      source_sheet: row.source_sheet,
      reason: "Nama pasien dalam satu file tidak konsisten",
    });
  });
  return { rows: consistentRows, held, ignored_sheets: ignored };
}

export async function bacaWorkbooksRekamMedis(files: RekamMedisFile[]): Promise<RekamMedisWorkbookResult> {
  const parsed = await Promise.all(files.map((file) => bacaWorkbookRekamMedis(file.bytes, file.fileName, file.sourcePath)));
  const rows = completeProfiles(parsed.flatMap((result) => result.rows));
  const held = parsed.flatMap((result) => result.held);
  const seen = new Map<string, string>();
  const siap: RekamMedisImporRow[] = [];
  let ignoredSheets = parsed.reduce((sum, result) => sum + result.ignored_sheets, 0);

  rows.forEach((row) => {
    const duplicateKey = [key(row.owner_name), row.phone?.replace(/\D/g, ""), key(row.patient_name), row.record_date].join("::");
    const fingerprint = JSON.stringify([
      row.record_no, row.owner_name, row.phone, row.patient_name, row.record_date,
      row.species, row.breed, row.gender, row.dob, row.doctor,
      row.note, row.anamnesis, row.clinical_findings, row.diagnosis, row.therapy,
    ]);
    const previous = seen.get(duplicateKey);
    if (previous === fingerprint) {
      ignoredSheets += 1;
      return;
    }
    if (previous) {
      held.push({
        source_key: row.source_key,
        source_file: row.source_file,
        source_sheet: row.source_sheet,
        reason: "Kemungkinan riwayat ganda: pemilik, pasien, dan tanggal sama",
      });
      return;
    }
    seen.set(duplicateKey, fingerprint);
    siap.push(row);
  });

  return {
    rows: siap,
    held,
    ignored_sheets: ignoredSheets,
  };
}
