"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertRole, klienMasterAdmin } from "@/lib/master-guard";
import {
  LOGO_BUCKET, LOGO_MAKS_BYTE, LOGO_TIPE, jalurLogoSah, rapikanTeks, validasiAlamat, validasiTelepon,
} from "@/lib/cabang-identitas";
import { validasiKoordinat } from "@/lib/lokasi";
import { isGroomingOutlet } from "@/lib/grooming-requirements";

const BACK = "/pengaturan/cabang";
const gagal = (msg: string): never => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);

// Titik lokasi cabang untuk absen berlokasi (fase 2). Dikosongkan = pengecekan
// lokasi mati untuk cabang itu dan absen jalan seperti biasa.
export async function simpanLokasiCabang(formData: FormData) {
  const supabase = await assertRole(BACK, "lokasi cabang", ["OWNER", "ADMIN"]);

  const id = String(formData.get("id") ?? "").trim();
  const latRaw = String(formData.get("lat") ?? "").trim();
  const lngRaw = String(formData.get("lng") ?? "").trim();
  const radius = Math.floor(Number(formData.get("radius_m")) || 0);

  if (!id) gagal("Cabang tidak valid");
  if (radius <= 0) gagal("Radius harus lebih dari 0 meter");

  const kosong = latRaw === "" && lngRaw === "";
  if (!kosong) {
    const salah = validasiKoordinat(Number(latRaw), Number(lngRaw));
    if (salah) gagal(salah);
  }

  const { error } = await supabase.from("branches").update({
    lat: kosong ? null : Number(latRaw),
    lng: kosong ? null : Number(lngRaw),
    radius_m: radius,
  }).eq("id", id);
  if (error) gagal(error.message);

  redirect(`${BACK}?success=1`);
}

export async function simpanAturanGroomingCabang(formData: FormData) {
  const supabase = await assertRole(BACK, "aturan grooming cabang", ["OWNER", "ADMIN"]);
  const branchId = String(formData.get("id") ?? "").trim();
  const choice = String(formData.get("doctor_required") ?? "");
  if (!branchId || !["1", "0"].includes(choice)) gagal("Aturan grooming cabang tidak valid");
  const { data: branch, error: branchError } = await supabase.from("branches").select("type").eq("id", branchId).maybeSingle();
  if (branchError || !branch || !isGroomingOutlet(branch.type)) gagal("Cabang ini tidak melayani Grooming di outlet");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return gagal("Sesi akun tidak tersedia");
  const { data: existing, error: readError } = await supabase.from("branch_grooming_rules")
    .select("branch_id").eq("branch_id", branchId).maybeSingle();
  if (readError) gagal("Aturan grooming belum dapat diperiksa. Coba muat ulang.");
  const next = { doctor_required: choice === "1", updated_by: user.id, updated_at: new Date().toISOString() };
  const { error } = existing
    ? await supabase.from("branch_grooming_rules").update(next).eq("branch_id", branchId)
    : await supabase.from("branch_grooming_rules").insert({ branch_id: branchId, ...next });
  if (error) gagal("Aturan grooming belum dapat disimpan. Coba muat ulang.");
  redirect(`${BACK}?success=grooming`);
}

// ───────────────────────── Identitas cabang di dokumen cetak (alamat, telepon, logo) ─────────────────────────
export type IdentitasCabangState = { ok: boolean; message: string } | null;
const GAGAL_IDENTITAS = "Identitas cabang belum dapat disimpan. Tidak ada perubahan yang dipastikan tersimpan; muat ulang halaman lalu coba lagi.";

// Galat dari update_branch_identity: pesan Indonesian milik fungsi itu sendiri boleh tampil; galat lain tetap pesan umum.
function pesanIdentitas(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (code === "42501") return "Hanya Owner atau Admin yang boleh mengubah identitas cabang.";
  if (code === "CG002") return "Cabang tidak ditemukan. Muat ulang halaman.";
  if (code === "22023" && typeof message === "string" && message.length < 200) return message;
  return GAGAL_IDENTITAS;
}

