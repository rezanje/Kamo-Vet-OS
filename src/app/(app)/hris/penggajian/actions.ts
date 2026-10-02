"use server";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { kumpulkanDataGaji } from "@/lib/payroll-data";
import { sourceRows } from "@/lib/source-rows";
import { field, pesanPengajuan } from "@/lib/hris-request-actions";
const BASE = "/hris/penggajian";
const back = (period: string) => `${BASE}?periode=${period}`;
function periodOf(f: FormData) {
  const p = field(f, "periode");
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(p))
    redirect(`${BASE}?error=Periode%20tidak%20valid`);
  return p;
}
async function prepare(f: FormData, correct: boolean) {
  const period = periodOf(f),
    url = back(period),
    db = await assertRole(url, "penggajian seluruh perusahaan", ["OWNER"]);
  const fail = (message: string): never =>
    redirect(`${url}&error=${encodeURIComponent(message)}`);
  const version = Number(field(f, "version"));
  if (!Number.isSafeInteger(version) || version < 0)
    fail("Versi draft tidak valid. Muat ulang");
  let payload: Record<string, unknown>[] = [];
  let revision = 0;
  try {
    const old = await sourceRows<{
      id: string;
      employee_id: string;
      penyesuaian: number;
      catatan: string | null;
      status: string;
    }>(db, "payrolls", "id,employee_id,penyesuaian,catatan,status", (q) =>
      q.eq("periode", period),
    );
    if (old.some((r) => r.status === "final"))
      throw new Error("Data gaji sudah final");
    if (correct && !old.length) throw new Error("Data gaji belum dihitung");
    const adjustments = new Map<string, number>(),
      notes = new Map<string, string>();
    for (const row of old) {
      const raw = correct
        ? field(f, `adj_${row.employee_id}`)
        : String(row.penyesuaian);
      const amount = Number(raw);
      if (!Number.isFinite(amount))
        throw new Error("Data gaji: penyesuaian tidak valid");
      const note = correct
        ? field(f, `note_${row.employee_id}`)
        : (row.catatan ?? "");
      if (amount !== 0 && note.length < 3)
        throw new Error("Data gaji: penyesuaian wajib beralasan");
      adjustments.set(row.employee_id, amount);
      notes.set(row.employee_id, note);
    }
    const rows = await kumpulkanDataGaji(db, period, adjustments);
    if (!rows.length) throw new Error("Data gaji: tidak ada karyawan aktif");
    if (rows.some((r) => r.draftVersion !== version))
      throw new Error("Data gaji: draft sudah berubah. Muat ulang");
    revision = rows[0].sourceRevision;
    payload = rows.map((r) => ({
      ...r,
      catatan: notes.get(r.employeeId) ?? "",
    }));
  } catch (error) {
    fail(
      error instanceof Error && error.message.startsWith("Data ")
        ? error.message
        : "Data gaji gagal diverifikasi. Periksa akses dan kelengkapan sumber",
    );
  }
  const { error } = await db.rpc("hris_prepare_payroll", {
    p_period: period,
    p_revision: revision,
    p_version: version,
    p_rows: payload,
    p_reason: correct
      ? "Koreksi gaji dengan alasan per karyawan"
      : "Hitung ulang dari sumber lengkap yang diverifikasi",
  });
  if (error) fail(pesanPengajuan(error));
  redirect(`${url}&success=${correct ? "koreksi" : "hitung"}`);
}
export async function hitungPenggajian(f: FormData) {
  return prepare(f, false);
}
export async function simpanKoreksi(f: FormData) {
  return prepare(f, true);
}
export async function sahkanPenggajian(f: FormData) {
  const period = periodOf(f),
    url = back(period),
    db = await assertRole(url, "penggajian seluruh perusahaan", ["OWNER"]);
  const version = Number(field(f, "version"));
  if (!Number.isSafeInteger(version) || version <= 0)
    redirect(`${url}&error=Versi%20draft%20tidak%20valid.%20Hitung%20ulang`);
  const { error } = await db.rpc("hris_finalize_payroll", {
    p_period: period,
    p_version: version,
    p_account: field(f, "account_id") || null,
    p_reason: field(f, "catatan"),
  });
  if (error)
    redirect(`${url}&error=${encodeURIComponent(pesanPengajuan(error))}`);
  redirect(`${url}&success=sah`);
}
