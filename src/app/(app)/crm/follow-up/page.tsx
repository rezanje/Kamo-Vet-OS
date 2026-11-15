import { FollowUpPelanggan } from "@/components/FollowUpPelanggan";
import { bacaFilter } from "@/lib/marketing-followup";
import { MarketingError, muatDaftarMarketing, periksaAksesMarketing } from "@/lib/marketing-followup-server";
import { createClient } from "@/lib/supabase/server";
import type { HasilDaftar } from "@/lib/marketing-followup";
import { catatDihubungiAksi } from "./actions";

// Follow up pelanggan (marketing): siapa yang perlu dihubungi. Hanya baca + catatan "sudah dihubungi"; tidak ada kirim otomatis.
export default async function FollowUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filter = bacaFilter(await searchParams);
  const supabase = await createClient();
  const akses = await periksaAksesMarketing(supabase);
  if (!akses.ok) {
    return <div className="p2ban" role="alert">Halaman ini berisi nomor HP pelanggan dan belum diizinkan untuk akun Anda. Minta Owner mencentang &quot;Follow up pelanggan&quot; di Akses Grup (CRM).</div>;
  }
  let data: HasilDaftar | null = null;
  let galat = "";
  try { data = await muatDaftarMarketing(supabase, filter); }
  catch (e) { galat = e instanceof MarketingError ? e.message : "Daftar belum dapat dimuat. Muat ulang sebentar lagi."; }
  if (!data) return <div className="p2ban" role="alert" style={{ color: "#b91c1c" }}>{galat}</div>;
  return <FollowUpPelanggan data={data} filter={filter} bolehUnduh={akses.bolehUnduh} catat={catatDihubungiAksi} />;
}