/**
 * Simpan alamat, telepon, dan logo cabang. Logo SUDAH diunggah browser ke dokumen/cabang-logo/<id>/ (jalur dikirim di logo_path);
 * di sini jalurnya dicek lagi (milik cabang ini, format, ukuran ≤ 1 MB, tipe gambar) sebelum fungsi database menulis.
 * logo_aksi: "tetap" (jangan ubah logo) | "ganti" | "hapus".
 */
export async function simpanIdentitasCabang(_prev: IdentitasCabangState, formData: FormData): Promise<IdentitasCabangState> {
  const supabase = await klienMasterAdmin();
  if (!supabase) return { ok: false, message: "Kamu tidak punya hak untuk mengubah identitas cabang." };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "Cabang tidak valid." };
  const alamat = rapikanTeks(formData.get("alamat"));
  const telepon = rapikanTeks(formData.get("telepon"));
  const salahAlamat = validasiAlamat(alamat); if (salahAlamat) return { ok: false, message: salahAlamat };
  const salahTelepon = validasiTelepon(telepon); if (salahTelepon) return { ok: false, message: salahTelepon };

  const aksi = String(formData.get("logo_aksi") ?? "tetap");
  if (!["tetap", "ganti", "hapus"].includes(aksi)) return { ok: false, message: "Aksi logo tidak dikenal." };
  const logoBaru = String(formData.get("logo_path") ?? "").trim();
  if (aksi === "ganti") {
    if (!jalurLogoSah(id, logoBaru)) return { ok: false, message: "Logo belum terunggah dengan benar. Pilih berkas logo lagi." };
    const nama = logoBaru.split("/").pop() as string;
    const { data: ada, error: listError } = await supabase.storage.from(LOGO_BUCKET).list(`cabang-logo/${id.toLowerCase()}`, { search: nama, limit: 20 });
    const berkas = (ada ?? []).find((o) => o.name === nama);
    if (listError || !berkas) return { ok: false, message: "Logo belum terunggah dengan benar. Pilih berkas logo lagi." };
    const meta = (berkas.metadata ?? {}) as { size?: number; mimetype?: string };
    if (typeof meta.size === "number" && meta.size > LOGO_MAKS_BYTE) {
      await supabase.storage.from(LOGO_BUCKET).remove([logoBaru]);
      return { ok: false, message: "Logo maksimal 1 MB." };
    }
    if (typeof meta.mimetype === "string" && !(meta.mimetype in LOGO_TIPE)) {
      await supabase.storage.from(LOGO_BUCKET).remove([logoBaru]);
      return { ok: false, message: "Logo harus berformat PNG, JPG, atau WEBP." };
    }
  }

  const { data, error } = await supabase.rpc("update_branch_identity", {
    p_id: id, p_alamat: alamat ?? "", p_telepon: telepon ?? "",
    p_logo_path: aksi === "ganti" ? logoBaru : "", p_ubah_logo: aksi !== "tetap",
  });
  if (error) {
    // Unggahan baru yang tidak jadi dipakai dibersihkan agar tidak menjadi yatim.
    if (aksi === "ganti") await supabase.storage.from(LOGO_BUCKET).remove([logoBaru]);
    return { ok: false, message: pesanIdentitas(error) };
  }
  // Logo lama dibersihkan hanya setelah database memakai yang baru (gagal bersih tidak membatalkan simpan).
  const lama = (data as { logo_lama?: string | null } | null)?.logo_lama;
  if (lama && jalurLogoSah(id, lama)) await supabase.storage.from(LOGO_BUCKET).remove([lama]).catch(() => undefined);

  revalidatePath(BACK);
  return { ok: true, message: (data as { changed?: boolean } | null)?.changed === false ? "Tidak ada perubahan." : "Identitas cabang tersimpan." };
}
