// Guard peran untuk halaman master data & transaksi keuangan. Aturannya satu
// tempat: OWNER/ADMIN boleh mengubah master data, FINANCE ikut untuk Kas & Bank.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const ADMIN = ["OWNER", "ADMIN"];

async function roleSaya() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return { supabase, role: profile?.role ?? "" };
}

// Dipakai server action: menulis tanpa hak = tendang balik dengan pesan.
export async function assertRole(back: string, apa: string, boleh: string[]) {
  const { supabase, role } = await roleSaya();
  if (!boleh.includes(role)) {
    redirect(`${back}?error=${encodeURIComponent(`Kamu tidak punya hak untuk mengubah ${apa}`)}`);
  }
  return supabase;
}

export async function assertMasterAdmin(back: string, apa: string) {
  return assertRole(back, apa, ADMIN);
}

// Dipakai server component: staf tetap boleh LIHAT daftarnya, form-nya saja disembunyikan.
export async function bolehKelolaMaster(): Promise<boolean> {
  const { role } = await roleSaya();
  return ADMIN.includes(role);
}

// Kas & Bank: transaksi, bukan master data — FINANCE ikut boleh.
export async function bolehTransaksiKas(): Promise<boolean> {
  const { role } = await roleSaya();
  return [...ADMIN, "FINANCE"].includes(role);
}
