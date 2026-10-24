import { clinicalRoles } from "./clinical-staff";

export type ServiceStaff = { id: string; nama: string; jabatan: string | null };
export type ServicePerformersInput = { doctor_id: string | null; staff_id: string | null };
export type ServicePerformersSnapshot = ServicePerformersInput & { version?: number; doctor_name?: string | null; staff_name?: string | null };
export const emptyServicePerformers = (): ServicePerformersInput => ({ doctor_id: null, staff_id: null });

/** Only reference IDs cross the write boundary. Database supplies the names. */
export function servicePerformerInput(value: unknown): ServicePerformersInput {
  if (value == null) return emptyServicePerformers();
  if (typeof value !== "object" || Array.isArray(value)) throw Error("Pelaksana jasa tidak valid");
  const row = value as Record<string, unknown>;
  const id = (key: string) => {
    if (row[key] == null || row[key] === "") return null;
    if (typeof row[key] !== "string" || (row[key] as string).length > 80) throw Error("Pilih pelaksana dari daftar karyawan");
    return (row[key] as string).trim() || null;
  };
  const result = { doctor_id: id("doctor_id"), staff_id: id("staff_id") };
  if (result.doctor_id && result.doctor_id === result.staff_id) throw Error("Dokter dan non-dokter harus berbeda");
  return result;
}

export function serviceStaffSlots(staff: ServiceStaff[]) {
  return { doctors: staff.filter(person => clinicalRoles(person.jabatan).includes("doctor")),
    staff: staff.filter(person => !clinicalRoles(person.jabatan).includes("doctor")) };
}

/** Bulk intentionally fills empty rows only. A later bulk action cannot overwrite an override. */
export function bulkFillServicePerformers<T extends { jenis?: string; item_type?: string; service_performers?: ServicePerformersInput | null }>(rows: T[], value: ServicePerformersInput): T[] {
  return rows.map(row => (row.jenis === "jasa" || row.item_type === "Jasa")
    && !row.service_performers?.doctor_id && !row.service_performers?.staff_id
    ? { ...row, service_performers: { ...value } } : row);
}

/** Never reconstruct historical names from today's employee/PIC/cashier record. */
export function servicePerformerNames(value: ServicePerformersSnapshot | null | undefined): string[] {
  if (!value) return ["Pelaksana per baris belum tercatat (data lama)"];
  const names: string[] = [];
  if (value.doctor_id) names.push(value.doctor_name ? `Dokter: ${value.doctor_name}` : "Nama dokter tidak tersedia");
  if (value.staff_id) names.push(value.staff_name ? `Pelaksana: ${value.staff_name}` : "Nama pelaksana tidak tersedia");
  return names.length ? names : ["Pelaksana belum ditetapkan"];
}
