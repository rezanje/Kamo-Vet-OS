// Guard peran untuk halaman master data & transaksi keuangan. Aturannya satu
// tempat: OWNER/ADMIN boleh mengubah master data, FINANCE ikut untuk Kas & Bank.
import { cache } from "react";
import { loadRoleCapabilities } from "./role-capabilities";
import { redirect } from "next/navigation";
import { bolehKelolaPayroll as peranBolehKelolaPayroll } from "@/lib/hris-access";
import { createClient } from "@/lib/supabase/server";

const ADMIN = ["OWNER", "ADMIN"];

// Satu halaman memanggil beberapa guard sekaligus (bolehKelolaMaster +
// bolehLihatGaji + bolehKelolaPayroll). Tanpa memo, tiap panggilan mengulang
// auth.getUser() dan satu baca `profiles` — enam perjalanan ke server untuk
// jawaban yang sama. `cache` dari React memoize per permintaan, jadi cukup satu.
const roleSaya = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  return { supabase, role: profile?.is_active ? profile.role : "" };
});

// Dipakai server action: menulis tanpa hak = tendang balik dengan pesan.
export async function assertRole(back: string, apa: string, boleh: string[]) {
  const { supabase, role } = await roleSaya();
  if (!boleh.includes(role)) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(`Kamu tidak punya hak untuk mengubah ${apa}`)}`);
  }
  return supabase;
}

export async function assertMasterAdmin(back: string, apa: string) {
  return assertRole(back, apa, ADMIN);
}

// Dipakai server action yang mengembalikan pesan di layar (useActionState) alih-alih
// redirect: null = tidak berhak, tanpa memaksa pindah halaman.
export async function klienMasterAdmin() {
  const { supabase, role } = await roleSaya();
  return ADMIN.includes(role) ? supabase : null;
}

export async function assertHrisManager(back: string) {
  return assertRole(back, "data HRIS cabang ini", ["OWNER", "ADMIN"]);
}

export async function assertPayrollOwner(back: string) {
  return assertRole(back, "data HRIS cabang ini", ["OWNER"]);
}

// Dipakai server component: staf tetap boleh LIHAT daftarnya, form-nya saja disembunyikan.
export async function bolehKelolaMaster(): Promise<boolean> {
  const { role } = await roleSaya();
  return ADMIN.includes(role);
}

export async function bolehKelolaPayroll(): Promise<boolean> {
  const { role } = await roleSaya();
  return peranBolehKelolaPayroll(role);
}

// Angka gaji: OWNER (kelola) dan FINANCE (baca). ADMIN tidak melihat.
export async function bolehLihatGaji(): Promise<boolean> {
  const { role } = await roleSaya();
  return role === "OWNER" || role === "FINANCE";
}

// Kas & Bank: transaksi, bukan master data — FINANCE ikut boleh.
export async function bolehTransaksiKas(): Promise<boolean> {
  const { role } = await roleSaya();
  return [...ADMIN, "FINANCE"].includes(role);
}

export async function assertAccountCreator(back: string) {
  const { supabase, role } = await roleSaya();
  if (!role || !(await loadRoleCapabilities(supabase, role)).create_accounts) {
    redirect(`${back}?error=${encodeURIComponent("Kamu tidak punya hak untuk menambahkan akun karyawan")}`);
  }
  return supabase;
}
