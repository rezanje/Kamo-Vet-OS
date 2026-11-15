// Penarikan data Laporan Visit rawat inap (A4, meeting 12 Nov 2026).
// Sumber: inpatient_daily_logs ("Laporan Rawat Inap Harian" di detail rawat inap),
// disaring memakai log_date (tanggal catatan, WIB) dan cabang rawat inapnya.
import { readReportRows } from "@/lib/hpp-reports-server";
import { completeReportQuery } from "@/lib/report-query";
import { createClient } from "@/lib/supabase/server";
import { allowedBranchIds } from "@/lib/branch-access";
import type { BarisVisit, JenisCatatan } from "@/lib/laporan-visit";

type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

export function tanggalValid(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type PilihanOrangVisit = { id: string; nama: string; jabatan: string | null; branchName: string | null };

export type OpsiFilterVisit = {
  cabangOptions: { id: string; name: string }[];
  karyawan: PilihanOrangVisit[];
  pesanError: string;
};

type EmpRow = { id: string; nama: string; jabatan: string | null; status: string | null; branches: Rel<{ name: string }> };

/** Isian filter saja (cabang yang boleh diakses + karyawan aktif). Tanpa catatan rawat inap. */
export async function ambilOpsiFilterVisit(): Promise<OpsiFilterVisit> {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const [diizinkan, cabangRows, karyawanRows] = await Promise.all([
      auth?.user ? allowedBranchIds(supabase, auth.user.id) : Promise.resolve([] as string[]),
      completeReportQuery(supabase.from("branches").select("id, name", { count: "exact" }).eq("is_active", true)),
      completeReportQuery(supabase.from("employees")
        .select("id, nama, jabatan, status, branches!employees_branch_id_fkey(name)", { count: "exact" })),
    ]);
    return {
      cabangOptions: ((cabangRows.data ?? []) as { id: string; name: string }[])
        .filter((c) => diizinkan === null || diizinkan.includes(c.id))
        .sort((a, b) => a.name.localeCompare(b.name, "id")),
      karyawan: ((karyawanRows.data ?? []) as unknown as EmpRow[])
        .filter((e) => (e.status ?? "").toLocaleLowerCase("id-ID") === "aktif")
        .map((e) => ({ id: e.id, nama: e.nama, jabatan: e.jabatan, branchName: one(e.branches)?.name ?? null }))
        .sort((a, b) => a.nama.localeCompare(b.nama, "id") || a.id.localeCompare(b.id)),
      pesanError: "",
    };
  } catch (error) {
    console.error("Pilihan filter laporan visit gagal:", error);
    return { cabangOptions: [], karyawan: [], pesanError: "Pilihan filter belum bisa dibaca. Muat ulang halaman." };
  }
}

type LogRow = {
  id: string; log_date: string; created_at: string; log_kind: JenisCatatan;
  condition_note: string | null; tindakan: string | null;
  visit_doctor_id: string | null; doctor_name: string | null;
  paramedic_id: string | null; paramedic_name: string | null;
  inpatient_record_id: string;
  inpatient_records: Rel<{
    branch_id: string | null; branches: Rel<{ name: string }>;
    visits: Rel<{ pets: Rel<{ name: string }>; customers: Rel<{ name: string }> }>;
  }>;
};

export type DataVisit = { rows: BarisVisit[]; pesanError: string };

export async function ambilVisit({ dari, sampai, cabangId = "" }: { dari: string; sampai: string; cabangId?: string }): Promise<DataVisit> {
  if (!tanggalValid(dari) || !tanggalValid(sampai) || dari > sampai) {
    return { rows: [], pesanError: "Rentang tanggal tidak valid. Periksa tanggal awal dan akhir." };
  }
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const diizinkan = auth?.user ? await allowedBranchIds(supabase, auth.user.id) : [];
    const logs = await readReportRows<LogRow>(async (awal, ujung) => {
      const query = supabase.from("inpatient_daily_logs")
        .select("id, log_date, created_at, log_kind, condition_note, tindakan, visit_doctor_id, doctor_name, paramedic_id, paramedic_name, inpatient_record_id, inpatient_records!inner(branch_id, branches(name), visits(pets(name), customers(name)))", { count: "exact" })
        .gte("log_date", dari).lte("log_date", sampai);
      const { data, error, count } = await (cabangId ? query.eq("inpatient_records.branch_id", cabangId) : query)
        .order("id").range(awal, ujung);
      return { data: data as unknown as LogRow[] | null, error, count };
    });
    const rows: BarisVisit[] = logs.map((log) => {
      const rawat = one(log.inpatient_records);
      const kunjungan = one(rawat?.visits ?? null);
      return {
        id: log.id,
        tanggal: log.log_date,
        waktu: log.created_at,
        jenis: log.log_kind ?? null,
        inpatientId: log.inpatient_record_id,
        cabangId: rawat?.branch_id ?? null,
        cabang: one(rawat?.branches ?? null)?.name ?? "—",
        pasien: one(kunjungan?.pets ?? null)?.name ?? "—",
        pemilik: one(kunjungan?.customers ?? null)?.name ?? "—",
        kondisi: log.condition_note?.trim() ?? "",
        tindakan: log.tindakan?.trim() ?? "",
        dokterId: log.visit_doctor_id ?? null,
        dokterNama: log.doctor_name ?? null,
        paramedisId: log.paramedic_id ?? null,
        paramedisNama: log.paramedic_name ?? null,
      };
    });
    // Akses cabang: catatan cabang lain tidak pernah sampai ke layar maupun unduhan.
    const terlihat = diizinkan === null ? rows : rows.filter((row) => row.cabangId && diizinkan.includes(row.cabangId));
    terlihat.sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.waktu.localeCompare(a.waktu) || a.id.localeCompare(b.id));
    return { rows: terlihat, pesanError: "" };
  } catch (error) {
    console.error("Laporan visit gagal:", error);
    return {
      rows: [],
      pesanError: error instanceof Error && error.message.startsWith("Periode memuat")
        ? error.message : "Laporan belum bisa dibaca. Coba lagi atau pilih rentang tanggal lebih pendek.",
    };
  }
}
