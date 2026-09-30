import ExcelJS from "exceljs";

export type KaryawanImpor = {
  nik: string;
  nama: string;
  jabatan: string | null;
  phone: string | null;
  email: string | null;
  tgl_masuk: string | null;
  status: "Aktif" | "Nonaktif";
  details: Record<string, string>;
};

type HasilBaca = { rows: KaryawanImpor[]; errors: string[] };

export const BATAS_FILE_KARYAWAN = 900 * 1024;
const BATAS_BARIS = 500;
const KOLOM_IDENTITAS = new Set([3, 18, 19, 28, 34, 37, 38, 40]);

function isiSel(cell: ExcelJS.Cell): string {
  const nilai = cell.value;
  if (nilai == null) return "";
  if (nilai instanceof Date) return nilai.toISOString().slice(0, 10);
  if (typeof nilai === "object" && "formula" in nilai) {
    if ([2, 3, 5, 10, 28, 29, 41, 42].includes(Number(cell.col))) throw new Error("rumus tidak boleh dipakai pada kolom utama");
    const hasil = nilai.result;
    if (typeof hasil === "string" || typeof hasil === "number" || typeof hasil === "boolean") {
      return String(hasil).trim();
    }
    throw new Error("hasil rumus kosong atau tidak didukung");
  }
  return cell.text.trim();
}

function tanggal(value: string): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const indo = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  const tahun = Number(iso?.[1] ?? indo?.[3]);
  const bulan = Number(iso?.[2] ?? indo?.[2]);
  const hari = Number(iso?.[3] ?? indo?.[1]);
  const d = new Date(Date.UTC(tahun, bulan - 1, hari));
  if ((!iso && !indo) || !Number.isFinite(d.getTime()) ||
      d.getUTCFullYear() !== tahun || d.getUTCMonth() + 1 !== bulan || d.getUTCDate() !== hari) return null;
  return `${tahun}-${String(bulan).padStart(2, "0")}-${String(hari).padStart(2, "0")}`;
}

function statusKerja(value: string, tanggalBerhenti: string): "Aktif" | "Nonaktif" | null {
  const kunci = value.trim().toLocaleLowerCase("id-ID");
  if (!kunci) return tanggalBerhenti ? "Nonaktif" : "Aktif";
  if (["aktif", "bekerja", "active"].includes(kunci)) return "Aktif";
  if (["nonaktif", "tidak aktif", "berhenti", "resign", "keluar", "inactive"].includes(kunci)) return "Nonaktif";
  return null;
}

export async function bacaExcelKaryawan(file: Buffer): Promise<HasilBaca> {
  if (file.length > BATAS_FILE_KARYAWAN) return { rows: [], errors: ["File melebihi 900 KB. Pisahkan menjadi beberapa file."] };

  let buku: ExcelJS.Workbook;
  try {
    buku = new ExcelJS.Workbook();
    await buku.xlsx.load(file as unknown as Parameters<typeof buku.xlsx.load>[0]);
  } catch {
    return { rows: [], errors: ["File Excel tidak bisa dibaca. Gunakan format .xlsx."] };
  }
  const sheet = buku.getWorksheet("Data Karyawan");
  if (!sheet) return { rows: [], errors: ["Sheet Data Karyawan tidak ditemukan."] };
  const judul = (kolom: number) => String(sheet.getRow(2).getCell(kolom).text ?? "").trim();
  if (sheet.getCell("B1").text.trim() !== "Nama" ||
      judul(3) !== "ID Karyawan" || judul(5) !== "Tanggal Bergabung" ||
      judul(10) !== "Jabatan" || judul(28) !== "Telp" ||
      judul(29) !== "Email" || judul(41) !== "Status Kerja") {
    return { rows: [], errors: ["Susunan kolom tidak cocok dengan Format Data Karyawan."] };
  }
  if (sheet.rowCount > 2000) {
    return { rows: [], errors: ["File memiliki rentang baris terlalu besar. Rapikan file sebelum unggah."] };
  }

  const rows: KaryawanImpor[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  let jumlahBaris = 0;
  for (let no = 3; no <= sheet.rowCount; no++) {
    const row = sheet.getRow(no);
    if (![...Array(43)].some((_, i) => row.getCell(i + 1).value != null)) continue;
    jumlahBaris++;
    if (jumlahBaris > BATAS_BARIS) {
      errors.push("Maksimal 500 karyawan per file. Pisahkan file ini.");
      break;
    }
    try {
      const nama = isiSel(row.getCell(2));
      const idCell = row.getCell(3);
      if (typeof idCell.value === "number") throw new Error("ID Karyawan harus teks agar angka nol di depan tidak hilang");
      const nik = isiSel(idCell);
      if (!nama || !nik) throw new Error("Nama dan ID Karyawan wajib diisi");
      if (nama.length > 100 || nik.length > 20) throw new Error("Nama atau ID Karyawan terlalu panjang");
      const kunci = nik.toLocaleLowerCase("id-ID");
      if (ids.has(kunci)) throw new Error("ID Karyawan ganda dalam file");

      const details: Record<string, string> = {};
      for (let kolom = 2; kolom <= 43; kolom++) {
        const cell = row.getCell(kolom);
        if (KOLOM_IDENTITAS.has(kolom) && typeof cell.value === "number") {
          throw new Error(`${judul(kolom)} harus teks agar angka nol di depan tidak hilang`);
        }
        const value = isiSel(cell);
        if (value.length > 500) throw new Error(`${judul(kolom)} terlalu panjang`);
        if (value) details[kolom === 2 ? "Nama" : judul(kolom) || `Kolom ${kolom}`] = value;
      }

      const tglMasukRaw = isiSel(row.getCell(5));
      const tglMasuk = tanggal(tglMasukRaw);
      if (tglMasukRaw && !tglMasuk) throw new Error("Tanggal Bergabung tidak sah");
      const status = statusKerja(isiSel(row.getCell(41)), isiSel(row.getCell(42)));
      if (!status) throw new Error("Status Kerja harus Aktif atau Nonaktif");
      const jabatan = isiSel(row.getCell(10)) || null;
      const phone = isiSel(row.getCell(28)) || null;
      const email = isiSel(row.getCell(29)) || null;
      if ((jabatan && jabatan.length > 60) || (phone && phone.length > 20) || (email && email.length > 120)) {
        throw new Error("Jabatan, Telp, atau Email terlalu panjang");
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email tidak sah");
      rows.push({ nik, nama, jabatan, phone, email, tgl_masuk: tglMasuk, status, details });
      ids.add(kunci);
    } catch (error) {
      errors.push(`baris ${no}: ${error instanceof Error ? error.message : "data tidak sah"}`);
    }
  }
  if (jumlahBaris === 0) errors.push("File belum berisi data karyawan.");
  return { rows, errors };
}
