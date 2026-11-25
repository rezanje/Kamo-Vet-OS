import { FormKomplainBaru } from "@/components/komplain/FormKomplainBaru";
import { Galat, KepalaKomplain } from "@/components/komplain/KomplainUi";
import { hariIniWib } from "@/lib/komplain";
import { KomplainError, muatPilihan, periksaSesiKomplain } from "@/lib/komplain-server";
import { createClient } from "@/lib/supabase/server";

// Catat komplain baru. Semua akun internal yang punya akses cabang boleh mencatat di cabangnya; ADMIN_ONLINE ditolak (halaman, aksi, database).
export default async function KomplainBaruPage() {
  const supabase = await createClient();
  const sesi = await periksaSesiKomplain(supabase);
  if (!sesi.ok) return <Galat pesan="Komplain Pelanggan belum diizinkan untuk akun ini." />;
  let pilihan: Awaited<ReturnType<typeof muatPilihan>>;
  try {
    pilihan = await muatPilihan(supabase, null);
  } catch (e) {
    return <Galat pesan={e instanceof KomplainError ? e.message : "Formulir belum dapat dimuat. Muat ulang sebentar lagi."} />;
  }
  const { data: emp } = await supabase.from("employees").select("id, nama, jabatan").eq("status", "Aktif").is("trashed_at", null).order("nama").limit(1000);
  const karyawan = ((emp ?? []) as { id: string; nama: string; jabatan: string | null }[]).map(e => ({ id: e.id, nama: e.nama, jabatan: e.jabatan }));
  return (
    <>
      <KepalaKomplain aktif="baru" judul="Catat Komplain" catatanUang />
      {pilihan.cabang.length === 0
        ? <Galat pesan="Akun Anda belum punya cabang. Minta admin menugaskan cabang dulu." />
        : <FormKomplainBaru pilihan={pilihan} karyawan={karyawan} hari={hariIniWib()} />}
    </>
  );
}
