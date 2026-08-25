"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JENIS_PERSETUJUAN, PERAN_PENYETUJU } from "@/lib/persetujuan";

const BACK = "/pengaturan/penyetuju";
const kembali = (q: string): never => redirect(`${BACK}?${q}`);

async function pastikanBoleh() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();
  if (!me || !["OWNER", "ADMIN"].includes(me.role)) {
    kembali(`error=${encodeURIComponent("Hanya owner/admin yang boleh mengatur penyetuju transaksi.")}`);
  }
  return { supabase, userId: user?.id ?? null };
}

export async function tambahAturanPersetujuan(formData: FormData) {
  const { supabase, userId } = await pastikanBoleh();

  const jenis = String(formData.get("jenis") ?? "");
  if (!JENIS_PERSETUJUAN.some((j) => j.jenis === jenis)) {
    kembali(`error=${encodeURIComponent("Jenis transaksi tidak dikenal.")}`);
  }

  const peran = String(formData.get("penyetuju_role") ?? "");
  if (!(PERAN_PENYETUJU as readonly string[]).includes(peran)) {
    kembali(`error=${encodeURIComponent("Peran penyetuju tidak dikenal.")}`);
  }

  const minNilai = Math.max(0, Number(formData.get("min_nilai")) || 0);

  // Dua aturan dengan ambang sama untuk jenis yang sama cuma bikin bingung — yang
  // satu tidak akan pernah dipakai karena pemilihannya memakai ambang tertinggi.
  const { data: sama } = await supabase
    .from("approval_rules").select("id").eq("jenis", jenis).eq("min_nilai", minNilai).eq("is_active", true);
  if ((sama ?? []).length > 0) {
    kembali(`error=${encodeURIComponent("Sudah ada aturan aktif dengan ambang yang sama untuk transaksi ini.")}`);
  }

  const { error } = await supabase.from("approval_rules").insert({
    jenis, min_nilai: minNilai, penyetuju_role: peran, updated_by: userId,
  });
  if (error) kembali(`error=${encodeURIComponent(error.message)}`);

  revalidatePath(BACK);
  kembali(`success=${encodeURIComponent("Aturan persetujuan ditambahkan.")}`);
}

export async function ubahStatusAturan(formData: FormData) {
  const { supabase, userId } = await pastikanBoleh();
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  if (!id) kembali(`error=${encodeURIComponent("Aturan tidak ditemukan.")}`);

  const { error } = await supabase
    .from("approval_rules").update({ is_active: aktif, updated_by: userId }).eq("id", id);
  if (error) kembali(`error=${encodeURIComponent(error.message)}`);

  revalidatePath(BACK);
  kembali(`success=${encodeURIComponent(aktif ? "Aturan dinyalakan." : "Aturan dimatikan.")}`);
}

export async function hapusAturanPersetujuan(formData: FormData) {
  const { supabase } = await pastikanBoleh();
  const id = String(formData.get("id") ?? "");
  if (!id) kembali(`error=${encodeURIComponent("Aturan tidak ditemukan.")}`);

  const { error } = await supabase.from("approval_rules").delete().eq("id", id);
  if (error) kembali(`error=${encodeURIComponent(error.message)}`);

  revalidatePath(BACK);
  kembali(`success=${encodeURIComponent("Aturan dihapus.")}`);
}

/**
 * Putuskan satu pengajuan. Penjagaan perannya ada di dua lapis: dicek di sini dan
 * ditegakkan lagi oleh aturan database — layar bisa dilewati, database tidak.
 */
async function putuskan(formData: FormData, setuju: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").maybeSingle();

  const id = String(formData.get("id") ?? "");
  const catatan = String(formData.get("catatan") ?? "").trim() || null;
  if (!id) kembali(`error=${encodeURIComponent("Pengajuan tidak ditemukan.")}`);

  const { data: pengajuan } = await supabase
    .from("approval_requests").select("penyetuju_role, status").eq("id", id).maybeSingle();
  if (!pengajuan) kembali(`error=${encodeURIComponent("Pengajuan tidak ditemukan.")}`);
  if (pengajuan!.status !== "menunggu") {
    kembali(`error=${encodeURIComponent("Pengajuan itu sudah diputuskan sebelumnya.")}`);
  }

  const peranSaya = String(me?.role ?? "");
  if (peranSaya !== "OWNER" && peranSaya !== pengajuan!.penyetuju_role) {
    kembali(`error=${encodeURIComponent(`Hanya ${pengajuan!.penyetuju_role} yang boleh memutuskan pengajuan ini.`)}`);
  }
  if (!setuju && !catatan) {
    kembali(`error=${encodeURIComponent("Alasan penolakan wajib diisi — pengaju perlu tahu apa yang harus diperbaiki.")}`);
  }

  const { error } = await supabase.from("approval_requests").update({
    status: setuju ? "disetujui" : "ditolak",
    diputus_oleh: user?.id ?? null,
    diputus_at: new Date().toISOString(),
    catatan,
  }).eq("id", id).eq("status", "menunggu");
  if (error) kembali(`error=${encodeURIComponent(error.message)}`);

  revalidatePath(BACK);
  kembali(`success=${encodeURIComponent(setuju
    ? "Disetujui. Yang mengajukan tinggal mengulangi transaksinya."
    : "Pengajuan ditolak.")}`);
}

// Dua pintu terpisah, bukan satu action dengan tombol bernilai beda: nilai tombol
// pengirim tidak selalu ikut terbaca di server action, dan salah baca di sini berarti
// "setuju" berubah jadi "tolak" tanpa ada yang sadar.
export async function setujuiPengajuan(formData: FormData) {
  await putuskan(formData, true);
}

export async function tolakPengajuan(formData: FormData) {
  await putuskan(formData, false);
}
