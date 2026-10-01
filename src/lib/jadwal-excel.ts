import ExcelJS from 'exceljs';
import { tanggalValid } from './jadwal-kalender';
export type JadwalImpor = {employee_id: string; tanggal: string; shift_id: string; branch_id: string};
export type JadwalScope = {cabang: string; awal: string; akhir: string; employees: string[]; shifts: string[]; existing: Record<string,string>};
const KOLOM = ['employee_id','tanggal','shift_id','branch_id'] as const;
export function validasiJadwal(input: unknown, scope: JadwalScope, impor = true) {
  const errors: string[] = [], rows: JadwalImpor[] = []; let skipped = 0;
  if (!Array.isArray(input) || input.length > 500) return {rows, errors:['Maksimal 500 baris jadwal dalam satu file.'], skipped};
  const seen = new Set<string>();
  input.forEach((value, i) => {
    const r = value as JadwalImpor;
    let error = '';
    if (!r || typeof r !== 'object' || KOLOM.some(k => typeof r[k] !== 'string')) error = 'Kolom jadwal tidak lengkap';
    else if (r.branch_id !== scope.cabang) error = 'Cabang tidak diizinkan';
    else if (!scope.employees.includes(r.employee_id)) error = 'Karyawan tidak dikenal atau tidak ditugaskan di cabang';
    else if (!scope.shifts.includes(r.shift_id) && (impor || r.shift_id !== '')) error = 'Shift tidak dikenal atau tidak berlaku di cabang';
    else if (!tanggalValid(r.tanggal) || r.tanggal < scope.awal || r.tanggal > scope.akhir) error = 'Tanggal tidak valid atau di luar periode';
    else {
      const key = `${r.employee_id}|${r.tanggal}`;
      if (seen.has(key)) error = 'Duplikat karyawan/tanggal';
      seen.add(key);
      if (!error && impor && Object.hasOwn(scope.existing,key)) {
        if (scope.existing[key] === r.shift_id) { skipped++; return; }
        error = 'Jadwal sudah terisi; ubah lewat papan jadwal';
      }
    }
    if (error) errors.push(`Baris ${i + 2}: ${error}`); else rows.push(r);
  });
  return {rows: errors.length ? [] : rows, errors, skipped};
}
export async function buatExcelJadwal(rows: JadwalImpor[], referensi: {employees?: {id:string;nama:string}[]; shifts?: {id:string;nama:string;jam:string}[]} = {}) {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Jadwal');
  sheet.addRow([...KOLOM]); rows.forEach(r => sheet.addRow(KOLOM.map(k => r[k])));
  sheet.columns.forEach(c => { c.width = 38; });
  const emp = book.addWorksheet('Karyawan'); emp.addRow(['ID','Nama']); referensi.employees?.forEach(e => emp.addRow([e.id,e.nama]));
  const shifts = book.addWorksheet('Shift'); shifts.addRow(['ID','Nama','Jam']); referensi.shifts?.forEach(s => shifts.addRow([s.id,s.nama,s.jam]));
  return new Uint8Array(await book.xlsx.writeBuffer());
}
export async function bacaExcelJadwal(bytes: Uint8Array) {
  const rows: JadwalImpor[] = [], errors: string[] = [];
  if (bytes.byteLength > 900 * 1024) return {rows, errors:['File maksimal 900 KB.']};
  try {
    const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as unknown as Parameters<typeof book.xlsx.load>[0]);
    const sheet = book.getWorksheet('Jadwal');
    if (!sheet || KOLOM.some((k,i) => sheet.getRow(1).getCell(i+1).text !== k)) throw new Error('Gunakan sheet Jadwal dari template.');
    if (sheet.rowCount > 501) throw new Error('Maksimal 500 baris jadwal.');
    sheet.eachRow((row,i) => {
      if (i === 1) return;
      const values = KOLOM.map((_,j) => { const c = row.getCell(j+1); if (c.type === ExcelJS.ValueType.Formula) throw new Error(`Baris ${i}: rumus tidak diizinkan.`); return c.value instanceof Date ? c.value.toISOString().slice(0,10) : c.text.trim(); });
      rows.push(Object.fromEntries(KOLOM.map((k,j) => [k,values[j]])) as JadwalImpor);
    });
  } catch(e) { errors.push(e instanceof Error ? e.message : 'File Excel tidak terbaca.'); }
  return {rows: errors.length ? [] : rows, errors};
}
