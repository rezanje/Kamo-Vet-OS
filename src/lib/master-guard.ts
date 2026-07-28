// Guard peran untuk semua halaman master data (satuan, kategori barang/pemasok/
// aset/pelanggan). Pola diangkat dari pos/merek/actions.ts supaya aturannya
// satu tempat: OWNER/ADMIN boleh menulis, role lain read-only.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const BOLEH = ["OWNER", "ADMIN"];

async function roleSaya() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return { supabase, role: profile?.role ?? "" };
}

// Dipakai server action: menulis tanpa hak = tendang balik dengan pesan.
export async function assertMasterAdmin(back: string, apa: string) {
  const { supabase, role } = await roleSaya();
  if (!BOLEH.includes(role)) {
    redirect(`${back}?error=${encodeURIComponent(`Hanya OWNER/ADMIN yang boleh mengubah ${apa}`)}`);
  }
  return supabase;
}

// Dipakai server component: staf tetap boleh LIHAT daftarnya, form-nya saja disembunyikan.
export async function bolehKelolaMaster(): Promise<boolean> {
  const { role } = await roleSaya();
  return BOLEH.includes(role);
}
