// Penugasan cabang karyawan: satu tempat untuk aturan "masih berlaku",
// label tanggalnya di layar, dan pembacaan form "Akhiri penugasan".
//
// Audit HRIS T2 (29 Okt 2026): sebelum ini penugasan tidak punya tanggal
// berakhir sama sekali, sehingga seseorang selamanya ikut muncul sebagai
// pilihan petugas di cabang yang pernah dibantunya. Aturannya sekarang satu
// baris saja: mulai <= hari ini DAN (tanpa tanggal berakhir ATAU berakhir >= hari ini).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

export type PenugasanPeriode = { effective_date: string; end_date?: string | null };

/** Sedang berlaku hari ini. Tanggal dibandingkan sebagai teks ISO (YYYY-MM-DD). */
export function penugasanBerlaku(row: PenugasanPeriode, hariIni: string): boolean {
  return row.effective_date <= hariIni && (!row.end_date || row.end_date >= hariIni);
}

export type KeadaanPenugasan = "berjalan" | "akan-datang" | "berakhir";

export function keadaanPenugasan(row: PenugasanPeriode, hariIni: string): KeadaanPenugasan {
  if (row.end_date && row.end_date < hariIni) return "berakhir";
  if (row.effective_date > hariIni) return "akan-datang";
  return "berjalan";
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "2026-11-05" → "5 Nov". Tahun ikut ditulis bila berbeda dari tahun acuan. */
export function tanggalSingkat(tanggal: string, tahunAcuan?: string): string {
  if (!TANGGAL.test(tanggal)) return tanggal;
  const [tahun, bulan, hari] = tanggal.split("-");
  const label = `${Number(hari)} ${BULAN[Number(bulan) - 1] ?? bulan}`;
  return tahunAcuan && tahunAcuan.slice(0, 4) === tahun ? label : `${label} ${tahun}`;
}

/**
 * Keterangan singkat di daftar: penugasan yang belum berlaku dan yang sudah
 * berakhir harus terbaca berbeda dari yang sedang berjalan (temuan R1).
 */
export function labelPenugasan(row: PenugasanPeriode, hariIni: string): string {
  const keadaan = keadaanPenugasan(row, hariIni);
  if (keadaan === "akan-datang") return `Mulai ${tanggalSingkat(row.effective_date, hariIni)}`;
  if (keadaan === "berakhir") return `Berakhir ${tanggalSingkat(row.end_date!, hariIni)}`;
  return row.end_date ? `Sampai ${tanggalSingkat(row.end_date, hariIni)}` : "";
}

/** Saringan PostgREST untuk "belum berakhir". Tanggalnya selalu dibuat server. */
export function saringanPenugasanAktif(hariIni: string): string {
  return `end_date.is.null,end_date.gte.${hariIni}`;
}

export function bacaAkhiriPenugasan(form: FormData, hariIni: string) {
  const employeeId = String(form.get("employee_id") ?? "").trim().toLowerCase();
  const branchId = String(form.get("branch_id") ?? "").trim().toLowerCase();
  const endDate = String(form.get("end_date") ?? "").trim() || hariIni;
  const reason = String(form.get("reason") ?? "").trim();
  if (!UUID.test(employeeId) || !UUID.test(branchId)) {
    throw new Error("Penugasan yang akan diakhiri tidak valid");
  }
  if (!TANGGAL.test(endDate) || new Date(`${endDate}T00:00:00Z`).toISOString().slice(0, 10) !== endDate) {
    throw new Error("Tanggal berakhir tidak valid");
  }
  if (reason.length < 3 || reason.length > 300) {
    throw new Error("Alasan mengakhiri penugasan wajib diisi 3 sampai 300 karakter");
  }
  return { employeeId, branchId, endDate, reason };
}

export function bacaCabangUtamaMassal(form: FormData) {
  const branchId = String(form.get("branch_id") ?? "").trim().toLowerCase();
  const employeeIds = [...new Set(form.getAll("employee_ids").map((value) => String(value).trim().toLowerCase()))];
  const reason = String(form.get("reason") ?? "").trim();
  if (!UUID.test(branchId)) throw new Error("Pilih cabang utama yang valid");
  if (employeeIds.length < 1 || employeeIds.length > 200 || employeeIds.some((id) => !UUID.test(id))) {
    throw new Error("Pilih 1 sampai 200 karyawan yang akan diberi cabang utama");
  }
  if (reason && (reason.length < 3 || reason.length > 300)) {
    throw new Error("Alasan harus 3 sampai 300 karakter bila diisi");
  }
  return { branchId, employeeIds, reason: reason || null };
}
