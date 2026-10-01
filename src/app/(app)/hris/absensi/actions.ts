"use server";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { waktuInputWIB, hariIniWIB } from "@/lib/tanggal";
const text = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
function timestamp(value: string, original = "") {
  if (!value) return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      value,
    );
  if (
    !match ||
    !waktuInputWIB(match[1], match[2]) ||
    (match[3] && Number(match[3]) > 59)
  )
    throw new Error("Waktu tidak valid. Isi tanggal dan jam WIB sebenarnya.");
  const parsed = `${value}${match[3] ? "" : ":00"}+07:00`;
  if (original && new Date(original).getTime() === new Date(parsed).getTime())
    return original;
  return parsed;
}
async function save(
  form: FormData,
  operation: "record" | "correct" | "resolve",
) {
  const supabase = await assertRole("/hris/absensi", "absensi karyawan", [
    "OWNER",
    "ADMIN",
  ]);
  const tanggal =
    text(form, operation === "record" ? "tanggal" : "tgl") || hariIniWIB();
  let message = "";
  try {
    const result =
      operation === "resolve"
        ? await supabase.rpc("hris_resolve_final_attendance", {
            p_id: text(form, "id"),
            p_expected_updated_at: text(form, "updated_at"),
            p_reason: text(form, "reason"),
          })
        : operation === "correct"
          ? await supabase.rpc("hris_correct_attendance", {
              p_id: text(form, "id"),
              p_expected_updated_at: text(form, "updated_at"),
              p_checked_in_at: timestamp(
                text(form, "checked_in_at"),
                text(form, "checked_in_at_original"),
              ),
              p_checked_out_at: timestamp(
                text(form, "checked_out_at"),
                text(form, "checked_out_at_original"),
              ),
              p_reason: text(form, "reason"),
              p_void: form.get("void") === "1",
            })
          : await supabase.rpc("hris_record_attendance", {
              p_employee_id: text(form, "employee_id"),
              p_tanggal: tanggal,
              p_checked_in_at: timestamp(
                text(form, "jam_masuk")
                  ? `${tanggal}T${text(form, "jam_masuk")}`
                  : "",
              ),
              p_checked_out_at: timestamp(
                text(form, "jam_pulang")
                  ? `${text(form, "tanggal_pulang")}T${text(form, "jam_pulang")}`
                  : "",
              ),
              p_status: text(form, "status"),
              p_reason: text(form, "keterangan"),
            });
    if (result.error)
      throw new Error(
        result.error.code === "PGRST202"
          ? "Fitur sesi dan koreksi belum aktif. Hubungi admin sistem."
          : result.error.message.replace(/^ATTENDANCE:\s*/, ""),
      );
  } catch (e) {
    message = e instanceof Error ? e.message : "Absensi gagal disimpan.";
  }
  redirect(
    `/hris/absensi?${new URLSearchParams({ tgl: tanggal, ...(message ? { error: message } : { success: "1" }) })}`,
  );
}
export async function simpanAbsensi(form: FormData) {
  return save(form, "record");
}
export async function koreksiAbsensi(form: FormData) {
  return save(form, "correct");
}
export async function selesaikanSesiFinal(form: FormData) {
  return save(form, "resolve");
}
