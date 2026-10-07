import { employeeOccupationInput } from './employee-occupation';
export function bacaEditKaryawan(data: FormData) {
  const text = (key: string) => String(data.get(key) ?? "").trim();
  const nama = text("nama"), status = text("status"), email = text("email"), tanggal = text("tgl_masuk");
  const gaji_pokok = Number(text("gaji_pokok"));
  if (!nama) throw new Error("Nama karyawan wajib diisi");
  if (!["Aktif", "Nonaktif"].includes(status)) throw new Error("Status karyawan tidak valid");
  if (!Number.isFinite(gaji_pokok) || gaji_pokok < 0) throw new Error("Gaji pokok tidak valid");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email tidak valid");
  if (tanggal && (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal) || Number.isNaN(Date.parse(tanggal)) || new Date(tanggal).toISOString().slice(0, 10) !== tanggal)) throw new Error("Tanggal masuk tidak valid");
  return { nama, status, gaji_pokok, nik: text("nik") || null, jabatan: employeeOccupationInput(data), departemen: text("departemen") || null, phone: text("phone") || null, email: email || null, tgl_masuk: tanggal || null };
}
